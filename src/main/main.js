'use strict';

const { app, BrowserWindow, protocol, net, shell, nativeTheme, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { registerIpcHandlers } = require('./ipc');
const store = require('./store');
const { createTray } = require('./tray');

// ---------------------------------------------------------------------------
// 自定义协议：让渲染进程跑在 app:// 下，而不是 file://
// 目的：file:// 下浏览器会以 CORS 为由拦掉 ES Module 的 import，
// 用自定义协议后可以正常使用原生 ESM，不需要引入任何打包器。
// ---------------------------------------------------------------------------
const SCHEME = 'app';
const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function resolveSafePath(requestUrl) {
  const url = new URL(requestUrl);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '' || rel === '/') rel = '/index.html';

  const target = path.normalize(path.join(RENDERER_ROOT, rel));
  // 防目录穿越：解析后必须仍在 renderer 目录内
  if (target !== RENDERER_ROOT && !target.startsWith(RENDERER_ROOT + path.sep)) {
    return null;
  }
  return target;
}

function registerProtocol() {
  protocol.handle(SCHEME, (request) => {
    const target = resolveSafePath(request.url);
    if (!target) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');

let win = null;
let isQuitting = false;
let trayCtl = null;
let saveBoundsTimer = null;

function darkBackground() {
  return nativeTheme.shouldUseDarkColors ? '#15181d' : '#f5f6f8';
}

/** 窗口尺寸/位置记忆：拖动、缩放时防抖落盘，退出前再兜底存一次 */
function watchWindowBounds(w) {
  const save = () => {
    if (!w || w.isDestroyed()) return;
    const bounds = w.getNormalBounds();
    store.update({
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: w.isMaximized(),
      },
    });
  };
  const debounced = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(save, 500);
  };
  w.on('resize', debounced);
  w.on('move', debounced);
  w.on('close', () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    save();
  });
}

function createWindow() {
  const saved = store.get().window;
  const hasPosition =
    Number.isInteger(saved.x) && Number.isInteger(saved.y);

  // 记住的尺寸可能来自更大的显示器：超出工作区就收回来，别让窗口一开就撑满屏
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(saved.width || 1120, work.width);
  const height = Math.min(saved.height || 720, work.height);

  win = new BrowserWindow({
    width,
    height,
    minWidth: 940,
    minHeight: 600,
    x: hasPosition ? saved.x : undefined,
    y: hasPosition ? saved.y : undefined,
    title: '工具集',
    backgroundColor: darkBackground(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (saved.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // SMOKE_HASH 仅用于自动化截图时指定初始页面，例如 SMOKE_HASH='#/json-format'
  const hash = process.env.SMOKE_HASH ? `#${process.env.SMOKE_HASH.replace(/^#/, '')}` : '';
  win.loadURL(`${SCHEME}://bundle/index.html${hash}`);

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // 外部链接走系统浏览器，不在应用内打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!isSmoke) watchWindowBounds(win);

  // 关闭按钮 → 藏进托盘（可在托盘菜单里改成真退出）
  win.on('close', (event) => {
    if (isQuitting) return;
    if (store.get().ui.closeToTray !== false) {
      event.preventDefault();
      win.hide();
    }
  });

  return win;
}

function showWindow() {
  if (!win || win.isDestroyed()) {
    win = createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/** 快捷键行为：可见且有焦点 → 隐藏；否则唤出。这是工具箱最顺手的往返 */
function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    showWindow();
    // 唤出后直接聚焦搜索框，输入关键字回车就进工具，一气呵成
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:summoned');
    }
  }
}

// ---------------------------------------------------------------------------
// 冒烟测试：用于在没有人工介入的情况下验证「窗口能起、渲染无报错」
// npm run smoke  → 收到渲染进程的 app-ready 信号后退出码 0
// ---------------------------------------------------------------------------
function attachSmokeHooks(w) {
  let settled = false;
  const finish = async (code, reason) => {
    if (settled) return;
    settled = true;
    console.log(`[smoke] ${reason}`);

    // 可选：截一张图，用于目视检查布局（SLOMO=1 时留出渲染时间）
    if (process.env.SMOKE_SHOT) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 600));
        const image = await w.webContents.capturePage();
        await fs.writeFile(process.env.SMOKE_SHOT, image.toPNG());
        console.log(`[smoke] 截图: ${process.env.SMOKE_SHOT}`);
      } catch (err) {
        console.error('[smoke] 截图失败', err);
      }
    }

    store.flush(); // 防抖中的设置改动落盘，持久化测试依赖这一步
    app.exit(code);
  };

  w.webContents.on('did-fail-load', (_e, code, desc, url) => {
    finish(1, `页面加载失败 ${code} ${desc} ${url}`);
  });

  w.webContents.on('console-message', (...args) => {
    const details = args[1];
    const message =
      details && typeof details === 'object' ? details.message : String(args[2] ?? '');
    console.log(`[renderer] ${message}`);

    if (message.includes('app-ready')) {
      // 有注入脚本时，等脚本跑完再收尾
      if (!process.env.SMOKE_SCRIPT) finish(0, '渲染进程就绪');
      return;
    }
    if (/error|failed/i.test(message)) finish(1, `渲染进程报错: ${message}`);
  });

  w.webContents.on('render-process-gone', (_e, d) => {
    finish(1, `渲染进程崩溃: ${d.reason}`);
  });

  /**
   * SMOKE_SCRIPT=path/to.js 时，在页面加载完成后注入执行，
   * 用于端到端验证（点按钮、填表单、断言 DOM），配合 SMOKE_FIXTURE_QUEUE 绕过文件选择框。
   */
  if (process.env.SMOKE_SCRIPT) {
    w.webContents.once('did-finish-load', async () => {
      try {
        const code = await fs.readFile(process.env.SMOKE_SCRIPT, 'utf8');
        const result = await w.webContents.executeJavaScript(code, true);
        console.log(`[smoke] 脚本返回: ${JSON.stringify(result)}`);
        setTimeout(() => finish(0, '注入脚本执行完毕'), 900);
      } catch (err) {
        finish(1, `注入脚本执行失败: ${err.message}`);
      }
    });
  }

  setTimeout(() => finish(1, '超时未收到渲染进程就绪信号'), 25000);
}

// ---------------------------------------------------------------------------
// 冒烟模式用独立的 userData：不污染真实设置，也避免上一次测试的
// lastRoute / 主题影响截图结果。SMOKE_KEEP_STATE=1 可保留状态做跨启动验证。
// ---------------------------------------------------------------------------
function isolateSmokeUserData() {
  if (!isSmoke) return;
  const os = require('node:os');
  const dir = path.join(os.tmpdir(), 'use-tools-smoke');
  if (!process.env.SMOKE_KEEP_STATE) {
    try {
      require('node:fs').rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn('[smoke] 清理临时 userData 失败', err.message);
    }
  }
  app.setPath('userData', dir);
}

// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已经有一个实例在跑：退出，让既有实例把自己带到前台
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(() => {
    isolateSmokeUserData();
    store.load();
    nativeTheme.themeSource = store.get().ui.theme || 'system';
    nativeTheme.on('updated', () => {
      if (win && !win.isDestroyed()) win.setBackgroundColor(darkBackground());
    });

    registerProtocol();
    registerIpcHandlers();

    createWindow();
    if (isSmoke) {
      attachSmokeHooks(win);
    } else {
      trayCtl = createTray({
        getWindow: () => win,
        showWindow,
        toggleWindow,
        quit: () => {
          isQuitting = true;
          app.quit();
        },
      });
      trayCtl.registerHotkey();
    }
  });

  app.on('activate', () => {
    // mac 点 Dock 图标时恢复窗口；Windows 下主要走托盘
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (trayCtl) trayCtl.destroy();
    store.flush();
  });

  // 关闭到托盘时窗口并没有真正关掉，这个事件只在真退出时触发
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

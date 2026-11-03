'use strict';

/**
 * 主进程 ↔ 渲染进程的能力桥。
 * 原则：渲染进程不碰 Node 与文件系统，所有系统能力都从这里显式开口子。
 * 以后工具需要新的系统能力（读目录、算哈希、调外部程序），就在这里加一个 handle。
 */

const { ipcMain, dialog, shell, app, clipboard, nativeTheme, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const store = require('./store');
const { scanColumn, scanColumnFromText } = require('./column-scan');

const MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024; // readText 的读取上限 32MB

/**
 * 自动化测试用：SMOKE_FIXTURE_QUEUE="a.txt;b.txt" 时，
 * 文件选择框不弹窗，按顺序直接返回预设路径。仅冒烟脚本使用，正常启动不受影响。
 */
const fixtureQueue = process.env.SMOKE_FIXTURE_QUEUE
  ? process.env.SMOKE_FIXTURE_QUEUE.split(';').filter(Boolean)
  : null;

/**
 * 自动化测试用：SMOKE_SAVE_DIR 存在时，保存对话框不弹窗，直接写到这个目录。
 * 路径取 options.defaultName，便于测试断言产物（比如导出的 xlsx）。
 */
const smokeSaveDir = process.env.SMOKE_SAVE_DIR || null;

async function chooseSavePath(options, fallbackName) {
  if (smokeSaveDir) {
    return path.join(smokeSaveDir, options.defaultName || fallbackName);
  }
  const result = await dialog.showSaveDialog({
    title: options.title || '保存文件',
    defaultPath: options.defaultName || fallbackName,
    filters: options.filters || [{ name: '所有文件', extensions: ['*'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

function registerIpcHandlers() {
  // 打开文件选择框，返回选中路径（取消则返回 null）
  ipcMain.handle('dialog:pickFile', async (_event, options = {}) => {
    if (fixtureQueue && fixtureQueue.length > 0) {
      return fixtureQueue.shift();
    }

    const result = await dialog.showOpenDialog({
      title: options.title || '选择文件',
      properties: ['openFile'],
      filters: options.filters || [{ name: '所有文件', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // 保存文本内容到用户选择的位置
  ipcMain.handle('dialog:saveText', async (_event, options = {}) => {
    const filePath = await chooseSavePath(options, 'untitled.txt');
    if (!filePath) return null;

    await fs.writeFile(filePath, options.content ?? '', 'utf8');
    return filePath;
  });

  // 保存二进制内容（xlsx 等）：渲染层把字节转成 base64 传过来
  ipcMain.handle('dialog:saveFile', async (_event, options = {}) => {
    const filePath = await chooseSavePath(options, 'untitled.bin');
    if (!filePath) return null;

    await fs.writeFile(filePath, Buffer.from(String(options.dataBase64 || ''), 'base64'));
    return filePath;
  });

  // 读取文本文件；options.encoding 支持 gbk（内部映射到 gb18030 超集，兼容性更好）
  ipcMain.handle('fs:readText', async (_event, filePath, options = {}) => {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      throw new Error(
        `文件过大（${(stat.size / 1024 / 1024).toFixed(1)}MB），超过 ${MAX_TEXT_FILE_BYTES / 1024 / 1024}MB 上限`
      );
    }

    const buffer = await fs.readFile(filePath);
    const encoding = String(options?.encoding || 'utf-8').toLowerCase();
    let label;
    if (encoding === 'auto') {
      // 能按 UTF-8 严格解开就用 UTF-8，否则按 ANSI（GB18030）
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        label = 'utf-8';
      } catch {
        label = 'gb18030';
      }
    } else {
      label = /^(gbk|gb2312|gb18030|ansi)$/.test(encoding) ? 'gb18030' : 'utf-8';
    }

    let text;
    try {
      text = new TextDecoder(label).decode(buffer);
    } catch {
      text = buffer.toString('utf8');
    }
    // BOM 会粘在第一个值上，导致生成的 IN 列表第一个值永远匹配不到
    return text.replace(/^\uFEFF/, '');
  });

  // 仅取文件名，避免把完整路径暴露得到处都是
  ipcMain.handle('fs:basename', (_event, filePath) => path.basename(filePath));

  // 文件元信息（大小、修改时间），用于在界面上显示
  ipcMain.handle('fs:stat', async (_event, filePath) => {
    const stat = await fs.stat(filePath);
    return { size: stat.size, mtime: stat.mtimeMs, isFile: stat.isFile() };
  });

  // 按列抽取唯一值（流式，内存占用与文件大小无关）
  ipcMain.handle('file:scanColumn', async (_event, options) => scanColumn(options));

  // 同上，但输入是界面粘贴的文本，与文件路径共用同一套切分规则
  ipcMain.handle('text:scanColumn', async (_event, options) => scanColumnFromText(options));

  // 在系统文件管理器中定位文件
  ipcMain.handle('shell:showItemInFolder', (_event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('clipboard:readText', () => clipboard.readText());
  ipcMain.handle('clipboard:writeText', (_event, text) => {
    clipboard.writeText(String(text ?? ''));
  });

  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
  }));

  // -----------------------------------------------------------------
  // 设置与主题
  // -----------------------------------------------------------------

  // 读整份设置。渲染进程只读不写缓存，写一律走 update，避免两边各一份真相
  ipcMain.handle('settings:get', () => store.get());

  // 深合并写入：ui.tools 各级都能局部更新，不用整份回传
  ipcMain.handle('settings:update', (_event, patch) => {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('settings:update 需要一个对象');
    }
    const next = store.update(patch);
    // 托盘菜单里的勾选状态要跟着设置页走，否则两边会各说各话
    if (patch.ui && ('closeToTray' in patch.ui || 'hotkey' in patch.ui)) {
      const ctl = require('./tray').getTray();
      if (ctl) ctl.rebuildMenu();
    }
    return next;
  });

  // 工具配置的便捷入口：工具只管自己的 namespace，不碰别人的
  ipcMain.handle('settings:patchTool', (_event, toolId, partial) => {
    if (typeof toolId !== 'string' || !toolId) throw new Error('toolId 非法');
    if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
      throw new Error('patchTool 需要一个对象');
    }
    return store.update({ tools: { [toolId]: partial } });
  });

  // theme: 'system' | 'light' | 'dark'。写入 nativeTheme 后 Chromium 的
  // prefers-color-scheme 媒体查询会自动更新，渲染层无需手动刷新
  ipcMain.handle('theme:set', (_event, mode) => {
    if (!['system', 'light', 'dark'].includes(mode)) {
      throw new Error(`未知主题模式: ${mode}`);
    }
    nativeTheme.themeSource = mode;
    store.update({ ui: { theme: mode } });
    return { theme: mode, dark: nativeTheme.shouldUseDarkColors };
  });

  // 从渲染进程隐藏窗口（配合全局快捷键的唤出，形成往返）
  ipcMain.handle('app:hide', () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) focused.hide();
  });

  // -----------------------------------------------------------------
  // 设置页：全局快捷键与数据目录
  // -----------------------------------------------------------------

  ipcMain.handle('app:hotkey.get', () => {
    const { getTray, labelOf, DEFAULT_HOTKEY } = require('./tray');
    const ctl = getTray();
    if (ctl) return { ...ctl.hotkeyState(), available: true };

    // 冒烟模式不创建托盘，这里回退成「设置里的值 + 未启用」，别谎报被占用
    const accelerator = store.get().ui.hotkey || DEFAULT_HOTKEY;
    return { accelerator, label: labelOf(accelerator), registered: false, available: false };
  });

  ipcMain.handle('app:hotkey.set', (_event, accelerator) => {
    const ctl = require('./tray').getTray();
    if (!ctl) return { ok: false, error: '托盘未启用，无法设置快捷键' };
    if (typeof accelerator !== 'string') return { ok: false, error: '快捷键格式不对' };
    return ctl.setHotkey(accelerator);
  });

  ipcMain.handle('app:hotkey.reset', () => {
    const ctl = require('./tray').getTray();
    if (!ctl) return { ok: false, error: '托盘未启用，无法设置快捷键' };
    return ctl.resetHotkey();
  });

  ipcMain.handle('app:dataDir', () => app.getPath('userData'));

  ipcMain.handle('app:openDataDir', async () => {
    const message = await shell.openPath(app.getPath('userData'));
    if (message) throw new Error(message);
  });
}

module.exports = { registerIpcHandlers };

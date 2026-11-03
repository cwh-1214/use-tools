/**
 * 应用入口：侧边栏渲染、搜索、路由、工具挂载。
 * 这里只负责「外壳」，任何具体功能都应该写进 tools/ 下的某个工具里。
 */

import { tools } from './tools/index.js';
import { validateTools, groupTools, filterTools, findTool } from './core/registry.js';
import { h, clear } from './core/dom.js';
import { mountSettings } from './settings.js';

const SETTINGS_ROUTE = 'settings';

const els = {
  search: document.getElementById('search'),
  list: document.getElementById('tool-list'),
  title: document.getElementById('tool-title'),
  desc: document.getElementById('tool-desc'),
  actions: document.getElementById('tool-actions'),
  view: document.getElementById('tool-view'),
  version: document.getElementById('brand-version'),
  footInfo: document.getElementById('foot-info'),
};

let keyword = '';
let activeToolId = null;

/**
 * 已挂载的工具：切换菜单时**不销毁**，只把它的 DOM 从文档里摘下来留着。
 * 这样输入框内容、比对结果、筛选条件、滚动位置全都原样保留，
 * 切回来是「接着用」而不是「重新打开一个空白页」。
 * 工具数量是个位数，全部常驻的内存代价可以忽略。
 */
const mountedTools = new Map(); // toolId -> { root, actionNodes, cleanup, scrollTop }
let settingsCleanup = null;

// ---------------------------------------------------------------------------
// 侧边栏
// ---------------------------------------------------------------------------
function renderSidebar() {
  clear(els.list);

  const matched = filterTools(tools, keyword);
  if (matched.length === 0) {
    els.list.append(h('div', { class: 'empty-hint' }, [`没有匹配「${keyword}」的工具`]));
    return;
  }

  for (const group of groupTools(matched)) {
    els.list.append(h('div', { class: 'group-label' }, [group.name]));
    for (const tool of group.items) {
      els.list.append(
        h(
          'button',
          {
            class: `tool-item${tool.id === activeToolId ? ' is-active' : ''}`,
            title: tool.desc || tool.name,
            onClick: () => {
              location.hash = `#/${tool.id}`;
            },
          },
          [
            h('span', { class: 'ti-icon' }, [tool.icon || tool.name.slice(0, 1)]),
            h('span', { class: 'ti-name' }, [tool.name]),
          ]
        )
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 工具挂载 / 收起
// ---------------------------------------------------------------------------
/**
 * 把当前工具「收起来」：视图与顶栏按钮从文档摘下，但节点与状态都留着。
 * 不调用工具的清理函数——清理意味着数据丢失，那正是这次要避免的。
 */
function detachCurrent() {
  if (!activeToolId) return;

  const entry = mountedTools.get(activeToolId);
  if (entry) {
    // 顶栏按钮是工具自己 append 进来的，按节点逐个摘下，顺序不变
    entry.actionNodes = Array.from(els.actions.children);
    for (const node of entry.actionNodes) node.remove();

    entry.scrollTop = els.view.scrollTop;
    if (entry.root.parentNode) entry.root.remove();
  }

  activeToolId = null;
}

/** 彻底销毁（目前只在需要重置状态时用得到，切换菜单不走这里） */
function disposeTool(toolId) {
  const entry = mountedTools.get(toolId);
  if (!entry) return;

  if (typeof entry.cleanup === 'function') {
    try {
      entry.cleanup();
    } catch (err) {
      console.warn('[app] 工具清理函数报错', err);
    }
  }
  entry.root.remove();
  for (const node of entry.actionNodes) node.remove();
  mountedTools.delete(toolId);
}

function renderWelcome() {
  detachCurrent();
  closeSettings();
  els.title.textContent = '工具集';
  els.desc.textContent = '从左侧选择一个工具';
  clear(els.actions);
  clear(els.view);

  els.view.append(
    h('div', { class: 'welcome' }, [
      h('h2', {}, [`${tools.length} 个工具已就绪`]),
      h('p', {}, [
        '左侧选择要用的工具，或按 ',
        h('code', {}, ['Ctrl+F']),
        ' 直接搜索。',
      ]),
      h('p', { style: { marginTop: '14px' } }, [
        '新增工具：在 ',
        h('code', {}, ['src/renderer/tools/']),
        ' 下建一个文件夹，然后在 ',
        h('code', {}, ['tools/index.js']),
        ' 里加一行导入。',
      ]),
    ])
  );
}

function renderToolError(tool, err) {
  clear(els.view);
  console.error('[app] 工具挂载失败', tool?.id, err);
  els.view.append(
    h('div', { class: 'card', style: { padding: '16px 18px' } }, [
      h('h3', { style: { fontSize: '14px', marginBottom: '6px' } }, ['工具加载失败']),
      h('p', { class: 'hint' }, [`${tool?.id || '未知工具'}: ${err?.message || err}`]),
    ])
  );
}

function mountTool(tool) {
  detachCurrent();
  closeSettings();
  activeToolId = tool.id;
  renderSidebar();
  recordRoute(tool.id);

  els.title.textContent = tool.name;
  els.desc.textContent = tool.desc || '';

  // 之前挂过：原样接回来，数据、筛选、滚动位置都还在
  const cached = mountedTools.get(tool.id);
  if (cached) {
    els.view.append(cached.root);
    els.view.scrollTop = cached.scrollTop || 0;
    els.actions.append(...cached.actionNodes);
    return;
  }

  clear(els.actions);
  clear(els.view);

  const root = h('div', { class: 'tool-body' });
  els.view.append(root);

  try {
    const cleanup = tool.mount({ root, api: window.api, actions: els.actions, tool });
    mountedTools.set(tool.id, {
      root,
      actionNodes: [],
      cleanup: typeof cleanup === 'function' ? cleanup : null,
      scrollTop: 0,
    });
  } catch (err) {
    renderToolError(tool, err);
  }
}

// ---------------------------------------------------------------------------
// 设置页：#/settings（不是工具，由外壳直接挂载）
// ---------------------------------------------------------------------------
function renderSettingsPage() {
  detachCurrent();
  closeSettings();
  els.title.textContent = '设置';
  els.desc.textContent = '快捷键、托盘行为与外观';
  clear(els.actions);
  clear(els.view);
  renderSidebar();

  const root = h('div', { class: 'tool-body' });
  els.view.append(root);
  settingsCleanup = mountSettings({ root, api: window.api });
}

/** 设置页是「每次进入重新建」的，离开时要清理；工具页则常驻不走这里 */
function closeSettings() {
  if (typeof settingsCleanup === 'function') {
    try {
      settingsCleanup();
    } catch (err) {
      console.warn('[app] 设置页清理报错', err);
    }
  }
  settingsCleanup = null;
}

// ---------------------------------------------------------------------------
// 路由：#/<tool-id>
// ---------------------------------------------------------------------------
function route() {
  const id = decodeURIComponent(location.hash.replace(/^#\/?/, '').trim());
  if (!id) {
    renderWelcome();
    renderSidebar();
    return;
  }

  if (id === SETTINGS_ROUTE) {
    renderSettingsPage();
    return;
  }

  const tool = findTool(tools, id);
  if (!tool) {
    detachCurrent();
    closeSettings();
    els.title.textContent = '未找到工具';
    els.desc.textContent = id;
    clear(els.actions);
    clear(els.view);
    renderSidebar();
    return;
  }

  if (tool.id !== activeToolId) mountTool(tool);
}

// ---------------------------------------------------------------------------
// 设置：恢复上次位置、记录最近使用
// 保存全部走 api.settings.*（防抖在主进程侧），这里不缓存整份设置，
// 谁写谁负责，避免内存里出现第二份真相。
// ---------------------------------------------------------------------------
function recordRoute(toolId) {
  // 输入类内容可能很大，路由记录只存 id，截断保护防手滑
  window.api.settings.update({ ui: { lastRoute: String(toolId).slice(0, 64) } });
}

async function restoreLastRoute() {
  // 显式带 hash 进来（搜索回车、测试注入）就尊重当前 hash
  if (location.hash && location.hash !== '#') return;
  try {
    const settings = await window.api.settings.get();
    const last = settings?.ui?.lastRoute;
    if (last && findTool(tools, last)) {
      location.hash = `#/${last}`;
    }
  } catch (err) {
    console.warn('[app] 恢复上次位置失败', err);
  }
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
async function boot() {
  validateTools(tools);

  els.search.addEventListener('input', (event) => {
    keyword = event.target.value;
    renderSidebar();
  });

  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      els.search.value = '';
      keyword = '';
      renderSidebar();
      els.search.blur();
    }
    if (event.key === 'Enter') {
      const first = filterTools(tools, keyword)[0];
      if (first) {
        els.search.blur();
        location.hash = `#/${first.id}`;
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      els.search.focus();
      els.search.select();
    }
  });

  // 全局快捷键唤出窗口时聚焦搜索框：唤出 → 打字 → 回车，三步直达工具
  if (window.api?.onSummoned) {
    window.api.onSummoned(() => {
      els.search.focus();
      els.search.select();
    });
  }

  // 设置入口：快捷键、托盘行为、主题都收在这一页
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      location.hash = `#/${SETTINGS_ROUTE}`;
    });
  }

  window.addEventListener('hashchange', route);
  route();
  restoreLastRoute();

  if (window.api?.info) {
    const info = await window.api.info();
    els.version.textContent = `v${info.version}`;
    // Electron 版走 electron/chrome 字段，Tauri 版走 tauri/webview 字段
    const full = info.electron
      ? `Electron ${info.electron} · Chrome ${String(info.chrome).split('.')[0]}`
      : `Tauri ${info.tauri} · WebView2 ${String(info.webview).split('.')[0]}`;
    // 侧边栏只有 246px，正文只放主版本号，完整信息挂在 tooltip 上
    els.footInfo.textContent = info.electron
      ? `Electron ${String(info.electron).split('.')[0]}`
      : `Tauri ${info.tauri}`;
    els.footInfo.title = full;
  }

  console.log(`app-ready tools=${tools.length}`);
}

boot().catch((err) => {
  console.error('[app] 启动失败', err);
  els.view.textContent = `启动失败：${err.message}`;
});

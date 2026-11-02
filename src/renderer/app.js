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
let cleanupCurrent = null;

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
// 工具挂载 / 卸载
// ---------------------------------------------------------------------------
function unmountCurrent() {
  if (typeof cleanupCurrent === 'function') {
    try {
      cleanupCurrent();
    } catch (err) {
      console.warn('[app] 工具清理函数报错', err);
    }
  }
  cleanupCurrent = null;
  clear(els.actions);
}

function renderWelcome() {
  activeToolId = null;
  unmountCurrent();
  els.title.textContent = '工具集';
  els.desc.textContent = '从左侧选择一个工具';
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
  activeToolId = tool.id;
  renderSidebar();
  recordRoute(tool.id);

  els.title.textContent = tool.name;
  els.desc.textContent = tool.desc || '';
  clear(els.actions);
  clear(els.view);

  const root = h('div', { class: 'tool-body' });
  els.view.append(root);

  try {
    const cleanup = tool.mount({ root, api: window.api, actions: els.actions, tool });
    cleanupCurrent = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    renderToolError(tool, err);
  }
}

// ---------------------------------------------------------------------------
// 设置页：#/settings（不是工具，由外壳直接挂载）
// ---------------------------------------------------------------------------
function renderSettingsPage() {
  activeToolId = null;
  unmountCurrent();
  els.title.textContent = '设置';
  els.desc.textContent = '快捷键、托盘行为与外观';
  clear(els.view);
  renderSidebar();

  const root = h('div', { class: 'tool-body' });
  els.view.append(root);
  cleanupCurrent = mountSettings({ root, api: window.api });
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
    unmountCurrent();
    els.title.textContent = '未找到工具';
    els.desc.textContent = id;
    clear(els.view);
    renderSidebar();
    return;
  }

  if (tool.id !== activeToolId) unmountCurrent();
  mountTool(tool);
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

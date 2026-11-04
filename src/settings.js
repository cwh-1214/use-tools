/**
 * 设置页（不是工具，由外壳直接挂载）。
 *
 * 能改的东西：
 *   - 关闭按钮 = 最小化到托盘 / 直接退出
 *   - 全局唤出快捷键（录制式修改，改失败自动回滚）
 *   - 主题
 * 只读信息：版本、运行时、设置文件目录。
 */

import { h } from './core/dom.js';
import { seg, statusBar } from './core/ui.js';

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

const THEMES = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
];

/** 把 KeyboardEvent 转成两端都能解析的 accelerator（Ctrl+Shift+Space） */
export function acceleratorFromEvent(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');

  const code = event.code || '';
  let key = '';
  if (code === 'Space') key = 'Space';
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(code)) key = code;
  else return null;

  // 功能键可单独用，其余必须带修饰键，否则会把正常打字抢走
  const isFunctionKey = key.startsWith('F');
  if (parts.length === 0 && !isFunctionKey) return null;
  return [...parts, key].join('+');
}

export function mountSettings({ root, api }) {
  let capturing = false;
  let hotkeyState = null;

  const status = statusBar(' ');
  // 没有消息时不占一行（这页绝大部分时间是静态的）
  status.el.style.display = 'none';
  const say = (kind, message) => {
    status.set(kind, message);
    status.el.style.display = message ? '' : 'none';
  };
  const themeSeg = seg(THEMES, 'system', (id) => applyTheme(id));

  const closeBox = h('input', {
    class: 'checkbox',
    type: 'checkbox',
    id: 'setting-close-to-tray',
    onChange: async (event) => {
      await api.settings.update({ ui: { closeToTray: event.target.checked } });
      say('ok', event.target.checked ? '关闭窗口时会收进托盘' : '关闭窗口时会直接退出');
    },
  });

  const hotkeyValue = h('code', { class: 'kbd' }, ['—']);
  const hotkeyBadge = h('span', { class: 'badge' }, ['']);

  const editBtn = h('button', { class: 'btn btn-sm', onClick: () => toggleCapture() }, ['修改']);
  const resetBtn = h('button', { class: 'btn btn-sm btn-ghost', onClick: () => applyHotkey(null) }, ['恢复默认']);

  const dataDirValue = h('code', { class: 'kbd kbd-wide' }, ['读取中…']);
  const openDirBtn = h(
    'button',
    {
      class: 'btn btn-sm btn-ghost',
      onClick: async () => {
        try {
          await api.app.openDataDir();
        } catch (err) {
          say('err', `打开目录失败：${err.message}`);
        }
      },
    },
    ['打开目录']
  );

  const runtimeValue = h('span', { class: 'sett-value' }, ['—']);

  // ------------------------------------------------------------ 快捷键
  function renderHotkey() {
    const label = hotkeyState?.label || hotkeyState?.accelerator || '未设置';
    hotkeyValue.textContent = label;

    if (!hotkeyState || !hotkeyState.accelerator) {
      hotkeyBadge.textContent = '当前环境不支持';
      hotkeyBadge.className = 'badge is-off';
      editBtn.disabled = true;
      resetBtn.disabled = true;
      return;
    }

    if (hotkeyState.available === false) {
      hotkeyBadge.textContent = '当前环境未启用';
      hotkeyBadge.className = 'badge is-off';
      editBtn.disabled = true;
      resetBtn.disabled = true;
      return;
    }

    hotkeyBadge.textContent = hotkeyState.registered ? '已生效' : '被占用，未生效';
    hotkeyBadge.className = `badge ${hotkeyState.registered ? 'is-ok' : 'is-warn'}`;
    editBtn.disabled = false;
    resetBtn.disabled = false;
  }

  function stopCapture() {
    if (!capturing) return;
    capturing = false;
    window.removeEventListener('keydown', onCaptureKey, true);
    editBtn.textContent = '修改';
    editBtn.classList.remove('btn-primary');
    resetBtn.disabled = false;
  }

  function onCaptureKey(event) {
    if (!capturing) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      stopCapture();
      say('', '已取消修改');
      return;
    }

    // 只按修饰键时先等着，等真正的键落下再结算
    if (MODIFIER_KEYS.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      hotkeyValue.textContent = [
        event.ctrlKey ? 'Ctrl' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
        event.metaKey ? 'Super' : '',
      ]
        .filter(Boolean)
        .join('+')
        .concat('+…');
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) {
      say('err', '需要带修饰键的组合，例如 Ctrl+Shift+K；功能键（F1–F12）可单独使用');
      return;
    }

    stopCapture();
    applyHotkey(accelerator);
  }

  function toggleCapture() {
    if (capturing) {
      stopCapture();
      say('', '已取消修改');
      return;
    }

    capturing = true;
    editBtn.textContent = '等待按键…';
    editBtn.classList.add('btn-primary');
    resetBtn.disabled = true;
    say('', '请按下新的组合键，Esc 取消');
    window.addEventListener('keydown', onCaptureKey, true);
  }

  async function applyHotkey(accelerator) {
    try {
      const result = accelerator
        ? await api.hotkey.set(accelerator)
        : await api.hotkey.reset();

      if (!result) {
        say('err', '当前环境不支持修改快捷键');
        return;
      }

      hotkeyState = {
        accelerator: result.accelerator,
        label: result.label,
        registered: result.registered,
      };
      renderHotkey();

      if (result.ok === false) {
        say('err', result.error || '这个组合不能用');
      } else {
        say('ok', `快捷键已改为 ${hotkeyState.label}`);
      }
    } catch (err) {
      say('err', `修改失败：${err.message}`);
    }
  }

  // ------------------------------------------------------------ 主题
  async function applyTheme(mode) {
    try {
      await api.theme.set(mode);
      say('ok', `主题：${THEMES.find((t) => t.id === mode)?.label || mode}`);
    } catch (err) {
      say('err', `切换主题失败：${err.message}`);
    }
  }

  // ------------------------------------------------------------ 组装
  const row = (label, ...children) =>
    h('div', { class: 'opt-row' }, [h('span', { class: 'opt-label' }, [label]), ...children]);

  root.append(
    h('div', { class: 'card opt-panel sett-panel' }, [
      h('div', { class: 'opt-group' }, [
        h('div', { class: 'opt-group-title' }, ['窗口']),
        row(
          '关闭按钮',
          h('label', { class: 'check-label', for: 'setting-close-to-tray' }, [
            closeBox,
            '最小化到托盘（不退出程序）',
          ])
        ),
      ]),
      h('div', { class: 'opt-group' }, [
        h('div', { class: 'opt-group-title' }, ['全局快捷键']),
        row('唤出窗口', hotkeyValue, hotkeyBadge, h('div', { class: 'spacer' }), editBtn, resetBtn),
        row('', h('span', { class: 'opt-note' }, ['点「修改」后按下组合键即可替换；带 Esc 取消，功能键可单独使用。'])),
      ]),
      h('div', { class: 'opt-group' }, [
        h('div', { class: 'opt-group-title' }, ['外观']),
        row('主题', themeSeg),
      ]),
      h('div', { class: 'opt-group' }, [
        h('div', { class: 'opt-group-title' }, ['关于']),
        row('版本', runtimeValue),
        row('数据目录', dataDirValue, h('div', { class: 'spacer' }), openDirBtn),
      ]),
    ]),
    status.el
  );

  // ------------------------------------------------------------ 初始化
  (async () => {
    try {
      const settings = await api.settings.get();
      closeBox.checked = settings?.ui?.closeToTray !== false;

      const theme = settings?.ui?.theme || 'system';
      for (const btn of themeSeg.querySelectorAll('button')) {
        btn.classList.toggle('is-on', btn.dataset.id === theme);
      }

      if (api.info) {
        const info = await api.info();
        const runtime = `v${info.version} · Tauri ${info.tauri}`;
        runtimeValue.textContent = runtime;
      }

      if (api.app?.dataDir) {
        const dir = await api.app.dataDir();
        dataDirValue.textContent = dir || '未知';
      } else {
        dataDirValue.textContent = '当前环境不支持';
      }

      if (api.hotkey?.get) {
        hotkeyState = await api.hotkey.get();
      }
      renderHotkey();
    } catch (err) {
      say('err', `读取设置失败：${err.message}`);
    }
  })();

  // 托盘菜单里改了设置时同步过来
  const offSettings = api.onSettingsChanged
    ? api.onSettingsChanged(async () => {
        try {
          const settings = await api.settings.get();
          closeBox.checked = settings?.ui?.closeToTray !== false;
        } catch {
          /* 忽略 */
        }
      })
    : () => {};

  return () => {
    stopCapture();
    offSettings();
  };
}

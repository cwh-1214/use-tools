'use strict';

/**
 * 托盘 + 全局快捷键：让这个应用可以「随时唤出、随手收起」。
 *
 * 设计决定：
 * - 默认快捷键 Ctrl+Shift+Space（CommandOrControl 兼容 mac）。Alt+Space 是 Windows
 *   系统菜单，F1 类功能键常被输入法占用，都避开。
 * - 快捷键存在 settings.json 的 ui.hotkey 里，设置页可以改；改成占用中的组合会
 *   自动回滚到上一个，避免「改完连唤出都没了」。
 * - 注册失败（被别的软件占了）不致命：托盘菜单里明确写出「不可用」，不静默。
 * - 主窗口的「关闭」按钮默认 = 隐藏到托盘。担心找不到的人，设置页/托盘菜单里都
 *   有开关可以改成「关闭即退出」，两种习惯都照顾到。
 */

const { Tray, Menu, MenuItem, nativeImage, globalShortcut } = require('electron');
const path = require('node:path');

const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';

let tray = null;
let controller = null;

/** Electron 的 accelerator 里 Ctrl / Control / CommandOrControl 都表示同一个键，统一成显示用的写法 */
function labelOf(accelerator) {
  return String(accelerator || DEFAULT_HOTKEY)
    .replace(/CommandOrControl|CmdOrCtrl|Control/gi, 'Ctrl')
    .replace(/\s*\+\s*/g, '+');
}

function createTray({ getWindow, showWindow, toggleWindow, quit }) {
  // nativeImage 能读 asar 内路径，打包后同样有效
  const image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));

  tray = new Tray(image);
  tray.setToolTip('工具集');

  // 当前真正注册上的 accelerator（可能与设置里的不同：注册失败时为 null）
  let registered = null;

  function store() {
    return require('./store');
  }

  function storedAccelerator() {
    const value = store().get().ui.hotkey;
    return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_HOTKEY;
  }

  function hotkeyState() {
    const accelerator = registered || storedAccelerator();
    return {
      accelerator,
      label: labelOf(accelerator),
      registered: Boolean(registered),
    };
  }

  function rebuildMenu() {
    const settings = store().get();
    const { label, registered: ok } = hotkeyState();

    const menu = Menu.buildFromTemplate([
      {
        label: `显示主窗口${ok ? `\t${label}` : ''}`,
        click: () => showWindow(),
      },
      { type: 'separator' },
      {
        label: '关闭窗口时最小化到托盘',
        type: 'checkbox',
        checked: settings.ui.closeToTray !== false,
        click: (item) => {
          store().update({ ui: { closeToTray: item.checked } });
          notifySettingsChanged();
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => quit(),
      },
    ]);

    if (!ok) {
      menu.insert(
        1,
        new MenuItem({
          label: `全局快捷键 ${label} 被占用，已停用`,
          enabled: false,
        })
      );
    }

    tray.setContextMenu(menu);
    tray.setToolTip(ok ? `工具集 · ${label} 唤出` : '工具集');
  }

  /** 托盘菜单改了设置，通知正在打开的设置页刷新（没有窗口时静默忽略） */
  function notifySettingsChanged() {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('settings:changed');
  }

  function tryRegister(accelerator) {
    try {
      return globalShortcut.register(accelerator, () => toggleWindow());
    } catch (err) {
      console.warn('[tray] 快捷键注册异常', err.message);
      return false;
    }
  }

  /** 启动时按设置注册一次 */
  function registerHotkey() {
    const accelerator = storedAccelerator();
    const ok = tryRegister(accelerator);
    if (!ok) {
      console.warn(`[tray] 快捷键 ${accelerator} 注册失败（可能被其他软件占用）`);
    }
    registered = ok ? accelerator : null;
    rebuildMenu();
    return ok;
  }

  /**
   * 设置页改快捷键：先注销旧的，注册新的；失败就回滚。
   * 返回 { ok, accelerator, label, registered, error? }
   */
  function setHotkey(next) {
    const accelerator = String(next || '').trim();
    if (!accelerator) {
      return { ok: false, error: '快捷键不能为空', ...hotkeyState() };
    }

    const previous = registered || storedAccelerator();
    if (registered) {
      try {
        globalShortcut.unregister(registered);
      } catch {
        /* 已注销的情况忽略 */
      }
      registered = null;
    }

    if (tryRegister(accelerator)) {
      registered = accelerator;
      store().update({ ui: { hotkey: accelerator } });
      rebuildMenu();
      notifySettingsChanged();
      return { ok: true, ...hotkeyState() };
    }

    // 回滚到上一个可用的键位
    const restored = tryRegister(previous);
    registered = restored ? previous : null;
    rebuildMenu();
    return {
      ok: false,
      error: `${labelOf(accelerator)} 被其它软件占用或不被支持`,
      ...hotkeyState(),
    };
  }

  function resetHotkey() {
    return setHotkey(DEFAULT_HOTKEY);
  }

  controller = {
    hotkeyState,
    setHotkey,
    resetHotkey,
    registerHotkey,
    rebuildMenu,
    destroy: () => {
      if (registered) globalShortcut.unregister(registered);
      registered = null;
      if (tray) tray.destroy();
      tray = null;
      controller = null;
    },
  };

  return controller;
}

/** 供 ipc 层取到当前的托盘控制器（未启用托盘时为 null） */
function getTray() {
  return controller;
}

module.exports = { createTray, getTray, DEFAULT_HOTKEY, labelOf };

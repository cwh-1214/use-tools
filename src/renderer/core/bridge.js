/**
 * 平台桥：把 window.api 补齐。
 *
 * Electron 下 preload 已经注入好了，这里什么都不做；
 * Tauri 下没有 preload，就用 invoke 还原一套完全同签名的方法，
 * 于是 tools/ 里的代码（以及 app.js）无需任何改动。
 *
 * 注意：本文件必须在 app.js 之前加载（同为 module，执行顺序有保证）。
 */

function createTauriApi(invoke, listen) {
  const call = (command, args) => invoke(command, args);

  return {
    pickFile: (options) =>
      call('pick_file', { args: { title: options?.title, filters: options?.filters } }),

    saveText: (options) =>
      call('save_text', {
        args: {
          title: options?.title,
          defaultName: options?.defaultName,
          content: options?.content,
        },
      }),

    saveFile: (options) =>
      call('save_file', {
        args: {
          title: options?.title,
          defaultName: options?.defaultName,
          dataBase64: options?.dataBase64,
        },
      }),

    readText: (filePath, options) =>
      call('read_text', { args: { path: filePath, encoding: options?.encoding } }),

    basename: (filePath) => call('basename', { path: filePath }),

    stat: (filePath) => call('stat', { path: filePath }),

    scanColumn: (options) =>
      call('scan_column', {
        args: {
          filePath: options.filePath,
          delimiter: options.delimiter ?? '\t',
          columnIndex: options.columnIndex ?? 0,
          encoding: options.encoding ?? 'utf-8',
          trim: options.trim !== false,
        },
      }),

    scanColumnText: (options) =>
      call('scan_column_text', {
        args: {
          text: options.text,
          delimiter: options.delimiter ?? '\t',
          columnIndex: options.columnIndex ?? 0,
          trim: options.trim !== false,
        },
      }),

    showItemInFolder: (filePath) => call('show_item_in_folder', { path: filePath }),

    clipboard: {
      readText: () => call('clipboard_read_text'),
      writeText: (text) => call('clipboard_write_text', { text: String(text ?? '') }),
    },

    settings: {
      get: () => call('settings_get'),
      update: (patch) => call('settings_update', { patch }),
      patchTool: (toolId, partial) =>
        call('settings_patch_tool', { args: { toolId, partial } }),
    },

    theme: {
      set: (mode) => call('theme_set', { mode }),
    },

    // 设置页：全局快捷键与数据目录
    hotkey: {
      get: () => call('hotkey_state'),
      set: (accelerator) => call('set_hotkey', { accelerator: String(accelerator ?? '') }),
      reset: () => call('set_hotkey', { accelerator: 'Ctrl+Shift+Space' }),
    },

    app: {
      dataDir: () => call('data_dir'),
      openDataDir: () => call('open_data_dir'),
    },

    info: () => call('app_info'),

    // Tauri 侧目前没有从托盘反向通知设置页的通道，留空实现保证调用方不用分支
    onSettingsChanged: () => () => {},

    // 与 Electron 的 process.platform 对齐，工具里若按平台分支不会踩空
    platform: navigator.userAgent.includes('Windows')
      ? 'win32'
      : navigator.userAgent.includes('Mac')
        ? 'darwin'
        : 'linux',

    // 全局快捷键唤出窗口时，主进程推这个事件；外壳用来聚焦搜索框
    onSummoned: (callback) => {
      if (!listen) return () => {};
      let unlisten = null;
      let disposed = false;

      listen('app:summoned', () => callback()).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

      return () => {
        disposed = true;
        if (unlisten) unlisten();
      };
    },
  };
}

if (!window.api) {
  const tauri = window.__TAURI__;
  if (tauri?.core?.invoke) {
    window.api = createTauriApi(tauri.core.invoke, tauri.event?.listen);
  } else {
    console.warn('[bridge] 未检测到 Electron preload 或 Tauri runtime，系统能力不可用');
    // 兜底：让工具至少能渲染出来，点了不至于抛 TypeError
    window.api = {
      clipboard: { readText: async () => '', writeText: async () => {} },
      settings: {
        get: async () => ({}),
        update: async () => ({}),
        patchTool: async () => ({}),
      },
      theme: { set: async () => ({}) },
      info: async () => ({ version: '0.0.0' }),
      hotkey: { get: async () => ({ accelerator: '', registered: false }), set: async () => ({ ok: false }), reset: async () => ({ ok: false }) },
      app: { dataDir: async () => '', openDataDir: async () => {} },
      onSettingsChanged: () => () => {},
      onSummoned: () => () => {},
    };
  }
}

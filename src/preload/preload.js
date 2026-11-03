'use strict';

/**
 * 预加载脚本：在上下文隔离下，把最小必要能力挂到 window.api。
 * 渲染进程里只能看到这里显式暴露的方法，拿不到 require / process。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFile: (options) => ipcRenderer.invoke('dialog:pickFile', options),
  saveText: (options) => ipcRenderer.invoke('dialog:saveText', options),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  readText: (filePath, options) => ipcRenderer.invoke('fs:readText', filePath, options),
  basename: (filePath) => ipcRenderer.invoke('fs:basename', filePath),
  stat: (filePath) => ipcRenderer.invoke('fs:stat', filePath),
  scanColumn: (options) => ipcRenderer.invoke('file:scanColumn', options),
  scanColumnText: (options) => ipcRenderer.invoke('text:scanColumn', options),
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItemInFolder', filePath),

  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  },

  // 设置：读一次，之后用 patch 局部更新；工具配置走 patchTool 独占自己的命名空间
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    patchTool: (toolId, partial) => ipcRenderer.invoke('settings:patchTool', toolId, partial),
  },

  theme: {
    set: (mode) => ipcRenderer.invoke('theme:set', mode),
  },

  // 设置页用：全局快捷键与数据目录
  hotkey: {
    get: () => ipcRenderer.invoke('app:hotkey.get'),
    set: (accelerator) => ipcRenderer.invoke('app:hotkey.set', accelerator),
    reset: () => ipcRenderer.invoke('app:hotkey.reset'),
  },

  app: {
    dataDir: () => ipcRenderer.invoke('app:dataDir'),
    openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  },

  info: () => ipcRenderer.invoke('app:info'),
  platform: process.platform,

  // 托盘菜单改了设置（比如关了「最小化到托盘」）时通知设置页刷新
  onSettingsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },

  // 全局快捷键唤出窗口时，主进程会推这个事件；外壳用来聚焦搜索框
  onSummoned: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:summoned', listener);
    return () => ipcRenderer.removeListener('app:summoned', listener);
  },
});

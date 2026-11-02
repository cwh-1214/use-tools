'use strict';

/**
 * 设置持久化：一个 JSON 文件，存在 userData 下。
 *
 * 为什么不用 electron-store 之类的库：这里的需求只是「读一次、改很多次、落盘一次」，
 * 一百行以内就能写完，而且行为完全可见 —— 出了问题是 JSON 里少个键，不是黑盒。
 *
 * 写入策略：合并到内存 → 300ms 防抖 → 写临时文件 → rename。
 * rename 在同一分区上是原子的，因此不会出现「写到一半断电，设置文件变成半截 JSON」。
 */

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const WRITE_DELAY = 300;

function defaults() {
  return {
    schema: 1,
    // 首次启动不写尺寸，交给 BrowserWindow 的默认值（避免用物理像素覆盖逻辑尺寸）
    window: { width: null, height: null, x: null, y: null, maximized: false },
    ui: { lastRoute: '', recent: [], theme: 'system', closeToTray: true, hotkey: 'Ctrl+Shift+Space' },
    tools: {},
    flags: {},
  };
}

let filePath = null;
let data = null;
let timer = null;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 深合并：对象逐键合并，数组与标量直接替换。工具配置的局部更新依赖这个语义 */
function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = merge(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function resolvePath() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'settings.json');
  return filePath;
}

function load() {
  const target = resolvePath();
  const base = defaults();

  let raw;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[store] 读取设置失败，使用默认值', err.message);
    data = base;
    return data;
  }

  try {
    const parsed = JSON.parse(raw);
    data = merge(base, parsed);
  } catch {
    // 文件损坏时留个备份，不要把用户的设置直接抹掉
    try {
      fs.renameSync(target, `${target}.corrupt-${Date.now()}`);
    } catch {
      /* 备份失败也不该阻止启动 */
    }
    console.warn('[store] 设置文件不是合法 JSON，已备份并回退默认值');
    data = base;
  }
  return data;
}

function writeNow() {
  const target = resolvePath();
  const tmp = `${target}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.warn('[store] 写入设置失败', err.message);
  }
}

function scheduleWrite() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    writeNow();
  }, WRITE_DELAY);
  // 不要让这个定时器阻止进程退出
  if (typeof timer.unref === 'function') timer.unref();
}

/** 返回深拷贝，调用方随便改都不会污染内存里的状态 */
function get() {
  if (!data) load();
  return JSON.parse(JSON.stringify(data));
}

function update(patch) {
  if (!data) load();
  data = merge(data, patch);
  scheduleWrite();
  return JSON.parse(JSON.stringify(data));
}

/** 退出前调用，把防抖窗口里还没落盘的改动写下去 */
function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (data) writeNow();
}

module.exports = { get, update, flush, load };

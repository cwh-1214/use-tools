/**
 * 极简 DOM 构建器，替代框架的模板层。
 * h('div', { class: 'x', onClick: fn }, ['文本', 子元素])
 */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      el.className = value;
    } else if (key === 'text') {
      el.textContent = value;
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') {
      el.value = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }

  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** 防抖：用于「输入即转换」的场景，避免每次按键都重算 */
export function debounce(fn, wait = 120) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 字节数格式化，工具里统计体积时常用 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

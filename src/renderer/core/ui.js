/**
 * 工具页共用的小组件。
 *
 * 五个工具的界面骨架统一成：
 *
 *   toolbar(左：模式与参数, 右：内容快捷操作)
 *   内容区（.split 文本域 / .input-grid 单行输入 / 文件槽位）
 *   status
 *   hint（一句话）
 *
 * 这里只放「长得一样、行为也一样」的东西；只要有一处需要不一样，
 * 就让调用方传参，而不是各工具自己再抄一份。
 */

import { h } from './dom.js';

/**
 * 分段控件。
 * @param {{id:string,label:string,hint?:string}[]} options
 * @param {string} current 当前选中 id
 * @param {(id:string)=>void} onPick
 */
export function seg(options, current, onPick, className = 'seg') {
  const buttons = options.map((option) =>
    h(
      'button',
      {
        class: option.id === current ? 'is-on' : '',
        dataset: { id: option.id },
        // 短标签放正文，完整解释放悬浮
        title: option.hint || option.label,
        onClick: () => {
          for (const btn of buttons) btn.classList.toggle('is-on', btn.dataset.id === option.id);
          onPick(option.id);
        },
      },
      [option.label]
    )
  );
  return h('div', { class: className }, buttons);
}

/** 外部改了状态时（比如恢复配置），同步分段控件的选中态 */
export function setSegValue(segEl, value) {
  for (const btn of segEl.querySelectorAll('button')) {
    btn.classList.toggle('is-on', btn.dataset.id === value);
  }
}

/**
 * 工具页顶部工具栏：左边模式与参数，右边内容快捷操作（示例 / 清空 / 重跑）。
 * 中间自动补一个 spacer，空数组不会留下多余间距。
 */
export function toolbar(left = [], right = []) {
  const l = left.filter(Boolean);
  const r = right.filter(Boolean);
  const children = [...l];
  if (l.length && r.length) children.push(h('div', { class: 'spacer' }));
  children.push(...r);
  return h('div', { class: 'toolbar' }, children);
}

/**
 * 带标签的字段。tools 放标签行右侧（字符数、复制按钮等），
 * 传单个节点或数组都行。
 */
export function field(label, control, tools) {
  const right = (Array.isArray(tools) ? tools : [tools]).filter(Boolean);
  const labelRow = h('div', { class: 'field-label' }, [
    h('span', {}, [label]),
    right.length ? h('div', { class: 'field-tools' }, right) : null,
  ]);
  return h('div', { class: 'field' }, [labelRow, control]);
}

/** 状态行：返回 { el, set(kind, text) }，kind 为 '' | 'ok' | 'err' */
export function statusBar(initial = '—') {
  const text = h('span', { class: 'status-text' }, [initial]);
  const el = h('div', { class: 'status' }, [h('span', { class: 'dot' }), text]);
  return {
    el,
    set(kind, message) {
      el.className = `status${kind ? ` is-${kind}` : ''}`;
      text.textContent = message;
    },
  };
}

/**
 * 复制按钮：统一「已复制」反馈，避免每个工具各写一遍 setTimeout。
 * @param {() => string} getText 点击时取要复制的内容
 * @param {(text:string)=>Promise<void>} write 实际写剪贴板的函数
 */
export function copyButton(getText, write, { label = '复制', done = '已复制', className = 'btn btn-sm' } = {}) {
  const btn = h(
    'button',
    {
      class: className,
      onClick: async () => {
        const text = getText();
        if (!text) return;
        await write(text);
        const original = btn.textContent;
        btn.textContent = done;
        setTimeout(() => (btn.textContent = original), 1200);
      },
    },
    [label]
  );
  return btn;
}

/** 页面底部的一句话说明 */
export function hintLine(text) {
  return h('p', { class: 'hint' }, [text]);
}

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
 * 只有确实需要解释的选项才给 hint（目前只有 SQL IN 的「自动」），其余不挂提示。
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
        dataset: option.hint ? { id: option.id, tip: option.hint } : { id: option.id },
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
 * 带「就地编辑」项的分段控件。
 *
 * 与 seg 只差一点：id === editable 的那一项，点击后把按钮原地换成输入框，
 * 输完失焦或回车再变回按钮——不再需要在控件旁边额外占一个「自定义分隔符」输入框。
 * 按钮上显示已填的值（为空则显示原标签），所以收起后也能看出当前用的什么。
 *
 * 宽度由 config.width 固定给按钮和输入框，两者一致，切换时不会抽动整条控件。
 *
 * @param {{id:string,label:string,hint?:string}[]} options
 * @param {string} current 当前选中 id
 * @param {object} config
 * @param {string} config.editable 可编辑项的 id
 * @param {string} [config.value] 可编辑项的初始值
 * @param {string} [config.placeholder]
 * @param {(id:string)=>void} [config.onPick]
 * @param {(value:string)=>void} [config.onInput]
 * @param {string} [config.className]
 */
export function editableSeg(options, current, config = {}) {
  const {
    editable,
    value = '',
    placeholder = '',
    onPick,
    onInput,
    className = 'seg',
  } = config;

  const segEl = h('div', { class: className });
  const nodes = new Map();
  let active = current;
  let shown = String(value ?? '');
  let before = shown; // 进入编辑前的值，Esc 时还原
  let editingInput = null; // 当前正在编辑的输入框，点其它项时用它主动收起

  const optionOf = (id) => options.find((option) => option.id === id);
  const labelOf = (option) => (option.id === editable && shown.trim() ? shown : option.label);

  function setActive(id) {
    active = id;
    for (const [key, node] of nodes) {
      if (node.tagName === 'BUTTON') node.classList.toggle('is-on', key === id);
    }
  }

  function makeButton(option) {
    const isEdit = option.id === editable;
    const button = h(
      'button',
      {
        class: [option.id === active ? 'is-on' : '', isEdit ? 'seg-edit' : '']
          .filter(Boolean)
          .join(' '),
        dataset: option.hint ? { id: option.id, tip: option.hint } : { id: option.id },
        onClick: () => {
          closeEditor(editingInput); // 点别的选项时，正在编辑的自定义项先收起
          setActive(option.id);
          onPick?.(option.id);
          if (option.id === editable) openEditor();
        },
      },
      [labelOf(option)]
    );
    // 宽度在样式里按字数算（见 .seg button.seg-edit），这里不再写死像素
    return button;
  }

  function openEditor() {
    const button = nodes.get(editable);
    if (!button || button.tagName !== 'BUTTON') return;

    before = shown;
    const input = h('input', {
      class: 'seg-input',
      value: shown,
      placeholder,
      spellcheck: 'false',
      dataset: { tip: '回车或点别处确认，Esc 取消' },
      onInput: (event) => {
        shown = event.target.value;
        onInput?.(shown);
      },
      // 回车 / Esc 直接同步收起，不依赖 blur：窗口没前台激活时 blur 事件不派发，
      // 只靠 onBlur 会让输入框卡在编辑态
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          closeEditor(input);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          shown = before;
          onInput?.(shown);
          closeEditor(input);
        }
      },
      onBlur: () => closeEditor(input),
    });

    button.replaceWith(input);
    nodes.set(editable, input);
    editingInput = input;
    input.focus();
    input.select();
  }

  function closeEditor(input) {
    if (!input || !input.isConnected) return; // 已经收起过（Enter 之后又来了 blur）
    if (editingInput === input) editingInput = null;
    const button = makeButton(optionOf(editable));
    input.replaceWith(button);
    nodes.set(editable, button);
  }

  for (const option of options) {
    const node = makeButton(option);
    nodes.set(option.id, node);
    segEl.append(node);
  }

  // 恢复历史配置时用：既改按钮上显示的值，也改正在编辑的输入框
  segEl.__setEditValue = (next) => {
    shown = String(next ?? '');
    const node = nodes.get(editable);
    if (!node) return;
    if (node.tagName === 'INPUT') {
      node.value = shown;
    } else {
      node.textContent = labelOf(optionOf(editable));
    }
  };

  return segEl;
}

/** 同步可编辑项的值；对普通 seg 调它不会有任何副作用 */
export function setSegEditValue(segEl, value) {
  if (typeof segEl?.__setEditValue === 'function') segEl.__setEditValue(value);
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

/**
 * 新工具模板。
 *
 * 用法：
 *   1. 复制整个 _template 文件夹，改名为你的工具 id（小写、短横线分隔）
 *   2. 改下面对象里的 id / name / desc / icon / group / keywords
 *   3. 在 mount 里写你的界面和逻辑
 *   4. 到 ../index.js 里 import 并加进 tools 数组
 *
 * 约定：
 *   - id 必须全局唯一，且和文件夹名一致，它同时是路由（#/<id>）
 *   - mount 收到 { root, api, actions }
 *       root    工具内容容器，往里 append 你的 DOM
 *       api     系统能力（文件选择、剪贴板、读取文件…），见 src/preload/preload.js
 *       actions 右上角按钮区，适合放「导入 / 导出」这类全局动作
 *   - mount 可以返回一个清理函数（清定时器、移除全局监听），
 *     切换工具时会被调用；不返回也不影响
 *   - 没有 _template 前缀的工具不会被加载，这里纯粹是给复制用的
 */

import { h } from '../../core/dom.js';

export default {
  id: 'my-tool',
  name: '我的工具',
  desc: '一句话说明这个工具能干什么',
  icon: 'MT',
  group: '其他',
  keywords: ['demo'],

  mount({ root, api, actions }) {
    const input = h('input', { class: 'input', placeholder: '输入点什么' });
    const output = h('div', { class: 'hint' }, ['结果：—']);

    input.addEventListener('input', () => {
      output.textContent = `结果：${input.value || '—'}`;
    });

    root.append(
      h('div', { class: 'field' }, [
        h('div', { class: 'field-label' }, [h('span', {}, ['输入'])]),
        input,
      ]),
      output
    );

    input.focus();

    return () => {
      // 清理逻辑写在这里（可选）
    };
  },
};

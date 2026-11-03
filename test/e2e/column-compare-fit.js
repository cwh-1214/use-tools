// 端到端场景：列比对在「数据量大」时的页面高度
// 目的：两个文件都就位后，整页不能出现纵向滚动条——高度分给结果列表，由列表内部滚动。
// fixtures：caseA = DIP000..399，caseB = DIP020..419，共 400 行、20 条差异。

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];

  const assert = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      console.log(`  ok   ${label}`);
    } else {
      failures.push(`${label}: 期望 ${e}，实际 ${a}`);
      console.log(`  FAIL ${label}: 期望 ${e}，实际 ${a}`);
    }
  };

  location.hash = '#/column-compare';
  await sleep(500);

  const slots = Array.from(document.querySelectorAll('.file-slot'));
  const pickBtn = (slot) =>
    Array.from(slot.querySelectorAll('button')).find((b) => b.textContent.includes('选择文件'));

  pickBtn(slots[0]).click();
  await sleep(500);
  pickBtn(slots[1]).click();
  await sleep(1800); // 自动比对（防抖 320ms + 两个文件扫描）

  const stats = () => Array.from(document.querySelectorAll('.stat-num')).map((el) => el.textContent);
  assert('统计卡与预期一致', stats(), ['400', '400', '20', '20', '380', '420']);

  const view = document.getElementById('tool-view');
  const list = document.querySelector('.data-list');
  const hint = document.querySelector('.tool-body > .hint');

  assert('列表已渲染', Boolean(list), true);
  assert('整页没有纵向滚动条', view.scrollHeight <= view.clientHeight + 1, true);
  assert('列表自身可滚动（高度受视口约束）', list.scrollHeight > list.clientHeight, true);
  assert('列表至少保留两行高度', list.clientHeight >= 60, true);

  const listBox = list.getBoundingClientRect();
  const hintBox = hint.getBoundingClientRect();
  assert('底部说明排在列表下方、没有压住列表', hintBox.top >= listBox.bottom - 1, true);
  assert('列表底部不超出可视区域', listBox.bottom <= view.getBoundingClientRect().bottom, true);

  if (failures.length > 0) {
    throw new Error(`${failures.length} 项断言失败：${failures.join(' | ')}`);
  }

  return { ok: true, assertions: 8 };
})();

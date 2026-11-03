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

  // ---------------- 展示行数：默认 100，改小只影响列表 ----------------
  const rows = () => Array.from(document.querySelectorAll('.data-list .row')).map((el) => el.textContent);
  const limitInput = document.querySelector('input[data-role="display-limit"]');
  assert('展示行数输入框存在', Boolean(limitInput), true);
  assert('展示行数默认 100', limitInput.value, '100');

  limitInput.value = '5';
  limitInput.dispatchEvent(new Event('input'));
  await sleep(250);

  assert('改成 5 后列表只渲染 5 行', rows().length, 5);
  const note = document.querySelector('.data-list .list-empty')?.textContent || '';
  assert('截断提示说明总数与展示条数', note.includes('共 20 条') && note.includes('仅显示前 5 条'), true);
  assert('改展示行数不影响统计结果', stats(), ['400', '400', '20', '20', '380', '420']);

  limitInput.value = '100';
  limitInput.dispatchEvent(new Event('input'));
  await sleep(250);
  assert('恢复 100 后 20 行全部展示', rows().length, 20);
  assert('不再出现截断提示', Boolean(document.querySelector('.data-list .list-empty')), false);

  // 等防抖落盘，避免把测试用过的 5 留在用户配置里
  await sleep(700);

  // ---------------- 矮窗口：卡片保持原样，列表压到最小，内容不许互相压住 ----------------
  window.resizeTo(1180, 620);
  await sleep(700);

  const statsEl = document.querySelector('.stats');
  assert('矮窗口统计卡仍是卡片', getComputedStyle(statsEl).display, 'grid');
  assert('矮窗口底部说明仍在', getComputedStyle(hint).display, 'block');
  assert('矮窗口列表仍保留可读高度', list.clientHeight >= 60, true);
  assert(
    '矮窗口说明文字不压住列表',
    hint.getBoundingClientRect().top >= list.getBoundingClientRect().bottom - 1,
    true
  );
  console.log('SHORT ' + JSON.stringify({
    inner: window.innerHeight,
    viewScroll: view.scrollHeight,
    viewClient: view.clientHeight,
    listH: list.clientHeight,
  }));

  // ---------------- 大窗口（全屏）：列表最高 330，整页仍然不滚 ----------------
  window.resizeTo(1600, 890);
  await sleep(700);
  assert('大窗口没有整页滚动条', view.scrollHeight <= view.clientHeight + 1, true);
  assert('大窗口列表不超过 330px', list.clientHeight <= 330, true);
  assert('大窗口列表明显变高', list.clientHeight > 200, true);

  if (failures.length > 0) {
    throw new Error(`${failures.length} 项断言失败：${failures.join(' | ')}`);
  }

  return { ok: true, assertions: 21 };
})();

// 端到端场景：列比对读 xlsx（按单元格取列，忽略分隔符与编码）
// fixtures：column-compare-xlsx/a.xlsx = 用户ID/u1001/u1002/u1003
//           column-compare-xlsx/b.xlsx = 用户ID/u1001/u1003/u1004
// 由 scripts/e2e.js 交给 Tauri 冒烟钩子执行，配合 USE_TOOLS_FIXTURE_QUEUE 免去文件选择框。

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

  const stats = () => Array.from(document.querySelectorAll('.stat-num')).map((el) => el.textContent);
  const tabCounts = () => Array.from(document.querySelectorAll('.tab-count')).map((el) => el.textContent);
  const rows = () => Array.from(document.querySelectorAll('.data-list .row')).map((el) => el.textContent);

  location.hash = '#/column-compare';
  await sleep(500);

  // ---------------- 编码选项：默认「自动」，并保留 ANSI 说法 ----------------
  const encodingLabels = Array.from(document.querySelectorAll('.opt-row .seg'))
    .map((seg) => Array.from(seg.querySelectorAll('button')).map((b) => b.textContent))
    .find((labels) => labels.includes('UTF-8'));
  assert('编码选项含 自动/UTF-8/ANSI', encodingLabels, ['自动', 'UTF-8', 'ANSI']);

  const activeEncoding = Array.from(document.querySelectorAll('.opt-row .seg button.is-on'))
    .map((b) => b.textContent)
    .find((label) => ['自动', 'UTF-8', 'ANSI'].includes(label));
  assert('编码默认选自动', activeEncoding, '自动');

  // 默认窗口宽度下（面板约 797px），「分隔符」与「取第几列」应落在同一行
  const itemByLabel = (text) =>
    Array.from(document.querySelectorAll('.opt-item')).find(
      (item) => item.querySelector('.opt-label')?.textContent === text
    );
  const centerY = (el) => {
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  };
  const delimItem = itemByLabel('分隔符');
  const columnItem = itemByLabel('取第几列');
  assert('分隔符与取第几列都存在', Boolean(delimItem && columnItem), true);
  assert(
    '分隔符与取第几列在同一行',
    Math.abs(centerY(delimItem) - centerY(columnItem)) < 12,
    true
  );

  // ---------------- 选两个 xlsx 文件 ----------------
  const slots = Array.from(document.querySelectorAll('.file-slot'));
  const pickBtn = (slot) =>
    Array.from(slot.querySelectorAll('button')).find((b) => b.textContent.includes('选择文件'));

  pickBtn(slots[0]).click();
  await sleep(450);
  pickBtn(slots[1]).click();
  await sleep(1400); // 读表格 + 防抖 + IPC

  assert('A 侧文件名是 a.xlsx', /a\.xlsx/.test(slots[0].textContent), true);
  assert('B 侧文件名是 b.xlsx', /b\.xlsx/.test(slots[1].textContent), true);
  assert('文件行标注为表格', /表格/.test(slots[0].querySelector('.hint')?.textContent || ''), true);
  assert('表格行数被读出', /4 行/.test(slots[0].querySelector('.hint')?.textContent || ''), true);

  // ---------------- 比对结果 ----------------
  assert('统计卡（A=4,B=4,A独有1,B独有1,共有3,合并5）', stats(), ['4', '4', '1', '1', '3', '5']);
  assert('标签页计数', tabCounts(), ['1', '1', '3', '5']);
  assert('A 独有值', rows(), ['u1002']);

  Array.from(document.querySelectorAll('.tab'))[1].click();
  await sleep(250);
  assert('B 独有值', rows(), ['u1004']);

  Array.from(document.querySelectorAll('.tab'))[2].click();
  await sleep(250);
  assert('共有值', rows(), ['用户ID', 'u1001', 'u1003']);

  // ---------------- 改列号：第 2 列在表格里不存在，应全部计入列数不足 ----------------
  const columnInput = document.querySelector('input[data-role="column"]');
  assert('列号输入框存在', Boolean(columnInput), true);
  columnInput.value = '2';
  columnInput.dispatchEvent(new Event('input'));
  await sleep(1200);
  assert('第 2 列无值时统计归零', stats(), ['0', '0', '0', '0', '0', '0']);

  columnInput.value = '1';
  columnInput.dispatchEvent(new Event('input'));
  await sleep(1200);
  assert('改回第 1 列恢复结果', stats(), ['4', '4', '1', '1', '3', '5']);

  if (failures.length) {
    console.log(`\n失败 ${failures.length} 条`);
    throw new Error(failures.join(' | '));
  }
  console.log('\nxlsx 场景全部通过');
  return { ok: true };
})();

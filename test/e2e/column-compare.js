// 端到端场景：列比对（文件模式 → 粘贴模式 → 剪贴板粘贴）
// 由 scripts/e2e.js 交给 Tauri 冒烟钩子执行，配合 USE_TOOLS_FIXTURE_QUEUE 免去文件选择框。
// fixtures：caseA = DIP001/002/003/005/010，caseB = DIP001/002/004/005/011

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
  const statusText = () => document.querySelector('.status-text')?.textContent || '';
  const statusClass = () => document.querySelector('.status')?.className || '';

  // ---------------- 阶段 1：两个文件，自动比对 ----------------
  location.hash = '#/column-compare';
  await sleep(500);

  const slots = Array.from(document.querySelectorAll('.file-slot'));
  assert('数据源槽位数量', slots.length, 2);
  assert('默认是文件模式', Boolean(slots[0].querySelector('.file-empty')), true);

  const pickBtn = (slot) =>
    Array.from(slot.querySelectorAll('button')).find((b) => b.textContent.includes('选择文件'));

  assert('A 侧有选择文件按钮', Boolean(pickBtn(slots[0])), true);
  pickBtn(slots[0]).click();
  await sleep(450);
  pickBtn(slots[1]).click();
  await sleep(1100); // 自动比对（防抖 320ms + IPC）

  assert('文件模式统计卡（A/B/A独有/B独有/共有/合并）', stats(), ['5', '5', '2', '2', '3', '7']);
  assert('文件模式标签页计数', tabCounts(), ['2', '2', '3', '7']);
  assert('默认标签页展示 A 独有值', rows(), ['DIP003', 'DIP010']);
  assert('文件槽位显示行数', /5 行/.test(slots[0].querySelector('.hint')?.textContent || ''), true);
  assert('状态为成功', /is-ok/.test(statusClass()), true);
  assert('状态文案含唯一值统计', /A 唯一值 5 个/.test(statusText()), true);

  const rerun = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent === '重新比对'
  );
  assert('重新比对按钮存在且可用', Boolean(rerun) && rerun.disabled === false, true);

  // ---------------- 阶段 2：标签页切换 + 结果筛选 ----------------
  const tabs = Array.from(document.querySelectorAll('.tab'));
  tabs[1].click();
  await sleep(250);
  assert('切到 B 独有后展示 DIP004/DIP011', rows(), ['DIP004', 'DIP011']);

  const filter = Array.from(document.querySelectorAll('input')).find(
    (i) => i.placeholder === '在结果中筛选'
  );
  assert('筛选输入框存在', Boolean(filter), true);
  filter.value = '011';
  filter.dispatchEvent(new Event('input'));
  await sleep(200);
  assert('筛选后只剩 DIP011', rows(), ['DIP011']);

  // 清空筛选，回到 A 独有，便于后续断言
  filter.value = '';
  filter.dispatchEvent(new Event('input'));
  await sleep(150);
  Array.from(document.querySelectorAll('.tab'))[0].click();
  await sleep(200);

  // ---------------- 阶段 3：B 侧切到粘贴模式，实时重算 ----------------
  const pasteModeBtn = Array.from(slots[1].querySelectorAll('.seg button')).find(
    (b) => b.textContent === '粘贴'
  );
  assert('B 侧有粘贴模式按钮', Boolean(pasteModeBtn), true);
  pasteModeBtn.click();
  await sleep(300);

  const textarea = slots[1].querySelector('.slot-textarea');
  assert('切到粘贴模式后出现输入框', Boolean(textarea), true);

  // B 只留 3 条：001/002/009
  textarea.value = 'DIP001\t张三\r\nDIP002\t李四\r\nDIP009\t新人\r\n';
  textarea.dispatchEvent(new Event('input'));
  await sleep(1100);

  assert('粘贴模式统计卡（A=5,B=3,A独有3,B独有1,共有2,合并6）', stats(), ['5', '3', '3', '1', '2', '6']);
  assert('粘贴模式标签页计数', tabCounts(), ['3', '1', '2', '6']);
  assert('A 独有值随粘贴内容变化', rows(), ['DIP003', 'DIP005', 'DIP010']);
  assert('粘贴输入框脚注显示行数与唯一值', /3 行 · 3 个唯一值/.test(
    slots[1].querySelector('.slot-foot')?.textContent || ''
  ), true);

  // ---------------- 阶段 4：从剪贴板粘贴 ----------------
  await window.api.clipboard.writeText('CLIP001\t剪贴板数据\n');
  const pasteBtn = Array.from(slots[1].querySelectorAll('.slot-foot button')).find(
    (b) => b.textContent === '从剪贴板粘贴'
  );
  assert('剪贴板粘贴按钮存在', Boolean(pasteBtn), true);
  pasteBtn.click();
  await sleep(1100);

  assert('粘贴按钮把剪贴板内容填入输入框', textarea.value.indexOf('CLIP001') === 0, true);
  assert('剪贴板数据参与比对（B=1, A独有5, 共有0）', stats(), ['5', '1', '5', '1', '0', '6']);

  if (failures.length > 0) {
    throw new Error(`${failures.length} 项断言失败：${failures.join(' | ')}`);
  }

  return { ok: true, assertions: 22 };
})();

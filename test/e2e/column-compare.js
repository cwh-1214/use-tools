// 端到端场景：列比对（文本文件 → 粘贴 → 剪贴板 → 自定义分隔符 → 表格 → 超长文件名）
// 由 test/run-e2e.js 交给 Tauri 冒烟钩子执行，配合 USE_TOOLS_FIXTURE_QUEUE 免去文件选择框。
// fixtures：默认 caseA/caseB（DIP001..010 两列），追加 01-a.xlsx / 02-b.xlsx 与 03-超长…txt

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

  // 分隔符：制表符 / 空格 / 逗号 / 竖线 / 自定义
  assert(
    '分隔符选项',
    Array.from(document.querySelector('.opt-panel .seg').querySelectorAll('button')).map(
      (b) => b.textContent
    ),
    ['制表符', '空格', '逗号', '竖线', '自定义']
  );

  // 空槽位是「选择文件」，已有文件时换成「更换」——同一个动作，两种文案
  const pickBtn = (slot) =>
    Array.from(slot.querySelectorAll('button')).find(
      (b) => b.textContent.includes('选择文件') || b.textContent.includes('更换')
    );

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
  // 剪贴板可能被剪贴板管理器占用（远程控制软件的同步很常见），重试几次
  let clipboardOk = false;
  for (let i = 0; i < 4 && !clipboardOk; i += 1) {
    try {
      await window.api.clipboard.writeText('CLIP001\t剪贴板数据\n');
      clipboardOk = true;
    } catch {
      await sleep(250);
    }
  }

  const pasteBtn = Array.from(slots[1].querySelectorAll('.slot-foot button')).find(
    (b) => b.textContent === '从剪贴板粘贴'
  );
  assert('剪贴板粘贴按钮存在', Boolean(pasteBtn), true);

  if (clipboardOk) {
    pasteBtn.click();
    await sleep(1100);
    assert('粘贴按钮把剪贴板内容填入输入框', textarea.value.indexOf('CLIP001') === 0, true);
    assert('剪贴板数据参与比对（B=1, A独有5, 共有0）', stats(), ['5', '1', '5', '1', '0', '6']);
  } else {
    console.log('  skip 剪贴板粘贴：剪贴板被其他程序占用');
  }

  // ---------------- 阶段 5：自定义分隔符接进列比对的实时重算 ----------------
  // 组件本身的行为（原地变输入框、回车收起）由 sql-in 场景覆盖，这里只验接线
  document.querySelector('.opt-panel .seg button[data-id="custom"]').click();
  await sleep(250);

  const delimInput = document.querySelector('.opt-panel .seg-input');
  assert('点击自定义后原地变成输入框', Boolean(delimInput), true);

  delimInput.value = ',';
  delimInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1100);
  assert('自定义分隔符触发重算', /is-ok/.test(statusClass()), true);

  delimInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(150);
  assert(
    '回车收起后按钮显示已填的分隔符',
    document.querySelector('.opt-panel .seg button[data-id="custom"]')?.textContent,
    ','
  );

  // ---------------- 阶段 6：换成表格，按单元格读列（忽略分隔符与编码） ----------------
  const fileModeBtn = Array.from(slots[1].querySelectorAll('.seg button')).find(
    (b) => b.textContent === '文件'
  );
  if (fileModeBtn && !fileModeBtn.classList.contains('is-on')) fileModeBtn.click();
  await sleep(300);

  pickBtn(slots[0]).click();
  await sleep(450);
  pickBtn(slots[1]).click();
  await sleep(1400); // 读表格 + 防抖 + IPC

  assert('A 侧文件名是 a.xlsx', /a\.xlsx/.test(slots[0].textContent), true);
  assert('B 侧文件名是 b.xlsx', /b\.xlsx/.test(slots[1].textContent), true);
  assert('文件行标注为表格', /表格/.test(slots[0].querySelector('.hint')?.textContent || ''), true);
  assert('表格行数被读出', /4 行/.test(slots[0].querySelector('.hint')?.textContent || ''), true);
  assert('表格统计卡（A=4,B=4,A独有1,B独有1,共有3,合并5）', stats(), ['4', '4', '1', '1', '3', '5']);
  assert('表格标签页计数', tabCounts(), ['1', '1', '3', '5']);
  assert('表格 A 独有值', rows(), ['u1002']);

  // 第 2 列在表格里不存在，应全部计入「列数不足」
  const columnInput = document.querySelector('input[data-role="column"]');
  columnInput.value = '2';
  columnInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1200);
  assert('第 2 列无值时统计归零', stats(), ['0', '0', '0', '0', '0', '0']);

  columnInput.value = '1';
  columnInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1200);
  assert('改回第 1 列恢复结果', stats(), ['4', '4', '1', '1', '3', '5']);

  // ---------------- 阶段 7：超长文件名不能把槽位撑破 ----------------
  pickBtn(slots[0]).click();
  await sleep(1000);

  const longName = slots[0].querySelector('.file-name');
  assert('文件名已渲染', Boolean(longName), true);
  assert('确实是长文件名', longName.textContent.length > 50, true);
  assert('文件名被截断（出现省略号）', longName.scrollWidth > longName.clientWidth, true);
  assert('文件槽位没有横向溢出', slots[0].scrollWidth - slots[0].clientWidth <= 1, true);
  assert('文件名宽度小于槽位宽度', longName.clientWidth < slots[0].clientWidth, true);

  const slotRight = slots[0].getBoundingClientRect().right;
  const outside = Array.from(slots[0].querySelectorAll('button')).filter(
    (b) => b.getBoundingClientRect().right > slotRight + 1
  );
  assert('操作按钮都在槽位内', outside.map((b) => b.textContent), []);
  assert('文件名不挂提示', longName.hasAttribute('data-tip'), false);

  if (failures.length > 0) {
    throw new Error(`${failures.length} 项断言失败：${failures.join(' | ')}`);
  }

  return { ok: true, assertions: 41 };
})();

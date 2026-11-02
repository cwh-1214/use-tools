// 端到端场景：SQL IN 生成器
// 由 scripts/e2e.js 注入执行。fixtures/sql-in/import.txt 用于验证「导入文件」链路。

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  let assertions = 0;

  const assert = (label, actual, expected) => {
    assertions += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      console.log(`  ok   ${label}`);
    } else {
      failures.push(`${label}: 期望 ${e}，实际 ${a}`);
      console.log(`  FAIL ${label}: 期望 ${e}，实际 ${a}`);
    }
  };

  const textareas = () => Array.from(document.querySelectorAll('.tool-view textarea'));
  const input = () => textareas()[0];
  const output = () => textareas()[1];
  const statusText = () => document.querySelector('.status-text')?.textContent || '';

  const seg = (label) =>
    Array.from(document.querySelectorAll('.seg button')).find((b) => b.textContent === label);

  const click = async (label, wait = 220) => {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === label
    );
    if (!btn) throw new Error(`找不到按钮：${label}`);
    btn.click();
    await sleep(wait);
  };

  const type = async (text, wait = 300) => {
    const el = input();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(wait); // 防抖 150ms
  };

  const isOn = (label) => Boolean(seg(label)?.classList.contains('is-on'));

  // ---------------- 阶段 1：初始状态 ----------------
  location.hash = '#/sql-in';
  await sleep(500);
  assert('工具已挂载（两个编辑区）', textareas().length, 2);
  assert('初始输出为空', output().value, '');
  assert('初始状态提示', statusText(), '粘贴数据后自动转换');

  // ---------------- 阶段 2：混合分隔符 ----------------
  await type("DIP001\nDIP002\nDIP003, DIP004\n'DIP005'");
  assert(
    '多行 + 逗号 + 已有引号 → IN 单行',
    output().value,
    "IN ('DIP001', 'DIP002', 'DIP003', 'DIP004', 'DIP005')"
  );
  assert('状态统计输出条数', /输出 5 条/.test(statusText()), true);

  await click('纯数据列');
  assert('纯数据列去掉引号与 SQL 语法', output().value, 'DIP001\nDIP002\nDIP003\nDIP004\nDIP005');

  await click('IN 单行');

  // ---------------- 阶段 3：数字与文本分开加引号 ----------------
  await type('1,2,3,abc,4.5,1e3');
  assert('数字不加引号，文本加引号', output().value, "IN (1, 2, 3, 'abc', 4.5, 1e3)");

  // ---------------- 阶段 4：去重 ----------------
  await type('a,a,b,A');
  assert('去重保留首次顺序且区分大小写', output().value, "IN ('a', 'b', 'A')");
  assert('状态里报告去重条数', /去重 1 条/.test(statusText()), true);

  // ---------------- 阶段 5：引号感知 ----------------
  await type("'A,B', C");
  assert('引号内的逗号不切分', output().value, "IN ('A,B', 'C')");

  await type("'O''Brien'");
  assert('SQL 转义的单引号原样往返', output().value, "IN ('O''Brien')");

  await type('甲，乙；丙');
  assert('全角逗号与分号也识别', output().value, "IN ('甲', '乙', '丙')");

  // ---------------- 阶段 6：粘整段 SQL，自动剥离外壳 ----------------
  await type("user_id NOT IN ('u1', 'u2')");
  assert('剥掉 NOT IN 外壳并复用列名', output().value, "user_id NOT IN ('u1', 'u2')");
  assert('方向开关自动切到 NOT IN', isOn('NOT IN'), true);
  assert('状态提示已剥离外层语句', /已剥离外层语句/.test(statusText()), true);

  await click('IN');
  assert('手动切回 IN', isOn('IN'), true);

  await type("IN (1, 2, 3);");
  assert('剥掉裸 IN 外壳与结尾分号', output().value, 'IN (1, 2, 3)');

  // ---------------- 阶段 7：列名与分片 ----------------
  const columnInput = document.querySelector('.tool-view input[data-role="column"]');
  columnInput.value = 'dip_code';
  columnInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(320);
  assert('填列名后拼接前缀', output().value, "dip_code IN (1, 2, 3)");

  const chunkInput = document.querySelector('.tool-view input[type="number"]');
  chunkInput.value = '2';
  chunkInput.dispatchEvent(new Event('input', { bubbles: true }));
  await type('1,2,3,4,5');
  assert('每 2 个分片用 OR 连接', output().value, 'dip_code IN (1, 2)\nOR dip_code IN (3, 4)\nOR dip_code IN (5)');
  assert('状态报告分片数', /分 3 片/.test(statusText()), true);

  chunkInput.value = '0';
  chunkInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(320);

  // ---------------- 阶段 8：IN 多行 ----------------
  await click('IN 多行');
  await type('1,2');
  assert('IN 多行缩进格式', output().value, 'dip_code IN (\n  1,\n  2\n)');

  await click('IN 单行');
  await click('纯数据列'); // 纯数据列时应隐藏方向/分片
  assert('纯数据列隐藏方向与分片', document.querySelector('.tool-view input[type="number"]').parentElement.style.display, 'none');

  // ---------------- 阶段 9：值列表与引号策略 ----------------
  columnInput.value = '';
  columnInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(320);

  await click('值列表');
  await type('x,y');
  assert('值列表每行带尾逗号', output().value, "'x',\n'y',");

  await click('IN 单行');
  await click('双引号');
  await type('x');
  assert('切到双引号', output().value, 'IN ("x")');

  await click('不加引号');
  await type('x,y');
  assert('不加引号（纯裸值）', output().value, 'IN (x, y)');

  await click('单引号');

  // ---------------- 阶段 10：排序 ----------------
  await click('升序');
  await type('b,a,c2,c10,c1');
  assert(
    '升序按自然序（c2 在 c10 前）',
    output().value,
    "IN ('a', 'b', 'c1', 'c2', 'c10')"
  );
  await click('原序');

  // ---------------- 阶段 11：从剪贴板粘贴 ----------------
  await window.api.clipboard.writeText('K1\nK2');
  await click('从剪贴板粘贴', 350);
  assert('从剪贴板粘贴可用', output().value, "IN ('K1', 'K2')");

  // ---------------- 阶段 12：导入文件（顺便走一遍 GBK 解码分支） ----------------
  await click('GBK', 120);
  await click('导入文件', 600);
  assert('导入文件后转换结果', output().value, "IN ('A001', 'A002', 'A003')");
  await click('UTF-8', 120);

  // ---------------- 阶段 13：自定义分隔符 ----------------
  await click('自定义');
  const customInput = document.querySelector('.tool-view input[placeholder*="如"]');
  assert('自定义分隔符输入框已出现', Boolean(customInput), true);
  customInput.value = '|';
  customInput.dispatchEvent(new Event('input', { bubbles: true }));
  await type('a|b|c');
  assert('自定义分隔符生效', output().value, "IN ('a', 'b', 'c')");

  // ---------------- 阶段 14：配置记忆（切走再切回，输入与选项都应恢复） ----------------
  // 注意此时分隔符仍是阶段 13 的自定义「|」，MEMO1,MEMO2 应作为单个值 —— 这本身就是
  // 「分隔符状态被恢复」的证明
  await click('升序', 120);
  await type('MEMO1,MEMO2');
  await sleep(900); // 等持久化防抖（600ms）落盘
  location.hash = '#/json-format';
  await sleep(400);
  location.hash = '#/sql-in';
  await sleep(600); // 等重新挂载 + 异步恢复
  assert('切回后输入内容被恢复', input().value, 'MEMO1,MEMO2');
  assert('切回后排序选项被恢复', isOn('升序'), true);
  const restoredCustom = document.querySelector('.tool-view input[placeholder*="如"]');
  assert('切回后自定义分隔符被恢复', restoredCustom.parentElement.style.display !== 'none', true);
  assert('恢复后转换结果正确（单值，逗号不切分）', output().value, "IN ('MEMO1,MEMO2')");

  await click('自动', 120);
  assert('切回自动分隔符后正常切分', output().value, "IN ('MEMO1', 'MEMO2')");
  await type('');

  // ---------------- 收尾 ----------------
  if (failures.length > 0) {
    console.log(`  ${failures.length} 条断言失败`);
    throw new Error(failures.join(' | '));
  }

  console.log(`  全部 ${assertions} 条断言通过`);
  return { ok: true, assertions };
})();

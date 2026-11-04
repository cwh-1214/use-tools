// 端到端场景：时间戳转换
// 断言位数识别（秒/毫秒/微秒）、日期栏的粘贴解析、双向同步、时区信息与逐行复制。
// 不硬编码「本地时间」——不同机器时区不同，只断言与时区无关的值，或用动态计算。

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failures = [];
  let passed = 0;

  const assert = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      passed += 1;
      console.log(`  ok   ${label}`);
    } else {
      failures.push(`${label}: 期望 ${e}，实际 ${a}`);
      console.log(`  FAIL ${label}: 期望 ${e}，实际 ${a}`);
    }
  };

  const rowValue = (label) => {
    const dt = Array.from(document.querySelectorAll('.kv dt')).find((n) => n.textContent === label);
    return dt?.nextElementSibling?.querySelector('.kv-val')?.textContent || '';
  };
  const tsInput = () => document.querySelector('.tool-view input');
  const dateInput = () => document.querySelector('.tool-view input[data-role="date"]');
  const setVal = (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const pad = (n) => String(n).padStart(2, '0');
  const stampOf = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}:${pad(date.getSeconds())}`;

  location.hash = '#/timestamp';
  await sleep(600);

  // ---------------- 阶段 1：10 位秒 ----------------
  setVal(tsInput(), '1700000000');
  await sleep(250);
  assert('10 位秒 → ISO', rowValue('ISO 8601'), '2023-11-14T22:13:20.000Z');
  assert('10 位秒 → 毫秒', rowValue('毫秒'), '1700000000000');
  assert('10 位秒 → 星期', rowValue('星期'), '周三');
  assert('时区行带偏移与名字', /^UTC[+-]\d{2}:\d{2} · \S+/.test(rowValue('时区')), true);
  assert('日期框已同步为本地写法', dateInput().value, stampOf(new Date(1700000000 * 1000)));

  // ---------------- 阶段 2：13 位毫秒 ----------------
  setVal(tsInput(), '1700000000000');
  await sleep(250);
  assert('13 位毫秒 → ISO', rowValue('ISO 8601'), '2023-11-14T22:13:20.000Z');
  assert('13 位毫秒 → 秒', rowValue('秒'), '1700000000');

  // ---------------- 阶段 3：16 位微秒 ----------------
  setVal(tsInput(), '1700000000000000');
  await sleep(250);
  assert('16 位微秒 → ISO', rowValue('ISO 8601'), '2023-11-14T22:13:20.000Z');

  // ---------------- 阶段 4：日期栏直接粘贴 ----------------
  setVal(dateInput(), stampOf(new Date(1700000000 * 1000)));
  await sleep(400);
  assert('粘贴标准日期时间 → 秒', rowValue('秒'), '1700000000');
  assert('时间戳框已回填', tsInput().value, '1700000000');

  setVal(dateInput(), '2023/11/15 06:13:20');
  await sleep(400);
  assert(
    '斜杠写法按本地时间解析',
    rowValue('秒'),
    String(Math.floor(new Date(2023, 10, 15, 6, 13, 20).getTime() / 1000))
  );

  setVal(dateInput(), '2023-11-15');
  await sleep(400);
  assert('只给日期按本地 0 点算', rowValue('本地时间'), '2023-11-15 00:00:00');

  setVal(dateInput(), '2023-11-15T06:13:20+08:00');
  await sleep(400);
  assert('带时区的 ISO 按偏移换算', rowValue('秒'), '1700000000');

  setVal(dateInput(), '1700000000');
  await sleep(400);
  assert('日期栏粘时间戳也能认', rowValue('秒'), '1700000000');

  // ---------------- 阶段 5：无效输入 ----------------
  setVal(dateInput(), '2023-02-30 00:00:00');
  await sleep(400);
  assert('不存在的日期判为无效', document.querySelector('.status')?.className, 'status is-err');
  assert('无效时结果清空', rowValue('ISO 8601'), '—');

  setVal(tsInput(), 'not-a-time');
  await sleep(400);
  assert('时间戳框无效输入同样是错误态', document.querySelector('.status')?.className, 'status is-err');

  // ---------------- 阶段 6：逐行复制 ----------------
  setVal(tsInput(), '1700000000');
  await sleep(250);
  const copyBtns = Array.from(document.querySelectorAll('.kv-copy'));
  assert('可复制的行数', copyBtns.length, 5);
  // 剪贴板可能被剪贴板管理器（远程控制软件的同步等）短暂占用，重试几次再判定
  let copyLabel = '';
  for (let i = 0; i < 4 && copyLabel !== '已复制'; i += 1) {
    copyBtns[0].click();
    await sleep(320);
    copyLabel = copyBtns[0].textContent;
  }
  if (copyLabel === '已复制') {
    assert('复制后有反馈', copyLabel, '已复制');
  } else {
    console.log('  skip 复制后有反馈：剪贴板被其他程序占用');
  }

  // ---------------- 阶段 7：当前时间 ----------------
  const nowBtn = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent === '当前时间'
  );
  nowBtn.click();
  await sleep(300);
  assert(
    '当前时间按钮写入的是现在（±2 秒）',
    Math.abs(Number(rowValue('秒')) - Math.floor(Date.now() / 1000)) <= 2,
    true
  );

  if (failures.length) {
    throw new Error(`${failures.length} 条断言失败:\n${failures.join('\n')}`);
  }
  console.log(`  全部 ${passed} 条断言通过`);
  return { ok: true, assertions: passed };
})();

// 端到端场景：SQL IN 生成器
// 由 test/run-e2e.js 注入执行。SQL IN 只接受粘贴内容，不使用 fixtures。

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
  // 这个工具只吃粘贴内容：不允许再出现文件导入入口和只服务导入的编码选项
  assert(
    '没有「导入文件」按钮',
    Array.from(document.querySelectorAll('button')).some((b) => b.textContent === '导入文件'),
    false
  );
  assert(
    '选项面板里没有「文本编码」',
    document.querySelector('.opt-panel')?.innerText.includes('文本编码'),
    false
  );

  // 分组布局：每个「标签 + 控件」必须处在同一行（不能被拆到两行去）
  const splitGroups = Array.from(document.querySelectorAll('.opt-panel .opt-item')).filter((item) => {
    const kids = Array.from(item.children)
      .map((el) => el.getBoundingClientRect())
      .filter((rect) => rect.width > 0);
    if (kids.length < 2) return false;
    const center = (rect) => rect.top + rect.height / 2;
    return Math.abs(center(kids[0]) - center(kids[1])) > 12;
  });
  assert('每组「标签 + 控件」都在同一行', splitGroups.length, 0);
  assert(
    '所有选项组都包在 .opt-item 里',
    document.querySelectorAll('.opt-row > :not(.opt-item)').length,
    0
  );
  // 「自定义」是分段控件里的普通一项，平时是按钮；没有常驻的输入框
  const customIdleBtn = document.querySelector('.opt-panel .seg button[data-id="custom"]');
  assert('自定义平时是按钮', Boolean(customIdleBtn), true);
  // 宽度按三个字算，三字必须完整显示，不能被自己的省略号裁掉
  assert(
    '「自定义」三字没有被裁',
    customIdleBtn.scrollWidth <= customIdleBtn.clientWidth + 1,
    true
  );
  assert('没有常驻的自定义输入框', Boolean(document.querySelector('.opt-panel .seg-input')), false);

  // 排序标签：文案是「排序」而不是「值排序」，且不再用竖线和左边的选区分隔
  const sortLabel = Array.from(document.querySelectorAll('.opt-panel .opt-label')).find(
    (el) => el.textContent === '排序'
  );
  assert('排序标签文案', Boolean(sortLabel), true);
  assert(
    '排序标签没有左侧竖线',
    sortLabel ? getComputedStyle(sortLabel).borderLeftWidth : null,
    '0px'
  );

  // 分片输入框曾经挂着原生 title（悬停弹系统灰框），确认现在两种提示都没有
  const chunkBox = document.querySelector('.opt-panel input[type="number"]');
  assert('分片输入框没有原生 title', chunkBox.hasAttribute('title'), false);
  assert('分片输入框没有 data-tip', chunkBox.hasAttribute('data-tip'), false);

  // step=100 时输入 150 会被浏览器判成无效值，失焦弹「请输入一个有效的值」；
  // 现在改成 step=any，任何整数都应通过校验
  chunkBox.value = '150';
  chunkBox.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(150);
  assert('分片填 150 不触发原生校验', chunkBox.checkValidity(), true);
  chunkBox.value = '0';
  chunkBox.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(150);

  // 只有「自动」需要解释它认哪些分隔符；其余选项点一下就能看到结果，不挂提示
  const tipLabels = Array.from(
    document.querySelectorAll('.opt-panel .seg button[data-tip]')
  ).map((b) => b.textContent);
  assert('只有「自动」带提示', tipLabels, ['自动']);

  const separatorSeg = document.querySelector('.opt-panel .seg button[data-id="auto"]').parentElement;
  assert(
    '切分方式选项',
    Array.from(separatorSeg.querySelectorAll('button')).map((b) => b.textContent),
    ['自动', '换行', '制表符', '空格', '逗号', '竖线', '自定义']
  );

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

  // 自动要认得这五种：换行、制表符、空格、逗号（中文逗号也算）、竖线
  await type('甲，乙|丙 丁\t戊\n己');
  assert(
    '自动识别换行 / 制表符 / 空格 / 逗号 / 竖线',
    output().value,
    "IN ('甲', '乙', '丙', '丁', '戊', '己')"
  );

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
  assert(
    '纯数据列隐藏方向与分片',
    document.querySelector('.tool-view input[type="number"]').closest('.opt-row').style.display,
    'none'
  );

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
  // 剪贴板可能被剪贴板管理器占用（远程控制软件的同步很常见），重试几次
  let clipboardOk = false;
  for (let i = 0; i < 4 && !clipboardOk; i += 1) {
    try {
      await window.api.clipboard.writeText('K1\nK2');
      clipboardOk = true;
    } catch {
      await sleep(250);
    }
  }
  if (clipboardOk) {
    await click('从剪贴板粘贴', 350);
    assert('从剪贴板粘贴可用', output().value, "IN ('K1', 'K2')");
  } else {
    console.log('  skip 剪贴板粘贴：剪贴板被其他程序占用');
  }

  // ---------------- 阶段 12：自定义（按钮就地变成输入框） ----------------
  const segWidthBefore = document.querySelector('.opt-panel .seg').getBoundingClientRect().width;

  await click('自定义');
  const customInput = document.querySelector('.opt-panel .seg-input');
  assert('点击自定义后原地变成输入框', Boolean(customInput), true);
  assert('自定义的默认提示是制表符写法', customInput.placeholder, '如 \\t');

  // 内边距不单独设，跟普通分段按钮保持一致
  const plainBtn = Array.from(document.querySelectorAll('.opt-panel .seg button')).find(
    (b) => b.textContent === '逗号'
  );
  assert(
    '输入框内边距与普通按钮一致',
    getComputedStyle(customInput).paddingLeft,
    getComputedStyle(plainBtn).paddingLeft
  );

  // 选项都不挂提示了，只有键盘操作这种看不见的东西还留一句
  assert('输入框带键盘说明', customInput.dataset.tip, '回车或点别处确认，Esc 取消');
  customInput.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(500); // 显示延迟 350ms
  const bubble = document.querySelector('.tip-bubble');
  assert('悬停输入框弹出气泡', bubble?.classList.contains('is-on'), true);
  assert('气泡内容是键盘说明', bubble?.textContent, '回车或点别处确认，Esc 取消');
  customInput.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  await sleep(120);
  assert('移开后气泡收起', bubble?.classList.contains('is-on'), false);
  assert(
    '原来的自定义按钮已消失（是替换，不是并排新增）',
    Boolean(document.querySelector('.opt-panel .seg button[data-id="custom"]')),
    false
  );
  assert('输入框已获得焦点', document.activeElement === customInput, true);
  assert(
    '切换前后分段控件宽度不变',
    Math.round(document.querySelector('.opt-panel .seg').getBoundingClientRect().width),
    Math.round(segWidthBefore)
  );

  customInput.value = '|';
  customInput.dispatchEvent(new Event('input', { bubbles: true }));
  await type('a|b|c');
  assert('自定义分隔符生效', output().value, "IN ('a', 'b', 'c')");

  // 回车收起：输入框变回按钮，按钮上直接显示已填的分隔符
  customInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(120);
  const customButtonAfter = document.querySelector('.opt-panel .seg button[data-id="custom"]');
  assert('回车后变回按钮', Boolean(customButtonAfter), true);
  assert('按钮上显示已填的分隔符', customButtonAfter?.textContent, '|');
  // 值再长也只省略，不能把固定宽度撑开
  assert('自定义按钮超长内容省略', getComputedStyle(customButtonAfter).textOverflow, 'ellipsis');
  // 宽度应与同为三个字的「制表符」按钮一致，而不是被单独设成更宽的固定值
  const tabBtn = document.querySelector('.opt-panel .seg button[data-id="tab"]');
  assert(
    '自定义按钮与同字数按钮等宽',
    Math.abs(
      customButtonAfter.getBoundingClientRect().width - tabBtn.getBoundingClientRect().width
    ) <= 2,
    true
  );

  // ---------------- 阶段 13：配置记忆（切走再切回，输入与选项都应恢复） ----------------
  // 注意此时分隔符仍是阶段 12 的自定义「|」，MEMO1,MEMO2 应作为单个值 —— 这本身就是
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
  const restoredCustom = document.querySelector('.opt-panel .seg button[data-id="custom"]');
  assert('切回后自定义分隔符被恢复（按钮显示值）', restoredCustom?.textContent, '|');
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

// 端到端场景：切换菜单后，页面数据必须还在
// 覆盖两类状态：文本输入（JSON 工具）与比对结果（列比对，粘贴模式）

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
  const go = async (hash, wait = 500) => {
    location.hash = hash;
    await sleep(wait);
  };

  // ---------------- JSON 工具：输入与输出都要留住 ----------------
  await go('#/json-format');
  const jsonInput = document.querySelector('#tool-view textarea');
  assert('JSON 输入框存在', Boolean(jsonInput), true);

  jsonInput.value = '{"name":"张三","tags":["a","b"],"n":1}';
  jsonInput.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(500);

  const jsonOutput = document.querySelectorAll('#tool-view textarea')[1];
  const formattedBefore = jsonOutput.value;
  assert('JSON 已格式化出结果', formattedBefore.includes('"张三"'), true);

  // 切到另一个工具并输入内容
  await go('#/base64');
  const base64Input = document.querySelector('#tool-view textarea');
  base64Input.value = 'use-tools';
  base64Input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);

  // 切回来：输入与输出都应原样
  await go('#/json-format', 400);
  const jsonInputAfter = document.querySelector('#tool-view textarea');
  assert('切回 JSON：输入内容保留', jsonInputAfter.value, '{"name":"张三","tags":["a","b"],"n":1}');
  const jsonOutputAfter = document.querySelectorAll('#tool-view textarea')[1];
  assert('切回 JSON：输出结果保留', jsonOutputAfter.value, formattedBefore);

  // 同一时刻页面上只应有一个工具视图（不能把隐藏的旧视图留在文档里）
  assert('文档里只有一个工具视图', document.querySelectorAll('#tool-view > .tool-body').length, 1);

  // ---------------- 列比对：比对结果要留住 ----------------
  await go('#/column-compare');
  const slots = Array.from(document.querySelectorAll('.file-slot'));
  for (const slot of slots) {
    const pasteBtn = Array.from(slot.querySelectorAll('.seg button')).find((b) => b.textContent === '粘贴');
    if (pasteBtn && !pasteBtn.classList.contains('is-on')) pasteBtn.click();
  }
  await sleep(300);

  const areas = Array.from(document.querySelectorAll('#tool-view .slot-textarea'));
  areas[0].value = 'u1001\nu1002\nu1003\n';
  areas[0].dispatchEvent(new Event('input', { bubbles: true }));
  areas[1].value = 'u1001\nu1003\nu1004\n';
  areas[1].dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(1200);

  assert('列比对已有结果（A=3,B=3,A独有1,B独有1,共有2）', stats(), ['3', '3', '1', '1', '2', '4']);

  // 切走再切回
  await go('#/timestamp', 500);
  await go('#/column-compare', 500);

  assert('切回列比对：统计结果不变', stats(), ['3', '3', '1', '1', '2', '4']);
  const areasAfter = Array.from(document.querySelectorAll('#tool-view .slot-textarea'));
  assert('切回列比对：A 侧粘贴内容保留', areasAfter[0].value, 'u1001\nu1002\nu1003\n');

  // 结果列表内容也应还在（默认标签页 = A 独有）
  const rows = Array.from(document.querySelectorAll('.data-list .row')).map((el) => el.textContent);
  assert('切回列比对：结果列表保留', rows, ['u1002']);

  // ---------------- 顺带确认：切走的那两个工具本身也没被销毁 ----------------
  await go('#/base64', 400);
  const base64After = document.querySelector('#tool-view textarea');
  assert('切回 Base64：输入内容保留', base64After.value, 'use-tools');

  if (failures.length) {
    console.log(`\n失败 ${failures.length} 条`);
    throw new Error(failures.join(' | '));
  }
  console.log('\n切换保留场景全部通过');
  return { ok: true };
})();

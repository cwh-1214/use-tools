// 端到端场景：导入类型限制
// JSON 格式化只收 .json/.txt；xlsx 这种二进制文件必须在读盘前就被挡住。
// （SQL IN 已无导入入口，那条断言并进 sql-in 场景，这里不再重复）
// fixtures：import-guard/a.xlsx、b.xlsx（喂给 JSON 的「导入文件」）

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

  const buttonByText = (text) =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
  const statusText = () => document.querySelector('.status-text')?.textContent || '';

  // ---------------- JSON 格式化：拒绝 xlsx ----------------
  location.hash = '#/json-format';
  await sleep(600);

  const jsonInput = document.querySelector('#tool-view textarea');
  const jsonBefore = jsonInput.value;
  buttonByText('导入文件').click();
  await sleep(600);

  assert('JSON 导入 xlsx 报错', /只能导入 .*\.json \/ \.txt/.test(statusText()), true);
  assert('JSON 输入框没有被写入', jsonInput.value, jsonBefore);

  if (failures.length > 0) {
    throw new Error(`${failures.length} 项断言失败：${failures.join(' | ')}`);
  }

  return { ok: true, assertions: 2 };
})();

// 端到端场景：超长文件名不能把文件槽位撑破，必须出省略号
// fixtures：long-name/ 下一个 66 字符的长文件名

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

  const pickBtn = Array.from(document.querySelectorAll('.file-slot button')).find((b) =>
    b.textContent.includes('选择文件')
  );
  assert('有选择文件按钮', Boolean(pickBtn), true);
  pickBtn.click();
  await sleep(1000);

  const slot = document.querySelector('.file-slot');
  const nameEl = slot.querySelector('.file-name');
  assert('文件名已渲染', Boolean(nameEl), true);
  assert('确实是长文件名', nameEl.textContent.length > 50, true);

  // 省略号的条件：内容宽度 > 可见宽度
  assert('文件名被截断（出现省略号）', nameEl.scrollWidth > nameEl.clientWidth, true);

  // 槽位本身不能被内容撑宽（撑宽了就说明右侧按钮被挤出可视区）
  assert('文件槽位没有横向溢出', slot.scrollWidth - slot.clientWidth <= 1, true);
  assert('文件名宽度小于槽位宽度', nameEl.clientWidth < slot.clientWidth, true);

  // 三个按钮都要完整留在槽位里
  const slotRight = slot.getBoundingClientRect().right;
  const outside = Array.from(slot.querySelectorAll('button')).filter(
    (b) => b.getBoundingClientRect().right > slotRight + 1
  );
  assert('操作按钮都在槽位内', outside.map((b) => b.textContent), []);

  // 悬停提示保留完整路径
  assert('文件名 title 是完整路径', nameEl.title.length > nameEl.textContent.length, true);

  if (failures.length) {
    console.log(`\n失败 ${failures.length} 条`);
    throw new Error(failures.join(' | '));
  }
  console.log('\n长文件名场景全部通过');
  return { ok: true };
})();

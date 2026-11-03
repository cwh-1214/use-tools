// 端到端场景：设置页
// 验证关闭到托盘开关、主题切换、快捷键区块与关于信息。
// 冒烟模式不抢全局快捷键，所以状态是「被占用，未生效」或「当前环境未启用」；
// 修改按钮应当可用（Tauri 版支持改键，只是这次没注册成功）。

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

  const themeBtn = (label) =>
    Array.from(document.querySelectorAll('.seg button')).find((b) => b.textContent === label);
  const bg = () => getComputedStyle(document.body).backgroundColor;

  location.hash = '#/settings';
  await sleep(800);

  assert('页面标题', document.getElementById('tool-title').textContent, '设置');

  // ---------------- 关闭到托盘 ----------------
  const closeBox = document.querySelector('.checkbox');
  assert('默认开启「最小化到托盘」', closeBox.checked, true);

  closeBox.click();
  await sleep(400);
  const afterToggle = await window.api.settings.get();
  assert('关掉后写入设置', afterToggle?.ui?.closeToTray, false);

  closeBox.click();
  await sleep(400);
  assert('再打开也写回设置', (await window.api.settings.get())?.ui?.closeToTray, true);

  // ---------------- 主题 ----------------
  const lightBg = bg();
  themeBtn('深色').click();
  await sleep(500);
  assert('切深色后背景变化', bg() !== lightBg, true);
  assert('主题写入设置', (await window.api.settings.get())?.ui?.theme, 'dark');

  themeBtn('浅色').click();
  await sleep(400);
  assert('切浅色后主题写入设置', (await window.api.settings.get())?.ui?.theme, 'light');

  // ---------------- 快捷键 ----------------
  assert('显示当前快捷键', document.querySelector('.kbd')?.textContent, 'Ctrl+Shift+Space');
  const badge = document.querySelector('.badge')?.textContent || '';
  assert('快捷键状态有明确提示', ['当前环境未启用', '被占用，未生效', '已生效'].includes(badge), true);

  const editBtn = Array.from(document.querySelectorAll('.btn')).find((b) => b.textContent === '修改');
  assert('快捷键允许修改', editBtn.disabled, false);

  // ---------------- 关于 ----------------
  const versionText = Array.from(document.querySelectorAll('.sett-value')).map((n) => n.textContent)[0] || '';
  assert('版本信息包含版本号', /^v\d+\.\d+\.\d+/.test(versionText), true);

  const dirText = document.querySelectorAll('.kbd')[1]?.textContent || '';
  assert('数据目录非空', dirText.length > 3 && dirText !== '未知', true);

  // ---------------- 来回切换后仍正常 ----------------
  location.hash = '#/json-format';
  await sleep(400);
  location.hash = '#/settings';
  await sleep(500);
  assert('再次进入设置页仍正常', document.getElementById('tool-title').textContent, '设置');
  assert('空状态行不占位', getComputedStyle(document.querySelector('.status')).display, 'none');

  // 设置页 → 已缓存的工具：设置页是「按次挂载」的，离开时必须从视图里清掉，
  // 否则会和缓存的工具页叠在一起（用户看到的“设置没有关闭”）
  location.hash = '#/json-format';
  await sleep(400);
  assert('离开设置后只剩一个工具视图', document.querySelectorAll('#tool-view .tool-body').length, 1);
  assert('设置页内容已从视图移除', document.querySelectorAll('#tool-view .sett-value').length, 0);

  // ---------------- 按键映射 ----------------
  // 录制快捷键时把 KeyboardEvent 转成 accelerator，两端解析同一套写法
  const { acceleratorFromEvent } = await import('./settings.js');
  const key = (opts) => acceleratorFromEvent({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...opts });
  assert('Ctrl+Shift+K', key({ ctrlKey: true, shiftKey: true, code: 'KeyK' }), 'Ctrl+Shift+K');
  assert('Ctrl+Alt+Space', key({ ctrlKey: true, altKey: true, code: 'Space' }), 'Ctrl+Alt+Space');
  assert('Alt+1', key({ altKey: true, code: 'Digit1' }), 'Alt+1');
  assert('F9 可以单独用', key({ code: 'F9' }), 'F9');
  assert('裸字母不允许', key({ code: 'KeyA' }), null);
  assert('不支持的键返回 null', key({ ctrlKey: true, code: 'ArrowUp' }), null);

  if (failures.length) {
    throw new Error(`${failures.length} 条断言失败:\n${failures.join('\n')}`);
  }
  console.log(`  全部 ${passed} 条断言通过`);
  return { ok: true, assertions: passed };
})();

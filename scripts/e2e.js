'use strict';

/**
 * 端到端测试入口：npm run test:e2e [场景名]
 *
 * 不带参数时依次跑 test/e2e/ 下所有场景，带参数只跑指定场景。
 *
 * 每个场景做的事：
 *   1. 准备 fixtures：若存在 test/fixtures/<场景名>/ 目录，用它里面的文件（按文件名排序）；
 *      否则回退到列比对的 caseA/caseB
 *   2. 把 fixtures 路径塞进 SMOKE_FIXTURE_QUEUE（绕过文件选择框）
 *   3. 把 test/e2e/<场景>.js 作为 SMOKE_SCRIPT 注入页面执行
 *   4. 收尾时截图到 test/output/<场景>.png，并用退出码反映结果
 *
 * 断言写在注入脚本里，脚本返回的 JSON 会打印出来；
 * 脚本抛错或渲染进程报错都会让退出码非 0。
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const scenarioDir = path.join(root, 'test', 'e2e');
const outputDir = path.join(root, 'test', 'output');

function listScenarios() {
  return fs
    .readdirSync(scenarioDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort();
}

function resolveFixtures(scenario) {
  const own = path.join(root, 'test', 'fixtures', scenario);
  if (fs.existsSync(own)) {
    return fs
      .readdirSync(own)
      .sort()
      .map((name) => path.join(own, name));
  }
  return ['caseA.txt', 'caseB.txt'].map((name) => path.join(root, 'test', 'fixtures', name));
}

function runScenario(scenario) {
  return new Promise((resolve) => {
    const scriptPath = path.join(scenarioDir, `${scenario}.js`);
    if (!fs.existsSync(scriptPath)) {
      console.error(`找不到场景脚本: ${scriptPath}`);
      resolve(1);
      return;
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const env = {
      ...process.env,
      SMOKE_FIXTURE_QUEUE: resolveFixtures(scenario).join(';'),
      SMOKE_SCRIPT: scriptPath,
      SMOKE_SHOT: path.join(outputDir, `${scenario}.png`),
      // 保存对话框不弹窗，产物直接落到 test/output，便于断言
      SMOKE_SAVE_DIR: outputDir,
    };
    delete env.ELECTRON_RUN_AS_NODE;

    console.log(`\n▶ 场景: ${scenario}`);

    const child = spawn(process.execPath, [path.join(root, 'scripts', 'launch.js'), '--smoke'], {
      cwd: root,
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      console.log(code === 0 ? '✔ 通过' : `✘ 失败 (exit ${code})`);
      if (code === 0) console.log(`  截图: ${env.SMOKE_SHOT}`);
      resolve(code ?? 1);
    });
  });
}

(async () => {
  const requested = process.argv.slice(2).filter(Boolean);
  const scenarios = requested.length > 0 ? requested : listScenarios();

  let failed = 0;
  for (const scenario of scenarios) {
    failed += await runScenario(scenario);
  }

  console.log(`\n${failed === 0 ? '✔ 全部场景通过' : `✘ ${failed} 个场景失败`}`);
  process.exit(failed === 0 ? 0 : 1);
})();

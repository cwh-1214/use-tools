'use strict';

/**
 * 端到端测试入口（Tauri）：npm run test:e2e [场景名]
 *
 * 前置：先构建可执行文件（`cargo build --release`，或 `npm run tauri:build`）。
 * 也可以用 USE_TOOLS_EXE 指定任意构建产物，例如 debug 版。
 *
 * 每个场景做的事：
 *   1. 准备 fixtures：若存在 test/fixtures/<场景名>/ 目录，用它里面的文件（按文件名排序）；
 *      否则回退到列比对的 caseA/caseB
 *   2. 把这些路径塞进 USE_TOOLS_FIXTURE_QUEUE（Tauri 的 pick_file 会按顺序直接返回，不弹窗）
 *   3. 把 test/e2e/<场景>.js 交给应用内的冒烟钩子执行，结果通过 IPC 回传
 *   4. 退出码 0 表示场景通过；结果 JSON 落在 test/output/<场景>.json
 *
 * 发布版是 windows 子系统，没有控制台输出，所以判定只看退出码 + 结果文件。
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

function findExe() {
  if (process.env.USE_TOOLS_EXE) return process.env.USE_TOOLS_EXE;
  const name = process.platform === 'win32' ? 'use-tools.exe' : 'use-tools';
  return path.join(root, 'src-tauri', 'target', 'release', name);
}

function runScenario(scenario, exe) {
  return new Promise((resolve) => {
    const scriptPath = path.join(scenarioDir, `${scenario}.js`);
    if (!fs.existsSync(scriptPath)) {
      console.error(`找不到场景脚本: ${scriptPath}`);
      resolve(1);
      return;
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, `${scenario}.json`);
    fs.rmSync(reportPath, { force: true });

    // 每个场景一个干净的配置目录：不受用户真实设置影响，也不会写脏它
    const profileDir = path.join(outputDir, 'profiles', scenario);
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.mkdirSync(profileDir, { recursive: true });

    const env = {
      ...process.env,
      USE_TOOLS_SMOKE: '1',
      USE_TOOLS_SMOKE_SCRIPT: scriptPath,
      USE_TOOLS_SMOKE_OUT: reportPath,
      USE_TOOLS_SMOKE_WINDOW: '1120x720',
      USE_TOOLS_FIXTURE_QUEUE: resolveFixtures(scenario).join(';'),
      USE_TOOLS_CONFIG_DIR: profileDir,
      // 保存对话框不弹窗，产物直接落到 test/output，便于断言
      USE_TOOLS_SAVE_DIR: outputDir,
    };

    console.log(`\n▶ 场景: ${scenario}`);

    const child = spawn(exe, [], { cwd: root, env, stdio: 'inherit' });

    child.on('error', (err) => {
      console.error(`启动失败：${err.message}`);
      resolve(1);
    });

    child.on('exit', (code) => {
      let report = '';
      if (fs.existsSync(reportPath)) {
        report = fs.readFileSync(reportPath, 'utf8');
        for (const line of report.split(/\r?\n/).filter(Boolean)) {
          console.log(`  ${line}`);
        }
      }
      // 只有「退出码 0 + 报告里 ok:true」才算通过：
      // 单实例被顶掉等情况也会 exit 0，但没有报告，必须判失败
      const passed = code === 0 && report.includes('"ok":true');
      if (!passed && !report) console.log('  （没有收到测试报告：检查是否被单实例顶掉或应用启动失败）');
      console.log(passed ? '✔ 通过' : `✘ 失败 (exit ${code})`);
      resolve(passed ? 0 : 1);
    });
  });
}

async function main() {
  const requested = process.argv.slice(2).filter(Boolean);
  const scenarios = requested.length > 0 ? requested : listScenarios();
  const exe = findExe();

  if (!fs.existsSync(exe)) {
    console.error(`找不到可执行文件：${exe}`);
    console.error('先运行 cargo build --release（或 npm run tauri:build），或用 USE_TOOLS_EXE 指定路径。');
    process.exit(1);
  }

  let failed = 0;
  for (const scenario of scenarios) {
    const code = await runScenario(scenario, exe);
    if (code !== 0) failed += 1;
  }

  console.log(failed === 0 ? '\n✔ 全部场景通过' : `\n✘ ${failed} 个场景失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

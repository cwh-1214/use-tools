'use strict';

/**
 * 端到端测试编排：npm run test:e2e [场景名...] [--release] [--rebuild] [--no-build]
 *
 * 产物默认取 `.build/target/debug/use-tools.exe`（增量构建快，适合日常回归）；
 * 加 `--release` 或设 USE_TOOLS_PROFILE=release 则用发布版产物。
 * 产物不存在时自动 `cargo build`；`--no-build` 则直接报错。
 * 也可以用 USE_TOOLS_EXE 指定任意构建产物。
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

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const scenarioDir = path.join(__dirname, 'e2e');
const outputDir = path.join(__dirname, 'output');
const targetDir = path.join(root, '.build', 'target');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
const requested = argv.filter((arg) => !arg.startsWith('--'));

const profile =
  process.env.USE_TOOLS_PROFILE === 'release' || flags.has('--release') ? 'release' : 'debug';

function listScenarios() {
  return fs
    .readdirSync(scenarioDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => name.replace(/\.js$/, ''))
    .sort();
}

function resolveFixtures(scenario) {
  const own = path.join(__dirname, 'fixtures', scenario);
  if (fs.existsSync(own)) {
    return fs
      .readdirSync(own)
      .sort()
      .map((name) => path.join(own, name));
  }
  return ['caseA.txt', 'caseB.txt'].map((name) => path.join(__dirname, 'fixtures', name));
}

function defaultExe() {
  const name = process.platform === 'win32' ? 'use-tools.exe' : 'use-tools';
  return path.join(targetDir, profile, name);
}

/** 返回可执行文件路径；必要时先构建 */
function ensureExe() {
  if (process.env.USE_TOOLS_EXE) return process.env.USE_TOOLS_EXE;

  const exe = defaultExe();
  if (fs.existsSync(exe) && !flags.has('--rebuild')) return exe;

  if (flags.has('--no-build')) {
    console.error(`找不到可执行文件：${exe}`);
    console.error('去掉 --no-build 让脚本自动构建，或先 npm run build:' + profile + '。');
    process.exit(1);
  }

  console.log(`▶ 构建 ${profile} 产物（首次较慢，之后增量）...`);
  const args = ['build', '--manifest-path', path.join('src-tauri', 'Cargo.toml')];
  if (profile === 'release') args.push('--release');

  const built = spawnSync('cargo', args, { cwd: root, stdio: 'inherit' });
  if (built.error) {
    console.error(`无法执行 cargo：${built.error.message}`);
    process.exit(1);
  }
  if (built.status !== 0) {
    console.error('构建失败，终止测试。');
    process.exit(built.status || 1);
  }
  if (!fs.existsSync(exe)) {
    console.error(`构建完成但找不到产物：${exe}`);
    process.exit(1);
  }
  return exe;
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
  const scenarios = requested.length > 0 ? requested : listScenarios();
  const exe = ensureExe();

  console.log(`▶ 产物: ${path.relative(root, exe)}（${profile}）`);

  let failed = 0;
  for (const scenario of scenarios) {
    const code = await runScenario(scenario, exe);
    if (code !== 0) failed += 1;
  }

  console.log(
    failed === 0
      ? `\n✔ ${scenarios.length} 个场景全部通过`
      : `\n✘ ${failed}/${scenarios.length} 个场景失败`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();

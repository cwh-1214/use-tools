'use strict';

/**
 * 发布打包：node scripts/package.js [--no-build] [--no-smoke]
 *
 *   1. cargo build --release（增量）
 *   2. 用内置冒烟跑一遍发布版产物（退出码 0 才算可用）
 *   3. 复制到 dist/use-tools-<version>.exe
 *   4. 打成 dist/use-tools-<version>-portable.zip
 *
 * 版本号以 package.json 为准；同时校验 Cargo.toml / tauri.conf.json 是否一致，
 * 不一致只警告不中断（发版前应当先统一，避免界面和 exe 资源版本对不上）。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const flags = new Set(process.argv.slice(2));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const exeName = process.platform === 'win32' ? 'use-tools.exe' : 'use-tools';

const targetDir = path.join(root, '.build', 'target');
const builtExe = path.join(targetDir, 'release', exeName);
const distDir = path.join(root, 'dist');
const outExe = path.join(distDir, `use-tools-${version}.exe`);
const zipPath = path.join(distDir, `use-tools-${version}-portable.zip`);

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function fail(message) {
  console.error(`\n✘ ${message}`);
  process.exit(1);
}

/** 版本号在四处各存一份，这里只做提醒，不改文件 */
function checkVersions() {
  const sources = [
    ['src-tauri/Cargo.toml', /^version\s*=\s*"([^"]+)"/m],
    ['src-tauri/tauri.conf.json', /"version"\s*:\s*"([^"]+)"/],
  ];
  for (const [file, pattern] of sources) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const found = text.match(pattern);
    if (!found) {
      console.warn(`⚠ ${file} 里找不到版本号`);
    } else if (found[1] !== version) {
      console.warn(`⚠ 版本不一致：package.json=${version}，${file}=${found[1]}`);
    }
  }
}

function buildRelease() {
  if (flags.has('--no-build')) {
    if (!fs.existsSync(builtExe)) fail(`没有现成的发布版产物：${path.relative(root, builtExe)}`);
    return;
  }
  console.log('▶ 构建发布版（release）...');
  const result = spawnSync(
    'cargo',
    ['build', '--release', '--manifest-path', path.join('src-tauri', 'Cargo.toml')],
    { cwd: root, stdio: 'inherit' }
  );
  if (result.error) fail(`无法执行 cargo：${result.error.message}`);
  if (result.status !== 0) fail('release 构建失败');
  if (!fs.existsSync(builtExe)) fail(`构建完成但找不到产物：${path.relative(root, builtExe)}`);
}

function smokeTest() {
  if (flags.has('--no-smoke')) {
    console.log('⚠ 已跳过冒烟（--no-smoke）');
    return;
  }
  console.log('▶ 冒烟自检发布版产物...');
  const reportPath = path.join(root, '.build', 'smoke-report.json');
  const configDir = path.join(root, '.build', 'smoke-config');
  fs.rmSync(reportPath, { force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.mkdirSync(configDir, { recursive: true });

  const result = spawnSync(builtExe, [], {
    cwd: root,
    env: {
      ...process.env,
      USE_TOOLS_SMOKE: '1',
      USE_TOOLS_SMOKE_OUT: reportPath,
      USE_TOOLS_CONFIG_DIR: configDir,
    },
    timeout: 120000,
    stdio: 'ignore',
  });

  if (result.error) fail(`冒烟启动失败：${result.error.message}`);
  if (result.status !== 0) {
    const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '（无报告）';
    console.error(report);
    fail(`冒烟未通过（exit ${result.status}）`);
  }
  console.log('✔ 冒烟通过');
}

/** Windows 用 PowerShell 自带的 Compress-Archive；其它平台退回 zip 命令 */
function makeZip(sourceFile, destination) {
  fs.rmSync(destination, { force: true });
  if (process.platform === 'win32') {
    if (sourceFile.includes("'")) fail('路径含单引号，无法安全传给 Compress-Archive');
    const script = `Compress-Archive -LiteralPath '${sourceFile}' -DestinationPath '${destination}' -Force`;
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { stdio: 'inherit' }
    );
    if (result.error) fail(`打包 zip 失败：${result.error.message}`);
    if (result.status !== 0) fail('打包 zip 失败');
    return;
  }
  const result = spawnSync('zip', ['-j', '-q', destination, sourceFile], { stdio: 'inherit' });
  if (result.error) fail(`打包 zip 失败：${result.error.message}`);
  if (result.status !== 0) fail('打包 zip 失败');
}

checkVersions();
buildRelease();
smokeTest();

fs.mkdirSync(distDir, { recursive: true });

// 目标文件可能正被运行中的实例占用，给出可操作的提示而不是一段堆栈
try {
  fs.copyFileSync(builtExe, outExe);
} catch (err) {
  if (err.code === 'EBUSY' || err.code === 'EPERM') {
    fail(`目标文件被占用：${path.relative(root, outExe)}\n  先退出正在运行的工具集再重试。`);
  }
  fail(`复制产物失败：${err.message}`);
}

makeZip(outExe, zipPath);

console.log('\n✔ 打包完成');
for (const file of [outExe, zipPath]) {
  console.log(`  ${path.relative(root, file)}  ${formatSize(fs.statSync(file).size)}`);
}

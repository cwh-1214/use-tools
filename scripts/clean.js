'use strict';

/**
 * 清理项目产物：node scripts/clean.js [--build] [--all]
 *
 *   默认      dist/ + test/output/
 *   --build   额外删 .build/（Cargo 编译缓存，删完下次构建会变慢）
 *   --all     等同 --build
 *
 * 只处理项目内固定路径，不接受外部传入目录。
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const flags = new Set(process.argv.slice(2));
const withBuild = flags.has('--build') || flags.has('--all');

const targets = [
  ['发布产物', path.join(root, 'dist')],
  ['测试产物', path.join(root, 'test', 'output')],
];
if (withBuild) targets.push(['编译缓存', path.join(root, '.build')]);

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

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* 文件可能刚好被删掉，忽略 */
        }
      }
    }
  }
  return total;
}

for (const [label, dir] of targets) {
  // 安全兜底：只允许删项目根之下的固定产物目录
  const relative = path.relative(root, dir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    console.error(`拒绝处理项目外路径：${dir}`);
    process.exitCode = 1;
    continue;
  }
  if (!fs.existsSync(dir)) {
    console.log(`跳过 ${label}（不存在）：${relative}`);
    continue;
  }
  const size = dirSize(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`已删除 ${label}：${relative}（${formatSize(size)}）`);
}

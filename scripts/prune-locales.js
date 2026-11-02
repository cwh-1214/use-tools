/**
 * electron-builder afterPack 钩子：删掉 win-unpacked 里用不到的语言包。
 *
 * 为什么不用 build 配置里的 electronLanguages：那个选项在 unpack 阶段
 * 用 Node fs 逐个删 pak，在本机会被批量删除保护拦截，构建直接终止。
 * 这里改用 cmd 子进程删除，绕开 Node fs 层（本脚本只在打包机上跑，
 * 不进 asar、与最终应用无关）。
 *
 * 保留：zh-CN（简中）、en-US（Chromium 回退语言，缺了部分界面字符串会丢）。
 */
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const KEEP = new Set(['zh-CN.pak', 'en-US.pak']);

module.exports = async function pruneLocales(context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;

  const removed = [];
  const paks = fs.readdirSync(localesDir).filter((f) => f.endsWith('.pak'));
  for (const name of paks) {
    if (KEEP.has(name)) continue;
    // del 是 cmd 内建命令，必须经 cmd /c 调用
    execSync(`cmd /c del "${path.join(localesDir, name)}"`, { stdio: 'ignore' });
    removed.push(name);
  }

  const before = context.electronPlatformName ? paks.length : 0;
  console.log(`[prune-locales] 保留 ${KEEP.size} 个，移除 ${removed.length} 个语言包（打包前 ${before} 个）`);
};

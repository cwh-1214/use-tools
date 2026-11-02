'use strict';

/**
 * 启动器。
 * 存在的原因：某些环境（例如从 Electron 系 IDE 内置终端启动时）会预设
 * ELECTRON_RUN_AS_NODE=1，导致 electron 被当成 Node 运行，主进程里
 * require('electron') 拿不到 app / protocol 而直接崩。这里显式剔除该变量。
 *
 * 用法：node scripts/launch.js [--dev|--smoke]
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const electronBinary = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => process.exit(code ?? 0));

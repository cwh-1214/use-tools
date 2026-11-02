/**
 * 工具清单 —— 唯一需要手动维护的注册点。
 *
 * 加一个工具：
 *   1. 复制 tools/_template 为 tools/<你的工具id>/
 *   2. 在下面 import 一行，并加进 tools 数组
 * 删一个工具：
 *   删掉对应 import 和数组项，再删掉文件夹即可（不留任何残留）。
 *
 * 顺序即侧边栏顺序，group 相同会自动归到一组。
 */

import jsonFormat from './json-format/index.js';
import base64 from './base64/index.js';
import timestamp from './timestamp/index.js';
import columnCompare from './column-compare/index.js';
import sqlIn from './sql-in/index.js';

export const tools = [jsonFormat, base64, timestamp, columnCompare, sqlIn];

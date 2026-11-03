'use strict';

/**
 * 读取 xlsx / xlsm 的某一列（Electron 侧实现，与 Rust 的 scan_spreadsheet 行为对齐）。
 *
 * 不引第三方库：xlsx 本质是一个 zip，里面是几份 XML。
 *   1. 解析 zip 中央目录，取出 xl/workbook.xml、xl/worksheets/sheetN.xml、xl/sharedStrings.xml
 *   2. sharedStrings 是字符串池，单元格 t="s" 时它的值是该池的下标
 *   3. 按行号补齐空洞（中间整行没数据也要算空行），与 calamine 的 Range 行为一致
 *
 * 只支持 xlsx/xlsm；旧版 .xls 是二进制 BIFF，请用户另存为 xlsx。
 */

const fs = require('node:fs/promises');
const zlib = require('node:zlib');

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** 从 zip 里把需要的文件取出来（只解压调用方要的，避免整包解压） */
function readZipEntries(buffer, wanted) {
  // EOCD 在文件末尾，最长 22 + 65535 字节注释
  const limit = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= limit; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx（找不到 zip 目录）');

  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const result = new Map();
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(offset) !== CEN_SIG) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);

    if (wanted(name) && !result.has(name)) {
      // 本地文件头里的 extra 长度可能与中央目录不同，必须重读
      if (buffer.readUInt32LE(localOffset) === LOC_SIG) {
        const locNameLen = buffer.readUInt16LE(localOffset + 26);
        const locExtraLen = buffer.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + locNameLen + locExtraLen;
        const raw = buffer.subarray(start, start + compressedSize);
        result.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
      }
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return result;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** 共享字符串池：每个 <si> 里可能有多段 <t>（富文本），拼起来 */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let si;
  while ((si = siRe.exec(xml))) {
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(si[1]))) text += decodeXml(t[1]);
    out.push(text);
  }
  return out;
}

/** "BC12" → { col: 54, row: 12 } */
function parseRef(ref) {
  const match = /^([A-Z]+)(\d+)$/.exec(String(ref || '').toUpperCase());
  if (!match) return null;
  let col = 0;
  for (const ch of match[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(match[2]) };
}

/** 单元格 XML → 文本；空单元格返回 null（与 Rust 的 cell_text 对齐） */
function cellValue(attrs, inner, shared) {
  const type = /\bt="([^"]*)"/.exec(attrs);
  const kind = type ? type[1] : 'n';

  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
  if (kind === 'inlineStr') {
    let text = '';
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(inner))) text += decodeXml(t[1]);
    return text === '' ? null : text;
  }
  if (!v) return null;

  const raw = decodeXml(v[1]);
  if (kind === 's') {
    const index = Number(raw);
    return Number.isInteger(index) && shared[index] !== undefined ? shared[index] : null;
  }
  if (kind === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  if (kind === 'e') return null; // #DIV/0! 之类，按空处理
  return raw;
}

/** 解析第一个工作表：返回 Map<行号, Map<列号, 文本>> */
function parseSheet(xml, shared) {
  const rows = new Map();
  let minRow = Infinity;
  let maxRow = 0;

  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let row;
  while ((row = rowRe.exec(xml))) {
    const attrs = row[1] || '';
    const inner = row[2] || '';
    const r = /\br="(\d+)"/.exec(attrs);
    let rowNo = r ? Number(r[1]) : rows.size + 1;

    const cells = new Map();
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cell;
    while ((cell = cellRe.exec(inner))) {
      const cellAttrs = cell[1] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(cellAttrs);
      const col = ref ? parseRef(ref[1]).col : cells.size;
      const value = cellValue(cellAttrs, cell[2] || '', shared);
      if (value !== null && value !== '') cells.set(col, value);
    }

    rows.set(rowNo, cells);
    if (rowNo < minRow) minRow = rowNo;
    if (rowNo > maxRow) maxRow = rowNo;
  }

  return { rows, minRow: minRow === Infinity ? 1 : minRow, maxRow };
}

/** 与文本路径同一套规则：trim → 去空 → 去重保序 */
function createCollector(columnIndex, trim) {
  const values = [];
  const seen = new Set();
  const stats = { totalLines: 0, emptyLines: 0, shortLines: 0 };

  return {
    feedRow(cells) {
      if (cells.size === 0) {
        stats.emptyLines += 1;
        return;
      }
      stats.totalLines += 1;

      if (!cells.has(columnIndex)) {
        stats.shortLines += 1;
        return;
      }

      const value = trim ? String(cells.get(columnIndex)).trim() : String(cells.get(columnIndex));
      if (!value || seen.has(value)) return;
      seen.add(value);
      values.push(value);
    },
    snapshot(bytes) {
      return {
        values,
        uniqueCount: values.length,
        totalLines: stats.totalLines,
        emptyLines: stats.emptyLines,
        shortLines: stats.shortLines,
        bytes,
      };
    },
  };
}

function isSpreadsheet(filePath) {
  const lower = String(filePath || '').toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xlsm');
}

function isLegacyXls(filePath) {
  return String(filePath || '').toLowerCase().endsWith('.xls');
}

/**
 * 读取表格的第一张工作表，取第 columnIndex 列（0 基）的唯一值
 * @param {{filePath: string, columnIndex?: number, trim?: boolean}} options
 */
async function scanSpreadsheet(options) {
  const { filePath, columnIndex = 0, trim = true } = options || {};
  if (typeof filePath !== 'string' || !filePath) throw new Error('缺少文件路径');

  const buffer = await fs.readFile(filePath);
  const entries = readZipEntries(
    buffer,
    (name) =>
      name === 'xl/sharedStrings.xml' ||
      name === 'xl/workbook.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );

  let sheetName = 'xl/worksheets/sheet1.xml';
  if (!entries.has(sheetName)) {
    // sheet1 不存在时按数字序取第一个工作表
    const names = [...entries.keys()]
      .filter((name) => name.startsWith('xl/worksheets/'))
      .sort((a, b) => {
        const na = Number((/sheet(\d+)\.xml$/.exec(a) || [])[1] || 0);
        const nb = Number((/sheet(\d+)\.xml$/.exec(b) || [])[1] || 0);
        return na - nb;
      });
    if (names.length === 0) throw new Error('表格里没有工作表');
    sheetName = names[0];
  }

  const shared = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8') || '');
  const { rows, minRow, maxRow } = parseSheet(entries.get(sheetName).toString('utf8'), shared);

  const collector = createCollector(columnIndex, trim);
  for (let rowNo = minRow; rowNo <= maxRow; rowNo += 1) {
    collector.feedRow(rows.get(rowNo) || new Map());
  }

  return collector.snapshot(buffer.length);
}

module.exports = { scanSpreadsheet, isSpreadsheet, isLegacyXls };

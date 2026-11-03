'use strict';

/**
 * 文本「按列抽取唯一值」。
 *
 * 两个入口共用同一套切分规则，避免「文件」与「粘贴文本」两条路径行为不一致：
 *   - scanColumn(options)      流式读文件，内存占用与文件大小无关
 *   - scanColumnFromText(opts) 直接处理字符串（来自界面粘贴）
 *
 * 行为对齐 Java 参考实现：
 *   - 空行（含纯空白行）跳过
 *   - 每行用分隔符切分，取第 columnIndex 列（0 基）
 *   - 列值 trim 后为空则跳过
 *   - 该列唯一值去重
 */

const fs = require('node:fs');
const { scanSpreadsheet, isSpreadsheet, isLegacyXls } = require('./xlsx-scan');

// TextDecoder 支持的 WHATWG 编码名，统一映射，避免各处写错
const ENCODING_ALIASES = {
  utf8: 'utf-8',
  'utf-8': 'utf-8',
  gbk: 'gb18030', // GBK 视作 GB18030 子集，用超集解码更稳
  ansi: 'gb18030', // 中文 Windows 的 ANSI 就是 CP936/GBK
  gb2312: 'gb18030',
  gb18030: 'gb18030',
  big5: 'big5',
  latin1: 'latin1',
};

const MAX_LINE_BYTES = 8 * 1024 * 1024; // 单行超过 8MB 视为异常，强制截断避免 OOM
const SNIFF_BYTES = 64 * 1024;

function normalizeEncoding(encoding) {
  const key = String(encoding || 'utf-8').toLowerCase();
  return ENCODING_ALIASES[key] || 'utf-8';
}

/**
 * 「自动」：有 BOM 按 BOM，能按 UTF-8 解就 UTF-8，否则按 ANSI（GB18030）。
 * 只读前 64KB 判断；stream:true 让末尾被截断的多字节字符不算错误。
 */
function detectEncoding(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const read = fs.readSync(fd, buffer, 0, SNIFF_BYTES, 0);
    const sample = buffer.subarray(0, read);

    if (sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) return 'utf-8';
    if (read === 0) return 'utf-8';

    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
      return 'utf-8';
    } catch {
      return 'gb18030';
    }
  } finally {
    fs.closeSync(fd);
  }
}

function assertOptions(options) {
  const { delimiter = '\t', columnIndex = 0 } = options || {};
  if (typeof delimiter !== 'string' || delimiter.length === 0) {
    throw new Error('分隔符不能为空');
  }
  if (!Number.isInteger(columnIndex) || columnIndex < 0) {
    throw new Error('列索引必须是非负整数');
  }
}

/** 逐行喂入的收集器：唯一值去重 + 行数统计 */
function createCollector({ delimiter, columnIndex, trim }) {
  const unique = new Map(); // value -> true，Map 保留首次出现顺序
  let totalLines = 0;
  let emptyLines = 0;
  let shortLines = 0;

  return {
    feedLine(rawLine) {
      let line = rawLine;
      if (line.endsWith('\r')) line = line.slice(0, -1);

      if (line.trim() === '') {
        emptyLines += 1;
        return;
      }
      totalLines += 1;

      const columns = line.split(delimiter);
      if (columnIndex >= columns.length) {
        shortLines += 1;
        return;
      }

      const value = trim ? columns[columnIndex].trim() : columns[columnIndex];
      if (value === '') return;
      if (!unique.has(value)) unique.set(value, true);
    },
    snapshot(extra) {
      return {
        values: [...unique.keys()],
        uniqueCount: unique.size,
        totalLines,
        emptyLines,
        shortLines,
        ...extra,
      };
    },
  };
}

/**
 * 流式扫描文件。
 * @param {object} options
 * @param {string} options.filePath
 * @param {string} options.delimiter   实际分隔符字符串（如 "\t"），支持多字符
 * @param {number} options.columnIndex 0 基列索引
 * @param {string} [options.encoding]  utf-8 / gbk / gb18030 / big5 / latin1
 * @param {boolean} [options.trim]     是否 trim 列值，默认 true
 * @returns {Promise<{values: string[], uniqueCount: number, totalLines: number, emptyLines: number, shortLines: number, bytes: number}>}
 */
function scanColumn(options) {
  const { filePath, delimiter = '\t', columnIndex = 0, encoding = 'utf-8', trim = true } =
    options || {};

  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('缺少文件路径');
  }

  // 表格走单元格路径：分隔符与编码都不适用
  if (isSpreadsheet(filePath)) {
    return scanSpreadsheet({ filePath, columnIndex, trim });
  }
  if (isLegacyXls(filePath)) {
    return Promise.reject(new Error('暂不支持旧版 .xls，请在 Excel 里另存为 .xlsx 后再选'));
  }

  assertOptions({ delimiter, columnIndex });

  return new Promise((resolve, reject) => {
    const resolved =
      String(encoding).toLowerCase() === 'auto' ? detectEncoding(filePath) : encoding;
    const decoder = new TextDecoder(normalizeEncoding(resolved));
    const collector = createCollector({ delimiter, columnIndex, trim });

    let bytes = 0;
    let carry = '';
    let settled = false;

    const stream = fs.createReadStream(filePath, { highWaterMark: 128 * 1024 });

    function drain(flushAll) {
      let index = carry.indexOf('\n');
      while (index >= 0) {
        collector.feedLine(carry.slice(0, index));
        carry = carry.slice(index + 1);
        index = carry.indexOf('\n');
      }
      // 超长单行的兜底：宁可切分，也不要让 carry 无限增长
      if (carry.length > MAX_LINE_BYTES) {
        collector.feedLine(carry);
        carry = '';
      }
      if (flushAll && carry.length > 0) {
        collector.feedLine(carry);
        carry = '';
      }
    }

    stream.on('data', (chunk) => {
      bytes += chunk.length;
      carry += decoder.decode(chunk, { stream: true });
      drain(false);
    });

    stream.on('end', () => {
      if (settled) return;
      settled = true;
      carry += decoder.decode();
      drain(true);
      resolve(collector.snapshot({ bytes }));
    });

    stream.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`读取文件失败：${err.message}`));
    });
  });
}

/**
 * 扫描一段文本（界面上粘贴的内容）。
 * 与 scanColumn 共用切分与去重规则，只是不需要解码和流式处理。
 * @param {object} options
 * @param {string} options.text
 * @param {string} options.delimiter
 * @param {number} options.columnIndex
 * @param {boolean} [options.trim]
 */
function scanColumnFromText(options) {
  const { text, delimiter = '\t', columnIndex = 0, trim = true } = options || {};

  if (typeof text !== 'string') {
    throw new Error('缺少文本内容');
  }
  assertOptions({ delimiter, columnIndex });

  const collector = createCollector({ delimiter, columnIndex, trim });

  // 统一换行后再切，兼容 \r\n / \r（老 Mac 换行）
  const normalized = text.replace(/\r\n?/g, '\n');
  for (const line of normalized.split('\n')) {
    collector.feedLine(line);
  }

  return collector.snapshot({ bytes: Buffer.byteLength(text, 'utf8') });
}

module.exports = { scanColumn, scanColumnFromText, normalizeEncoding };

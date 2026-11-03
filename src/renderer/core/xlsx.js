/**
 * 极简 xlsx 生成器：不引第三方库，直接拼 OOXML 再用「不压缩」的 ZIP 包起来。
 *
 * 只支持这个项目需要的形态：多个工作表、每个表一列纯文本（A 列，从第 1 行开始）。
 * 值一律按字符串写（inlineStr），所以 "001"、长数字、以 = 开头的内容都不会被 Excel 改写或当公式。
 *
 * 为什么不用现成库：渲染层是零依赖的，引一个几 MB 的表格库只为了写一列文本不划算；
 * 为什么可以不压缩：ZIP 允许 stored(0)，Excel/WPS 都认，省掉 deflate 的实现与依赖。
 */

const encoder = new TextEncoder();

/** Excel 单个工作表的行数上限（含标题行）；超过就只能拆表了 */
const EXCEL_MAX_ROWS = 1048576;

// ---------------------------------------------------------------- CRC32
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- ZIP（stored）
function concat(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function zipStore(files) {
  // 固定用 1980-01-01：xlsx 不关心 zip 时间戳，固定值省掉时区换算
  const DOS_TIME = 0;
  const DOS_DATE = 0x21;

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // 本地文件头
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // 文件名按 UTF-8
    lv.setUint16(8, 0, true); // 0 = stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    chunks.push(local, data);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true); // 中央目录
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // 本地头偏移
    entry.set(name, 46);
    central.push(entry);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // 中央目录结束
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return concat([...chunks, ...central, end]);
}

// ---------------------------------------------------------------- OOXML
/** XML 1.0 不允许的控制字符会让 Excel 直接报“文件损坏”，写入前先剔掉 */
function escapeXml(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 工作表名：≤31 字，不能含 []:*?/\，且不能为空 */
function sheetName(raw, index) {
  const cleaned = String(raw ?? '')
    .replace(/[[\]:*?\/\\]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

function sheetXml(values) {
  // 列宽按最长值粗略估算，至少 10、最多 80 字符，导出后不用手动拉宽
  let longest = 0;
  for (const value of values) {
    const length = String(value).length;
    if (length > longest) longest = length;
  }
  const width = Math.min(Math.max(longest + 2, 10), 80);

  const rows = values
    .map(
      (value, index) =>
        `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
          value
        )}</t></is></c></row>`
    )
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<cols><col min="1" max="1" width="${width}" customWidth="1"/></cols>` +
    `<sheetData>${rows}</sheetData>` +
    '</worksheet>'
  );
}

/**
 * 生成 xlsx 字节。
 * @param {{name: string, values: string[]}[]} sheets
 * @returns {Uint8Array}
 */
export function buildXlsx(sheets) {
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('至少需要一个工作表');
  }

  const names = [];
  for (let i = 0; i < sheets.length; i += 1) {
    let name = sheetName(sheets[i].name, i);
    // Excel 要求工作表名唯一，重名时补序号
    let suffix = 2;
    while (names.includes(name)) {
      name = `${sheetName(sheets[i].name, i).slice(0, 28)}(${suffix})`;
      suffix += 1;
    }
    names.push(name);

    const values = sheets[i].values;
    if (Array.isArray(values) && values.length > EXCEL_MAX_ROWS) {
      throw new Error(`「${name}」有 ${values.length} 行，超过 Excel 单表上限 ${EXCEL_MAX_ROWS}`);
    }
  }

  const files = [];

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_sheet, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    names
      .map(
        (name, i) =>
          `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join('') +
    '</sheets></workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names
      .map(
        (_name, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join('') +
    '</Relationships>';

  files.push({ name: '[Content_Types].xml', data: encoder.encode(contentTypes) });
  files.push({ name: '_rels/.rels', data: encoder.encode(rootRels) });
  files.push({ name: 'xl/workbook.xml', data: encoder.encode(workbook) });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) });

  sheets.forEach((sheet, i) => {
    files.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheetXml(Array.isArray(sheet.values) ? sheet.values : [])),
    });
  });

  return zipStore(files);
}

/** 二进制转 base64（分块，避免大文件把调用栈顶爆） */
export function bytesToBase64(bytes) {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

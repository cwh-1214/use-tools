/**
 * xlsx 生成器的离线验证（不依赖浏览器）
 * npm test  →  node test/xlsx.test.js
 *
 * 渲染层的模块是 ESM，这里用「去掉 export 再 Function 求值」的方式加载，
 * 免得为了一个测试给整个项目加构建步骤。
 */
const fs = require('node:fs');
const path = require('node:path');

const source = fs
  .readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'core', 'xlsx.js'), 'utf8')
  .replace(/^export /gm, '');
const { buildXlsx, bytesToBase64 } = new Function(
  `${source}; return { buildXlsx, bytesToBase64 };`
)();

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}\n       期望 ${e}\n       实际 ${a}`);
  }
}

/** 读 stored(0) 的 zip：返回 { 文件名: 文本 } */
function unzipStored(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('找不到 ZIP 中央目录结束标记');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const files = {};

  for (let i = 0; i < count; i += 1) {
    const nameLength = view.getUint16(offset + 28, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLength)).toString('utf8');

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const size = view.getUint32(localOffset + 18, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    files[name] = Buffer.from(bytes.subarray(start, start + size)).toString('utf8');

    offset += 46 + nameLength;
  }

  return files;
}

const valuesA = ['DIP001', 'DIP002'];
const valuesB = ['DIP003'];
const files = unzipStored(
  buildXlsx([
    { name: 'A 有 B 没有', values: valuesA },
    { name: 'B 有 A 没有', values: valuesB },
    { name: '两者共有', values: [] },
    { name: '合并去重', values: ['00123', '<a&b>', '=1+1', '含"引号"', '制表\t符'] },
  ])
);

console.log('== 包结构 ==');
check('包含 8 个部件', Object.keys(files).length, 8);
check('有内容类型表', Object.keys(files).includes('[Content_Types].xml'), true);
check('有 workbook', Object.keys(files).includes('xl/workbook.xml'), true);
check('有 4 个工作表', [1, 2, 3, 4].every((i) => `xl/worksheets/sheet${i}.xml` in files), true);

const workbook = files['xl/workbook.xml'];
const sheetNames = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
check('工作表名与顺序', sheetNames, ['A 有 B 没有', 'B 有 A 没有', '两者共有', '合并去重']);
check('四张表都挂上了 r:id', (workbook.match(/r:id="rId\d"/g) || []).length, 4);

console.log('== 单元格内容 ==');
const cellValues = (xml) => [...xml.matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map((m) => m[1]);
check('第一张表的值', cellValues(files['xl/worksheets/sheet1.xml']), valuesA);
check('第二张表的值', cellValues(files['xl/worksheets/sheet2.xml']), valuesB);
check('空表没有行', /<sheetData><\/sheetData>/.test(files['xl/worksheets/sheet3.xml']), true);

const special = cellValues(files['xl/worksheets/sheet4.xml']);
check('纯数字串原样保留', special[0], '00123');
check('尖括号与 & 被转义', special[1], '&lt;a&amp;b&gt;');
check('等号开头仍按文本写（不会被当公式）', /<c r="A3" t="inlineStr"><is><t xml:space="preserve">=1\+1<\/t>/.test(files['xl/worksheets/sheet4.xml']), true);
check('引号被转义', special[3], '含&quot;引号&quot;');
check('制表符保留', special[4], '制表\t符');

// 行号必须连续，否则 Excel 会认为文件损坏
const rows = [...files['xl/worksheets/sheet1.xml'].matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]));
check('行号从 1 连续递增', rows, [1, 2]);

console.log('== 名称与边界 ==');
const dup = unzipStored(
  buildXlsx([
    { name: '重名', values: ['a'] },
    { name: '重名', values: ['b'] },
  ])
);
const dupNames = [...dup['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
check('重名工作表自动补序号', dupNames, ['重名', '重名(2)']);

const illegal = unzipStored(buildXlsx([{ name: 'a/b:c*d?e[f]g' + 'x'.repeat(40), values: [] }]));
const illegalName = [...illegal['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])[0];
check('非法字符被替换且截断到 31 字', illegalName.length <= 31 && !/[[\]:*?\/\\]/.test(illegalName), true);

console.log('== base64 ==');
const bytes = buildXlsx([{ name: 's', values: ['x'] }]);
const base64 = bytesToBase64(bytes);
check('base64 解回来与原始字节一致', Buffer.from(base64, 'base64').equals(Buffer.from(bytes)), true);

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

/**
 * 列抽取逻辑的离线验证（不依赖 Electron）
 * npm test  →  node test/column-scan.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanColumn, scanColumnFromText } = require('../src/main/column-scan');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'use-tools-test-'));
const p = (name) => path.join(dir, name);

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

(async () => {
  // ---- 用例 1：制表符 + CRLF + 空行 + 重复值 ----
  fs.writeFileSync(
    p('a.txt'),
    'DIP001\t患者A\t100\r\nDIP002\t患者B\t200\r\n\r\nDIP003\t患者C\t300\r\nDIP005\t患者E\r\n   \r\nDIP001\t患者A重复\t999\r\n',
    'utf8'
  );
  const a = await scanColumn({ filePath: p('a.txt'), delimiter: '\t', columnIndex: 0 });
  check('A 列去重后数量', a.uniqueCount, 4);
  check('A 列值', a.values, ['DIP001', 'DIP002', 'DIP003', 'DIP005']);
  check('A 有效行数', a.totalLines, 5);
  check('A 空行数（含纯空白行）', a.emptyLines, 2);
  check('A 列数不足行数', a.shortLines, 0);

  // ---- 用例 2：逗号分隔 + 取第 2 列 + 前后空格 ----
  fs.writeFileSync(p('c.csv'), 'DIP001, 张三 ,x\nDIP002,李四,y\nDIP003, 张三 ,z\n', 'utf8');
  const c = await scanColumn({ filePath: p('c.csv'), delimiter: ',', columnIndex: 1 });
  check('逗号文件第 2 列 trim 后去重', c.values, ['张三', '李四']);

  // ---- 用例 3：列数不足的行被跳过 ----
  const short = await scanColumn({ filePath: p('a.txt'), delimiter: '\t', columnIndex: 5 });
  check('越界列全部跳过', short.uniqueCount, 0);
  check('越界列计入 shortLines', short.shortLines, 5);

  // ---- 用例 4：GBK 解码（院端数据常见编码） ----
  // "DIP001\t测试\n" 的 GBK 字节：测=B2E2 试=CAD4
  fs.writeFileSync(
    p('gbk.txt'),
    Buffer.from([0x44, 0x49, 0x50, 0x30, 0x30, 0x31, 0x09, 0xb2, 0xe2, 0xca, 0xd4, 0x0a])
  );
  const gbk = await scanColumn({ filePath: p('gbk.txt'), delimiter: '\t', columnIndex: 1, encoding: 'gbk' });
  check('GBK 解码正确', gbk.values, ['测试']);

  const wrong = await scanColumn({ filePath: p('gbk.txt'), delimiter: '\t', columnIndex: 1, encoding: 'utf-8' });
  check('用错编码得到乱码（说明编码选项确有必要）', wrong.values[0] !== '测试', true);

  // ---- 用例 5：UTF-8 BOM 剥离 ----
  fs.writeFileSync(p('bom.txt'), '\uFEFFDIP001\tX\nDIP002\tY\n', 'utf8');
  const bom = await scanColumn({ filePath: p('bom.txt'), delimiter: '\t', columnIndex: 0 });
  check('BOM 不影响首列取值', bom.values, ['DIP001', 'DIP002']);

  // ---- 用例 6：多字符分隔符 ----
  fs.writeFileSync(p('multi.txt'), 'DIP001::A\nDIP002::B\n', 'utf8');
  const multi = await scanColumn({ filePath: p('multi.txt'), delimiter: '::', columnIndex: 1 });
  check('多字符分隔符', multi.values, ['A', 'B']);

  // ---- 用例 7：大文件走流式，结果仍正确 ----
  const bigPath = p('big.txt');
  const lines = [];
  for (let i = 0; i < 60000; i += 1) lines.push(`K${i % 40000}\t值${i}\t${i}`);
  fs.writeFileSync(bigPath, `${lines.join('\n')}\n`, 'utf8');
  const big = await scanColumn({ filePath: bigPath, delimiter: '\t', columnIndex: 0 });
  check('6 万行文件唯一值数量', big.uniqueCount, 40000);
  check('6 万行文件总行数', big.totalLines, 60000);

  // ---- 用例 8：异常输入 ----
  try {
    await scanColumn({ filePath: p('not-exist.txt'), delimiter: '\t', columnIndex: 0 });
    fail += 1;
    console.log('  FAIL 缺文件应当抛错');
  } catch (err) {
    check('缺文件错误信息可读', /读取文件失败/.test(err.message), true);
  }

  try {
    await scanColumn({ filePath: p('a.txt'), delimiter: '', columnIndex: 0 });
    fail += 1;
    console.log('  FAIL 空分隔符应当抛错');
  } catch (err) {
    check('空分隔符报错', /分隔符/.test(err.message), true);
  }

  // ---- 用例 9：粘贴文本（\r\n + 末尾换行，模拟从 Excel 复制） ----
  const pasted = scanColumnFromText({
    text: 'DIP001\t张三\r\nDIP002\t李四\r\nDIP001\t张三\r\n',
    delimiter: '\t',
    columnIndex: 1,
  });
  check('粘贴文本：去重后唯一值', pasted.values, ['张三', '李四']);
  check('粘贴文本：行数统计', pasted.totalLines, 3);

  // ---- 用例 10：粘贴文本兼容 \r 换行（老 Mac） ----
  const crOnly = scanColumnFromText({ text: 'A\t1\rB\t2\rC\t3', delimiter: '\t', columnIndex: 0 });
  check('\\r 单换行也能切分', crOnly.values, ['A', 'B', 'C']);

  // ---- 用例 11：粘贴文本的空内容与越界列 ----
  const emptyText = scanColumnFromText({ text: '', delimiter: '\t', columnIndex: 0 });
  check('空文本唯一值为 0', emptyText.uniqueCount, 0);
  check('空文本行数为 0', emptyText.totalLines, 0);

  const beyond = scanColumnFromText({ text: 'A\t1\nB\t2\n', delimiter: '\t', columnIndex: 4 });
  check('粘贴文本越界列全部跳过', beyond.uniqueCount, 0);
  check('粘贴文本越界列计数', beyond.shortLines, 2);

  // ---- 用例 12：粘贴文本与文件路径结果必须一致 ----
  fs.writeFileSync(p('same.txt'), 'DIP001\tX\nDIP002\tY\nDIP003\tX\n', 'utf8');
  const viaFile = await scanColumn({ filePath: p('same.txt'), delimiter: '\t', columnIndex: 1 });
  const viaText = scanColumnFromText({ text: 'DIP001\tX\nDIP002\tY\nDIP003\tX\n', delimiter: '\t', columnIndex: 1 });
  check('文件与粘贴两条路径结果一致', viaText.values, viaFile.values);
  check('文件与粘贴行数一致', viaText.totalLines, viaFile.totalLines);

  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`\n${pass} 通过, ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();

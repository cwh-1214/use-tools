//! 文本「按列抽取唯一值」的 Rust 版，与 Electron 版 column-scan.js 行为一致。
//!
//! 两条入口共用同一套切分规则，避免「文件」与「粘贴文本」行为不一致：
//!   - scan_file  流式解码读取，内存占用与文件大小无关
//!   - scan_text  直接处理字符串（界面粘贴）
//!
//! 规则：空行跳过；按分隔符切分取第 columnIndex 列（0 基）；trim 后为空跳过；唯一值去重保序。

use calamine::{open_workbook_auto, Data, Reader};
use encoding_rs::{Encoding, BIG5, GB18030, UTF_8, WINDOWS_1252};
use encoding_rs_io::DecodeReaderBytesBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};

const CHUNK_BYTES: usize = 128 * 1024;
/// 「自动」编码的嗅探长度：一般文件前 64KB 足以判定
const SNIFF_BYTES: usize = 64 * 1024;

fn default_delimiter() -> String {
    "\t".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOptions {
    pub file_path: String,
    #[serde(default = "default_delimiter")]
    pub delimiter: String,
    #[serde(default)]
    pub column_index: usize,
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default = "default_true")]
    pub trim: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextScanOptions {
    pub text: String,
    #[serde(default = "default_delimiter")]
    pub delimiter: String,
    #[serde(default)]
    pub column_index: usize,
    #[serde(default = "default_true")]
    pub trim: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub values: Vec<String>,
    pub unique_count: usize,
    pub total_lines: usize,
    pub empty_lines: usize,
    pub short_lines: usize,
    pub bytes: u64,
}

/// 逐行喂入的收集器：唯一值去重 + 行数统计
struct Collector {
    // 必须存字符串而不是字符集合：split(&[char]) 会按「任意一个字符」切分，
    // 那样 "||" 和 "|" 等价，多字符分隔符就失效了
    delimiter: String,
    column_index: usize,
    trim: bool,
    unique: Vec<String>,
    seen: HashSet<String>,
    total_lines: usize,
    empty_lines: usize,
    short_lines: usize,
}

impl Collector {
    fn new(delimiter: &str, column_index: usize, trim: bool) -> Self {
        Collector {
            delimiter: delimiter.to_string(),
            column_index,
            trim,
            unique: Vec::new(),
            seen: HashSet::new(),
            total_lines: 0,
            empty_lines: 0,
            short_lines: 0,
        }
    }

    fn feed_line(&mut self, raw_line: &str) {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);

        if line.trim().is_empty() {
            self.empty_lines += 1;
            return;
        }
        self.total_lines += 1;

        let columns: Vec<&str> = line.split(self.delimiter.as_str()).collect();
        if self.column_index >= columns.len() {
            self.short_lines += 1;
            return;
        }

        self.push_value(columns[self.column_index]);
    }

    /// trim → 去空 → 去重保序；文本行与表格单元格共用这一套规则
    fn push_value(&mut self, raw_value: &str) {
        let value = if self.trim {
            raw_value.trim()
        } else {
            raw_value
        };
        if value.is_empty() {
            return;
        }
        if self.seen.insert(value.to_string()) {
            self.unique.push(value.to_string());
        }
    }

    /// 表格的一行：整行为空算空行；目标列没有内容算「列数不足」
    fn feed_row(&mut self, row: &[Data]) {
        let cells: Vec<Option<String>> = row.iter().map(cell_text).collect();

        let has_any = cells
            .iter()
            .any(|cell| cell.as_deref().map(|v| !v.trim().is_empty()).unwrap_or(false));
        if !has_any {
            self.empty_lines += 1;
            return;
        }
        self.total_lines += 1;

        match cells.get(self.column_index).and_then(|cell| cell.as_deref()) {
            Some(value) => self.push_value(value),
            None => self.short_lines += 1,
        }
    }

    fn snapshot(self, bytes: u64) -> ScanResult {
        ScanResult {
            unique_count: self.unique.len(),
            values: self.unique,
            total_lines: self.total_lines,
            empty_lines: self.empty_lines,
            short_lines: self.short_lines,
            bytes,
        }
    }
}

fn validate(delimiter: &str, column_index: usize) -> Result<(), String> {
    let _ = column_index; // 0 基 usize 天然非负，只需校验分隔符
    if delimiter.is_empty() {
        return Err("分隔符不能为空".into());
    }
    Ok(())
}

/// 单元格转文本：整数型浮点不要带 ".0"；空单元格返回 None
fn cell_text(cell: &Data) -> Option<String> {
    match cell {
        Data::Empty => None,
        Data::String(text) => Some(text.clone()),
        Data::Float(value) => {
            if value.is_finite() && value.fract() == 0.0 && value.abs() < 1e15 {
                Some(format!("{}", *value as i64))
            } else {
                Some(format!("{value}"))
            }
        }
        Data::Int(value) => Some(value.to_string()),
        Data::Bool(value) => Some(if *value { "TRUE" } else { "FALSE" }.to_string()),
        Data::DateTime(value) => Some(value.to_string()),
        Data::DateTimeIso(value) => Some(value.clone()),
        Data::DurationIso(value) => Some(value.clone()),
        Data::Error(_) => None,
    }
}

/// 只认 xlsx / xlsm：老 .xls 是二进制 BIFF，两边解析差异大，统一要求另存
pub fn is_spreadsheet(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".xlsx") || lower.ends_with(".xlsm")
}

fn is_legacy_xls(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".xls")
}

/// 按列读取表格（xlsx/xlsm）：取第一个工作表，第 column_index 列（0 基）
pub fn scan_spreadsheet(
    path: &str,
    column_index: usize,
    trim: bool,
) -> Result<ScanResult, String> {
    let mut workbook = open_workbook_auto(path).map_err(|err| format!("打开表格失败：{err}"))?;
    let sheet_name = workbook
        .sheet_names()
        .first()
        .cloned()
        .ok_or_else(|| "表格里没有工作表".to_string())?;
    let range = workbook
        .worksheet_range(&sheet_name)
        .map_err(|err| format!("读取工作表「{sheet_name}」失败：{err}"))?;

    let mut collector = Collector::new("", column_index, trim);
    for row in range.rows() {
        collector.feed_row(row);
    }

    let bytes = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    Ok(collector.snapshot(bytes))
}

/// 样本是否「像 UTF-8」：末尾被截断的多字节字符不算错误
fn looks_like_utf8(sample: &[u8]) -> bool {
    match std::str::from_utf8(sample) {
        Ok(_) => true,
        Err(err) => err.error_len().is_none() && err.valid_up_to() + 4 >= sample.len(),
    }
}

/// 「自动」：有 BOM 按 BOM，能按 UTF-8 解就 UTF-8，否则按 ANSI（GB18030）
fn sniff_encoding(file: &mut File) -> &'static Encoding {
    let mut sample = vec![0u8; SNIFF_BYTES];
    let read = file.read(&mut sample).unwrap_or(0);
    let sample = &sample[..read];
    let _ = file.seek(SeekFrom::Start(0));

    if let Some((encoding, _)) = Encoding::for_bom(sample) {
        return encoding;
    }
    if sample.is_empty() || looks_like_utf8(sample) {
        return UTF_8;
    }
    GB18030
}

/// GBK 视作 GB18030 子集，用超集解码更稳（中文 Windows 上 GBK 文件最常见的坑）
fn resolve_encoding(label: Option<&str>) -> &'static Encoding {
    match label.unwrap_or("utf-8").to_ascii_lowercase().as_str() {
        "gbk" | "gb2312" | "gb18030" | "cp936" | "ansi" => GB18030,
        "big5" => BIG5,
        "latin1" | "iso-8859-1" => WINDOWS_1252,
        _ => UTF_8,
    }
}

pub fn scan_file(options: ScanOptions) -> Result<ScanResult, String> {
    if options.file_path.is_empty() {
        return Err("缺少文件路径".into());
    }

    // 表格走单元格路径：分隔符与编码都不适用
    if is_spreadsheet(&options.file_path) {
        return scan_spreadsheet(&options.file_path, options.column_index, options.trim);
    }
    if is_legacy_xls(&options.file_path) {
        return Err("暂不支持旧版 .xls，请在 Excel 里另存为 .xlsx 后再选".into());
    }

    validate(&options.delimiter, options.column_index)?;

    let mut file = File::open(&options.file_path).map_err(|err| format!("读取文件失败：{err}"))?;
    let encoding = if options
        .encoding
        .as_deref()
        .map(|label| label.eq_ignore_ascii_case("auto"))
        .unwrap_or(false)
    {
        sniff_encoding(&mut file)
    } else {
        resolve_encoding(options.encoding.as_deref())
    };
    let _ = file.seek(SeekFrom::Start(0));

    // DecodeReaderBytes 负责流式转码，边界上的多字节字符不会被切断
    let decoded = DecodeReaderBytesBuilder::new()
        .encoding(Some(encoding))
        .build(file);
    let mut reader = BufReader::with_capacity(CHUNK_BYTES, decoded);

    let mut collector = Collector::new(&options.delimiter, options.column_index, options.trim);
    let mut raw_line: Vec<u8> = Vec::with_capacity(4096);
    let mut bytes: u64 = 0;

    loop {
        raw_line.clear();
        let read = reader
            .read_until(b'\n', &mut raw_line)
            .map_err(|err| format!("读取文件失败：{err}"))?;
        if read == 0 {
            break;
        }
        bytes += read as u64;

        // 解码器输出的一定是 UTF-8；去掉行尾换行后交给收集器
        let text = String::from_utf8_lossy(&raw_line);
        let line = text.strip_suffix('\n').unwrap_or(&text);
        collector.feed_line(line);
    }

    Ok(collector.snapshot(bytes))
}

pub fn scan_text(options: TextScanOptions) -> Result<ScanResult, String> {
    validate(&options.delimiter, options.column_index)?;

    let mut collector = Collector::new(&options.delimiter, options.column_index, options.trim);
    let bytes = options.text.len() as u64;

    // 统一换行后再切，兼容 \r\n / \r（老 Mac 换行）
    for line in options.text.split('\n') {
        collector.feed_line(line);
    }

    Ok(collector.snapshot(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(text: &str, delimiter: &str, column: usize) -> TextScanOptions {
        TextScanOptions {
            text: text.to_string(),
            delimiter: delimiter.to_string(),
            column_index: column,
            trim: true,
        }
    }

    #[test]
    fn 唯一值去重且保序() {
        let result = scan_text(opts("a\t1\nb\t2\na\t3\n", "\t", 0)).unwrap();
        assert_eq!(result.values, vec!["a", "b"]);
        assert_eq!(result.unique_count, 2);
        assert_eq!(result.total_lines, 3);
    }

    #[test]
    fn 空行与短行被计数并跳过() {
        let result = scan_text(opts("a\t1\n\n   \nb\n", "\t", 1)).unwrap();
        assert_eq!(result.values, vec!["1"]);
        // 末尾换行也算一个空行：三处空白行 + 一行短行
        assert_eq!(result.empty_lines, 3);
        assert_eq!(result.short_lines, 1);
        assert_eq!(result.total_lines, 2);
    }

    #[test]
    fn 多字符分隔符按整体切分() {
        let result = scan_text(opts("a||1\nb||2\n", "||", 1)).unwrap();
        assert_eq!(result.values, vec!["1", "2"]);
    }

    #[test]
    fn 表格按列取单元格并跳过空行() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures/compare.xlsx");
        // 第 1 列：表头 + u1001 / u1002 / u1003（u1003 出现两次，去重）
        let first = scan_spreadsheet(path, 0, true).unwrap();
        assert_eq!(first.values, vec!["用户ID", "u1001", "u1002", "u1003"]);
        assert_eq!(first.unique_count, 4);
        assert_eq!(first.total_lines, 5); // 6 行里有一行整行为空
        assert_eq!(first.empty_lines, 1);

        // 第 2 列：状态列
        let second = scan_spreadsheet(path, 1, true).unwrap();
        assert_eq!(second.values, vec!["状态", "活跃", "流失"]);
    }

    #[test]
    fn 表格缺列计为列数不足() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../test/fixtures/compare.xlsx");
        let result = scan_spreadsheet(path, 5, true).unwrap();
        assert!(result.values.is_empty());
        assert_eq!(result.short_lines, result.total_lines);
    }

    #[test]
    fn 扩展名识别与老xls拒绝() {
        assert!(is_spreadsheet(r"D:\a\b.XLSX"));
        assert!(is_spreadsheet("c.xlsm"));
        assert!(!is_spreadsheet("c.csv"));

        let err = scan_file(ScanOptions {
            file_path: r"D:\nope.xls".to_string(),
            delimiter: "\t".to_string(),
            column_index: 0,
            encoding: None,
            trim: true,
        })
        .unwrap_err();
        assert!(err.contains(".xlsx"), "实际错误：{err}");
    }
}

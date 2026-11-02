//! 文本「按列抽取唯一值」的 Rust 版，与 Electron 版 column-scan.js 行为一致。
//!
//! 两条入口共用同一套切分规则，避免「文件」与「粘贴文本」行为不一致：
//!   - scan_file  流式解码读取，内存占用与文件大小无关
//!   - scan_text  直接处理字符串（界面粘贴）
//!
//! 规则：空行跳过；按分隔符切分取第 columnIndex 列（0 基）；trim 后为空跳过；唯一值去重保序。

use encoding_rs::{Encoding, BIG5, GB18030, UTF_8, WINDOWS_1252};
use encoding_rs_io::DecodeReaderBytesBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};

const CHUNK_BYTES: usize = 128 * 1024;

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

        let raw_value = columns[self.column_index];
        let value = if self.trim {
            raw_value.trim().to_string()
        } else {
            raw_value.to_string()
        };
        if value.is_empty() {
            return;
        }
        if self.seen.insert(value.clone()) {
            self.unique.push(value);
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

/// GBK 视作 GB18030 子集，用超集解码更稳（中文 Windows 上 GBK 文件最常见的坑）
fn resolve_encoding(label: Option<&str>) -> &'static Encoding {
    match label.unwrap_or("utf-8").to_ascii_lowercase().as_str() {
        "gbk" | "gb2312" | "gb18030" | "cp936" => GB18030,
        "big5" => BIG5,
        "latin1" | "iso-8859-1" => WINDOWS_1252,
        _ => UTF_8,
    }
}

pub fn scan_file(options: ScanOptions) -> Result<ScanResult, String> {
    if options.file_path.is_empty() {
        return Err("缺少文件路径".into());
    }
    validate(&options.delimiter, options.column_index)?;

    let encoding = resolve_encoding(options.encoding.as_deref());
    let file = File::open(&options.file_path).map_err(|err| format!("读取文件失败：{err}"))?;

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
}

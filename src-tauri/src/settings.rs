//! 设置持久化：一个 JSON 文件（原子写入：临时文件 + rename）。
//!
//! 写入策略：合并到内存 → 300ms 防抖 → 写临时文件 → rename。
//! rename 在同一分区上是原子的，因此不会出现「写到一半断电，设置变成半截 JSON」。

use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

const WRITE_DELAY_MS: u64 = 300;

fn defaults() -> Value {
    json!({
        "schema": 1,
        "window": { "width": null, "height": null, "x": null, "y": null, "maximized": false },
        "ui": { "lastRoute": "", "recent": [], "theme": "system", "closeToTray": true, "hotkey": "Ctrl+Shift+Space" },
        "tools": {},
        "flags": {}
    })
}

/// 深合并：对象逐键合并，数组与标量直接替换。
/// 工具配置的局部更新依赖这个语义（patchTool 只回传自己那一段）。
fn merge(base: &Value, patch: &Value) -> Value {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            let mut out: Map<String, Value> = base_map.clone();
            for (key, value) in patch_map {
                let merged = match out.get(key) {
                    Some(existing) if existing.is_object() && value.is_object() => {
                        merge(existing, value)
                    }
                    _ => value.clone(),
                };
                out.insert(key.clone(), merged);
            }
            Value::Object(out)
        }
        _ => patch.clone(),
    }
}

fn read_or_default(path: &PathBuf) -> Value {
    let base = defaults();
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return base,
        Err(err) => {
            eprintln!("[store] 读取设置失败，使用默认值: {err}");
            return base;
        }
    };

    match serde_json::from_str::<Value>(&raw) {
        Ok(parsed) => merge(&base, &parsed),
        Err(_) => {
            // 文件损坏时留个备份，不要把用户的设置直接抹掉
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let backup = path.with_extension(format!("json.corrupt-{stamp}"));
            let _ = fs::rename(path, backup);
            eprintln!("[store] 设置文件不是合法 JSON，已备份并回退默认值");
            base
        }
    }
}

fn write_now(path: &PathBuf, data: &Mutex<Value>) {
    let snapshot = match data.lock() {
        Ok(guard) => serde_json::to_string_pretty(&*guard).unwrap_or_else(|_| "{}".into()),
        Err(_) => return,
    };

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, snapshot).is_err() {
        eprintln!("[store] 写入设置失败");
        return;
    }
    // Windows 上 rename 不能覆盖已存在文件（Rust fs::rename 内部用 MoveFileEx 会覆盖，
    // 但为稳妥起见先删目标，失败也不影响：下一次防抖还会再写）
    let _ = fs::remove_file(path);
    if let Err(err) = fs::rename(&tmp, path) {
        eprintln!("[store] 设置落盘失败: {err}");
    }
}

pub struct Store {
    path: PathBuf,
    data: Arc<Mutex<Value>>,
    tx: mpsc::Sender<()>,
}

impl Store {
    pub fn load(path: PathBuf) -> Arc<Self> {
        let data = Arc::new(Mutex::new(read_or_default(&path)));
        let (tx, rx) = mpsc::channel::<()>();

        let worker_data = data.clone();
        let worker_path = path.clone();
        thread::spawn(move || {
            // 收到第一个信号后再多等 300ms，把这一波改动合并成一次落盘
            while rx.recv().is_ok() {
                // 持续接收直到这一波安静下来（超时或发送端断开）
                while rx
                    .recv_timeout(Duration::from_millis(WRITE_DELAY_MS))
                    .is_ok()
                {}
                write_now(&worker_path, &worker_data);
            }
        });

        Arc::new(Store { path, data, tx })
    }

    /// 返回快照，调用方随便改都不会污染内存里的状态
    pub fn get(&self) -> Value {
        self.data
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| defaults())
    }

    pub fn update(&self, patch: &Value) -> Value {
        let snapshot = {
            let mut guard = match self.data.lock() {
                Ok(guard) => guard,
                Err(_) => return self.get(),
            };
            *guard = merge(&guard.clone(), patch);
            guard.clone()
        };
        let _ = self.tx.send(());
        snapshot
    }

    /// 工具配置的便捷入口：工具只管自己的 namespace，不碰别人的
    pub fn patch_tool(&self, tool_id: &str, partial: &Value) -> Value {
        self.update(&json!({ "tools": { tool_id: partial } }))
    }

    /// 读一个 UI 布尔开关，缺失时用默认值
    pub fn ui_flag(&self, key: &str, default: bool) -> bool {
        self.get()
            .get("ui")
            .and_then(|ui| ui.get(key))
            .and_then(|value| value.as_bool())
            .unwrap_or(default)
    }

    pub fn ui_string(&self, key: &str, default: &str) -> String {
        self.get()
            .get("ui")
            .and_then(|ui| ui.get(key))
            .and_then(|value| value.as_str())
            .unwrap_or(default)
            .to_string()
    }

    /// 退出前调用，把防抖窗口里还没落盘的改动写下去
    pub fn flush(&self) {
        write_now(&self.path, &self.data);
    }
}

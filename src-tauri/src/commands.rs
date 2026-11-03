//! 命令层：与 Electron 版 ipc.js + preload.js 暴露的契约一一对应。
//! 渲染进程看到的仍然是 window.api.*，只是底层从 ipcRenderer.invoke 换成了 tauri invoke。

use crate::column_scan::{self, ScanOptions, ScanResult, TextScanOptions};
use crate::AppState;
use encoding_rs::{Encoding, UTF_8};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

const MAX_TEXT_FILE_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickFileArgs {
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTextArgs {
    pub title: Option<String>,
    pub default_name: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextArgs {
    pub path: String,
    pub encoding: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchToolArgs {
    pub tool_id: String,
    pub partial: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub size: u64,
    pub mtime: u64,
    pub is_file: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri: String,
    pub webview: String,
    pub platform: String,
}

// ---------------------------------------------------------------------------
// 文件对话框
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn pick_file(app: AppHandle, args: Option<PickFileArgs>) -> Result<Option<String>, String> {
    let title = args
        .and_then(|a| a.title)
        .unwrap_or_else(|| "选择文件".to_string());

    // 对话框回调走事件循环，这里用 channel 把它同步回来。
    // 命令跑在异步运行时线程上，阻塞等待不会卡住主线程。
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(&title)
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });

    let picked = rx.recv().map_err(|err| err.to_string())?;
    Ok(picked
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn save_text(app: AppHandle, args: SaveTextArgs) -> Result<Option<String>, String> {
    let title = args.title.unwrap_or_else(|| "保存文件".to_string());
    let default_name = args.default_name.unwrap_or_else(|| "untitled.txt".to_string());
    let content = args.content.unwrap_or_default();

    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .set_title(&title)
        .set_file_name(&default_name)
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });

    let picked = rx.recv().map_err(|err| err.to_string())?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };

    std::fs::write(&path, content).map_err(|err| format!("写入失败：{err}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

// ---------------------------------------------------------------------------
// 文件读写
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_text(args: ReadTextArgs) -> Result<String, String> {
    let meta = std::fs::metadata(&args.path).map_err(|err| format!("读取文件失败：{err}"))?;
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "文件过大（{:.1}MB），超过 {}MB 上限",
            meta.len() as f64 / 1024.0 / 1024.0,
            MAX_TEXT_FILE_BYTES / 1024 / 1024
        ));
    }

    let bytes = std::fs::read(&args.path).map_err(|err| format!("读取文件失败：{err}"))?;
    let label = args.encoding.unwrap_or_else(|| "utf-8".to_string());
    let encoding: &Encoding = match label.to_ascii_lowercase().as_str() {
        // 自动：能按 UTF-8 解就用 UTF-8，否则按 ANSI（GB18030）
        "auto" => {
            if std::str::from_utf8(&bytes).is_ok() {
                UTF_8
            } else {
                encoding_rs::GB18030
            }
        }
        "gbk" | "gb2312" | "gb18030" | "cp936" | "ansi" => encoding_rs::GB18030,
        "big5" => encoding_rs::BIG5,
        "latin1" | "iso-8859-1" => encoding_rs::WINDOWS_1252,
        _ => UTF_8,
    };

    // BOM 会粘在第一个值上，导致生成的 IN 列表第一个值永远匹配不到
    let (text, _had_errors) = encoding.decode_with_bom_removal(&bytes);
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

#[tauri::command]
pub fn basename(path: String) -> String {
    Path::new(&path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone())
}

#[tauri::command]
pub fn stat(path: String) -> Result<FileMeta, String> {
    let meta = std::fs::metadata(&path).map_err(|err| format!("读取失败：{err}"))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Ok(FileMeta {
        size: meta.len(),
        mtime,
        is_file: meta.is_file(),
    })
}

// ---------------------------------------------------------------------------
// 列扫描
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn scan_column(args: ScanOptions) -> Result<ScanResult, String> {
    column_scan::scan_file(args)
}

#[tauri::command]
pub async fn scan_column_text(args: TextScanOptions) -> Result<ScanResult, String> {
    column_scan::scan_text(args)
}

// ---------------------------------------------------------------------------
// 系统集成
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn show_item_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // explorer /select 需要把路径和开关放在同一个参数里
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
            .spawn()
            .map(|_| ())
            .map_err(|err| format!("打开资源管理器失败：{err}"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("当前平台暂不支持".into())
    }
}

#[tauri::command]
pub fn clipboard_read_text(app: AppHandle) -> Result<String, String> {
    app.clipboard()
        .read_text()
        .map_err(|err| format!("读取剪贴板失败：{err}"))
}

#[tauri::command]
pub fn clipboard_write_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(text)
        .map_err(|err| format!("写入剪贴板失败：{err}"))
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let webview = tauri::webview_version().unwrap_or_default();

    AppInfo {
        name: "工具集".to_string(),
        version: app.package_info().version.to_string(),
        tauri: tauri::VERSION.to_string(),
        webview,
        platform: std::env::consts::OS.to_string(),
    }
}

// ---------------------------------------------------------------------------
// 设置与主题
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Value {
    state.store.get()
}

#[tauri::command]
pub fn settings_update(state: State<'_, AppState>, patch: Value) -> Result<Value, String> {
    if !patch.is_object() {
        return Err("settings_update 需要一个对象".into());
    }
    Ok(state.store.update(&patch))
}

#[tauri::command]
pub fn settings_patch_tool(state: State<'_, AppState>, args: PatchToolArgs) -> Result<Value, String> {
    if args.tool_id.is_empty() {
        return Err("toolId 非法".into());
    }
    if !args.partial.is_object() {
        return Err("patchTool 需要一个对象".into());
    }
    Ok(state.store.patch_tool(&args.tool_id, &args.partial))
}

#[tauri::command]
pub fn theme_set(app: AppHandle, state: State<'_, AppState>, mode: String) -> Result<Value, String> {
    let theme = match mode.as_str() {
        "system" => None,
        "light" => Some(tauri::Theme::Light),
        "dark" => Some(tauri::Theme::Dark),
        other => return Err(format!("未知主题模式: {other}")),
    };

    let mut dark = mode == "dark";
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_theme(theme);
        if mode == "system" {
            dark = matches!(win.theme(), Ok(tauri::Theme::Dark));
        }
    }

    state.store.update(&json!({ "ui": { "theme": mode } }));
    Ok(json!({ "theme": mode, "dark": dark }))
}

/// 从渲染进程隐藏窗口（配合全局快捷键的唤出，形成往返）
#[tauri::command]
pub fn app_hide(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

/// 供渲染层主动触发「唤出」时的聚焦事件（保持与 Electron 版同名事件）
#[tauri::command]
pub fn app_emit_summoned(app: AppHandle) {
    let _ = app.emit("app:summoned", ());
}

// ---------------------------------------------------------------------------
// 设置页：全局快捷键与数据目录
// ---------------------------------------------------------------------------

/// 当前快捷键状态：accelerator 用于展示，registered 表示是否真的注册上了
#[tauri::command]
pub fn hotkey_state(app: AppHandle) -> Value {
    let state = app.state::<AppState>();
    let accelerator = state.store.ui_string("hotkey", crate::DEFAULT_HOTKEY);
    let registered = state.hotkey_ok.load(std::sync::atomic::Ordering::Relaxed);
    json!({ "accelerator": accelerator, "label": accelerator, "registered": registered })
}

/// 换快捷键：先注销旧的，新的注册失败就回滚，别把用户「改到没有快捷键」
#[tauri::command]
pub fn set_hotkey(app: AppHandle, accelerator: String) -> Value {
    let next = accelerator.trim().to_string();
    if next.is_empty() {
        return json!({ "ok": false, "error": "快捷键不能为空" });
    }

    let state = app.state::<AppState>();
    let prev = state.store.ui_string("hotkey", crate::DEFAULT_HOTKEY);
    let _ = app.global_shortcut().unregister(prev.as_str());

    if crate::register_hotkey(&app, &next) {
        state.store.update(&json!({ "ui": { "hotkey": next.clone() } }));
        state.hotkey_ok.store(true, std::sync::atomic::Ordering::Relaxed);
        crate::refresh_tray_menu(&app);
        json!({ "ok": true, "accelerator": next.clone(), "label": next, "registered": true })
    } else {
        let restored = crate::register_hotkey(&app, &prev);
        state
            .hotkey_ok
            .store(restored, std::sync::atomic::Ordering::Relaxed);
        crate::refresh_tray_menu(&app);
        json!({
            "ok": false,
            "error": format!("{next} 被其它软件占用或不被支持"),
            "accelerator": prev.clone(),
            "label": prev,
            "registered": restored
        })
    }
}

/// 设置文件所在目录（%APPDATA%\com.usertools.desktop）
#[tauri::command]
pub fn data_dir(app: AppHandle) -> String {
    app.path()
        .app_config_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_default()
}

/// 用资源管理器打开上面那个目录
#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("explorer");
        c.arg(&dir);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(&dir);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&dir);
        c
    };
    cmd.spawn().map(|_| ()).map_err(|err| err.to_string())
}

//! 应用外壳：窗口、托盘、全局快捷键、单实例、窗口几何记忆。
//!
//! 把 BrowserWindow/Tray/globalShortcut
//! 换成了 Tauri 的等价物。渲染层逻辑与工具代码完全没动。

mod column_scan;
mod commands;
mod settings;
mod smoke;

use serde_json::json;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, Theme, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use settings::Store;

/// 默认全局快捷键；实际值存在 settings.json 的 ui.hotkey 里，可被设置页改掉
pub(crate) const DEFAULT_HOTKEY: &str = "Ctrl+Shift+Space";
const BOUNDS_SETTLE_MS: u64 = 320;

pub struct AppState {
    pub store: Arc<Store>,
    pub hotkey_ok: AtomicBool,
    /// 窗口几何变化信号；后台线程收到后等窗口安静下来再落盘
    bounds_tx: mpsc::Sender<()>,
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

/// "1120x720" → (1120.0, 720.0)
fn parse_size(raw: &str) -> Option<(f64, f64)> {
    let (width, height) = raw.split_once('x')?;
    Some((width.trim().parse().ok()?, height.trim().parse().ok()?))
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show_window(app: &AppHandle) {
    if let Some(win) = main_window(app) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// 快捷键行为：可见且有焦点 → 隐藏；否则唤出。这是工具箱最顺手的往返
fn toggle_window(app: &AppHandle) {
    let Some(win) = main_window(app) else { return };
    let visible = win.is_visible().unwrap_or(false);
    let focused = win.is_focused().unwrap_or(false);

    if visible && focused {
        let _ = win.hide();
    } else {
        show_window(app);
        // 唤出后直接聚焦搜索框，输入关键字回车就进工具，一气呵成
        let _ = app.emit("app:summoned", ());
    }
}

fn restore_window_bounds(win: &WebviewWindow, store: &Store) {
    let settings = store.get();
    let Some(cfg) = settings.get("window") else { return };

    // 没有历史尺寸时不调 set_size，让 tauri.conf.json 里的逻辑尺寸（含 DPI 缩放）生效。
    // 只有用户真的调整过窗口，才用记录下来的物理像素还回去。
    let width = cfg.get("width").and_then(|v| v.as_u64());
    let height = cfg.get("height").and_then(|v| v.as_u64());

    // 记录的是「内容区」尺寸，正好对上 set_size 的语义。
    // 早前存的是外框（= 内容区 + 标题栏/边框），每次启动都会被撑大一圈。
    let scale = win.scale_factor().unwrap_or(1.0);
    let min_w = (940.0 * scale) as u32;
    let min_h = (600.0 * scale) as u32;

    if let (Some(width), Some(height)) = (width, height) {
        let mut w = (width as u32).max(min_w);
        let mut h = (height as u32).max(min_h);

        // 换了显示器 / 分辨率变小：按「可用区域」收一收，别压到任务栏底下
        if let Ok(Some(monitor)) = win.primary_monitor() {
            let area = monitor.work_area();
            if w > area.size.width {
                w = area.size.width * 95 / 100;
            }
            if h > area.size.height {
                h = area.size.height * 95 / 100;
            }
        }
        let _ = win.set_size(tauri::PhysicalSize::new(w, h));
    }

    if let (Some(x), Some(y)) = (
        cfg.get("x").and_then(|v| v.as_i64()),
        cfg.get("y").and_then(|v| v.as_i64()),
    ) {
        // 拔掉副屏后旧坐标可能落在任何屏幕之外，那种情况就别还原位置，让窗口居中
        let on_screen = win
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .any(|monitor| {
                let origin = monitor.position();
                let size = monitor.size();
                let (left, top) = (origin.x as i64, origin.y as i64);
                let (right, bottom) = (left + size.width as i64, top + size.height as i64);
                // 至少要有一块标题栏露在屏幕里，才认为这个位置可用
                x + 200 > left && x < right - 120 && y > top - 20 && y < bottom - 120
            });
        if on_screen {
            let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        }
    }

    if cfg.get("maximized").and_then(|v| v.as_bool()).unwrap_or(false) {
        let _ = win.maximize();
    }
}

/// 窗口几何变化很密（拖拽、最大化动画每一帧都发事件），这里只投一个信号，
/// 由后台线程等窗口安静下来再落盘——保证存的是最终尺寸，而不是动画中间值。
fn notify_bounds_changed(win: &tauri::Window) {
    if let Some(state) = win.app_handle().try_state::<AppState>() {
        let _ = state.bounds_tx.send(());
    }
}

fn persist_window_bounds(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Some(win) = app.get_webview_window("main") else {
        return;
    };

    if win.is_maximized().unwrap_or(false) {
        // 最大化时内容区就是整块屏幕，记下来会把「还原后」的尺寸覆盖掉
        state.store.update(&json!({ "window": { "maximized": true } }));
        return;
    }
    if win.is_minimized().unwrap_or(false) {
        // 最小化时拿到的尺寸不可靠
        return;
    }

    if let (Ok(size), Ok(pos)) = (win.inner_size(), win.outer_position()) {
        state.store.update(&json!({
            "window": {
                "width": size.width,
                "height": size.height,
                "x": pos.x,
                "y": pos.y,
                "maximized": false
            }
        }));
    }
}

/// 只起一个线程：收到信号后一直等到安静（BOUNDS_SETTLE_MS 内没有新信号）才写盘
fn spawn_bounds_saver(app: AppHandle, rx: mpsc::Receiver<()>) {
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx
                .recv_timeout(Duration::from_millis(BOUNDS_SETTLE_MS))
                .is_ok()
            {}
            persist_window_bounds(&app);
        }
    });
}

// ---------------------------------------------------------------------------
// 托盘
// ---------------------------------------------------------------------------

fn build_tray_menu(
    app: &AppHandle,
    store: &Store,
    hotkey_ok: bool,
    hotkey_label: &str,
) -> tauri::Result<Menu<tauri::Wry>> {
    let close_to_tray = store.ui_flag("closeToTray", true);

    let show_label = if hotkey_ok {
        format!("显示主窗口\t{hotkey_label}")
    } else {
        "显示主窗口".to_string()
    };

    let show_item = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let warn_item = MenuItem::with_id(
        app,
        "hotkey_warn",
        format!("全局快捷键 {hotkey_label} 被占用，已停用"),
        false,
        None::<&str>,
    )?;
    let close_item = CheckMenuItem::with_id(
        app,
        "close_to_tray",
        "关闭窗口时最小化到托盘",
        true,
        close_to_tray,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let mut refs: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&show_item];
    if !hotkey_ok {
        refs.push(&warn_item);
    }
    refs.push(&sep1);
    refs.push(&close_item);
    refs.push(&sep2);
    refs.push(&quit_item);

    Menu::with_items(app, &refs)
}

pub(crate) fn refresh_tray_menu(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let hotkey_ok = state.hotkey_ok.load(Ordering::Relaxed);
    let label = state.store.ui_string("hotkey", DEFAULT_HOTKEY);
    if let Ok(menu) = build_tray_menu(app, &state.store, hotkey_ok, &label) {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_menu(Some(menu));
            let _ = tray.set_tooltip(Some(if hotkey_ok {
                format!("工具集 · {label} 唤出")
            } else {
                "工具集".to_string()
            }));
        }
    }
}

fn create_tray(app: &AppHandle, hotkey_ok: bool) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let label = state.store.ui_string("hotkey", DEFAULT_HOTKEY);
    let menu = build_tray_menu(app, &state.store, hotkey_ok, &label)?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(if hotkey_ok {
            format!("工具集 · {label} 唤出")
        } else {
            "工具集".to_string()
        })
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "close_to_tray" => {
                let flipped = {
                    let state = app.state::<AppState>();
                    !state.store.ui_flag("closeToTray", true)
                };
                let state = app.state::<AppState>();
                state.store.update(&json!({ "ui": { "closeToTray": flipped } }));
                refresh_tray_menu(app);
            }
            "quit" => {
                if let Some(state) = app.try_state::<AppState>() {
                    state.store.flush();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Windows 上左键单击 = 唤出（不切换，避免「点了没反应」的困惑）
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// 全局快捷键
// ---------------------------------------------------------------------------

pub(crate) fn register_hotkey(app: &AppHandle, accelerator: &str) -> bool {
    // 字符串语法来自 global-hotkey：Ctrl+Shift+Space / Alt+F9 / Ctrl+Shift+K 都能解析
    let shortcut = match Shortcut::from_str(accelerator.trim()) {
        Ok(shortcut) => shortcut,
        Err(err) => {
            eprintln!("[tray] 快捷键 {accelerator} 格式无效: {err}");
            return false;
        }
    };
    match app.global_shortcut().register(shortcut) {
        Ok(()) => true,
        Err(err) => {
            // 被别的软件占用不致命：托盘菜单里明示「不可用」，不静默
            eprintln!("[tray] 快捷键 {accelerator} 注册失败（可能被其他软件占用）: {err}");
            false
        }
    }
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

pub fn run() {
    // 冒烟/自动化测试要能和应用本体同时跑：跳过单实例锁，避免被已有实例「顶掉」
    let smoke_mode = std::env::var("USE_TOOLS_SMOKE").is_ok();
    let mut builder = tauri::Builder::default();
    if !smoke_mode {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 已有实例在跑：把自己带到前台
            show_window(app);
        }));
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // 只注册一个快捷键，按下就唤出；换键位后这里无需跟着改
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            smoke::smoke_resize,
            commands::pick_file,
            commands::save_text,
            commands::save_file,
            commands::read_text,
            commands::basename,
            commands::stat,
            commands::scan_column,
            commands::scan_column_text,
            commands::show_item_in_folder,
            commands::clipboard_read_text,
            commands::clipboard_write_text,
            commands::app_info,
            commands::settings_get,
            commands::settings_update,
            commands::settings_patch_tool,
            commands::theme_set,
            commands::hotkey_state,
            commands::set_hotkey,
            commands::data_dir,
            commands::open_data_dir,
            commands::app_hide,
            commands::app_emit_summoned,
            smoke::smoke_report,
        ])
        .setup(move |app| {
            // 测试可以用独立配置目录，避免污染用户真实设置
            let config_dir: PathBuf = std::env::var("USE_TOOLS_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| {
                    app.path()
                        .app_config_dir()
                        .unwrap_or_else(|_| PathBuf::from("."))
                });
            let _ = std::fs::create_dir_all(&config_dir);
            let store = Store::load(config_dir.join("settings.json"));

            // 主题：system 交给系统决定，Chromium/WebView2 的 prefers-color-scheme 会跟着变
            let theme_mode = store.ui_string("theme", "system");
            let theme = match theme_mode.as_str() {
                "light" => Some(Theme::Light),
                "dark" => Some(Theme::Dark),
                _ => None,
            };

            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_theme(theme);
                restore_window_bounds(&win, &store);
                // 自动化测试用固定窗口，别被用户上次的几何设置带偏
                if smoke_mode {
                    if let Some((width, height)) = std::env::var("USE_TOOLS_SMOKE_WINDOW")
                        .ok()
                        .and_then(|raw| parse_size(&raw))
                    {
                        let _ = win.unmaximize();
                        let _ = win.set_size(tauri::LogicalSize::new(width, height));
                        let _ = win.center();
                    }
                }
                let _ = win.show();
                let _ = win.set_focus();
            }

            let (bounds_tx, bounds_rx) = mpsc::channel::<()>();
            app.manage(AppState {
                store: Arc::clone(&store),
                hotkey_ok: AtomicBool::new(false),
                bounds_tx,
            });

            // 冒烟时不要写窗口几何：测试会反复缩放，别污染用户配置
            if !smoke_mode {
                spawn_bounds_saver(app.handle().clone(), bounds_rx);
            }

            let initial_hotkey = store.ui_string("hotkey", DEFAULT_HOTKEY);
            // 冒烟时不抢全局快捷键、不建托盘：让设置页处于确定的「未启用」状态
            let hotkey_ok = if smoke_mode {
                false
            } else {
                register_hotkey(app.handle(), &initial_hotkey)
            };
            app.state::<AppState>()
                .hotkey_ok
                .store(hotkey_ok, Ordering::Relaxed);

            if !smoke_mode {
                create_tray(app.handle(), hotkey_ok)?;
            }

            // 自动化自检：注入 JS 收集界面状态，断言通过后自行退出
            if std::env::var("USE_TOOLS_SMOKE").is_ok() {
                smoke::attach(app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let close_to_tray = window
                    .app_handle()
                    .try_state::<AppState>()
                    .map(|state| state.store.ui_flag("closeToTray", true))
                    .unwrap_or(true);

                // 关闭按钮 → 藏进托盘（可在托盘菜单里改成真退出）
                if close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                notify_bounds_changed(window);
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");

    app.run(|app_handle, event| match event {
        // 退出前补一次：防抖线程可能还差最后一拍没写
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            persist_window_bounds(app_handle);
            if let Some(state) = app_handle.try_state::<AppState>() {
                state.store.flush();
            }
        }
        _ => {}
    });
}

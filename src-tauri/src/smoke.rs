//! 无人工介入的自检：注入 JS 收集界面状态，通过 IPC 回传，Rust 侧汇总判定。
//!
//! 用法：USE_TOOLS_SMOKE=1 ./use-tools.exe
//!   可选 USE_TOOLS_SMOKE_OUT=path 把结果写到文件
//! 退出码 0 表示全部阶段通过。

use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

static REPORTS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

fn reports() -> &'static Mutex<Vec<String>> {
    REPORTS.get_or_init(|| Mutex::new(Vec::new()))
}

/// 渲染层回传一个阶段的检查结果。正常启动不会调用它，只在冒烟里有用。
#[tauri::command]
pub fn smoke_report(payload: String) {
    println!("[smoke] {payload}");
    if let Ok(mut list) = reports().lock() {
        list.push(payload);
    }
}

/// 注入脚本：一次性跑完四个阶段，每步结果都回传。
/// 用 (async () => {})() 包起来，避免顶层 await 在不同 WebView 版本上的差异。
const SMOKE_JS: &str = r#"(async () => {
    const invoke = window.__TAURI__.core.invoke;
    const report = (phase, data) =>
        invoke('smoke_report', { payload: JSON.stringify(Object.assign({ phase }, data)) });

    try {
        // A：外壳与侧边栏
        const names = [...document.querySelectorAll('#tool-list .tool-item .ti-name')]
            .map(node => node.textContent.trim());
        await report('A', {
            count: names.length,
            names,
            brand: (document.getElementById('brand-version') || {}).textContent || '',
            foot: (document.getElementById('foot-info') || {}).textContent || '',
            welcome: !!document.querySelector('.welcome'),
            // 窗口尺寸随 DPI 变化，冒烟时顺手记一笔，方便核对默认值有没有生效
            outer: window.outerWidth + 'x' + window.outerHeight,
            dpr: window.devicePixelRatio
        });

        // C：切到 SQL IN 工具页，看它有没有真的挂载
        location.hash = '#/sql-in';
        await new Promise(done => setTimeout(done, 900));

        const view = document.getElementById('tool-view');
        const text = view ? view.innerText : '';
        await report('C', {
            heading: (document.getElementById('tool-title') || {}).textContent || '',
            blocks: view ? view.children.length : 0,
            hasInput: !!document.querySelector('#tool-view textarea'),
            loadError: text.includes('工具加载失败'),
            route: location.hash
        });

        // C2：列比对页——验证「表格支持 + 自动/UTF-8/ANSI」这套新选项真的进了包里
        location.hash = '#/column-compare';
        await new Promise(done => setTimeout(done, 700));
        const encLabels = [...document.querySelectorAll('.opt-row .seg')]
            .map(seg => [...seg.querySelectorAll('button')].map(b => b.textContent))
            .find(labels => labels.includes('UTF-8')) || [];
        await report('C2', {
            desc: (document.getElementById('tool-desc') || {}).textContent || '',
            encoding: encLabels,
            mentionsXlsx: (document.body.innerText || '').includes('xlsx')
        });

        // D：真实走一次 IPC（settings.get 走 invoke → Rust 命令）
        try {
            const settings = await window.api.settings.get();
            await report('D', { ok: true, keys: Object.keys(settings || {}) });
        } catch (err) {
            await report('D', { ok: false, error: String(err && err.message || err) });
        }

        // S：列扫描走 Rust 实现（顺带验证 camelCase 参数映射）
        try {
            const result = await window.api.scanColumnText({
                text: 'a\t1\nb\t2\na\t3\n\n',
                delimiter: '\t',
                columnIndex: 0,
                trim: true
            });
            await report('S', {
                ok: true,
                values: result.values,
                unique: result.uniqueCount,
                total: result.totalLines,
                empty: result.emptyLines
            });
        } catch (err) {
            await report('S', { ok: false, error: String(err && err.message || err) });
        }

        // H：设置页的快捷键读写（设成当前这个键，幂等，不改用户实际配置）
        try {
            const before = await window.api.hotkey.get();
            const target = (before && before.accelerator) || 'Ctrl+Shift+Space';
            const result = await window.api.hotkey.set(target);
            await report('H', {
                ok: !!result && result.ok !== false,
                accelerator: (result && result.accelerator) || null,
                registered: !!(result && result.registered),
                error: (result && result.error) || null
            });
        } catch (err) {
            await report('H', { ok: false, error: String(err && err.message || err) });
        }
    } catch (err) {
        await report('E', { error: String(err && err.message || err) });
    }
})()"#;

fn read_reports() -> Vec<String> {
    reports().lock().map(|list| list.clone()).unwrap_or_default()
}

pub fn attach(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        // 等页面首帧渲染完再注入
        thread::sleep(Duration::from_millis(2000));
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.eval(SMOKE_JS);
        }

        // 等 D / S / H 阶段落地（或超时）
        let deadline = Instant::now() + Duration::from_secs(12);
        loop {
            let done = read_reports().iter().any(|line| {
                line.contains("\"phase\":\"H\"") || line.contains("\"phase\":\"E\"")
            });
            if done || Instant::now() > deadline {
                break;
            }
            thread::sleep(Duration::from_millis(150));
        }

        let list = read_reports();
        let has = |needle: &str| list.iter().any(|line| line.contains(needle));
        let ok = has("\"phase\":\"D\"")
            && has("\"phase\":\"S\"")
            && has("\"phase\":\"H\"")
            && has("\"phase\":\"C2\"")
            && has("\"mentionsXlsx\":true")
            && has("\"encoding\":[\"自动\",\"UTF-8\",\"ANSI\"]")
            && has("\"registered\":true")
            && has("\"ok\":true")
            && has("\"count\":5")
            && has("\"hasInput\":true")
            && has("\"unique\":2")
            && !has("\"loadError\":true")
            && !has("\"phase\":\"E\"")
            && !has("\"ok\":false");

        println!("===== Tauri 冒烟结果 =====");
        for line in &list {
            println!("{line}");
        }
        println!("===== {} =====", if ok { "通过" } else { "失败" });

        if let Ok(path) = std::env::var("USE_TOOLS_SMOKE_OUT") {
            let _ = std::fs::write(path, format!("{}\n", list.join("\n")));
        }

        app.exit(if ok { 0 } else { 1 });
    });
}

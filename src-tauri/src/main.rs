// 发布版不弹控制台窗口；调试版保留，方便看 eprintln 输出
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    use_tools_lib::run()
}

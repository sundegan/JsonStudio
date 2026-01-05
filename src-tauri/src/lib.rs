// JsonStudio 应用入口
mod commands;

use commands::json::{json_format, json_minify, json_stats, json_validate, json_escape, json_unescape};
use commands::window::set_window_theme;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            json_format,
            json_minify,
            json_validate,
            json_stats,
            json_escape,
            json_unescape,
            set_window_theme
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

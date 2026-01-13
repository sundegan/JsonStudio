mod commands;

use commands::json::{json_format, json_minify, json_stats, json_validate, json_escape, json_unescape};
use commands::window::{set_window_theme, open_devtools};
use commands::shortcuts::{show_main_window, format_clipboard_and_show, update_shortcut};
use commands::file::{open_file_dialog, save_file, save_file_dialog, read_file, is_json_file, get_file_name};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // Disable context menu in production builds
            #[cfg(not(debug_assertions))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_devtools(false);
                }
            }
            
            // Register global shortcut: show app
            let show_app_handle = app_handle.clone();
            app.global_shortcut().on_shortcut("CommandOrControl+Shift+J", move |_app, _shortcut, _event| {
                let handle = show_app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = show_main_window(handle).await;
                });
            }).map_err(|e| format!("Failed to register show app shortcut: {}", e))?;
            
            // Register global shortcut: format clipboard
            let format_handle = app_handle.clone();
            app.global_shortcut().on_shortcut("CommandOrControl+Shift+V", move |_app, _shortcut, _event| {
                let handle = format_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = format_clipboard_and_show(handle).await;
                });
            }).map_err(|e| format!("Failed to register format clipboard shortcut: {}", e))?;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            json_format,
            json_minify,
            json_validate,
            json_stats,
            json_escape,
            json_unescape,
            set_window_theme,
            open_devtools,
            show_main_window,
            format_clipboard_and_show,
            update_shortcut,
            open_file_dialog,
            save_file,
            save_file_dialog,
            read_file,
            is_json_file,
            get_file_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

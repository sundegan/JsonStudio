mod commands;

use commands::json::{json_format, json_minify, json_stats, json_validate, json_escape, json_unescape};
use commands::window::{set_window_theme, open_devtools};
use commands::shortcuts::{show_main_window, format_clipboard_and_show, update_shortcut};
use commands::file::{open_file_dialog, save_file, save_file_dialog, read_file, is_json_file, get_file_name};
use commands::convert::{json_to_yaml, json_to_toml, json_to_xml, json_to_csv, yaml_to_json, toml_to_json, xml_to_json, csv_to_json};
use commands::codegen::{json_to_code, code_to_json};
use commands::clipboard::copy_image_to_clipboard;
use tauri::Emitter;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            
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

            // Windows/Linux: file paths are passed via command line arguments
            #[cfg(not(target_os = "macos"))]
            {
                use std::path::Path;
                let paths: Vec<String> = std::env::args()
                    .skip(1)
                    .filter(|arg| !arg.starts_with('-'))
                    .filter(|arg| {
                        let p = Path::new(arg);
                        p.exists() && p.extension().and_then(|e| e.to_str())
                            .map(|e| e.eq_ignore_ascii_case("json"))
                            .unwrap_or(false)
                    })
                    .collect();

                if !paths.is_empty() {
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        let _ = handle.emit("open-file", paths);
                    });
                }
            }
            
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
            get_file_name,
            json_to_yaml,
            json_to_toml,
            json_to_xml,
            json_to_csv,
            yaml_to_json,
            toml_to_json,
            xml_to_json,
            csv_to_json,
            json_to_code,
            code_to_json,
            copy_image_to_clipboard
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // macOS: file open events come through RunEvent::Opened
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| {
                    if url.scheme() == "file" {
                        url.to_file_path().ok().map(|p| p.to_string_lossy().into_owned())
                    } else {
                        None
                    }
                })
                .collect();

            if !paths.is_empty() {
                let _ = app_handle.emit("open-file", paths);
            }
        }
    });
}

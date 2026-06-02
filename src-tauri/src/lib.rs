mod commands;

use commands::codegen::{code_to_json, json_to_code};
use commands::convert::{
    csv_to_json, json_to_csv, json_to_toml, json_to_xml, json_to_yaml, toml_to_json, xml_to_json,
    yaml_to_json,
};
use commands::export_image::export_json_image;
use commands::file::{
    get_file_name, is_json_file, open_file_dialog, read_file, save_binary_file_dialog, save_file,
    save_file_dialog, open_folder_dialog, read_json_dir, create_untitled_json, show_in_folder,
};
use commands::file_watcher::{unwatch_all_files, unwatch_file, watch_file, FileWatcherState};
use commands::json::{
    json_escape, json_format, json_minify, json_stats, json_unescape, json_validate,
};
use commands::shortcuts::{format_clipboard_and_show, show_main_window, update_shortcut};
use commands::window::{open_devtools, quit_app, restart_app, set_window_theme};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::{
    image::Image,
    menu::{AboutMetadataBuilder, MenuBuilder, SubmenuBuilder},
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

static PENDING_FILES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static FRONTEND_READY: Mutex<bool> = Mutex::new(false);

#[tauri::command]
fn get_pending_files() -> Vec<String> {
    *FRONTEND_READY.lock().unwrap() = true;
    PENDING_FILES.lock().unwrap().drain(..).collect()
}

fn collect_json_file_args(args: &[String], cwd: &str) -> Vec<String> {
    let cwd = Path::new(cwd);
    args.iter()
        .filter_map(|arg| resolve_json_file_arg(arg, cwd))
        .collect()
}

fn resolve_json_file_arg(arg: &str, cwd: &Path) -> Option<String> {
    if arg.starts_with('-') {
        return None;
    }

    let raw_path = PathBuf::from(arg);
    let path = if raw_path.is_absolute() {
        raw_path
    } else {
        cwd.join(raw_path)
    };

    let extension = path.extension().and_then(|ext| ext.to_str())?;
    if !extension.eq_ignore_ascii_case("json") || !path.is_file() {
        return None;
    }

    Some(path.to_string_lossy().into_owned())
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn queue_or_emit_open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    focus_main_window(app);

    let ready = *FRONTEND_READY.lock().unwrap();
    if ready {
        let _ = app.emit("open-file", paths);
    } else {
        PENDING_FILES.lock().unwrap().extend(paths);
    }
}

#[cfg(target_os = "macos")]
fn check_for_update_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Check for Updates...",
        _ => "检查更新...",
    }
}

#[cfg(target_os = "macos")]
fn about_metadata() -> tauri::Result<tauri::menu::AboutMetadata<'static>> {
    let icon_image = image::load_from_memory(include_bytes!("../icons/icon.png"))
        .map_err(|error| tauri::Error::Anyhow(error.into()))?
        .to_rgba8();
    let (width, height) = icon_image.dimensions();
    let icon = Image::new_owned(icon_image.into_raw(), width, height);

    Ok(AboutMetadataBuilder::new()
        .name(Some("Json Studio"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .short_version(Some(env!("CARGO_PKG_VERSION")))
        .copyright(Some("Copyright © 2025 Json Studio"))
        .website(Some("https://github.com/sundegan/JsonStudio"))
        .website_label(Some("GitHub"))
        .credits(Some("GitHub: https://github.com/sundegan/JsonStudio"))
        .icon(Some(icon))
        .build())
}

#[cfg(target_os = "macos")]
fn set_macos_app_menu(app: &tauri::AppHandle, language: &str) -> tauri::Result<()> {
    let about_metadata = about_metadata()?;
    let app_menu = SubmenuBuilder::new(app, "Json Studio")
        .about(Some(about_metadata))
        .separator()
        .text("check_for_update", check_for_update_menu_text(language))
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu]).build()?;
    app.set_menu(menu)?;

    Ok(())
}

#[tauri::command]
fn set_app_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        set_macos_app_menu(&app, &language).map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = language;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("jsonstudio-single-instance-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn collects_absolute_json_file_args_only() {
        let dir = test_dir();
        let json_path = dir.join("AAA.json");
        let text_path = dir.join("notes.txt");
        fs::write(&json_path, "{}").unwrap();
        fs::write(&text_path, "hello").unwrap();

        let args = vec![
            "JsonStudio.exe".to_string(),
            "--flag".to_string(),
            json_path.to_string_lossy().into_owned(),
            text_path.to_string_lossy().into_owned(),
        ];

        assert_eq!(
            collect_json_file_args(&args, dir.to_str().unwrap()),
            vec![json_path.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn resolves_relative_json_args_against_launch_cwd() {
        let dir = test_dir();
        let json_path = dir.join("BBB.JSON");
        fs::write(&json_path, "{}").unwrap();

        let args = vec!["BBB.JSON".to_string()];

        assert_eq!(
            collect_json_file_args(&args, dir.to_str().unwrap()),
            vec![json_path.to_string_lossy().into_owned()]
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = collect_json_file_args(&args, &cwd);
            if paths.is_empty() {
                focus_main_window(app);
            } else {
                queue_or_emit_open_files(app, paths);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let app = builder
        .manage(FileWatcherState::new())
        .setup(|app| {
            let app_handle = app.handle().clone();

            #[cfg(target_os = "macos")]
            {
                set_macos_app_menu(&app_handle, "zh")?;

                app.on_menu_event(|app_handle, event| {
                    if event.id().0.as_str() == "check_for_update" {
                        focus_main_window(app_handle);
                        let _ = app_handle.emit("check-for-update", ());
                    }
                });
            }

            // Register global shortcut: show app
            let show_app_handle = app_handle.clone();
            if let Err(error) = app.global_shortcut().on_shortcut(
                "CommandOrControl+Shift+J",
                move |_app, _shortcut, _event| {
                    let handle = show_app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = show_main_window(handle).await;
                    });
                },
            ) {
                eprintln!("Failed to register show app shortcut: {}", error);
            }

            // Register global shortcut: format clipboard
            let format_handle = app_handle.clone();
            if let Err(error) = app.global_shortcut().on_shortcut(
                "CommandOrControl+Shift+V",
                move |_app, _shortcut, _event| {
                    let handle = format_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = format_clipboard_and_show(handle).await;
                    });
                },
            ) {
                eprintln!("Failed to register format clipboard shortcut: {}", error);
            }

            #[cfg(not(target_os = "macos"))]
            {
                let args: Vec<String> = std::env::args().skip(1).collect();
                let cwd = std::env::current_dir()
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let paths = collect_json_file_args(&args, &cwd);
                queue_or_emit_open_files(&app_handle, paths);
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
            save_binary_file_dialog,
            open_folder_dialog,
            read_json_dir,
            create_untitled_json,
            read_file,
            is_json_file,
            get_file_name,
            watch_file,
            unwatch_file,
            unwatch_all_files,
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
            export_json_image,
            get_pending_files,
            show_in_folder,
            quit_app,
            restart_app,
            set_app_menu_language
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|url| {
                    if url.scheme() == "file" {
                        url.to_file_path()
                            .ok()
                            .map(|p| p.to_string_lossy().into_owned())
                    } else {
                        None
                    }
                })
                .collect();

            if !paths.is_empty() {
                queue_or_emit_open_files(app_handle, paths);
            }
        }
    });
}

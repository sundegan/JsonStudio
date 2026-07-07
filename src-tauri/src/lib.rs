mod commands;

use commands::codegen::{code_to_json, json_to_code};
use commands::convert::{
    csv_to_json, json_to_csv, json_to_toml, json_to_xml, json_to_yaml, toml_to_json, xml_to_json,
    yaml_to_json,
};
use commands::export_image::export_json_image;
use commands::file::{
    create_untitled_json, get_file_name, is_json_file, open_file_dialog, open_folder_dialog,
    read_file, read_json_dir, save_binary_file_dialog, save_file, save_file_dialog, show_in_folder,
    JSON_FILE_EXTENSIONS,
};
use commands::file_watcher::{unwatch_all_files, unwatch_file, watch_file, FileWatcherState};
use commands::json::{json_escape, json_format, json_minify, json_unescape};
use commands::shortcuts::{
    format_clipboard_and_show, register_global_shortcut, show_main_window, update_shortcut,
    GlobalShortcutRegistry, DEFAULT_FORMAT_CLIPBOARD_SHORTCUT, DEFAULT_SHOW_APP_SHORTCUT,
    FORMAT_CLIPBOARD_SHORTCUT_ID, SHOW_APP_SHORTCUT_ID,
};
#[cfg(target_os = "macos")]
use commands::window::apply_macos_transparent_chrome;
use commands::window::{desktop_platform, open_devtools, quit_app, restart_app, set_window_theme};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

const WINDOW_SCREEN_MARGIN: u32 = 48;
const DEFAULT_WINDOW_LOGICAL_WIDTH: u32 = 1280;
const DEFAULT_WINDOW_LOGICAL_HEIGHT: u32 = 800;
const MIN_WINDOW_LOGICAL_WIDTH: u32 = 960;
const MIN_WINDOW_LOGICAL_HEIGHT: u32 = 640;
const RESTORED_WINDOW_MAX_SCREEN_RATIO: f64 = 0.9;

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
    if !JSON_FILE_EXTENSIONS
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
        || !path.is_file()
    {
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

fn clamp_axis(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn max_window_axis(work_area_axis: f64, min_axis: f64) -> f64 {
    (work_area_axis * RESTORED_WINDOW_MAX_SCREEN_RATIO)
        .round()
        .min((work_area_axis - WINDOW_SCREEN_MARGIN as f64).max(min_axis))
        .max(work_area_axis / 2.0)
        .max(min_axis)
}

fn restored_window_axis(
    current_axis: f64,
    work_area_axis: f64,
    default_axis: f64,
    min_axis: f64,
) -> f64 {
    let max_axis = max_window_axis(work_area_axis, min_axis);
    if current_axis > work_area_axis - WINDOW_SCREEN_MARGIN as f64 {
        return default_axis.min(max_axis).max(min_axis);
    }

    current_axis.min(max_axis).max(min_axis)
}

fn clamp_main_window_to_visible_area(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }

    let Some(monitor) = window
        .current_monitor()?
        .or(window.primary_monitor()?)
        .or_else(|| window.available_monitors().ok()?.into_iter().next())
    else {
        return Ok(());
    };

    let work_area = *monitor.work_area();
    let monitor_position = work_area.position;
    let monitor_size = work_area.size;
    let scale_factor = monitor.scale_factor();
    let current_size = window.inner_size()?;
    let current_logical_size = current_size.to_logical::<f64>(scale_factor);
    let work_area_logical_size = monitor_size.to_logical::<f64>(scale_factor);
    let clamped_logical_size = LogicalSize {
        width: restored_window_axis(
            current_logical_size.width,
            work_area_logical_size.width,
            DEFAULT_WINDOW_LOGICAL_WIDTH as f64,
            MIN_WINDOW_LOGICAL_WIDTH as f64,
        ),
        height: restored_window_axis(
            current_logical_size.height,
            work_area_logical_size.height,
            DEFAULT_WINDOW_LOGICAL_HEIGHT as f64,
            MIN_WINDOW_LOGICAL_HEIGHT as f64,
        ),
    };
    let clamped_size = clamped_logical_size.to_physical::<u32>(scale_factor);

    if clamped_size != current_size {
        window.set_size(clamped_logical_size)?;
    }

    let current_position = window.outer_position()?;
    let max_x = monitor_position.x + monitor_size.width.saturating_sub(clamped_size.width) as i32;
    let max_y = monitor_position.y + monitor_size.height.saturating_sub(clamped_size.height) as i32;
    let clamped_position = PhysicalPosition {
        x: clamp_axis(current_position.x, monitor_position.x, max_x),
        y: clamp_axis(current_position.y, monitor_position.y, max_y),
    };

    if clamped_position != current_position {
        window.set_position(clamped_position)?;
    }

    Ok(())
}

fn schedule_main_window_bounds_clamp(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = clamp_main_window_to_visible_area(&window);
        }
    });
}

#[cfg(target_os = "macos")]
fn about_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "About Json Studio",
        _ => "关于 Json Studio",
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
fn set_macos_app_menu(app: &tauri::AppHandle, language: &str) -> tauri::Result<()> {
    let app_menu = SubmenuBuilder::new(app, "Json Studio")
        .text("show_about", about_menu_text(language))
        .separator()
        .text("check_for_update", check_for_update_menu_text(language))
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu])
        .build()?;
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
    fn collects_absolute_supported_json_file_args_only() {
        let dir = test_dir();
        let supported_paths = [
            "AAA.json",
            "config.JSON5",
            "events.jsonl",
            "stream.ndjson",
            "settings.jsonc",
            "map.geojson",
            "shape.topojson",
            "network.har",
            "site.webmanifest",
            "notebook.ipynb",
            "scan.sarif",
        ]
        .map(|name| dir.join(name));
        let text_path = dir.join("notes.txt");
        for path in &supported_paths {
            fs::write(path, "{}").unwrap();
        }
        fs::write(&text_path, "hello").unwrap();

        let mut args = vec!["JsonStudio.exe".to_string(), "--flag".to_string()];
        args.extend(
            supported_paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned()),
        );
        args.push(text_path.to_string_lossy().into_owned());

        assert_eq!(
            collect_json_file_args(&args, dir.to_str().unwrap()),
            supported_paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
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

    #[test]
    fn max_window_axis_keeps_restored_windows_below_screen_width() {
        assert_eq!(max_window_axis(1512.0, 960.0), 1361.0);
    }

    #[test]
    fn max_window_axis_handles_tiny_monitors() {
        assert_eq!(max_window_axis(40.0, 1.0), 20.0);
    }

    #[test]
    fn restored_window_axis_uses_default_for_external_display_state() {
        assert_eq!(
            restored_window_axis(1520.0, 1512.0, 1280.0, 960.0),
            1280.0
        );
    }

    #[test]
    fn restored_window_axis_preserves_reasonable_user_size() {
        assert_eq!(
            restored_window_axis(1161.0, 1512.0, 1280.0, 960.0),
            1161.0
        );
    }

    #[test]
    fn restored_window_axis_raises_tiny_saved_size_to_minimum() {
        assert_eq!(
            restored_window_axis(480.0, 1512.0, 1280.0, 960.0),
            960.0
        );
    }

    #[test]
    fn restored_window_axis_caps_minimum_to_tiny_monitor() {
        assert_eq!(restored_window_axis(1.0, 40.0, 1280.0, 1.0), 20.0);
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
        .manage(GlobalShortcutRegistry::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            schedule_main_window_bounds_clamp(&app_handle);

            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let ns_window = window.ns_window().map_err(|error| error.to_string())?;
                    apply_macos_transparent_chrome(ns_window);
                }

                set_macos_app_menu(&app_handle, "zh")?;

                app.on_menu_event(|app_handle, event| match event.id().0.as_str() {
                    "show_about" => {
                        focus_main_window(app_handle);
                        let _ = app_handle.emit("show-about", ());
                    }
                    "check_for_update" => {
                        focus_main_window(app_handle);
                        let _ = app_handle.emit("check-for-update", ());
                    }
                    _ => {}
                });
            }

            // Register global shortcut: show app
            if let Err(error) = register_global_shortcut(
                &app_handle,
                SHOW_APP_SHORTCUT_ID,
                DEFAULT_SHOW_APP_SHORTCUT,
            ) {
                eprintln!("Failed to register show app shortcut: {}", error);
            }

            // Register global shortcut: format clipboard
            if let Err(error) = register_global_shortcut(
                &app_handle,
                FORMAT_CLIPBOARD_SHORTCUT_ID,
                DEFAULT_FORMAT_CLIPBOARD_SHORTCUT,
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
            json_escape,
            json_unescape,
            set_window_theme,
            desktop_platform,
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

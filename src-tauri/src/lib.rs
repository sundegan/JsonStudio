mod app_state;
mod commands;
#[cfg(target_os = "macos")]
mod macos_menu_view;
#[cfg(target_os = "macos")]
mod macos_window;
mod window_bounds;

use app_state::{
    collect_json_file_args, focus_main_window, get_pending_files, queue_or_emit_open_files,
};
use commands::codegen::{code_to_json, json_to_code};
use commands::convert::{
    csv_to_json, json_to_csv, json_to_toml, json_to_xml, json_to_yaml, toml_to_json, xml_to_json,
    yaml_to_json,
};
use commands::export_image::export_json_image;
use commands::file::{
    create_untitled_json, get_file_name, is_json_file, open_file_dialog, open_folder_dialog,
    read_file, read_json_dir, rename_file, save_binary_file_dialog, save_file, save_file_dialog,
    show_in_folder,
};
use commands::file_watcher::{unwatch_all_files, unwatch_file, watch_file, FileWatcherState};
use commands::json::{json_escape, json_format, json_minify, json_unescape};
use commands::shortcuts::{
    format_clipboard_and_show, register_global_shortcut, show_main_window, update_shortcut,
    GlobalShortcutRegistry, DEFAULT_FORMAT_CLIPBOARD_SHORTCUT, DEFAULT_SHOW_APP_SHORTCUT,
    FORMAT_CLIPBOARD_SHORTCUT_ID, SHOW_APP_SHORTCUT_ID,
};
use commands::window::{desktop_platform, open_devtools, quit_app, restart_app, set_window_theme};
use window_bounds::schedule_main_window_bounds_clamp;

#[tauri::command]
fn set_app_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos_window::set_app_menu_language(app, language);

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, language);
        Ok(())
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
            macos_window::setup(&app_handle)?;
            #[cfg(not(target_os = "macos"))]
            {
                let args: Vec<String> = std::env::args().skip(1).collect();
                let cwd = std::env::current_dir()
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_default();
                queue_or_emit_open_files(&app_handle, collect_json_file_args(&args, &cwd));
            }
            if let Err(error) = register_global_shortcut(
                &app_handle,
                SHOW_APP_SHORTCUT_ID,
                DEFAULT_SHOW_APP_SHORTCUT,
            ) {
                eprintln!("Failed to register show app shortcut: {error}");
            }
            if let Err(error) = register_global_shortcut(
                &app_handle,
                FORMAT_CLIPBOARD_SHORTCUT_ID,
                DEFAULT_FORMAT_CLIPBOARD_SHORTCUT,
            ) {
                eprintln!("Failed to register format clipboard shortcut: {error}");
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
            rename_file,
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
        macos_window::handle_run_event(app_handle, &event);
    });
}

use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub(crate) const SHOW_APP_SHORTCUT_ID: &str = "show_app";
pub(crate) const FORMAT_CLIPBOARD_SHORTCUT_ID: &str = "format_clipboard";
pub(crate) const DEFAULT_SHOW_APP_SHORTCUT: &str = "CommandOrControl+Shift+J";
pub(crate) const DEFAULT_FORMAT_CLIPBOARD_SHORTCUT: &str = "CommandOrControl+Shift+V";

pub(crate) struct GlobalShortcutRegistry {
    keys: Mutex<HashMap<String, String>>,
}

impl Default for GlobalShortcutRegistry {
    fn default() -> Self {
        Self {
            keys: Mutex::new(HashMap::from([
                (
                    SHOW_APP_SHORTCUT_ID.to_string(),
                    DEFAULT_SHOW_APP_SHORTCUT.to_string(),
                ),
                (
                    FORMAT_CLIPBOARD_SHORTCUT_ID.to_string(),
                    DEFAULT_FORMAT_CLIPBOARD_SHORTCUT.to_string(),
                ),
            ])),
        }
    }
}

pub(crate) fn register_global_shortcut(app: &AppHandle, id: &str, key: &str) -> Result<(), String> {
    let shortcut: Shortcut = key
        .parse()
        .map_err(|e| format!("Invalid shortcut format: {:?}", e))?;

    match id {
        SHOW_APP_SHORTCUT_ID => {
            let app_handle = app.clone();
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = show_main_window(handle).await;
                    });
                })
                .map_err(|e| format!("Failed to register shortcut: {}", e))
        }
        FORMAT_CLIPBOARD_SHORTCUT_ID => {
            let app_handle = app.clone();
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = format_clipboard_and_show(handle).await;
                    });
                })
                .map_err(|e| format!("Failed to register shortcut: {}", e))
        }
        _ => Err("Unknown shortcut id".to_string()),
    }
}

#[tauri::command]
pub async fn update_shortcut(
    app: AppHandle,
    registry: State<'_, GlobalShortcutRegistry>,
    id: String,
    key: String,
) -> Result<(), String> {
    let mut keys = registry
        .keys
        .lock()
        .map_err(|_| "Global shortcut registry is unavailable".to_string())?;
    let old_key = keys
        .get(&id)
        .cloned()
        .ok_or_else(|| "Unknown shortcut id".to_string())?;
    let shortcuts = app.global_shortcut();
    if old_key == key && shortcuts.is_registered(key.as_str()) {
        return Ok(());
    }

    if shortcuts.is_registered(old_key.as_str()) {
        shortcuts
            .unregister(old_key.as_str())
            .map_err(|e| format!("Failed to unregister shortcut: {}", e))?;
    }

    if let Err(error) = register_global_shortcut(&app, &id, &key) {
        return match register_global_shortcut(&app, &id, &old_key) {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{}; failed to restore previous shortcut: {}",
                error, rollback_error
            )),
        };
    }

    keys.insert(id, key);
    Ok(())
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        ensure_window_in_front(&window)?;
        Ok(())
    } else {
        Err("Main window not found".to_string())
    }
}

#[tauri::command]
pub async fn format_clipboard_and_show(app: AppHandle) -> Result<(), String> {
    // Get clipboard content
    let clipboard_text = app
        .clipboard()
        .read_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))?;

    if clipboard_text.is_empty() {
        return Err("Clipboard is empty".to_string());
    }

    // Show window first
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;

    ensure_window_in_front(&window)?;

    window
        .emit("clipboard-content", clipboard_text)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn ensure_window_in_front(window: &WebviewWindow) -> Result<(), String> {
    let mut elevated = false;

    if window.is_minimized().map_err(|e| e.to_string())? {
        window.unminimize().map_err(|e| e.to_string())?;
        elevated = true;
    }

    if !window.is_visible().map_err(|e| e.to_string())? {
        window.show().map_err(|e| e.to_string())?;
        elevated = true;
    }

    if !window.is_focused().map_err(|e| e.to_string())? {
        window.set_focus().map_err(|e| e.to_string())?;
        elevated = true;
    }

    if elevated {
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        let window_clone = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let _ = window_clone.set_always_on_top(false);
        });
    }

    Ok(())
}

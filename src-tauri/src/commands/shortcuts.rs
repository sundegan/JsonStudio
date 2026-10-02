use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub(crate) const SHOW_APP_SHORTCUT_ID: &str = "show_app";
pub(crate) const FORMAT_CLIPBOARD_SHORTCUT_ID: &str = "format_clipboard";
#[derive(Default)]
pub(crate) struct GlobalShortcutRegistry {
    bindings: Mutex<Vec<GlobalShortcutBinding>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct GlobalShortcutBinding {
    id: String,
    key: String,
}

#[derive(Serialize)]
pub struct GlobalShortcutUpdate {
    bindings: Vec<GlobalShortcutBinding>,
    error: Option<String>,
}

fn register_global_shortcut(app: &AppHandle, id: &str, key: &str) -> Result<(), String> {
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

trait ShortcutBackend {
    fn register(&mut self, binding: &GlobalShortcutBinding) -> Result<(), String>;
    fn unregister(&mut self, binding: &GlobalShortcutBinding) -> Result<(), String>;
}

struct AppShortcutBackend<'a>(&'a AppHandle);

impl ShortcutBackend for AppShortcutBackend<'_> {
    fn register(&mut self, binding: &GlobalShortcutBinding) -> Result<(), String> {
        register_global_shortcut(self.0, &binding.id, &binding.key)
    }

    fn unregister(&mut self, binding: &GlobalShortcutBinding) -> Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(binding.key.as_str())
            .map_err(|error| format!("Failed to unregister shortcut: {error}"))
    }
}

fn validate_bindings(bindings: &[GlobalShortcutBinding]) -> Result<(), String> {
    if bindings.is_empty() {
        return Ok(());
    }

    let mut ids = HashSet::new();
    let mut keys = HashSet::new();
    for binding in bindings {
        if !matches!(
            binding.id.as_str(),
            SHOW_APP_SHORTCUT_ID | FORMAT_CLIPBOARD_SHORTCUT_ID
        ) || !ids.insert(binding.id.as_str())
        {
            return Err("Unknown or duplicate shortcut id".to_string());
        }
        let shortcut: Shortcut = binding
            .key
            .parse()
            .map_err(|error| format!("Invalid shortcut format: {error:?}"))?;
        if !keys.insert(shortcut.id()) {
            return Err("Global shortcuts must use different keys".to_string());
        }
    }
    if ids.len() != 2 {
        return Err("Both global shortcuts must be configured".to_string());
    }
    Ok(())
}

fn apply_bindings(
    active: &mut Vec<GlobalShortcutBinding>,
    desired: &[GlobalShortcutBinding],
    backend: &mut impl ShortcutBackend,
) -> Result<(), String> {
    for binding in active.clone() {
        if !desired.contains(&binding) {
            backend.unregister(&binding)?;
            active.retain(|item| item != &binding);
        }
    }
    for binding in desired {
        if !active.contains(binding) {
            backend.register(binding)?;
            active.push(binding.clone());
        }
    }
    Ok(())
}

fn update_bindings(
    active: &mut Vec<GlobalShortcutBinding>,
    desired: &[GlobalShortcutBinding],
    backend: &mut impl ShortcutBackend,
) -> GlobalShortcutUpdate {
    let previous = active.clone();
    let error = validate_bindings(desired)
        .and_then(|()| apply_bindings(active, desired, backend))
        .err()
        .map(|error| {
            // Roll back only bindings that were actually registered, not saved defaults.
            match apply_bindings(active, &previous, backend) {
                Ok(()) => error,
                Err(rollback_error) => {
                    format!("{error}; failed to restore previous shortcuts: {rollback_error}")
                }
            }
        });
    GlobalShortcutUpdate {
        bindings: active.clone(),
        error,
    }
}

#[tauri::command]
pub async fn update_global_shortcuts(
    app: AppHandle,
    registry: State<'_, GlobalShortcutRegistry>,
    bindings: Vec<GlobalShortcutBinding>,
) -> Result<GlobalShortcutUpdate, String> {
    let mut active = registry
        .bindings
        .lock()
        .map_err(|_| "Global shortcut registry is unavailable".to_string())?;
    Ok(update_bindings(
        &mut active,
        &bindings,
        &mut AppShortcutBackend(&app),
    ))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn bindings() -> Vec<GlobalShortcutBinding> {
        vec![
            GlobalShortcutBinding {
                id: SHOW_APP_SHORTCUT_ID.into(),
                key: "CommandOrControl+Shift+J".into(),
            },
            GlobalShortcutBinding {
                id: FORMAT_CLIPBOARD_SHORTCUT_ID.into(),
                key: "CommandOrControl+Shift+V".into(),
            },
        ]
    }

    #[derive(Default)]
    struct MockBackend {
        active: Vec<GlobalShortcutBinding>,
        calls: Vec<String>,
        failures: Vec<String>,
    }

    impl MockBackend {
        fn call(&mut self, operation: &str, binding: &GlobalShortcutBinding) -> Result<(), String> {
            let call = format!("{operation}:{}", binding.key);
            self.calls.push(call.clone());
            if self.failures.first() == Some(&call) {
                self.failures.remove(0);
                return Err(format!("Failed to {call}"));
            }
            Ok(())
        }
    }

    impl ShortcutBackend for MockBackend {
        fn register(&mut self, binding: &GlobalShortcutBinding) -> Result<(), String> {
            self.call("register", binding)?;
            self.active.push(binding.clone());
            Ok(())
        }

        fn unregister(&mut self, binding: &GlobalShortcutBinding) -> Result<(), String> {
            self.call("unregister", binding)?;
            self.active.retain(|item| item != binding);
            Ok(())
        }
    }

    fn assert_active(
        active: &[GlobalShortcutBinding],
        backend: &MockBackend,
        expected: &[GlobalShortcutBinding],
    ) {
        for actual in [active, backend.active.as_slice()] {
            assert_eq!(actual.len(), expected.len());
            assert!(expected.iter().all(|binding| actual.contains(binding)));
        }
    }

    #[test]
    fn startup_does_not_register_default_hotkeys() {
        let registry = GlobalShortcutRegistry::default();
        assert!(registry.bindings.lock().unwrap().is_empty());
    }

    #[test]
    fn enabling_then_disabling_registers_and_releases_both_hotkeys() {
        let mut active = Vec::new();
        let mut backend = MockBackend::default();
        assert!(update_bindings(&mut active, &bindings(), &mut backend)
            .error
            .is_none());
        assert_active(&active, &backend, &bindings());
        assert!(update_bindings(&mut active, &[], &mut backend)
            .error
            .is_none());
        assert_active(&active, &backend, &[]);
        assert_eq!(backend.calls.len(), 4);
    }

    #[test]
    fn synchronizing_unchanged_bindings_is_a_noop() {
        let mut active = bindings();
        let mut backend = MockBackend {
            active: active.clone(),
            ..Default::default()
        };
        assert!(update_bindings(&mut active, &bindings(), &mut backend)
            .error
            .is_none());
        assert!(backend.calls.is_empty());
    }

    #[test]
    fn a_failed_enable_does_not_leave_partial_or_default_hotkeys() {
        let mut active = Vec::new();
        let mut backend = MockBackend {
            failures: vec![format!("register:{}", bindings()[1].key)],
            ..Default::default()
        };
        let result = update_bindings(&mut active, &bindings(), &mut backend);
        assert!(result.error.is_some());
        assert_active(&active, &backend, &[]);
        assert!(result.bindings.is_empty());
        assert_eq!(backend.calls.len(), 3);
    }

    #[test]
    fn a_failed_disable_restores_previously_registered_hotkeys() {
        let mut active = bindings();
        let mut backend = MockBackend {
            active: active.clone(),
            failures: vec![format!("unregister:{}", active[1].key)],
            ..Default::default()
        };
        let result = update_bindings(&mut active, &[], &mut backend);
        assert!(result.error.is_some());
        assert_active(&active, &backend, &bindings());
        assert_eq!(result.bindings.len(), 2);
    }

    #[test]
    fn changing_a_binding_unregisters_only_its_previous_key() {
        let mut active = bindings();
        let mut desired = active.clone();
        desired[0].key = "CommandOrControl+Alt+J".into();
        let mut backend = MockBackend {
            active: active.clone(),
            ..Default::default()
        };
        assert!(update_bindings(&mut active, &desired, &mut backend)
            .error
            .is_none());
        assert_active(&active, &backend, &desired);
        assert_eq!(backend.calls.len(), 2);
        assert_eq!(
            backend.calls[0],
            format!("unregister:{}", bindings()[0].key)
        );
    }

    #[test]
    fn a_failed_key_change_restores_the_previous_binding() {
        let mut active = bindings();
        let mut desired = active.clone();
        desired[0].key = "CommandOrControl+Alt+J".into();
        let mut backend = MockBackend {
            active: active.clone(),
            failures: vec![format!("register:{}", desired[0].key)],
            ..Default::default()
        };
        let result = update_bindings(&mut active, &desired, &mut backend);
        assert!(result.error.is_some());
        assert_active(&active, &backend, &bindings());
    }

    #[test]
    fn rollback_failure_reports_actual_bindings_and_allows_cleanup() {
        let mut active = Vec::new();
        let mut backend = MockBackend {
            failures: vec![
                format!("register:{}", bindings()[1].key),
                format!("unregister:{}", bindings()[0].key),
            ],
            ..Default::default()
        };
        let result = update_bindings(&mut active, &bindings(), &mut backend);
        assert!(result.error.unwrap().contains("failed to restore"));
        assert_active(&active, &backend, &bindings()[..1]);
        assert_eq!(result.bindings, active);
        assert!(update_bindings(&mut active, &[], &mut backend)
            .error
            .is_none());
        assert_active(&active, &backend, &[]);
    }

    #[test]
    fn invalid_or_incomplete_bindings_do_not_unregister_existing_hotkeys() {
        let mut active = bindings();
        let mut backend = MockBackend {
            active: active.clone(),
            ..Default::default()
        };
        let mut invalid = bindings();
        invalid[0].key = "not-a-key".into();
        assert!(update_bindings(&mut active, &invalid, &mut backend)
            .error
            .is_some());
        invalid = bindings();
        invalid[0].id = "unknown".into();
        assert!(update_bindings(&mut active, &invalid, &mut backend)
            .error
            .is_some());
        assert!(update_bindings(&mut active, &bindings()[..1], &mut backend)
            .error
            .is_some());
        assert!(backend.calls.is_empty());
        assert_active(&active, &backend, &bindings());
    }

    #[test]
    fn duplicate_physical_keys_are_rejected_before_registration() {
        let mut desired = bindings();
        desired[0].key = "Control+Shift+J".into();
        desired[1].key = "Shift+Control+J".into();
        let mut active = Vec::new();
        let mut backend = MockBackend::default();
        let result = update_bindings(&mut active, &desired, &mut backend);
        assert!(result.error.unwrap().contains("different keys"));
        assert!(backend.calls.is_empty());
    }

    #[test]
    fn swapping_keys_releases_old_bindings_before_registering_new_ones() {
        let mut active = bindings();
        let mut desired = active.clone();
        desired[0].key = active[1].key.clone();
        desired[1].key = active[0].key.clone();
        let mut backend = MockBackend {
            active: active.clone(),
            ..Default::default()
        };
        assert!(update_bindings(&mut active, &desired, &mut backend)
            .error
            .is_none());
        assert_active(&active, &backend, &desired);
        assert!(backend.calls[..2]
            .iter()
            .all(|call| call.starts_with("unregister:")));
    }
}

use tauri::{AppHandle, Manager, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub async fn update_shortcut(app: AppHandle, id: String, key: String) -> Result<(), String> {
    // 注销旧的快捷键
    let old_key = match id.as_str() {
        "show_app" => "CommandOrControl+Shift+J",
        "format_clipboard" => "CommandOrControl+Shift+V",
        _ => return Err("Unknown shortcut id".to_string()),
    };
    
    let _ = app.global_shortcut().unregister(old_key);
    
    // 解析快捷键字符串
    let shortcut: Shortcut = key.parse()
        .map_err(|e| format!("Invalid shortcut format: {:?}", e))?;
    
    // 注册新的快捷键
    match id.as_str() {
        "show_app" => {
            let app_handle = app.clone();
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, _event| {
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = show_main_window(handle).await;
                    });
                })
                .map_err(|e| format!("Failed to register shortcut: {}", e))?;
        }
        "format_clipboard" => {
            let app_handle = app.clone();
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, _event| {
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = format_clipboard_and_show(handle).await;
                    });
                })
                .map_err(|e| format!("Failed to register shortcut: {}", e))?;
        }
        _ => return Err("Unknown shortcut id".to_string()),
    }
    
    Ok(())
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        
        // 延迟取消置顶，让窗口能够正常显示在最前面
        let window_clone = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let _ = window_clone.set_always_on_top(false);
        });
        
        Ok(())
    } else {
        Err("Main window not found".to_string())
    }
}

#[tauri::command]
pub async fn format_clipboard_and_show(app: AppHandle) -> Result<(), String> {
    // 获取粘贴板内容
    let clipboard_text = app.clipboard()
        .read_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))?;
    
    if clipboard_text.is_empty() {
        return Err("Clipboard is empty".to_string());
    }
    
    // 尝试解析和格式化 JSON
    let parsed: serde_json::Value = serde_json::from_str(&clipboard_text)
        .map_err(|e| format!("Invalid JSON in clipboard: {}", e))?;
    
    let formatted = serde_json::to_string_pretty(&parsed)
        .map_err(|e| format!("Failed to format JSON: {}", e))?;
    
    // 显示窗口
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        
        // 发送格式化后的内容到前端
        window.emit("clipboard-formatted", formatted).map_err(|e| e.to_string())?;
        
        // 延迟取消置顶
        let window_clone = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            let _ = window_clone.set_always_on_top(false);
        });
        
        Ok(())
    } else {
        Err("Main window not found".to_string())
    }
}

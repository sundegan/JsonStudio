// 窗口相关命令

/// 设置窗口主题（macOS 标题栏）
#[tauri::command]
pub fn set_window_theme(window: tauri::Window, is_dark: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::base::{id, nil};
        use cocoa::foundation::NSString;
        use objc::{msg_send, sel, sel_impl};
        
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as id;
        
        unsafe {
            let appearance_name = if is_dark {
                // 深色模式
                NSString::alloc(nil).init_str("NSAppearanceNameDarkAqua")
            } else {
                // 浅色模式
                NSString::alloc(nil).init_str("NSAppearanceNameAqua")
            };
            
            // 获取 NSAppearance 类
            let appearance_class = objc::class!(NSAppearance);
            let appearance: id = msg_send![appearance_class, appearanceNamed: appearance_name];
            let _: () = msg_send![ns_window, setAppearance: appearance];
        }
    }
    
    Ok(())
}


// Window-related commands

/// Set window theme (macOS title bar)
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
                // Dark mode
                NSString::alloc(nil).init_str("NSAppearanceNameDarkAqua")
            } else {
                // Light mode
                NSString::alloc(nil).init_str("NSAppearanceNameAqua")
            };
            
            // Get NSAppearance class
            let appearance_class = objc::class!(NSAppearance);
            let appearance: id = msg_send![appearance_class, appearanceNamed: appearance_name];
            let _: () = msg_send![ns_window, setAppearance: appearance];
        }
    }
    
    Ok(())
}

/// Open developer tools
#[tauri::command]
pub fn open_devtools(_window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    {
        let _ = _window.open_devtools();
    }
}


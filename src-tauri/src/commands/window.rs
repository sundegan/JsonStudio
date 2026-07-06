// Window-related commands

fn transparent_window_background() -> tauri::window::Color {
    tauri::window::Color(0, 0, 0, 0)
}

/// Set the native window theme while leaving custom chrome transparency intact.
#[tauri::command]
pub fn set_window_theme(window: tauri::Window, is_dark: bool) -> Result<(), String> {
    let theme = if is_dark {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    };
    window.set_theme(Some(theme)).map_err(|e| e.to_string())?;
    window
        .set_background_color(Some(transparent_window_background()))
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        apply_macos_transparent_chrome(window.ns_window().map_err(|e| e.to_string())?);

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

#[cfg(target_os = "macos")]
pub fn apply_macos_transparent_chrome(ns_window: *mut std::ffi::c_void) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil, NO};
    use objc::{msg_send, sel, sel_impl};

    let ns_window = ns_window as id;

    unsafe {
        let background = NSColor::clearColor(nil);
        ns_window.setOpaque_(NO);
        ns_window.setBackgroundColor_(background);
        let _: () = msg_send![ns_window, setHasShadow: NO];
    }
}

/// Return the desktop OS as reported by Rust, for platform-specific custom chrome.
#[tauri::command]
pub fn desktop_platform() -> &'static str {
    std::env::consts::OS
}

/// Quit the application
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Restart the application after an update has been installed.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Open developer tools
#[tauri::command]
pub fn open_devtools(_window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    {
        let _ = _window.open_devtools();
    }
}

// Window-related commands
// 抑制 objc crate 宏中的 unexpected_cfgs 警告（来自第三方库）
#![allow(unexpected_cfgs)]

fn window_background_color(is_dark: bool) -> tauri::window::Color {
    if is_dark {
        tauri::window::Color(18, 18, 18, 255)
    } else {
        tauri::window::Color(250, 250, 250, 255)
    }
}

/// Set the native window theme so the title bar follows the app appearance.
#[tauri::command]
pub fn set_window_theme(window: tauri::Window, is_dark: bool) -> Result<(), String> {
    let theme = if is_dark {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    };
    window.set_theme(Some(theme)).map_err(|e| e.to_string())?;
    window
        .set_background_color(Some(window_background_color(is_dark)))
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::{NSColor, NSWindow};
        use cocoa::base::{id, nil, NO};
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

            let (red, green, blue) = if is_dark {
                (18.0 / 255.0, 18.0 / 255.0, 18.0 / 255.0)
            } else {
                (250.0 / 255.0, 250.0 / 255.0, 250.0 / 255.0)
            };
            let background =
                NSColor::colorWithSRGBRed_green_blue_alpha_(nil, red, green, blue, 1.0);
            ns_window.setTitlebarAppearsTransparent_(NO);
            ns_window.setBackgroundColor_(background);
        }
    }

    Ok(())
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

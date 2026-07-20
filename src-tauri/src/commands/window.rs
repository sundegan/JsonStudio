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

        // Changing the appearance relayouts the native titlebar. Position the
        // traffic lights after that relayout so a theme switch cannot move them.
        apply_macos_transparent_chrome(ns_window as *mut std::ffi::c_void);
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub fn apply_macos_transparent_chrome(ns_window: *mut std::ffi::c_void) {
    use cocoa::appkit::{
        NSColor, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask, NSWindowTitleVisibility,
    };
    use cocoa::base::{id, nil, NO, YES};
    use objc::{msg_send, sel, sel_impl};

    let ns_window = ns_window as id;

    unsafe {
        let background = NSColor::clearColor(nil);
        let current_style_mask = ns_window.styleMask();
        let mut style_mask = current_style_mask;
        style_mask |= NSWindowStyleMask::NSTitledWindowMask;
        style_mask |= NSWindowStyleMask::NSClosableWindowMask;
        style_mask |= NSWindowStyleMask::NSMiniaturizableWindowMask;
        style_mask |= NSWindowStyleMask::NSResizableWindowMask;
        style_mask |= NSWindowStyleMask::NSFullSizeContentViewWindowMask;
        if style_mask != current_style_mask {
            ns_window.setStyleMask_(style_mask);
        }
        ns_window.setTitleVisibility_(NSWindowTitleVisibility::NSWindowTitleHidden);
        ns_window.setTitlebarAppearsTransparent_(YES);
        position_macos_traffic_lights(ns_window);
        ns_window.setOpaque_(NO);
        ns_window.setBackgroundColor_(background);
        let _: () = msg_send![ns_window, setHasShadow: NO];

        let mut behavior = ns_window.collectionBehavior();
        behavior |= NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenPrimary;
        behavior |= NSWindowCollectionBehavior::NSWindowCollectionBehaviorManaged;
        behavior |= NSWindowCollectionBehavior::NSWindowCollectionBehaviorParticipatesInCycle;
        behavior &= !NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary;
        ns_window.setCollectionBehavior_(behavior);
    }
}

#[cfg(target_os = "macos")]
pub fn reposition_macos_traffic_lights(ns_window: *mut std::ffi::c_void) {
    unsafe {
        position_macos_traffic_lights(ns_window as cocoa::base::id);
    }
}

#[cfg(target_os = "macos")]
unsafe fn position_macos_traffic_lights(ns_window: cocoa::base::id) {
    use cocoa::appkit::{NSView, NSWindow, NSWindowButton};
    use cocoa::base::nil;
    use objc::{msg_send, sel, sel_impl};

    const TRAFFIC_LIGHT_X: f64 = 10.0;
    const TRAFFIC_LIGHT_TOP_INSET: f64 = 20.0;

    let close_button = ns_window.standardWindowButton_(NSWindowButton::NSWindowCloseButton);
    let minimize_button =
        ns_window.standardWindowButton_(NSWindowButton::NSWindowMiniaturizeButton);
    let zoom_button = ns_window.standardWindowButton_(NSWindowButton::NSWindowZoomButton);
    if close_button == nil || minimize_button == nil || zoom_button == nil {
        return;
    }

    let titlebar_container = close_button.superview().superview();
    if titlebar_container == nil {
        return;
    }

    let close_frame = NSView::frame(close_button);
    let mut titlebar_frame = NSView::frame(titlebar_container);
    titlebar_frame.size.height = close_frame.size.height + TRAFFIC_LIGHT_TOP_INSET;
    titlebar_frame.origin.y = NSWindow::frame(ns_window).size.height - titlebar_frame.size.height;
    let _: () = msg_send![titlebar_container, setFrame: titlebar_frame];

    let button_gap = NSView::frame(minimize_button).origin.x - close_frame.origin.x;
    for (index, button) in [close_button, minimize_button, zoom_button]
        .into_iter()
        .enumerate()
    {
        let mut frame = NSView::frame(button);
        frame.origin.x = TRAFFIC_LIGHT_X + index as f64 * button_gap;
        button.setFrameOrigin(frame.origin);
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

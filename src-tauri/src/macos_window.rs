use crate::app_state::{focus_main_window, queue_or_emit_open_files};
use crate::commands::window::{apply_macos_transparent_chrome, reposition_macos_traffic_lights};
use crate::macos_menu_view::make_window_position_menu_item_view;
use crate::window_bounds::restored_window_axis;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

const DEFAULT_WIDTH: f64 = 1280.0;
const DEFAULT_HEIGHT: f64 = 800.0;
const MIN_WIDTH: f64 = 960.0;
const MIN_HEIGHT: f64 = 640.0;

#[derive(Clone, Copy)]
enum Placement {
    Left,
    Right,
    Top,
    Bottom,
    Center,
}

fn placement_frame(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale: f64,
    placement: Placement,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let centered = PhysicalSize {
        width: ((restored_window_axis(
            DEFAULT_WIDTH,
            size.width as f64 / scale,
            DEFAULT_WIDTH,
            MIN_WIDTH,
        ) * scale)
            .round() as u32)
            .max(1)
            .min(size.width),
        height: ((restored_window_axis(
            DEFAULT_HEIGHT,
            size.height as f64 / scale,
            DEFAULT_HEIGHT,
            MIN_HEIGHT,
        ) * scale)
            .round() as u32)
            .max(1)
            .min(size.height),
    };
    match placement {
        Placement::Left => (
            position,
            PhysicalSize {
                width: (size.width / 2).max(1),
                height: size.height,
            },
        ),
        Placement::Right => {
            let width = size.width.saturating_sub(size.width / 2).max(1);
            (
                PhysicalPosition {
                    x: position.x + size.width.saturating_sub(width) as i32,
                    y: position.y,
                },
                PhysicalSize {
                    width,
                    height: size.height,
                },
            )
        }
        Placement::Top => (
            position,
            PhysicalSize {
                width: size.width,
                height: (size.height / 2).max(1),
            },
        ),
        Placement::Bottom => {
            let height = size.height.saturating_sub(size.height / 2).max(1);
            (
                PhysicalPosition {
                    x: position.x,
                    y: position.y + size.height.saturating_sub(height) as i32,
                },
                PhysicalSize {
                    width: size.width,
                    height,
                },
            )
        }
        Placement::Center => (
            PhysicalPosition {
                x: position.x + size.width.saturating_sub(centered.width) as i32 / 2,
                y: position.y + size.height.saturating_sub(centered.height) as i32 / 2,
            },
            centered,
        ),
    }
}

fn position_main_window(app: &tauri::AppHandle, placement: Placement) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
    }
    let _ = window.unmaximize();
    let Ok(Some(monitor)) = window
        .current_monitor()
        .or_else(|_| window.primary_monitor())
    else {
        return;
    };
    let area = *monitor.work_area();
    let (position, size) =
        placement_frame(area.position, area.size, monitor.scale_factor(), placement);
    let _ = window.set_size(size);
    let _ = window.set_position(position);
    let _ = window.set_focus();
}

fn placement_for_key(
    key: u16,
    control: bool,
    function: bool,
    shift: bool,
    option: bool,
    command: bool,
) -> Option<Placement> {
    if !control || !function || shift || option || command {
        return None;
    }
    match key {
        123 | 115 => Some(Placement::Left),
        124 | 119 => Some(Placement::Right),
        125 | 121 => Some(Placement::Bottom),
        126 | 116 => Some(Placement::Top),
        8 => Some(Placement::Center),
        _ => None,
    }
}

fn install_event_tap(app: &tauri::AppHandle) {
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
        CGEventTapPlacement, CGEventType, EventField,
    };
    let app_handle = app.clone();
    let Ok(tap) = CGEventTap::new(
        CGEventTapLocation::Session,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![CGEventType::KeyDown],
        move |_, event_type, event: &CGEvent| {
            if event_type as u32 == CGEventType::KeyDown as u32
                && app_handle
                    .get_webview_window("main")
                    .is_some_and(|window| window.is_focused().unwrap_or(false))
            {
                let flags = event.get_flags();
                if let Some(placement) = placement_for_key(
                    event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16,
                    flags.contains(CGEventFlags::CGEventFlagControl),
                    flags.contains(CGEventFlags::CGEventFlagSecondaryFn),
                    flags.contains(CGEventFlags::CGEventFlagShift),
                    flags.contains(CGEventFlags::CGEventFlagAlternate),
                    flags.contains(CGEventFlags::CGEventFlagCommand),
                ) {
                    position_main_window(&app_handle, placement);
                }
            }
            Some(event.clone())
        },
    ) else {
        return;
    };
    if let Ok(source) = tap.mach_port.create_runloop_source(0) {
        CFRunLoop::get_main().add_source(&source, unsafe { kCFRunLoopCommonModes });
        tap.enable();
        std::mem::forget(source);
        std::mem::forget(tap);
    }
}

fn text(language: &str, key: &str) -> &'static str {
    match (language, key) {
        ("en", "about") => "About Json Studio",
        (_, "about") => "关于 Json Studio",
        ("en", "settings") => "Settings...",
        (_, "settings") => "设置...",
        ("en", "updates") => "Check for Updates...",
        (_, "updates") => "检查更新...",
        ("en", "window") => "Window",
        (_, "window") => "窗口",
        ("en", "close") => "Close Window",
        (_, "close") => "关闭窗口",
        ("en", "minimize") => "Minimize",
        (_, "minimize") => "最小化",
        ("en", "move") => "Move & Resize",
        (_, "move") => "移动与调整大小",
        ("en", "left") => "Left",
        (_, "left") => "左侧",
        ("en", "right") => "Right",
        (_, "right") => "右侧",
        ("en", "top") => "Top",
        (_, "top") => "上侧",
        ("en", "bottom") => "Bottom",
        (_, "bottom") => "下侧",
        ("en", "center") => "Center",
        _ => "居中",
    }
}

fn apply_menu_views(language: &str) -> usize {
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSString;
    use objc::{class, msg_send, sel, sel_impl};
    let labels = [
        ("left", "fn⌃←"),
        ("right", "fn⌃→"),
        ("top", "fn⌃↑"),
        ("bottom", "fn⌃↓"),
        ("center", "fn⌃C"),
    ];
    unsafe {
        let app: id = msg_send![class!(NSApplication), sharedApplication];
        let main: id = msg_send![app, mainMenu];
        if main == nil {
            return 0;
        }
        let move_title = NSString::alloc(nil).init_str(text(language, "move"));
        let mut count = 0;
        let root_count: usize = msg_send![main, numberOfItems];
        for root_index in 0..root_count {
            let root: id = msg_send![main, itemAtIndex: root_index];
            let submenu: id = msg_send![root, submenu];
            if submenu == nil {
                continue;
            }
            let parent: id = msg_send![submenu, itemWithTitle: move_title];
            if parent == nil {
                continue;
            }
            let menu: id = msg_send![parent, submenu];
            if menu == nil {
                continue;
            }
            for (key, shortcut) in labels {
                let label = text(language, key);
                let title = NSString::alloc(nil).init_str(label);
                let item: id = msg_send![menu, itemWithTitle: title];
                let _: () = msg_send![title, release];
                if item == nil {
                    continue;
                }
                let view = make_window_position_menu_item_view(label, shortcut, item);
                let _: () = msg_send![item, setView: view];
                let _: () = msg_send![view, release];
                count += 1;
            }
        }
        let _: () = msg_send![move_title, release];
        count
    }
}

fn schedule_menu_views(app: tauri::AppHandle, language: String, attempts: u8) {
    let callback_app = app.clone();
    let _ = app.run_on_main_thread(move || {
        if apply_menu_views(&language) == 0 && attempts > 0 {
            schedule_menu_views(callback_app, language, attempts - 1);
        }
    });
}

fn set_menu(app: &tauri::AppHandle, language: &str) -> tauri::Result<()> {
    let app_menu = SubmenuBuilder::new(app, "Json Studio")
        .text("show_about", text(language, "about"))
        .separator()
        .text("open_settings", text(language, "settings"))
        .separator()
        .text("check_for_update", text(language, "updates"))
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
    let close = MenuItemBuilder::with_id("window_close", text(language, "close"))
        .accelerator("Control+W")
        .build(app)?;
    let minimize = MenuItemBuilder::with_id("window_minimize", text(language, "minimize"))
        .accelerator("Control+M")
        .build(app)?;
    let left = MenuItemBuilder::with_id("window_move_left", text(language, "left")).build(app)?;
    let right =
        MenuItemBuilder::with_id("window_move_right", text(language, "right")).build(app)?;
    let top = MenuItemBuilder::with_id("window_move_top", text(language, "top")).build(app)?;
    let bottom =
        MenuItemBuilder::with_id("window_move_bottom", text(language, "bottom")).build(app)?;
    let center =
        MenuItemBuilder::with_id("window_move_center", text(language, "center")).build(app)?;
    let move_menu = SubmenuBuilder::new(app, text(language, "move").replace('&', "&&"))
        .item(&left)
        .item(&right)
        .item(&top)
        .item(&bottom)
        .separator()
        .item(&center)
        .build()?;
    let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, text(language, "window"))
        .item(&close)
        .item(&minimize)
        .separator()
        .item(&move_menu)
        .maximize()
        .fullscreen()
        .build()?;
    app.set_menu(
        MenuBuilder::new(app)
            .items(&[&app_menu, &edit_menu, &window_menu])
            .build()?,
    )?;
    schedule_menu_views(app.clone(), language.to_owned(), 4);
    Ok(())
}

pub(crate) fn set_app_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    set_menu(&app, &language).map_err(|error| error.to_string())
}

pub(crate) fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        apply_macos_transparent_chrome(window.ns_window()?);
    }
    set_menu(app, "zh")?;
    install_event_tap(app);
    app.on_menu_event(|app, event| match event.id().0.as_str() {
        "show_about" => {
            focus_main_window(app);
            let _ = app.emit("show-about", ());
        }
        "check_for_update" => {
            focus_main_window(app);
            let _ = app.emit("check-for-update", ());
        }
        "open_settings" => {
            focus_main_window(app);
            let _ = app.emit("open-settings", ());
        }
        "window_close" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        "window_minimize" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.minimize();
            }
        }
        "window_move_left" => position_main_window(app, Placement::Left),
        "window_move_right" => position_main_window(app, Placement::Right),
        "window_move_top" => position_main_window(app, Placement::Top),
        "window_move_bottom" => position_main_window(app, Placement::Bottom),
        "window_move_center" => position_main_window(app, Placement::Center),
        _ => {}
    });
    Ok(())
}

pub(crate) fn handle_run_event(app: &tauri::AppHandle, event: &tauri::RunEvent) {
    match event {
        tauri::RunEvent::Opened { urls } => {
            let paths = urls
                .iter()
                .filter_map(|url| {
                    (url.scheme() == "file")
                        .then(|| url.to_file_path().ok())
                        .flatten()
                        .map(|path| path.to_string_lossy().into_owned())
                })
                .collect();
            queue_or_emit_open_files(app, paths);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Resized(_),
            ..
        } if label == "main" => {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(ns_window) = window.ns_window() {
                    reposition_macos_traffic_lights(ns_window);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::{placement_frame, Placement};
    use tauri::{PhysicalPosition, PhysicalSize};

    #[test]
    fn splits_work_area_for_each_edge() {
        let position = PhysicalPosition { x: 100, y: 50 };
        let size = PhysicalSize {
            width: 1513,
            height: 801,
        };
        assert_eq!(
            placement_frame(position, size, 1.0, Placement::Left),
            (
                position,
                PhysicalSize {
                    width: 756,
                    height: 801
                }
            )
        );
        assert_eq!(
            placement_frame(position, size, 1.0, Placement::Right),
            (
                PhysicalPosition { x: 856, y: 50 },
                PhysicalSize {
                    width: 757,
                    height: 801
                }
            )
        );
        assert_eq!(
            placement_frame(position, size, 1.0, Placement::Top),
            (
                position,
                PhysicalSize {
                    width: 1513,
                    height: 400
                }
            )
        );
        assert_eq!(
            placement_frame(position, size, 1.0, Placement::Bottom),
            (
                PhysicalPosition { x: 100, y: 450 },
                PhysicalSize {
                    width: 1513,
                    height: 401
                }
            )
        );
    }

    #[test]
    fn centers_default_window_in_work_area() {
        assert_eq!(
            placement_frame(
                PhysicalPosition { x: 100, y: 50 },
                PhysicalSize {
                    width: 2000,
                    height: 1400
                },
                1.0,
                Placement::Center,
            ),
            (
                PhysicalPosition { x: 460, y: 350 },
                PhysicalSize {
                    width: 1280,
                    height: 800
                }
            )
        );
    }
}

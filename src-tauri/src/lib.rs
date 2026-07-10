mod commands;

use commands::codegen::{code_to_json, json_to_code};
use commands::convert::{
    csv_to_json, json_to_csv, json_to_toml, json_to_xml, json_to_yaml, toml_to_json, xml_to_json,
    yaml_to_json,
};
use commands::export_image::export_json_image;
use commands::file::{
    create_untitled_json, get_file_name, is_json_file, open_file_dialog, open_folder_dialog,
    read_file, read_json_dir, save_binary_file_dialog, save_file, save_file_dialog, show_in_folder,
    JSON_FILE_EXTENSIONS,
};
use commands::file_watcher::{unwatch_all_files, unwatch_file, watch_file, FileWatcherState};
use commands::json::{json_escape, json_format, json_minify, json_unescape};
use commands::shortcuts::{
    format_clipboard_and_show, register_global_shortcut, show_main_window, update_shortcut,
    GlobalShortcutRegistry, DEFAULT_FORMAT_CLIPBOARD_SHORTCUT, DEFAULT_SHOW_APP_SHORTCUT,
    FORMAT_CLIPBOARD_SHORTCUT_ID, SHOW_APP_SHORTCUT_ID,
};
#[cfg(target_os = "macos")]
use commands::window::{apply_macos_transparent_chrome, reposition_macos_traffic_lights};
use commands::window::{desktop_platform, open_devtools, quit_app, restart_app, set_window_theme};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::sync::Once;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const WINDOW_SCREEN_MARGIN: u32 = 48;
const DEFAULT_WINDOW_LOGICAL_WIDTH: u32 = 1280;
const DEFAULT_WINDOW_LOGICAL_HEIGHT: u32 = 800;
const MIN_WINDOW_LOGICAL_WIDTH: u32 = 960;
const MIN_WINDOW_LOGICAL_HEIGHT: u32 = 640;
const RESTORED_WINDOW_MAX_SCREEN_RATIO: f64 = 0.9;

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
enum WindowPlacement {
    Left,
    Right,
    Top,
    Bottom,
    Center,
}

#[cfg(target_os = "macos")]
#[derive(Debug, PartialEq, Eq)]
struct WindowPlacementFrame {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

static PENDING_FILES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static FRONTEND_READY: Mutex<bool> = Mutex::new(false);

#[tauri::command]
fn get_pending_files() -> Vec<String> {
    *FRONTEND_READY.lock().unwrap() = true;
    PENDING_FILES.lock().unwrap().drain(..).collect()
}

fn collect_json_file_args(args: &[String], cwd: &str) -> Vec<String> {
    let cwd = Path::new(cwd);
    args.iter()
        .filter_map(|arg| resolve_json_file_arg(arg, cwd))
        .collect()
}

fn resolve_json_file_arg(arg: &str, cwd: &Path) -> Option<String> {
    if arg.starts_with('-') {
        return None;
    }

    let raw_path = PathBuf::from(arg);
    let path = if raw_path.is_absolute() {
        raw_path
    } else {
        cwd.join(raw_path)
    };

    let extension = path.extension().and_then(|ext| ext.to_str())?;
    if !JSON_FILE_EXTENSIONS
        .iter()
        .any(|supported| extension.eq_ignore_ascii_case(supported))
        || !path.is_file()
    {
        return None;
    }

    Some(path.to_string_lossy().into_owned())
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn queue_or_emit_open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    focus_main_window(app);

    let ready = *FRONTEND_READY.lock().unwrap();
    if ready {
        let _ = app.emit("open-file", paths);
    } else {
        PENDING_FILES.lock().unwrap().extend(paths);
    }
}

fn clamp_axis(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn max_window_axis(work_area_axis: f64, min_axis: f64) -> f64 {
    (work_area_axis * RESTORED_WINDOW_MAX_SCREEN_RATIO)
        .round()
        .min((work_area_axis - WINDOW_SCREEN_MARGIN as f64).max(min_axis))
        .max(work_area_axis / 2.0)
        .max(min_axis)
}

fn restored_window_axis(
    current_axis: f64,
    work_area_axis: f64,
    default_axis: f64,
    min_axis: f64,
) -> f64 {
    let max_axis = max_window_axis(work_area_axis, min_axis);
    if current_axis > work_area_axis - WINDOW_SCREEN_MARGIN as f64 {
        return default_axis.min(max_axis).max(min_axis);
    }

    current_axis.min(max_axis).max(min_axis)
}

fn clamp_main_window_to_visible_area(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }

    let Some(monitor) = window
        .current_monitor()?
        .or(window.primary_monitor()?)
        .or_else(|| window.available_monitors().ok()?.into_iter().next())
    else {
        return Ok(());
    };

    let work_area = *monitor.work_area();
    let monitor_position = work_area.position;
    let monitor_size = work_area.size;
    let scale_factor = monitor.scale_factor();
    let current_size = window.inner_size()?;
    let current_logical_size = current_size.to_logical::<f64>(scale_factor);
    let work_area_logical_size = monitor_size.to_logical::<f64>(scale_factor);
    let clamped_logical_size = LogicalSize {
        width: restored_window_axis(
            current_logical_size.width,
            work_area_logical_size.width,
            DEFAULT_WINDOW_LOGICAL_WIDTH as f64,
            MIN_WINDOW_LOGICAL_WIDTH as f64,
        ),
        height: restored_window_axis(
            current_logical_size.height,
            work_area_logical_size.height,
            DEFAULT_WINDOW_LOGICAL_HEIGHT as f64,
            MIN_WINDOW_LOGICAL_HEIGHT as f64,
        ),
    };
    let clamped_size = clamped_logical_size.to_physical::<u32>(scale_factor);

    if clamped_size != current_size {
        window.set_size(clamped_logical_size)?;
    }

    let current_position = window.outer_position()?;
    let max_x = monitor_position.x + monitor_size.width.saturating_sub(clamped_size.width) as i32;
    let max_y = monitor_position.y + monitor_size.height.saturating_sub(clamped_size.height) as i32;
    let clamped_position = PhysicalPosition {
        x: clamp_axis(current_position.x, monitor_position.x, max_x),
        y: clamp_axis(current_position.y, monitor_position.y, max_y),
    };

    if clamped_position != current_position {
        window.set_position(clamped_position)?;
    }

    Ok(())
}

fn schedule_main_window_bounds_clamp(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = clamp_main_window_to_visible_area(&window);
        }
    });
}

#[cfg(target_os = "macos")]
fn placement_frame_for_work_area(
    work_area_position: PhysicalPosition<i32>,
    work_area_size: PhysicalSize<u32>,
    scale_factor: f64,
    placement: WindowPlacement,
) -> WindowPlacementFrame {
    let half_width = (work_area_size.width / 2).max(1);
    let right_width = work_area_size.width.saturating_sub(half_width).max(1);
    let half_height = (work_area_size.height / 2).max(1);
    let bottom_height = work_area_size.height.saturating_sub(half_height).max(1);
    let scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let work_area_logical_width = work_area_size.width as f64 / scale_factor;
    let work_area_logical_height = work_area_size.height as f64 / scale_factor;
    let centered_width = restored_window_axis(
        DEFAULT_WINDOW_LOGICAL_WIDTH as f64,
        work_area_logical_width,
        DEFAULT_WINDOW_LOGICAL_WIDTH as f64,
        MIN_WINDOW_LOGICAL_WIDTH as f64,
    );
    let centered_height = restored_window_axis(
        DEFAULT_WINDOW_LOGICAL_HEIGHT as f64,
        work_area_logical_height,
        DEFAULT_WINDOW_LOGICAL_HEIGHT as f64,
        MIN_WINDOW_LOGICAL_HEIGHT as f64,
    );
    let centered_physical_width = ((centered_width * scale_factor).round() as u32).max(1);
    let centered_physical_height = ((centered_height * scale_factor).round() as u32).max(1);

    match placement {
        WindowPlacement::Left => WindowPlacementFrame {
            position: work_area_position,
            size: PhysicalSize {
                width: half_width,
                height: work_area_size.height,
            },
        },
        WindowPlacement::Right => WindowPlacementFrame {
            position: PhysicalPosition {
                x: work_area_position.x + half_width as i32,
                y: work_area_position.y,
            },
            size: PhysicalSize {
                width: right_width,
                height: work_area_size.height,
            },
        },
        WindowPlacement::Top => WindowPlacementFrame {
            position: work_area_position,
            size: PhysicalSize {
                width: work_area_size.width,
                height: half_height,
            },
        },
        WindowPlacement::Bottom => WindowPlacementFrame {
            position: PhysicalPosition {
                x: work_area_position.x,
                y: work_area_position.y + half_height as i32,
            },
            size: PhysicalSize {
                width: work_area_size.width,
                height: bottom_height,
            },
        },
        WindowPlacement::Center => WindowPlacementFrame {
            position: PhysicalPosition {
                x: work_area_position.x
                    + work_area_size
                        .width
                        .saturating_sub(centered_physical_width) as i32
                        / 2,
                y: work_area_position.y
                    + work_area_size
                        .height
                        .saturating_sub(centered_physical_height) as i32
                        / 2,
            },
            size: PhysicalSize {
                width: centered_physical_width.min(work_area_size.width).max(1),
                height: centered_physical_height.min(work_area_size.height).max(1),
            },
        },
    }
}

#[cfg(target_os = "macos")]
fn position_main_window(app: &tauri::AppHandle, placement: WindowPlacement) {
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

    let work_area = *monitor.work_area();
    let frame = placement_frame_for_work_area(
        work_area.position,
        work_area.size,
        monitor.scale_factor(),
        placement,
    );
    let _ = window.set_size(frame.size);
    let _ = window.set_position(frame.position);
    let _ = window.set_focus();
}

#[cfg(target_os = "macos")]
fn macos_window_placement_for_key_event(
    key_code: u16,
    has_control: bool,
    has_function: bool,
    has_shift: bool,
    has_option: bool,
    has_command: bool,
) -> Option<WindowPlacement> {
    if !has_control || !has_function || has_shift || has_option || has_command {
        return None;
    }

    match key_code {
        123 | 115 => Some(WindowPlacement::Left),
        124 | 119 => Some(WindowPlacement::Right),
        125 | 121 => Some(WindowPlacement::Bottom),
        126 | 116 => Some(WindowPlacement::Top),
        8 => Some(WindowPlacement::Center),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn install_macos_window_position_event_tap(app: &tauri::AppHandle) {
    use core_foundation::runloop::{CFRunLoop, kCFRunLoopCommonModes};
    use core_graphics::event::{
        CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
        CGEventTapPlacement, CGEventType, EventField,
    };

    let app_handle = app.clone();
    let Ok(event_tap) = CGEventTap::new(
        CGEventTapLocation::Session,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![CGEventType::KeyDown],
        move |_proxy, event_type, event: &CGEvent| {
            if event_type as u32 != CGEventType::KeyDown as u32 {
                return Some(event.clone());
            }

            let Some(window) = app_handle.get_webview_window("main") else {
                return Some(event.clone());
            };
            if !window.is_focused().unwrap_or(false) {
                return Some(event.clone());
            }

            let flags = event.get_flags();
            let placement = macos_window_placement_for_key_event(
                event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16,
                flags.contains(CGEventFlags::CGEventFlagControl),
                flags.contains(CGEventFlags::CGEventFlagSecondaryFn),
                flags.contains(CGEventFlags::CGEventFlagShift),
                flags.contains(CGEventFlags::CGEventFlagAlternate),
                flags.contains(CGEventFlags::CGEventFlagCommand),
            );

            if let Some(placement) = placement {
                position_main_window(&app_handle, placement);
            }

            Some(event.clone())
        },
    ) else {
        return;
    };

    if let Ok(source) = event_tap.mach_port.create_runloop_source(0) {
        CFRunLoop::get_main().add_source(&source, unsafe { kCFRunLoopCommonModes });
        event_tap.enable();
        std::mem::forget(source);
        std::mem::forget(event_tap);
    }
}

#[cfg(target_os = "macos")]
fn about_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "About Json Studio",
        _ => "关于 Json Studio",
    }
}

#[cfg(target_os = "macos")]
fn settings_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Settings...",
        _ => "设置...",
    }
}

#[cfg(target_os = "macos")]
fn check_for_update_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Check for Updates...",
        _ => "检查更新...",
    }
}

#[cfg(target_os = "macos")]
fn window_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Window",
        _ => "窗口",
    }
}

#[cfg(target_os = "macos")]
fn close_window_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Close Window",
        _ => "关闭窗口",
    }
}

#[cfg(target_os = "macos")]
fn minimize_window_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Minimize",
        _ => "最小化",
    }
}

#[cfg(target_os = "macos")]
fn move_resize_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Move & Resize",
        _ => "移动与调整大小",
    }
}

#[cfg(target_os = "macos")]
fn move_left_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Left",
        _ => "左侧",
    }
}

#[cfg(target_os = "macos")]
fn move_right_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Right",
        _ => "右侧",
    }
}

#[cfg(target_os = "macos")]
fn move_top_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Top",
        _ => "上侧",
    }
}

#[cfg(target_os = "macos")]
fn move_bottom_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Bottom",
        _ => "下侧",
    }
}

#[cfg(target_os = "macos")]
fn move_center_menu_text(language: &str) -> &'static str {
    match language {
        "en" => "Center",
        _ => "居中",
    }
}

#[cfg(target_os = "macos")]
extern "C" fn draw_macos_window_position_menu_item(
    view: &objc::runtime::Object,
    _: objc::runtime::Sel,
    dirty_rect: cocoa::foundation::NSRect,
) {
    use cocoa::appkit::NSRectFill;
    use cocoa::base::{id, YES};
    use cocoa::foundation::{NSPoint, NSString};
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let menu_item: id = *view.get_ivar("menuItem");
        let highlighted: bool = if menu_item == std::ptr::null_mut() {
            false
        } else {
            let highlighted: cocoa::base::BOOL = msg_send![menu_item, isHighlighted];
            highlighted == YES
        };
        let title: id = *view.get_ivar("title");
        let shortcut: id = *view.get_ivar("shortcut");
        let font: id = msg_send![class!(NSFont), menuFontOfSize: 0.0f64];

        if highlighted {
            let background: id = msg_send![class!(NSColor), selectedMenuItemColor];
            let _: () = msg_send![background, set];
            NSRectFill(dirty_rect);
        }

        let title_color: id = if highlighted {
            msg_send![class!(NSColor), selectedMenuItemTextColor]
        } else {
            msg_send![class!(NSColor), textColor]
        };
        let shortcut_color: id = if highlighted {
            title_color
        } else {
            msg_send![class!(NSColor), secondaryLabelColor]
        };
        let font_key = NSString::alloc(cocoa::base::nil).init_str("NSFont");
        let color_key = NSString::alloc(cocoa::base::nil).init_str("NSColor");
        let keys = [font_key, color_key];
        let title_values = [font, title_color];
        let shortcut_values = [font, shortcut_color];
        let title_attributes: id = msg_send![
            class!(NSDictionary),
            dictionaryWithObjects: title_values.as_ptr()
            forKeys: keys.as_ptr()
            count: 2usize
        ];
        let shortcut_attributes: id = msg_send![
            class!(NSDictionary),
            dictionaryWithObjects: shortcut_values.as_ptr()
            forKeys: keys.as_ptr()
            count: 2usize
        ];
        let bounds: cocoa::foundation::NSRect = msg_send![view, bounds];
        let shortcut_size: cocoa::foundation::NSSize =
            msg_send![shortcut, sizeWithAttributes: shortcut_attributes];
        let _: () = msg_send![
            title,
            drawAtPoint: NSPoint { x: 12.0, y: 3.0 }
            withAttributes: title_attributes
        ];
        let _: () = msg_send![
            shortcut,
            drawAtPoint: NSPoint {
                x: (bounds.size.width - shortcut_size.width - 12.0).max(12.0),
                y: 3.0,
            }
            withAttributes: shortcut_attributes
        ];
        let _: () = msg_send![font_key, release];
        let _: () = msg_send![color_key, release];
    }
}

#[cfg(target_os = "macos")]
extern "C" fn hit_test_macos_window_position_menu_item(
    _: &objc::runtime::Object,
    _: objc::runtime::Sel,
    _: cocoa::foundation::NSPoint,
) -> cocoa::base::id {
    cocoa::base::nil
}

#[cfg(target_os = "macos")]
extern "C" fn dealloc_macos_window_position_menu_item(
    view: &mut objc::runtime::Object,
    _: objc::runtime::Sel,
) {
    use cocoa::base::id;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let title: id = *view.get_ivar("title");
        let shortcut: id = *view.get_ivar("shortcut");
        if title != cocoa::base::nil {
            let _: () = msg_send![title, release];
        }
        if shortcut != cocoa::base::nil {
            let _: () = msg_send![shortcut, release];
        }
        let superclass = class!(NSView);
        let _: () = msg_send![super(view, superclass), dealloc];
    }
}

#[cfg(target_os = "macos")]
fn macos_window_position_menu_item_view_class() -> &'static objc::runtime::Class {
    use objc::declare::ClassDecl;
    use objc::runtime::Class;
    use objc::{class, sel, sel_impl};

    static REGISTER: Once = Once::new();
    REGISTER.call_once(|| unsafe {
        let superclass = class!(NSView);
        let mut declaration = ClassDecl::new("JsonStudioWindowPositionMenuItemView", superclass)
            .expect("menu item view class should be declared once");
        declaration.add_ivar::<cocoa::base::id>("title");
        declaration.add_ivar::<cocoa::base::id>("shortcut");
        declaration.add_ivar::<cocoa::base::id>("menuItem");
        declaration.add_method(
            sel!(drawRect:),
            draw_macos_window_position_menu_item
                as extern "C" fn(
                    &objc::runtime::Object,
                    objc::runtime::Sel,
                    cocoa::foundation::NSRect,
                ),
        );
        declaration.add_method(
            sel!(hitTest:),
            hit_test_macos_window_position_menu_item
                as extern "C" fn(
                    &objc::runtime::Object,
                    objc::runtime::Sel,
                    cocoa::foundation::NSPoint,
                ) -> cocoa::base::id,
        );
        declaration.add_method(
            sel!(dealloc),
            dealloc_macos_window_position_menu_item
                as extern "C" fn(&mut objc::runtime::Object, objc::runtime::Sel),
        );
        declaration.register();
    });

    Class::get("JsonStudioWindowPositionMenuItemView")
        .expect("menu item view class should be registered")
}

#[cfg(target_os = "macos")]
fn make_macos_window_position_menu_item_view(
    title: &str,
    shortcut: &str,
    menu_item: cocoa::base::id,
) -> cocoa::base::id {
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSPoint, NSRect, NSSize, NSString};
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        let class = macos_window_position_menu_item_view_class();
        let view: id = msg_send![class, alloc];
        let view: id = msg_send![
            view,
            initWithFrame: NSRect {
                origin: NSPoint { x: 0.0, y: 0.0 },
                size: NSSize {
                    width: 148.0,
                    height: 22.0,
                },
            }
        ];
        let title = NSString::alloc(nil).init_str(title);
        let shortcut = NSString::alloc(nil).init_str(shortcut);
        (*(view as *mut objc::runtime::Object)).set_ivar("title", title);
        (*(view as *mut objc::runtime::Object)).set_ivar("shortcut", shortcut);
        (*(view as *mut objc::runtime::Object)).set_ivar("menuItem", menu_item);
        view
    }
}

#[cfg(target_os = "macos")]
fn apply_macos_window_position_menu_views(language: &str) -> usize {
    use cocoa::base::{id, nil};
    use cocoa::foundation::NSString;
    use objc::{class, msg_send, sel, sel_impl};

    let move_resize_menu_title = move_resize_menu_text(language);
    let shortcuts = [
        (move_left_menu_text(language), "fn⌃←"),
        (move_right_menu_text(language), "fn⌃→"),
        (move_top_menu_text(language), "fn⌃↑"),
        (move_bottom_menu_text(language), "fn⌃↓"),
        (move_center_menu_text(language), "fn⌃C"),
    ];
    let mut installed_views = 0usize;

    unsafe {
        let app: id = msg_send![class!(NSApplication), sharedApplication];
        let main_menu: id = msg_send![app, mainMenu];
        if main_menu == nil {
            return 0;
        }

        let move_resize_menu_title = NSString::alloc(nil).init_str(move_resize_menu_title);
        let menu_count: usize = msg_send![main_menu, numberOfItems];
        for index in 0..menu_count {
            let root_item: id = msg_send![main_menu, itemAtIndex: index];
            let submenu: id = msg_send![root_item, submenu];
            if submenu == nil {
                continue;
            }

            let move_resize_menu_item: id =
                msg_send![submenu, itemWithTitle: move_resize_menu_title];
            if move_resize_menu_item == nil {
                continue;
            }

            let move_resize_menu: id = msg_send![move_resize_menu_item, submenu];
            if move_resize_menu == nil {
                continue;
            }

            for (title, shortcut) in shortcuts {
                let title_text = title;
                let title = NSString::alloc(nil).init_str(title);
                let item: id = msg_send![move_resize_menu, itemWithTitle: title];
                let _: () = msg_send![title, release];
                if item == nil {
                    continue;
                }

                let view = make_macos_window_position_menu_item_view(title_text, shortcut, item);
                let _: () = msg_send![item, setView: view];
                let _: () = msg_send![view, release];
                let installed_view: id = msg_send![item, view];
                if installed_view != nil {
                    installed_views += 1;
                }
            }
        }

        let _: () = msg_send![move_resize_menu_title, release];
    }

    installed_views
}

#[cfg(target_os = "macos")]
fn schedule_macos_window_position_menu_views(
    app: tauri::AppHandle,
    language: String,
    remaining_attempts: u8,
) {
    let callback_app = app.clone();
    let _ = app.run_on_main_thread(move || {
        if apply_macos_window_position_menu_views(&language) == 0 && remaining_attempts > 0 {
            schedule_macos_window_position_menu_views(
                callback_app,
                language,
                remaining_attempts - 1,
            );
        }
    });
}

#[cfg(target_os = "macos")]
fn set_macos_app_menu(app: &tauri::AppHandle, language: &str) -> tauri::Result<()> {
    let app_menu = SubmenuBuilder::new(app, "Json Studio")
        .text("show_about", about_menu_text(language))
        .separator()
        .text("open_settings", settings_menu_text(language))
        .separator()
        .text("check_for_update", check_for_update_menu_text(language))
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
    let close_window_item =
        MenuItemBuilder::with_id("window_close", close_window_menu_text(language))
            .accelerator("Control+W")
            .build(app)?;
    let minimize_window_item =
        MenuItemBuilder::with_id("window_minimize", minimize_window_menu_text(language))
            .accelerator("Control+M")
            .build(app)?;
    let move_left_item =
        MenuItemBuilder::with_id("window_move_left", move_left_menu_text(language)).build(app)?;
    let move_right_item =
        MenuItemBuilder::with_id("window_move_right", move_right_menu_text(language)).build(app)?;
    let move_top_item =
        MenuItemBuilder::with_id("window_move_top", move_top_menu_text(language)).build(app)?;
    let move_bottom_item =
        MenuItemBuilder::with_id("window_move_bottom", move_bottom_menu_text(language)).build(app)?;
    let move_center_item =
        MenuItemBuilder::with_id("window_move_center", move_center_menu_text(language)).build(app)?;
    let move_resize_menu = SubmenuBuilder::new(app, move_resize_menu_text(language).replace('&', "&&"))
        .item(&move_left_item)
        .item(&move_right_item)
        .item(&move_top_item)
        .item(&move_bottom_item)
        .separator()
        .item(&move_center_item)
        .build()?;
    let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, window_menu_text(language))
        .item(&close_window_item)
        .item(&minimize_window_item)
        .separator()
        .item(&move_resize_menu)
        .maximize()
        .fullscreen()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    schedule_macos_window_position_menu_views(app.clone(), language.to_owned(), 4);

    Ok(())
}

#[tauri::command]
fn set_app_menu_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        set_macos_app_menu(&app, &language).map_err(|error| error.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = language;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("jsonstudio-single-instance-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn collects_absolute_supported_json_file_args_only() {
        let dir = test_dir();
        let supported_paths = [
            "AAA.json",
            "config.JSON5",
            "events.jsonl",
            "stream.ndjson",
            "settings.jsonc",
            "map.geojson",
            "shape.topojson",
            "network.har",
            "site.webmanifest",
            "notebook.ipynb",
            "scan.sarif",
        ]
        .map(|name| dir.join(name));
        let text_path = dir.join("notes.txt");
        for path in &supported_paths {
            fs::write(path, "{}").unwrap();
        }
        fs::write(&text_path, "hello").unwrap();

        let mut args = vec!["JsonStudio.exe".to_string(), "--flag".to_string()];
        args.extend(
            supported_paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned()),
        );
        args.push(text_path.to_string_lossy().into_owned());

        assert_eq!(
            collect_json_file_args(&args, dir.to_str().unwrap()),
            supported_paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn resolves_relative_json_args_against_launch_cwd() {
        let dir = test_dir();
        let json_path = dir.join("BBB.JSON");
        fs::write(&json_path, "{}").unwrap();

        let args = vec!["BBB.JSON".to_string()];

        assert_eq!(
            collect_json_file_args(&args, dir.to_str().unwrap()),
            vec![json_path.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn max_window_axis_keeps_restored_windows_below_screen_width() {
        assert_eq!(max_window_axis(1512.0, 960.0), 1361.0);
    }

    #[test]
    fn max_window_axis_handles_tiny_monitors() {
        assert_eq!(max_window_axis(40.0, 1.0), 20.0);
    }

    #[test]
    fn restored_window_axis_uses_default_for_external_display_state() {
        assert_eq!(
            restored_window_axis(1520.0, 1512.0, 1280.0, 960.0),
            1280.0
        );
    }

    #[test]
    fn restored_window_axis_preserves_reasonable_user_size() {
        assert_eq!(
            restored_window_axis(1161.0, 1512.0, 1280.0, 960.0),
            1161.0
        );
    }

    #[test]
    fn restored_window_axis_raises_tiny_saved_size_to_minimum() {
        assert_eq!(
            restored_window_axis(480.0, 1512.0, 1280.0, 960.0),
            960.0
        );
    }

    #[test]
    fn restored_window_axis_caps_minimum_to_tiny_monitor() {
        assert_eq!(restored_window_axis(1.0, 40.0, 1280.0, 1.0), 20.0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_left_window_placement_uses_left_half_of_work_area() {
        assert_eq!(
            placement_frame_for_work_area(
                PhysicalPosition { x: 100, y: 50 },
                PhysicalSize {
                    width: 1512,
                    height: 982,
                },
                1.0,
                WindowPlacement::Left,
            ),
            WindowPlacementFrame {
                position: PhysicalPosition { x: 100, y: 50 },
                size: PhysicalSize {
                    width: 756,
                    height: 982,
                },
            }
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_right_window_placement_preserves_odd_pixel_width() {
        assert_eq!(
            placement_frame_for_work_area(
                PhysicalPosition { x: -10, y: 20 },
                PhysicalSize {
                    width: 1513,
                    height: 982,
                },
                1.0,
                WindowPlacement::Right,
            ),
            WindowPlacementFrame {
                position: PhysicalPosition { x: 746, y: 20 },
                size: PhysicalSize {
                    width: 757,
                    height: 982,
                },
            }
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_vertical_window_placements_split_work_area_height() {
        assert_eq!(
            placement_frame_for_work_area(
                PhysicalPosition { x: 0, y: 30 },
                PhysicalSize {
                    width: 1200,
                    height: 801,
                },
                1.0,
                WindowPlacement::Top,
            ),
            WindowPlacementFrame {
                position: PhysicalPosition { x: 0, y: 30 },
                size: PhysicalSize {
                    width: 1200,
                    height: 400,
                },
            }
        );

        assert_eq!(
            placement_frame_for_work_area(
                PhysicalPosition { x: 0, y: 30 },
                PhysicalSize {
                    width: 1200,
                    height: 801,
                },
                1.0,
                WindowPlacement::Bottom,
            ),
            WindowPlacementFrame {
                position: PhysicalPosition { x: 0, y: 430 },
                size: PhysicalSize {
                    width: 1200,
                    height: 401,
                },
            }
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_center_window_placement_uses_default_size_and_current_work_area() {
        assert_eq!(
            placement_frame_for_work_area(
                PhysicalPosition { x: 100, y: 50 },
                PhysicalSize {
                    width: 2000,
                    height: 1400,
                },
                1.0,
                WindowPlacement::Center,
            ),
            WindowPlacementFrame {
                position: PhysicalPosition { x: 460, y: 350 },
                size: PhysicalSize {
                    width: 1280,
                    height: 800,
                },
            }
        );
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
            {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let ns_window = window.ns_window().map_err(|error| error.to_string())?;
                    apply_macos_transparent_chrome(ns_window);
                }

                set_macos_app_menu(&app_handle, "zh")?;
                install_macos_window_position_event_tap(&app_handle);

                app.on_menu_event(|app_handle, event| match event.id().0.as_str() {
                    "show_about" => {
                        focus_main_window(app_handle);
                        let _ = app_handle.emit("show-about", ());
                    }
                    "check_for_update" => {
                        focus_main_window(app_handle);
                        let _ = app_handle.emit("check-for-update", ());
                    }
                    "open_settings" => {
                        focus_main_window(app_handle);
                        let _ = app_handle.emit("open-settings", ());
                    }
                    "window_close" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.close();
                        }
                    }
                    "window_minimize" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.minimize();
                        }
                    }
                    "window_move_left" => {
                        position_main_window(app_handle, WindowPlacement::Left);
                    }
                    "window_move_right" => {
                        position_main_window(app_handle, WindowPlacement::Right);
                    }
                    "window_move_top" => {
                        position_main_window(app_handle, WindowPlacement::Top);
                    }
                    "window_move_bottom" => {
                        position_main_window(app_handle, WindowPlacement::Bottom);
                    }
                    "window_move_center" => {
                        position_main_window(app_handle, WindowPlacement::Center);
                    }
                    _ => {}
                });
            }

            // Register global shortcut: show app
            if let Err(error) = register_global_shortcut(
                &app_handle,
                SHOW_APP_SHORTCUT_ID,
                DEFAULT_SHOW_APP_SHORTCUT,
            ) {
                eprintln!("Failed to register show app shortcut: {}", error);
            }

            // Register global shortcut: format clipboard
            if let Err(error) = register_global_shortcut(
                &app_handle,
                FORMAT_CLIPBOARD_SHORTCUT_ID,
                DEFAULT_FORMAT_CLIPBOARD_SHORTCUT,
            ) {
                eprintln!("Failed to register format clipboard shortcut: {}", error);
            }

            #[cfg(not(target_os = "macos"))]
            {
                let args: Vec<String> = std::env::args().skip(1).collect();
                let cwd = std::env::current_dir()
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let paths = collect_json_file_args(&args, &cwd);
                queue_or_emit_open_files(&app_handle, paths);
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
        match event {
            tauri::RunEvent::Opened { urls } => {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| {
                        if url.scheme() == "file" {
                            url.to_file_path()
                                .ok()
                                .map(|p| p.to_string_lossy().into_owned())
                        } else {
                            None
                        }
                    })
                    .collect();

                if !paths.is_empty() {
                    queue_or_emit_open_files(app_handle, paths);
                }
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Resized(_),
                ..
            } if label == "main" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    if let Ok(ns_window) = window.ns_window() {
                        reposition_macos_traffic_lights(ns_window);
                    }
                }
            }
            _ => {}
        }
    });
}

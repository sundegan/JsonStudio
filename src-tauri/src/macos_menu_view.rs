use std::sync::Once;

extern "C" fn draw_window_position_menu_item(
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
        let highlighted = menu_item != std::ptr::null_mut() && {
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

extern "C" fn hit_test_window_position_menu_item(
    _: &objc::runtime::Object,
    _: objc::runtime::Sel,
    _: cocoa::foundation::NSPoint,
) -> cocoa::base::id {
    cocoa::base::nil
}

extern "C" fn dealloc_window_position_menu_item(
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

fn window_position_menu_item_view_class() -> &'static objc::runtime::Class {
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
            draw_window_position_menu_item
                as extern "C" fn(
                    &objc::runtime::Object,
                    objc::runtime::Sel,
                    cocoa::foundation::NSRect,
                ),
        );
        declaration.add_method(
            sel!(hitTest:),
            hit_test_window_position_menu_item
                as extern "C" fn(
                    &objc::runtime::Object,
                    objc::runtime::Sel,
                    cocoa::foundation::NSPoint,
                ) -> cocoa::base::id,
        );
        declaration.add_method(
            sel!(dealloc),
            dealloc_window_position_menu_item
                as extern "C" fn(&mut objc::runtime::Object, objc::runtime::Sel),
        );
        declaration.register();
    });

    Class::get("JsonStudioWindowPositionMenuItemView")
        .expect("menu item view class should be registered")
}

pub(crate) fn make_window_position_menu_item_view(
    title: &str,
    shortcut: &str,
    menu_item: cocoa::base::id,
) -> cocoa::base::id {
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSPoint, NSRect, NSSize, NSString};
    use objc::{msg_send, sel, sel_impl};

    unsafe {
        let class = window_position_menu_item_view_class();
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

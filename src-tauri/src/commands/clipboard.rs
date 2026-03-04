use base64::Engine;

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn copy_image_to_clipboard(png_base64: String) -> Result<(), String> {
    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(&png_base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    write_image_to_clipboard(&image_bytes)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn copy_image_to_clipboard(app: tauri::AppHandle, png_base64: String) -> Result<(), String> {
    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(&png_base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    write_image_to_clipboard(&app, &image_bytes)
}

#[cfg(target_os = "macos")]
fn write_image_to_clipboard(image_bytes: &[u8]) -> Result<(), String> {
    use cocoa::appkit::NSPasteboard;
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSArray, NSData, NSString};
    use objc::{msg_send, sel, sel_impl};
    use objc::rc::autoreleasepool;

    let is_png = image_bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]);
    let uti = if is_png { "public.png" } else { "public.jpeg" };

    unsafe {
        autoreleasepool(|| {
            let pasteboard: id = NSPasteboard::generalPasteboard(nil);
            pasteboard.clearContents();

            let ns_type = NSString::alloc(nil).init_str(uti);
            let ns_data = NSData::dataWithBytes_length_(
                nil,
                image_bytes.as_ptr() as *const std::ffi::c_void,
                image_bytes.len() as u64,
            );

            pasteboard.declareTypes_owner(
                NSArray::arrayWithObject(nil, ns_type),
                nil,
            );

            let success: bool = msg_send![pasteboard, setData: ns_data forType: ns_type];

            if success {
                Ok(())
            } else {
                Err("Failed to write image to pasteboard".to_string())
            }
        })
    }
}

#[cfg(not(target_os = "macos"))]
fn write_image_to_clipboard(app: &tauri::AppHandle, image_bytes: &[u8]) -> Result<(), String> {
    use image::GenericImageView;
    use tauri_plugin_clipboard_manager::ClipboardExt;

    let img = image::load_from_memory(image_bytes)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let (width, height) = img.dimensions();
    let rgba = img.into_rgba8().into_raw();

    let tauri_image = tauri::image::Image::new_owned(rgba, width, height);
    app.clipboard()
        .write_image(&tauri_image)
        .map_err(|e| format!("Failed to write image to clipboard: {}", e))?;

    Ok(())
}

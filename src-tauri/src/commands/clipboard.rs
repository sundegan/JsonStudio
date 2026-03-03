use base64::Engine;
use image::GenericImageView;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

#[tauri::command]
pub async fn copy_image_to_clipboard(app: AppHandle, png_base64: String) -> Result<(), String> {
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(&png_base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    let img = image::load_from_memory_with_format(&png_bytes, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to decode PNG: {}", e))?;

    let (width, height) = img.dimensions();
    let rgba = img.into_rgba8().into_raw();

    let tauri_image = tauri::image::Image::new_owned(rgba, width, height);
    app.clipboard()
        .write_image(&tauri_image)
        .map_err(|e| format!("Failed to write image to clipboard: {}", e))?;

    Ok(())
}

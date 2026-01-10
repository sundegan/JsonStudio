// File operation commands
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Open a JSON file using file picker dialog
#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<(String, String)>, String> {
    let file_path = app.dialog()
        .file()
        .add_filter("JSON Files", &["json"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            let path_buf = PathBuf::from(&path_str);
            match tokio::fs::read_to_string(&path_buf).await {
                Ok(content) => Ok(Some((path_str, content))),
                Err(e) => Err(format!("Failed to read file: {}", e)),
            }
        }
        None => Ok(None), // User cancelled
    }
}

/// Save content to a file (existing file path)
#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to save file: {}", e))
}

/// Save content to a new file using save dialog
#[tauri::command]
pub async fn save_file_dialog(app: AppHandle, content: String) -> Result<Option<String>, String> {
    let file_path = app.dialog()
        .file()
        .add_filter("JSON Files", &["json"])
        .add_filter("All Files", &["*"])
        .set_file_name("untitled.json")
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            let path_buf = PathBuf::from(&path_str);
            tokio::fs::write(&path_buf, content)
                .await
                .map_err(|e| format!("Failed to save file: {}", e))?;
            Ok(Some(path_str))
        }
        None => Ok(None), // User cancelled
    }
}

/// Read file content by path (for drag & drop)
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

/// Check if file path is valid JSON file
#[tauri::command]
pub fn is_json_file(path: String) -> bool {
    let path = PathBuf::from(path);
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
}

/// Get file name from path
#[tauri::command]
pub fn get_file_name(path: String) -> Option<String> {
    PathBuf::from(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|s| s.to_string())
}

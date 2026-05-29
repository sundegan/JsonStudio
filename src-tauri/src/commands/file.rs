// File operation commands
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

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
pub async fn save_file_dialog(
    app: AppHandle,
    content: String,
    default_file_name: String,
) -> Result<Option<String>, String> {
    let file_path = app.dialog()
        .file()
        .add_filter("JSON Files", &["json"])
        .add_filter("All Files", &["*"])
        .set_file_name(&default_file_name)
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

#[tauri::command]
pub async fn save_binary_file_dialog(
    app: AppHandle,
    bytes: Vec<u8>,
    default_file_name: String,
    extension: String,
) -> Result<Option<String>, String> {
    let file_path = app.dialog()
        .file()
        .add_filter("Export Files", &[extension.as_str()])
        .add_filter("All Files", &["*"])
        .set_file_name(&default_file_name)
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            let path_buf = PathBuf::from(&path_str);
            tokio::fs::write(&path_buf, bytes)
                .await
                .map_err(|e| format!("Failed to save file: {}", e))?;
            Ok(Some(path_str))
        }
        None => Ok(None),
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

/// Open a folder using directory picker dialog
#[tauri::command]
pub async fn open_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let folder_path = app.dialog()
        .file()
        .blocking_pick_folder();

    match folder_path {
        Some(path) => {
            // Use path.to_string() which is generally safe in Tauri v2 for PathBuf conversion
            let p = PathBuf::from(path.to_string());
            let canonical = p.canonicalize().unwrap_or(p);
            Ok(Some(canonical.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

/// Read directory (shallow), filtering for .json and .json5, ignoring subdirectories.
#[tauri::command]
pub async fn read_json_dir(path: String) -> Result<Vec<FileNode>, String> {
    tokio::task::spawn_blocking(move || {
        let root_path = Path::new(&path).canonicalize().unwrap_or_else(|_| PathBuf::from(&path));
        let mut files = Vec::new();

        if let Ok(entries) = std::fs::read_dir(&root_path) {
            for entry in entries.flatten() {
                let file_type = entry.file_type().map_err(|e| e.to_string())?;
                if file_type.is_file() {
                    let path_buf = entry.path();
                    if let Some(ext) = path_buf.extension().and_then(|s| s.to_str()) {
                        if ext.eq_ignore_ascii_case("json") || ext.eq_ignore_ascii_case("json5") {
                            files.push(FileNode {
                                name: entry.file_name().to_string_lossy().into_owned(),
                                path: path_buf.to_string_lossy().into_owned(),
                                is_dir: false,
                                children: None,
                            });
                        }
                    }
                }
            }
        }

        // Sort files alphabetically
        files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(files)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// Create an untitled JSON file inside the specified directory.
/// Automatically increments index if file already exists (e.g. untitled_1.json, untitled_2.json).
/// Writes a default empty object to prevent JSON parsing issues.
/// Returns the absolute path of the created file.
#[tauri::command]
pub async fn create_untitled_json(dir_path: String) -> Result<String, String> {
    let base_path = PathBuf::from(&dir_path);
    if !base_path.exists() || !base_path.is_dir() {
        return Err("Directory does not exist".to_string());
    }

    let mut index = 0;
    let mut file_path = base_path.join("untitled.json");

    while file_path.exists() {
        index += 1;
        file_path = base_path.join(format!("untitled_{}.json", index));
    }

    // Default valid JSON content
    let default_content = "{\n  \n}";
    tokio::fs::write(&file_path, default_content)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    Ok(file_path.to_string_lossy().into_owned())
}

/// Reveal file in system file explorer (select the file)
#[tauri::command]
pub fn show_in_folder(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("Failed to reveal in folder: {}", e))
}

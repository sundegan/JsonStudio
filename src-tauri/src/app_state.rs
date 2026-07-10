use crate::commands::file::JSON_FILE_EXTENSIONS;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

static PENDING_FILES: Mutex<Vec<String>> = Mutex::new(Vec::new());
static FRONTEND_READY: Mutex<bool> = Mutex::new(false);

#[tauri::command]
pub fn get_pending_files() -> Vec<String> {
    *FRONTEND_READY.lock().unwrap() = true;
    PENDING_FILES.lock().unwrap().drain(..).collect()
}

pub fn collect_json_file_args(args: &[String], cwd: &str) -> Vec<String> {
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

pub fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn queue_or_emit_open_files(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    focus_main_window(app);

    if *FRONTEND_READY.lock().unwrap() {
        let _ = app.emit("open-file", paths);
    } else {
        PENDING_FILES.lock().unwrap().extend(paths);
    }
}

#[cfg(test)]
mod tests {
    use super::collect_json_file_args;
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
    fn collects_supported_json_file_args_only() {
        let dir = test_dir();
        let json = dir.join("data.JSON5");
        let text = dir.join("notes.txt");
        fs::write(&json, "{}").unwrap();
        fs::write(&text, "text").unwrap();

        assert_eq!(
            collect_json_file_args(
                &[
                    "JsonStudio".into(),
                    "--flag".into(),
                    json.to_string_lossy().into_owned(),
                    text.to_string_lossy().into_owned()
                ],
                dir.to_str().unwrap(),
            ),
            vec![json.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn resolves_relative_json_args_against_launch_cwd() {
        let dir = test_dir();
        let json = dir.join("data.json");
        fs::write(&json, "{}").unwrap();

        assert_eq!(
            collect_json_file_args(&["data.json".into()], dir.to_str().unwrap()),
            vec![json.to_string_lossy().into_owned()]
        );
    }
}

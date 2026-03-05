// File watcher commands
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct FileWatcherState {
    watchers: Arc<Mutex<HashMap<String, notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>>,
}

impl FileWatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Start watching a file for changes
#[tauri::command]
pub async fn watch_file(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, FileWatcherState>,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    
    // Check if already watching
    {
        let watchers = state.watchers.lock().unwrap();
        if watchers.contains_key(&path) {
            return Ok(());
        }
    }
    
    let app_clone = app.clone();
    let path_clone = path.clone();
    
    // Create debounced watcher
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            match result {
                Ok(events) => {
                    for event in events {
                        // Only emit for modify events
                        if matches!(event.kind, DebouncedEventKind::Any) {
                            let _ = app_clone.emit("file-changed", path_clone.clone());
                        }
                    }
                }
                Err(e) => {
                    eprintln!("File watcher error: {:?}", e);
                }
            }
        },
    ).map_err(|e| format!("Failed to create watcher: {}", e))?;
    
    // Watch the file
    debouncer
        .watcher()
        .watch(&path_buf, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {}", e))?;
    
    // Store the watcher
    let mut watchers = state.watchers.lock().unwrap();
    watchers.insert(path.clone(), debouncer);
    
    Ok(())
}

/// Stop watching a file
#[tauri::command]
pub async fn unwatch_file(
    path: String,
    state: tauri::State<'_, FileWatcherState>,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().unwrap();
    watchers.remove(&path);
    Ok(())
}

/// Stop watching all files
#[tauri::command]
pub async fn unwatch_all_files(
    state: tauri::State<'_, FileWatcherState>,
) -> Result<(), String> {
    let mut watchers = state.watchers.lock().unwrap();
    watchers.clear();
    Ok(())
}

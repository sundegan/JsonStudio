// JSON processing commands
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Validation result
#[derive(Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,           // Whether JSON is valid
    pub error_message: Option<String>,  // Error message
    pub error_line: Option<usize>,      // Error line number (1-based)
    pub error_column: Option<usize>,    // Error column number (1-based)
}

/// JSON statistics
#[derive(Serialize, Deserialize)]
pub struct JsonStats {
    pub valid: bool,           // Whether JSON is valid
    pub key_count: usize,      // Number of keys
    pub depth: usize,          // Maximum nesting depth
    pub byte_size: usize,      // Byte size
    pub error_info: Option<ValidationResult>,  // Error info (if invalid)
}

/// Format JSON string
#[tauri::command]
pub fn json_format(content: &str, indent: Option<usize>) -> Result<String, String> {
    let indent_size = indent.unwrap_or(2);

    // Parse JSON
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format_error_message(&e))?;

    // Format output
    let formatted = if indent_size == 0 {
        serde_json::to_string(&value)
    } else {
        serde_json::to_string_pretty(&value)
    };

    formatted.map_err(|e| format!("JSON formatting error: {}", e))
}

/// Minify JSON string
#[tauri::command]
pub fn json_minify(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format_error_message(&e))?;

    serde_json::to_string(&value)
        .map_err(|e| format!("JSON minification error: {}", e))
}

/// Validate JSON and return detailed error location
#[tauri::command]
pub fn json_validate(content: &str) -> ValidationResult {
    match serde_json::from_str::<Value>(content) {
        Ok(_) => ValidationResult {
            valid: true,
            error_message: None,
            error_line: None,
            error_column: None,
        },
        Err(e) => ValidationResult {
            valid: false,
            error_message: Some(format_error_description(&e)),
            error_line: Some(e.line()),
            error_column: Some(e.column()),
        },
    }
}

/// Get JSON statistics
#[tauri::command]
pub fn json_stats(content: &str) -> JsonStats {
    let byte_size = content.len();

    match serde_json::from_str::<Value>(content) {
        Ok(value) => {
            let key_count = count_keys(&value);
            let depth = calculate_depth(&value);
            JsonStats {
                valid: true,
                key_count,
                depth,
                byte_size,
                error_info: None,
            }
        }
        Err(e) => JsonStats {
            valid: false,
            key_count: 0,
            depth: 0,
            byte_size,
            error_info: Some(ValidationResult {
                valid: false,
                error_message: Some(format_error_description(&e)),
                error_line: Some(e.line()),
                error_column: Some(e.column()),
            }),
        },
    }
}

/// Escape string (convert string to JSON string format)
#[tauri::command]
pub fn json_escape(content: &str) -> String {
    // Use serde_json to serialize string as JSON string
    // This automatically handles all escape characters (quotes, newlines, backslashes, etc.)
    serde_json::to_string(content).unwrap_or_else(|_| String::from("\"\""))
}

/// Unescape string (convert JSON string format to plain string)
#[tauri::command]
pub fn json_unescape(content: &str) -> Result<String, String> {
    // Try to parse content as string
    match serde_json::from_str::<String>(content) {
        Ok(unescaped) => Ok(unescaped),
        Err(e) => Err(format!("Unescape failed: {}", format_error_description(&e))),
    }
}

/// Format error message (for frontend)
fn format_error_message(e: &serde_json::Error) -> String {
    format!("Line {}, Column {}: {}", e.line(), e.column(), format_error_description(e))
}

/// Format error description
fn format_error_description(e: &serde_json::Error) -> String {
    let msg = e.to_string();
    // Remove line/column info, keep only error description
    if let Some(pos) = msg.find(" at line ") {
        msg[..pos].to_string()
    } else {
        msg
    }
}

/// Recursively count JSON keys
fn count_keys(value: &Value) -> usize {
    match value {
        Value::Object(map) => {
            let mut count = map.len();
            for v in map.values() {
                count += count_keys(v);
            }
            count
        }
        Value::Array(arr) => arr.iter().map(count_keys).sum(),
        _ => 0,
    }
}

/// Recursively calculate maximum nesting depth of JSON
fn calculate_depth(value: &Value) -> usize {
    match value {
        Value::Object(map) => {
            1 + map.values().map(calculate_depth).max().unwrap_or(0)
        }
        Value::Array(arr) => {
            1 + arr.iter().map(calculate_depth).max().unwrap_or(0)
        }
        _ => 0,
    }
}

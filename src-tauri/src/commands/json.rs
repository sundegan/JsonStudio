// JSON processing commands
//
// All parsing functions follow a three-level fallback chain:
//   1. serde_json  – standard JSON (fastest)
//   2. json5 crate – JSON5 features like comments, trailing commas, unquoted keys, etc.
//   3. json5 crate with sanitized input – handles Infinity / NaN which cannot be
//      represented in serde_json::Value (they are replaced with null before parsing)
//
// This chain is used consistently across format, minify, validate, and stats.

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
    pub format_type: String,   // Format type: "JSON" or "JSON5"
    pub error_info: Option<ValidationResult>,  // Error info (if invalid)
}

/// Format JSON string (supports JSON5)
#[tauri::command]
pub fn json_format(content: &str, indent: Option<usize>) -> Result<String, String> {
    let indent_size = indent.unwrap_or(2);
    let value: Value = parse_to_value(content)?;

    let formatted = if indent_size == 0 {
        serde_json::to_string(&value)
    } else {
        serde_json::to_string_pretty(&value)
    };

    formatted.map_err(|e| format!("JSON formatting error: {}", e))
}

/// Minify JSON string (supports JSON5)
#[tauri::command]
pub fn json_minify(content: &str) -> Result<String, String> {
    let value: Value = parse_to_value(content)?;
    serde_json::to_string(&value)
        .map_err(|e| format!("JSON minification error: {}", e))
}

/// Validate JSON and return detailed error location (supports JSON5)
#[tauri::command]
pub fn json_validate(content: &str) -> ValidationResult {
    let ok_result = ValidationResult {
        valid: true,
        error_message: None,
        error_line: None,
        error_column: None,
    };

    match serde_json::from_str::<Value>(content) {
        Ok(_) => ok_result,
        Err(json_err) => {
            if json5::from_str::<Value>(content).is_ok() {
                return ok_result;
            }
            // Sanitize special values (Infinity → null) and retry
            let sanitized = sanitize_json5_special_values(content);
            if json5::from_str::<Value>(&sanitized).is_ok() {
                return ok_result;
            }
            ValidationResult {
                valid: false,
                error_message: Some(format_error_description(&json_err)),
                error_line: Some(json_err.line()),
                error_column: Some(json_err.column()),
            }
        }
    }
}

/// Get JSON statistics (supports JSON5)
#[tauri::command]
pub fn json_stats(content: &str) -> JsonStats {
    let byte_size = content.len();

    // 1. Try standard JSON
    if let Ok(value) = serde_json::from_str::<Value>(content) {
        let key_count = count_keys(&value);
        let depth = calculate_depth(&value);
        return JsonStats {
            valid: true,
            key_count,
            depth,
            byte_size,
            format_type: "JSON".to_string(),
            error_info: None,
        };
    }

    // 2. Try JSON5 directly
    if let Ok(value) = json5::from_str::<Value>(content) {
        let key_count = count_keys(&value);
        let depth = calculate_depth(&value);
        return JsonStats {
            valid: true,
            key_count,
            depth,
            byte_size,
            format_type: "JSON5".to_string(),
            error_info: None,
        };
    }

    // 3. Sanitize special values (Infinity → null) and retry as JSON5
    let sanitized = sanitize_json5_special_values(content);
    if let Ok(value) = json5::from_str::<Value>(&sanitized) {
        let key_count = count_keys(&value);
        let depth = calculate_depth(&value);
        return JsonStats {
            valid: true,
            key_count,
            depth,
            byte_size,
            format_type: "JSON5".to_string(),
            error_info: None,
        };
    }

    // 4. All failed — use the original JSON error for diagnostics
    let json_err = serde_json::from_str::<Value>(content).unwrap_err();
    JsonStats {
        valid: false,
        key_count: 0,
        depth: 0,
        byte_size,
        format_type: "".to_string(),
        error_info: Some(ValidationResult {
            valid: false,
            error_message: Some(format_error_description(&json_err)),
            error_line: Some(json_err.line()),
            error_column: Some(json_err.column()),
        }),
    }
}

/// Escape string (convert string to JSON string format)
#[tauri::command]
pub fn json_escape(content: &str) -> String {
    serde_json::to_string(content).unwrap_or_else(|_| String::from("\"\""))
}

/// Unescape string (convert JSON string format to plain string)
#[tauri::command]
pub fn json_unescape(content: &str) -> Result<String, String> {
    match serde_json::from_str::<String>(content) {
        Ok(unescaped) => Ok(unescaped),
        Err(e) => Err(format!("Unescape failed: {}", format_error_description(&e))),
    }
}

// ── Internal helpers ──────────────────────────────────────────────────

/// Three-level fallback parsing chain: JSON → JSON5 → JSON5 (sanitized).
///
/// Level 3 is needed because serde_json::Value cannot represent Infinity or NaN.
/// We sanitize those tokens to null so the rest of the structure can still be parsed.
fn parse_to_value(content: &str) -> Result<Value, String> {
    if let Ok(v) = serde_json::from_str::<Value>(content) {
        return Ok(v);
    }
    if let Ok(v) = json5::from_str::<Value>(content) {
        return Ok(v);
    }
    let sanitized = sanitize_json5_special_values(content);
    json5::from_str::<Value>(&sanitized)
        .map_err(|e| format!("JSON/JSON5 parsing error: {}", e))
}

/// Replace JSON5 special numeric literals (Infinity, -Infinity, +Infinity, NaN)
/// with `null` so the content can be deserialized into `serde_json::Value`.
///
/// Why: `serde_json::Number` only supports finite numbers. JSON5 allows Infinity
/// and NaN as valid numeric values, but they have no representation in standard JSON.
///
/// Safety: the function walks the input character-by-character, skipping over
/// quoted strings (both `"…"` and `'…'` with backslash escapes) to avoid
/// accidentally replacing these tokens inside string values.
fn sanitize_json5_special_values(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let chars: Vec<char> = content.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '"' {
            i = skip_string(&chars, i, '"', &mut result);
            continue;
        }
        if chars[i] == '\'' {
            i = skip_string(&chars, i, '\'', &mut result);
            continue;
        }

        // +Infinity / -Infinity
        if (chars[i] == '+' || chars[i] == '-') && matches_word(&chars, i + 1, "Infinity") {
            result.push_str("null");
            i += 1 + 8; // skip sign char + "Infinity" (8 chars)
            continue;
        }
        // Infinity (no sign)
        if matches_word(&chars, i, "Infinity") {
            result.push_str("null");
            i += 8;
            continue;
        }
        // +NaN / -NaN
        if (chars[i] == '+' || chars[i] == '-') && matches_word(&chars, i + 1, "NaN") {
            result.push_str("null");
            i += 1 + 3; // skip sign char + "NaN" (3 chars)
            continue;
        }
        // NaN (no sign)
        if matches_word(&chars, i, "NaN") {
            result.push_str("null");
            i += 3;
            continue;
        }

        result.push(chars[i]);
        i += 1;
    }

    result
}

/// Advance past a quoted string (including escape sequences), appending to `result`.
/// Returns the index right after the closing quote.
fn skip_string(chars: &[char], start: usize, quote: char, result: &mut String) -> usize {
    result.push(quote);
    let mut i = start + 1;
    let len = chars.len();
    while i < len && chars[i] != quote {
        if chars[i] == '\\' && i + 1 < len {
            result.push(chars[i]);
            result.push(chars[i + 1]);
            i += 2;
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    if i < len {
        result.push(quote);
        i += 1;
    }
    i
}

/// Check whether `word` appears at `pos` as a standalone token (not part of a longer identifier).
/// e.g. "Infinity" matches in "Infinity," but not in "InfinityStone" or "myInfinity".
fn matches_word(chars: &[char], pos: usize, word: &str) -> bool {
    let wchars: Vec<char> = word.chars().collect();
    if pos + wchars.len() > chars.len() {
        return false;
    }
    // Leading boundary: must not be preceded by an alphanumeric or '_'
    if pos > 0 && (chars[pos - 1].is_alphanumeric() || chars[pos - 1] == '_') {
        return false;
    }
    for (j, wc) in wchars.iter().enumerate() {
        if chars[pos + j] != *wc {
            return false;
        }
    }
    // Trailing boundary: must not be followed by an alphanumeric or '_'
    let after = pos + wchars.len();
    if after < chars.len() && (chars[after].is_alphanumeric() || chars[after] == '_') {
        return false;
    }
    true
}

fn format_error_description(e: &serde_json::Error) -> String {
    let msg = e.to_string();
    if let Some(pos) = msg.find(" at line ") {
        msg[..pos].to_string()
    } else {
        msg
    }
}

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

#[cfg(test)]
mod tests {
    use super::json_format;

    #[test]
    fn json_format_preserves_object_key_order() {
        let input = r#"{"z":1,"a":2,"m":{"y":3,"b":4}}"#;

        let formatted = json_format(input, Some(2)).unwrap();

        assert!(formatted.find(r#""z""#).unwrap() < formatted.find(r#""a""#).unwrap());
        assert!(formatted.find(r#""y""#).unwrap() < formatted.find(r#""b""#).unwrap());
    }

    #[test]
    fn json5_format_preserves_object_key_order() {
        let input = "{z:1,a:2,m:{y:3,b:4}}";

        let formatted = json_format(input, Some(2)).unwrap();

        assert!(formatted.find(r#""z""#).unwrap() < formatted.find(r#""a""#).unwrap());
        assert!(formatted.find(r#""y""#).unwrap() < formatted.find(r#""b""#).unwrap());
    }
}

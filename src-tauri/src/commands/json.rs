// JSON 处理相关命令
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 校验结果
#[derive(Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,           // 是否有效
    pub error_message: Option<String>,  // 错误信息
    pub error_line: Option<usize>,      // 错误行号（从1开始）
    pub error_column: Option<usize>,    // 错误列号（从1开始）
}

/// JSON 统计信息
#[derive(Serialize, Deserialize)]
pub struct JsonStats {
    pub valid: bool,           // 是否有效
    pub key_count: usize,      // 键的数量
    pub depth: usize,          // 最大嵌套深度
    pub byte_size: usize,      // 字节大小
    pub error_info: Option<ValidationResult>,  // 错误信息（如果无效）
}

/// 格式化 JSON 字符串
#[tauri::command]
pub fn json_format(content: &str, indent: Option<usize>) -> Result<String, String> {
    let indent_size = indent.unwrap_or(2);

    // 解析 JSON
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format_error_message(&e))?;

    // 格式化输出
    let formatted = if indent_size == 0 {
        serde_json::to_string(&value)
    } else {
        serde_json::to_string_pretty(&value)
    };

    formatted.map_err(|e| format!("JSON 格式化错误: {}", e))
}

/// 压缩 JSON 字符串
#[tauri::command]
pub fn json_minify(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format_error_message(&e))?;

    serde_json::to_string(&value)
        .map_err(|e| format!("JSON 压缩错误: {}", e))
}

/// 校验 JSON 并返回详细错误位置
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

/// 获取 JSON 统计信息
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

/// 转义字符串（将字符串转换为 JSON 字符串格式）
#[tauri::command]
pub fn json_escape(content: &str) -> String {
    // 使用 serde_json 将字符串序列化为 JSON 字符串
    // 这会自动处理所有需要转义的字符（引号、换行符、反斜杠等）
    serde_json::to_string(content).unwrap_or_else(|_| String::from("\"\""))
}

/// 反转义字符串（将 JSON 字符串格式转换为普通字符串）
#[tauri::command]
pub fn json_unescape(content: &str) -> Result<String, String> {
    // 尝试将内容解析为字符串
    match serde_json::from_str::<String>(content) {
        Ok(unescaped) => Ok(unescaped),
        Err(e) => Err(format!("反转义失败: {}", format_error_description(&e))),
    }
}

/// 格式化错误信息（用于返回给前端）
fn format_error_message(e: &serde_json::Error) -> String {
    format!("第 {} 行，第 {} 列：{}", e.line(), e.column(), format_error_description(e))
}

/// 格式化错误描述
fn format_error_description(e: &serde_json::Error) -> String {
    let msg = e.to_string();
    // 移除行列信息，只保留错误描述
    if let Some(pos) = msg.find(" at line ") {
        msg[..pos].to_string()
    } else {
        msg
    }
}

/// 递归计算 JSON 键的数量
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

/// 递归计算 JSON 最大嵌套深度
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

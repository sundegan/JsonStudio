use serde_json::Value;

#[tauri::command]
pub fn json_to_yaml(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;
    serde_yaml::to_string(&value)
        .map_err(|e| format!("YAML conversion failed: {}", e))
}

#[tauri::command]
pub fn json_to_toml(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    // TOML requires a top-level table; wrap arrays automatically
    let table_value = match &value {
        Value::Array(_) => {
            let mut map = serde_json::Map::new();
            map.insert("items".to_string(), value);
            Value::Object(map)
        }
        Value::Object(_) => value,
        _ => {
            return Err("TOML requires a JSON object or array at the top level".to_string());
        }
    };

    toml::to_string_pretty(&table_value)
        .map_err(|e| format!("TOML conversion failed: {}", e))
}

#[tauri::command]
pub fn json_to_xml(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut xml = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    value_to_xml(&value, "root", &mut xml, 0);
    Ok(xml)
}

fn value_to_xml(value: &Value, tag: &str, xml: &mut String, depth: usize) {
    let indent = "  ".repeat(depth);
    match value {
        Value::Object(map) => {
            xml.push_str(&format!("{}<{}>\n", indent, tag));
            for (key, val) in map {
                let safe_key = sanitize_xml_tag(key);
                value_to_xml(val, &safe_key, xml, depth + 1);
            }
            xml.push_str(&format!("{}</{}>\n", indent, tag));
        }
        Value::Array(arr) => {
            for item in arr {
                value_to_xml(item, tag, xml, depth);
            }
        }
        Value::String(s) => {
            xml.push_str(&format!("{}<{}>{}</{}>\n", indent, tag, escape_xml(s), tag));
        }
        Value::Number(n) => {
            xml.push_str(&format!("{}<{}>{}</{}>\n", indent, tag, n, tag));
        }
        Value::Bool(b) => {
            xml.push_str(&format!("{}<{}>{}</{}>\n", indent, tag, b, tag));
        }
        Value::Null => {
            xml.push_str(&format!("{}<{}/>\n", indent, tag));
        }
    }
}

fn sanitize_xml_tag(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    for (i, ch) in name.chars().enumerate() {
        if i == 0 && !ch.is_ascii_alphabetic() && ch != '_' {
            result.push('_');
        }
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
            result.push(ch);
        } else {
            result.push('_');
        }
    }
    if result.is_empty() {
        return "item".to_string();
    }
    result
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[tauri::command]
pub fn json_to_csv(content: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let arr = match &value {
        Value::Array(arr) => arr.clone(),
        Value::Object(_) => vec![value],
        _ => return Err("CSV requires JSON array or object".to_string()),
    };

    if arr.is_empty() {
        return Ok(String::new());
    }

    // Collect all unique keys as headers
    let mut headers: Vec<String> = Vec::new();
    let mut header_set = std::collections::HashSet::new();
    for item in &arr {
        if let Value::Object(map) = item {
            for key in map.keys() {
                if header_set.insert(key.clone()) {
                    headers.push(key.clone());
                }
            }
        }
    }

    if headers.is_empty() {
        return Err("CSV requires objects with keys".to_string());
    }

    let mut wtr = csv::Writer::from_writer(Vec::new());
    wtr.write_record(&headers).map_err(|e| format!("CSV error: {}", e))?;

    for item in &arr {
        if let Value::Object(map) = item {
            let row: Vec<String> = headers.iter().map(|h| {
                match map.get(h) {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Null) | None => String::new(),
                    Some(v) => v.to_string(),
                }
            }).collect();
            wtr.write_record(&row).map_err(|e| format!("CSV error: {}", e))?;
        }
    }

    let bytes = wtr.into_inner().map_err(|e| format!("CSV error: {}", e))?;
    String::from_utf8(bytes).map_err(|e| format!("CSV encoding error: {}", e))
}

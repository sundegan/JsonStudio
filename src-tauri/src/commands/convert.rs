use serde_json::Value;
use std::collections::HashSet;

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

// ============================================================
// Reverse conversions: YAML/TOML/XML/CSV → JSON
// ============================================================

#[tauri::command]
pub fn yaml_to_json(content: &str) -> Result<String, String> {
    let value: Value = serde_yaml::from_str(content)
        .map_err(|e| format!("Invalid YAML: {}", e))?;
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("JSON conversion failed: {}", e))
}

#[tauri::command]
pub fn toml_to_json(content: &str) -> Result<String, String> {
    let value: Value = toml::from_str(content)
        .map_err(|e| format!("Invalid TOML: {}", e))?;
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("JSON conversion failed: {}", e))
}

#[tauri::command]
pub fn xml_to_json(content: &str) -> Result<String, String> {
    let value = parse_xml_to_value(content)?;
    serde_json::to_string_pretty(&value)
        .map_err(|e| format!("JSON conversion failed: {}", e))
}

fn parse_xml_to_value(xml_str: &str) -> Result<Value, String> {
    use quick_xml::events::Event;
    use quick_xml::reader::Reader;

    let mut reader = Reader::from_str(xml_str);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<(String, Vec<(String, Value)>)> = Vec::new();
    let mut root_value: Option<Value> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                stack.push((tag, Vec::new()));
            }
            Ok(Event::End(_)) => {
                if let Some((tag, children)) = stack.pop() {
                    let value = children_to_value(children);
                    if let Some(parent) = stack.last_mut() {
                        parent.1.push((tag, value));
                    } else {
                        root_value = Some(value);
                    }
                }
            }
            Ok(Event::Empty(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if let Some(parent) = stack.last_mut() {
                    parent.1.push((tag, Value::Null));
                }
            }
            Ok(Event::Text(e)) => {
                let raw = std::str::from_utf8(e.as_ref())
                    .map_err(|err| format!("XML text decode error: {}", err))?;
                let text = quick_xml::escape::unescape(raw)
                    .map_err(|err| format!("XML unescape error: {}", err))?
                    .to_string();
                if !text.is_empty() {
                    if let Some(parent) = stack.last_mut() {
                        parent.1.push(("__text__".to_string(), text_to_typed_value(&text)));
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(Event::Decl(_)) | Ok(Event::Comment(_)) | Ok(Event::PI(_))
            | Ok(Event::CData(_)) | Ok(Event::DocType(_)) | Ok(Event::GeneralRef(_)) => {}
            Err(e) => return Err(format!("Invalid XML: {}", e)),
        }
    }

    // Unwrap the root element to return its content directly
    match root_value {
        Some(Value::Object(map)) if map.len() == 1 => {
            Ok(map.into_iter().next().unwrap().1)
        }
        Some(v) => Ok(v),
        None => Err("Empty XML document".into()),
    }
}

fn text_to_typed_value(text: &str) -> Value {
    if text == "true" {
        return Value::Bool(true);
    }
    if text == "false" {
        return Value::Bool(false);
    }
    if let Ok(n) = text.parse::<i64>() {
        return Value::Number(serde_json::Number::from(n));
    }
    if let Ok(n) = text.parse::<f64>() {
        if let Some(num) = serde_json::Number::from_f64(n) {
            return Value::Number(num);
        }
    }
    Value::String(text.to_string())
}

fn children_to_value(children: Vec<(String, Value)>) -> Value {
    if children.is_empty() {
        return Value::Null;
    }
    // Text-only element
    if children.len() == 1 && children[0].0 == "__text__" {
        return children[0].1.clone();
    }
    // Filter out text nodes when mixed with elements
    let element_children: Vec<&(String, Value)> = children.iter()
        .filter(|(k, _)| k != "__text__")
        .collect();
    if element_children.is_empty() {
        if let Some((_, v)) = children.first() {
            return v.clone();
        }
        return Value::Null;
    }

    // Check for repeated tags → array
    let mut tag_counts = std::collections::HashMap::new();
    for (tag, _) in &element_children {
        *tag_counts.entry(tag.as_str()).or_insert(0usize) += 1;
    }

    let mut map = serde_json::Map::new();
    let mut array_tags: HashSet<String> = HashSet::new();

    for (tag, count) in &tag_counts {
        if *count > 1 {
            array_tags.insert(tag.to_string());
        }
    }

    for (tag, value) in element_children {
        if array_tags.contains(tag.as_str()) {
            let entry = map.entry(tag.clone()).or_insert_with(|| Value::Array(vec![]));
            if let Value::Array(arr) = entry {
                arr.push(value.clone());
            }
        } else {
            map.insert(tag.clone(), value.clone());
        }
    }

    Value::Object(map)
}

#[tauri::command]
pub fn csv_to_json(content: &str) -> Result<String, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(content.as_bytes());

    let headers: Vec<String> = rdr.headers()
        .map_err(|e| format!("CSV header error: {}", e))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    if headers.is_empty() {
        return Err("CSV has no headers".into());
    }

    let mut rows: Vec<Value> = Vec::new();
    for result in rdr.records() {
        let record = result.map_err(|e| format!("CSV row error: {}", e))?;
        let mut obj = serde_json::Map::new();
        for (i, field) in record.iter().enumerate() {
            if let Some(header) = headers.get(i) {
                obj.insert(header.clone(), text_to_typed_value(field));
            }
        }
        rows.push(Value::Object(obj));
    }

    serde_json::to_string_pretty(&Value::Array(rows))
        .map_err(|e| format!("JSON conversion failed: {}", e))
}

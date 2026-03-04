use heck::{ToLowerCamelCase, ToSnakeCase, ToUpperCamelCase};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[tauri::command]
pub fn json_to_code(content: &str, language: &str, class_name: &str) -> Result<String, String> {
    let value: Value =
        serde_json::from_str(content).map_err(|e| format!("Invalid JSON: {}", e))?;

    // Reject non-structural JSON values
    match &value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            return Err("JSON must be an object or array to generate code structures".into());
        }
        Value::Array(arr) if arr.is_empty() => {
            return Err("Empty JSON array: cannot infer element types".into());
        }
        Value::Array(arr) if arr.iter().all(|v| !v.is_object()) => {
            return Err("JSON array of primitive values: no structure to generate".into());
        }
        _ => {}
    }

    let name = if class_name.trim().is_empty() {
        "Root"
    } else {
        class_name.trim()
    };

    match language {
        "protobuf" => Ok(gen_protobuf(&value, name)),
        "thrift" => Ok(gen_thrift(&value, name)),
        _ => Err(format!("Unsupported language: {}", language)),
    }
}

#[tauri::command]
pub fn code_to_json(content: &str, language: &str, class_name: &str) -> Result<String, String> {
    let name = if class_name.trim().is_empty() {
        "MyModel"
    } else {
        class_name.trim()
    };

    let value = parse_code_to_json(content, language, name)?;
    serde_json::to_string_pretty(&value).map_err(|e| format!("JSON serialization failed: {}", e))
}

// --- Type inference ---

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum JsonType {
    String,
    Number,
    Integer,
    Boolean,
    Null,
    Array(Box<JsonType>),
    Object(String),
    Any,
    Optional(Box<JsonType>),
}

fn infer_type(value: &Value, name: &str, structs: &mut BTreeMap<String, BTreeMap<String, JsonType>>) -> JsonType {
    match value {
        Value::Null => JsonType::Null,
        Value::Bool(_) => JsonType::Boolean,
        Value::Number(n) => {
            if n.is_f64() && n.as_i64().is_none() && n.as_u64().is_none() {
                JsonType::Number
            } else {
                JsonType::Integer
            }
        }
        Value::String(_) => JsonType::String,
        Value::Array(arr) => {
            if arr.is_empty() {
                JsonType::Array(Box::new(JsonType::Any))
            } else {
                let item_name = singularize(name);
                let all_objects = arr.iter().all(|v| v.is_object());
                if all_objects && arr.len() > 1 {
                    let struct_name = merge_object_fields(structs, arr, &item_name);
                    JsonType::Array(Box::new(JsonType::Object(struct_name)))
                } else {
                    let elem_type = infer_type(&arr[0], &item_name, structs);
                    JsonType::Array(Box::new(elem_type))
                }
            }
        }
        Value::Object(map) => {
            let struct_name = to_pascal_case(name);
            let mut fields = BTreeMap::new();
            for (key, val) in map {
                let field_type = infer_type(val, key, structs);
                fields.insert(key.clone(), field_type);
            }
            structs.insert(struct_name.clone(), fields);
            JsonType::Object(struct_name)
        }
    }
}

fn merge_object_fields(
    structs: &mut BTreeMap<String, BTreeMap<String, JsonType>>,
    arr: &[Value],
    item_name: &str,
) -> String {
    let struct_name = to_pascal_case(item_name);
    let mut all_keys: BTreeSet<String> = BTreeSet::new();
    let mut key_types: BTreeMap<String, JsonType> = BTreeMap::new();
    let mut key_presence: BTreeMap<String, usize> = BTreeMap::new();
    let mut has_null: BTreeSet<String> = BTreeSet::new();

    for val in arr {
        if let Value::Object(map) = val {
            for (k, v) in map {
                all_keys.insert(k.clone());
                *key_presence.entry(k.clone()).or_insert(0) += 1;
                if v.is_null() {
                    has_null.insert(k.clone());
                } else {
                    let t = infer_type(v, k, structs);
                    // Prefer non-Null type over existing Null type
                    let existing = key_types.get(k);
                    if existing.is_none() || existing == Some(&JsonType::Null) {
                        key_types.insert(k.clone(), t);
                    }
                }
            }
        }
    }

    let total = arr.len();
    let mut fields = BTreeMap::new();
    for key in &all_keys {
        let base_type = key_types.get(key).cloned().unwrap_or(JsonType::Any);
        let count = key_presence.get(key).copied().unwrap_or(0);
        let is_optional = count < total || has_null.contains(key);
        if is_optional {
            // Avoid double-wrapping Optional
            match &base_type {
                JsonType::Null => fields.insert(key.clone(), JsonType::Optional(Box::new(JsonType::Any))),
                JsonType::Optional(_) => fields.insert(key.clone(), base_type),
                _ => fields.insert(key.clone(), JsonType::Optional(Box::new(base_type))),
            };
        } else {
            fields.insert(key.clone(), base_type);
        }
    }
    structs.insert(struct_name.clone(), fields);
    struct_name
}

struct CollectResult {
    structs: BTreeMap<String, BTreeMap<String, JsonType>>,
    top_level_type: JsonType,
}

fn collect_structs(value: &Value, name: &str) -> CollectResult {
    let mut structs = BTreeMap::new();

    if let Value::Array(arr) = value {
        let all_objects = arr.iter().all(|v| v.is_object());
        if all_objects && !arr.is_empty() {
            let item_name = format!("{}Item", name);
            let struct_name = merge_object_fields(&mut structs, arr, &item_name);
            return CollectResult {
                structs,
                top_level_type: JsonType::Array(Box::new(JsonType::Object(struct_name))),
            };
        }
    }

    let top_level_type = infer_type(value, name, &mut structs);
    CollectResult { structs, top_level_type }
}

// --- Helpers ---

fn to_pascal_case(s: &str) -> String {
    s.to_upper_camel_case()
}

fn to_camel_case(s: &str) -> String {
    s.to_lower_camel_case()
}

fn to_snake_case(s: &str) -> String {
    s.to_snake_case()
}

fn singularize(s: &str) -> String {
    let lower = s.to_lowercase();

    // Common words that end in 's' but are already singular
    const FALSE_PLURALS: &[&str] = &[
        "address", "status", "class", "bus", "process", "access",
        "success", "progress", "bonus", "campus", "canvas", "focus",
        "radius", "virus", "alias", "basis", "crisis", "diagnosis",
        "analysis", "thesis", "synopsis", "consensus", "corpus",
    ];
    if FALSE_PLURALS.iter().any(|w| lower == *w) {
        return format!("{}_item", s);
    }

    if lower.ends_with("ies") && lower.len() > 4 {
        format!("{}y", &s[..s.len() - 3])
    } else if lower.ends_with("ses") || lower.ends_with("xes") || lower.ends_with("zes")
        || lower.ends_with("ches") || lower.ends_with("shes")
    {
        s[..s.len() - 2].to_string()
    } else if lower.ends_with('s') && !lower.ends_with("ss") && !lower.ends_with("us") && !lower.ends_with("is") {
        s[..s.len() - 1].to_string()
    } else {
        format!("{}_item", s)
    }
}

// --- Protobuf ---

fn protobuf_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "string".into(),
        JsonType::Number => "double".into(),
        JsonType::Integer => "int64".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "google.protobuf.Any".into(),
        JsonType::Array(inner) => protobuf_type(inner),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "google.protobuf.Any".into(),
        JsonType::Optional(inner) => protobuf_type(inner),
    }
}

fn gen_protobuf(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::from("syntax = \"proto3\";\n\n");
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = protobuf_type(inner);
        let wrapper_name = to_pascal_case(name);
        let field_name = to_snake_case(&format!("{}s", name));
        out.push_str(&format!("message {} {{\n", wrapper_name));
        out.push_str(&format!("  repeated {} {} = 1;\n", item_type, field_name));
        out.push_str("}\n\n");
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("message {} {{\n", sname));
        for (idx, (key, ftype)) in fields.iter().enumerate() {
            let field_name = to_snake_case(key);
            let field_num = idx + 1;
            let is_repeated = matches!(ftype, JsonType::Array(_));
            let is_optional = matches!(ftype, JsonType::Optional(_) | JsonType::Null);
            let type_str = protobuf_type(ftype);

            if is_repeated {
                out.push_str(&format!(
                    "  repeated {} {} = {};\n",
                    type_str, field_name, field_num
                ));
            } else if is_optional {
                out.push_str(&format!(
                    "  optional {} {} = {};\n",
                    type_str, field_name, field_num
                ));
            } else {
                out.push_str(&format!(
                    "  {} {} = {};\n",
                    type_str, field_name, field_num
                ));
            }
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- Thrift ---

fn thrift_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "string".into(),
        JsonType::Number => "double".into(),
        JsonType::Integer => "i64".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "binary".into(),
        JsonType::Array(inner) => format!("list<{}>", thrift_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "binary".into(),
        JsonType::Optional(inner) => thrift_type(inner),
    }
}

fn gen_thrift(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::from("namespace * generated\n\n");
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = thrift_type(inner);
        let wrapper_name = to_pascal_case(name);
        let field_name = to_snake_case(&format!("{}s", name));
        out.push_str(&format!("struct {} {{\n", wrapper_name));
        out.push_str(&format!("  1: required list<{}> {};\n", item_type, field_name));
        out.push_str("}\n\n");
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("struct {} {{\n", sname));
        for (idx, (key, ftype)) in fields.iter().enumerate() {
            let field_name = to_snake_case(key);
            let field_num = idx + 1;
            let is_optional = matches!(ftype, JsonType::Optional(_) | JsonType::Null);
            let type_str = thrift_type(ftype);
            let req = if is_optional { "optional" } else { "required" };
            out.push_str(&format!(
                "  {}: {} {} {};\n",
                field_num, req, type_str, field_name
            ));
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// ============================================================
// Code-to-JSON: parse code structure definitions into JSON
// ============================================================

fn convert_keys_recursive(value: Value, converter: &dyn Fn(&str) -> String) -> Value {
    match value {
        Value::Object(map) => {
            let mut new_map = serde_json::Map::new();
            for (k, v) in map {
                let new_key = converter(&k);
                new_map.insert(new_key, convert_keys_recursive(v, converter));
            }
            Value::Object(new_map)
        }
        Value::Array(arr) => {
            Value::Array(arr.into_iter().map(|v| convert_keys_recursive(v, converter)).collect())
        }
        other => other,
    }
}

/// Convert field names inside each struct/message, but preserve top-level struct names.
/// When parsers return `{ "StructName": { fields... }, ... }`, we detect this pattern
/// (all top-level values are objects) and only convert the inner fields.
fn convert_fields_only(value: Value, converter: &dyn Fn(&str) -> String) -> Value {
    match &value {
        Value::Object(map) if is_multi_struct_result(map) => {
            let map = match value { Value::Object(m) => m, _ => unreachable!() };
            let mut new_map = serde_json::Map::new();
            for (struct_name, fields) in map {
                new_map.insert(struct_name, convert_keys_recursive(fields, converter));
            }
            Value::Object(new_map)
        }
        _ => convert_keys_recursive(value, converter),
    }
}

fn is_multi_struct_result(map: &serde_json::Map<String, Value>) -> bool {
    map.len() > 1 && map.values().all(|v| v.is_object())
        && map.keys().all(|k| k.chars().next().map_or(false, |c| c.is_uppercase()))
}

fn parse_code_to_json(content: &str, language: &str, _class_name: &str) -> Result<Value, String> {
    let result = match language {
        "typescript" => parse_typescript_to_json(content),
        "java" | "kotlin" | "dart" | "php" | "scala" => parse_typed_class_to_json(content, language),
        "swift" => parse_swift_to_json(content),
        "go" => parse_go_to_json(content),
        "csharp" => parse_typed_class_to_json(content, language),
        "rust" => parse_rust_to_json(content),
        "python" => parse_python_to_json(content),
        "ruby" => parse_ruby_to_json(content),
        "cpp" => parse_cpp_to_json(content),
        "protobuf" => parse_protobuf_to_json(content),
        "thrift" => parse_thrift_to_json(content),
        "javascript" => parse_javascript_to_json(content),
        "objectivec" => parse_objectivec_to_json(content),
        "elm" => parse_elm_to_json(content),
        "haskell" => parse_haskell_to_json(content),
        "crystal" => parse_crystal_to_json(content),
        "elixir" => parse_elixir_to_json(content),
        "pike" => parse_pike_to_json(content),
        _ => Err(format!("Unsupported language for reverse conversion: {}", language)),
    }?;

    let converted = match language {
        "rust" | "python" | "cpp" | "ruby" | "protobuf" | "thrift"
        | "crystal" | "elixir" | "pike" => {
            convert_fields_only(result, &to_camel_case)
        }
        "csharp" | "objectivec" => {
            convert_fields_only(result, &to_camel_case)
        }
        _ => result,
    };

    Ok(converted)
}

fn default_value_for_type(type_str: &str) -> Value {
    let t = type_str.trim();
    let lower = t.to_lowercase();

    // Optional / nullable wrappers
    if lower.starts_with("optional<") || lower.starts_with("option<") || lower.starts_with("option[")
        || t.ends_with('?') || lower.starts_with("std::optional<")
    {
        return Value::Null;
    }

    // Array / list types
    if lower.starts_with("vec<") || lower.starts_with("list<") || lower.starts_with("list[")
        || lower.starts_with("[]") || lower.starts_with("array<")
        || lower.starts_with("std::vector<")
        || (t.starts_with('[') && t.ends_with(']'))
    {
        return Value::Array(vec![]);
    }

    // Map types
    if lower.starts_with("map<") || lower.starts_with("dict<") || lower.starts_with("hashmap<")
        || lower.starts_with("btreemap<") || lower.starts_with("std::map<")
        || lower.starts_with("map[")
    {
        return Value::Object(serde_json::Map::new());
    }

    match lower.as_str() {
        "string" | "str" | "std::string" | "text" | "varchar" | "char" => {
            Value::String(String::new())
        }
        "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" | "u64"
        | "int" | "int8" | "int16" | "int32" | "int64"
        | "long" | "short" | "byte"
        | "int64_t" | "int32_t" | "bigint" | "integer" | "smallint" | "tinyint" => {
            Value::Number(serde_json::Number::from(0))
        }
        "f32" | "f64" | "float" | "double" | "float32" | "float64" | "real"
        | "number" | "decimal" | "numeric" => {
            Value::Number(serde_json::Number::from_f64(0.0).unwrap())
        }
        "bool" | "boolean" => Value::Bool(false),
        "any" | "object" | "dynamic" | "interface{}" | "mixed" | "json"
        | "serde_json::value" | "nlohmann::json" | "google.protobuf.any" => Value::Null,
        _ => {
            // Likely a nested struct reference
            Value::Object(serde_json::Map::new())
        }
    }
}

// --- TypeScript parser ---

fn parse_typescript_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("interface ") || trimmed.starts_with("type ") || trimmed.starts_with("export interface ") || trimmed.starts_with("export type ") {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = trimmed
                .replace("export ", "")
                .replace("interface ", "")
                .replace("type ", "")
                .split(|c: char| c == '{' || c == '=' || c.is_whitespace())
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));
            }
        } else if trimmed == "}" || trimmed == "};" {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            // Parse "key: type;" or "key?: type;"
            let clean = trimmed.trim_end_matches([';', ',']);
            if let Some(colon_pos) = clean.find(':') {
                let key = clean[..colon_pos].trim().trim_end_matches('?');
                let type_str = clean[colon_pos + 1..].trim();
                if !key.is_empty() && !key.starts_with("//") {
                    fields.insert(key.to_string(), default_value_for_type(type_str));
                }
            }
        }
    }
    if let Some((name, fields)) = current_fields {
        result.insert(name, Value::Object(fields));
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No interface or type definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

// --- Generic typed class parser (Java, Kotlin, C#, Dart, PHP, Scala) ---

fn parse_typed_class_to_json(content: &str, _language: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        // Detect class/data class/case class definitions
        let is_class_def = trimmed.contains("class ") || trimmed.contains("case class ");
        if is_class_def && (trimmed.contains('{') || trimmed.contains('(')) {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = extract_class_name(trimmed);
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));

                // For data class Foo(val x: Type, ...) or case class Foo(x: Type, ...)
                if let Some(paren_start) = trimmed.find('(') {
                    let paren_content = &trimmed[paren_start..];
                    let inner = paren_content
                        .trim_start_matches('(')
                        .trim_end_matches(')')
                        .trim_end_matches('{')
                        .trim();
                    for param in split_params(inner) {
                        if let Some((key, type_str)) = parse_param_field(&param) {
                            if let Some((_, ref mut fields)) = current_fields {
                                fields.insert(key, default_value_for_type(&type_str));
                            }
                        }
                    }
                }
            }
        } else if trimmed == "}" || trimmed == ");" || trimmed == ")" {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            // Try to parse field declarations like: private String name; / public int Age { get; set; } / val x: Type
            if let Some((key, type_str)) = parse_field_line(trimmed) {
                fields.insert(key, default_value_for_type(&type_str));
            }
        }
    }
    if let Some((name, fields)) = current_fields {
        result.insert(name, Value::Object(fields));
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No class definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

fn extract_class_name(line: &str) -> String {
    let cleaned = line
        .replace("public ", "")
        .replace("private ", "")
        .replace("internal ", "")
        .replace("open ", "")
        .replace("abstract ", "")
        .replace("sealed ", "")
        .replace("final ", "")
        .replace("export ", "")
        .replace("data ", "")
        .replace("case ", "");
    let after_class = if let Some(pos) = cleaned.find("class ") {
        &cleaned[pos + 6..]
    } else {
        return String::new();
    };
    after_class
        .split(|c: char| c == '{' || c == '(' || c == ':' || c == '<' || c.is_whitespace())
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

fn split_params(s: &str) -> Vec<String> {
    let mut params = Vec::new();
    let mut depth = 0;
    let mut current = String::new();
    for c in s.chars() {
        match c {
            '<' | '(' | '[' => { depth += 1; current.push(c); }
            '>' | ')' | ']' => { depth -= 1; current.push(c); }
            ',' if depth == 0 => {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() { params.push(trimmed); }
                current.clear();
            }
            _ => current.push(c),
        }
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() { params.push(trimmed); }
    params
}

fn parse_param_field(param: &str) -> Option<(String, String)> {
    let clean = param
        .replace("val ", "")
        .replace("var ", "")
        .replace("required ", "")
        .replace("this.", "");
    let clean = clean.trim();
    // "name: Type" pattern
    if let Some(colon) = clean.find(':') {
        let key = clean[..colon].trim().to_string();
        let type_str = clean[colon + 1..].trim().trim_end_matches(',').trim().to_string();
        if !key.is_empty() && !type_str.is_empty() {
            return Some((key, type_str));
        }
    }
    // "Type name" pattern
    let parts: Vec<&str> = clean.splitn(2, char::is_whitespace).collect();
    if parts.len() == 2 {
        let type_str = parts[0].trim().to_string();
        let name = parts[1].trim().trim_end_matches(',').to_string();
        if !name.is_empty() && !type_str.is_empty() {
            return Some((name, type_str));
        }
    }
    None
}

fn parse_field_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('#')
        || trimmed.starts_with("import ") || trimmed.starts_with("using ")
        || trimmed.starts_with("package ") || trimmed.starts_with("@")
        || trimmed.starts_with("public func") || trimmed.starts_with("private func")
        || trimmed.starts_with("func ") || trimmed.starts_with("def ")
        || trimmed.starts_with("get ") || trimmed.starts_with("set ")
    {
        return None;
    }
    // Skip getter/setter methods
    if trimmed.contains("()") || trimmed.contains("{ get") || trimmed.contains("{ return") {
        // But allow C# auto-properties: "public Type Name { get; set; }"
        if trimmed.contains("{ get; set; }") || trimmed.contains("{ get; }") {
            let clean = trimmed
                .replace("public ", "")
                .replace("private ", "")
                .replace("protected ", "");
            let clean = clean.trim();
            let parts: Vec<&str> = clean.splitn(2, char::is_whitespace).collect();
            if parts.len() >= 2 {
                let type_str = parts[0].to_string();
                let name = parts[1].split('{').next()?.trim().to_string();
                if !name.is_empty() {
                    return Some((name, type_str));
                }
            }
        }
        return None;
    }

    let clean = trimmed
        .replace("public ", "")
        .replace("private ", "")
        .replace("protected ", "")
        .replace("internal ", "")
        .replace("final ", "")
        .replace("readonly ", "")
        .replace("lateinit ", "")
        .replace("val ", "")
        .replace("var ", "")
        .replace("let ", "");
    let clean = clean.trim().trim_end_matches(';').trim();

    // "name: Type" pattern (Kotlin, Swift, TypeScript)
    if let Some(colon) = clean.find(':') {
        let key = clean[..colon].trim().trim_end_matches('?').to_string();
        let type_str = clean[colon + 1..].trim().to_string();
        if !key.is_empty() && !type_str.is_empty() && !key.contains(' ') {
            return Some((key, type_str));
        }
    }

    // "Type name" pattern (Java, C#, C++, Dart)
    let parts: Vec<&str> = clean.splitn(2, char::is_whitespace).collect();
    if parts.len() == 2 {
        let type_str = parts[0].trim().to_string();
        let name = parts[1].trim().trim_start_matches('$').to_string();
        if !name.is_empty() && !type_str.is_empty() && !name.contains(' ') && !name.contains('(') {
            return Some((name, type_str));
        }
    }

    None
}

// --- Rust parser ---

fn parse_rust_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.contains("struct ") && trimmed.contains('{') {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = trimmed
                .replace("pub ", "")
                .split("struct ")
                .nth(1)
                .and_then(|s| s.split(|c: char| c == '{' || c == '<' || c.is_whitespace()).next())
                .unwrap_or("")
                .trim()
                .to_string();
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));
            }
        } else if trimmed == "}" {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            let clean = trimmed
                .replace("pub ", "")
                .trim_start_matches("#[")
                .to_string();
            if clean.starts_with("serde") || clean.starts_with('#') || clean.starts_with("//") {
                continue;
            }
            let clean = clean.trim().trim_end_matches(',').trim();
            if let Some(colon) = clean.find(':') {
                let key = clean[..colon].trim().to_string();
                let type_str = clean[colon + 1..].trim().to_string();
                if !key.is_empty() && !type_str.is_empty() {
                    fields.insert(key, default_value_for_type(&type_str));
                }
            }
        }
    }
    if let Some((name, fields)) = current_fields {
        result.insert(name, Value::Object(fields));
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No struct definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

// --- Go parser ---

fn parse_go_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("type ") && trimmed.contains("struct") {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = trimmed
                .strip_prefix("type ")
                .and_then(|s| s.split_whitespace().next())
                .unwrap_or("")
                .to_string();
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));
            }
        } else if trimmed == "}" {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            if trimmed.is_empty() || trimmed.starts_with("//") { continue; }
            // Go: FieldName Type `json:"key"`
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 2 {
                let type_str = parts[1];
                // Extract json tag name if present
                let json_key = if let Some(tag_start) = trimmed.find("`json:\"") {
                    let after = &trimmed[tag_start + 7..];
                    after.split(|c: char| c == '"' || c == ',').next().unwrap_or(parts[0])
                } else {
                    parts[0]
                };
                if json_key != "-" {
                    fields.insert(json_key.to_string(), default_value_for_type(type_str));
                }
            }
        }
    }
    if let Some((name, fields)) = current_fields {
        result.insert(name, Value::Object(fields));
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No struct definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

// --- Python parser ---

fn parse_python_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("class ") {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = trimmed
                .strip_prefix("class ")
                .and_then(|s| s.split(|c: char| c == '(' || c == ':').next())
                .unwrap_or("")
                .trim()
                .to_string();
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            // "field_name: type" pattern (dataclass style)
            if !trimmed.starts_with("def ") && !trimmed.starts_with('@') && !trimmed.starts_with('#')
                && !trimmed.starts_with("pass") && !trimmed.is_empty()
            {
                let clean = trimmed.split('=').next().unwrap_or(trimmed).trim();
                if let Some(colon) = clean.find(':') {
                    let key = clean[..colon].trim().to_string();
                    let type_str = clean[colon + 1..].trim().to_string();
                    if !key.is_empty() && !type_str.is_empty() && !key.starts_with("self.") {
                        fields.insert(key, default_value_for_type(&type_str));
                    }
                }
            }
        }
    }
    if let Some((name, fields)) = current_fields {
        result.insert(name, Value::Object(fields));
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No class definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

// --- Swift parser ---

fn parse_swift_to_json(content: &str) -> Result<Value, String> {
    parse_typed_class_to_json(content, "swift")
}

// --- Ruby parser ---

fn parse_ruby_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("class ") {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = trimmed
                .strip_prefix("class ")
                .and_then(|s| s.split(|c: char| c == '<' || c.is_whitespace()).next())
                .unwrap_or("")
                .trim()
                .to_string();
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));
            }
        } else if trimmed == "end" {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            if trimmed.starts_with("attr_accessor") || trimmed.starts_with("attr_reader") || trimmed.starts_with("attr_writer") {
                let attrs_part = trimmed.splitn(2, ' ').nth(1).unwrap_or("");
                for attr in attrs_part.split(',') {
                    let key = attr.trim().trim_start_matches(':').to_string();
                    if !key.is_empty() {
                        fields.insert(key, Value::Null);
                    }
                }
            }
        }
    }
    if let Some((name, fields)) = current_fields {
        result.insert(name, Value::Object(fields));
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No class definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

// --- C++ parser ---

fn parse_cpp_to_json(content: &str) -> Result<Value, String> {
    parse_typed_class_to_json(content, "cpp")
}

// --- Protobuf parser ---

fn parse_protobuf_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("message ") {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = trimmed
                .strip_prefix("message ")
                .and_then(|s| s.split(|c: char| c == '{' || c.is_whitespace()).next())
                .unwrap_or("")
                .trim()
                .to_string();
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));
            }
        } else if trimmed == "}" {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("syntax")
                || trimmed.starts_with("package") || trimmed.starts_with("import")
                || trimmed.starts_with("option")
            {
                continue;
            }
            // "type field_name = N;" or "repeated type field_name = N;" or "optional type field_name = N;"
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 3 {
                let (type_str, field_name) = if parts[0] == "repeated" {
                    (format!("list<{}>", parts[1]), parts[2])
                } else if parts[0] == "optional" {
                    (format!("optional<{}>", parts[1]), parts[2])
                } else {
                    (parts[0].to_string(), parts[1])
                };
                fields.insert(field_name.to_string(), default_value_for_type(&type_str));
            }
        }
    }
    if let Some((name, fields)) = current_fields {
        result.insert(name, Value::Object(fields));
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No message definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

// --- Thrift parser ---

fn parse_thrift_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("struct ") {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = trimmed
                .strip_prefix("struct ")
                .and_then(|s| s.split(|c: char| c == '{' || c.is_whitespace()).next())
                .unwrap_or("")
                .trim()
                .to_string();
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));
            }
        } else if trimmed == "}" {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("namespace") {
                continue;
            }
            let clean = trimmed.trim_end_matches([';', ',']);
            let parts: Vec<&str> = clean.split_whitespace().collect();
            if parts.len() >= 4 {
                let type_str = parts[2];
                let field_name = parts[3];
                let is_optional = parts[1] == "optional";
                let val = if is_optional {
                    Value::Null
                } else {
                    default_value_for_type(type_str)
                };
                fields.insert(field_name.to_string(), val);
            } else if parts.len() >= 3 {
                let type_str = parts[1];
                let field_name = parts[2];
                fields.insert(field_name.to_string(), default_value_for_type(type_str));
            }
        }
    }
    if let Some((name, fields)) = current_fields {
        result.insert(name, Value::Object(fields));
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No struct definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

// --- JavaScript parser (quicktype typeMap format) ---

fn parse_javascript_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_name: Option<String> = None;
    let mut current_fields = serde_json::Map::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // Match: "ClassName": o([
        if trimmed.contains("\": o([") {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
            if let Some(start) = trimmed.find('"') {
                if let Some(end) = trimmed[start + 1..].find('"') {
                    current_name = Some(trimmed[start + 1..start + 1 + end].to_string());
                }
            }
        }
        // Match: { json: "fieldName", js: "fieldName", typ: ... },
        if trimmed.starts_with("{ json:") || trimmed.starts_with("{json:") {
            if let Some(json_start) = trimmed.find("json:") {
                let after = &trimmed[json_start + 5..];
                let after = after.trim().trim_start_matches('"');
                if let Some(end) = after.find('"') {
                    let field_name = &after[..end];
                    let typ_val = if trimmed.contains("typ: \"\"") || trimmed.contains("typ: ''") {
                        Value::String(String::new())
                    } else if trimmed.contains("typ: 0") {
                        Value::Number(serde_json::Number::from(0))
                    } else if trimmed.contains("typ: true") || trimmed.contains("typ: false") {
                        Value::Bool(false)
                    } else if trimmed.contains("typ: a(") {
                        Value::Array(vec![])
                    } else if trimmed.contains("typ: r(") {
                        Value::Object(serde_json::Map::new())
                    } else {
                        Value::Null
                    };
                    current_fields.insert(field_name.to_string(), typ_val);
                }
            }
        }
    }
    if let Some(name) = current_name {
        if !current_fields.is_empty() {
            result.insert(name, Value::Object(current_fields));
        }
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No type definition found in JavaScript code".into())
    } else {
        Ok(Value::Object(result))
    }
}

// --- Objective-C parser ---

fn parse_objectivec_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_name: Option<String> = None;
    let mut current_fields = serde_json::Map::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // @interface ClassName : NSObject
        if trimmed.starts_with("@interface ") {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
            let rest = &trimmed["@interface ".len()..];
            let name = rest.split(|c: char| c.is_whitespace() || c == ':' || c == '(')
                .next().unwrap_or("").trim().to_string();
            if !name.is_empty() {
                current_name = Some(name);
            }
        }
        // @end
        if trimmed == "@end" {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
        }
        // @property (nonatomic, ...) Type *name;
        if trimmed.starts_with("@property") && current_name.is_some() {
            let prop_part = if let Some(paren_end) = trimmed.find(')') {
                trimmed[paren_end + 1..].trim()
            } else {
                &trimmed["@property".len()..].trim()
            };
            let clean = prop_part.trim_end_matches(';').trim();
            let parts: Vec<&str> = clean.split_whitespace().collect();
            if parts.len() >= 2 {
                let field_name = parts.last().unwrap().trim_start_matches('*');
                let type_str = parts[..parts.len() - 1].join(" ").replace('*', "").trim().to_string();
                current_fields.insert(field_name.to_string(), objc_default_value(&type_str));
            }
        }
    }
    if let Some(name) = current_name {
        if !current_fields.is_empty() {
            result.insert(name, Value::Object(current_fields));
        }
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No @interface definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

fn objc_default_value(type_str: &str) -> Value {
    let t = type_str.trim();
    match t {
        "NSString" => Value::String(String::new()),
        "NSInteger" | "NSUInteger" | "int" | "long" | "NSNumber" => Value::Number(serde_json::Number::from(0)),
        "CGFloat" | "double" | "float" => Value::Number(serde_json::Number::from_f64(0.0).unwrap()),
        "BOOL" => Value::Bool(false),
        _ if t.starts_with("NSArray") || t.starts_with("NSMutableArray") => Value::Array(vec![]),
        _ if t.starts_with("NSDictionary") || t.starts_with("NSMutableDictionary") => Value::Object(serde_json::Map::new()),
        _ => Value::Object(serde_json::Map::new()),
    }
}

// --- Elm parser ---

fn parse_elm_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_name: Option<String> = None;
    let mut current_fields = serde_json::Map::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // type alias Name =
        if trimmed.starts_with("type alias ") {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
            let rest = &trimmed["type alias ".len()..];
            let name = rest.split(|c: char| c.is_whitespace() || c == '=')
                .next().unwrap_or("").trim().to_string();
            if !name.is_empty() {
                current_name = Some(name);
            }
        }
        // { fieldName : Type  or  , fieldName : Type
        if (trimmed.starts_with('{') || trimmed.starts_with(',')) && trimmed.contains(':') && current_name.is_some() {
            let field_part = trimmed.trim_start_matches(['{', ',', ' ']);
            if let Some(colon) = field_part.find(':') {
                let key = field_part[..colon].trim();
                let type_str = field_part[colon + 1..].trim().trim_end_matches('}').trim();
                if !key.is_empty() {
                    current_fields.insert(key.to_string(), elm_default_value(type_str));
                }
            }
        }
        // closing }
        if trimmed == "}" && current_name.is_some() {
            if let Some(name) = current_name.take() {
                result.insert(name, Value::Object(current_fields.clone()));
                current_fields.clear();
            }
        }
    }
    if let Some(name) = current_name {
        if !current_fields.is_empty() {
            result.insert(name, Value::Object(current_fields));
        }
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No type alias definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

fn elm_default_value(type_str: &str) -> Value {
    let t = type_str.trim();
    match t {
        "String" => Value::String(String::new()),
        "Int" => Value::Number(serde_json::Number::from(0)),
        "Float" => Value::Number(serde_json::Number::from_f64(0.0).unwrap()),
        "Bool" => Value::Bool(false),
        _ if t.starts_with("Array ") || t.starts_with("List ") => Value::Array(vec![]),
        _ if t.starts_with("Maybe ") => Value::Null,
        _ => Value::Object(serde_json::Map::new()),
    }
}

// --- Haskell parser ---

fn parse_haskell_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_name: Option<String> = None;
    let mut current_fields = serde_json::Map::new();
    let mut in_from_json = false;
    let mut from_json_name: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        // instance FromJSON ClassName where
        if trimmed.starts_with("instance FromJSON ") && trimmed.ends_with("where") {
            let name = trimmed["instance FromJSON ".len()..].trim_end_matches("where").trim().to_string();
            if !name.is_empty() {
                in_from_json = true;
                from_json_name = Some(name);
            }
        }

        // v .: "fieldName" — extract JSON key from FromJSON instance
        if in_from_json && trimmed.contains(".: \"") {
            if let Some(start) = trimmed.find(".: \"") {
                let after = &trimmed[start + 4..];
                if let Some(end) = after.find('"') {
                    let json_key = &after[..end];
                    current_fields.insert(json_key.to_string(), Value::Null);
                }
            }
        }

        // End of FromJSON instance (next instance or blank line after fields)
        if in_from_json && (trimmed.starts_with("instance ToJSON") || (trimmed.is_empty() && !current_fields.is_empty())) {
            if let Some(name) = from_json_name.take() {
                result.insert(name, Value::Object(current_fields.clone()));
                current_fields.clear();
            }
            in_from_json = false;
        }

        // data ClassName = ClassName { field :: Type, ... }
        if trimmed.starts_with("data ") && trimmed.contains("=") {
            let rest = &trimmed["data ".len()..];
            let name = rest.split(|c: char| c.is_whitespace() || c == '=')
                .next().unwrap_or("").trim().to_string();
            if !name.is_empty() {
                current_name = Some(name);
            }
        }

        // { fieldName :: Type  or  , fieldName :: Type
        if (trimmed.starts_with('{') || trimmed.starts_with(',')) && trimmed.contains("::") && current_name.is_some() {
            let field_part = trimmed.trim_start_matches(['{', ',', ' ']);
            if let Some(dcolon) = field_part.find("::") {
                let _key = field_part[..dcolon].trim();
                let type_str = field_part[dcolon + 2..].trim().trim_end_matches('}').trim();
                // We'll use the data definition only if no FromJSON instance is found
                if !result.contains_key(current_name.as_ref().unwrap()) {
                    let val = haskell_default_value(type_str);
                    // Store with the Haskell field name; will be overridden by FromJSON keys
                    current_fields.insert(_key.to_string(), val);
                }
            }
        }

        if trimmed.starts_with("} deriving") && current_name.is_some() {
            if let Some(name) = current_name.take() {
                if !result.contains_key(&name) && !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                }
                current_fields.clear();
            }
        }
    }

    // Flush remaining
    if let Some(name) = from_json_name {
        if !current_fields.is_empty() {
            result.insert(name, Value::Object(current_fields.clone()));
            current_fields.clear();
        }
    }
    if let Some(name) = current_name {
        if !result.contains_key(&name) && !current_fields.is_empty() {
            result.insert(name, Value::Object(current_fields));
        }
    }

    // FromJSON instances have the correct JSON keys; prefer them
    // For entries from data definitions, replace with FromJSON if available

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No data definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

fn haskell_default_value(type_str: &str) -> Value {
    let t = type_str.trim();
    match t {
        "Text" | "String" => Value::String(String::new()),
        "Int" | "Integer" => Value::Number(serde_json::Number::from(0)),
        "Double" | "Float" => Value::Number(serde_json::Number::from_f64(0.0).unwrap()),
        "Bool" => Value::Bool(false),
        _ if t.starts_with("Vector ") || t.starts_with("[") => Value::Array(vec![]),
        _ if t.starts_with("Maybe ") => Value::Null,
        _ => Value::Object(serde_json::Map::new()),
    }
}

// --- Crystal parser ---

fn parse_crystal_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_name: Option<String> = None;
    let mut current_fields = serde_json::Map::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("class ") {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
            let name = trimmed["class ".len()..].split(|c: char| c.is_whitespace() || c == '<')
                .next().unwrap_or("").trim().to_string();
            if !name.is_empty() {
                current_name = Some(name);
            }
        }
        // property name : Type
        if trimmed.starts_with("property ") && current_name.is_some() {
            let rest = &trimmed["property ".len()..];
            if let Some(colon) = rest.find(':') {
                let key = rest[..colon].trim();
                let type_str = rest[colon + 1..].trim();
                if !key.is_empty() {
                    current_fields.insert(key.to_string(), crystal_default_value(type_str));
                }
            }
        }
        if trimmed == "end" {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
        }
    }
    if let Some(name) = current_name {
        if !current_fields.is_empty() {
            result.insert(name, Value::Object(current_fields));
        }
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No class definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

fn crystal_default_value(type_str: &str) -> Value {
    let t = type_str.trim().trim_end_matches('?');
    match t {
        "String" => Value::String(String::new()),
        "Int32" | "Int64" | "Int" => Value::Number(serde_json::Number::from(0)),
        "Float32" | "Float64" | "Float" => Value::Number(serde_json::Number::from_f64(0.0).unwrap()),
        "Bool" => Value::Bool(false),
        _ if t.starts_with("Array(") => Value::Array(vec![]),
        _ if t.starts_with("Hash(") => Value::Object(serde_json::Map::new()),
        "Nil" => Value::Null,
        _ => Value::Object(serde_json::Map::new()),
    }
}

// --- Elixir parser ---

fn parse_elixir_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_name: Option<String> = None;
    let mut current_fields = serde_json::Map::new();
    let mut in_type = false;

    for line in content.lines() {
        let trimmed = line.trim();
        // defmodule Name do
        if trimmed.starts_with("defmodule ") && trimmed.ends_with(" do") {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
            let name = trimmed["defmodule ".len()..trimmed.len() - 3].trim().to_string();
            if !name.is_empty() {
                current_name = Some(name);
                in_type = false;
            }
        }
        // @type t :: %__MODULE__{
        if trimmed.contains("@type") && trimmed.contains("%__MODULE__{") {
            in_type = true;
        }
        // field: Type()  inside @type
        if in_type && trimmed.contains(':') && !trimmed.starts_with("@") && !trimmed.starts_with("}") {
            let clean = trimmed.trim_end_matches([',', ' ']);
            if let Some(colon) = clean.find(':') {
                let key = clean[..colon].trim();
                let type_str = clean[colon + 1..].trim();
                if !key.is_empty() && !key.starts_with("@") && !key.starts_with("%") {
                    current_fields.insert(key.to_string(), elixir_default_value(type_str));
                }
            }
        }
        if trimmed == "}" || trimmed.starts_with("}") {
            in_type = false;
        }
        if trimmed == "end" {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
        }
    }
    if let Some(name) = current_name {
        if !current_fields.is_empty() {
            result.insert(name, Value::Object(current_fields));
        }
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No defmodule definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

fn elixir_default_value(type_str: &str) -> Value {
    let t = type_str.trim();
    if t.contains("String.t()") || t == "String.t()" {
        Value::String(String::new())
    } else if t == "integer()" || t == "non_neg_integer()" || t == "pos_integer()" {
        Value::Number(serde_json::Number::from(0))
    } else if t == "float()" || t == "number()" {
        Value::Number(serde_json::Number::from_f64(0.0).unwrap())
    } else if t == "boolean()" {
        Value::Bool(false)
    } else if t.starts_with("[") || t.starts_with("list(") {
        Value::Array(vec![])
    } else if t == "nil" {
        Value::Null
    } else {
        Value::Object(serde_json::Map::new())
    }
}

// --- Pike parser ---

fn parse_pike_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_name: Option<String> = None;
    let mut current_fields = serde_json::Map::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // class ClassName {
        if trimmed.starts_with("class ") && trimmed.ends_with('{') {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
            let name = trimmed["class ".len()..].split(|c: char| c.is_whitespace() || c == '{')
                .next().unwrap_or("").trim().to_string();
            if !name.is_empty() {
                current_name = Some(name);
            }
        }
        // type  name;  // json: "jsonKey"
        if current_name.is_some() && !trimmed.starts_with("//") && !trimmed.starts_with("class ")
            && !trimmed.starts_with("string encode_json") && !trimmed.starts_with("mapping")
            && !trimmed.starts_with("return ") && !trimmed.starts_with("retval.")
            && trimmed.contains(';')
        {
            let clean = trimmed.split(';').next().unwrap_or("").trim();
            let parts: Vec<&str> = clean.split_whitespace().collect();
            if parts.len() >= 2 {
                let type_str = parts[0];
                let field_name = parts[1];
                // Check for json: "key" comment
                let json_key = if let Some(json_comment) = trimmed.find("// json: \"") {
                    let after = &trimmed[json_comment + 10..];
                    after.split('"').next().unwrap_or(field_name)
                } else {
                    field_name
                };
                if !type_str.is_empty() && !json_key.is_empty()
                    && !type_str.starts_with("mapping") && !type_str.starts_with("return")
                {
                    current_fields.insert(json_key.to_string(), pike_default_value(type_str));
                }
            }
        }
        if trimmed == "}" {
            if let Some(name) = current_name.take() {
                if !current_fields.is_empty() {
                    result.insert(name, Value::Object(current_fields.clone()));
                    current_fields.clear();
                }
            }
        }
    }
    if let Some(name) = current_name {
        if !current_fields.is_empty() {
            result.insert(name, Value::Object(current_fields));
        }
    }

    if result.len() == 1 {
        Ok(result.into_iter().next().unwrap().1)
    } else if result.is_empty() {
        Err("No class definition found".into())
    } else {
        Ok(Value::Object(result))
    }
}

fn pike_default_value(type_str: &str) -> Value {
    let t = type_str.trim();
    match t {
        "string" => Value::String(String::new()),
        "int" => Value::Number(serde_json::Number::from(0)),
        "float" => Value::Number(serde_json::Number::from_f64(0.0).unwrap()),
        "bool" => Value::Bool(false),
        _ if t.starts_with("array") => Value::Array(vec![]),
        _ if t.starts_with("mapping") => Value::Object(serde_json::Map::new()),
        _ => Value::Object(serde_json::Map::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========== 1. Type inference tests (collect_structs) ==========

    #[test]
    fn test_top_level_object() {
        let json = r#"{"name":"Alice","age":30}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "MyModel");
        assert!(result.structs.contains_key("MyModel"));
        assert!(matches!(result.top_level_type, JsonType::Object(_)));
        let fields = &result.structs["MyModel"];
        assert!(matches!(fields["name"], JsonType::String));
        assert!(matches!(fields["age"], JsonType::Integer));
    }

    #[test]
    fn test_top_level_array_of_objects() {
        let json = r#"[{"name":"Alice","age":30},{"name":"Bob","age":25}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "MyModel");
        assert!(matches!(result.top_level_type, JsonType::Array(_)));
        assert!(result.structs.contains_key("MyModelItem"));
    }

    #[test]
    fn test_top_level_array_protobuf_thrift() {
        let json = r#"[{"name":"test","value":42}]"#;
        let value: Value = serde_json::from_str(json).unwrap();

        let proto = gen_protobuf(&value, "MyModel");
        assert!(proto.contains("message MyModel {"), "Protobuf wrapper:\n{}", proto);
        assert!(proto.contains("repeated MyModelItem"), "Protobuf:\n{}", proto);

        let thrift = gen_thrift(&value, "MyModel");
        assert!(thrift.contains("struct MyModel {"), "Thrift wrapper:\n{}", thrift);
        assert!(thrift.contains("list<MyModelItem>"), "Thrift:\n{}", thrift);
    }

    #[test]
    fn test_reject_primitive_json() {
        assert!(json_to_code("42", "protobuf", "X").is_err());
        assert!(json_to_code("\"hello\"", "protobuf", "X").is_err());
        assert!(json_to_code("true", "protobuf", "X").is_err());
        assert!(json_to_code("null", "protobuf", "X").is_err());
        assert!(json_to_code("[]", "protobuf", "X").is_err());
        assert!(json_to_code("[1,2,3]", "protobuf", "X").is_err());
    }

    // ========== 2. Singularize tests ==========

    #[test]
    fn test_singularize() {
        assert_eq!(singularize("items"), "item");
        assert_eq!(singularize("users"), "user");
        assert_eq!(singularize("categories"), "category");
        assert_eq!(singularize("policies"), "policy");
        assert_eq!(singularize("addresses"), "address");
        assert_eq!(singularize("boxes"), "box");
        assert_eq!(singularize("classes"), "class");
        assert_eq!(singularize("address"), "address_item");
        assert_eq!(singularize("status"), "status_item");
        assert_eq!(singularize("bus"), "bus_item");
        assert_eq!(singularize("data"), "data_item");
    }

    // ========== 3. Nested structures ==========

    #[test]
    fn test_nested_object() {
        let json = r#"{"user":{"name":"Alice","profile":{"bio":"hello","age":30}}}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Root");
        assert!(result.structs.contains_key("Root"));
        assert!(result.structs.contains_key("User"));
        assert!(result.structs.contains_key("Profile"));
    }

    #[test]
    fn test_nested_array_of_objects_in_field() {
        let json = r#"{"users":[{"name":"Alice","age":30},{"name":"Bob","email":"b@c.com"}]}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Root");
        assert!(result.structs.contains_key("Root"));
        assert!(result.structs.contains_key("User"));
        let user_fields = &result.structs["User"];
        assert!(matches!(user_fields.get("email"), Some(JsonType::Optional(_))), "email should be optional");
        assert!(matches!(user_fields.get("age"), Some(JsonType::Optional(_))), "age should be optional");
        assert!(matches!(user_fields.get("name"), Some(JsonType::String)), "name should be required");
    }

    #[test]
    fn test_deeply_nested_array() {
        let json = r#"[{"email_title":"test","policy_query_param":{"broker_id":99,"product_filter":{"product_ids":[],"product_type_list":[-1]}}}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "MyModel");
        assert!(matches!(result.top_level_type, JsonType::Array(_)));
        assert!(result.structs.contains_key("MyModelItem"));
        assert!(result.structs.contains_key("PolicyQueryParam"));
        assert!(result.structs.contains_key("ProductFilter"));
    }

    // ========== 4. Null handling in merge ==========

    #[test]
    fn test_merge_with_null_values() {
        let json = r#"[{"name":"Alice","email":"a@b.com"},{"name":"Bob","email":null}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Data");
        let fields = &result.structs["DataItem"];
        assert!(matches!(fields.get("email"), Some(JsonType::Optional(_))), "email should be optional");
        assert!(matches!(fields.get("name"), Some(JsonType::String)), "name should be required");
    }

    #[test]
    fn test_merge_missing_keys() {
        let json = r#"[{"a":1,"b":"x"},{"a":2}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Data");
        let fields = &result.structs["DataItem"];
        assert!(matches!(fields.get("b"), Some(JsonType::Optional(_))), "b should be optional");
        assert!(matches!(fields.get("a"), Some(JsonType::Integer)), "a should be required integer");
    }

    // ========== 5. Empty object ==========

    #[test]
    fn test_empty_object() {
        let json = r#"{}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Empty");
        assert!(result.structs.contains_key("Empty"));
        assert!(result.structs["Empty"].is_empty());
    }

    // ========== 7. PascalCase / naming tests ==========

    #[test]
    fn test_pascal_case_preserves_camel() {
        assert_eq!(to_pascal_case("MyModel"), "MyModel");
        assert_eq!(to_pascal_case("myModel"), "MyModel");
        assert_eq!(to_pascal_case("my_model"), "MyModel");
        assert_eq!(to_pascal_case("my-model"), "MyModel");
        assert_eq!(to_pascal_case("MyModelItem"), "MyModelItem");
    }

    // ========== 8. Mixed type arrays ==========

    #[test]
    fn test_object_with_mixed_nested() {
        let json = r#"{"id":1,"name":"test","tags":["a","b"],"meta":{"key":"val"}}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Item");
        assert!(result.structs.contains_key("Item"));
        assert!(result.structs.contains_key("Meta"));
        let fields = &result.structs["Item"];
        assert!(matches!(fields.get("tags"), Some(JsonType::Array(_))));
    }

    // ========== 9. Float vs Integer ==========

    #[test]
    fn test_float_vs_integer() {
        let json = r#"{"count":42,"price":19.99,"ratio":0.5}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Product");
        let fields = &result.structs["Product"];
        assert!(matches!(fields.get("count"), Some(JsonType::Integer)));
        assert!(matches!(fields.get("price"), Some(JsonType::Number)));
        assert!(matches!(fields.get("ratio"), Some(JsonType::Number)));
    }

    // ========== 10. Null field handling ==========

    #[test]
    fn test_null_field_protobuf() {
        let json = r#"{"name":"test","data":null}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let proto = gen_protobuf(&value, "Item");
        assert!(proto.contains("optional"), "Null field should be optional in protobuf.\n{}", proto);
        assert!(proto.contains("string name"), "Proto should have name field.\n{}", proto);
    }

    #[test]
    fn test_null_field_thrift() {
        let json = r#"{"name":"test","data":null}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let thrift = gen_thrift(&value, "Item");
        assert!(thrift.contains("optional"), "Null field should be optional in thrift.\n{}", thrift);
        assert!(thrift.contains("required string name"), "Thrift:\n{}", thrift);
    }

    // ========== 11. Protobuf/Thrift wrapper message ==========

    #[test]
    fn test_protobuf_wrapper_message() {
        let json = r#"[{"name":"test"}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let proto = gen_protobuf(&value, "MyModel");
        assert!(proto.contains("message MyModel {"), "Proto wrapper:\n{}", proto);
        assert!(proto.contains("repeated MyModelItem"), "Proto repeated:\n{}", proto);
        assert!(proto.contains("message MyModelItem {"), "Proto item:\n{}", proto);
    }

    #[test]
    fn test_thrift_wrapper_struct() {
        let json = r#"[{"name":"test"}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let thrift = gen_thrift(&value, "MyModel");
        assert!(thrift.contains("struct MyModel {"), "Thrift wrapper:\n{}", thrift);
        assert!(thrift.contains("list<MyModelItem>"), "Thrift list:\n{}", thrift);
        assert!(thrift.contains("struct MyModelItem {"), "Thrift item:\n{}", thrift);
    }

    // ========== 12. code_to_json field name conversion ==========

    #[test]
    fn test_code_to_json_protobuf_field_names() {
        let proto = r#"
syntax = "proto3";

message MyModel {
    string email_title = 1;
    int64 broker_id = 2;
    PolicyQueryParam policy_query_param = 3;
}

message PolicyQueryParam {
    int64 es_query_size = 1;
}
"#;
        let result = parse_code_to_json(proto, "protobuf", "MyModel").unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("MyModel"), "Should preserve struct name MyModel");
        assert!(obj.contains_key("PolicyQueryParam"), "Should preserve struct name PolicyQueryParam");
        let my_model = obj["MyModel"].as_object().unwrap();
        assert!(my_model.contains_key("emailTitle"), "snake_case → camelCase: email_title → emailTitle, got: {:?}", my_model.keys().collect::<Vec<_>>());
        assert!(my_model.contains_key("brokerId"), "snake_case → camelCase: broker_id → brokerId");
        assert!(my_model.contains_key("policyQueryParam"), "snake_case → camelCase: policy_query_param → policyQueryParam");
    }

    #[test]
    fn test_code_to_json_protobuf_single_message() {
        let proto = r#"
syntax = "proto3";

message MyModel {
    string email_title = 1;
    int64 broker_id = 2;
}
"#;
        let result = parse_code_to_json(proto, "protobuf", "MyModel").unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("emailTitle"), "Single message fields should be camelCase: {:?}", obj.keys().collect::<Vec<_>>());
        assert!(obj.contains_key("brokerId"), "Single message fields should be camelCase");
    }

    #[test]
    fn test_code_to_json_rust_field_names() {
        let rust_code = r#"
struct MyModel {
    email_title: String,
    broker_id: i64,
}
"#;
        let result = parse_code_to_json(rust_code, "rust", "MyModel").unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("emailTitle"), "Rust snake_case → camelCase: {:?}", obj.keys().collect::<Vec<_>>());
        assert!(obj.contains_key("brokerId"), "Rust snake_case → camelCase");
    }

    #[test]
    fn test_code_to_json_go_uses_json_tag() {
        let go_code = r#"
type MyModel struct {
    EmailTitle string `json:"email_title"`
    BrokerId   int64  `json:"broker_id"`
}
"#;
        let result = parse_code_to_json(go_code, "go", "MyModel").unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("email_title"), "Go should use json tag value: {:?}", obj.keys().collect::<Vec<_>>());
        assert!(obj.contains_key("broker_id"), "Go should use json tag value");
    }

    #[test]
    fn test_code_to_json_typescript_no_conversion() {
        let ts_code = r#"
interface MyModel {
    emailTitle: string;
    brokerId: number;
}
"#;
        let result = parse_code_to_json(ts_code, "typescript", "MyModel").unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("emailTitle"), "TS should keep camelCase: {:?}", obj.keys().collect::<Vec<_>>());
        assert!(obj.contains_key("brokerId"), "TS should keep camelCase");
    }

}

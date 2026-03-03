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
        "typescript" => Ok(gen_typescript(&value, name)),
        "rust" => Ok(gen_rust(&value, name)),
        "go" => Ok(gen_go(&value, name)),
        "java" => Ok(gen_java(&value, name)),
        "python" => Ok(gen_python(&value, name)),
        "kotlin" => Ok(gen_kotlin(&value, name)),
        "swift" => Ok(gen_swift(&value, name)),
        "csharp" => Ok(gen_csharp(&value, name)),
        "dart" => Ok(gen_dart(&value, name)),
        "php" => Ok(gen_php(&value, name)),
        "ruby" => Ok(gen_ruby(&value, name)),
        "scala" => Ok(gen_scala(&value, name)),
        "cpp" => Ok(gen_cpp(&value, name)),
        "sql" => Ok(gen_sql(&value, name)),
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

fn split_words(s: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    for c in s.chars() {
        if c == '_' || c == '-' || c == ' ' {
            if !current.is_empty() {
                words.push(current.clone());
                current.clear();
            }
        } else if c.is_uppercase() && !current.is_empty() {
            words.push(current.clone());
            current.clear();
            current.push(c);
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn to_pascal_case(s: &str) -> String {
    split_words(s)
        .iter()
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

fn to_camel_case(s: &str) -> String {
    let pascal = to_pascal_case(s);
    let mut chars = pascal.chars();
    match chars.next() {
        Some(c) => c.to_lowercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            result.push('_');
        }
        result.push(c.to_lowercase().next().unwrap_or(c));
    }
    result
        .replace('-', "_")
        .replace(' ', "_")
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

// --- TypeScript ---

fn ts_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "string".into(),
        JsonType::Number | JsonType::Integer => "number".into(),
        JsonType::Boolean => "boolean".into(),
        JsonType::Null => "null".into(),
        JsonType::Array(inner) => format!("{}[]", ts_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "any".into(),
        JsonType::Optional(inner) => format!("{} | null", ts_type(inner)),
    }
}

fn gen_typescript(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = ts_type(inner);
        out.push_str(&format!("type {} = {}[];\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("interface {} {{\n", sname));
        for (key, ftype) in fields {
            let optional = matches!(ftype, JsonType::Optional(_));
            let type_str = ts_type(ftype);
            if optional {
                out.push_str(&format!("  {}?: {};\n", key, type_str));
            } else {
                out.push_str(&format!("  {}: {};\n", key, type_str));
            }
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- Rust ---

fn rust_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "String".into(),
        JsonType::Number => "f64".into(),
        JsonType::Integer => "i64".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "Option<()>".into(),
        JsonType::Array(inner) => format!("Vec<{}>", rust_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "serde_json::Value".into(),
        JsonType::Optional(inner) => format!("Option<{}>", rust_type(inner)),
    }
}

fn gen_rust(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::from("use serde::{Deserialize, Serialize};\n\n");
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = rust_type(inner);
        out.push_str(&format!("pub type {} = Vec<{}>;\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
        out.push_str(&format!("pub struct {} {{\n", sname));
        for (key, ftype) in fields {
            let field_name = to_snake_case(key);
            let type_str = rust_type(ftype);
            if field_name != *key {
                out.push_str(&format!("    #[serde(rename = \"{}\")]\n", key));
            }
            out.push_str(&format!("    pub {}: {},\n", field_name, type_str));
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- Go ---

fn go_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "string".into(),
        JsonType::Number => "float64".into(),
        JsonType::Integer => "int64".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "interface{}".into(),
        JsonType::Array(inner) => format!("[]{}", go_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "interface{}".into(),
        JsonType::Optional(inner) => format!("*{}", go_type(inner)),
    }
}

fn gen_go(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = go_type(inner);
        out.push_str(&format!("type {} []{}\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("type {} struct {{\n", sname));
        for (key, ftype) in fields {
            let field_name = to_pascal_case(key);
            let type_str = go_type(ftype);
            out.push_str(&format!(
                "\t{} {} `json:\"{}\"`\n",
                field_name, type_str, key
            ));
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- Java ---

fn java_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "String".into(),
        JsonType::Number => "double".into(),
        JsonType::Integer => "long".into(),
        JsonType::Boolean => "boolean".into(),
        JsonType::Null => "Object".into(),
        JsonType::Array(inner) => format!("List<{}>", java_boxed_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "Object".into(),
        JsonType::Optional(inner) => java_boxed_type(inner),
    }
}

fn java_boxed_type(t: &JsonType) -> String {
    match t {
        JsonType::Number => "Double".into(),
        JsonType::Integer => "Long".into(),
        JsonType::Boolean => "Boolean".into(),
        _ => java_type(t),
    }
}

fn gen_java(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    let is_top_array = matches!(&result.top_level_type, JsonType::Array(_));
    let has_list = is_top_array || result.structs.values().any(|fields| {
        fields.values().any(|t| matches!(t, JsonType::Array(_)))
    });
    if has_list {
        out.push_str("import java.util.List;\n\n");
    }
    if is_top_array {
        if let JsonType::Array(inner) = &result.top_level_type {
            let item_type = java_type(inner);
            let wrapper_name = to_pascal_case(name);
            let field_name = to_camel_case(&format!("{}s", name));
            out.push_str(&format!("public class {} {{\n", wrapper_name));
            out.push_str(&format!("    private List<{}> {};\n\n", item_type, field_name));
            out.push_str(&format!(
                "    public List<{}> get{}s() {{ return this.{}; }}\n",
                item_type, wrapper_name, field_name
            ));
            out.push_str(&format!(
                "    public void set{}s(List<{}> {}) {{ this.{} = {}; }}\n",
                wrapper_name, item_type, field_name, field_name, field_name
            ));
            out.push_str("}\n\n");
        }
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("public class {} {{\n", sname));
        for (key, ftype) in fields {
            let field_name = to_camel_case(key);
            let type_str = java_type(ftype);
            out.push_str(&format!("    private {} {};\n", type_str, field_name));
        }
        out.push('\n');
        for (key, ftype) in fields {
            let field_name = to_camel_case(key);
            let type_str = java_type(ftype);
            let getter = format!("get{}", to_pascal_case(key));
            let setter = format!("set{}", to_pascal_case(key));
            out.push_str(&format!(
                "    public {} {}() {{ return this.{}; }}\n",
                type_str, getter, field_name
            ));
            out.push_str(&format!(
                "    public void {}({} {}) {{ this.{} = {}; }}\n",
                setter, type_str, field_name, field_name, field_name
            ));
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- Python ---

fn python_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "str".into(),
        JsonType::Number => "float".into(),
        JsonType::Integer => "int".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "None".into(),
        JsonType::Array(inner) => format!("list[{}]", python_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "Any".into(),
        JsonType::Optional(inner) => format!("Optional[{}]", python_type(inner)),
    }
}

fn gen_python(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::from("from dataclasses import dataclass\nfrom typing import Optional, Any\n\n\n");
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = python_type(inner);
        out.push_str(&format!("{} = list[{}]\n\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str("@dataclass\n");
        out.push_str(&format!("class {}:\n", sname));
        if fields.is_empty() {
            out.push_str("    pass\n");
        } else {
            for (key, ftype) in fields {
                let field_name = to_snake_case(key);
                let type_str = python_type(ftype);
                out.push_str(&format!("    {}: {}\n", field_name, type_str));
            }
        }
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

// --- Kotlin ---

fn kotlin_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "String".into(),
        JsonType::Number => "Double".into(),
        JsonType::Integer => "Long".into(),
        JsonType::Boolean => "Boolean".into(),
        JsonType::Null => "Any?".into(),
        JsonType::Array(inner) => format!("List<{}>", kotlin_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "Any".into(),
        JsonType::Optional(inner) => format!("{}?", kotlin_type(inner)),
    }
}

fn gen_kotlin(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = kotlin_type(inner);
        out.push_str(&format!("typealias {} = List<{}>\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("data class {}(\n", sname));
        let field_list: Vec<String> = fields
            .iter()
            .map(|(key, ftype)| {
                let field_name = to_camel_case(key);
                let type_str = kotlin_type(ftype);
                let default = if matches!(ftype, JsonType::Optional(_)) {
                    " = null"
                } else {
                    ""
                };
                format!("    val {}: {}{}", field_name, type_str, default)
            })
            .collect();
        out.push_str(&field_list.join(",\n"));
        out.push_str("\n)\n\n");
    }
    out.trim_end().to_string()
}

// --- Swift ---

fn swift_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "String".into(),
        JsonType::Number => "Double".into(),
        JsonType::Integer => "Int".into(),
        JsonType::Boolean => "Bool".into(),
        JsonType::Null => "Any?".into(),
        JsonType::Array(inner) => format!("[{}]", swift_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "Any".into(),
        JsonType::Optional(inner) => format!("{}?", swift_type(inner)),
    }
}

fn gen_swift(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = swift_type(inner);
        out.push_str(&format!("typealias {} = [{}]\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("struct {}: Codable {{\n", sname));
        for (key, ftype) in fields {
            let field_name = to_camel_case(key);
            let type_str = swift_type(ftype);
            if field_name != *key {
                out.push_str(&format!("    let {}: {}\n", field_name, type_str));
            } else {
                out.push_str(&format!("    let {}: {}\n", field_name, type_str));
            }
        }

        let needs_coding_keys = fields.keys().any(|k| to_camel_case(k) != *k);
        if needs_coding_keys {
            out.push_str("\n    enum CodingKeys: String, CodingKey {\n");
            for key in fields.keys() {
                let field_name = to_camel_case(key);
                if field_name != *key {
                    out.push_str(&format!("        case {} = \"{}\"\n", field_name, key));
                } else {
                    out.push_str(&format!("        case {}\n", field_name));
                }
            }
            out.push_str("    }\n");
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- C# ---

fn csharp_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "string".into(),
        JsonType::Number => "double".into(),
        JsonType::Integer => "long".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "object?".into(),
        JsonType::Array(inner) => format!("List<{}>", csharp_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "object".into(),
        JsonType::Optional(inner) => format!("{}?", csharp_type(inner)),
    }
}

fn gen_csharp(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    let is_top_array = matches!(&result.top_level_type, JsonType::Array(_));
    let has_list = is_top_array || result.structs.values().any(|fields| {
        fields.values().any(|t| matches!(t, JsonType::Array(_)))
    });
    if has_list {
        out.push_str("using System.Collections.Generic;\n\n");
    }
    if is_top_array {
        if let JsonType::Array(inner) = &result.top_level_type {
            let item_type = csharp_type(inner);
            let wrapper_name = to_pascal_case(name);
            let prop_name = format!("{}s", wrapper_name);
            out.push_str(&format!("public class {}\n{{\n", wrapper_name));
            out.push_str(&format!(
                "    public List<{}> {} {{ get; set; }}\n",
                item_type, prop_name
            ));
            out.push_str("}\n\n");
        }
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("public class {}\n{{\n", sname));
        for (key, ftype) in fields {
            let prop_name = to_pascal_case(key);
            let type_str = csharp_type(ftype);
            out.push_str(&format!(
                "    public {} {} {{ get; set; }}\n",
                type_str, prop_name
            ));
        }
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- Dart ---

fn dart_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "String".into(),
        JsonType::Number => "double".into(),
        JsonType::Integer => "int".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "dynamic".into(),
        JsonType::Array(inner) => format!("List<{}>", dart_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "dynamic".into(),
        JsonType::Optional(inner) => format!("{}?", dart_type(inner)),
    }
}

fn gen_dart(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = dart_type(inner);
        out.push_str(&format!("typedef {} = List<{}>;\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("class {} {{\n", sname));
        for (key, ftype) in fields {
            let field_name = to_camel_case(key);
            let type_str = dart_type(ftype);
            out.push_str(&format!("  final {} {};\n", type_str, field_name));
        }
        out.push('\n');
        // Constructor
        out.push_str(&format!("  {}({{\n", sname));
        for (key, ftype) in fields {
            let field_name = to_camel_case(key);
            let required = !matches!(ftype, JsonType::Optional(_));
            if required {
                out.push_str(&format!("    required this.{},\n", field_name));
            } else {
                out.push_str(&format!("    this.{},\n", field_name));
            }
        }
        out.push_str("  });\n\n");
        // fromJson factory
        out.push_str(&format!(
            "  factory {}.fromJson(Map<String, dynamic> json) {{\n",
            sname
        ));
        out.push_str(&format!("    return {}(\n", sname));
        for (key, _ftype) in fields {
            let field_name = to_camel_case(key);
            out.push_str(&format!("      {}: json['{}'],\n", field_name, key));
        }
        out.push_str("    );\n");
        out.push_str("  }\n\n");
        // toJson
        out.push_str("  Map<String, dynamic> toJson() {\n");
        out.push_str("    return {\n");
        for (key, _ftype) in fields {
            let field_name = to_camel_case(key);
            out.push_str(&format!("      '{}': {},\n", key, field_name));
        }
        out.push_str("    };\n");
        out.push_str("  }\n");
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- PHP ---

fn php_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "string".into(),
        JsonType::Number => "float".into(),
        JsonType::Integer => "int".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "mixed".into(),
        JsonType::Array(inner) => format!("array<{}>", php_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "mixed".into(),
        JsonType::Optional(inner) => format!("?{}", php_type(inner)),
    }
}

fn gen_php(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::from("<?php\n\n");
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = php_type(inner);
        let wrapper_name = to_pascal_case(name);
        let field_name = to_camel_case(&format!("{}s", name));
        out.push_str(&format!("class {}\n{{\n", wrapper_name));
        out.push_str(&format!("    /** @var array<{}> */\n", item_type));
        out.push_str(&format!("    public array ${};\n\n", field_name));
        out.push_str(&format!("    public function __construct(array ${}) {{\n", field_name));
        out.push_str(&format!("        $this->{} = ${};\n", field_name, field_name));
        out.push_str("    }\n");
        out.push_str("}\n\n");
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("class {}\n{{\n", sname));
        for (key, ftype) in fields {
            let type_str = php_type(ftype);
            out.push_str(&format!(
                "    public {} ${};\n",
                type_str, to_camel_case(key)
            ));
        }
        out.push('\n');
        // Constructor
        out.push_str("    public function __construct(\n");
        let field_list: Vec<String> = fields
            .iter()
            .map(|(key, ftype)| {
                let type_str = php_type(ftype);
                format!("        {} ${}", type_str, to_camel_case(key))
            })
            .collect();
        out.push_str(&field_list.join(",\n"));
        out.push_str("\n    ) {\n");
        for key in fields.keys() {
            let field_name = to_camel_case(key);
            out.push_str(&format!(
                "        $this->{} = ${};\n",
                field_name, field_name
            ));
        }
        out.push_str("    }\n");
        out.push_str("}\n\n");
    }
    out.trim_end().to_string()
}

// --- Ruby ---

fn gen_ruby(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = match inner.as_ref() {
            JsonType::Object(n) => n.clone(),
            _ => "Object".into(),
        };
        let wrapper_name = to_pascal_case(name);
        let field_name = to_snake_case(&format!("{}s", name));
        out.push_str(&format!("class {}\n", wrapper_name));
        out.push_str(&format!("  attr_accessor :{}\n\n", field_name));
        out.push_str(&format!("  # @return [Array<{}>]\n", item_type));
        out.push_str(&format!("  def initialize({}: [])\n", field_name));
        out.push_str(&format!("    @{} = {}\n", field_name, field_name));
        out.push_str("  end\n");
        out.push_str("end\n\n");
    }
    for (sname, fields) in &result.structs {
        let attrs: Vec<String> = fields.keys().map(|k| format!(":{}", to_snake_case(k))).collect();
        out.push_str(&format!("class {}\n", sname));
        out.push_str(&format!("  attr_accessor {}\n\n", attrs.join(", ")));
        // initialize
        let params: Vec<String> = fields.keys().map(|k| format!("{}: nil", to_snake_case(k))).collect();
        out.push_str(&format!("  def initialize({})\n", params.join(", ")));
        for key in fields.keys() {
            let field_name = to_snake_case(key);
            out.push_str(&format!("    @{} = {}\n", field_name, field_name));
        }
        out.push_str("  end\n");
        out.push_str("end\n\n");
    }
    out.trim_end().to_string()
}

// --- Scala ---

fn scala_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "String".into(),
        JsonType::Number => "Double".into(),
        JsonType::Integer => "Long".into(),
        JsonType::Boolean => "Boolean".into(),
        JsonType::Null => "Any".into(),
        JsonType::Array(inner) => format!("List[{}]", scala_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "Any".into(),
        JsonType::Optional(inner) => format!("Option[{}]", scala_type(inner)),
    }
}

fn gen_scala(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = scala_type(inner);
        out.push_str(&format!("type {} = List[{}]\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("case class {}(\n", sname));
        let field_list: Vec<String> = fields
            .iter()
            .map(|(key, ftype)| {
                let field_name = to_camel_case(key);
                let type_str = scala_type(ftype);
                let default = if matches!(ftype, JsonType::Optional(_)) {
                    " = None"
                } else {
                    ""
                };
                format!("  {}: {}{}", field_name, type_str, default)
            })
            .collect();
        out.push_str(&field_list.join(",\n"));
        out.push_str("\n)\n\n");
    }
    out.trim_end().to_string()
}

// --- C++ ---

fn cpp_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "std::string".into(),
        JsonType::Number => "double".into(),
        JsonType::Integer => "int64_t".into(),
        JsonType::Boolean => "bool".into(),
        JsonType::Null => "std::nullptr_t".into(),
        JsonType::Array(inner) => format!("std::vector<{}>", cpp_type(inner)),
        JsonType::Object(name) => name.clone(),
        JsonType::Any => "nlohmann::json".into(),
        JsonType::Optional(inner) => format!("std::optional<{}>", cpp_type(inner)),
    }
}

fn gen_cpp(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::from("#include <string>\n#include <vector>\n#include <optional>\n#include <cstdint>\n\n");
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = cpp_type(inner);
        out.push_str(&format!("using {} = std::vector<{}>;\n\n", to_pascal_case(name), item_type));
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("struct {} {{\n", sname));
        for (key, ftype) in fields {
            let field_name = to_snake_case(key);
            let type_str = cpp_type(ftype);
            out.push_str(&format!("    {} {};\n", type_str, field_name));
        }
        out.push_str("};\n\n");
    }
    out.trim_end().to_string()
}

// --- SQL (CREATE TABLE) ---

fn sql_type(t: &JsonType) -> String {
    match t {
        JsonType::String => "TEXT".into(),
        JsonType::Number => "REAL".into(),
        JsonType::Integer => "BIGINT".into(),
        JsonType::Boolean => "BOOLEAN".into(),
        JsonType::Null => "TEXT".into(),
        JsonType::Array(_) => "JSON".into(),
        JsonType::Object(_) => "JSON".into(),
        JsonType::Any => "JSON".into(),
        JsonType::Optional(inner) => sql_type(inner),
    }
}

fn sql_col_for_field(key: &str, ftype: &JsonType) -> String {
    let col_name = to_snake_case(key);
    let is_optional = matches!(ftype, JsonType::Optional(_));

    // Unwrap Optional to get inner type
    let inner = match ftype {
        JsonType::Optional(inner) => inner.as_ref(),
        _ => ftype,
    };

    match inner {
        JsonType::Object(ref_name) => {
            // Foreign key reference to the related table
            let ref_table = to_snake_case(ref_name);
            let nullable = if is_optional { "" } else { " NOT NULL" };
            format!("    {}_id BIGINT{} REFERENCES {}(id)", col_name, nullable, ref_table)
        }
        _ => {
            let type_str = sql_type(ftype);
            let nullable = if is_optional { "" } else { " NOT NULL" };
            format!("    {} {}{}", col_name, type_str, nullable)
        }
    }
}

fn gen_sql(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::new();

    // Generate tables in reverse order so referenced tables come first
    let struct_list: Vec<_> = result.structs.iter().collect();
    for (sname, fields) in struct_list.iter().rev() {
        let table_name = to_snake_case(sname);
        out.push_str(&format!("CREATE TABLE {} (\n", table_name));
        out.push_str("    id BIGINT PRIMARY KEY AUTO_INCREMENT,\n");
        let field_lines: Vec<String> = fields
            .iter()
            .map(|(key, ftype)| sql_col_for_field(key, ftype))
            .collect();
        out.push_str(&field_lines.join(",\n"));
        out.push_str("\n);\n\n");
    }
    out.trim_end().to_string()
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
        "sql" => parse_sql_to_json(content),
        "protobuf" => parse_protobuf_to_json(content),
        "thrift" => parse_thrift_to_json(content),
        _ => Err(format!("Unsupported language for reverse conversion: {}", language)),
    }?;

    let converted = match language {
        // snake_case → camelCase
        "rust" | "python" | "cpp" | "ruby" | "sql" | "protobuf" | "thrift" => {
            convert_fields_only(result, &to_camel_case)
        }
        // PascalCase → camelCase
        "csharp" => {
            convert_fields_only(result, &to_camel_case)
        }
        // Already camelCase or uses json tags
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

// --- SQL parser ---

fn parse_sql_to_json(content: &str) -> Result<Value, String> {
    let mut result = serde_json::Map::new();
    let mut current_fields: Option<(String, serde_json::Map<String, Value>)> = None;

    let upper = content.to_uppercase();
    for (i, line) in content.lines().enumerate() {
        let upper_line = upper.lines().nth(i).unwrap_or("");
        let trimmed = line.trim();

        if upper_line.trim().starts_with("CREATE TABLE") {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
            let name = trimmed
                .split_whitespace()
                .nth(2)
                .unwrap_or("")
                .trim_matches(|c: char| c == '(' || c == '`' || c == '"' || c == '[' || c == ']')
                .to_string();
            if !name.is_empty() {
                current_fields = Some((name, serde_json::Map::new()));
            }
        } else if trimmed.starts_with(')') {
            if let Some((name, fields)) = current_fields.take() {
                result.insert(name, Value::Object(fields));
            }
        } else if let Some((_, ref mut fields)) = current_fields {
            let clean = trimmed.trim_end_matches(',').trim();
            if clean.is_empty() || upper_line.trim().starts_with("PRIMARY") || upper_line.trim().starts_with("CONSTRAINT")
                || upper_line.trim().starts_with("INDEX") || upper_line.trim().starts_with("UNIQUE")
                || upper_line.trim().starts_with("FOREIGN") || upper_line.trim().starts_with("KEY")
            {
                continue;
            }
            let parts: Vec<&str> = clean.split_whitespace().collect();
            if parts.len() >= 2 {
                let col_name = parts[0].trim_matches(|c: char| c == '`' || c == '"' || c == '[' || c == ']');
                let col_type = parts[1];
                if col_name.to_uppercase() != "ID" || !upper_line.contains("PRIMARY") {
                    fields.insert(col_name.to_string(), default_value_for_type(col_type));
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
        Err("No CREATE TABLE statement found".into())
    } else {
        Ok(Value::Object(result))
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    // ========== 1. Top-level structure tests ==========

    #[test]
    fn test_top_level_object() {
        let json = r#"{"name":"Alice","age":30}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let go = gen_go(&value, "MyModel");
        assert!(go.contains("type MyModel struct {"), "Go:\n{}", go);
        assert!(!go.contains("MyModelItem"), "Go should not have Item:\n{}", go);

        let ts = gen_typescript(&value, "MyModel");
        assert!(ts.contains("interface MyModel {"), "TS:\n{}", ts);
    }

    #[test]
    fn test_top_level_array_of_objects() {
        let json = r#"[{"name":"Alice","age":30},{"name":"Bob","age":25}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let go = gen_go(&value, "MyModel");
        assert!(go.contains("type MyModel []MyModelItem"), "Go:\n{}", go);
        assert!(go.contains("type MyModelItem struct {"), "Go:\n{}", go);
        assert!(!go.contains("type MyModel struct"), "Go should not have MyModel struct:\n{}", go);
    }

    #[test]
    fn test_top_level_array_all_languages() {
        let json = r#"[{"name":"test","value":42}]"#;
        let value: Value = serde_json::from_str(json).unwrap();

        let ts = gen_typescript(&value, "MyModel");
        assert!(ts.contains("type MyModel = MyModelItem[];"), "TS:\n{}", ts);
        assert!(ts.contains("interface MyModelItem {"), "TS:\n{}", ts);

        let rs = gen_rust(&value, "MyModel");
        assert!(rs.contains("pub type MyModel = Vec<MyModelItem>;"), "Rust:\n{}", rs);

        let go = gen_go(&value, "MyModel");
        assert!(go.contains("type MyModel []MyModelItem"), "Go:\n{}", go);

        // Languages with type aliases
        let java = gen_java(&value, "MyModel");
        assert!(java.contains("public class MyModel {"), "Java wrapper:\n{}", java);
        assert!(java.contains("List<MyModelItem>"), "Java:\n{}", java);

        let py = gen_python(&value, "MyModel");
        assert!(py.contains("MyModel = list[MyModelItem]"), "Python:\n{}", py);

        let kt = gen_kotlin(&value, "MyModel");
        assert!(kt.contains("typealias MyModel = List<MyModelItem>"), "Kotlin:\n{}", kt);

        let sw = gen_swift(&value, "MyModel");
        assert!(sw.contains("typealias MyModel = [MyModelItem]"), "Swift:\n{}", sw);

        let cs = gen_csharp(&value, "MyModel");
        assert!(cs.contains("public class MyModel"), "C# wrapper:\n{}", cs);
        assert!(cs.contains("List<MyModelItem>"), "C#:\n{}", cs);

        let dart = gen_dart(&value, "MyModel");
        assert!(dart.contains("typedef MyModel = List<MyModelItem>;"), "Dart:\n{}", dart);

        let php = gen_php(&value, "MyModel");
        assert!(php.contains("class MyModel"), "PHP wrapper:\n{}", php);
        assert!(php.contains("array<MyModelItem>"), "PHP:\n{}", php);

        let rb = gen_ruby(&value, "MyModel");
        assert!(rb.contains("class MyModel"), "Ruby wrapper:\n{}", rb);
        assert!(rb.contains("Array<MyModelItem>"), "Ruby:\n{}", rb);

        let sc = gen_scala(&value, "MyModel");
        assert!(sc.contains("type MyModel = List[MyModelItem]"), "Scala:\n{}", sc);

        let cpp = gen_cpp(&value, "MyModel");
        assert!(cpp.contains("using MyModel = std::vector<MyModelItem>;"), "C++:\n{}", cpp);

        // Languages with wrapper message/struct
        let proto = gen_protobuf(&value, "MyModel");
        assert!(proto.contains("message MyModel {"), "Protobuf wrapper:\n{}", proto);
        assert!(proto.contains("repeated MyModelItem"), "Protobuf:\n{}", proto);

        let thrift = gen_thrift(&value, "MyModel");
        assert!(thrift.contains("struct MyModel {"), "Thrift wrapper:\n{}", thrift);
        assert!(thrift.contains("list<MyModelItem>"), "Thrift:\n{}", thrift);
    }

    #[test]
    fn test_reject_primitive_json() {
        assert!(json_to_code("42", "go", "X").is_err());
        assert!(json_to_code("\"hello\"", "go", "X").is_err());
        assert!(json_to_code("true", "go", "X").is_err());
        assert!(json_to_code("null", "go", "X").is_err());
        assert!(json_to_code("[]", "go", "X").is_err());
        assert!(json_to_code("[1,2,3]", "go", "X").is_err());
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
        // Already singular
        assert_eq!(singularize("address"), "address_item");
        assert_eq!(singularize("status"), "status_item");
        assert_eq!(singularize("bus"), "bus_item");
        // Non-plural ending
        assert_eq!(singularize("data"), "data_item");
    }

    // ========== 3. Nested structures ==========

    #[test]
    fn test_nested_object() {
        let json = r#"{"user":{"name":"Alice","profile":{"bio":"hello","age":30}}}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let go = gen_go(&value, "Root");
        assert!(go.contains("type Root struct {"), "Go:\n{}", go);
        assert!(go.contains("type User struct {"), "Go:\n{}", go);
        assert!(go.contains("type Profile struct {"), "Go:\n{}", go);
    }

    #[test]
    fn test_nested_array_of_objects_in_field() {
        let json = r#"{"users":[{"name":"Alice","age":30},{"name":"Bob","email":"b@c.com"}]}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let ts = gen_typescript(&value, "Root");
        // "users" array should merge fields from both objects
        assert!(ts.contains("interface Root {"), "TS:\n{}", ts);
        assert!(ts.contains("interface User {"), "TS:\n{}", ts);
        // "email" only in second object -> optional
        assert!(ts.contains("email?:"), "email should be optional.\n{}", ts);
        // "age" only in first object -> optional
        assert!(ts.contains("age?:"), "age should be optional.\n{}", ts);
        // "name" in both -> required
        assert!(ts.contains("  name: string;"), "name should be required.\n{}", ts);
    }

    #[test]
    fn test_deeply_nested_array() {
        let json = r#"[{"email_title":"test","policy_query_param":{"broker_id":99,"product_filter":{"product_ids":[],"product_type_list":[-1]}}}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let go = gen_go(&value, "MyModel");
        assert!(go.contains("type MyModel []MyModelItem"), "Go:\n{}", go);
        assert!(go.contains("type MyModelItem struct {"), "Go:\n{}", go);
        assert!(go.contains("type PolicyQueryParam struct {"), "Go:\n{}", go);
        assert!(go.contains("type ProductFilter struct {"), "Go:\n{}", go);
    }

    // ========== 4. Null handling in merge ==========

    #[test]
    fn test_merge_with_null_values() {
        let json = r#"[{"name":"Alice","email":"a@b.com"},{"name":"Bob","email":null}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let ts = gen_typescript(&value, "Data");
        // email is null in one object -> should be optional with string type
        assert!(ts.contains("email?:"), "email should be optional.\n{}", ts);
        assert!(ts.contains("string"), "email should still be string type.\n{}", ts);
        // name is present in both -> required
        assert!(ts.contains("  name: string;"), "name should be required.\n{}", ts);
    }

    #[test]
    fn test_merge_missing_keys() {
        let json = r#"[{"a":1,"b":"x"},{"a":2}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let ts = gen_typescript(&value, "Data");
        // "b" missing in second object -> optional
        assert!(ts.contains("b?:"), "b should be optional.\n{}", ts);
        // "a" in both -> required
        assert!(ts.contains("  a: number;"), "a should be required.\n{}", ts);
    }

    // ========== 5. SQL generation ==========

    #[test]
    fn test_sql_simple_object() {
        let json = r#"{"name":"Alice","age":30,"active":true}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let sql = gen_sql(&value, "User");
        assert!(sql.contains("CREATE TABLE user ("), "SQL:\n{}", sql);
        assert!(sql.contains("name TEXT NOT NULL"), "SQL:\n{}", sql);
        assert!(sql.contains("age BIGINT NOT NULL"), "SQL:\n{}", sql);
        assert!(sql.contains("active BOOLEAN NOT NULL"), "SQL:\n{}", sql);
    }

    #[test]
    fn test_sql_nested_object_generates_fk() {
        let json = r#"{"name":"test","config":{"timeout":30,"retries":3}}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let sql = gen_sql(&value, "Service");
        // Parent table should have FK reference, not JSON column
        assert!(sql.contains("config_id BIGINT NOT NULL REFERENCES config(id)"), "SQL should have FK.\n{}", sql);
        // Child table should exist
        assert!(sql.contains("CREATE TABLE config ("), "SQL should have config table.\n{}", sql);
        assert!(sql.contains("timeout BIGINT NOT NULL"), "SQL:\n{}", sql);
    }

    #[test]
    fn test_sql_top_level_array() {
        let json = r#"[{"name":"test","value":42}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let sql = gen_sql(&value, "MyModel");
        assert!(sql.contains("CREATE TABLE"), "SQL should generate table.\n{}", sql);
    }

    #[test]
    fn test_sql_array_field_uses_json() {
        let json = r#"{"tags":["a","b"],"count":1}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let sql = gen_sql(&value, "Item");
        assert!(sql.contains("tags JSON NOT NULL"), "Array field should be JSON.\n{}", sql);
    }

    // ========== 6. Empty object ==========

    #[test]
    fn test_empty_object() {
        let json = r#"{}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let ts = gen_typescript(&value, "Empty");
        assert!(ts.contains("interface Empty {"), "TS:\n{}", ts);

        let py = gen_python(&value, "Empty");
        assert!(py.contains("class Empty:"), "Python:\n{}", py);
        assert!(py.contains("pass"), "Python empty class should have pass.\n{}", py);
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
        let go = gen_go(&value, "Item");
        assert!(go.contains("type Item struct {"), "Go:\n{}", go);
        assert!(go.contains("type Meta struct {"), "Go:\n{}", go);
        assert!(go.contains("[]string"), "Go tags should be []string.\n{}", go);
    }

    // ========== 9. Float vs Integer ==========

    #[test]
    fn test_float_vs_integer() {
        let json = r#"{"count":42,"price":19.99,"ratio":0.5}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let ts = gen_typescript(&value, "Product");
        // All should be "number" in TypeScript
        assert!(ts.contains("count: number"), "TS:\n{}", ts);
        assert!(ts.contains("price: number"), "TS:\n{}", ts);

        let go = gen_go(&value, "Product");
        assert!(go.contains("Count int64"), "Go count should be int64.\n{}", go);
        assert!(go.contains("Price float64"), "Go price should be float64.\n{}", go);
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

    #[test]
    fn test_java_wrapper_class() {
        let json = r#"[{"name":"test"}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let java = gen_java(&value, "MyModel");
        assert!(java.contains("public class MyModel {"), "Java wrapper:\n{}", java);
        assert!(java.contains("List<MyModelItem>"), "Java list:\n{}", java);
        assert!(java.contains("public class MyModelItem {"), "Java item:\n{}", java);
    }

    #[test]
    fn test_csharp_wrapper_class() {
        let json = r#"[{"name":"test"}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let cs = gen_csharp(&value, "MyModel");
        assert!(cs.contains("public class MyModel"), "C# wrapper:\n{}", cs);
        assert!(cs.contains("List<MyModelItem>"), "C# list:\n{}", cs);
        assert!(cs.contains("public class MyModelItem"), "C# item:\n{}", cs);
    }

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

    #[test]
    fn test_code_to_json_sql_field_names() {
        let sql = r#"
CREATE TABLE my_model (
    id BIGINT PRIMARY KEY,
    email_title VARCHAR(255),
    broker_id BIGINT
);
"#;
        let result = parse_code_to_json(sql, "sql", "MyModel").unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("emailTitle"), "SQL snake_case → camelCase: {:?}", obj.keys().collect::<Vec<_>>());
        assert!(obj.contains_key("brokerId"), "SQL snake_case → camelCase");
    }
}

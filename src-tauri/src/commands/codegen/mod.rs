mod parser;
mod schema;
mod type_shape;

use serde_json::Value;

use parser::parse_code_to_json_ast;
use schema::{gen_protobuf, gen_thrift};

#[tauri::command]
pub fn json_to_code(content: &str, language: &str, class_name: &str) -> Result<String, String> {
    let value: Value =
        serde_json::from_str(content).map_err(|error| format!("Invalid JSON: {error}"))?;

    match &value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            return Err("JSON must be an object or array to generate code structures".into());
        }
        Value::Array(values) if values.is_empty() => {
            return Err("Empty JSON array: cannot infer element types".into());
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
        _ => Err(format!("Unsupported language: {language}")),
    }
}

#[tauri::command]
pub fn code_to_json(content: &str, language: &str) -> Result<String, String> {
    let value = parse_code_to_json_ast(content, language)?;
    serde_json::to_string_pretty(&value)
        .map_err(|error| format!("JSON serialization failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::code_to_json;

    #[test]
    fn code_to_json_handles_javascript_constructor_assignments() {
        let source = r#"
class User {
    constructor(name) {
        this.name = name;
        this.active = true;
    }
}
"#;

        let json = code_to_json(source, "javascript").unwrap();
        assert_eq!(json, "{\n  \"name\": null,\n  \"active\": true\n}");
    }
}

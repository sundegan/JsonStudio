use heck::{ToSnakeCase, ToUpperCamelCase};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

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

fn infer_type(
    value: &Value,
    name: &str,
    path: &str,
    structs: &mut BTreeMap<String, BTreeMap<String, JsonType>>,
    type_names: &mut TypeNameRegistry,
) -> JsonType {
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
                let item_path = array_item_path(path);
                let all_objects = arr.iter().all(|v| v.is_object());
                if all_objects {
                    let struct_name =
                        merge_object_fields(structs, arr, &item_name, &item_path, type_names);
                    JsonType::Array(Box::new(JsonType::Object(struct_name)))
                } else {
                    let mut items = arr.iter();
                    let first = items.next().expect("non-empty array");
                    let mut elem_type =
                        infer_type(first, &item_name, &item_path, structs, type_names);
                    for item in items {
                        elem_type = merge_json_types(
                            elem_type,
                            infer_type(item, &item_name, &item_path, structs, type_names),
                        );
                    }
                    JsonType::Array(Box::new(elem_type))
                }
            }
        }
        Value::Object(map) => {
            let struct_name = type_names.for_path(path, name);
            let mut fields = BTreeMap::new();
            for (key, val) in map {
                let field_path = object_field_path(path, key);
                let field_type = infer_type(val, key, &field_path, structs, type_names);
                fields.insert(key.clone(), field_type);
            }
            if let Some(existing) = structs.get_mut(&struct_name) {
                merge_struct_fields(existing, fields);
            } else {
                structs.insert(struct_name.clone(), fields);
            }
            JsonType::Object(struct_name)
        }
    }
}

fn merge_object_fields(
    structs: &mut BTreeMap<String, BTreeMap<String, JsonType>>,
    arr: &[Value],
    item_name: &str,
    item_path: &str,
    type_names: &mut TypeNameRegistry,
) -> String {
    let struct_name = type_names.for_path(item_path, item_name);
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
                    let field_path = object_field_path(item_path, k);
                    let t = infer_type(v, k, &field_path, structs, type_names);
                    if let Some(existing) = key_types.get_mut(k) {
                        *existing = merge_json_types(existing.clone(), t);
                    } else {
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
            fields.insert(key.clone(), optional_json_type(base_type));
        } else {
            fields.insert(key.clone(), base_type);
        }
    }
    structs.insert(struct_name.clone(), fields);
    struct_name
}

fn optional_json_type(value: JsonType) -> JsonType {
    match value {
        JsonType::Null => JsonType::Optional(Box::new(JsonType::Any)),
        JsonType::Optional(_) => value,
        other => JsonType::Optional(Box::new(other)),
    }
}

fn merge_json_types(left: JsonType, right: JsonType) -> JsonType {
    if left == right {
        return left;
    }
    match (left, right) {
        (JsonType::Null, other) | (other, JsonType::Null) => optional_json_type(other),
        (JsonType::Optional(left), JsonType::Optional(right)) => {
            optional_json_type(merge_json_types(*left, *right))
        }
        (JsonType::Optional(left), other) | (other, JsonType::Optional(left)) => {
            optional_json_type(merge_json_types(*left, other))
        }
        (JsonType::Integer, JsonType::Number) | (JsonType::Number, JsonType::Integer) => {
            JsonType::Number
        }
        (JsonType::Array(left), JsonType::Array(right)) => {
            JsonType::Array(Box::new(merge_json_types(*left, *right)))
        }
        (JsonType::Object(left), JsonType::Object(right)) if left == right => {
            JsonType::Object(left)
        }
        _ => JsonType::Any,
    }
}

fn merge_struct_fields(
    existing: &mut BTreeMap<String, JsonType>,
    incoming: BTreeMap<String, JsonType>,
) {
    for (key, field_type) in existing.iter_mut() {
        if !incoming.contains_key(key) {
            *field_type = optional_json_type(field_type.clone());
        }
    }
    for (key, field_type) in incoming {
        if let Some(existing_type) = existing.get_mut(&key) {
            *existing_type = merge_json_types(existing_type.clone(), field_type);
        } else {
            existing.insert(key, optional_json_type(field_type));
        }
    }
}

struct CollectResult {
    structs: BTreeMap<String, BTreeMap<String, JsonType>>,
    top_level_type: JsonType,
}

struct TypeNameRegistry {
    reserved: BTreeSet<String>,
    allocated: BTreeSet<String>,
    by_path: BTreeMap<String, String>,
}

impl TypeNameRegistry {
    fn new(reserved: BTreeSet<String>) -> Self {
        Self {
            reserved,
            allocated: BTreeSet::new(),
            by_path: BTreeMap::new(),
        }
    }

    fn for_path(&mut self, path: &str, source_name: &str) -> String {
        if let Some(existing) = self.by_path.get(path) {
            return existing.clone();
        }

        let base = to_type_identifier(source_name);
        let mut suffix = 2;
        let mut candidate = base.clone();
        if self.is_taken(&candidate) {
            candidate = format!("{base}Value");
            while self.is_taken(&candidate) {
                candidate = format!("{base}Value{suffix}");
                suffix += 1;
            }
        }

        self.allocated.insert(candidate.clone());
        self.by_path.insert(path.to_string(), candidate.clone());
        candidate
    }

    fn is_taken(&self, candidate: &str) -> bool {
        self.reserved.contains(candidate) || self.allocated.contains(candidate)
    }
}

fn object_field_path(parent_path: &str, key: &str) -> String {
    let escaped_key = key.replace('~', "~0").replace('/', "~1");
    format!("{parent_path}/k:{escaped_key}")
}

fn array_item_path(parent_path: &str) -> String {
    format!("{parent_path}/a")
}

fn collect_structs(value: &Value, name: &str) -> CollectResult {
    let mut structs = BTreeMap::new();
    let root_name = to_type_identifier(name);
    let mut type_names = TypeNameRegistry::new(BTreeSet::from([root_name.clone()]));

    if let Value::Array(arr) = value {
        let all_objects = arr.iter().all(|v| v.is_object());
        if all_objects && !arr.is_empty() {
            let item_name = format!("{}Item", name);
            let struct_name =
                merge_object_fields(&mut structs, arr, &item_name, "$/a", &mut type_names);
            return CollectResult {
                structs,
                top_level_type: JsonType::Array(Box::new(JsonType::Object(struct_name))),
            };
        }
    }

    if let Value::Object(map) = value {
        let mut fields = BTreeMap::new();
        for (key, value) in map {
            let field_path = object_field_path("$", key);
            fields.insert(
                key.clone(),
                infer_type(value, key, &field_path, &mut structs, &mut type_names),
            );
        }
        structs.insert(root_name.clone(), fields);
        return CollectResult {
            structs,
            top_level_type: JsonType::Object(root_name),
        };
    }

    let top_level_type = infer_type(value, name, "$", &mut structs, &mut type_names);
    CollectResult {
        structs,
        top_level_type,
    }
}

// --- Helpers ---

fn to_pascal_case(s: &str) -> String {
    s.to_upper_camel_case()
}

fn to_snake_case(s: &str) -> String {
    s.to_snake_case()
}

fn to_type_identifier(s: &str) -> String {
    let mut identifier: String = to_pascal_case(s)
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if identifier.trim_matches('_').is_empty() {
        identifier = "GeneratedType".into();
    }
    if identifier
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_digit())
        || is_reserved_identifier(&identifier)
    {
        identifier = format!("Generated{identifier}");
    }
    identifier
}

fn to_field_identifier(s: &str) -> String {
    let mut identifier: String = to_snake_case(s)
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if identifier.trim_matches('_').is_empty() {
        identifier = "field".into();
    }
    if identifier
        .chars()
        .next()
        .is_some_and(|ch| ch.is_ascii_digit())
        || is_reserved_identifier(&identifier)
    {
        identifier = format!("field_{identifier}");
    }
    identifier
}

fn unique_field_identifier(key: &str, used: &mut BTreeSet<String>) -> String {
    let base = to_field_identifier(key);
    let mut candidate = base.clone();
    let mut suffix = 2;
    while !used.insert(candidate.clone()) {
        candidate = format!("{base}_{suffix}");
        suffix += 1;
    }
    candidate
}

fn is_reserved_identifier(identifier: &str) -> bool {
    matches!(
        identifier.to_ascii_lowercase().as_str(),
        "syntax"
            | "import"
            | "package"
            | "option"
            | "message"
            | "enum"
            | "service"
            | "rpc"
            | "returns"
            | "repeated"
            | "optional"
            | "required"
            | "map"
            | "oneof"
            | "reserved"
            | "extensions"
            | "extend"
            | "namespace"
            | "include"
            | "typedef"
            | "const"
            | "struct"
            | "union"
            | "exception"
            | "throws"
            | "void"
            | "list"
            | "set"
    )
}

fn singularize(s: &str) -> String {
    let lower = s.to_lowercase();

    // Common words that end in 's' but are already singular
    const FALSE_PLURALS: &[&str] = &[
        "address",
        "status",
        "class",
        "bus",
        "process",
        "access",
        "success",
        "progress",
        "bonus",
        "campus",
        "canvas",
        "focus",
        "radius",
        "virus",
        "alias",
        "basis",
        "crisis",
        "diagnosis",
        "analysis",
        "thesis",
        "synopsis",
        "consensus",
        "corpus",
    ];
    if FALSE_PLURALS.iter().any(|w| lower == *w) {
        return format!("{}_item", s);
    }

    if lower.ends_with("ies") && lower.len() > 4 {
        format!("{}y", &s[..s.len() - 3])
    } else if lower.ends_with("ses")
        || lower.ends_with("xes")
        || lower.ends_with("zes")
        || lower.ends_with("ches")
        || lower.ends_with("shes")
    {
        s[..s.len() - 2].to_string()
    } else if lower.ends_with('s')
        && !lower.ends_with("ss")
        && !lower.ends_with("us")
        && !lower.ends_with("is")
    {
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

fn protobuf_uses_any(t: &JsonType) -> bool {
    match t {
        JsonType::Null | JsonType::Any => true,
        JsonType::Array(inner) | JsonType::Optional(inner) => protobuf_uses_any(inner),
        _ => false,
    }
}

fn is_repeated_type(t: &JsonType) -> bool {
    match t {
        JsonType::Array(_) => true,
        JsonType::Optional(inner) => is_repeated_type(inner),
        _ => false,
    }
}

pub(super) fn gen_protobuf(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::from("syntax = \"proto3\";\n\n");
    if result
        .structs
        .values()
        .flat_map(|fields| fields.values())
        .any(protobuf_uses_any)
    {
        out.push_str("import \"google/protobuf/any.proto\";\n\n");
    }
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = protobuf_type(inner);
        let wrapper_name = to_type_identifier(name);
        let field_name = to_field_identifier(&format!("{}s", name));
        out.push_str(&format!("message {} {{\n", wrapper_name));
        out.push_str(&format!("  repeated {} {} = 1;\n", item_type, field_name));
        out.push_str("}\n\n");
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("message {} {{\n", sname));
        let mut used_field_names = BTreeSet::new();
        for (idx, (key, ftype)) in fields.iter().enumerate() {
            let field_name = unique_field_identifier(key, &mut used_field_names);
            let field_num = idx + 1;
            let is_repeated = is_repeated_type(ftype);
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
                out.push_str(&format!("  {} {} = {};\n", type_str, field_name, field_num));
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

pub(super) fn gen_thrift(value: &Value, name: &str) -> String {
    let result = collect_structs(value, name);
    let mut out = String::from("namespace * generated\n\n");
    if let JsonType::Array(inner) = &result.top_level_type {
        let item_type = thrift_type(inner);
        let wrapper_name = to_type_identifier(name);
        let field_name = to_field_identifier(&format!("{}s", name));
        out.push_str(&format!("struct {} {{\n", wrapper_name));
        out.push_str(&format!(
            "  1: required list<{}> {};\n",
            item_type, field_name
        ));
        out.push_str("}\n\n");
    }
    for (sname, fields) in &result.structs {
        out.push_str(&format!("struct {} {{\n", sname));
        let mut used_field_names = BTreeSet::new();
        for (idx, (key, ftype)) in fields.iter().enumerate() {
            let field_name = unique_field_identifier(key, &mut used_field_names);
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

#[cfg(test)]
mod tests {
    use super::super::{code_to_json, json_to_code, parser::parse_code_to_json_ast};
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
        assert!(
            proto.contains("message MyModel {"),
            "Protobuf wrapper:\n{}",
            proto
        );
        assert!(
            proto.contains("repeated MyModelItem"),
            "Protobuf:\n{}",
            proto
        );

        let thrift = gen_thrift(&value, "MyModel");
        assert!(
            thrift.contains("struct MyModel {"),
            "Thrift wrapper:\n{}",
            thrift
        );
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
    fn test_root_and_nested_type_name_collisions_are_disambiguated() {
        let value: Value = serde_json::from_str(r#"{"profile":{"id":1}}"#).unwrap();
        let result = collect_structs(&value, "Profile");
        assert!(result.structs.contains_key("Profile"));
        assert!(result.structs.contains_key("ProfileValue"));
        assert!(matches!(
            result.structs["Profile"]["profile"],
            JsonType::Object(ref name) if name == "ProfileValue"
        ));
        assert!(matches!(
            result.structs["ProfileValue"]["id"],
            JsonType::Integer
        ));

        let proto = gen_protobuf(&value, "Profile");
        assert!(proto.contains("message ProfileValue"), "{proto}");
        assert!(proto.contains("ProfileValue profile"), "{proto}");
        assert_eq!(proto.matches("message Profile {").count(), 1, "{proto}");
    }

    #[test]
    fn test_distinct_json_keys_do_not_share_normalized_type_names() {
        let value: Value =
            serde_json::from_str(r#"{"user-profile":{"id":1},"user_profile":{"name":"Ada"}}"#)
                .unwrap();
        let proto = gen_protobuf(&value, "Root");
        assert_eq!(proto.matches("message UserProfile {").count(), 1, "{proto}");
        assert_eq!(
            proto.matches("message UserProfileValue {").count(),
            1,
            "{proto}"
        );
    }

    #[test]
    fn test_same_json_key_in_different_object_paths_has_distinct_types() {
        let value: Value = serde_json::from_str(
            r#"{"user":{"profile":{"id":1}},"admin":{"profile":{"name":"Ada"}}}"#,
        )
        .unwrap();
        let proto = gen_protobuf(&value, "Root");
        assert_eq!(proto.matches("message Profile {").count(), 1, "{proto}");
        assert_eq!(
            proto.matches("message ProfileValue {").count(),
            1,
            "{proto}"
        );
        assert!(!proto.contains("optional int64 id"), "{proto}");
        assert!(!proto.contains("optional string name"), "{proto}");
    }

    #[test]
    fn test_array_wrapper_name_does_not_collide_with_nested_type() {
        let value: Value = serde_json::from_str(r#"[{"order":{"id":1}}]"#).unwrap();
        let proto = gen_protobuf(&value, "Order");
        assert!(proto.contains("message OrderValue"), "{proto}");
        assert!(proto.contains("OrderValue order"), "{proto}");
        assert_eq!(proto.matches("message Order {").count(), 1, "{proto}");
    }

    #[test]
    fn test_nested_array_of_objects_in_field() {
        let json = r#"{"users":[{"name":"Alice","age":30},{"name":"Bob","email":"b@c.com"}]}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Root");
        assert!(result.structs.contains_key("Root"));
        assert!(result.structs.contains_key("User"));
        let user_fields = &result.structs["User"];
        assert!(
            matches!(user_fields.get("email"), Some(JsonType::Optional(_))),
            "email should be optional"
        );
        assert!(
            matches!(user_fields.get("age"), Some(JsonType::Optional(_))),
            "age should be optional"
        );
        assert!(
            matches!(user_fields.get("name"), Some(JsonType::String)),
            "name should be required"
        );
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
        assert!(
            matches!(fields.get("email"), Some(JsonType::Optional(_))),
            "email should be optional"
        );
        assert!(
            matches!(fields.get("name"), Some(JsonType::String)),
            "name should be required"
        );
    }

    #[test]
    fn test_merge_missing_keys() {
        let json = r#"[{"a":1,"b":"x"},{"a":2}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let result = collect_structs(&value, "Data");
        let fields = &result.structs["DataItem"];
        assert!(
            matches!(fields.get("b"), Some(JsonType::Optional(_))),
            "b should be optional"
        );
        assert!(
            matches!(fields.get("a"), Some(JsonType::Integer)),
            "a should be required integer"
        );
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

    #[test]
    fn test_merged_samples_preserve_nested_optional_and_conflicting_types() {
        let value: Value = serde_json::from_str(
            r#"[
                {"tags":["a"],"value":1,"samples":[1],"profile":{"first":"Ada"}},
                {"value":"two","samples":["two"],"profile":{"last":"Lovelace"}}
            ]"#,
        )
        .unwrap();
        let result = collect_structs(&value, "Payload");
        let fields = &result.structs["PayloadItem"];
        assert!(matches!(fields["tags"], JsonType::Optional(_)));
        assert!(matches!(fields["value"], JsonType::Any));
        assert!(matches!(fields["samples"], JsonType::Array(_)));
        let profile = &result.structs["Profile"];
        assert!(matches!(profile["first"], JsonType::Optional(_)));
        assert!(matches!(profile["last"], JsonType::Optional(_)));

        let proto = gen_protobuf(&value, "Payload");
        assert!(
            proto.contains("import \"google/protobuf/any.proto\";"),
            "{proto}"
        );
        assert!(proto.contains("repeated string tags"), "{proto}");
        assert!(proto.contains("google.protobuf.Any value"), "{proto}");
        assert!(
            proto.contains("repeated google.protobuf.Any samples"),
            "{proto}"
        );
        assert!(!proto.contains("optional string tags"), "{proto}");
    }

    #[test]
    fn test_generated_schema_uses_valid_unique_identifiers() {
        let value: Value =
            serde_json::from_str(r#"{"123-name":"x","fooBar":1,"foo_bar":2,"package":true}"#)
                .unwrap();
        let proto = gen_protobuf(&value, "123-model");
        assert!(proto.contains("message Generated123Model"), "{proto}");
        assert!(proto.contains("string field_123_name"), "{proto}");
        assert!(proto.contains("int64 foo_bar ="), "{proto}");
        assert!(proto.contains("int64 foo_bar_2 ="), "{proto}");
        assert!(proto.contains("bool field_package"), "{proto}");
        assert!(
            parse_code_to_json_ast(&proto, "protobuf").is_ok(),
            "{proto}"
        );

        let thrift = gen_thrift(&value, "123-model");
        assert!(thrift.contains("struct Generated123Model"), "{thrift}");
        assert!(thrift.contains("field_123_name"), "{thrift}");
        assert!(
            parse_code_to_json_ast(&thrift, "thrift").is_ok(),
            "{thrift}"
        );
    }

    #[test]
    fn test_protobuf_and_thrift_generated_from_json_can_be_read_back() {
        let json = r#"{"name":"Ada","tags":["math"],"profile":{"active":true}}"#;
        for language in ["protobuf", "thrift"] {
            let generated = json_to_code(json, language, "User").unwrap();
            let restored: Value =
                serde_json::from_str(&code_to_json(&generated, language).unwrap()).unwrap();
            assert!(
                restored["User"].as_object().is_some(),
                "{language}: {restored}"
            );
            assert!(
                restored["Profile"].as_object().is_some(),
                "{language}: {restored}"
            );
            assert_eq!(
                restored["User"]["tags"],
                Value::Array(Vec::new()),
                "{language}: {restored}"
            );
            assert_eq!(
                restored["Profile"]["active"],
                Value::Bool(false),
                "{language}: {restored}"
            );
        }
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
        assert!(
            proto.contains("optional"),
            "Null field should be optional in protobuf.\n{}",
            proto
        );
        assert!(
            proto.contains("string name"),
            "Proto should have name field.\n{}",
            proto
        );
    }

    #[test]
    fn test_null_field_thrift() {
        let json = r#"{"name":"test","data":null}"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let thrift = gen_thrift(&value, "Item");
        assert!(
            thrift.contains("optional"),
            "Null field should be optional in thrift.\n{}",
            thrift
        );
        assert!(
            thrift.contains("required string name"),
            "Thrift:\n{}",
            thrift
        );
    }

    // ========== 11. Protobuf/Thrift wrapper message ==========

    #[test]
    fn test_protobuf_wrapper_message() {
        let json = r#"[{"name":"test"}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let proto = gen_protobuf(&value, "MyModel");
        assert!(
            proto.contains("message MyModel {"),
            "Proto wrapper:\n{}",
            proto
        );
        assert!(
            proto.contains("repeated MyModelItem"),
            "Proto repeated:\n{}",
            proto
        );
        assert!(
            proto.contains("message MyModelItem {"),
            "Proto item:\n{}",
            proto
        );
    }

    #[test]
    fn test_thrift_wrapper_struct() {
        let json = r#"[{"name":"test"}]"#;
        let value: Value = serde_json::from_str(json).unwrap();
        let thrift = gen_thrift(&value, "MyModel");
        assert!(
            thrift.contains("struct MyModel {"),
            "Thrift wrapper:\n{}",
            thrift
        );
        assert!(
            thrift.contains("list<MyModelItem>"),
            "Thrift list:\n{}",
            thrift
        );
        assert!(
            thrift.contains("struct MyModelItem {"),
            "Thrift item:\n{}",
            thrift
        );
    }

    // ========== 12. Tree-sitter reverse parser preserves original field names ==========

    #[test]
    fn test_protobuf_preserves_snake_case_fields() {
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
        let result = parse_code_to_json_ast(proto, "protobuf").unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("MyModel"));
        assert!(obj.contains_key("PolicyQueryParam"));
        let my_model = obj["MyModel"].as_object().unwrap();
        assert!(
            my_model.contains_key("email_title"),
            "got {:?}",
            my_model.keys().collect::<Vec<_>>()
        );
        assert!(my_model.contains_key("broker_id"));
        assert!(my_model.contains_key("policy_query_param"));
    }

    #[test]
    fn test_rust_preserves_snake_case_fields() {
        let rust_code = r#"
struct MyModel {
    email_title: String,
    broker_id: i64,
}
"#;
        let result = parse_code_to_json_ast(rust_code, "rust").unwrap();
        let obj = result.as_object().unwrap();
        assert!(
            obj.contains_key("email_title"),
            "got {:?}",
            obj.keys().collect::<Vec<_>>()
        );
        assert!(obj.contains_key("broker_id"));
    }

    #[test]
    fn test_go_uses_json_tag_value() {
        let go_code = r#"
type MyModel struct {
    EmailTitle string `json:"email_title"`
    BrokerId   int64  `json:"broker_id"`
}
"#;
        let result = parse_code_to_json_ast(go_code, "go").unwrap();
        let obj = result.as_object().unwrap();
        assert!(
            obj.contains_key("email_title"),
            "got {:?}",
            obj.keys().collect::<Vec<_>>()
        );
        assert!(obj.contains_key("broker_id"));
    }

    #[test]
    fn test_typescript_preserves_camel_case_fields() {
        let ts_code = r#"
interface MyModel {
    emailTitle: string;
    brokerId: number;
}
"#;
        let result = parse_code_to_json_ast(ts_code, "typescript").unwrap();
        let obj = result.as_object().unwrap();
        assert!(
            obj.contains_key("emailTitle"),
            "got {:?}",
            obj.keys().collect::<Vec<_>>()
        );
        assert!(obj.contains_key("brokerId"));
    }

    #[test]
    fn test_reverse_parser_javascript_object_literal() {
        let javascript = r#"
const User = {
    name: "Alice",
    age: 30,
    tags: ['admin', 'editor',],
};
"#;
        let result = parse_code_to_json_ast(javascript, "javascript").unwrap();
        assert_eq!(result["name"], "Alice");
        assert_eq!(result["age"], 30);
        assert_eq!(result["tags"][0], "admin");
        assert_eq!(result["tags"][1], "editor");
    }

    /// Helper: assert that a JSON value has a field with the expected type.
    /// `field` must exist and its value must match `expected`.
    fn assert_field(value: &Value, field: &str, expected: &Value, language: &str) {
        let obj = value
            .as_object()
            .unwrap_or_else(|| panic!("{language}: result is not an object: {value:?}"));
        let actual = obj.get(field).unwrap_or_else(|| {
            panic!(
                "{language}: missing field \"{field}\", got keys: {:?}",
                obj.keys().collect::<Vec<_>>()
            )
        });
        assert_eq!(
            actual, expected,
            "{language}: field \"{field}\" expected {expected} but got {actual:?}"
        );
    }

    /// Verify that a String-type field resolves to an empty string.
    fn assert_string_field(value: &Value, field: &str, language: &str) {
        assert_field(value, field, &Value::String(String::new()), language);
    }

    /// Verify that an integer-type field resolves to 0.
    fn assert_int_field(value: &Value, field: &str, language: &str) {
        assert_field(value, field, &Value::Number(0.into()), language);
    }

    /// Verify that a boolean-type field resolves to false.
    fn assert_bool_field(value: &Value, field: &str, language: &str) {
        assert_field(value, field, &Value::Bool(false), language);
    }

    #[test]
    fn test_all_languages_parse_string_int_bool_types() {
        // Each sample defines a structure with three fields:
        //   - a String-type field  -> expected JSON value ""
        //   - an integer-type field -> expected JSON value 0
        //   - a boolean-type field  -> expected JSON value false
        //
        // The field names vary so they match each language's idioms,
        // but the type-to-value mapping is always the same.
        // If a language cannot express all three types in one struct,
        // we still test what it can express.

        // --- Kotlin ---
        {
            let src = "data class User(val name: String, val age: Int, val active: Boolean)";
            let r = parse_code_to_json_ast(src, "kotlin").unwrap();
            assert_string_field(&r, "name", "kotlin");
            assert_int_field(&r, "age", "kotlin");
            assert_bool_field(&r, "active", "kotlin");
        }

        // --- Rust ---
        {
            let src = "pub struct User { pub name: String, pub age: i64, pub active: bool }";
            let r = parse_code_to_json_ast(src, "rust").unwrap();
            assert_string_field(&r, "name", "rust");
            assert_int_field(&r, "age", "rust");
            assert_bool_field(&r, "active", "rust");
        }

        // --- Go ---
        {
            let src = "type User struct { Name string; Age int; Active bool }";
            let r = parse_code_to_json_ast(src, "go").unwrap();
            assert_string_field(&r, "Name", "go");
            assert_int_field(&r, "Age", "go");
            assert_bool_field(&r, "Active", "go");
        }

        // --- Go with json tags ---
        {
            let src = "type User struct { Name string `json:\"name\"`; Age int `json:\"age\"`; Active bool `json:\"active\"` }";
            let r = parse_code_to_json_ast(src, "go").unwrap();
            assert_string_field(&r, "name", "go(json-tag)");
            assert_int_field(&r, "age", "go(json-tag)");
            assert_bool_field(&r, "active", "go(json-tag)");
        }

        // --- Java ---
        {
            let src = "public class User { private String name; private int age; private boolean active; }";
            let r = parse_code_to_json_ast(src, "java").unwrap();
            assert_string_field(&r, "name", "java");
            assert_int_field(&r, "age", "java");
            assert_bool_field(&r, "active", "java");
        }

        // --- TypeScript ---
        {
            let src = "interface User { name: string; age: number; active: boolean; }";
            let r = parse_code_to_json_ast(src, "typescript").unwrap();
            assert_string_field(&r, "name", "typescript");
            assert_int_field(&r, "age", "typescript");
            assert_bool_field(&r, "active", "typescript");
        }

        // --- Python ---
        {
            let src = "class User:\n    name: str\n    age: int\n    active: bool";
            let r = parse_code_to_json_ast(src, "python").unwrap();
            assert_string_field(&r, "name", "python");
            assert_int_field(&r, "age", "python");
            assert_bool_field(&r, "active", "python");
        }

        // --- Swift ---
        {
            let src = "struct User { let name: String; let age: Int; let active: Bool }";
            let r = parse_code_to_json_ast(src, "swift").unwrap();
            assert_string_field(&r, "name", "swift");
            assert_int_field(&r, "age", "swift");
            assert_bool_field(&r, "active", "swift");
        }

        // --- C# ---
        {
            let src =
                "public class User { public string Name; public int Age; public bool Active; }";
            let r = parse_code_to_json_ast(src, "csharp").unwrap();
            assert_string_field(&r, "Name", "csharp");
            assert_int_field(&r, "Age", "csharp");
            assert_bool_field(&r, "Active", "csharp");
        }

        // --- C++ ---
        {
            let src = "struct User { std::string name; int age; bool active; };";
            let r = parse_code_to_json_ast(src, "cpp").unwrap();
            assert_string_field(&r, "name", "cpp");
            assert_int_field(&r, "age", "cpp");
            assert_bool_field(&r, "active", "cpp");
        }

        // --- Protobuf ---
        {
            let src = "syntax = \"proto3\";\nmessage User { string name = 1; int32 age = 2; bool active = 3; }";
            let r = parse_code_to_json_ast(src, "protobuf").unwrap();
            // Single message: fields at top level
            assert_string_field(&r, "name", "protobuf");
            assert_int_field(&r, "age", "protobuf");
            assert_bool_field(&r, "active", "protobuf");
        }

        // --- Thrift ---
        {
            let src = "struct User { 1: string name, 2: i32 age, 3: bool active }";
            let r = parse_code_to_json_ast(src, "thrift").unwrap();
            assert_string_field(&r, "name", "thrift");
            assert_int_field(&r, "age", "thrift");
            assert_bool_field(&r, "active", "thrift");
        }

        // --- Scala ---
        {
            let src = "case class User(name: String, age: Int, active: Boolean)";
            let r = parse_code_to_json_ast(src, "scala").unwrap();
            assert_string_field(&r, "name", "scala");
            assert_int_field(&r, "age", "scala");
            assert_bool_field(&r, "active", "scala");
        }

        // --- Dart ---
        {
            let src = "class User { final String name; final int age; final bool active; User(this.name, this.age, this.active); }";
            let r = parse_code_to_json_ast(src, "dart").unwrap();
            assert_string_field(&r, "name", "dart");
            assert_int_field(&r, "age", "dart");
            assert_bool_field(&r, "active", "dart");
        }

        // --- Ruby ---
        {
            let src = "class User\n  attr_accessor :name\n  attr_accessor :age\n  attr_accessor :active\nend";
            let r = parse_code_to_json_ast(src, "ruby").unwrap();
            // Ruby attr_accessor fields have no type info, so they resolve to null.
            let obj = r.as_object().unwrap();
            assert!(
                obj.contains_key("name"),
                "ruby: missing name, got {:?}",
                obj.keys().collect::<Vec<_>>()
            );
            assert!(obj.contains_key("age"), "ruby: missing age");
            assert!(obj.contains_key("active"), "ruby: missing active");
            assert_eq!(
                obj["name"],
                Value::Null,
                "ruby: attr_accessor should be null"
            );
        }

        // --- PHP ---
        {
            let src = "<?php\nclass User {\n  public string $name;\n  public int $age;\n  public bool $active;\n}";
            let r = parse_code_to_json_ast(src, "php").unwrap();
            assert_string_field(&r, "name", "php");
            assert_int_field(&r, "age", "php");
            assert_bool_field(&r, "active", "php");
        }

        // --- Objective-C ---
        {
            let src = "@interface User : NSObject\n@property NSString *name;\n@property NSInteger age;\n@property BOOL active;\n@end";
            let r = parse_code_to_json_ast(src, "objectivec").unwrap();
            assert_string_field(&r, "name", "objectivec");
            assert_int_field(&r, "age", "objectivec");
            assert_bool_field(&r, "active", "objectivec");
        }

        // --- JavaScript (class) ---
        {
            let src = "class User {\n  constructor() {\n    this.name = \"\";\n    this.age = 0;\n    this.active = false;\n  }\n}";
            let r = parse_code_to_json_ast(src, "javascript").unwrap();
            assert_string_field(&r, "name", "javascript");
            assert_int_field(&r, "age", "javascript");
            assert_bool_field(&r, "active", "javascript");
        }
    }

    #[test]
    fn test_all_languages_parse_successfully() {
        // Smoke test: every supported language parses without error.
        let samples = [
            (
                "protobuf",
                "syntax = \"proto3\";\nmessage User {\n string name = 1;\n}",
            ),
            (
                "thrift",
                "namespace js demo\nstruct User {\n 1: string name\n}",
            ),
            (
                "objectivec",
                "@interface User : NSObject\n@property NSString *name;\n@end",
            ),
            ("scala", "case class User(name: String)"),
            ("kotlin", "data class User(val name: String)"),
            (
                "rust",
                "#[derive(Debug)]\npub struct User { pub name: String }",
            ),
            ("go", "type User struct { Name string }"),
            ("swift", "struct User {\n let name: String\n}"),
            (
                "csharp",
                "namespace Demo { public class User { public string Name { get; set; } } }",
            ),
            ("dart", "class User { final String name; User(this.name); }"),
            ("php", "<?php class User { public string $name; }"),
            ("ruby", "class User\n attr_accessor :name\nend"),
            (
                "cpp",
                "#include <string>\nstruct User {\n std::string name;\n};",
            ),
            (
                "python",
                "class User:\n name: str\n def __init__(self): self.name = \"\"",
            ),
            ("typescript", "interface User { name: string; }"),
            (
                "javascript",
                "class User {\n constructor(name) {\n  this.name = name;\n }\n}",
            ),
            ("java", "public class User { private String name; }"),
        ];

        let failures: Vec<_> = samples
            .iter()
            .filter_map(|(language, source)| {
                parse_code_to_json_ast(source, language)
                    .err()
                    .map(|error| (*language, error))
            })
            .collect();
        assert!(failures.is_empty(), "reverse parser failures: {failures:?}");
    }
}

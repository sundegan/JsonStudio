use serde_json::{Map, Value};
use tree_sitter_language_pack::{get_parser, Node};

pub fn parse_code_to_json_ast(content: &str, language: &str) -> Result<Value, String> {
    let grammar = grammar_name(language)
        .ok_or_else(|| format!("Tree-sitter grammar is not bundled for {language}"))?;
    let mut parser = get_parser(grammar)
        .map_err(|error| format!("Tree-sitter failed to load {grammar}: {error}"))?;
    let tree = parser
        .parse(content)
        .ok_or_else(|| format!("Tree-sitter failed to parse {language} source"))?;
    let root = tree.root_node();
    if contains_error_node(&root) {
        return Err(format!(
            "Tree-sitter found syntax errors in {language} source"
        ));
    }

    if language == "javascript" {
        if let Some(value) = parse_javascript_quicktype_type_map(&root, content) {
            return Ok(value);
        }
    }

    if matches!(language, "javascript" | "typescript") {
        if let Some(value) = find_object_literal(&root, content) {
            return Ok(value);
        }
    }

    extract_declarations(&root, content, language)
}

fn grammar_name(language: &str) -> Option<&'static str> {
    match language {
        "typescript" => Some("typescript"),
        "kotlin" => Some("kotlin"),
        "javascript" => Some("javascript"),
        "java" => Some("java"),
        "go" => Some("go"),
        "rust" => Some("rust"),
        "python" => Some("python"),
        "swift" => Some("swift"),
        "csharp" => Some("csharp"),
        "dart" => Some("dart"),
        "php" => Some("php"),
        "ruby" => Some("ruby"),
        "scala" => Some("scala"),
        "cpp" => Some("cpp"),
        "objectivec" => Some("objc"),
        "protobuf" => Some("proto"),
        "thrift" => Some("thrift"),
        _ => None,
    }
}

fn find_object_literal(node: &Node, source: &str) -> Option<Value> {
    if node.kind() == "object" && is_variable_initializer_object(node) {
        return Some(parse_object_node(node, source));
    }
    for index in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(index) {
            if let Some(value) = find_object_literal(&child, source) {
                return Some(value);
            }
        }
    }
    None
}

fn is_variable_initializer_object(node: &Node) -> bool {
    let mut current = node.clone();
    while let Some(parent) = current.parent() {
        let kind = parent.kind();
        if kind == "variable_declarator" {
            return true;
        }
        if matches!(
            kind.as_str(),
            "class_declaration"
                | "class_definition"
                | "class_body"
                | "method_definition"
                | "function_declaration"
                | "function_definition"
                | "arrow_function"
        ) {
            return false;
        }
        current = parent;
    }
    false
}

fn parse_object_node(node: &Node, source: &str) -> Value {
    let mut object = Map::new();
    for index in 0..node.named_child_count() as u32 {
        let Some(child) = node.named_child(index) else {
            continue;
        };
        let kind = child.kind();
        if !matches!(
            kind.as_str(),
            "pair" | "property" | "shorthand_property_identifier_pattern"
        ) {
            continue;
        }
        let Some(key) = child
            .child_by_field_name("key")
            .or_else(|| child.child_by_field_name("name"))
            .or_else(|| child.named_child(0))
        else {
            continue;
        };
        let key_text = node_text(&key, source)
            .trim_matches(|ch| ch == '\'' || ch == '"' || ch == '`')
            .to_string();
        if key_text.is_empty() {
            continue;
        }
        let value_node = child
            .child_by_field_name("value")
            .or_else(|| child.named_child(1));
        let value = value_node
            .and_then(|value| parse_literal_node(&value, source))
            .unwrap_or(Value::Null);
        object.insert(key_text, value);
    }
    Value::Object(object)
}

/// Quicktype's JavaScript renderer emits type metadata as a `typeMap` object
/// instead of classes or interfaces. Read that object structurally so a
/// JSON-to-JavaScript result can be converted back without accidentally
/// selecting an unrelated runtime object literal from a helper function.
fn parse_javascript_quicktype_type_map(root: &Node, source: &str) -> Option<Value> {
    let declaration = find_variable_declarator(root, source, "typeMap")?;
    let type_map = declaration.child_by_field_name("value")?;
    if type_map.kind() != "object" {
        return None;
    }

    let mut declarations = Map::new();
    for index in 0..type_map.named_child_count() as u32 {
        let pair = type_map.named_child(index)?;
        if pair.kind() != "pair" {
            continue;
        }
        let key = pair
            .child_by_field_name("key")
            .or_else(|| pair.named_child(0))?;
        let name = node_text(&key, source)
            .trim()
            .trim_matches(|ch| ch == '\'' || ch == '"')
            .to_string();
        let definition = pair
            .child_by_field_name("value")
            .or_else(|| pair.named_child(1))?;
        if let Some(fields) = parse_quicktype_object_definition(&definition, source) {
            declarations.insert(name, Value::Object(fields));
        }
    }

    match declarations.len() {
        0 => None,
        1 => Some(declarations.into_iter().next()?.1),
        _ => Some(Value::Object(declarations)),
    }
}

fn find_variable_declarator(node: &Node, source: &str, expected_name: &str) -> Option<Node> {
    if node.kind() == "variable_declarator"
        && node
            .child_by_field_name("name")
            .is_some_and(|name| node_text(&name, source) == expected_name)
    {
        return Some(node.clone());
    }
    for index in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(index) {
            if let Some(found) = find_variable_declarator(&child, source, expected_name) {
                return Some(found);
            }
        }
    }
    None
}

fn parse_quicktype_object_definition(node: &Node, source: &str) -> Option<Map<String, Value>> {
    if node.kind() != "call_expression" || call_name(node, source)? != "o" {
        return None;
    }
    let properties = call_arguments(node)?.named_child(0)?;
    if properties.kind() != "array" {
        return None;
    }

    let mut fields = Map::new();
    for index in 0..properties.named_child_count() as u32 {
        let property = properties.named_child(index)?;
        if property.kind() != "object" {
            continue;
        }
        let json_key = object_property_value(&property, source, "json")
            .and_then(|node| parse_literal_node(&node, source))
            .and_then(|value| value.as_str().map(str::to_string))?;
        let typ = object_property_value(&property, source, "typ")?;
        fields.insert(json_key, default_value_for_quicktype_type(&typ, source));
    }
    Some(fields)
}

fn call_name<'a>(node: &Node, source: &'a str) -> Option<&'a str> {
    let function = node
        .child_by_field_name("function")
        .or_else(|| node.child_by_field_name("callee"))
        .or_else(|| node.named_child(0))?;
    Some(node_text(&function, source))
}

fn call_arguments(node: &Node) -> Option<Node> {
    node.child_by_field_name("arguments").or_else(|| {
        (0..node.named_child_count() as u32)
            .filter_map(|index| node.named_child(index))
            .find(|child| matches!(child.kind().as_str(), "arguments" | "argument_list"))
    })
}

fn object_property_value(object: &Node, source: &str, expected_key: &str) -> Option<Node> {
    for index in 0..object.named_child_count() as u32 {
        let pair = object.named_child(index)?;
        if pair.kind() != "pair" {
            continue;
        }
        let key = pair
            .child_by_field_name("key")
            .or_else(|| pair.named_child(0))?;
        if node_text(&key, source).trim_matches(|ch| ch == '\'' || ch == '"') == expected_key {
            return pair
                .child_by_field_name("value")
                .or_else(|| pair.named_child(1));
        }
    }
    None
}

fn default_value_for_quicktype_type(node: &Node, source: &str) -> Value {
    if let Some(value) = parse_literal_node(node, source) {
        return value;
    }
    if node.kind() != "call_expression" {
        return Value::Null;
    }
    match call_name(node, source) {
        Some("a") => Value::Array(Vec::new()),
        Some("m") | Some("r") => Value::Object(Map::new()),
        // `u(...)` represents a union. A single default JSON sample cannot
        // safely choose one of its members, so retain the nullable shape.
        Some("u") => Value::Null,
        _ => Value::Null,
    }
}

fn parse_literal_node(node: &Node, source: &str) -> Option<Value> {
    let kind = node.kind();
    let text = node_text(node, source).trim();
    match kind.as_str() {
        "string" => json5::from_str::<String>(text)
            .ok()
            .map(Value::String)
            .or_else(|| {
                Some(Value::String(
                    text.trim_matches(|ch| ch == '\'' || ch == '"').to_string(),
                ))
            }),
        "string_fragment" | "template_string" => Some(Value::String(
            text.trim_matches(|ch| ch == '\'' || ch == '"' || ch == '`')
                .to_string(),
        )),
        "true" => Some(Value::Bool(true)),
        "false" => Some(Value::Bool(false)),
        "null" | "undefined" => Some(Value::Null),
        "number" | "integer" | "float" => serde_json::from_str(text).ok(),
        "object" => Some(parse_object_node(node, source)),
        "array" => {
            let mut values = Vec::new();
            for index in 0..node.named_child_count() as u32 {
                let child = node.named_child(index)?;
                values.push(parse_literal_node(&child, source).unwrap_or(Value::Null));
            }
            Some(Value::Array(values))
        }
        _ => None,
    }
}

fn extract_declarations(node: &Node, source: &str, language: &str) -> Result<Value, String> {
    let mut declarations = Map::new();
    collect_declarations(node, source, language, &mut declarations);
    if declarations.is_empty() {
        return Err(format!(
            "Tree-sitter found no data structure in {language} source"
        ));
    }
    if declarations.len() == 1 {
        Ok(declarations.into_iter().next().expect("one declaration").1)
    } else {
        Ok(Value::Object(declarations))
    }
}

fn collect_declarations(
    node: &Node,
    source: &str,
    language: &str,
    output: &mut Map<String, Value>,
) {
    let kind = node.kind();
    if is_declaration_kind(&kind) {
        if let Some(name) = declaration_name(node, source) {
            let fields = collect_fields(node, source, language);
            if !fields.is_empty() {
                output.insert(name, Value::Object(fields));
                return;
            }
        }
    }
    for index in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(index) {
            collect_declarations(&child, source, language, output);
        }
    }
}

fn is_declaration_kind(kind: &str) -> bool {
    let exact = matches!(
        kind,
        "class_declaration"
            | "class_definition"
            | "struct_item"
            | "struct_declaration"
            | "interface_declaration"
            | "type_alias_declaration"
            | "type_declaration"
            | "message"
            | "struct"
            | "data_type"
            | "record_declaration"
            | "enum_declaration"
            | "class"
            | "interface"
            | "struct_specifier"
            | "type_spec"
            | "struct_definition"
            | "class_interface"
            | "class_def"
            | "class_specifier"
    );
    exact
}

fn declaration_name(node: &Node, source: &str) -> Option<String> {
    let name = node
        .child_by_field_name("name")
        .or_else(|| node.child_by_field_name("type"))
        .or_else(|| first_identifier_node(node))?;
    let name = if matches!(name.kind().as_str(), "message_name" | "variable_declarator") {
        name.child_by_field_name("name")
            .or_else(|| name.named_child(0))?
    } else {
        name
    };
    let text = node_text(&name, source).trim();
    (!text.is_empty()).then(|| text.to_string())
}

fn first_identifier_node(node: &Node) -> Option<Node> {
    for index in 0..node.named_child_count() as u32 {
        let child = node.named_child(index)?;
        if is_identifier_kind(&child.kind()) {
            return Some(child);
        }
        if let Some(found) = first_identifier_node(&child) {
            return Some(found);
        }
    }
    None
}

fn last_identifier_node(node: &Node) -> Option<Node> {
    let mut found = None;
    for index in 0..node.named_child_count() as u32 {
        let child = node.named_child(index)?;
        if is_identifier_kind(&child.kind()) {
            found = Some(child.clone());
        }
        if let Some(nested) = last_identifier_node(&child) {
            found = Some(nested);
        }
    }
    found
}

fn is_identifier_kind(kind: &str) -> bool {
    matches!(
        kind,
        "identifier"
            | "type_identifier"
            | "field_identifier"
            | "property_identifier"
            | "simple_identifier"
            | "lower_case_identifier"
            | "upper_case_identifier"
            | "variable"
            | "field_name"
            | "name"
            | "constant"
            | "constructor"
            | "symbol"
            | "simple_symbol"
    )
}

fn contains_error_node(node: &Node) -> bool {
    if node.is_error() {
        return true;
    }
    // Only ERROR nodes are fatal. MISSING nodes may still leave the
    // structural declarations intact, so extraction can proceed.
    for index in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(index) {
            if contains_error_node(&child) {
                return true;
            }
        }
    }
    false
}

fn collect_fields(node: &Node, source: &str, language: &str) -> Map<String, Value> {
    let mut fields = Map::new();
    for index in 0..node.named_child_count() as u32 {
        let Some(child) = node.named_child(index) else {
            continue;
        };
        let kind = child.kind();
        if is_field_kind(&kind, language) {
            if let Some((name, value)) = field_from_node(&child, source, language) {
                fields.insert(name, value);
                continue;
            }
        }
        // Some grammars wrap fields in a body/declaration list. Recurse only
        // through structural containers to avoid treating nested methods as fields.
        if is_field_container(&kind) && should_descend_into_container(node.kind().as_str(), &kind) {
            merge_fields(&mut fields, collect_fields(&child, source, language));
        }
    }
    fields
}

fn is_field_kind(kind: &str, language: &str) -> bool {
    // Exclude container kinds that happen to contain "field" or "parameter"
    // in their name (e.g. field_declaration_list, class_parameters) — those
    // are handled by is_field_container.
    if matches!(
        kind,
        "field_declaration_list"
            | "field_declaration_list_body"
            | "class_parameters"
            | "formal_parameters"
            | "formal_parameter_list"
            | "parameter_list"
            | "parameters"
            | "arguments"
            | "argument_list"
            | "fields"
    ) {
        return false;
    }
    if kind.contains("field") || kind.contains("property") || kind.contains("parameter") {
        return true;
    }
    matches!(
        (language, kind),
        ("go", "field_declaration")
            | ("rust", "field_declaration")
            | ("python", "typed_parameter")
            | ("protobuf", "field")
            | ("thrift", "field")
            | ("python", "assignment")
            | ("dart", "declaration")
            | ("ruby", "call")
            | ("javascript", "assignment_expression")
    )
}

fn is_field_container(kind: &str) -> bool {
    matches!(
        kind,
        "field_declaration_list"
            | "declaration_list"
            | "body"
            | "block"
            | "class_body"
            | "interface_body"
            | "type_body"
            | "struct_type"
            | "struct_body"
            | "field_declaration"
            | "tuple_type"
            | "message_body"
            | "type_expression"
            | "record_type"
            | "constructors"
            | "data_constructor"
            | "data_constructors"
            | "record"
            | "fields"
            | "primary_constructor"
            | "body_statement"
            | "do_block"
            | "method_definition"
            | "statement_block"
            | "expression_statement"
            | "initialized_identifier_list"
            | "class_parameters"
            | "formal_parameters"
            | "parameters"
            | "formal_parameter_list"
            | "object_type"
    )
}

fn should_descend_into_container(parent_kind: &str, container_kind: &str) -> bool {
    if matches!(
        container_kind,
        "formal_parameters" | "parameters" | "formal_parameter_list"
    ) {
        return matches!(parent_kind, "record_declaration" | "primary_constructor");
    }
    true
}

fn find_variable_declaration_type(node: &Node) -> Option<Node> {
    if node.kind() == "variable_declaration" {
        return node.child_by_field_name("type");
    }
    for i in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(i) {
            if let Some(found) = find_variable_declaration_type(&child) {
                return Some(found);
            }
        }
    }
    None
}

fn field_from_node(node: &Node, source: &str, language: &str) -> Option<(String, Value)> {
    let name_node = node
        .child_by_field_name("name")
        .or_else(|| node.child_by_field_name("declarator"))
        .or_else(|| node.child_by_field_name("key"))
        .or_else(|| node.child_by_field_name("left"))
        .or_else(|| {
            if language == "csharp" && node.kind() == "field_declaration" {
                find_variable_declarator_identifier(node)
            } else if node.kind() == "property_declaration" {
                // Objective-C property_declaration wraps the field name deep
                // inside struct_declarator > pointer_declarator.
                find_declarator_identifier(node).or_else(|| last_identifier_node(node))
            } else if node.kind() == "field" {
                // Protobuf/thrift field: the type may itself be a named type,
                // so the first identifier can be the type rather than the
                // field. The field name is the last identifier in the node.
                last_identifier_node(node)
            } else {
                // Dart wraps field names inside initialized_identifier_list.
                // Skip type_identifier nodes that precede the actual field name.
                for i in 0..node.named_child_count() as u32 {
                    if let Some(child) = node.named_child(i) {
                        if child.kind() == "initialized_identifier_list" {
                            if let Some(name) = first_identifier_node(&child) {
                                return Some(name);
                            }
                        }
                    }
                }
                first_identifier_node(node)
            }
        })?;
    let name_node = if matches!(
        name_node.kind().as_str(),
        "variable_declarator" | "type_annotation"
    ) {
        name_node
            .child_by_field_name("name")
            .or_else(|| name_node.named_child(0))?
    } else if name_node.kind() == "type" {
        node.named_child(1).or_else(|| node.named_child(0))?
    } else {
        name_node
    };
    // JavaScript `this.name = value` — extract just the property name.
    let name = if name_node.kind() == "member_expression" {
        name_node
            .child_by_field_name("property")
            .or_else(|| last_identifier_node(&name_node))
            .map(|property| node_text(&property, source).trim().to_string())
            .unwrap_or_else(|| node_text(&name_node, source).trim().to_string())
    } else {
        node_text(&name_node, source)
            .trim()
            .trim_start_matches(|ch: char| !ch.is_ascii_alphabetic() && ch != '_')
            .to_string()
    };
    if name.is_empty() || !name.chars().next()?.is_ascii_alphabetic() && !name.starts_with('_') {
        return None;
    }
    // In the protobuf grammar, `repeated` is an anonymous child of `field`,
    // so it is not included in the type node below. Preserve its collection
    // semantics before inferring the scalar element default.
    if language == "protobuf" && has_direct_child_text(node, source, "repeated") {
        return Some((name, Value::Array(Vec::new())));
    }
    let has_schema_optional_modifier = matches!(language, "protobuf" | "thrift")
        && has_direct_child_text(node, source, "optional");
    let has_typescript_optional_modifier =
        language == "typescript" && has_direct_child_text(node, source, "?");
    if has_schema_optional_modifier || has_typescript_optional_modifier {
        return Some((name, Value::Null));
    }
    let type_node = node
        .child_by_field_name("type")
        .or_else(|| node.child_by_field_name("type_annotation"))
        .or_else(|| node.child_by_field_name("field_type"))
        .or_else(|| node.child_by_field_name("typeExpression"))
        .or_else(|| node.child_by_field_name("type_declaration"))
        .or_else(|| {
            if language == "csharp" && node.kind() == "field_declaration" {
                find_variable_declaration_type(node)
            } else {
                None
            }
        })
        .or_else(|| {
            // Fallback: scan named children for a type-like node, skipping
            // the name node we already identified and non-type siblings
            // (e.g. Kotlin's `binding_pattern_kind` / `val`).
            for i in 0..node.named_child_count() as u32 {
                if let Some(child) = node.named_child(i) {
                    let kind = child.kind();
                    if matches!(
                        kind.as_str(),
                        "user_type"
                            | "type_identifier"
                            | "primitive_type"
                            | "generic_type"
                            | "generic_name"
                            | "type_arguments"
                            | "nullable_type"
                            | "built_in_type"
                            | "predefined_type"
                            | "type_annotation"
                            | "type"
                            | "struct_declaration"
                    ) {
                        return Some(child);
                    }
                }
            }
            // Last resort: the named child after the name node.
            node.named_child(1)
        });
    if matches!(node.kind().as_str(), "call" | "assignment_expression") {
        // Ruby attr_accessor :field_name — extract the symbol from arguments.
        if language == "ruby" {
            for i in 0..node.named_child_count() as u32 {
                if let Some(child) = node.named_child(i) {
                    if matches!(child.kind().as_str(), "argument_list" | "arguments") {
                        for j in 0..child.named_child_count() as u32 {
                            if let Some(arg) = child.named_child(j) {
                                // Ruby: simple_symbol :field_name
                                let arg_text = node_text(&arg, source).trim();
                                if let Some(symbol) = arg_text.strip_prefix(':') {
                                    if !symbol.is_empty() {
                                        return Some((symbol.to_string(), Value::Null));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Use the already-extracted name for member_expression (this.xxx).
        let name = if name_node.kind() == "member_expression" {
            name
        } else {
            node_text(&name_node, source)
                .trim_start_matches(':')
                .to_string()
        };
        // For assignment_expression, also try to extract the value.
        let value = if node.kind() == "assignment_expression" {
            node.child_by_field_name("right")
                .and_then(|v| parse_literal_node(&v, source))
                .unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        return Some((name, value));
    }
    // Go struct fields carry a json tag in a raw_string_literal child.
    // Extract the tag key when present so it matches the original field name
    // the API consumer expects, e.g. `json:"email_title"`.
    if language == "go" {
        for tag_index in 0..node.named_child_count() as u32 {
            if let Some(tag_node) = node.named_child(tag_index) {
                if tag_node.kind() == "raw_string_literal" {
                    let tag_text = node_text(&tag_node, source);
                    if let Some(json_key) = extract_go_json_tag_key(tag_text) {
                        let value = type_node
                            .as_ref()
                            .map(|type_node| default_value_for_type(node_text(type_node, source)))
                            .unwrap_or(Value::Null);
                        return Some((json_key, value));
                    }
                }
            }
        }
    }
    let value = type_node
        .map(|type_node| default_value_for_type(node_text(&type_node, source)))
        .unwrap_or(Value::Null);
    Some((name, value))
}

/// Parse a Go struct tag raw string and return the json key if present.
/// e.g. `` `json:"email_title"` `` -> `` email_title ``
fn extract_go_json_tag_key(tag: &str) -> Option<String> {
    // Tag looks like: `json:"email_title"` or `json:"email_title,omitempty"`
    let inner = tag.trim_matches('`');
    for entry in inner.split_whitespace() {
        if let Some(rest) = entry.strip_prefix("json:") {
            let key = rest.trim_matches('"').split(',').next().unwrap_or("");
            if !key.is_empty() && key != "-" {
                return Some(key.to_string());
            }
        }
    }
    None
}

/// Find the identifier inside declarator chains (pointer_declarator, struct_declarator).
/// Used for Objective-C property_declaration where the field name is nested deeply.
fn find_declarator_identifier(node: &Node) -> Option<Node> {
    for i in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(i) {
            if let Some(found) = find_declarator_identifier_recursive(&child) {
                return Some(found);
            }
        }
    }
    None
}

fn find_variable_declarator_identifier(node: &Node) -> Option<Node> {
    if node.kind() == "variable_declarator" {
        return node
            .child_by_field_name("name")
            .or_else(|| node.named_child(0));
    }
    for i in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(i) {
            if let Some(found) = find_variable_declarator_identifier(&child) {
                return Some(found);
            }
        }
    }
    None
}

fn find_declarator_identifier_recursive(node: &Node) -> Option<Node> {
    // If this node has a "declarator" field, follow it.
    if let Some(decl) = node.child_by_field_name("declarator") {
        if decl.kind() == "identifier" {
            return Some(decl);
        }
        return find_declarator_identifier_recursive(&decl);
    }
    // If this node is itself an identifier (but not a type_identifier), return it.
    if node.kind() == "identifier" {
        return Some(node.clone());
    }
    // Recurse into children.
    for i in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(i) {
            if let Some(found) = find_declarator_identifier_recursive(&child) {
                return Some(found);
            }
        }
    }
    None
}

fn merge_fields(target: &mut Map<String, Value>, source: Map<String, Value>) {
    for (key, value) in source {
        target.insert(key, value);
    }
}

fn default_value_for_type(type_text: &str) -> Value {
    let type_text = type_text.trim().trim_start_matches(':').trim();
    let lower = type_text.to_ascii_lowercase();
    let tokens: Vec<_> = lower
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect();
    let has_token = |names: &[&str]| tokens.iter().any(|token| names.contains(token));

    if has_token(&["optional", "option", "maybe"]) || lower.starts_with('?') || lower.ends_with('?')
    {
        return Value::Null;
    }
    if (lower.starts_with('[') && lower.ends_with(']') && !lower.contains(':'))
        || lower.contains("[]")
        || has_token(&[
            "array", "list", "vec", "slice", "set", "hashset", "vector", "sequence", "iterable",
        ])
    {
        return Value::Array(Vec::new());
    }
    if (lower.starts_with('[') && lower.ends_with(']') && lower.contains(':'))
        || has_token(&["map", "hashmap", "dict", "dictionary", "record", "object"])
    {
        return Value::Object(Map::new());
    }
    if has_token(&["bool", "boolean"]) {
        Value::Bool(false)
    } else if has_token(&[
        "int",
        "integer",
        "long",
        "short",
        "float",
        "double",
        "number",
        "decimal",
        "byte",
        "sbyte",
        "bigint",
        "i8",
        "i16",
        "i32",
        "i64",
        "isize",
        "u8",
        "u16",
        "u32",
        "u64",
        "usize",
        "f32",
        "f64",
        "int8",
        "int16",
        "int32",
        "int64",
        "uint",
        "uint8",
        "uint16",
        "uint32",
        "uint64",
        "nsinteger",
        "cgfloat",
    ]) {
        Value::Number(0.into())
    } else if has_token(&[
        "string",
        "str",
        "char",
        "character",
        "text",
        "varchar",
        "uuid",
        "nsstring",
    ]) {
        Value::String(String::new())
    } else {
        Value::Object(Map::new())
    }
}

fn has_direct_child_text(node: &Node, source: &str, expected: &str) -> bool {
    (0..node.child_count() as u32).any(|index| {
        node.child(index)
            .is_some_and(|child| node_text(&child, source).trim() == expected)
    })
}

fn node_text<'a>(node: &Node, source: &'a str) -> &'a str {
    source.get(node.start_byte()..node.end_byte()).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_values_do_not_match_substrings_in_custom_type_names() {
        assert_eq!(default_value_for_type("Point"), Value::Object(Map::new()));
        assert_eq!(
            default_value_for_type("StringValue"),
            Value::Object(Map::new())
        );
        assert_eq!(default_value_for_type("[String]"), Value::Array(Vec::new()));
        assert_eq!(
            default_value_for_type("[String: Int]"),
            Value::Object(Map::new())
        );
        assert_eq!(
            default_value_for_type("HashMap<String, Int>"),
            Value::Object(Map::new())
        );
        assert_eq!(
            default_value_for_type("std::vector<std::string>"),
            Value::Array(Vec::new())
        );
    }

    #[test]
    fn protobuf_repeated_fields_are_arrays() {
        let result = parse_code_to_json_ast(
            "syntax = \"proto3\"; message User { repeated string tags = 1; }",
            "protobuf",
        )
        .unwrap();
        assert_eq!(result["tags"], Value::Array(Vec::new()));
    }

    #[test]
    fn optional_field_modifiers_are_null() {
        let cases = [
            (
                "protobuf",
                "syntax = \"proto3\"; message User { optional string nickname = 1; }",
            ),
            ("thrift", "struct User { 1: optional string nickname }"),
            ("typescript", "interface User { nickname?: string; }"),
            ("php", "<?php class User { public ?string $nickname; }"),
        ];

        for (language, source) in cases {
            let result = parse_code_to_json_ast(source, language).unwrap();
            assert_eq!(result["nickname"], Value::Null, "{language}: {result}");
        }
    }

    #[test]
    fn common_language_collections_and_custom_types_are_preserved() {
        let cases = [
            (
                "typescript",
                "interface User { tags: string[]; metadata: Record<string, number>; point: Point; }",
                serde_json::json!({"tags": [], "metadata": {}, "point": {}}),
            ),
            (
                "rust",
                "struct User { tags: Vec<String>, metadata: HashMap<String, i64>, point: Point }",
                serde_json::json!({"tags": [], "metadata": {}, "point": {}}),
            ),
            (
                "go",
                "type User struct { Tags []string; Metadata map[string]int; Point Point }",
                serde_json::json!({"Tags": [], "Metadata": {}, "Point": {}}),
            ),
            (
                "java",
                "class User { List<String> tags; Map<String, Integer> metadata; Point point; }",
                serde_json::json!({"tags": [], "metadata": {}, "point": {}}),
            ),
            (
                "kotlin",
                "data class User(val tags: List<String>, val metadata: Map<String, Int>, val point: Point)",
                serde_json::json!({"tags": [], "metadata": {}, "point": {}}),
            ),
            (
                "swift",
                "struct User { let tags: [String]; let metadata: [String: Int]; let point: Point }",
                serde_json::json!({"tags": [], "metadata": {}, "point": {}}),
            ),
            (
                "csharp",
                "class User { List<string> Tags; Dictionary<string, int> Metadata; Point Point; }",
                serde_json::json!({"Tags": [], "Metadata": {}, "Point": {}}),
            ),
            (
                "python",
                "class User:\n    tags: list[str]\n    metadata: dict[str, int]\n    point: Point",
                serde_json::json!({"tags": [], "metadata": {}, "point": {}}),
            ),
            (
                "scala",
                "case class User(tags: List[String], metadata: Map[String, Int], point: Point)",
                serde_json::json!({"tags": [], "metadata": {}, "point": {}}),
            ),
            (
                "cpp",
                "struct User { std::vector<std::string> tags; std::map<std::string, int> metadata; Point point; };",
                serde_json::json!({"tags": [], "metadata": {}, "point": {}}),
            ),
        ];

        for (language, source, expected) in cases {
            assert_eq!(
                parse_code_to_json_ast(source, language).unwrap(),
                expected,
                "{language}: {source}",
            );
        }
    }

    #[test]
    fn javascript_object_literal() {
        let result = parse_code_to_json_ast(
            "const User = { name: 'Alice', age: 30, tags: ['a', 'b'] };",
            "javascript",
        )
        .unwrap();
        assert_eq!(result["name"], "Alice");
        assert_eq!(result["age"], 30);
        assert_eq!(result["tags"][0], "a");
        assert_eq!(result["tags"][1], "b");
    }

    #[test]
    fn javascript_object_literal_skips_non_literal_properties() {
        let result = parse_code_to_json_ast(
            "const User = { name: 'Alice', ...defaults, getName() { return this.name; } };",
            "javascript",
        )
        .unwrap();
        assert_eq!(result["name"], "Alice");
        assert_eq!(result.as_object().unwrap().len(), 1);
    }

    #[test]
    fn javascript_quicktype_type_map_preserves_json_structure() {
        let source = r#"
            function jsonToJSProps() {
                const map = {};
                return map;
            }

            const typeMap = {
                "User": o([
                    { json: "userId", js: "userId", typ: 0 },
                    { json: "displayName", js: "displayName", typ: "" },
                    { json: "active", js: "active", typ: true },
                    { json: "tags", js: "tags", typ: a("") },
                    { json: "profile", js: "profile", typ: r("Profile") },
                ], false),
                "Profile": o([
                    { json: "score", js: "score", typ: 3.125 },
                ], false),
            };
        "#;

        assert_eq!(
            parse_code_to_json_ast(source, "javascript").unwrap(),
            serde_json::json!({
                "User": {
                    "userId": 0,
                    "displayName": "",
                    "active": true,
                    "tags": [],
                    "profile": {},
                },
                "Profile": { "score": 3.125 },
            }),
        );
    }

    #[test]
    fn go_json_tag_extracted() {
        let result =
            parse_code_to_json_ast("type User struct { Name string `json:\"name\"` }", "go")
                .unwrap();
        assert!(result.as_object().unwrap().contains_key("name"));
    }

    #[test]
    fn rust_struct_fields() {
        let result = parse_code_to_json_ast(
            "pub struct User { pub email_title: String, pub active: bool }",
            "rust",
        )
        .unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("email_title"));
        assert!(obj.contains_key("active"));
        assert_eq!(obj["active"], Value::Bool(false));
    }

    #[test]
    fn kotlin_data_class_types() {
        let result = parse_code_to_json_ast(
            "data class User(val name: String, val age: Int, val active: Boolean)",
            "kotlin",
        )
        .unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("name"));
        assert_eq!(obj["name"], Value::String(String::new()));
        assert!(obj.contains_key("age"));
        assert_eq!(obj["age"], Value::Number(0.into()));
        assert!(obj.contains_key("active"));
        assert_eq!(obj["active"], Value::Bool(false));
    }

    #[test]
    fn typescript_type_alias_fields() {
        let result = parse_code_to_json_ast(
            "type User = { name: string; age: number; active: boolean };",
            "typescript",
        )
        .unwrap();
        let obj = result.as_object().unwrap();
        assert_eq!(obj["name"], Value::String(String::new()));
        assert_eq!(obj["age"], Value::Number(0.into()));
        assert_eq!(obj["active"], Value::Bool(false));
    }

    #[test]
    fn typescript_object_literal() {
        let result = parse_code_to_json_ast(
            "export const API_CONFIG: Record<string, unknown> = { baseURL: 'https://example.com', message: \"line\\nnext\", retry: { maxRetries: 3 }, enabled: true } as const;",
            "typescript",
        )
        .unwrap();
        assert_eq!(result["baseURL"], "https://example.com");
        assert_eq!(result["message"], "line\nnext");
        assert_eq!(result["retry"]["maxRetries"], 3);
        assert_eq!(result["enabled"], true);
    }

    #[test]
    fn javascript_nested_class_object_does_not_replace_class_fields() {
        let result = parse_code_to_json_ast(
            "class User { profile = { label: 'nested' }; constructor() { this.name = ''; } }",
            "javascript",
        )
        .unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("name"));
        assert!(!obj.contains_key("label"));
    }

    #[test]
    fn javascript_method_parameters_are_not_fields() {
        let result = parse_code_to_json_ast(
            "class User { constructor(name) { this.name = ''; } update(unused) {} }",
            "javascript",
        )
        .unwrap();
        let obj = result.as_object().unwrap();
        assert!(obj.contains_key("name"));
        assert!(!obj.contains_key("unused"), "got {obj:?}");
    }

    #[test]
    fn javascript_constructor_assignments_are_converted_to_json() {
        let result = parse_code_to_json_ast(
            "class User {\n    constructor(name) {\n        this.name = name;\n        this.active = true;\n    }\n}",
            "javascript",
        )
        .unwrap();

        assert_eq!(result["name"], Value::Null);
        assert_eq!(result["active"], Value::Bool(true));
    }
}

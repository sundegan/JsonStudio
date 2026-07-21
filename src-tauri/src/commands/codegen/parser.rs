use std::collections::HashSet;

use serde_json::{Map, Value};
use tree_sitter_language_pack::{get_parser, Node};

use super::type_shape::{
    default_value_for_type, resolve_declarations, Declaration, ParsedField, ARRAY_WRAPPER_ALIAS,
};

const MAX_LITERAL_DEPTH: usize = 64;
const ROOT_ARRAY_MARKER: &str = "jsonstudio:root-array";

pub fn parse_code_to_json_ast(content: &str, language: &str) -> Result<Value, String> {
    let root_array_field = root_array_field_marker(content);
    let root_array_marker = root_array_field.is_some() || has_root_array_marker(content);
    let grammar = grammar_name(language)
        .ok_or_else(|| format!("Tree-sitter grammar is not bundled for {language}"))?;
    let mut parser = get_parser(grammar)
        .map_err(|error| format!("Tree-sitter failed to load {grammar}: {error}"))?;
    let tree = parser
        .parse(content)
        .ok_or_else(|| format!("Tree-sitter failed to parse {language} source"))?;
    let root = tree.root_node();
    if contains_error_node(&root) {
        if let Some(expected_language) = likely_source_language(content, language) {
            return Err(format!(
                "Tree-sitter found syntax errors in {language} source; input looks like {expected_language}, select {expected_language}"
            ));
        }
        return Err(format!(
            "Tree-sitter found syntax errors in {language} source"
        ));
    }

    if language == "javascript" {
        if let Some(value) = parse_javascript_quicktype_type_map(&root, content) {
            return Ok(apply_root_array_marker(
                value,
                root_array_marker,
                root_array_field.as_ref(),
            ));
        }
    }

    if matches!(language, "javascript" | "typescript") {
        if let Some(value) = find_object_literal(&root, content) {
            return Ok(apply_root_array_marker(
                value,
                root_array_marker,
                root_array_field.as_ref(),
            ));
        }
    }

    extract_declarations(&root, content, language)
        .map(|value| apply_root_array_marker(value, root_array_marker, root_array_field.as_ref()))
}

fn has_root_array_marker(content: &str) -> bool {
    content
        .lines()
        .any(|line| comment_text(line).is_some_and(|comment| comment == ROOT_ARRAY_MARKER))
}

fn root_array_field_marker(content: &str) -> Option<(Option<String>, String)> {
    content.lines().find_map(|line| {
        let comment = comment_text(line)?;
        let marker = comment.strip_prefix("jsonstudio:root-array-field ")?.trim();
        let mut parts = marker.split_whitespace();
        let first = parts.next()?;
        let second = parts.next();
        if parts.next().is_some() {
            return None;
        }
        second
            .map(|field| (Some(first.to_string()), field.to_string()))
            .or_else(|| Some((None, first.to_string())))
    })
}

fn comment_text(line: &str) -> Option<&str> {
    let line = line.trim();
    line.strip_prefix("//")
        .or_else(|| line.strip_prefix('#'))
        .map(str::trim)
}

fn apply_root_array_marker(
    value: Value,
    marked: bool,
    marker: Option<&(Option<String>, String)>,
) -> Value {
    if let Some((wrapper, field)) = marker {
        let candidate = wrapper
            .as_deref()
            .and_then(|wrapper| value.as_object()?.get(wrapper))
            .unwrap_or(&value);
        if let Some(array) = candidate.as_object().and_then(|object| object.get(field)) {
            if array.is_array() {
                return array.clone();
            }
        }
    }
    if marked && !value.is_array() {
        Value::Array(vec![value])
    } else {
        value
    }
}

fn likely_source_language(content: &str, requested_language: &str) -> Option<&'static str> {
    if requested_language != "typescript"
        && content.contains("interface ")
        && (content.contains("export interface") || content.contains(':'))
    {
        return Some("typescript");
    }
    None
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
    parse_object_node_at_depth(node, source, 0)
}

fn parse_object_node_at_depth(node: &Node, source: &str, depth: usize) -> Value {
    if depth >= MAX_LITERAL_DEPTH {
        return Value::Object(Map::new());
    }
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
            .and_then(|value| parse_literal_node_at_depth(&value, source, depth + 1))
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

    let mut declarations = Vec::new();
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
            declarations.push(Declaration {
                name,
                qualified_name: None,
                fields,
                alias: None,
                type_parameters: Vec::new(),
            });
        }
    }

    (!declarations.is_empty()).then(|| resolve_declarations(&declarations, "javascript"))
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

fn parse_quicktype_object_definition(node: &Node, source: &str) -> Option<Vec<ParsedField>> {
    if node.kind() != "call_expression" || call_name(node, source)? != "o" {
        return None;
    }
    let properties = call_arguments(node)?.named_child(0)?;
    if properties.kind() != "array" {
        return None;
    }

    let mut fields = Vec::new();
    for index in 0..properties.named_child_count() as u32 {
        let property = properties.named_child(index)?;
        if property.kind() != "object" {
            continue;
        }
        let json_key = object_property_value(&property, source, "json")
            .and_then(|node| parse_literal_node(&node, source))
            .and_then(|value| value.as_str().map(str::to_string))?;
        let typ = object_property_value(&property, source, "typ")?;
        fields.push(ParsedField {
            name: json_key,
            value: default_value_for_quicktype_type(&typ, source),
            type_hint: Some(node_text(&typ, source).trim().to_string()),
            inline_fields: None,
        });
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
    parse_literal_node_at_depth(node, source, 0)
}

fn parse_literal_node_at_depth(node: &Node, source: &str, depth: usize) -> Option<Value> {
    if depth >= MAX_LITERAL_DEPTH {
        return None;
    }
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
        "object" => Some(parse_object_node_at_depth(node, source, depth + 1)),
        "array" => {
            let mut values = Vec::new();
            for index in 0..node.named_child_count() as u32 {
                let child = node.named_child(index)?;
                values.push(
                    parse_literal_node_at_depth(&child, source, depth + 1).unwrap_or(Value::Null),
                );
            }
            Some(Value::Array(values))
        }
        _ => None,
    }
}

fn extract_declarations(node: &Node, source: &str, language: &str) -> Result<Value, String> {
    let mut declarations = Vec::new();
    collect_declarations(node, source, language, &mut declarations);
    if declarations.is_empty() {
        return Err(format!(
            "Tree-sitter found no data structure in {language} source"
        ));
    }
    let array_wrappers = array_wrapper_markers(source);
    for declaration in &mut declarations {
        if array_wrappers.contains(&declaration.name) {
            declaration.alias = Some(ARRAY_WRAPPER_ALIAS.to_string());
        }
    }
    Ok(resolve_declarations(&declarations, language))
}

fn array_wrapper_markers(source: &str) -> HashSet<String> {
    source
        .lines()
        .filter_map(comment_text)
        .filter_map(|comment| {
            comment
                .strip_prefix("jsonstudio:array-wrapper ")
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn collect_declarations(node: &Node, source: &str, language: &str, output: &mut Vec<Declaration>) {
    let kind = node.kind();
    if language == "go" && kind == "type_declaration" {
        for index in 0..node.named_child_count() as u32 {
            if let Some(child) = node.named_child(index) {
                collect_declarations(&child, source, language, output);
            }
        }
        return;
    }
    if is_declaration_kind(&kind) {
        if let Some(name) = declaration_name(node, source) {
            let fields = collect_fields(node, source, language);
            let type_parameters = declaration_type_parameters(node, source, &name);
            let qualified_name = declaration_qualified_name(node, source, &name);
            let alias = if fields.is_empty() && !has_structural_body(node) {
                declaration_alias_hint(node, source, &name)
            } else {
                None
            };
            let auxiliary_only = fields.is_empty()
                && has_structural_body(node)
                && declaration_has_only_auxiliary_members(node, source, language);
            if !auxiliary_only
                && (!fields.is_empty() || has_structural_body(node) || alias.is_some())
            {
                if let Some(existing) = output.iter_mut().find(|declaration| {
                    declaration.name == name && declaration.qualified_name == qualified_name
                }) {
                    merge_declaration_fields(&mut existing.fields, fields);
                    if alias.is_some() {
                        existing.alias = alias;
                    }
                    if !type_parameters.is_empty() {
                        existing.type_parameters = type_parameters;
                    }
                } else {
                    output.push(Declaration {
                        name,
                        qualified_name,
                        fields,
                        alias,
                        type_parameters,
                    });
                }
            }
            for index in 0..node.named_child_count() as u32 {
                if let Some(child) = node.named_child(index) {
                    if is_declaration_kind(&child.kind())
                        || is_declaration_container(child.kind().as_str())
                    {
                        collect_declarations(&child, source, language, output);
                    }
                }
            }
            return;
        }
    }
    for index in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(index) {
            collect_declarations(&child, source, language, output);
        }
    }
}

fn is_declaration_container(kind: &str) -> bool {
    matches!(
        kind,
        "body"
            | "block"
            | "class_body"
            | "declaration"
            | "declaration_list"
            | "declarations"
            | "field_declaration_list"
            | "interface_body"
            | "member_declaration_list"
            | "message_body"
            | "module"
            | "namespace_body"
            | "program"
            | "source_file"
            | "struct_body"
            | "translation_unit"
            | "type_body"
    )
}

fn declaration_type_parameters(node: &Node, source: &str, declaration_name: &str) -> Vec<String> {
    let declaration = node_text(node, source);
    let Some(name_offset) = declaration.find(declaration_name) else {
        return Vec::new();
    };
    let tail = declaration[name_offset + declaration_name.len()..].trim_start();
    let Some(open) = tail.chars().next().filter(|ch| matches!(ch, '<' | '[')) else {
        return Vec::new();
    };
    let close = if open == '<' { '>' } else { ']' };
    let Some(end) = tail.find(close) else {
        return Vec::new();
    };
    tail[open.len_utf8()..end]
        .split(',')
        .filter_map(|parameter| {
            parameter
                .trim()
                .split(|ch: char| ch.is_whitespace() || ch == ':' || ch == '=')
                .find(|part| !part.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn declaration_alias_hint(node: &Node, source: &str, declaration_name: &str) -> Option<String> {
    for field_name in ["value", "type", "right"] {
        if let Some(candidate) = node.child_by_field_name(field_name) {
            let text = node_text(&candidate, source).trim();
            if !text.is_empty() && text != declaration_name && !has_structural_body(&candidate) {
                return Some(text.trim_start_matches('=').trim().to_string());
            }
        }
    }

    for index in (0..node.named_child_count() as u32).rev() {
        let Some(child) = node.named_child(index) else {
            continue;
        };
        if is_declaration_kind(&child.kind()) {
            if let Some(alias) = declaration_alias_hint(&child, source, declaration_name) {
                return Some(alias);
            }
            continue;
        }
        let text = node_text(&child, source).trim();
        if text.is_empty() || text == declaration_name || has_structural_body(&child) {
            continue;
        }
        let kind = child.kind();
        if kind.contains("type")
            || kind.contains("array")
            || kind.contains("map")
            || kind.contains("slice")
            || kind.contains("pointer")
        {
            return Some(text.trim_start_matches('=').trim().to_string());
        }
    }
    None
}

fn merge_declaration_fields(target: &mut Vec<ParsedField>, fields: Vec<ParsedField>) {
    for field in fields {
        if let Some(existing) = target
            .iter_mut()
            .find(|candidate| candidate.name == field.name)
        {
            *existing = field;
        } else {
            target.push(field);
        }
    }
}

fn has_structural_body(node: &Node) -> bool {
    (0..node.named_child_count() as u32).any(|index| {
        node.named_child(index).is_some_and(|child| {
            matches!(
                child.kind().as_str(),
                "body"
                    | "class_body"
                    | "field_declaration_list"
                    | "interface_body"
                    | "message_body"
                    | "object_type"
                    | "record_type"
                    | "struct_body"
                    | "struct_type"
                    | "type_body"
            )
        })
    })
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
            | "type_alias"
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

fn normalize_type_path(path: &str) -> String {
    path.trim()
        .replace("::", ".")
        .replace(['/', '\\'], ".")
        .trim_matches('.')
        .to_string()
}

fn scope_name(node: &Node, source: &str) -> Option<String> {
    let name = node.child_by_field_name("name").or_else(|| {
        (0..node.named_child_count() as u32)
            .filter_map(|index| node.named_child(index))
            .find(|child| child.kind().contains("identifier") || child.kind().contains("name"))
    })?;
    let name = normalize_type_path(node_text(&name, source));
    (!name.is_empty()).then_some(name)
}

fn is_namespace_container(kind: &str) -> bool {
    kind.contains("namespace") || matches!(kind, "internal_module" | "mod_item")
}

fn file_level_namespace(node: &Node, source: &str) -> Option<String> {
    let mut root = node.clone();
    while let Some(parent) = root.parent() {
        root = parent;
    }
    for index in 0..root.named_child_count() as u32 {
        let child = root.named_child(index)?;
        if child.start_byte() >= node.start_byte() {
            break;
        }
        if matches!(
            child.kind().as_str(),
            "file_scoped_namespace_declaration"
                | "package_declaration"
                | "package_header"
                | "package_statement"
        ) {
            return scope_name(&child, source);
        }
    }
    None
}

fn declaration_qualified_name(node: &Node, source: &str, name: &str) -> Option<String> {
    let mut scopes = Vec::new();
    let mut current = node.parent();
    while let Some(parent) = current {
        if is_namespace_container(parent.kind().as_str())
            || is_declaration_kind(parent.kind().as_str())
        {
            if let Some(scope) = scope_name(&parent, source) {
                scopes.push(scope);
            }
        }
        current = parent.parent();
    }
    if let Some(namespace) = file_level_namespace(node, source) {
        if !scopes.contains(&namespace) {
            scopes.push(namespace);
        }
    }
    if scopes.is_empty() {
        return None;
    }
    scopes.reverse();
    scopes.push(name.to_string());
    Some(scopes.join("."))
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

fn collect_fields(node: &Node, source: &str, language: &str) -> Vec<ParsedField> {
    let mut fields = Vec::new();
    for index in 0..node.named_child_count() as u32 {
        let Some(child) = node.named_child(index) else {
            continue;
        };
        let kind = child.kind();
        if language == "dart"
            && kind == "declaration"
            && (0..child.named_child_count() as u32).any(|index| {
                child
                    .named_child(index)
                    .is_some_and(|nested| nested.kind() == "constructor_signature")
            })
        {
            continue;
        }
        if is_field_kind(&kind, language) {
            let child_fields = fields_from_node(&child, source, language);
            if !child_fields.is_empty() {
                fields.extend(child_fields);
                continue;
            }
        }
        // Some grammars wrap fields in a body/declaration list. Recurse only
        // through structural containers to avoid treating nested methods as fields.
        if is_field_container(&kind) && should_descend_into_container(node.kind().as_str(), &kind) {
            fields.extend(collect_fields(&child, source, language));
        }
    }
    fields
}

fn fields_from_node(node: &Node, source: &str, language: &str) -> Vec<ParsedField> {
    let supports_multiple_names =
        node.kind() == "field_declaration" && matches!(language, "go" | "java" | "csharp");
    if !supports_multiple_names {
        return field_from_node(node, source, language, None)
            .into_iter()
            .collect();
    }

    let mut names = Vec::new();
    if language == "go" {
        let mut cursor = node.walk();
        if cursor.goto_first_child() {
            loop {
                if cursor.field_name().as_deref() == Some("name") {
                    names.push(cursor.node());
                }
                if !cursor.goto_next_sibling() {
                    break;
                }
            }
        }
    } else {
        collect_variable_declarator_names(node, &mut names);
    }
    names.sort_by_key(Node::start_byte);
    if names.is_empty() {
        return field_from_node(node, source, language, None)
            .into_iter()
            .collect();
    }
    names
        .into_iter()
        .filter_map(|name| field_from_node(node, source, language, Some(name)))
        .collect()
}

fn collect_variable_declarator_names(node: &Node, names: &mut Vec<Node>) {
    if node.kind() == "variable_declarator" {
        if let Some(name) = node
            .child_by_field_name("name")
            .or_else(|| node.named_child(0))
        {
            names.push(name);
        }
        return;
    }
    for index in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(index) {
            collect_variable_declarator_names(&child, names);
        }
    }
}

fn is_field_kind(kind: &str, language: &str) -> bool {
    // Exclude container kinds that happen to contain "field" or "parameter"
    // in their name (e.g. field_declaration_list, class_parameters) — those
    // are handled by is_field_container.
    if kind.contains("type_parameter") {
        return false;
    }
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

fn declaration_has_only_auxiliary_members(node: &Node, source: &str, language: &str) -> bool {
    if language == "python" && node_text(node, source).contains("ClassVar") {
        return true;
    }
    language != "go"
        && node_text(node, source)
            .split_whitespace()
            .any(|token| token.trim_matches(|ch: char| !ch.is_alphanumeric()) == "static")
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

fn is_auxiliary_field(node: &Node, source: &str, language: &str, type_hint: Option<&str>) -> bool {
    if language != "go" && has_direct_child_text(node, source, "static") {
        return true;
    }
    if language == "python" {
        let type_hint = type_hint.unwrap_or_default().trim_start();
        if type_hint == "ClassVar"
            || type_hint.starts_with("ClassVar[")
            || type_hint == "InitVar"
            || type_hint.starts_with("InitVar[")
        {
            return true;
        }
    }
    language == "ruby" && node_text(node, source).trim_start().starts_with("@@")
}

fn field_from_node(
    node: &Node,
    source: &str,
    language: &str,
    name_override: Option<Node>,
) -> Option<ParsedField> {
    let name_node = name_override.or_else(|| {
        node.child_by_field_name("name")
            .or_else(|| node.child_by_field_name("declarator"))
            .or_else(|| node.child_by_field_name("key"))
            .or_else(|| node.child_by_field_name("left"))
            .or_else(|| {
                if language == "csharp" && node.kind() == "field_declaration" {
                    find_variable_declarator_identifier(node)
                } else if node.kind() == "property_declaration" {
                    // Objective-C property_declaration wraps the field name deep
                    // inside struct_declarator > pointer_declarator.
                    property_declarator_identifier(node).or_else(|| last_identifier_node(node))
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
            })
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
    let literal_name = parse_literal_node(&name_node, source).and_then(|value| match value {
        Value::String(value) => Some(value),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => None,
    });
    // JavaScript `this.name = value` — extract just the property name.
    let name = if name_node.kind() == "member_expression" {
        name_node
            .child_by_field_name("property")
            .or_else(|| last_identifier_node(&name_node))
            .map(|property| node_text(&property, source).trim().to_string())
            .unwrap_or_else(|| node_text(&name_node, source).trim().to_string())
    } else if let Some(name) = &literal_name {
        name.clone()
    } else {
        node_text(&name_node, source)
            .trim()
            .trim_start_matches(|ch: char| !ch.is_alphabetic() && ch != '_')
            .to_string()
    };
    let first_char = name.chars().next()?;
    if literal_name.is_none() && !first_char.is_alphabetic() && first_char != '_' {
        return None;
    }
    if language == "go" && !first_char.is_uppercase() {
        return None;
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
    let raw_type_hint = type_node
        .as_ref()
        .and_then(|type_node| field_type_hint(node, type_node, source, language))
        .filter(|type_hint| !type_hint.is_empty());
    let inline_fields = type_node
        .as_ref()
        .and_then(|type_node| find_inline_fields(type_node, source, language));

    if is_auxiliary_field(node, source, language, raw_type_hint.as_deref()) {
        return None;
    }

    if matches!(node.kind().as_str(), "call" | "assignment_expression") {
        // Ruby attr_accessor :field_name — extract the symbol from arguments.
        if language == "ruby" {
            let call = call_name(node, source).unwrap_or_default();
            let is_attribute = matches!(
                call,
                "attribute" | "attr_accessor" | "attr_reader" | "attr_writer"
            );
            if !is_attribute {
                return None;
            }
            for i in 0..node.named_child_count() as u32 {
                if let Some(child) = node.named_child(i) {
                    if matches!(child.kind().as_str(), "argument_list" | "arguments") {
                        for j in 0..child.named_child_count() as u32 {
                            if let Some(arg) = child.named_child(j) {
                                // Ruby: simple_symbol :field_name
                                let arg_text = node_text(&arg, source).trim();
                                if let Some(symbol) = arg_text.strip_prefix(':') {
                                    if !symbol.is_empty() {
                                        let type_hint = if call == "attribute" {
                                            child
                                                .named_child(j + 1)
                                                .map(|type_node| {
                                                    node_text(&type_node, source).trim().to_string()
                                                })
                                                .filter(|value| !value.is_empty())
                                        } else {
                                            None
                                        };
                                        let value = type_hint
                                            .as_deref()
                                            .map(|type_hint| {
                                                default_value_for_type(type_hint, language)
                                            })
                                            .unwrap_or(Value::Null);
                                        return Some(ParsedField {
                                            name: symbol.to_string(),
                                            value,
                                            type_hint,
                                            inline_fields: None,
                                        });
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
        return Some(ParsedField {
            name,
            value,
            type_hint: raw_type_hint,
            inline_fields,
        });
    }

    let name = if language == "go" {
        match go_json_tag(node, source) {
            GoJsonTag::Name(json_name) => json_name,
            GoJsonTag::Skip => return None,
            GoJsonTag::Absent => name,
        }
    } else {
        name
    };

    let is_repeated = language == "protobuf" && has_direct_child_text(node, source, "repeated");
    let is_optional = (matches!(language, "protobuf" | "thrift")
        && has_direct_child_text(node, source, "optional"))
        || (language == "typescript" && has_direct_child_text(node, source, "?"));
    let type_hint = if is_repeated {
        raw_type_hint.map(|type_hint| format!("List<{type_hint}>"))
    } else if is_optional {
        raw_type_hint.map(|type_hint| format!("Option<{type_hint}>"))
    } else {
        raw_type_hint
    };
    let value = if is_repeated {
        Value::Array(Vec::new())
    } else if is_optional {
        Value::Null
    } else {
        type_node
            .map(|type_node| default_value_for_type(node_text(&type_node, source), language))
            .unwrap_or(Value::Null)
    };
    Some(ParsedField {
        name,
        value,
        type_hint,
        inline_fields,
    })
}

fn find_inline_fields(node: &Node, source: &str, language: &str) -> Option<Vec<Vec<ParsedField>>> {
    let mut groups = Vec::new();
    collect_inline_field_groups(node, source, language, &mut groups);
    (!groups.is_empty()).then_some(groups)
}

fn collect_inline_field_groups(
    node: &Node,
    source: &str,
    language: &str,
    groups: &mut Vec<Vec<ParsedField>>,
) {
    if matches!(
        node.kind().as_str(),
        "object_type" | "record_type" | "struct_type" | "type_literal"
    ) {
        let fields = collect_fields(node, source, language);
        if !fields.is_empty() {
            groups.push(fields);
        }
        return;
    }
    for index in 0..node.named_child_count() as u32 {
        if let Some(child) = node.named_child(index) {
            collect_inline_field_groups(&child, source, language, groups);
        }
    }
}

fn field_type_hint(field: &Node, type_node: &Node, source: &str, language: &str) -> Option<String> {
    if language == "objectivec" {
        let text = node_text(field, source).trim();
        let text = text.strip_prefix("@property").unwrap_or(text).trim();
        let text = if text.starts_with('(') {
            text.find(')')
                .map(|end| text[end + 1..].trim())
                .unwrap_or(text)
        } else {
            text
        };
        let text = text.trim_end_matches(';').trim();
        if let Some(name_start) = text.rfind(char::is_whitespace) {
            let candidate = text[..name_start].trim();
            if !candidate.is_empty() {
                return Some(candidate.to_string());
            }
        }
    }
    let mut end_byte = type_node.end_byte();
    if language == "dart" {
        for index in 0..field.named_child_count() as u32 {
            let Some(child) = field.named_child(index) else {
                continue;
            };
            if child.kind() == "type_arguments" && child.start_byte() >= end_byte {
                end_byte = child.end_byte();
            }
        }
    }
    source
        .get(type_node.start_byte()..end_byte)
        .map(|text| text.trim().to_string())
}

#[derive(Debug, PartialEq)]
enum GoJsonTag {
    Absent,
    Name(String),
    Skip,
}

fn go_json_tag(node: &Node, source: &str) -> GoJsonTag {
    for index in 0..node.named_child_count() as u32 {
        let Some(child) = node.named_child(index) else {
            continue;
        };
        if matches!(
            child.kind().as_str(),
            "raw_string_literal" | "interpreted_string_literal"
        ) {
            let tag = parse_go_json_tag(node_text(&child, source));
            if tag != GoJsonTag::Absent {
                return tag;
            }
        }
    }
    GoJsonTag::Absent
}

fn parse_go_json_tag(tag: &str) -> GoJsonTag {
    let inner = tag
        .trim_matches(|ch| matches!(ch, '`' | '"'))
        .replace("\\\"", "\"");
    for entry in inner.split_whitespace() {
        if let Some(rest) = entry.strip_prefix("json:") {
            let key = rest.trim_matches('"').split(',').next().unwrap_or("");
            return match key {
                "-" => GoJsonTag::Skip,
                "" => GoJsonTag::Absent,
                _ => GoJsonTag::Name(key.to_string()),
            };
        }
    }
    GoJsonTag::Absent
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

fn property_declarator_identifier(node: &Node) -> Option<Node> {
    for index in 0..node.named_child_count() as u32 {
        let Some(child) = node.named_child(index) else {
            continue;
        };
        if matches!(
            child.kind().as_str(),
            "struct_declaration" | "struct_declarator"
        ) {
            if let Some(identifier) = find_declarator_identifier(&child) {
                return Some(identifier);
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
#[path = "parser_tests.rs"]
mod parser_tests;

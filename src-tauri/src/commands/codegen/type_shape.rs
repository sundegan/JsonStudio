use std::collections::HashSet;

use serde_json::{Map, Value};

pub(super) const ARRAY_WRAPPER_ALIAS: &str = "__jsonstudio_array_wrapper__";

// Resolve language-neutral type shapes after Tree-sitter has collected every
// declaration. Arrays use one structural sample; maps stay empty because their
// keys cannot be inferred from a type declaration alone.

#[derive(Clone, Debug)]
pub(super) struct ParsedField {
    pub(super) name: String,
    pub(super) value: Value,
    pub(super) type_hint: Option<String>,
    pub(super) inline_fields: Option<Vec<Vec<ParsedField>>>,
}

#[derive(Clone, Debug)]
pub(super) struct Declaration {
    pub(super) name: String,
    pub(super) qualified_name: Option<String>,
    pub(super) fields: Vec<ParsedField>,
    pub(super) alias: Option<String>,
    pub(super) type_parameters: Vec<String>,
}

impl Declaration {
    fn identity(&self) -> &str {
        self.qualified_name.as_deref().unwrap_or(&self.name)
    }

    fn namespace(&self) -> Option<&str> {
        self.qualified_name
            .as_deref()
            .and_then(|name| name.rsplit_once('.').map(|(namespace, _)| namespace))
    }
}

const MAX_REFERENCE_DEPTH: usize = 32;
const MAX_EXPANSION_NODES: usize = 4096;

struct ExpansionState {
    active: HashSet<String>,
    recursive: HashSet<String>,
    remaining: usize,
}

impl ExpansionState {
    fn new(recursive: &HashSet<String>) -> Self {
        Self {
            active: HashSet::new(),
            recursive: recursive.clone(),
            remaining: MAX_EXPANSION_NODES,
        }
    }

    fn enter(&mut self, key: String) -> bool {
        if self.remaining == 0 || !self.active.insert(key) {
            return false;
        }
        self.remaining -= 1;
        true
    }

    fn leave(&mut self, key: &str) {
        self.active.remove(key);
    }

    fn instance_key(&self, declaration: &Declaration, arguments: &[String]) -> String {
        if arguments.is_empty() || self.recursive.contains(declaration.identity()) {
            declaration.identity().to_string()
        } else {
            format!("{}<{}>", declaration.identity(), arguments.join(","))
        }
    }
}

#[derive(Clone, Debug)]
enum TypeShape {
    Scalar(Value),
    Named(String),
    Generic(String, Vec<String>),
    Array(Box<TypeShape>),
    Tuple(Vec<TypeShape>),
    Map(Box<TypeShape>),
    Optional(Box<TypeShape>),
    Unknown,
}

pub(super) fn resolve_declarations(declarations: &[Declaration], language: &str) -> Value {
    let mut referenced = HashSet::new();
    for declaration in declarations {
        collect_declaration_references(declaration, declarations, language, &mut referenced);
    }

    let roots: Vec<_> = declarations
        .iter()
        .filter(|declaration| !referenced.contains(declaration.identity()))
        .collect();
    let mut selected = roots;

    let mut reachable = HashSet::new();
    for declaration in &selected {
        mark_reachable_declarations(declaration, declarations, language, &mut reachable);
    }
    for declaration in declarations {
        if !reachable.contains(declaration.identity()) {
            selected.push(declaration);
            mark_reachable_declarations(declaration, declarations, language, &mut reachable);
        }
    }

    let recursive = recursive_declaration_identities(declarations, language);
    if selected.len() == 1 {
        let mut state = ExpansionState::new(&recursive);
        return expand_declaration(selected[0], declarations, language, &mut state, 0);
    }

    let mut output = Map::new();
    for declaration in selected {
        let mut state = ExpansionState::new(&recursive);
        output.insert(
            declaration.identity().to_string(),
            expand_declaration(declaration, declarations, language, &mut state, 0),
        );
    }
    Value::Object(output)
}

fn mark_reachable_declarations(
    declaration: &Declaration,
    declarations: &[Declaration],
    language: &str,
    reachable: &mut HashSet<String>,
) {
    if !reachable.insert(declaration.identity().to_string()) {
        return;
    }
    let mut references = HashSet::new();
    collect_declaration_references(declaration, declarations, language, &mut references);
    for reference in references {
        if let Some(referenced) = find_by_identity(declarations, &reference) {
            mark_reachable_declarations(referenced, declarations, language, reachable);
        }
    }
}

fn collect_declaration_references(
    declaration: &Declaration,
    declarations: &[Declaration],
    language: &str,
    output: &mut HashSet<String>,
) {
    if let Some(alias) = &declaration.alias {
        collect_named_types(
            &parse_type_shape(alias, language),
            declarations,
            language,
            Some(declaration.identity()),
            &declaration.type_parameters,
            output,
            0,
        );
    }
    for field in &declaration.fields {
        collect_field_references(
            field,
            declarations,
            language,
            Some(declaration.identity()),
            &declaration.type_parameters,
            output,
        );
    }
}

fn collect_field_references(
    field: &ParsedField,
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    type_parameters: &[String],
    output: &mut HashSet<String>,
) {
    if let Some(type_hint) = &field.type_hint {
        collect_named_types(
            &parse_type_shape(type_hint, language),
            declarations,
            language,
            source_scope,
            type_parameters,
            output,
            0,
        );
    }
    if let Some(inline_fields) = &field.inline_fields {
        for inline_group in inline_fields {
            for inline_field in inline_group {
                collect_field_references(
                    inline_field,
                    declarations,
                    language,
                    source_scope,
                    type_parameters,
                    output,
                );
            }
        }
    }
}

fn collect_named_types(
    shape: &TypeShape,
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    type_parameters: &[String],
    output: &mut HashSet<String>,
    depth: usize,
) {
    if depth >= MAX_REFERENCE_DEPTH {
        return;
    }
    match shape {
        TypeShape::Named(name) => {
            if !is_type_parameter_reference(name, type_parameters) {
                if let Some(declaration) =
                    find_declaration(declarations, name, language, source_scope)
                {
                    output.insert(declaration.identity().to_string());
                }
            }
        }
        TypeShape::Generic(name, arguments) => {
            if !is_type_parameter_reference(name, type_parameters) {
                if let Some(declaration) =
                    find_declaration(declarations, name, language, source_scope)
                {
                    output.insert(declaration.identity().to_string());
                }
            }
            for argument in arguments {
                collect_named_types(
                    &parse_type_shape(argument, language),
                    declarations,
                    language,
                    source_scope,
                    type_parameters,
                    output,
                    depth + 1,
                );
            }
        }
        TypeShape::Array(inner) | TypeShape::Map(inner) | TypeShape::Optional(inner) => {
            collect_named_types(
                inner,
                declarations,
                language,
                source_scope,
                type_parameters,
                output,
                depth + 1,
            );
        }
        TypeShape::Tuple(elements) => {
            for element in elements {
                collect_named_types(
                    element,
                    declarations,
                    language,
                    source_scope,
                    type_parameters,
                    output,
                    depth + 1,
                );
            }
        }
        TypeShape::Scalar(_) | TypeShape::Unknown => {}
    }
}

fn is_type_parameter_reference(name: &str, type_parameters: &[String]) -> bool {
    !name.contains(['.', ':', '/', '\\'])
        && type_parameters.iter().any(|parameter| parameter == name)
}

fn recursive_declaration_identities(
    declarations: &[Declaration],
    language: &str,
) -> HashSet<String> {
    declarations
        .iter()
        .filter(|declaration| {
            let mut visited = HashSet::new();
            declaration_reaches(
                declaration.identity(),
                declaration,
                declarations,
                language,
                &mut visited,
                0,
            )
        })
        .map(|declaration| declaration.identity().to_string())
        .collect()
}

fn declaration_reaches(
    target: &str,
    current: &Declaration,
    declarations: &[Declaration],
    language: &str,
    visited: &mut HashSet<String>,
    depth: usize,
) -> bool {
    if depth >= MAX_REFERENCE_DEPTH || !visited.insert(current.identity().to_string()) {
        return false;
    }

    let mut references = HashSet::new();
    collect_declaration_references(current, declarations, language, &mut references);

    references.into_iter().any(|reference| {
        reference == target
            || find_by_identity(declarations, &reference).is_some_and(|declaration| {
                declaration_reaches(
                    target,
                    declaration,
                    declarations,
                    language,
                    visited,
                    depth + 1,
                )
            })
    })
}

fn expand_declaration(
    declaration: &Declaration,
    declarations: &[Declaration],
    language: &str,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    expand_declaration_with_arguments(declaration, &[], None, declarations, language, state, depth)
}

fn expand_declaration_with_arguments(
    declaration: &Declaration,
    arguments: &[String],
    inline_argument_fields: Option<&[Vec<ParsedField>]>,
    declarations: &[Declaration],
    language: &str,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    let active_key = state.instance_key(declaration, arguments);
    if depth >= MAX_REFERENCE_DEPTH || !state.enter(active_key.clone()) {
        return Value::Object(Map::new());
    }

    let unbound_arguments;
    let effective_arguments = if arguments.is_empty() && !declaration.type_parameters.is_empty() {
        unbound_arguments = vec!["unknown".to_string(); declaration.type_parameters.len()];
        unbound_arguments.as_slice()
    } else {
        arguments
    };

    let instantiated_fields;
    let fields = if !effective_arguments.is_empty()
        && declaration.type_parameters.len() == effective_arguments.len()
    {
        instantiated_fields = instantiate_fields(
            &declaration.fields,
            &declaration.type_parameters,
            effective_arguments,
            inline_argument_fields,
            language,
        );
        instantiated_fields.as_slice()
    } else {
        declaration.fields.as_slice()
    };

    let instantiated_alias = declaration.alias.as_ref().map(|alias| {
        substitute_type_parameters(alias, &declaration.type_parameters, effective_arguments)
    });
    let alias = instantiated_alias
        .as_deref()
        .or(declaration.alias.as_deref());

    if alias == Some(ARRAY_WRAPPER_ALIAS) {
        let value = match expand_fields(
            fields,
            declarations,
            language,
            Some(declaration.identity()),
            state,
            depth + 1,
        ) {
            Value::Object(mut fields) => fields
                .values_mut()
                .next()
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
            _ => Value::Array(Vec::new()),
        };
        state.leave(&active_key);
        return value;
    }

    if fields.is_empty() {
        if let Some(alias) = alias {
            let value = expand_alias_value(
                alias,
                inline_argument_fields,
                declarations,
                language,
                Some(declaration.identity()),
                state,
                depth + 1,
            );
            state.leave(&active_key);
            return value;
        }
    }

    let fields = expand_fields(
        fields,
        declarations,
        language,
        Some(declaration.identity()),
        state,
        depth + 1,
    );

    state.leave(&active_key);
    fields
}

fn instantiate_fields(
    fields: &[ParsedField],
    parameters: &[String],
    arguments: &[String],
    inline_argument_fields: Option<&[Vec<ParsedField>]>,
    language: &str,
) -> Vec<ParsedField> {
    let argument_inline_fields =
        group_inline_fields_by_argument(arguments, inline_argument_fields, language);
    fields
        .iter()
        .cloned()
        .map(|mut field| {
            let existing_inline_fields = field
                .inline_fields
                .take()
                .unwrap_or_default()
                .into_iter()
                .map(|group| {
                    instantiate_fields(
                        &group,
                        parameters,
                        arguments,
                        inline_argument_fields,
                        language,
                    )
                })
                .collect::<Vec<_>>();

            if let Some(type_hint) = field.type_hint.as_mut() {
                let mut inline_fields = Vec::new();
                let mut existing_offset = 0;
                collect_instantiated_inline_fields(
                    &parse_type_shape(type_hint, language),
                    &existing_inline_fields,
                    &mut existing_offset,
                    parameters,
                    &argument_inline_fields,
                    language,
                    &mut inline_fields,
                );
                inline_fields.extend(existing_inline_fields[existing_offset..].iter().cloned());
                if !inline_fields.is_empty() {
                    field.inline_fields = Some(inline_fields);
                }
                *type_hint = substitute_type_parameters(type_hint, parameters, arguments);
            } else if !existing_inline_fields.is_empty() {
                field.inline_fields = Some(existing_inline_fields);
            }
            field
        })
        .collect()
}

fn group_inline_fields_by_argument<'a>(
    arguments: &[String],
    inline_fields: Option<&'a [Vec<ParsedField>]>,
    language: &str,
) -> Vec<&'a [Vec<ParsedField>]> {
    let inline_fields = inline_fields.unwrap_or(&[]);
    let mut offset = 0;
    arguments
        .iter()
        .map(|argument| {
            let count = inline_group_count(&parse_type_shape(argument, language), language);
            let end = (offset + count).min(inline_fields.len());
            let fields = &inline_fields[offset..end];
            offset = end;
            fields
        })
        .collect()
}

fn collect_instantiated_inline_fields(
    shape: &TypeShape,
    existing_fields: &[Vec<ParsedField>],
    existing_offset: &mut usize,
    parameters: &[String],
    argument_fields: &[&[Vec<ParsedField>]],
    language: &str,
    output: &mut Vec<Vec<ParsedField>>,
) {
    match shape {
        TypeShape::Named(name) => {
            if contains_inline_type(name) {
                if let Some(fields) = existing_fields.get(*existing_offset) {
                    output.push(fields.clone());
                    *existing_offset += 1;
                }
            } else if let Some(index) = parameters.iter().position(|parameter| parameter == name) {
                output.extend(
                    argument_fields
                        .get(index)
                        .into_iter()
                        .flat_map(|fields| fields.iter().cloned()),
                );
            }
        }
        TypeShape::Generic(name, arguments) => {
            if let Some(index) = parameters.iter().position(|parameter| parameter == name) {
                output.extend(
                    argument_fields
                        .get(index)
                        .into_iter()
                        .flat_map(|fields| fields.iter().cloned()),
                );
            }
            for argument in arguments {
                collect_instantiated_inline_fields(
                    &parse_type_shape(argument, language),
                    existing_fields,
                    existing_offset,
                    parameters,
                    argument_fields,
                    language,
                    output,
                );
            }
        }
        TypeShape::Array(inner) | TypeShape::Map(inner) | TypeShape::Optional(inner) => {
            collect_instantiated_inline_fields(
                inner,
                existing_fields,
                existing_offset,
                parameters,
                argument_fields,
                language,
                output,
            );
        }
        TypeShape::Tuple(elements) => {
            for element in elements {
                collect_instantiated_inline_fields(
                    element,
                    existing_fields,
                    existing_offset,
                    parameters,
                    argument_fields,
                    language,
                    output,
                );
            }
        }
        TypeShape::Scalar(_) | TypeShape::Unknown => {}
    }
}

fn contains_inline_type(type_hint: &str) -> bool {
    let type_hint = type_hint.trim();
    type_hint.contains('{') || type_hint.starts_with("struct ") || type_hint.starts_with("struct{")
}

fn substitute_type_parameters(
    type_hint: &str,
    parameters: &[String],
    arguments: &[String],
) -> String {
    if parameters.len() != arguments.len() || parameters.is_empty() {
        return type_hint.to_string();
    }
    let mut output = String::with_capacity(type_hint.len());
    let mut offset = 0;
    while offset < type_hint.len() {
        let ch = type_hint[offset..]
            .chars()
            .next()
            .expect("offset is on a character boundary");
        if !ch.is_alphabetic() && ch != '_' {
            output.push(ch);
            offset += ch.len_utf8();
            continue;
        }
        let start = offset;
        offset += ch.len_utf8();
        while offset < type_hint.len() {
            let ch = type_hint[offset..]
                .chars()
                .next()
                .expect("offset is on a character boundary");
            if !ch.is_alphanumeric() && ch != '_' {
                break;
            }
            offset += ch.len_utf8();
        }
        let token = &type_hint[start..offset];
        let qualified = type_hint[..start].ends_with('.');
        let replacement = parameters
            .iter()
            .position(|parameter| parameter == token)
            .and_then(|index| arguments.get(index));
        if qualified {
            output.push_str(token);
        } else if let Some(replacement) = replacement {
            output.push_str(replacement);
        } else {
            output.push_str(token);
        }
    }
    output
}

fn expand_alias_value(
    alias: &str,
    inline_argument_fields: Option<&[Vec<ParsedField>]>,
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    let shape = parse_type_shape(alias, language);
    match shape {
        TypeShape::Optional(_) => Value::Null,
        TypeShape::Map(_) => Value::Object(Map::new()),
        TypeShape::Array(ref inner) => match inline_argument_fields {
            Some(fields) => inline_value_for_shape(
                &shape,
                fields,
                declarations,
                language,
                source_scope,
                state,
                depth,
            ),
            None => {
                array_value_for_shape(inner, declarations, language, source_scope, state, depth)
            }
        },
        TypeShape::Tuple(ref elements) => expand_tuple_value(
            elements,
            inline_argument_fields,
            declarations,
            language,
            source_scope,
            state,
            depth,
        ),
        TypeShape::Named(name) => find_declaration(declarations, &name, language, source_scope)
            .map(|declaration| {
                expand_declaration(declaration, declarations, language, state, depth)
            })
            .or_else(|| {
                inline_argument_fields
                    .and_then(first_inline_fields)
                    .map(|fields| {
                        expand_fields(fields, declarations, language, source_scope, state, depth)
                    })
            })
            .unwrap_or_else(|| default_value_for_type(alias, language)),
        TypeShape::Generic(name, arguments) => {
            find_declaration(declarations, &name, language, source_scope)
                .map(|declaration| {
                    expand_declaration_with_arguments(
                        declaration,
                        &arguments,
                        inline_argument_fields,
                        declarations,
                        language,
                        state,
                        depth,
                    )
                })
                .unwrap_or_else(|| default_value_for_type(alias, language))
        }
        TypeShape::Scalar(value) => value,
        TypeShape::Unknown => default_value_for_type(alias, language),
    }
}

fn expand_fields(
    fields: &[ParsedField],
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    if depth >= MAX_REFERENCE_DEPTH {
        return Value::Object(Map::new());
    }
    let mut output = Map::new();
    for field in fields {
        let value = field
            .type_hint
            .as_deref()
            .map(|type_hint| parse_type_shape(type_hint, language))
            .map(|shape| {
                expand_field_value(
                    field,
                    &shape,
                    declarations,
                    language,
                    source_scope,
                    state,
                    depth,
                )
            })
            .unwrap_or_else(|| field.value.clone());
        output.insert(field.name.clone(), value);
    }
    Value::Object(output)
}

fn expand_field_value(
    field: &ParsedField,
    shape: &TypeShape,
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    if matches!(shape, TypeShape::Optional(_)) {
        return Value::Null;
    }
    let inline_fields = field.inline_fields.as_deref();
    match shape {
        TypeShape::Optional(_) => Value::Null,
        TypeShape::Map(_) => Value::Object(Map::new()),
        TypeShape::Array(inner) => match inline_fields {
            Some(fields) => inline_value_for_shape(
                shape,
                fields,
                declarations,
                language,
                source_scope,
                state,
                depth + 1,
            ),
            None => {
                array_value_for_shape(inner, declarations, language, source_scope, state, depth)
            }
        },
        TypeShape::Tuple(elements) => expand_tuple_value(
            elements,
            inline_fields,
            declarations,
            language,
            source_scope,
            state,
            depth + 1,
        ),
        TypeShape::Named(name) => find_declaration(declarations, name, language, source_scope)
            .map(|declaration| {
                expand_declaration(declaration, declarations, language, state, depth)
            })
            .or_else(|| {
                inline_fields.and_then(first_inline_fields).map(|fields| {
                    expand_fields(
                        fields,
                        declarations,
                        language,
                        source_scope,
                        state,
                        depth + 1,
                    )
                })
            })
            .unwrap_or_else(|| field.value.clone()),
        TypeShape::Generic(name, arguments) => {
            find_declaration(declarations, name, language, source_scope)
                .map(|declaration| {
                    expand_declaration_with_arguments(
                        declaration,
                        arguments,
                        inline_fields,
                        declarations,
                        language,
                        state,
                        depth,
                    )
                })
                .or_else(|| {
                    inline_fields.and_then(first_inline_fields).map(|fields| {
                        expand_fields(
                            fields,
                            declarations,
                            language,
                            source_scope,
                            state,
                            depth + 1,
                        )
                    })
                })
                .unwrap_or_else(|| field.value.clone())
        }
        TypeShape::Scalar(value) => value.clone(),
        TypeShape::Unknown => inline_fields
            .and_then(first_inline_fields)
            .map(|fields| {
                expand_fields(
                    fields,
                    declarations,
                    language,
                    source_scope,
                    state,
                    depth + 1,
                )
            })
            .unwrap_or_else(|| field.value.clone()),
    }
}

fn inline_value_for_shape(
    shape: &TypeShape,
    inline_fields: &[Vec<ParsedField>],
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    match shape {
        TypeShape::Optional(_) => Value::Null,
        TypeShape::Map(_) => Value::Object(Map::new()),
        TypeShape::Array(inner) => Value::Array(vec![inline_value_for_shape(
            inner,
            inline_fields,
            declarations,
            language,
            source_scope,
            state,
            depth + 1,
        )]),
        TypeShape::Tuple(elements) => expand_tuple_value(
            elements,
            Some(inline_fields),
            declarations,
            language,
            source_scope,
            state,
            depth + 1,
        ),
        TypeShape::Named(name) => find_declaration(declarations, name, language, source_scope)
            .map(|declaration| {
                expand_declaration(declaration, declarations, language, state, depth)
            })
            .unwrap_or_else(|| {
                let fields = inline_fields.first().map(Vec::as_slice).unwrap_or(&[]);
                expand_fields(fields, declarations, language, source_scope, state, depth)
            }),
        TypeShape::Generic(name, arguments) => {
            find_declaration(declarations, name, language, source_scope)
                .map(|declaration| {
                    expand_declaration_with_arguments(
                        declaration,
                        arguments,
                        Some(inline_fields),
                        declarations,
                        language,
                        state,
                        depth,
                    )
                })
                .unwrap_or_else(|| {
                    let fields = inline_fields.first().map(Vec::as_slice).unwrap_or(&[]);
                    expand_fields(fields, declarations, language, source_scope, state, depth)
                })
        }
        TypeShape::Scalar(value) => value.clone(),
        TypeShape::Unknown => expand_fields(
            inline_fields.first().map(Vec::as_slice).unwrap_or(&[]),
            declarations,
            language,
            source_scope,
            state,
            depth,
        ),
    }
}

fn expand_tuple_value(
    elements: &[TypeShape],
    inline_fields: Option<&[Vec<ParsedField>]>,
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    if depth >= MAX_REFERENCE_DEPTH {
        return Value::Array(Vec::new());
    }

    let mut inline_offset = 0;
    let values = elements
        .iter()
        .map(|element| {
            let inline_count = inline_group_count(element, language);
            let element_inline_fields = inline_fields.and_then(|groups| {
                let end = (inline_offset + inline_count).min(groups.len());
                let selected = &groups[inline_offset..end];
                inline_offset = end;
                (!selected.is_empty()).then_some(selected)
            });
            expand_shape_value(
                element,
                element_inline_fields,
                declarations,
                language,
                source_scope,
                state,
                depth + 1,
            )
        })
        .collect();
    Value::Array(values)
}

fn expand_shape_value(
    shape: &TypeShape,
    inline_fields: Option<&[Vec<ParsedField>]>,
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    if let Some(inline_fields) = inline_fields {
        return inline_value_for_shape(
            shape,
            inline_fields,
            declarations,
            language,
            source_scope,
            state,
            depth,
        );
    }

    match shape {
        TypeShape::Optional(_) => Value::Null,
        TypeShape::Map(_) => Value::Object(Map::new()),
        TypeShape::Array(inner) => {
            array_value_for_shape(inner, declarations, language, source_scope, state, depth)
        }
        TypeShape::Tuple(elements) => expand_tuple_value(
            elements,
            None,
            declarations,
            language,
            source_scope,
            state,
            depth,
        ),
        TypeShape::Named(name) => find_declaration(declarations, name, language, source_scope)
            .map(|declaration| {
                expand_declaration(declaration, declarations, language, state, depth)
            })
            .unwrap_or_else(|| default_value_for_shape(shape)),
        TypeShape::Generic(name, arguments) => {
            find_declaration(declarations, name, language, source_scope)
                .map(|declaration| {
                    expand_declaration_with_arguments(
                        declaration,
                        arguments,
                        None,
                        declarations,
                        language,
                        state,
                        depth,
                    )
                })
                .unwrap_or_else(|| default_value_for_shape(shape))
        }
        TypeShape::Scalar(value) => value.clone(),
        TypeShape::Unknown => Value::Object(Map::new()),
    }
}

fn inline_group_count(shape: &TypeShape, language: &str) -> usize {
    match shape {
        TypeShape::Named(name) => usize::from(contains_inline_type(name)),
        TypeShape::Generic(_, arguments) => arguments
            .iter()
            .map(|argument| inline_group_count(&parse_type_shape(argument, language), language))
            .sum(),
        TypeShape::Array(inner) | TypeShape::Map(inner) | TypeShape::Optional(inner) => {
            inline_group_count(inner, language)
        }
        TypeShape::Tuple(elements) => elements
            .iter()
            .map(|element| inline_group_count(element, language))
            .sum(),
        TypeShape::Scalar(_) | TypeShape::Unknown => 0,
    }
}

fn first_inline_fields(inline_fields: &[Vec<ParsedField>]) -> Option<&[ParsedField]> {
    inline_fields.first().map(Vec::as_slice)
}

fn array_value_for_shape(
    shape: &TypeShape,
    declarations: &[Declaration],
    language: &str,
    source_scope: Option<&str>,
    state: &mut ExpansionState,
    depth: usize,
) -> Value {
    if depth >= MAX_REFERENCE_DEPTH {
        return Value::Array(Vec::new());
    }
    let sample = match shape {
        TypeShape::Named(name) => {
            find_declaration(declarations, name, language, source_scope).map(|declaration| {
                expand_declaration(declaration, declarations, language, state, depth)
            })
        }
        TypeShape::Generic(name, arguments) => {
            find_declaration(declarations, name, language, source_scope).map(|declaration| {
                expand_declaration_with_arguments(
                    declaration,
                    arguments,
                    None,
                    declarations,
                    language,
                    state,
                    depth,
                )
            })
        }
        TypeShape::Array(inner) => Some(array_value_for_shape(
            inner,
            declarations,
            language,
            source_scope,
            state,
            depth,
        )),
        TypeShape::Tuple(elements) => Some(expand_tuple_value(
            elements,
            None,
            declarations,
            language,
            source_scope,
            state,
            depth,
        )),
        TypeShape::Optional(inner) => match inner.as_ref() {
            TypeShape::Named(name)
                if find_declaration(declarations, name, language, source_scope).is_some() =>
            {
                Some(Value::Null)
            }
            _ => None,
        },
        TypeShape::Map(_) | TypeShape::Scalar(_) | TypeShape::Unknown => None,
    };
    Value::Array(sample.into_iter().collect())
}

fn find_declaration<'a>(
    declarations: &'a [Declaration],
    type_name: &str,
    language: &str,
    source_scope: Option<&str>,
) -> Option<&'a Declaration> {
    let normalized = normalize_type_path(type_name);
    let (normalized, absolute) = match language {
        "csharp" => normalized
            .strip_prefix("global.")
            .map_or((normalized.as_str(), false), |name| (name, true)),
        "rust" => normalized
            .strip_prefix("crate.")
            .map_or((normalized.as_str(), false), |name| (name, true)),
        "cpp" => normalized
            .strip_prefix("::")
            .map_or((normalized.as_str(), false), |name| (name, true)),
        _ => (normalized.as_str(), false),
    };
    if absolute {
        return find_by_identity(declarations, normalized);
    }

    let simple_name = normalized
        .rsplit('.')
        .find(|segment| !segment.is_empty())
        .unwrap_or(normalized);
    let qualified = normalized != simple_name;

    if qualified {
        if language == "go" {
            return None;
        }
        if language == "rust" {
            if let Some(relative) = normalized.strip_prefix("self.") {
                return source_scope
                    .and_then(parent_scope)
                    .and_then(|scope| {
                        find_by_identity(declarations, &format!("{scope}.{relative}"))
                    })
                    .or_else(|| find_by_identity(declarations, relative));
            }
            if normalized.starts_with("super.") {
                let mut namespace: Vec<_> = parent_scope(source_scope?)?.split('.').collect();
                let mut relative = normalized;
                while let Some(rest) = relative.strip_prefix("super.") {
                    namespace.pop()?;
                    relative = rest;
                }
                let candidate = if namespace.is_empty() {
                    relative.to_string()
                } else {
                    format!("{}.{relative}", namespace.join("."))
                };
                return find_by_identity(declarations, &candidate);
            }
        }
        if let Some(scope) = source_scope {
            let mut parts: Vec<_> = scope.split('.').collect();
            while !parts.is_empty() {
                let candidate = format!("{}.{normalized}", parts.join("."));
                if let Some(declaration) = find_by_identity(declarations, &candidate) {
                    return Some(declaration);
                }
                parts.pop();
            }
        }
        return find_by_identity(declarations, normalized);
    }

    if let Some(scope) = source_scope {
        let mut current = Some(scope);
        while let Some(candidate_scope) = current {
            if let Some(declaration) =
                find_unique_in_namespace(declarations, simple_name, Some(candidate_scope))
            {
                return Some(declaration);
            }
            current = parent_scope(candidate_scope);
        }
    }
    find_unique_in_namespace(declarations, simple_name, None)
}

fn parent_scope(scope: &str) -> Option<&str> {
    scope.rsplit_once('.').map(|(parent, _)| parent)
}

fn find_unique_in_namespace<'a>(
    declarations: &'a [Declaration],
    name: &str,
    namespace: Option<&str>,
) -> Option<&'a Declaration> {
    let mut candidates = declarations
        .iter()
        .filter(|declaration| declaration.name == name && declaration.namespace() == namespace);
    let first = candidates.next()?;
    candidates.next().is_none().then_some(first)
}

fn find_by_identity<'a>(
    declarations: &'a [Declaration],
    identity: &str,
) -> Option<&'a Declaration> {
    declarations
        .iter()
        .find(|declaration| declaration.identity() == identity)
}

fn normalize_type_path(path: &str) -> String {
    let path = path.trim();
    let absolute_cpp = path.starts_with("::");
    let normalized = path
        .replace("::", ".")
        .replace(['/', '\\'], ".")
        .trim_matches('.')
        .to_string();
    if absolute_cpp {
        format!("::{normalized}")
    } else {
        normalized
    }
}

fn parse_type_shape(type_text: &str, language: &str) -> TypeShape {
    parse_type_shape_inner(type_text, language, 0)
}

pub(super) fn default_value_for_type(type_text: &str, language: &str) -> Value {
    default_value_for_shape(&parse_type_shape(type_text, language))
}

fn default_value_for_shape(shape: &TypeShape) -> Value {
    match shape {
        TypeShape::Scalar(value) => value.clone(),
        TypeShape::Array(_) => Value::Array(Vec::new()),
        TypeShape::Tuple(elements) => {
            Value::Array(elements.iter().map(default_value_for_shape).collect())
        }
        TypeShape::Map(_) | TypeShape::Named(_) | TypeShape::Generic(_, _) | TypeShape::Unknown => {
            Value::Object(Map::new())
        }
        TypeShape::Optional(_) => Value::Null,
    }
}

fn parse_type_shape_inner(type_text: &str, language: &str, depth: usize) -> TypeShape {
    if depth >= MAX_REFERENCE_DEPTH {
        return TypeShape::Unknown;
    }
    let mut text = type_text.trim();
    if !text.starts_with("::") {
        text = text.trim_start_matches(':').trim();
    }
    if text.starts_with('(') && matching_delimiter(text, 0, '(', ')') == Some(text.len() - 1) {
        if let Some(elements) = parse_tuple_elements(&text[1..text.len() - 1], language, depth) {
            return TypeShape::Tuple(elements);
        }
    }
    text = trim_outer_parentheses(text);
    if language == "python" {
        text = trim_matching_quotes(text);
    }
    if text.is_empty() {
        return TypeShape::Unknown;
    }

    // Quicktype's JavaScript metadata and Ruby Dry::Struct use call-shaped
    // type expressions such as r("Child"), a(r("Child")), and
    // Types.Array(Child). Normalize those expressions before the generic
    // angle/bracket parsing below.
    if let Some((base, arguments_text)) = function_type_parts(text) {
        let base_name = simple_type_name(base).to_ascii_lowercase();
        let arguments = split_top_level(arguments_text, ',', language)
            .into_iter()
            .filter(|argument| !argument.is_empty())
            .collect::<Vec<_>>();
        if base_name == "r" {
            return arguments
                .first()
                .map(|argument| {
                    TypeShape::Named(normalize_type_path(trim_matching_quotes(argument.trim())))
                })
                .unwrap_or(TypeShape::Unknown);
        }
        if base_name == "a" || is_array_container(&base_name) {
            return arguments
                .first()
                .map(|argument| {
                    TypeShape::Array(Box::new(parse_type_shape_inner(
                        argument,
                        language,
                        depth + 1,
                    )))
                })
                .unwrap_or_else(|| TypeShape::Array(Box::new(TypeShape::Unknown)));
        }
        if base_name == "m" || is_map_container(&base_name) {
            return arguments
                .last()
                .map(|argument| {
                    TypeShape::Map(Box::new(parse_type_shape_inner(
                        argument,
                        language,
                        depth + 1,
                    )))
                })
                .unwrap_or_else(|| TypeShape::Map(Box::new(TypeShape::Unknown)));
        }
        if base_name == "u" {
            let non_null = arguments
                .iter()
                .filter(|argument| {
                    !matches!(
                        argument.trim().to_ascii_lowercase().as_str(),
                        "null" | "undefined" | "none"
                    )
                })
                .collect::<Vec<_>>();
            return match non_null.as_slice() {
                [argument] if non_null.len() < arguments.len() => TypeShape::Optional(Box::new(
                    parse_type_shape_inner(argument, language, depth + 1),
                )),
                [argument] => parse_type_shape_inner(argument, language, depth + 1),
                _ => TypeShape::Unknown,
            };
        }
    }

    if language == "java" {
        if let Some(bound) = text
            .strip_prefix("? extends ")
            .or_else(|| text.strip_prefix("? super "))
        {
            return parse_type_shape_inner(bound, language, depth + 1);
        }
        if text == "?" {
            return TypeShape::Unknown;
        }
    }

    if language == "typescript" {
        if let Some(value) = typescript_index_value_type(text) {
            return TypeShape::Map(Box::new(parse_type_shape_inner(value, language, depth + 1)));
        }
    }

    if let Some(non_null) = non_null_union_member(text, language) {
        return TypeShape::Optional(Box::new(parse_type_shape_inner(
            non_null,
            language,
            depth + 1,
        )));
    }
    if let Some(nullable) = text.strip_suffix('?') {
        return TypeShape::Optional(Box::new(parse_type_shape_inner(
            nullable.trim(),
            language,
            depth + 1,
        )));
    }

    let text = strip_type_prefixes(text);
    if let Some(nullable) = text.strip_prefix('?') {
        return TypeShape::Optional(Box::new(parse_type_shape_inner(
            nullable,
            language,
            depth + 1,
        )));
    }
    let text = text.trim_end_matches(['*', '&']).trim();
    if text.is_empty() {
        return TypeShape::Unknown;
    }

    if let Some((element, rank)) = suffix_array_type(text) {
        let mut shape = parse_type_shape_inner(element, language, depth + 1);
        for _ in 0..rank {
            shape = TypeShape::Array(Box::new(shape));
        }
        return shape;
    }

    if text.starts_with('[') {
        if let Some(close) = matching_delimiter(text, 0, '[', ']') {
            if close == text.len() - 1 {
                let inner = &text[1..close];
                if language != "typescript" {
                    if let Some((_, value)) = split_top_level_once(inner, ':', language) {
                        return TypeShape::Map(Box::new(parse_type_shape_inner(
                            value,
                            language,
                            depth + 1,
                        )));
                    }
                }
                if let Some((element, _)) = split_top_level_once(inner, ';', language) {
                    return TypeShape::Array(Box::new(parse_type_shape_inner(
                        element,
                        language,
                        depth + 1,
                    )));
                }
                if let Some(elements) = parse_tuple_elements(inner, language, depth) {
                    return TypeShape::Tuple(elements);
                }
                if language == "typescript" {
                    if let Some((_, value)) = split_top_level_once(inner, ':', language) {
                        return TypeShape::Tuple(vec![parse_type_shape_inner(
                            value,
                            language,
                            depth + 1,
                        )]);
                    }
                }
                return TypeShape::Array(Box::new(parse_type_shape_inner(
                    inner,
                    language,
                    depth + 1,
                )));
            }

            if language == "go" {
                return TypeShape::Array(Box::new(parse_type_shape_inner(
                    text[close + 1..].trim(),
                    language,
                    depth + 1,
                )));
            }
        }
    }

    if language == "go" && text.starts_with("map[") {
        if let Some(close) = matching_delimiter(text, 3, '[', ']') {
            return TypeShape::Map(Box::new(parse_type_shape_inner(
                text[close + 1..].trim(),
                language,
                depth + 1,
            )));
        }
    }

    if let Some(open) = text.find('[') {
        if open > 0 && matching_delimiter(text, open, '[', ']') == Some(text.len() - 1) {
            let base = simple_type_name(&text[..open]).to_ascii_lowercase();
            let arguments = split_top_level(&text[open + 1..text.len() - 1], ',', language)
                .into_iter()
                .filter(|argument| !argument.is_empty())
                .collect::<Vec<_>>();
            if is_tuple_container(&base) {
                return TypeShape::Tuple(
                    arguments
                        .into_iter()
                        .map(|argument| parse_type_shape_inner(argument, language, depth + 1))
                        .collect(),
                );
            }
            if is_optional_container(&base) {
                return arguments
                    .first()
                    .map(|argument| {
                        TypeShape::Optional(Box::new(parse_type_shape_inner(
                            argument,
                            language,
                            depth + 1,
                        )))
                    })
                    .unwrap_or(TypeShape::Unknown);
            }
            if is_array_container(&base) {
                return arguments
                    .first()
                    .map(|argument| {
                        TypeShape::Array(Box::new(parse_type_shape_inner(
                            argument,
                            language,
                            depth + 1,
                        )))
                    })
                    .unwrap_or(TypeShape::Unknown);
            }
            if is_map_container(&base) {
                return arguments
                    .last()
                    .map(|argument| {
                        TypeShape::Map(Box::new(parse_type_shape_inner(
                            argument,
                            language,
                            depth + 1,
                        )))
                    })
                    .unwrap_or_else(|| TypeShape::Map(Box::new(TypeShape::Unknown)));
            }
            return TypeShape::Generic(
                normalize_type_path(&text[..open]),
                arguments.into_iter().map(str::to_string).collect(),
            );
        }
    }

    if let Some((base, arguments)) = generic_type_parts(text) {
        let base_name = simple_type_name(base).to_ascii_lowercase();
        let arguments = split_top_level(arguments, ',', language)
            .into_iter()
            .filter(|argument| !argument.is_empty())
            .collect::<Vec<_>>();
        if is_tuple_container(&base_name) {
            return TypeShape::Tuple(
                arguments
                    .into_iter()
                    .map(|argument| parse_type_shape_inner(argument, language, depth + 1))
                    .collect(),
            );
        }
        if is_optional_container(&base_name) {
            return arguments
                .first()
                .map(|argument| {
                    TypeShape::Optional(Box::new(parse_type_shape_inner(
                        argument,
                        language,
                        depth + 1,
                    )))
                })
                .unwrap_or(TypeShape::Unknown);
        }
        if is_array_container(&base_name) {
            return arguments
                .first()
                .map(|argument| {
                    TypeShape::Array(Box::new(parse_type_shape_inner(
                        argument,
                        language,
                        depth + 1,
                    )))
                })
                .unwrap_or(TypeShape::Unknown);
        }
        if is_map_container(&base_name) {
            return arguments
                .last()
                .map(|argument| {
                    TypeShape::Map(Box::new(parse_type_shape_inner(
                        argument,
                        language,
                        depth + 1,
                    )))
                })
                .unwrap_or_else(|| TypeShape::Map(Box::new(TypeShape::Unknown)));
        }
        if is_transparent_container(&base_name, language) {
            return arguments
                .first()
                .map(|argument| parse_type_shape_inner(argument, language, depth + 1))
                .unwrap_or(TypeShape::Unknown);
        }
        return TypeShape::Generic(
            normalize_type_path(base),
            arguments.into_iter().map(str::to_string).collect(),
        );
    }

    let name = simple_type_name(text);
    let lower_name = name.to_ascii_lowercase();
    if let Some(value) = scalar_default_value(name) {
        TypeShape::Scalar(value)
    } else if is_map_container(&lower_name) && name.chars().all(char::is_lowercase) {
        TypeShape::Map(Box::new(TypeShape::Unknown))
    } else if is_array_container(&lower_name) && name.chars().all(char::is_lowercase) {
        TypeShape::Array(Box::new(TypeShape::Unknown))
    } else if name.is_empty() {
        TypeShape::Unknown
    } else {
        TypeShape::Named(normalize_type_path(text))
    }
}

fn trim_matching_quotes(text: &str) -> &str {
    let bytes = text.as_bytes();
    if bytes.len() >= 2 && matches!(bytes[0], b'\'' | b'"') && bytes.first() == bytes.last() {
        text[1..text.len() - 1].trim()
    } else {
        text
    }
}

fn parse_tuple_elements(text: &str, language: &str, depth: usize) -> Option<Vec<TypeShape>> {
    let elements = split_top_level(text, ',', language);
    if elements.len() <= 1 {
        return None;
    }
    let elements = elements
        .into_iter()
        .filter(|element| !element.is_empty())
        .map(|element| {
            parse_type_shape_inner(tuple_element_type(element, language), language, depth + 1)
        })
        .collect::<Vec<_>>();
    (!elements.is_empty()).then_some(elements)
}

fn tuple_element_type<'a>(element: &'a str, language: &str) -> &'a str {
    if matches!(language, "typescript" | "swift") {
        if let Some((_, value)) = split_top_level_once(element, ':', language) {
            return value;
        }
    }
    if language == "csharp" {
        if let Some((typ, name)) = element.rsplit_once(char::is_whitespace) {
            if !typ.trim().is_empty() && name.chars().all(|ch| ch.is_alphanumeric() || ch == '_') {
                return typ.trim();
            }
        }
    }
    element
}

fn typescript_index_value_type(text: &str) -> Option<&str> {
    let inner = text.strip_prefix('{')?.strip_suffix('}')?.trim();
    let close = matching_delimiter(inner, 0, '[', ']')?;
    let value = inner[close + 1..].trim().strip_prefix(':')?.trim();
    Some(value.trim_end_matches([';', ',']).trim())
}

fn suffix_array_type(text: &str) -> Option<(&str, usize)> {
    let open = text.rfind('[')?;
    if open == 0 || matching_delimiter(text, open, '[', ']') != Some(text.len() - 1) {
        return None;
    }
    let rank = &text[open + 1..text.len() - 1];
    rank.chars()
        .all(|ch| ch == ',' || ch.is_whitespace())
        .then(|| {
            (
                text[..open].trim(),
                rank.chars().filter(|ch| *ch == ',').count() + 1,
            )
        })
}

fn strip_type_prefixes(mut text: &str) -> &str {
    loop {
        let trimmed = text.trim();
        let without_pointer = trimmed
            .strip_prefix('*')
            .or_else(|| trimmed.strip_prefix('&'))
            .or_else(|| trimmed.strip_prefix('^'));
        if let Some(rest) = without_pointer {
            text = rest;
            continue;
        }
        if let Some(rest) = strip_lifetime_annotation(trimmed) {
            text = rest;
            continue;
        }
        let mut stripped_keyword = None;
        for keyword in ["const ", "readonly ", "mut ", "ref ", "in ", "out "] {
            if let Some(rest) = trimmed.strip_prefix(keyword) {
                stripped_keyword = Some(rest);
                break;
            }
        }
        if let Some(rest) = stripped_keyword {
            text = rest;
            continue;
        }
        return trimmed;
    }
}

fn strip_lifetime_annotation(text: &str) -> Option<&str> {
    let lifetime = text.strip_prefix('\'')?;
    let identifier_end = lifetime
        .char_indices()
        .find(|(_, ch)| !ch.is_alphanumeric() && *ch != '_')
        .map(|(index, _)| index)
        .unwrap_or(lifetime.len());
    let rest = &lifetime[identifier_end..];
    (!lifetime[..identifier_end].is_empty() && rest.starts_with(char::is_whitespace))
        .then(|| rest.trim_start())
}

fn trim_outer_parentheses(mut text: &str) -> &str {
    loop {
        let trimmed = text.trim();
        if !trimmed.starts_with('(') {
            return trimmed;
        }
        let Some(close) = matching_delimiter(trimmed, 0, '(', ')') else {
            return trimmed;
        };
        if close != trimmed.len() - 1 {
            return trimmed;
        }
        text = &trimmed[1..close];
    }
}

fn non_null_union_member<'a>(text: &'a str, language: &str) -> Option<&'a str> {
    let members = split_top_level(text, '|', language);
    if members.len() <= 1 {
        return None;
    }
    let non_null: Vec<_> = members
        .into_iter()
        .filter(|member| {
            !matches!(
                member.trim().to_ascii_lowercase().as_str(),
                "null" | "undefined" | "none"
            )
        })
        .collect();
    (non_null.len() == 1).then_some(non_null[0].trim())
}

fn generic_type_parts(text: &str) -> Option<(&str, &str)> {
    let open = text.find('<')?;
    let close = matching_delimiter(text, open, '<', '>')?;
    (close == text.len() - 1).then(|| (text[..open].trim(), text[open + 1..close].trim()))
}

fn function_type_parts(text: &str) -> Option<(&str, &str)> {
    let open = text.find('(')?;
    if open == 0 || matching_delimiter(text, open, '(', ')') != Some(text.len() - 1) {
        return None;
    }
    let base = text[..open].trim();
    (!base.is_empty()).then(|| (base, text[open + 1..text.len() - 1].trim()))
}

fn matching_delimiter(text: &str, open_index: usize, open: char, close: char) -> Option<usize> {
    let mut depth: i32 = 0;
    for (index, ch) in text
        .char_indices()
        .skip_while(|(index, _)| *index < open_index)
    {
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth < 0 {
                return None;
            }
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn split_top_level<'a>(text: &'a str, separator: char, language: &str) -> Vec<&'a str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut angle: i32 = 0;
    let mut square: i32 = 0;
    let mut round: i32 = 0;
    let mut curly: i32 = 0;
    let mut quote = None;
    let mut escaped = false;
    for (index, ch) in text.char_indices() {
        if let Some(expected) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == expected {
                quote = None;
            }
            continue;
        }
        if ch == '\'' && language == "rust" && is_rust_lifetime_start(text, index) {
            continue;
        }
        if matches!(ch, '\'' | '"' | '`') {
            quote = Some(ch);
            continue;
        }
        match ch {
            '<' => angle += 1,
            '>' => angle = (angle - 1).max(0),
            '[' => square += 1,
            ']' => square = (square - 1).max(0),
            '(' => round += 1,
            ')' => round = (round - 1).max(0),
            '{' => curly += 1,
            '}' => curly = (curly - 1).max(0),
            _ => {}
        }
        if ch == separator && angle == 0 && square == 0 && round == 0 && curly == 0 {
            parts.push(text[start..index].trim());
            start = index + ch.len_utf8();
        }
    }
    parts.push(text[start..].trim());
    parts
}

fn is_rust_lifetime_start(text: &str, quote_index: usize) -> bool {
    let rest = &text[quote_index + '\''.len_utf8()..];
    let identifier_end = rest
        .char_indices()
        .find(|(_, ch)| !ch.is_alphanumeric() && *ch != '_')
        .map(|(index, _)| index)
        .unwrap_or(rest.len());
    identifier_end > 0 && !rest[identifier_end..].starts_with('\'')
}

fn split_top_level_once<'a>(
    text: &'a str,
    separator: char,
    language: &str,
) -> Option<(&'a str, &'a str)> {
    let parts = split_top_level(text, separator, language);
    (parts.len() == 2).then(|| (parts[0], parts[1]))
}

fn simple_type_name(text: &str) -> &str {
    text.trim()
        .trim_start_matches("::")
        .rsplit(['.', ':', '/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or("")
        .trim()
}

fn is_optional_container(name: &str) -> bool {
    matches!(name, "option" | "optional" | "nullable" | "maybe")
}

fn is_tuple_container(name: &str) -> bool {
    matches!(name, "tuple" | "valuetuple")
}

fn is_array_container(name: &str) -> bool {
    matches!(
        name,
        "array"
            | "readonlyarray"
            | "list"
            | "arraylist"
            | "linkedlist"
            | "vec"
            | "vecdeque"
            | "vector"
            | "slice"
            | "set"
            | "hashset"
            | "btreeset"
            | "unordered_set"
            | "unorderedset"
            | "collection"
            | "mutablecollection"
            | "mutableiterable"
            | "mutablelist"
            | "mutableset"
            | "sequence"
            | "seq"
            | "iterable"
            | "ilist"
            | "icollection"
            | "ienumerable"
            | "ireadonlylist"
            | "ireadonlycollection"
            | "ireadonlyset"
            | "deque"
            | "queue"
            | "stack"
            | "nsarray"
            | "nsmutablearray"
            | "nsset"
            | "nsmutableset"
    )
}

fn is_map_container(name: &str) -> bool {
    matches!(
        name,
        "map"
            | "hash"
            | "hashmap"
            | "btreemap"
            | "unordered_map"
            | "unorderedmap"
            | "dict"
            | "dictionary"
            | "record"
            | "object"
            | "idictionary"
            | "ireadonlydictionary"
            | "mutablemap"
            | "multimap"
            | "nsdictionary"
            | "nsmutabledictionary"
    )
}

fn is_transparent_container(name: &str, language: &str) -> bool {
    matches!(name, "pointer" | "shared_ptr" | "unique_ptr")
        || (language == "rust" && matches!(name, "box" | "arc" | "rc"))
}

fn scalar_default_value(name: &str) -> Option<Value> {
    let lower = name.to_ascii_lowercase();
    if lower.chars().any(|ch| {
        matches!(
            ch,
            '{' | '}' | '[' | ']' | '<' | '>' | '(' | ')' | ':' | ';' | ',' | '|'
        )
    }) {
        return None;
    }
    if matches!(lower.as_str(), "any" | "unknown") {
        return Some(Value::Object(Map::new()));
    }
    if matches!(lower.as_str(), "null" | "none" | "undefined" | "void") {
        return Some(Value::Null);
    }

    // C/C++ qualifiers and fixed-width aliases are common in generated code.
    // Token matching avoids treating names such as StringValue as strings.
    let tokens = lower
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    if tokens
        .iter()
        .any(|token| matches!(*token, "bool" | "boolean"))
    {
        return Some(Value::Bool(false));
    }
    if tokens.iter().any(|token| {
        matches!(
            *token,
            "string"
                | "str"
                | "char"
                | "character"
                | "text"
                | "varchar"
                | "uuid"
                | "nsstring"
                | "bytes"
        )
    }) {
        return Some(Value::String(String::new()));
    }
    if tokens.iter().any(|token| {
        matches!(
            *token,
            "int"
                | "integer"
                | "long"
                | "short"
                | "float"
                | "double"
                | "number"
                | "decimal"
                | "num"
                | "byte"
                | "sbyte"
                | "bigint"
                | "rune"
                | "i8"
                | "i16"
                | "i32"
                | "i64"
                | "isize"
                | "u8"
                | "u16"
                | "u32"
                | "u64"
                | "usize"
                | "f16"
                | "f32"
                | "f64"
                | "float16"
                | "float32"
                | "float64"
                | "int8"
                | "int16"
                | "int32"
                | "int64"
                | "uint"
                | "uint8"
                | "uint16"
                | "uint32"
                | "uint64"
                | "size"
                | "ssize"
                | "nsinteger"
                | "cgfloat"
        )
    }) {
        return Some(Value::Number(0.into()));
    }
    None
}

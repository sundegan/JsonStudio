use super::*;

#[test]
fn default_values_do_not_match_substrings_in_custom_type_names() {
    assert_eq!(
        default_value_for_type("Point", "typescript"),
        Value::Object(Map::new())
    );
    assert_eq!(
        default_value_for_type("StringValue", "typescript"),
        Value::Object(Map::new())
    );
    assert_eq!(
        default_value_for_type("[String]", "swift"),
        Value::Array(Vec::new())
    );
    assert_eq!(
        default_value_for_type("[String: Int]", "swift"),
        Value::Object(Map::new())
    );
    assert_eq!(
        default_value_for_type("HashMap<String, Int>", "rust"),
        Value::Object(Map::new())
    );
    assert_eq!(
        default_value_for_type("std::vector<std::string>", "cpp"),
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
fn root_array_marker_restores_top_level_array_without_double_wrapping() {
    let source = "// jsonstudio:root-array\ninterface Item { id: number; }";
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!([{ "id": 0 }])
    );

    let source = "// jsonstudio:root-array\nconst items = [{ id: 1 }];";
    assert_eq!(
        parse_code_to_json_ast(source, "javascript").unwrap(),
        serde_json::json!([{ "id": 1 }])
    );

    let source = "<?php\n// jsonstudio:root-array\nclass Item { public int $id; }";
    assert_eq!(
        parse_code_to_json_ast(source, "php").unwrap(),
        serde_json::json!([{ "id": 0 }])
    );
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
        let result = parse_code_to_json_ast(source, language)
            .unwrap_or_else(|error| panic!("{language}: {error}"));
        assert_eq!(result["nickname"], Value::Null, "{language}: {result}");
    }

    let union = parse_code_to_json_ast(
        "interface Root { child: Child | null; } interface Child { name: string; }",
        "typescript",
    )
    .unwrap();
    assert_eq!(union, serde_json::json!({ "child": null }));
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
                    { json: "profiles", js: "profiles", typ: a(r("Profile")) },
                    { json: "profilesById", js: "profilesById", typ: m(r("Profile")) },
                    { json: "optionalProfile", js: "optionalProfile", typ: u(undefined, r("Profile")) },
                ], false),
                "Profile": o([
                    { json: "score", js: "score", typ: 3.125 },
                ], false),
            };
        "#;

    assert_eq!(
        parse_code_to_json_ast(source, "javascript").unwrap(),
        serde_json::json!({
            "userId": 0,
            "displayName": "",
            "active": true,
            "tags": [],
            "profile": { "score": 3.125 },
            "profiles": [{ "score": 3.125 }],
            "profilesById": {},
            "optionalProfile": null,
        }),
    );
}

#[test]
fn go_json_tag_extracted() {
    let result =
        parse_code_to_json_ast("type User struct { Name string `json:\"name\"` }", "go").unwrap();
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
fn deeply_nested_javascript_literals_are_bounded() {
    let nesting = MAX_LITERAL_DEPTH + 32;
    let source = format!(
        "const Root = {}0{};",
        "{value:".repeat(nesting),
        "}".repeat(nesting)
    );
    let result = parse_code_to_json_ast(&source, "javascript").unwrap();
    let mut depth = 0;
    let mut current = &result;
    while let Value::Object(object) = current {
        depth += 1;
        let Some(value) = object.get("value") else {
            break;
        };
        current = value;
    }
    assert!(depth <= MAX_LITERAL_DEPTH + 1);
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

#[test]
fn typescript_nested_interfaces_are_materialized_at_the_reference_site() {
    let source = r#"
            export interface MyModel {
                properties: Properties;
            }

            export interface Properties {
                device_serial_no: DeviceSerialNo;
                device_model: Device;
                device_storage: Device;
                device_color: Device;
            }

            export interface Device {
                type: string;
            }

            export interface DeviceSerialNo {
                fields: Fields;
                type: string;
            }

            export interface Fields {
                keyword: Keyword;
            }

            export interface Keyword {
                ignore_above: number;
                type: string;
            }
        "#;

    let result = parse_code_to_json_ast(source, "typescript").unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "properties": {
                "device_serial_no": {
                    "fields": { "keyword": { "ignore_above": 0, "type": "" } },
                    "type": "",
                },
                "device_model": { "type": "" },
                "device_storage": { "type": "" },
                "device_color": { "type": "" },
            }
        })
    );
}

#[test]
fn syntax_errors_report_obvious_language_mismatches() {
    let error =
        parse_code_to_json_ast("export interface Root { value: string; }", "go").unwrap_err();
    assert!(error.contains("input looks like typescript"), "{error}");
}

#[test]
fn go_nested_structs_skip_unexported_fields_and_preserve_collections() {
    let source = r#"
            type Root struct {
                hidden Child `json:"hidden"`
                Visible *Child `json:"visible"`
                Items []*Child `json:"items"`
                Ignored string `json:"-"`
            }

            type Child struct {
                Name string `json:"name"`
                hidden string `json:"hidden"`
            }
        "#;

    let result = parse_code_to_json_ast(source, "go").unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "visible": { "name": "" },
            "items": [{ "name": "" }],
        })
    );
}

#[test]
fn go_generated_message_helpers_are_not_emitted() {
    let source = r#"
            type QueryPreValidationListRsp struct {
                state protoimpl.MessageState
                sizeCache protoimpl.SizeCache
                unknownFields protoimpl.UnknownFields
                Page *insurance_operator_bff_common.Page `protobuf:"bytes,1,opt,name=page,proto3" json:"page"`
                List []*PreValidation `protobuf:"bytes,2,rep,name=list,proto3" json:"list"`
            }

            type PreValidation struct {
                state protoimpl.MessageState
                sizeCache protoimpl.SizeCache
                unknownFields protoimpl.UnknownFields
                TraceId string `json:"trace_id"`
                ProductIdList []string `json:"product_id_list"`
                ProductFullNameList []string `json:"product_full_name_list"`
                AccountId string `json:"account_id"`
                ShopeeUid string `json:"shopee_uid"`
                VehicleNo string `json:"vehicle_no"`
                CertiType string `json:"certi_type"`
                CertiNo string `json:"certi_no"`
                ApiDetail *ApiDetail `json:"api_detail"`
            }

            type ApiDetail struct {
                state protoimpl.MessageState
                sizeCache protoimpl.SizeCache
                unknownFields protoimpl.UnknownFields
                Request string `json:"request"`
                Response string `json:"response"`
                ResponseSuccess bool `json:"response_success"`
                ErrorCode string `json:"error_code"`
                ErrorMsg string `json:"error_msg"`
                GmtCreated string `json:"gmt_created"`
                GmtModified string `json:"gmt_modified"`
            }
        "#;

    let result = parse_code_to_json_ast(source, "go").unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "page": {},
            "list": [{
                "trace_id": "",
                "product_id_list": [],
                "product_full_name_list": [],
                "account_id": "",
                "shopee_uid": "",
                "vehicle_no": "",
                "certi_type": "",
                "certi_no": "",
                "api_detail": {
                    "request": "",
                    "response": "",
                    "response_success": false,
                    "error_code": "",
                    "error_msg": "",
                    "gmt_created": "",
                    "gmt_modified": "",
                },
            }],
        })
    );
}

#[test]
fn recursive_references_are_bounded() {
    let source = "interface Node { next: Node; label: string; }";
    let result = parse_code_to_json_ast(source, "typescript").unwrap();
    assert_eq!(result["label"], "");
    assert!(result["next"].is_object());
}

#[test]
fn independent_recursive_components_keep_one_stable_root() {
    let source = r#"
        interface A { b: B }
        interface B { a: A }
        interface Root { name: string }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "A": { "b": { "a": {} } },
            "Root": { "name": "" },
        })
    );
}

#[test]
fn independent_roots_keep_their_names() {
    let result = parse_code_to_json_ast(
        "interface User { name: string; } interface Count { value: number; }",
        "typescript",
    )
    .unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "User": { "name": "" },
            "Count": { "value": 0 },
        })
    );
}

#[test]
fn empty_structures_are_represented_as_empty_objects() {
    let result = parse_code_to_json_ast("interface Empty {}", "typescript").unwrap();
    assert_eq!(result, serde_json::json!({}));

    let go_result = parse_code_to_json_ast("type Empty struct {}", "go").unwrap();
    assert_eq!(go_result, serde_json::json!({}));
}

#[test]
fn custom_map_values_use_an_empty_object_shape() {
    let result = parse_code_to_json_ast(
        "interface Root { by_id: Record<string, Child>; } interface Child { name: string; }",
        "typescript",
    )
    .unwrap();
    assert_eq!(result, serde_json::json!({ "by_id": {} }));
}

#[test]
fn nullable_custom_references_remain_null() {
    let result = parse_code_to_json_ast(
        "<?php class Root { public ?Child $child; } class Child { public string $name; }",
        "php",
    )
    .unwrap();
    assert_eq!(result, serde_json::json!({ "child": null }));
}

#[test]
fn php_named_type_references_are_nested() {
    let source = "<?php class Root { public Child $child; } class Child { public string $name; }";
    assert_eq!(
        parse_code_to_json_ast(source, "php").unwrap(),
        serde_json::json!({ "child": { "name": "" } })
    );
}

#[test]
fn go_inline_struct_fields_are_materialized_without_flattening() {
    let source = r#"
        type Root struct {
            Detail struct {
                Name string `json:"name"`
                hidden string
            } `json:"detail"`
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "go").unwrap(),
        serde_json::json!({ "detail": { "name": "" } })
    );
}

#[test]
fn go_inline_struct_collections_keep_their_outer_shape() {
    let source = r#"
        type Root struct {
            Items []struct { Name string `json:"name"` } `json:"items"`
            Matrix [][]struct { Active bool `json:"active"` } `json:"matrix"`
            Detail *struct { Count int `json:"count"` } `json:"detail"`
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "go").unwrap(),
        serde_json::json!({
            "items": [{ "name": "" }],
            "matrix": [[{ "active": false }]],
            "detail": { "count": 0 },
        })
    );
}

#[test]
fn go_named_struct_fields_are_the_primary_nested_case() {
    let source = r#"
        type Root struct { Items []Child `json:"items"` }
        type Child struct { Name string `json:"name"` }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "go").unwrap(),
        serde_json::json!({ "items": [{ "name": "" }] })
    );
}

#[test]
fn multiple_named_fields_in_one_declaration_are_collected() {
    let go = parse_code_to_json_ast("type Root struct { First, Second string; Count int }", "go")
        .unwrap();
    assert_eq!(
        go,
        serde_json::json!({ "First": "", "Second": "", "Count": 0 })
    );

    let java =
        parse_code_to_json_ast("class Root { String first, last; int count; }", "java").unwrap();
    assert_eq!(
        java,
        serde_json::json!({ "first": "", "last": "", "count": 0 })
    );

    let csharp =
        parse_code_to_json_ast("class Root { string first, last; int count; }", "csharp").unwrap();
    assert_eq!(
        csharp,
        serde_json::json!({ "first": "", "last": "", "count": 0 })
    );
}

#[test]
fn go_grouped_type_declarations_remain_independent() {
    let source = r#"
        type (
            Child struct { Name string `json:"name"` }
            Root struct { Kid Child `json:"kid"` }
            Other struct { Count int `json:"count"` }
        )
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "go").unwrap(),
        serde_json::json!({
            "Root": { "kid": { "name": "" } },
            "Other": { "count": 0 },
        })
    );
}

#[test]
fn nested_class_declarations_can_be_referenced() {
    let source = "class Root { Child child; static class Child { String name; } }";
    let result = parse_code_to_json_ast(source, "java").unwrap();
    assert_eq!(result, serde_json::json!({ "child": { "name": "" } }));

    let shadowed =
        "class Root { Child child; static class Child { String nested; } } class Child { String top; }";
    let result = parse_code_to_json_ast(shadowed, "java").unwrap();
    assert_eq!(
        result,
        serde_json::json!({
            "Root": { "child": { "nested": "" } },
            "Child": { "top": "" },
        })
    );
}

#[test]
fn qualified_type_references_do_not_merge_same_named_declarations() {
    let source = r#"
        namespace A { export interface Child { a: string } }
        namespace B { export interface Child { b: number } }
        interface Root { first: A.Child; second: B.Child }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "first": { "a": "" },
            "second": { "b": 0 },
        })
    );

    let external = r#"
        namespace Models { export interface Child { local: string } }
        interface Root { child: External.Child }
    "#;
    assert_eq!(
        parse_code_to_json_ast(external, "typescript").unwrap(),
        serde_json::json!({
            "Models.Child": { "local": "" },
            "Root": { "child": {} },
        })
    );

    let parent_scope = r#"
        namespace A {
            interface Child { parent: string }
            namespace B { interface Root { child: Child } }
        }
        namespace X { interface Child { other: number } }
    "#;
    assert_eq!(
        parse_code_to_json_ast(parent_scope, "typescript").unwrap(),
        serde_json::json!({ "A.B.Root": { "child": { "parent": "" } }, "X.Child": { "other": 0 } })
    );

    let top_level = r#"
        namespace A { interface Child { namespaced: string } }
        interface Child { top_level: number }
        interface Root { child: Child }
    "#;
    assert_eq!(
        parse_code_to_json_ast(top_level, "typescript").unwrap(),
        serde_json::json!({
            "A.Child": { "namespaced": "" },
            "Root": { "child": { "top_level": 0 } },
        })
    );
}

#[test]
fn csharp_global_type_paths_ignore_the_current_scope() {
    let csharp = r#"
        namespace Models {
            class Child { public string Name; }
        }
        namespace Feature {
            class Child { public int Local; }
            class Root { public global::Models.Child Value; }
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(csharp, "csharp").unwrap(),
        serde_json::json!({
            "Feature.Child": { "Local": 0 },
            "Feature.Root": { "Value": { "Name": "" } },
        })
    );
}

#[test]
fn rust_crate_type_paths_ignore_the_current_scope() {
    let rust = r#"
        mod models {
            struct Child { name: String }
        }
        mod feature {
            struct Child { local: i32 }
            struct Root { value: crate::models::Child }
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(rust, "rust").unwrap(),
        serde_json::json!({
            "feature.Child": { "local": 0 },
            "feature.Root": { "value": { "name": "" } },
        })
    );
}

#[test]
fn cpp_global_type_paths_ignore_the_current_scope() {
    let cpp = r#"
        namespace Models {
            struct Child { std::string global; };
        }
        namespace Feature {
            namespace Models {
                struct Child { int local; };
            }
            struct Root { ::Models::Child value; };
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(cpp, "cpp").unwrap(),
        serde_json::json!({
            "Feature.Models.Child": { "local": 0 },
            "Feature.Root": { "value": { "global": "" } },
        })
    );
}

#[test]
fn typescript_interface_declarations_merge_fields() {
    let source =
        "interface User { name: string; } interface User { age: number; active: boolean; }";
    let result = parse_code_to_json_ast(source, "typescript").unwrap();
    assert_eq!(
        result,
        serde_json::json!({ "name": "", "age": 0, "active": false })
    );
}

#[test]
fn simple_type_aliases_preserve_nested_shapes() {
    let typescript = r#"
        interface Root { users: UserList; }
        type UserList = User[];
        interface User { name: string; }
    "#;
    assert_eq!(
        parse_code_to_json_ast(typescript, "typescript").unwrap(),
        serde_json::json!({ "users": [{ "name": "" }] })
    );

    let scalar = "interface Root { id: ID; } type ID = string;";
    assert_eq!(
        parse_code_to_json_ast(scalar, "typescript").unwrap(),
        serde_json::json!({ "id": "" })
    );

    let go = r#"
        type UserList []User
        type Root struct { Users UserList `json:"users"` }
        type User struct { Name string `json:"name"` }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go, "go").unwrap(),
        serde_json::json!({ "users": [{ "name": "" }] })
    );

    let go_alias = r#"
        type UserAlias = User
        type Root struct { User UserAlias `json:"user"` }
        type User struct { Name string `json:"name"` }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go_alias, "go").unwrap(),
        serde_json::json!({ "user": { "name": "" } })
    );

    let go_root = r#"
        type Root []User
        type User struct { Name string `json:"name"` }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go_root, "go").unwrap(),
        serde_json::json!([{ "name": "" }])
    );
    assert_eq!(
        parse_code_to_json_ast("type Root []string", "go").unwrap(),
        serde_json::json!([])
    );
}

#[test]
fn simple_generic_structures_substitute_type_parameters() {
    let source = r#"
        interface Root { page: Page<User>; }
        interface Page<T> { current: T; items: T[]; }
        interface User { name: string; }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "page": {
                "current": { "name": "" },
                "items": [{ "name": "" }],
            }
        })
    );

    let go = r#"
        type Root struct { Page Page[User] `json:"page"` }
        type Page[T any] struct {
            Current T `json:"current"`
            Items []T `json:"items"`
        }
        type User struct { Name string `json:"name"` }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go, "go").unwrap(),
        serde_json::json!({
            "page": {
                "current": { "name": "" },
                "items": [{ "name": "" }],
            }
        })
    );

    let alias = r#"
        interface Root { users: Box<User>; }
        type Box<T> = T[];
        interface User { name: string; }
    "#;
    assert_eq!(
        parse_code_to_json_ast(alias, "typescript").unwrap(),
        serde_json::json!({ "users": [{ "name": "" }] })
    );

    let scalar = r#"
        interface Root { page: Page<string>; value: Box<number>; }
        interface Page<T> { value: T; }
        type Box<T> = T;
    "#;
    assert_eq!(
        parse_code_to_json_ast(scalar, "typescript").unwrap(),
        serde_json::json!({ "page": { "value": "" }, "value": 0 })
    );
}

#[test]
fn generic_inline_objects_preserve_the_outer_structure() {
    let source = r#"
        interface Box<T> { value: T; items: T[]; }
        interface Pair<A, B> { first: A; second: B; }
        type ListBox<T> = T[];
        interface Root {
            box: Box<{ name: string, count: number }>;
            pair: Pair<{ left: string, active: boolean }, { right: number }>;
            aliases: ListBox<{ id: number, label: string }>;
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "box": {
                "value": { "name": "", "count": 0 },
                "items": [{ "name": "", "count": 0 }],
            },
            "pair": {
                "first": { "left": "", "active": false },
                "second": { "right": 0 },
            },
            "aliases": [{ "id": 0, "label": "" }],
        })
    );

    let go = r#"
        type Pair[A, B any] struct {
            First A `json:"first"`
            Second B `json:"second"`
        }
        type Root struct {
            Pair Pair[struct { Left string `json:"left"` }, struct { Right int `json:"right"` }] `json:"pair"`
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go, "go").unwrap(),
        serde_json::json!({
            "pair": {
                "first": { "left": "" },
                "second": { "right": 0 },
            }
        })
    );
}

#[test]
fn typescript_generic_inline_arguments_preserve_nested_field_wrappers() {
    let typescript = r#"
        interface Envelope<T> {
            nested: {
                value: T;
                values: T[];
            };
        }
        interface Root {
            payload: Envelope<{ id: number }>;
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(typescript, "typescript").unwrap(),
        serde_json::json!({
            "payload": {
                "nested": {
                    "value": { "id": 0 },
                    "values": [{ "id": 0 }],
                },
            },
        })
    );
}

#[test]
fn go_generic_inline_arguments_preserve_nested_field_wrappers() {
    let go = r#"
        type Envelope[T any] struct {
            Nested struct {
                Value T `json:"value"`
                Values []T `json:"values"`
            } `json:"nested"`
        }
        type Root struct {
            Payload Envelope[struct { ID int `json:"id"` }] `json:"payload"`
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go, "go").unwrap(),
        serde_json::json!({
            "payload": {
                "nested": {
                    "value": { "id": 0 },
                    "values": [{ "id": 0 }],
                },
            },
        })
    );
}

#[test]
fn typescript_tuple_preserves_every_position() {
    let source = r#"
        interface Root {
            direct: [{ left: string }, { right: number }];
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "direct": [{ "left": "" }, { "right": 0 }],
        })
    );
}

#[test]
fn typescript_generic_tuple_alias_preserves_every_position() {
    let source = r#"
        type Pair<A, B> = [A, B];
        interface Root {
            generic: Pair<{ first: string }, { second: boolean }>;
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "generic": [{ "first": "" }, { "second": false }],
        })
    );
}

#[test]
fn parenthesized_tuple_types_preserve_every_position() {
    let rust = r#"
        struct Root { pair: (Left, Right) }
        struct Left { name: String }
        struct Right { count: i32 }
    "#;
    assert_eq!(
        parse_code_to_json_ast(rust, "rust").unwrap(),
        serde_json::json!({
            "pair": [{ "name": "" }, { "count": 0 }],
        })
    );

    let csharp = r#"
        class Root { public (Left left, Right right) pair; }
        class Left { public string name; }
        class Right { public int count; }
    "#;
    assert_eq!(
        parse_code_to_json_ast(csharp, "csharp").unwrap(),
        serde_json::json!({
            "pair": [{ "name": "" }, { "count": 0 }],
        })
    );
}

#[test]
fn typescript_labeled_tuples_preserve_labels_as_positions() {
    let source = r#"
        type Pair<T> = [value: T, count: number];
        interface Root {
            direct: [child: Child, count: number];
            generic: Pair<{ id: string }>;
        }
        interface Child { name: string }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "direct": [{ "name": "" }, 0],
            "generic": [{ "id": "" }, 0],
        })
    );
}

#[test]
fn nested_generic_inline_arguments_keep_all_inline_groups() {
    let source = r#"
        interface Pair<A, B> { first: A; second: B }
        interface Wrapper<T> {
            mixed: Pair<{ fixed: string }, T>;
            repeated: Pair<T, T>;
        }
        interface Root {
            value: Wrapper<Pair<{ left: string }, { right: number }>>;
        }
    "#;
    let nested = serde_json::json!({
        "first": { "left": "" },
        "second": { "right": 0 },
    });
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "value": {
                "mixed": {
                    "first": { "fixed": "" },
                    "second": nested.clone(),
                },
                "repeated": {
                    "first": nested.clone(),
                    "second": nested,
                },
            },
        })
    );
}

#[test]
fn go_nested_generic_inline_arguments_keep_all_inline_groups() {
    let source = r#"
        type Pair[A, B any] struct {
            First A `json:"first"`
            Second B `json:"second"`
        }
        type Wrapper[T any] struct {
            Mixed Pair[struct { Fixed string `json:"fixed"` }, T] `json:"mixed"`
            Repeated Pair[T, T] `json:"repeated"`
        }
        type Root struct {
            Value Wrapper[Pair[
                struct { Left string `json:"left"` },
                struct { Right int `json:"right"` },
            ]] `json:"value"`
        }
    "#;
    let nested = serde_json::json!({
        "first": { "left": "" },
        "second": { "right": 0 },
    });
    assert_eq!(
        parse_code_to_json_ast(source, "go").unwrap(),
        serde_json::json!({
            "value": {
                "mixed": {
                    "first": { "fixed": "" },
                    "second": nested.clone(),
                },
                "repeated": {
                    "first": nested.clone(),
                    "second": nested,
                },
            },
        })
    );
}

#[test]
fn typescript_generic_parameters_do_not_reference_same_named_global_declarations() {
    let typescript = r#"
        interface Item { global: string }
        interface Box<Item> { value: Item }
        interface Root { box: Box<number> }
    "#;
    assert_eq!(
        parse_code_to_json_ast(typescript, "typescript").unwrap(),
        serde_json::json!({
            "Item": { "global": "" },
            "Root": { "box": { "value": 0 } },
        })
    );
}

#[test]
fn go_generic_parameters_do_not_reference_same_named_global_declarations() {
    let go = r#"
        type Item struct { Global string `json:"global"` }
        type Box[Item any] struct { Value Item `json:"value"` }
        type Root struct { Box Box[int] `json:"box"` }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go, "go").unwrap(),
        serde_json::json!({
            "Item": { "global": "" },
            "Root": { "box": { "value": 0 } },
        })
    );
}

#[test]
fn uninstantiated_generic_parameters_remain_unknown() {
    let typescript = r#"
        interface Item { global: string }
        interface Box<Item> { value: Item }
    "#;
    assert_eq!(
        parse_code_to_json_ast(typescript, "typescript").unwrap(),
        serde_json::json!({
            "Item": { "global": "" },
            "Box": { "value": {} },
        })
    );

    let go = r#"
        type Item struct { Global string `json:"global"` }
        type Box[Item any] struct { Value Item `json:"value"` }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go, "go").unwrap(),
        serde_json::json!({
            "Item": { "global": "" },
            "Box": { "value": {} },
        })
    );
}

#[test]
fn rust_lifetimes_do_not_hide_generic_type_arguments() {
    let rust = r#"
        struct Root { item: Ref<'static, User> }
        struct Ref<'a, T> { value: &'a T }
        struct User { name: String }
    "#;
    assert_eq!(
        parse_code_to_json_ast(rust, "rust").unwrap(),
        serde_json::json!({
            "item": { "value": { "name": "" } },
        })
    );
}

#[test]
fn finite_nested_generic_instances_expand_fully() {
    let source = r#"
        interface Root { box: Box<Box<User>>; }
        interface Box<T> { value: T; }
        interface User { name: string; }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({ "box": { "value": { "value": { "name": "" } } } })
    );
}

#[test]
fn common_container_variants_keep_their_nested_shape() {
    let go = r#"
        const Size = 2
        type Root struct { Values [Size]Child `json:"values"` }
        type Child struct { Name string `json:"name"` }
    "#;
    assert_eq!(
        parse_code_to_json_ast(go, "go").unwrap(),
        serde_json::json!({ "values": [{ "name": "" }] })
    );

    let java = "class Root { List<? extends Child> children; } class Child { String name; }";
    assert_eq!(
        parse_code_to_json_ast(java, "java").unwrap(),
        serde_json::json!({ "children": [{ "name": "" }] })
    );

    let csharp = "class Root { public Child[,] children; } class Child { public string name; }";
    assert_eq!(
        parse_code_to_json_ast(csharp, "csharp").unwrap(),
        serde_json::json!({ "children": [[{ "name": "" }]] })
    );
}

#[test]
fn index_signatures_and_forward_references_keep_object_shapes() {
    let typescript = r#"
        interface Root { lookup: { [key: string]: Child } }
        interface Child { name: string }
    "#;
    assert_eq!(
        parse_code_to_json_ast(typescript, "typescript").unwrap(),
        serde_json::json!({ "lookup": {} })
    );

    let python = "class Root:\n    child: 'Child'\n\nclass Child:\n    name: str";
    assert_eq!(
        parse_code_to_json_ast(python, "python").unwrap(),
        serde_json::json!({ "child": { "name": "" } })
    );
}

#[test]
fn changing_generic_arguments_cannot_expand_recursively() {
    let source = r#"
        interface Node<T> {
            left: Node<T[]>;
            right: Node<T[]>;
        }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({ "left": {}, "right": {} })
    );
}

#[test]
fn typescript_inline_object_types_are_nested() {
    let source = "interface Root { detail: { name: string; }; items: { id: number }[]; }";
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({
            "detail": { "name": "" },
            "items": [{ "id": 0 }],
        })
    );
}

#[test]
fn typescript_literal_property_names_are_preserved() {
    let source = r#"interface Root { "foo-bar": string; 123: number; }"#;
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({ "foo-bar": "", "123": 0 })
    );
}

#[test]
fn inline_object_references_are_resolved_without_extra_roots() {
    let source = "interface Root { detail: { child: Child }; } interface Child { name: string; }";
    assert_eq!(
        parse_code_to_json_ast(source, "typescript").unwrap(),
        serde_json::json!({ "detail": { "child": { "name": "" } } })
    );
}

#[test]
fn nested_type_references_expand_across_common_grammars() {
    let cases = [
        (
            "typescript",
            "interface Root { child: Child; children: Child[]; } interface Child { name: string; }",
        ),
        (
            "java",
            "class Root { Child child; Child[] children; } class Child { String name; }",
        ),
        (
            "kotlin",
            "data class Root(val child: Child, val children: List<Child>)\ndata class Child(val name: String)",
        ),
        (
            "rust",
            "struct Root { child: Child, children: Vec<Child> } struct Child { name: String }",
        ),
        (
            "python",
            "class Child:\n    name: str\n\nclass Root:\n    child: Child\n    children: list[Child]",
        ),
        (
            "swift",
            "struct Root {\n let child: Child\n let children: [Child]\n}\nstruct Child {\n let name: String\n}",
        ),
        (
            "csharp",
            "class Root { public Child child { get; set; } public List<Child> children { get; set; } } class Child { public string name { get; set; } }",
        ),
        (
            "dart",
            "class Root { Child child; List<Child> children; } class Child { String name; }",
        ),
        (
            "scala",
            "case class Root(child: Child, children: List[Child]); case class Child(name: String)",
        ),
        (
            "cpp",
            "struct Child { std::string name; }; struct Root { Child child; std::vector<Child> children; };",
        ),
        (
            "objectivec",
            "@interface Root : NSObject\n@property Child *child;\n@property NSArray<Child *> *children;\n@end\n@interface Child : NSObject\n@property NSString *name;\n@end",
        ),
        (
            "protobuf",
            "message Root { Child child = 1; repeated Child children = 2; } message Child { string name = 1; }",
        ),
        (
            "thrift",
            "struct Root { 1: Child child, 2: list<Child> children } struct Child { 1: string name }",
        ),
    ];

    for (language, source) in cases {
        let result = parse_code_to_json_ast(source, language)
            .unwrap_or_else(|error| panic!("{language}: {error}"));
        assert_eq!(result["child"]["name"], "", "{language}: {result}");
        assert_eq!(result["children"][0]["name"], "", "{language}: {result}");
    }
}

#[test]
fn static_and_python_classvar_members_are_not_json_fields_or_roots() {
    let typescript = r#"
        interface Root { child: Child }
        interface Child { name: string }
        class Converter { static settings: Child }
    "#;
    assert_eq!(
        parse_code_to_json_ast(typescript, "typescript").unwrap(),
        serde_json::json!({ "child": { "name": "" } })
    );

    let python = r#"
        class Root:
            child: Child

        class Child:
            name: str

        class Converter:
            settings: ClassVar[Child]
    "#;
    assert_eq!(
        parse_code_to_json_ast(python, "python").unwrap(),
        serde_json::json!({ "child": { "name": "" } })
    );

    let csharp = r#"
        class Root { public Child child; }
        class Child { public string name; }
        internal static class Converter { internal static Child Settings; }
    "#;
    assert_eq!(
        parse_code_to_json_ast(csharp, "csharp").unwrap(),
        serde_json::json!({ "child": { "name": "" } })
    );
}

#[test]
fn dart_constructors_do_not_create_pseudo_fields() {
    let source = r#"
        class Root {
            String name;
            List<Child> children;
            Root({required this.name, required this.children});
        }
        class Child { String label; Child({required this.label}); }
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "dart").unwrap(),
        serde_json::json!({
            "name": "",
            "children": [{ "label": "" }],
        })
    );
}

#[test]
fn objectivec_property_attributes_do_not_replace_property_names() {
    let source = r#"
        @interface Root : NSObject
        @property (nonatomic, copy) NSString *name;
        @property (nonatomic, copy) NSArray<Child *> *children;
        @end
        @interface Child : NSObject
        @property (nonatomic, copy) NSString *label;
        @end
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "objectivec").unwrap(),
        serde_json::json!({
            "name": "",
            "children": [{ "label": "" }],
        })
    );
}

#[test]
fn ruby_attributes_preserve_scalar_and_array_types() {
    let source = r#"
        class Root < Dry::Struct
            attribute :name, Types::String
            attribute :count, Types::Integer
            attribute :children, Types.Array(Child)
        end
        class Child < Dry::Struct
            attribute :label, Types::String
        end
    "#;
    assert_eq!(
        parse_code_to_json_ast(source, "ruby").unwrap(),
        serde_json::json!({
            "name": "",
            "count": 0,
            "children": [{ "label": "" }],
        })
    );
}

#[test]
fn common_numeric_and_container_aliases_keep_their_shapes() {
    let csharp = r#"
        class Root { public IList<Child> items; public float64 value; }
        class Child { public string name; }
    "#;
    assert_eq!(
        parse_code_to_json_ast(csharp, "csharp").unwrap(),
        serde_json::json!({ "items": [{ "name": "" }], "value": 0 })
    );

    let scala = "case class Root(items: Seq[Child], value: Double); case class Child(name: String)";
    assert_eq!(
        parse_code_to_json_ast(scala, "scala").unwrap(),
        serde_json::json!({ "items": [{ "name": "" }], "value": 0 })
    );

    let cpp = "struct Root { int64_t value; std::unordered_set<Child> items; }; struct Child { std::string name; };";
    assert_eq!(
        parse_code_to_json_ast(cpp, "cpp").unwrap(),
        serde_json::json!({ "value": 0, "items": [{ "name": "" }] })
    );
}

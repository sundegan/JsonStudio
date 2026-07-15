import test from "node:test";
import assert from "node:assert/strict";
import {
  canExtractLogJsonFragments,
  extractLogJsonFragments,
  getStandaloneEscapedJsonContent,
} from "../src/lib/services/logJsonFragments.js";

test("runs extraction for every bounded nonempty document", () => {
  assert.equal(canExtractLogJsonFragments('{"id":1}'), true);
  assert.equal(canExtractLogJsonFragments('INFO payload={"id":1}'), true);
  assert.equal(canExtractLogJsonFragments("   \n\t"), false);
  assert.equal(canExtractLogJsonFragments("x".repeat(5), 4), false);
});

test("extracts a complete JSON document as one fragment", () => {
  const fragments = extractLogJsonFragments('{"id":1,"ok":true}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "Fragment 1");
  assert.equal(fragments[0].kind, "JSON");
  assert.equal(fragments[0].formatted, '{\n  "id": 1,\n  "ok": true\n}');
});

test("extracts a JSON payload from mixed log text", () => {
  const fragments = extractLogJsonFragments(
    'INFO trace=abc payload={"id":1,"path":"/api"} cost=12ms',
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "payload");
  assert.equal(fragments[0].line, 1);
  assert.equal(fragments[0].formatted, '{\n  "id": 1,\n  "path": "/api"\n}');
});

test("extracts multiple JSON fragments from log text", () => {
  const fragments = extractLogJsonFragments(
    'INFO req={"id":1} res={"code":200,"data":{"ok":true}}',
  );

  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].label, "req");
  assert.equal(fragments[1].label, "res");
  assert.equal(
    fragments[1].formatted,
    '{\n  "code": 200,\n  "data": {\n    "ok": true\n  }\n}',
  );
});

test("keeps duplicate fragments at different positions", () => {
  const fragments = extractLogJsonFragments('INFO req={"id":1} retry={"id":1}');

  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].label, "req");
  assert.equal(fragments[1].label, "retry");
});

test("does not let invalid bracket prefixes hide later JSON payloads", () => {
  const prefix = Array.from(
    { length: 25 },
    (_, index) => `[INFO${index}]`,
  ).join(" ");
  const fragments = extractLogJsonFragments(`${prefix} payload={"id":1}`);

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "payload");
});

test("extracts nested JSON payloads from log envelopes with bracket markers", () => {
  const log = String.raw`2026-06-04 18:48:25.923768	[6b3d81e51e2b8913439c17372077b8aa] [INFO] [PH]	[rpc_log_wrapper.go/121: 1] [1780570105923755786]Service Called Request: {serviceName:BasicService.BatchQueryRecommendInfo, clientHost:10.196.55.183, clientService:insurance.unified.gateway, req:{"user_id":0,"account_id":0,"lang":"","source":0,"req_list":[{"resource_code":"homepage:banner","id_type":0,"refer_id":"","extend":"{\"spp_biz_id\":\"c202a7326b2c68213bb8f69e053c0a60\"}"},{"resource_code":"homepage:pop_up","id_type":0,"refer_id":"","extend":"{\"spp_biz_id\":\"e232a53ae392039a571457639451263b\"}"},{"resource_code":"homepage:recommend","id_type":0,"refer_id":"","extend":""},{"resource_code":"standalone_homepage:voucher","id_type":0,"refer_id":"","extend":""},{"resource_code":"homepage:referral","id_type":0,"refer_id":"","extend":""},{"resource_code":"homepage:review","id_type":0,"refer_id":"","extend":""},{"resource_code":"homepage:icon","id_type":0,"refer_id":"","extend":""}],"extend":""}}`;
  const fragments = extractLogJsonFragments(log);

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "req");
  assert.match(fragments[0].formatted, /"resource_code": "homepage:banner"/);
  assert.doesNotMatch(fragments[0].formatted, /1780570105923755800/);
});

test("prefers explicitly labeled JSON payloads without depending on field names", () => {
  const fragments = extractLogJsonFragments(
    'INFO wrapper={operation:Foo.Bar, payloadBody:{"id":1,"ok":true}}',
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "payloadBody");
  assert.equal(fragments[0].kind, "JSON");
  assert.equal(fragments[0].formatted, '{\n  "id": 1,\n  "ok": true\n}');
});

test("repairs JSON-like log payloads", () => {
  const fragments = extractLogJsonFragments(
    "payload={userId: 1, name: 'Alice',}",
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].kind, "JSON5");
  assert.equal(
    fragments[0].formatted,
    '{\n  "userId": 1,\n  "name": "Alice"\n}',
  );
});

test("extracts Java toString values with nested objects and collections", () => {
  const fragments = extractLogJsonFragments(
    "INFO result=UserDTO{id=1001, name=Alice, active=true, profile=Profile{city=Hangzhou}, tags=[admin, ops]} cost=2ms",
  );
  const unlabelled = extractLogJsonFragments(
    "2026-07-15 INFO User{id=2, active=false} completed",
  );
  const map = extractLogJsonFragments(
    "INFO attributes={id=1001, active=true, profile={city=Hangzhou}} done",
  );
  const qualified = extractLogJsonFragments(
    "INFO dto=com.example.User@1a2b{id=3, role=Optional[Role{name=admin}], metadata={source=api}} done",
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "result");
  assert.equal(fragments[0].kind, "Java/Kotlin toString");
  assert.deepEqual(JSON.parse(fragments[0].formatted), {
    id: 1001,
    name: "Alice",
    active: true,
    profile: { city: "Hangzhou" },
    tags: ["admin", "ops"],
  });
  assert.equal(unlabelled.length, 1);
  assert.equal(unlabelled[0].label, "Fragment 1");
  assert.deepEqual(JSON.parse(unlabelled[0].formatted), {
    id: 2,
    active: false,
  });
  assert.equal(map.length, 1);
  assert.equal(map[0].label, "attributes");
  assert.equal(map[0].kind, "Java/Kotlin toString");
  assert.deepEqual(JSON.parse(map[0].formatted), {
    id: 1001,
    active: true,
    profile: { city: "Hangzhou" },
  });
  assert.equal(qualified.length, 1);
  assert.equal(qualified[0].label, "dto");
  assert.equal(qualified[0].kind, "Java/Kotlin toString");
  assert.deepEqual(JSON.parse(qualified[0].formatted), {
    id: 3,
    role: { name: "admin" },
    metadata: { source: "api" },
  });
});

test("extracts Kotlin data class output through the JVM equals parser", () => {
  const fragments = extractLogJsonFragments(
    "INFO payload=User(id=1001, name=Alice, active=true, profile=Profile(city=Hangzhou), tags=[admin, ops], deletedAt=null) done",
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "payload");
  assert.equal(fragments[0].kind, "Java/Kotlin toString");
  assert.deepEqual(JSON.parse(fragments[0].formatted), {
    id: 1001,
    name: "Alice",
    active: true,
    profile: { city: "Hangzhou" },
    tags: ["admin", "ops"],
    deletedAt: null,
  });
});

test("extracts C# record output with nested records and .NET booleans", () => {
  const fragments = extractLogJsonFragments(
    "INFO payload=Acme.User { Id = 1001, Name = Alice, IsActive = True, Profile = Profile { City = Hangzhou, Verified = False }, Tags = [admin, ops], DeletedAt = null } done",
  );
  const lowerCaseProperties = extractLogJsonFragments(
    "INFO payload=User { id = 1002, isActive = True, deletedAt = null } done",
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "payload");
  assert.equal(fragments[0].kind, "C# record");
  assert.deepEqual(JSON.parse(fragments[0].formatted), {
    Id: 1001,
    Name: "Alice",
    IsActive: true,
    Profile: { City: "Hangzhou", Verified: false },
    Tags: ["admin", "ops"],
    DeletedAt: null,
  });
  assert.equal(lowerCaseProperties.length, 1);
  assert.equal(lowerCaseProperties[0].kind, "C# record");
  assert.deepEqual(JSON.parse(lowerCaseProperties[0].formatted), {
    id: 1002,
    isActive: true,
    deletedAt: null,
  });
});

test("extracts Go fmt struct and map output", () => {
  const structFragments = extractLogJsonFragments(
    "INFO user={ID:1001 Name:Alice Active:true Profile:{City:Hangzhou} Tags:[admin ops]} cost=2ms",
  );
  const mapFragments = extractLogJsonFragments(
    "INFO cache=map[id:1001 name:Alice active:true roles:[admin ops]] cost=2ms",
  );
  const typedFragments = extractLogJsonFragments(
    'DEBUG result=main.User{ID:1001, Name:"Alice", Active:true} done',
  );
  const typedMapFragments = extractLogJsonFragments(
    'INFO payload=map[string]interface{}{"id":1001,"active":true} done',
  );
  const nestedTypedMapFragments = extractLogJsonFragments(
    'INFO payload=map[string]interface {}{"profile":main.Profile{City:"Hangzhou"}} done',
  );
  const pointerFragments = extractLogJsonFragments(
    "INFO user=&main.User{ID:1001, Active:true} done",
  );
  const collectionFragments = extractLogJsonFragments(
    'DEBUG order={ID:7 Name:"Alice Smith" Enabled:false Deleted:nil Items:[]main.Item{main.Item{ID:1, Name:"A"}, main.Item{ID:2, Name:"B"}}} done',
  );

  assert.equal(structFragments.length, 1);
  assert.equal(structFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(structFragments[0].formatted), {
    ID: 1001,
    Name: "Alice",
    Active: true,
    Profile: { City: "Hangzhou" },
    Tags: ["admin", "ops"],
  });
  assert.equal(mapFragments.length, 1);
  assert.equal(mapFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(mapFragments[0].formatted), {
    id: 1001,
    name: "Alice",
    active: true,
    roles: ["admin", "ops"],
  });
  assert.equal(typedFragments.length, 1);
  assert.equal(typedFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(typedFragments[0].formatted), {
    ID: 1001,
    Name: "Alice",
    Active: true,
  });
  assert.equal(typedMapFragments.length, 1);
  assert.equal(typedMapFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(typedMapFragments[0].formatted), {
    id: 1001,
    active: true,
  });
  assert.equal(nestedTypedMapFragments.length, 1);
  assert.equal(nestedTypedMapFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(nestedTypedMapFragments[0].formatted), {
    profile: { City: "Hangzhou" },
  });
  assert.equal(pointerFragments.length, 1);
  assert.equal(pointerFragments[0].label, "user");
  assert.equal(pointerFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(pointerFragments[0].formatted), {
    ID: 1001,
    Active: true,
  });
  assert.equal(collectionFragments.length, 1);
  assert.equal(collectionFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(collectionFragments[0].formatted), {
    ID: 7,
    Name: "Alice Smith",
    Enabled: false,
    Deleted: null,
    Items: [
      { ID: 1, Name: "A" },
      { ID: 2, Name: "B" },
    ],
  });
});

test("keeps colons and spaces inside Go fmt %+v field values", () => {
  const messageFragments = extractLogJsonFragments(
    "INFO event={Level:info Msg:connection refused: timeout Code:5}",
  );
  const trailingProseFragments = extractLogJsonFragments(
    "INFO event={Status:ok Detail:retry later: giving up}",
  );

  assert.equal(messageFragments.length, 1);
  assert.equal(messageFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(messageFragments[0].formatted), {
    Level: "info",
    Msg: "connection refused: timeout",
    Code: 5,
  });
  assert.equal(trailingProseFragments.length, 1);
  assert.equal(trailingProseFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(trailingProseFragments[0].formatted), {
    Status: "ok",
    Detail: "retry later: giving up",
  });
});

test("parses a top-level bare Go fmt %+v struct without a log prefix", () => {
  const fragments = extractLogJsonFragments(
    "{Level:info Msg:connection refused: timeout Code:5}",
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(fragments[0].formatted), {
    Level: "info",
    Msg: "connection refused: timeout",
    Code: 5,
  });
});

test("still repairs comma-delimited JSON5 rather than treating it as Go fmt", () => {
  const unquotedKeys = extractLogJsonFragments('{name: "Alice", age: 30}');
  const trailingComma = extractLogJsonFragments('{"a": 1,}');

  assert.equal(unquotedKeys.length, 1);
  assert.equal(unquotedKeys[0].kind, "JSON5");
  assert.deepEqual(JSON.parse(unquotedKeys[0].formatted), {
    name: "Alice",
    age: 30,
  });
  assert.equal(trailingComma.length, 1);
  assert.deepEqual(JSON.parse(trailingComma[0].formatted), { a: 1 });
});

test("extracts Go typed slice and array literals at the top level", () => {
  const sliceFragments = extractLogJsonFragments("INFO nums=[]int{1, 2, 3}");
  const arrayFragments = extractLogJsonFragments("INFO nums=[3]int{10, 20, 30}");
  const stringSliceFragments = extractLogJsonFragments(
    'INFO tags=[]string{"a", "b"}',
  );
  const structSliceFragments = extractLogJsonFragments(
    "INFO items=[]*main.Item{main.Item{ID:1}, main.Item{ID:2}}",
  );
  const multiDimFragments = extractLogJsonFragments(
    "INFO grid=[][]int{[]int{1, 2}, []int{3}}",
  );
  const nestedArrayFragments = extractLogJsonFragments(
    "INFO s={Vals:[3]int{1, 2, 3} N:1}",
  );

  assert.equal(sliceFragments.length, 1);
  assert.equal(sliceFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(sliceFragments[0].formatted), [1, 2, 3]);
  assert.equal(arrayFragments.length, 1);
  assert.equal(arrayFragments[0].kind, "Go fmt");
  assert.deepEqual(JSON.parse(arrayFragments[0].formatted), [10, 20, 30]);
  assert.deepEqual(JSON.parse(stringSliceFragments[0].formatted), ["a", "b"]);
  assert.deepEqual(JSON.parse(structSliceFragments[0].formatted), [
    { ID: 1 },
    { ID: 2 },
  ]);
  assert.deepEqual(JSON.parse(multiDimFragments[0].formatted), [[1, 2], [3]]);
  assert.deepEqual(JSON.parse(nestedArrayFragments[0].formatted), {
    Vals: [1, 2, 3],
    N: 1,
  });
});

test("extracts Python repr values with explicit Python literals", () => {
  const ordered = extractLogJsonFragments(
    "DEBUG cache=OrderedDict([('enabled', True), ('count', 2)])",
  );
  const dataclass = extractLogJsonFragments(
    "INFO user=User(id=1, active=True, value=None)",
  );
  const nested = extractLogJsonFragments(
    'INFO user=User(id=2, active=True, metadata={"tier": "gold", "enabled": False}, tags=["admin", None]) done',
  );

  assert.equal(ordered.length, 1);
  assert.equal(ordered[0].kind, "Python repr");
  assert.deepEqual(JSON.parse(ordered[0].formatted), {
    enabled: true,
    count: 2,
  });
  assert.equal(dataclass.length, 1);
  assert.equal(dataclass[0].kind, "Python repr");
  assert.deepEqual(JSON.parse(dataclass[0].formatted), {
    id: 1,
    active: true,
    value: null,
  });
  assert.equal(nested.length, 1);
  assert.equal(nested[0].kind, "Python repr");
  assert.deepEqual(JSON.parse(nested[0].formatted), {
    id: 2,
    active: true,
    metadata: { tier: "gold", enabled: false },
    tags: ["admin", null],
  });
});

test("extracts Rust Debug structures, Result values, and maps", () => {
  const structure = extractLogJsonFragments(
    'INFO user=User { id: 1001, active: true, profile: Some(Profile { city: "Hangzhou" }), tags: ["admin", "ops"], missing: None } done',
  );
  const result = extractLogJsonFragments(
    "DEBUG result=Ok(Event::Updated { id: 2, note: None }) done",
  );
  const map = extractLogJsonFragments(
    'INFO cache={"owner": Some(User { id: 7 }), "enabled": true, "missing": None} done',
  );
  const enumValue = extractLogJsonFragments(
    "INFO event=crate::Event::Created { request_id: 3, success: true } done",
  );
  const error = extractLogJsonFragments(
    'WARN response=Err(ApiError { code: 503, retryable: false, r#type: "upstream" }) done',
  );

  assert.equal(structure.length, 1);
  assert.equal(structure[0].label, "user");
  assert.equal(structure[0].kind, "Rust Debug");
  assert.deepEqual(JSON.parse(structure[0].formatted), {
    id: 1001,
    active: true,
    profile: { city: "Hangzhou" },
    tags: ["admin", "ops"],
    missing: null,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].label, "result");
  assert.equal(result[0].kind, "Rust Debug");
  assert.deepEqual(JSON.parse(result[0].formatted), { id: 2, note: null });
  assert.equal(map.length, 1);
  assert.equal(map[0].label, "cache");
  assert.equal(map[0].kind, "Rust Debug");
  assert.deepEqual(JSON.parse(map[0].formatted), {
    owner: { id: 7 },
    enabled: true,
    missing: null,
  });
  assert.equal(enumValue.length, 1);
  assert.equal(enumValue[0].kind, "Rust Debug");
  assert.deepEqual(JSON.parse(enumValue[0].formatted), {
    request_id: 3,
    success: true,
  });
  assert.equal(error.length, 1);
  assert.equal(error[0].kind, "Rust Debug");
  assert.deepEqual(JSON.parse(error[0].formatted), {
    code: 503,
    retryable: false,
    type: "upstream",
  });
});

test("extracts Rust anonymous tuples as JSON arrays", () => {
  const bareTuple = extractLogJsonFragments("DEBUG coord=(1, 2, 3)");
  const mixedTuple = extractLogJsonFragments('DEBUG pair=(1, "a")');
  const tupleField = extractLogJsonFragments("DEBUG point=X { pos: (1, 2) }");
  const vecOfTuples = extractLogJsonFragments(
    'DEBUG entries=[(1, "a"), (2, "b")]',
  );
  const nestedTuple = extractLogJsonFragments(
    "DEBUG pair=X { pair: (1, (2, 3)) }",
  );

  assert.equal(bareTuple.length, 1);
  assert.equal(bareTuple[0].kind, "Rust Debug");
  assert.deepEqual(JSON.parse(bareTuple[0].formatted), [1, 2, 3]);
  assert.deepEqual(JSON.parse(mixedTuple[0].formatted), [1, "a"]);
  assert.deepEqual(JSON.parse(tupleField[0].formatted), { pos: [1, 2] });
  assert.equal(vecOfTuples[0].kind, "Rust Debug");
  assert.deepEqual(JSON.parse(vecOfTuples[0].formatted), [
    [1, "a"],
    [2, "b"],
  ]);
  assert.deepEqual(JSON.parse(nestedTuple[0].formatted), { pair: [1, [2, 3]] });
});

test("preserves Rust Option/Result semantics alongside tuple support", () => {
  const some = extractLogJsonFragments("DEBUG opt=Some(User { id: 1 })");
  const ok = extractLogJsonFragments("DEBUG res=Ok(42)");
  const tupleStruct = extractLogJsonFragments("DEBUG p=Point(1, 2)");

  assert.deepEqual(JSON.parse(some[0].formatted), { id: 1 });
  assert.deepEqual(JSON.parse(ok[0].formatted), 42);
  assert.deepEqual(JSON.parse(tupleStruct[0].formatted), [1, 2]);
});

test("does not treat parenthesized prose or calls as Rust tuples", () => {
  assert.equal(extractLogJsonFragments("INFO done (see docs)").length, 0);
  assert.equal(extractLogJsonFragments("DEBUG calling foo(a, b)").length, 0);
  assert.equal(
    extractLogJsonFragments("INFO request completed (200 ms)").length,
    0,
  );
  assert.equal(extractLogJsonFragments("INFO retry=(1)").length, 0);
});

test("extracts JavaScript and TypeScript Node inspection objects", () => {
  const javascript = extractLogJsonFragments(
    "INFO jsState={ userId: 1001, active: true, profile: { email: 'alice@example.com' }, tags: [ 'admin', 'ops' ] } done",
  );
  const typescript = extractLogJsonFragments(
    "INFO tsState={ requestId: 'req-1', enabled: false, values: [1, 2] } done",
  );

  assert.equal(javascript.length, 1);
  assert.equal(javascript[0].label, "jsState");
  assert.equal(javascript[0].kind, "JSON5");
  assert.deepEqual(JSON.parse(javascript[0].formatted), {
    userId: 1001,
    active: true,
    profile: { email: "alice@example.com" },
    tags: ["admin", "ops"],
  });
  assert.equal(typescript.length, 1);
  assert.equal(typescript[0].label, "tsState");
  assert.equal(typescript[0].kind, "JSON5");
  assert.deepEqual(JSON.parse(typescript[0].formatted), {
    requestId: "req-1",
    enabled: false,
    values: [1, 2],
  });
});

test("keeps Java Optional output classified as JVM toString", () => {
  const fragments = extractLogJsonFragments(
    "INFO value=Optional[User{id=1, active=true}] done",
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].kind, "Java/Kotlin toString");
  assert.deepEqual(JSON.parse(fragments[0].formatted), { id: 1, active: true });
});

test("does not show unparseable structures or source declarations as log data", () => {
  assert.deepEqual(
    extractLogJsonFragments("INFO result=User{invalid} cost=2ms"),
    [],
  );
  assert.deepEqual(
    extractLogJsonFragments("INFO user={Alice true} cost=2ms"),
    [],
  );
  assert.deepEqual(extractLogJsonFragments("User{id=1}"), []);
  assert.deepEqual(
    extractLogJsonFragments("public class User { private String name; }"),
    [],
  );
  assert.deepEqual(
    extractLogJsonFragments("type User struct { ID int; Name string }"),
    [],
  );
  assert.deepEqual(extractLogJsonFragments("INFO type=interface{} done"), []);
  assert.deepEqual(extractLogJsonFragments("INFO cache=map[] done"), []);
  assert.deepEqual(
    extractLogJsonFragments("INFO public interface User {}"),
    [],
  );
  assert.deepEqual(extractLogJsonFragments("INFO result=User{} done"), []);
  assert.deepEqual(extractLogJsonFragments("INFO struct User { id: u64 }"), []);
  assert.deepEqual(
    extractLogJsonFragments(
      "INFO public record User { int Id { get; init; } }",
    ),
    [],
  );
  assert.deepEqual(
    JSON.parse(extractLogJsonFragments("INFO payload=[]")[0].formatted),
    [],
  );
  assert.deepEqual(
    JSON.parse(
      extractLogJsonFragments("INFO type=User{id=1, active=true}")[0].formatted,
    ),
    { id: 1, active: true },
  );
});

test("unescapes escaped JSON fragments", () => {
  const fragments = extractLogJsonFragments(
    'payload={\\"id\\":1,\\"event\\":\\"login\\"}',
  );

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].kind, "Escaped JSON");
  assert.equal(fragments[0].formatted, '{\n  "id": 1,\n  "event": "login"\n}');
});

test("extracts escaped JSON strings from mixed log text", () => {
  const log = [
    "2026-05-23T08:15:30.123Z INFO service=billing trace=abc-123",
    String.raw`context="{\"orderId\":\"ord-1001\",\"total\":42.5,\"items\":[{\"sku\":\"A-1\",\"qty\":2},{\"sku\":\"B-7\",\"qty\":1}],\"meta\":{\"coupon\":null,\"flags\":[true,false]}}"`,
    String.raw`audit="[{\"step\":\"reserve\",\"ok\":true},{\"step\":\"charge\",\"ok\":true}]"`,
    "latency=18ms",
  ].join(" ");

  const fragments = extractLogJsonFragments(log);

  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].label, "context");
  assert.equal(fragments[0].kind, "Escaped JSON");
  assert.equal(
    fragments[0].formatted,
    `{
  "orderId": "ord-1001",
  "total": 42.5,
  "items": [
    {
      "sku": "A-1",
      "qty": 2
    },
    {
      "sku": "B-7",
      "qty": 1
    }
  ],
  "meta": {
    "coupon": null,
    "flags": [
      true,
      false
    ]
  }
}`,
  );
  assert.equal(fragments[1].label, "audit");
  assert.equal(fragments[1].kind, "Escaped JSON");
  assert.equal(
    fragments[1].formatted,
    `[
  {
    "step": "reserve",
    "ok": true
  },
  {
    "step": "charge",
    "ok": true
  }
]`,
  );
});

test("extracts JSON payloads from curl data arguments with nested escaped JSON strings", () => {
  const curl = String.raw`curl 'https://mcs.snssdk.com/list' \
  -H 'accept: */*' \
  -H 'content-type: application/json; charset=UTF-8' \
  -H 'sec-ch-ua: "Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"' \
  --data-raw '[{"events":[{"event":"applog_trace","params":"{\"count\":3,\"state\":\"net\",\"key\":\"log\",\"params_for_special\":\"applog_trace\",\"aid\":2608,\"platform\":\"web\",\"_staging_flag\":1,\"sdk_version\":\"4.2.9\",\"event_index\":1779548677267}","local_time_ms":1779547742896}],"user":{"user_unique_id":"7620469511225804288","user_id":"1680531454957182","user_is_login":true,"web_id":"7620469511225804288"},"header":{"app_id":2608,"os_name":"mac","os_version":"10_15_7","device_model":"Macintosh","language":"zh-CN","creative_id":null,"ad_id":null,"campaign_id":null,"platform":"Web","sdk_version":"4.2.9","sdk_lib":"js","timezone":8,"tz_offset":-28800,"resolution":"1920x1080","browser":"Chrome","browser_version":"147.0.0.0","referrer":"https://juejin.cn/post/7589958976227344394?searchId=202605161715123B84ED46E8021FB3C2B5","referrer_host":"juejin.cn","width":1920,"height":1080,"screen_width":1920,"screen_height":1080,"custom":"{\"student_verify_status\":\"not_student\",\"from_seo\":0,\"user_level\":1,\"profile_id\":\"1680531454957182\"}"},"local_time":1779547742}]'`;

  const fragments = extractLogJsonFragments(curl);

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "data-raw");
  assert.equal(fragments[0].kind, "JSON");
  assert.match(fragments[0].formatted, /"event": "applog_trace"/);
  assert.match(
    fragments[0].formatted,
    /"custom": "{\\"student_verify_status\\":\\"not_student\\"/,
  );
});

test("returns no fragments for text without JSON candidates", () => {
  const fragments = extractLogJsonFragments("INFO request completed in 12ms");

  assert.deepEqual(fragments, []);
});

test("does not split braces inside JSON strings", () => {
  const fragments = extractLogJsonFragments(
    'payload={"message":"hello {world}","ok":true}',
  );

  assert.equal(fragments.length, 1);
  assert.equal(
    fragments[0].formatted,
    '{\n  "message": "hello {world}",\n  "ok": true\n}',
  );
});

test("does not extract JSON-looking string values from a complete JSON document", () => {
  const fragments = extractLogJsonFragments('{"template":"{}","items":"[]"}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, "Fragment 1");
  assert.equal(
    fragments[0].formatted,
    '{\n  "template": "{}",\n  "items": "[]"\n}',
  );
});

test("does not split braces inside escaped JSON strings", () => {
  const fragments = extractLogJsonFragments(
    'payload={\\"message\\":\\"hello } world\\",\\"ok\\":true}',
  );

  assert.equal(fragments.length, 1);
  assert.equal(
    fragments[0].formatted,
    '{\n  "message": "hello } world",\n  "ok": true\n}',
  );
});

test("detects a standalone escaped JSON document", () => {
  const value = getStandaloneEscapedJsonContent(
    '"{\\"userId\\":123,\\"event\\":\\"login\\"}"',
  );

  assert.equal(value, '{"userId":123,"event":"login"}');
});

test("does not extract a standalone escaped JSON document as mixed log content", () => {
  const fragments = extractLogJsonFragments(
    '"{\\"people\\":[{\\"name\\":\\"Alice\\",\\"age\\":20}],\\"meta\\":{\\"count\\":1}}"',
  );

  assert.deepEqual(fragments, []);
});

test("does not treat mixed log escaped JSON as standalone content", () => {
  const value = getStandaloneEscapedJsonContent('payload="{\\"userId\\":123}"');

  assert.equal(value, null);
});

// --- Comprehensive coverage: helper returns the single fragment's kind and
// parsed data so structural assertions stay readable across formats. ---

/**
 * @param {string} content
 * @returns {{ kind: string, data: unknown } | null}
 */
function extractOne(content) {
  const fragments = extractLogJsonFragments(content, { indent: 2 });
  if (fragments.length !== 1) return null;
  return { kind: fragments[0].kind, data: JSON.parse(fragments[0].formatted) };
}

test("parses labeled Go typed struct with a type name and whitespace fields", () => {
  // Regression: `%+v` output carries a type name but is whitespace-separated.
  // The type prefix must not force comma splitting and merge fields.
  const result = extractOne("INFO u=main.User{Name:Bob Age:30}");

  assert.equal(result.kind, "Go fmt");
  assert.deepEqual(result.data, { Name: "Bob", Age: 30 });
});

test("parses labeled Go typed map with a type name and whitespace entries", () => {
  const result = extractOne("INFO m=map[string]int{a:1 b:2}");

  assert.equal(result.kind, "Go fmt");
  assert.deepEqual(result.data, { a: 1, b: 2 });
});

test("still parses Go-syntax %#v typed literals with comma-separated fields", () => {
  const struct = extractOne('INFO u=main.User{Name:"Bob", Age:30}');
  const map = extractOne('INFO m=map[string]int{"a":1, "b":2}');

  assert.deepEqual(struct.data, { Name: "Bob", Age: 30 });
  assert.deepEqual(map.data, { a: 1, b: 2 });
});

test("keeps multi-word values inside labeled Go typed structs", () => {
  const result = extractOne(
    "INFO log=main.Log{Level:info Msg:connection refused: timeout Code:5}",
  );

  assert.equal(result.kind, "Go fmt");
  assert.deepEqual(result.data, {
    Level: "info",
    Msg: "connection refused: timeout",
    Code: 5,
  });
});

test("parses nested Go typed structs at any depth", () => {
  const result = extractOne(
    "INFO o=main.Order{Id:1 User:main.User{Name:Bob Age:30}}",
  );

  assert.deepEqual(result.data, {
    Id: 1,
    User: { Name: "Bob", Age: 30 },
  });
});

test("shows a whole-document Go %+v struct as a fragment", () => {
  // Regression: a whole document the main editor cannot parse (non-JSON kind)
  // must still surface in the fragments panel rather than being swallowed.
  const result = extractOne("{Level:info Msg:connection refused: timeout Code:5}");

  assert.equal(result.kind, "Go fmt");
  assert.deepEqual(result.data, {
    Level: "info",
    Msg: "connection refused: timeout",
    Code: 5,
  });
});

test("shows a whole-document JSON5 body as a fragment", () => {
  const result = extractOne("{ id: 1, name: 'Alice', }");

  assert.equal(result.kind, "JSON5");
  assert.deepEqual(result.data, { id: 1, name: "Alice" });
});

test("keeps treating a whole-document standard JSON as owned by the editor", () => {
  // The main editor formats standard JSON itself, so it should not appear as a
  // mixed-log fragment.
  const fragments = extractLogJsonFragments('{"id":1,"ok":true}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].kind, "JSON");
  assert.equal(fragments[0].raw.trim(), '{"id":1,"ok":true}');
});

test("parses negative, float, and scientific numbers in Go %+v", () => {
  const result = extractOne("INFO m={ratio:-1.5 scale:2e3 count:0}");

  assert.deepEqual(result.data, { ratio: -1.5, scale: 2000, count: 0 });
});

test("parses negative and float numbers in a Rust Debug struct", () => {
  const result = extractOne("INFO p=Point { x: -1.5, y: 2e2 }");

  assert.equal(result.kind, "Rust Debug");
  assert.deepEqual(result.data, { x: -1.5, y: 200 });
});

test("parses negative and float numbers in a Python dataclass", () => {
  const result = extractOne("INFO d=Config(rate=-1.5, scale=2e3, on=True)");

  assert.equal(result.kind, "Python repr");
  assert.deepEqual(result.data, { rate: -1.5, scale: 2000, on: true });
});

test("recognizes JSON5 line and block comments", () => {
  const line = extractOne("cfg={a:1, // note\n b:2}");
  const block = extractOne("cfg={a:1, /* note */ b:2}");

  assert.equal(line.kind, "JSON5");
  assert.deepEqual(line.data, { a: 1, b: 2 });
  assert.equal(block.kind, "JSON5");
  assert.deepEqual(block.data, { a: 1, b: 2 });
});

test("detects fragments after WARNING, FATAL, and TRACE log levels", () => {
  assert.deepEqual(extractOne("WARNING payload={id:1 status:ok}").data, {
    id: 1,
    status: "ok",
  });
  assert.deepEqual(extractOne("FATAL err={code:500 msg:down}").data, {
    code: 500,
    msg: "down",
  });
  assert.deepEqual(extractOne("TRACE span={id:abc dur:12}").data, {
    id: "abc",
    dur: 12,
  });
});

test("keeps an empty labeled JSON object or array as a fragment", () => {
  assert.deepEqual(extractOne("INFO payload={}").data, {});
  assert.deepEqual(extractOne("INFO payload=[]").data, []);
});

test("unwraps Java Optional.of and a generic type name", () => {
  assert.deepEqual(extractOne("INFO v=Optional.of(User(id=1))").data, {
    id: 1,
  });
  assert.deepEqual(
    extractOne("INFO r=Response<User>(code=200, ok=true)").data,
    { code: 200, ok: true },
  );
});

test("parses a Rust unit value and raw identifier key", () => {
  assert.deepEqual(extractOne("INFO r=Wrapper { val: () }").data, {
    val: null,
  });
  assert.deepEqual(
    extractOne('INFO e=Err(ApiError { r#type: "upstream" })').data,
    { type: "upstream" },
  );
});

test("parses a char literal in a Rust struct", () => {
  const result = extractOne("INFO p=Cell { tag: 'a', n: 1 }");

  assert.equal(result.kind, "Rust Debug");
  assert.deepEqual(result.data, { tag: "a", n: 1 });
});

test("parses single-quoted values in Go %+v", () => {
  const result = extractOne("INFO m={ch:'x' n:1}");

  assert.equal(result.kind, "Go fmt");
  assert.deepEqual(result.data, { ch: "x", n: 1 });
});

test("parses a bare Go map as a nested field value", () => {
  const result = extractOne("INFO m={tags:map[a:1 b:2] n:3}");

  assert.deepEqual(result.data, { tags: { a: 1, b: 2 }, n: 3 });
});

test("parses a Python OrderedDict of pairs", () => {
  const result = extractOne(
    "INFO d=OrderedDict([('id', 1), ('name', 'Alice')])",
  );

  assert.equal(result.kind, "Python repr");
  assert.deepEqual(result.data, { id: 1, name: "Alice" });
});

test("caps extraction at the maximum fragment count", () => {
  const parts = [];
  for (let i = 0; i < 25; i += 1) parts.push(`f${i}={"i":${i}}`);
  const fragments = extractLogJsonFragments(`INFO ${parts.join(" ")}`);

  assert.equal(fragments.length, 20);
});

test("honors a maxFragments override", () => {
  const fragments = extractLogJsonFragments(
    'INFO a={"x":1} b={"x":2} c={"x":3}',
    { maxFragments: 2 },
  );

  assert.equal(fragments.length, 2);
});

test("honors a non-default indent option", () => {
  const fragments = extractLogJsonFragments('INFO p={"id":1}', { indent: 4 });

  assert.equal(fragments[0].formatted, '{\n    "id": 1\n}');
});

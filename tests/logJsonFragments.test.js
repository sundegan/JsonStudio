import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractLogJsonFragments,
  getStandaloneEscapedJsonContent,
} from '../src/lib/services/logJsonFragments.js';

test('log fragment preview keeps more JSON levels expanded by default', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/LogJsonFragmentsPanel.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /const DEFAULT_LOG_JSON_FOLD_LEVEL = 5;/);
  assert.match(source, /editor\.foldLevel\$\{DEFAULT_LOG_JSON_FOLD_LEVEL\}/);
});

test('extracts a complete JSON document as one fragment', () => {
  const fragments = extractLogJsonFragments('{"id":1,"ok":true}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, 'Fragment 1');
  assert.equal(fragments[0].kind, 'JSON');
  assert.equal(fragments[0].formatted, '{\n  "id": 1,\n  "ok": true\n}');
});

test('extracts a JSON payload from mixed log text', () => {
  const fragments = extractLogJsonFragments('INFO trace=abc payload={"id":1,"path":"/api"} cost=12ms');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, 'payload');
  assert.equal(fragments[0].line, 1);
  assert.equal(fragments[0].formatted, '{\n  "id": 1,\n  "path": "/api"\n}');
});

test('extracts multiple JSON fragments from log text', () => {
  const fragments = extractLogJsonFragments('INFO req={"id":1} res={"code":200,"data":{"ok":true}}');

  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].label, 'req');
  assert.equal(fragments[1].label, 'res');
  assert.equal(fragments[1].formatted, '{\n  "code": 200,\n  "data": {\n    "ok": true\n  }\n}');
});

test('keeps duplicate fragments at different positions', () => {
  const fragments = extractLogJsonFragments('INFO req={"id":1} retry={"id":1}');

  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].label, 'req');
  assert.equal(fragments[1].label, 'retry');
});

test('does not let invalid bracket prefixes hide later JSON payloads', () => {
  const prefix = Array.from({ length: 25 }, (_, index) => `[INFO${index}]`).join(' ');
  const fragments = extractLogJsonFragments(`${prefix} payload={"id":1}`);

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, 'payload');
});

test('extracts nested JSON payloads from log envelopes with bracket markers', () => {
  const log = String.raw`2026-06-04 18:48:25.923768	[6b3d81e51e2b8913439c17372077b8aa] [INFO] [PH]	[rpc_log_wrapper.go/121: 1] [1780570105923755786]Service Called Request: {serviceName:BasicService.BatchQueryRecommendInfo, clientHost:10.196.55.183, clientService:insurance.unified.gateway, req:{"user_id":0,"account_id":0,"lang":"","source":0,"req_list":[{"resource_code":"homepage:banner","id_type":0,"refer_id":"","extend":"{\"spp_biz_id\":\"c202a7326b2c68213bb8f69e053c0a60\"}"},{"resource_code":"homepage:pop_up","id_type":0,"refer_id":"","extend":"{\"spp_biz_id\":\"e232a53ae392039a571457639451263b\"}"},{"resource_code":"homepage:recommend","id_type":0,"refer_id":"","extend":""},{"resource_code":"standalone_homepage:voucher","id_type":0,"refer_id":"","extend":""},{"resource_code":"homepage:referral","id_type":0,"refer_id":"","extend":""},{"resource_code":"homepage:review","id_type":0,"refer_id":"","extend":""},{"resource_code":"homepage:icon","id_type":0,"refer_id":"","extend":""}],"extend":""}}`;
  const fragments = extractLogJsonFragments(log);

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, 'req');
  assert.match(fragments[0].formatted, /"resource_code": "homepage:banner"/);
  assert.doesNotMatch(fragments[0].formatted, /1780570105923755800/);
});

test('prefers explicitly labeled JSON payloads without depending on field names', () => {
  const fragments = extractLogJsonFragments('INFO wrapper={operation:Foo.Bar, payloadBody:{"id":1,"ok":true}}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, 'payloadBody');
  assert.equal(fragments[0].kind, 'JSON');
  assert.equal(fragments[0].formatted, '{\n  "id": 1,\n  "ok": true\n}');
});

test('repairs JSON-like log payloads', () => {
  const fragments = extractLogJsonFragments("payload={userId: 1, name: 'Alice',}");

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].kind, 'JSON5');
  assert.equal(fragments[0].formatted, '{\n  "userId": 1,\n  "name": "Alice"\n}');
});

test('unescapes escaped JSON fragments', () => {
  const fragments = extractLogJsonFragments('payload={\\"id\\":1,\\"event\\":\\"login\\"}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].kind, 'Escaped JSON');
  assert.equal(fragments[0].formatted, '{\n  "id": 1,\n  "event": "login"\n}');
});

test('extracts escaped JSON strings from mixed log text', () => {
  const log = [
    '2026-05-23T08:15:30.123Z INFO service=billing trace=abc-123',
    String.raw`context="{\"orderId\":\"ord-1001\",\"total\":42.5,\"items\":[{\"sku\":\"A-1\",\"qty\":2},{\"sku\":\"B-7\",\"qty\":1}],\"meta\":{\"coupon\":null,\"flags\":[true,false]}}"`,
    String.raw`audit="[{\"step\":\"reserve\",\"ok\":true},{\"step\":\"charge\",\"ok\":true}]"`,
    'latency=18ms',
  ].join(' ');

  const fragments = extractLogJsonFragments(log);

  assert.equal(fragments.length, 2);
  assert.equal(fragments[0].label, 'context');
  assert.equal(fragments[0].kind, 'Escaped JSON');
  assert.equal(fragments[0].formatted, `{
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
}`);
  assert.equal(fragments[1].label, 'audit');
  assert.equal(fragments[1].kind, 'Escaped JSON');
  assert.equal(fragments[1].formatted, `[
  {
    "step": "reserve",
    "ok": true
  },
  {
    "step": "charge",
    "ok": true
  }
]`);
});

test('extracts JSON payloads from curl data arguments with nested escaped JSON strings', () => {
  const curl = String.raw`curl 'https://mcs.snssdk.com/list' \
  -H 'accept: */*' \
  -H 'content-type: application/json; charset=UTF-8' \
  -H 'sec-ch-ua: "Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"' \
  --data-raw '[{"events":[{"event":"applog_trace","params":"{\"count\":3,\"state\":\"net\",\"key\":\"log\",\"params_for_special\":\"applog_trace\",\"aid\":2608,\"platform\":\"web\",\"_staging_flag\":1,\"sdk_version\":\"4.2.9\",\"event_index\":1779548677267}","local_time_ms":1779547742896}],"user":{"user_unique_id":"7620469511225804288","user_id":"1680531454957182","user_is_login":true,"web_id":"7620469511225804288"},"header":{"app_id":2608,"os_name":"mac","os_version":"10_15_7","device_model":"Macintosh","language":"zh-CN","creative_id":null,"ad_id":null,"campaign_id":null,"platform":"Web","sdk_version":"4.2.9","sdk_lib":"js","timezone":8,"tz_offset":-28800,"resolution":"1920x1080","browser":"Chrome","browser_version":"147.0.0.0","referrer":"https://juejin.cn/post/7589958976227344394?searchId=202605161715123B84ED46E8021FB3C2B5","referrer_host":"juejin.cn","width":1920,"height":1080,"screen_width":1920,"screen_height":1080,"custom":"{\"student_verify_status\":\"not_student\",\"from_seo\":0,\"user_level\":1,\"profile_id\":\"1680531454957182\"}"},"local_time":1779547742}]'`;

  const fragments = extractLogJsonFragments(curl);

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, 'data-raw');
  assert.equal(fragments[0].kind, 'JSON');
  assert.match(fragments[0].formatted, /"event": "applog_trace"/);
  assert.match(fragments[0].formatted, /"custom": "{\\"student_verify_status\\":\\"not_student\\"/);
});

test('returns no fragments for text without JSON candidates', () => {
  const fragments = extractLogJsonFragments('INFO request completed in 12ms');

  assert.deepEqual(fragments, []);
});

test('does not split braces inside JSON strings', () => {
  const fragments = extractLogJsonFragments('payload={"message":"hello {world}","ok":true}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].formatted, '{\n  "message": "hello {world}",\n  "ok": true\n}');
});

test('does not extract JSON-looking string values from a complete JSON document', () => {
  const fragments = extractLogJsonFragments('{"template":"{}","items":"[]"}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].label, 'Fragment 1');
  assert.equal(fragments[0].formatted, '{\n  "template": "{}",\n  "items": "[]"\n}');
});

test('does not split braces inside escaped JSON strings', () => {
  const fragments = extractLogJsonFragments('payload={\\"message\\":\\"hello } world\\",\\"ok\\":true}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].formatted, '{\n  "message": "hello } world",\n  "ok": true\n}');
});

test('detects a standalone escaped JSON document', () => {
  const value = getStandaloneEscapedJsonContent('"{\\"userId\\":123,\\"event\\":\\"login\\"}"');

  assert.equal(value, '{"userId":123,"event":"login"}');
});

test('does not extract a standalone escaped JSON document as mixed log content', () => {
  const fragments = extractLogJsonFragments(
    '"{\\"people\\":[{\\"name\\":\\"Alice\\",\\"age\\":20}],\\"meta\\":{\\"count\\":1}}"',
  );

  assert.deepEqual(fragments, []);
});

test('does not treat mixed log escaped JSON as standalone content', () => {
  const value = getStandaloneEscapedJsonContent('payload="{\\"userId\\":123}"');

  assert.equal(value, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLogJsonFragments,
  getStandaloneEscapedJsonContent,
} from '../src/lib/services/logJsonFragments.js';

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

test('returns no fragments for text without JSON candidates', () => {
  const fragments = extractLogJsonFragments('INFO request completed in 12ms');

  assert.deepEqual(fragments, []);
});

test('does not split braces inside JSON strings', () => {
  const fragments = extractLogJsonFragments('payload={"message":"hello {world}","ok":true}');

  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].formatted, '{\n  "message": "hello {world}",\n  "ok": true\n}');
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

test('does not treat mixed log escaped JSON as standalone content', () => {
  const value = getStandaloneEscapedJsonContent('payload="{\\"userId\\":123}"');

  assert.equal(value, null);
});

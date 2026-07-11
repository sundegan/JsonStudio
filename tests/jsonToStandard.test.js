import test from 'node:test';
import assert from 'node:assert/strict';
import { convertToStandardJson } from '../src/lib/services/jsonToStandard.js';

test('converts JSONC comments and trailing commas into strict JSON', () => {
  const converted = convertToStandardJson(`{
    // Primary user
    "user": "Alice",
    /* Keep permissions together. */
    "roles": ["admin",],
  }`);

  assert.equal(converted, '{\n  "user": "Alice",\n  "roles": [\n    "admin"\n  ]\n}');
  assert.deepEqual(JSON.parse(converted), { user: 'Alice', roles: ['admin'] });
});

test('converts JSON5 syntax into strict JSON syntax', () => {
  const converted = convertToStandardJson("{ userId: 123, name: 'Alice' }");

  assert.equal(converted, '{\n  "userId": 123,\n  "name": "Alice"\n}');
});

test('preserves duplicate keys while converting JSON5 syntax', () => {
  const converted = convertToStandardJson('{ name: "Alice", name: "Bob" }');

  assert.equal(converted, '{\n  "name": "Alice",\n  "name": "Bob"\n}');
});

test('converts JSON5 non-finite numbers to null', () => {
  const converted = convertToStandardJson('{ missing: NaN, max: Infinity, min: -Infinity }');

  assert.deepEqual(
    JSON.parse(converted),
    { missing: null, max: null, min: null },
  );
});

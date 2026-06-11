import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonDocument } from '../src/lib/services/jsonDocumentParse.js';

test('parses standard JSON documents', () => {
  const parsed = parseJsonDocument('{"name":"Alice"}');

  assert.deepEqual(parsed.data, { name: 'Alice' });
  assert.equal(parsed.dialect, 'JSON');
});

test('falls back to JSON5 for valid JSON5 documents', () => {
  const parsed = parseJsonDocument(`{
    // comment
    userId: 42,
    name: 'Alice',
  }`);

  assert.deepEqual(parsed.data, { userId: 42, name: 'Alice' });
  assert.equal(parsed.dialect, 'JSON5');
});

test('preserves source-map offsets for documents with leading whitespace', () => {
  const parsed = parseJsonDocument(`
  {
    "a": 1
  }`);

  assert.equal(parsed.pointers['/a'].key.pos, 9);
});

test('includes a source model for standard JSON duplicate keys', () => {
  const parsed = parseJsonDocument('{"meta":{"count":1},"meta":{"count":2}}');

  assert.equal(parsed.sourceModel.kind, 'object');
  assert.equal(parsed.sourceModel.hasDuplicateKeys, true);
  assert.deepEqual(parsed.sourceModel.entries.map((entry) => entry.key), ['meta', 'meta']);
});

test('maps duplicate object keys to distinct source pointer ranges', () => {
  const parsed = parseJsonDocument('{"meta":{"count":1},"meta":{"count":2}}');

  assert.deepEqual(
    [parsed.pointers['/meta'].value.pos, parsed.pointers['/meta#2'].value.pos],
    [8, 27],
  );
});

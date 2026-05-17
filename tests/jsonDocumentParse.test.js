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

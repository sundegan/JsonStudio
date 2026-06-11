import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJsonSourcePointers,
  parseJsonSourceDocument,
  parseJsonSourceModel,
} from '../src/lib/services/jsonSourceModel.js';

test('parses duplicate object keys as separate source entries', () => {
  const root = parseJsonSourceModel('{"meta":{"count":1},"meta":{"count":2}}');

  assert.equal(root.kind, 'object');
  assert.equal(root.entries.length, 2);
  assert.deepEqual(root.entries.map((entry) => entry.key), ['meta', 'meta']);
  assert.deepEqual(root.entries.map((entry) => entry.occurrence ?? 0), [0, 1]);
  assert.equal(root.hasDuplicateKeys, true);
});

test('tracks duplicate keys in JSON5 documents', () => {
  const root = parseJsonSourceModel('{meta: 1, meta: 2}', { dialect: 'JSON5' });

  assert.equal(root.hasDuplicateKeys, true);
  assert.deepEqual(root.entries.map((entry) => entry.occurrence ?? 0), [0, 1]);
  assert.equal(root.value.meta, 2);
});

test('reports the dialect detected by automatic parsing', () => {
  assert.equal(
    parseJsonSourceDocument('{"value":1}', { dialect: 'AUTO' }).dialect,
    'JSON',
  );
  assert.equal(
    parseJsonSourceDocument('{"value":1,}', { dialect: 'AUTO' }).dialect,
    'JSON5',
  );
});

test('builds pointers without recursive stack overflow', () => {
  const depth = 3000;
  const root = parseJsonSourceModel(`${'['.repeat(depth)}0${']'.repeat(depth)}`);
  const pointers = buildJsonSourcePointers(root);

  assert.equal(Object.keys(pointers).length, depth + 1);
});

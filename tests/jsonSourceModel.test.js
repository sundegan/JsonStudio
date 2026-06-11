import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonSourceModel } from '../src/lib/services/jsonSourceModel.js';

test('parses duplicate object keys as separate source entries', () => {
  const root = parseJsonSourceModel('{"meta":{"count":1},"meta":{"count":2}}');

  assert.equal(root.kind, 'object');
  assert.equal(root.entries.length, 2);
  assert.deepEqual(root.entries.map((entry) => entry.key), ['meta', 'meta']);
  assert.deepEqual(root.entries.map((entry) => entry.occurrence), [0, 1]);
  assert.equal(root.hasDuplicateKeys, true);
});

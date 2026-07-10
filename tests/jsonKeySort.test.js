import test from 'node:test';
import assert from 'node:assert/strict';
import { sortJsonKeys } from '../src/lib/services/jsonKeySort.js';

test('sorts object keys recursively without reordering arrays', () => {
  const content = '{"z":1,"a":{"d":4,"b":2},"items":[{"y":2,"x":1},3]}';

  const ascending = JSON.parse(sortJsonKeys(content, 'asc'));
  assert.deepEqual(Object.keys(ascending), ['a', 'items', 'z']);
  assert.deepEqual(Object.keys(ascending.a), ['b', 'd']);
  assert.deepEqual(Object.keys(ascending.items[0]), ['x', 'y']);
  assert.equal(ascending.items[1], 3);

  const descending = JSON.parse(sortJsonKeys(content, 'desc'));
  assert.deepEqual(Object.keys(descending), ['z', 'items', 'a']);
});

test('rejects duplicate keys instead of discarding their values', () => {
  assert.throws(
    () => sortJsonKeys('{"name":"Alice","name":"Bob"}', 'asc'),
    /duplicate keys/i,
  );
});

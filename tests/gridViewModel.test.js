import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGridRoot,
  collectExpandableGridPaths,
  describeExpandableGridValue,
  getGridChild,
  summarizeGridValue,
} from '../src/lib/services/gridViewModel.js';
import { parseJsonSourceModel } from '../src/lib/services/jsonSourceModel.js';

test('builds an object root as key-value rows without a generic header', () => {
  const root = buildGridRoot({ user: { id: 1 }, active: true });

  assert.equal(root.kind, 'object');
  assert.equal(root.showHeader, false);
  assert.deepEqual(root.columns, ['key', 'value']);
  assert.deepEqual(
    root.rows.map((row) => [row.path, row.cells[0].value, row.cells[1].value]),
    [
      ['/user', 'user', { id: 1 }],
      ['/active', 'active', true],
    ],
  );
});

test('builds duplicate object keys as separate rows from source model', () => {
  const root = buildGridRoot(parseJsonSourceModel('{"meta":{"count":1},"meta":{"count":2}}'));

  assert.equal(root.kind, 'object');
  assert.deepEqual(root.rows.map((row) => row.cells[0].value), ['meta', 'meta']);
  assert.deepEqual(root.rows.map((row) => row.cells[1].value), [
    { count: 1 },
    { count: 2 },
  ]);
  assert.notEqual(root.rows[0].path, root.rows[1].path);
});

test('builds an array of objects as a column grid while preserving source rows', () => {
  const root = buildGridRoot([{ id: 1 }, { name: 'Ada' }]);

  assert.equal(root.kind, 'array-object');
  assert.equal(root.showHeader, true);
  assert.deepEqual(root.columns, ['id', 'name']);
  assert.deepEqual(
    root.rows.map((row) => [row.path, row.source, row.cells.map((cell) => cell.value)]),
    [
      ['/0', { id: 1 }, [1, null]],
      ['/1', { name: 'Ada' }, [null, 'Ada']],
    ],
  );
});

test('builds a mixed array as index-value rows', () => {
  const root = buildGridRoot([1, { nested: true }, ['x']]);

  assert.equal(root.kind, 'array');
  assert.equal(root.showHeader, false);
  assert.deepEqual(root.columns, ['index', 'value']);
  assert.deepEqual(
    root.rows.map((row) => [row.path, row.cells[0].value, row.cells[1].value]),
    [
      ['/0', 0, 1],
      ['/1', 1, { nested: true }],
      ['/2', 2, ['x']],
    ],
  );
});

test('builds a scalar root as a single value row', () => {
  const root = buildGridRoot('hello');

  assert.equal(root.kind, 'scalar');
  assert.equal(root.showHeader, true);
  assert.deepEqual(root.columns, ['value']);
  assert.deepEqual(root.rows[0].cells.map((cell) => cell.value), ['hello']);
  assert.equal(root.rows[0].path, '/');
});

test('returns nested child grids with escaped JSON pointer paths', () => {
  const root = buildGridRoot({ 'a/b': [{ '~key': 1 }] });
  const child = getGridChild(root.rows[0].cells[1]);

  assert.equal(root.rows[0].path, '/a~1b');
  assert.equal(child.path, '/a~1b');
  assert.equal(child.rows[0].path, '/a~1b/0');
  assert.equal(child.rows[0].cells[0].path, '/a~1b/0/~0key');
});

test('hides generic headers for nested object and array grids', () => {
  const root = buildGridRoot({
    roles: ['admin', 'editor'],
    metrics: { loginCount: 42, successRate: 0.98 },
  });

  assert.equal(getGridChild(root.rows[0].cells[1]).showHeader, false);
  assert.equal(getGridChild(root.rows[1].cells[1]).showHeader, false);
});

test('summarizes nested values without flattening them', () => {
  assert.equal(summarizeGridValue({ a: 1, b: 2 }), '{2}');
  assert.equal(summarizeGridValue([1, 2, 3]), '[3]');
  assert.equal(summarizeGridValue(null), 'null');
});

test('describes expandable values like JSONGrid headers', () => {
  assert.equal(describeExpandableGridValue('roles', ['admin', 'editor']), 'roles [2]');
  assert.equal(describeExpandableGridValue('profile', { email: 'a@example.com' }), 'profile {}');
});

test('collects expandable paths recursively for expand-all behavior', () => {
  const root = buildGridRoot({
    roles: ['admin'],
    profile: {
      contact: {
        email: 'a@example.com',
      },
    },
  });

  assert.deepEqual(collectExpandableGridPaths(root), [
    '/roles',
    '/profile',
    '/profile/contact',
  ]);
});

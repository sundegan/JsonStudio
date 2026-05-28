import test from 'node:test';
import assert from 'node:assert/strict';
import { getTabInsertionTarget, moveTabToInsertionIndex } from '../src/lib/stores/tabOrder.js';

function tab(id) {
  return { id };
}

test('moves a tab to the requested insertion index when dragging right', () => {
  const tabs = [tab('a'), tab('b'), tab('c'), tab('d')];

  const result = moveTabToInsertionIndex(tabs, 1, 3);

  assert.deepEqual(result.map((item) => item.id), ['a', 'c', 'b', 'd']);
});

test('moves a tab to the requested insertion index when dragging left', () => {
  const tabs = [tab('a'), tab('b'), tab('c'), tab('d')];

  const result = moveTabToInsertionIndex(tabs, 2, 1);

  assert.deepEqual(result.map((item) => item.id), ['a', 'c', 'b', 'd']);
});

test('can move a tab to the end of the tab list', () => {
  const tabs = [tab('a'), tab('b'), tab('c'), tab('d')];

  const result = moveTabToInsertionIndex(tabs, 1, tabs.length);

  assert.deepEqual(result.map((item) => item.id), ['a', 'c', 'd', 'b']);
});

test('finds a before insertion target from pointer position', () => {
  const target = getTabInsertionTarget([
    { id: 'a', left: 0, width: 100 },
    { id: 'b', left: 110, width: 100 },
    { id: 'c', left: 220, width: 100 },
  ], 130);

  assert.deepEqual(target, {
    targetTabId: 'b',
    position: 'before',
    insertionIndex: 1,
  });
});

test('finds an after insertion target at the end of the tab list', () => {
  const target = getTabInsertionTarget([
    { id: 'a', left: 0, width: 100 },
    { id: 'b', left: 110, width: 100 },
    { id: 'c', left: 220, width: 100 },
  ], 400);

  assert.deepEqual(target, {
    targetTabId: 'c',
    position: 'after',
    insertionIndex: 3,
  });
});

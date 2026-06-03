import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createTreeDragMove,
  createTreeValueCopyText,
  createTreeKeyEdit,
  isTreeKeyEditable,
  validateTreeKeyName,
} from '../src/lib/services/treeEdit.js';
import { parseJsonDocument } from '../src/lib/services/jsonDocumentParse.js';

test('allows object keys but not array indexes to be edited', () => {
  assert.equal(isTreeKeyEditable({ parentType: 'object' }), true);
  assert.equal(isTreeKeyEditable({ parentType: 'array' }), false);
});

test('rejects empty and duplicate object key names', () => {
  assert.equal(validateTreeKeyName('', ['name']).ok, false);
  assert.equal(validateTreeKeyName('name', ['name']).ok, false);
  assert.deepEqual(validateTreeKeyName('displayName', ['name']), { ok: true });
});

test('creates a source edit that replaces only an object key', () => {
  const content = `{
  "name": "Alice",
  "age": 20
}`;
  const parsed = parseJsonDocument(content);

  const result = createTreeKeyEdit(parsed.pointers, '/name', 'displayName', ['age']);

  assert.deepEqual(result, {
    ok: true,
    edit: {
      start: 4,
      end: 10,
      text: '"displayName"',
    },
  });
});

test('quotes escaped key text during a source edit', () => {
  const content = '{"name":"Alice"}';
  const parsed = parseJsonDocument(content);

  assert.equal(createTreeKeyEdit(parsed.pointers, '/name', 'a"b', []).edit.text, '"a\\"b"');
});

test('creates tree copy text from the node value source range only', () => {
  const content = `{
  "name": "Alice",
  "profile": {
    "age": 20
  },
  "tags": [
    "json",
    "tool"
  ]
}`;
  const parsed = parseJsonDocument(content);

  assert.equal(createTreeValueCopyText(content, parsed.pointers, '/name', 'Alice'), '"Alice"');
  assert.equal(createTreeValueCopyText(content, parsed.pointers, '/profile', parsed.data.profile), `{
    "age": 20
  }`);
  assert.equal(createTreeValueCopyText(content, parsed.pointers, '/tags', parsed.data.tags), `[
    "json",
    "tool"
  ]`);
});

test('tree view exposes key and primitive value edit writeback on double click', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/JsonTreeView.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /createTreeKeyEdit/);
  assert.match(source, /createGridValueEdit/);
  assert.match(source, /replaceRangeByOffsets/);
  assert.match(source, /if \(content !== previousContent\) \{[\s\S]*treeEdit = null;[\s\S]*buildTree\(\);/);
  assert.match(source, /ondblclick=\{\(e\) => beginTreeEdit\(e, node, 'key'\)\}/);
  assert.match(source, /ondblclick=\{\(e\) => beginTreeEdit\(e, node, 'value'\)\}/);
  assert.doesNotMatch(source, /tree-edit-button/);
});

test('tree view wires drag and drop moves through full document writeback', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/JsonTreeView.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /createTreeDragMove/);
  assert.match(source, /data-tree-path=\{node\.path\}/);
  assert.match(source, /onpointerdown=\{\(e\) => handleTreePointerDown\(e, node\)\}/);
  assert.match(source, /onpointermove=\{handleTreePointerMove\}/);
  assert.match(source, /onpointerup=\{handleTreePointerUp\}/);
  assert.match(source, /document\.elementFromPoint\(clientX, clientY\)/);
  assert.match(source, /const dropTarget = getTreePointerDropTarget\(event\.clientX, event\.clientY\)/);
  assert.match(source, /showTreeDragError\('treeView\.dragJsonOnly'\)/);
  const pointerDownBody = source.match(/function handleTreePointerDown[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.doesNotMatch(pointerDownBody, /showTreeDragError\('treeView\.dragJsonOnly'\)/);
  assert.match(pointerDownBody, /if \(event\.detail > 1\) return/);
  assert.match(source, /parsedDialect !== 'JSON'/);
  assert.match(source, /node\.type !== 'object' && node\.type !== 'array'/);
  assert.match(source, /return y < rect\.height \* 0\.5 \? 'before' : 'after'/);
  assert.match(source, /pendingEditKeyPath = result\.editKey \? result\.movedPath : null/);
  assert.match(source, /treeEdit = createTreeKeyEditState\(pendingEditKeyPath\)/);
  assert.match(source, /editor\?\.setValue\(JSON\.stringify\(result\.data, null, 2\)\)/);
});

test('tree view query mode selector opens a custom menu below the control', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/JsonTreeView.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /let queryModeMenuOpen = \$state\(false\);/);
  assert.match(source, /class="json-tree-mode-button"/);
  assert.match(source, /class="json-tree-mode-menu"/);
  assert.match(source, /class="json-tree-mode-option/);
  assert.match(source, /class="json-tree-mode-arrow"/);
  assert.match(source, /top: calc\(100% \+ 6px\);/);
  assert.match(source, /left: 0;/);
  assert.match(source, /width: 100%;/);
  assert.match(source, /min-width: 88px;/);
  assert.match(source, /z-index: 20;/);
  assert.match(source, /font-size: 10\.5px;/);
  assert.doesNotMatch(source, /<select[\s\S]*class="json-tree-mode-select"/);
});

test('moves object fields before and after siblings', () => {
  const data = { a: 1, b: 2, c: 3 };

  const before = createTreeDragMove({ data, sourcePath: '/c', targetPath: '/a', position: 'before' });
  assert.deepEqual(before, {
    ok: true,
    data: { c: 3, a: 1, b: 2 },
    movedPath: '/c',
  });

  const after = createTreeDragMove({ data, sourcePath: '/a', targetPath: '/c', position: 'after' });
  assert.deepEqual(after, {
    ok: true,
    data: { b: 2, c: 3, a: 1 },
    movedPath: '/a',
  });
});

test('moves array elements before and after siblings with index adjustment', () => {
  const data = ['a', 'b', 'c', 'd'];

  const after = createTreeDragMove({ data, sourcePath: '/0', targetPath: '/2', position: 'after' });
  assert.deepEqual(after, {
    ok: true,
    data: ['b', 'c', 'a', 'd'],
    movedPath: '/2',
  });

  const before = createTreeDragMove({ data, sourcePath: '/3', targetPath: '/1', position: 'before' });
  assert.deepEqual(before, {
    ok: true,
    data: ['a', 'd', 'b', 'c'],
    movedPath: '/1',
  });
});

test('moves array elements beside nested array targets whose parent index shifts', () => {
  const result = createTreeDragMove({
    data: { items: [[0], [1, 2]] },
    sourcePath: '/items/0',
    targetPath: '/items/1/0',
    position: 'before',
  });

  assert.deepEqual(result, {
    ok: true,
    data: { items: [[[0], 1, 2]] },
    movedPath: '/items/0/0',
  });
});

test('moves object fields into objects and array elements into arrays', () => {
  const objectMove = createTreeDragMove({
    data: { source: { id: 1 }, target: {} },
    sourcePath: '/source/id',
    targetPath: '/target',
    position: 'inside',
  });
  assert.deepEqual(objectMove, {
    ok: true,
    data: { source: {}, target: { id: 1 } },
    movedPath: '/target/id',
  });

  const arrayMove = createTreeDragMove({
    data: { source: ['a', 'b'], target: ['x'] },
    sourcePath: '/source/0',
    targetPath: '/target',
    position: 'inside',
  });
  assert.deepEqual(arrayMove, {
    ok: true,
    data: { source: ['b'], target: ['x', 'a'] },
    movedPath: '/target/1',
  });
});

test('moves array elements to the end of their parent array when dropped inside it', () => {
  const result = createTreeDragMove({
    data: { list: ['a', 'b', 'c'] },
    sourcePath: '/list/0',
    targetPath: '/list',
    position: 'inside',
  });

  assert.deepEqual(result, {
    ok: true,
    data: { list: ['b', 'c', 'a'] },
    movedPath: '/list/2',
  });
});

test('moves into an array target whose index shifts after removing the source', () => {
  const result = createTreeDragMove({
    data: { items: ['move', []] },
    sourcePath: '/items/0',
    targetPath: '/items/1',
    position: 'inside',
  });

  assert.deepEqual(result, {
    ok: true,
    data: { items: [['move']] },
    movedPath: '/items/0/0',
  });
});

test('wraps object fields when moving them into arrays', () => {
  const result = createTreeDragMove({
    data: {
      people: [
        { name: 'Alice', age: 20 },
        { count: 2, age: 30 },
      ],
      meta: { name: 'Bob' },
    },
    sourcePath: '/meta',
    targetPath: '/people',
    position: 'inside',
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      people: [
        { name: 'Alice', age: 20 },
        { count: 2, age: 30 },
        { meta: { name: 'Bob' } },
      ],
    },
    movedPath: '/people/2',
  });
});

test('moves into an object target whose array index shifts after removing the source', () => {
  const result = createTreeDragMove({
    data: { items: ['move', { box: {} }] },
    sourcePath: '/items/0',
    targetPath: '/items/1/box',
    position: 'inside',
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      items: [
        {
          box: {
            'items[0]': 'move',
          },
        },
      ],
    },
    movedPath: '/items/0/box/items[0]',
    editKey: true,
  });
});

test('escapes moved object paths that contain JSON pointer characters', () => {
  const result = createTreeDragMove({
    data: {
      'a/b': 1,
      target: {},
    },
    sourcePath: '/a~1b',
    targetPath: '/target',
    position: 'inside',
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      target: {
        'a/b': 1,
      },
    },
    movedPath: '/target/a~1b',
  });
});

test('names array elements from their array path when moving them into objects', () => {
  const result = createTreeDragMove({
    data: {
      people: [
        { name: 'Alice', age: 20 },
        { count: 2, age: 30 },
      ],
      meta: {},
    },
    sourcePath: '/people/0',
    targetPath: '/meta',
    position: 'inside',
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      people: [
        { count: 2, age: 30 },
      ],
      meta: {
        'people[0]': { name: 'Alice', age: 20 },
      },
    },
    movedPath: '/meta/people[0]',
    editKey: true,
  });
});

test('keeps generated object keys unique when moving array elements into objects', () => {
  const result = createTreeDragMove({
    data: { list: ['a'], target: { 'list[0]': 'existing' } },
    sourcePath: '/list/0',
    targetPath: '/target',
    position: 'inside',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    list: [],
    target: {
      'list[0]': 'existing',
      'list[0] 2': 'a',
    },
  });
});

test('does not mutate the original data when moving tree nodes', () => {
  const data = { source: { id: 1 }, target: {} };

  const result = createTreeDragMove({
    data,
    sourcePath: '/source/id',
    targetPath: '/target',
    position: 'inside',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(data, { source: { id: 1 }, target: {} });
});

test('rejects unsupported drop positions', () => {
  assert.deepEqual(
    createTreeDragMove({
      data: { a: 1, b: 2 },
      sourcePath: '/a',
      targetPath: '/b',
      position: /** @type {any} */ ('sideways'),
    }),
    { ok: false, error: 'treeView.dragInvalidTarget' },
  );
});

test('rejects moving a node into itself or descendants', () => {
  assert.deepEqual(
    createTreeDragMove({
      data: { a: { b: {} } },
      sourcePath: '/a',
      targetPath: '/a/b',
      position: 'inside',
    }),
    { ok: false, error: 'treeView.dragIntoDescendant' },
  );

  assert.deepEqual(
    createTreeDragMove({
      data: { a: { b: {} } },
      sourcePath: '/a',
      targetPath: '/a',
      position: 'inside',
    }),
    { ok: false, error: 'treeView.dragIntoDescendant' },
  );
});

test('rejects duplicate object keys when dragging into another object', () => {
  assert.deepEqual(
    createTreeDragMove({
      data: { source: { id: 1 }, target: { id: 2 } },
      sourcePath: '/source/id',
      targetPath: '/target',
      position: 'inside',
    }),
    { ok: false, error: 'treeView.dragDuplicateKey' },
  );
});

test('rejects duplicate object keys when dragging beside a node in another object', () => {
  assert.deepEqual(
    createTreeDragMove({
      data: {
        source: { id: 1 },
        target: { id: 2, name: 'Bob' },
      },
      sourcePath: '/source/id',
      targetPath: '/target/name',
      position: 'before',
    }),
    { ok: false, error: 'treeView.dragDuplicateKey' },
  );
});

test('rejects before and after moves across object and array parents', () => {
  assert.deepEqual(
    createTreeDragMove({
      data: { field: 1, list: ['a'] },
      sourcePath: '/field',
      targetPath: '/list/0',
      position: 'before',
    }),
    { ok: false, error: 'treeView.dragInvalidTarget' },
  );

  assert.deepEqual(
    createTreeDragMove({
      data: { list: ['a'], target: { name: 'Bob' } },
      sourcePath: '/list/0',
      targetPath: '/target/name',
      position: 'after',
    }),
    { ok: false, error: 'treeView.dragInvalidTarget' },
  );
});

test('rejects invalid source and target paths without mutating data', () => {
  assert.deepEqual(
    createTreeDragMove({
      data: { a: 1, b: 2 },
      sourcePath: '/missing',
      targetPath: '/a',
      position: 'before',
    }),
    { ok: false, error: 'treeView.dragInvalidTarget' },
  );

  assert.deepEqual(
    createTreeDragMove({
      data: ['a', 'b'],
      sourcePath: '/10',
      targetPath: '/0',
      position: 'after',
    }),
    { ok: false, error: 'treeView.dragInvalidTarget' },
  );

  assert.deepEqual(
    createTreeDragMove({
      data: { a: 1, b: 2 },
      sourcePath: '/a',
      targetPath: '/missing',
      position: 'before',
    }),
    { ok: false, error: 'treeView.dragInvalidTarget' },
  );
});

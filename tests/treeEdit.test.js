import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
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

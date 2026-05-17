import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGridValueEdit,
  formatGridEditValue,
  isGridCellEditable,
} from '../src/lib/services/gridEdit.js';
import { parseJsonDocument } from '../src/lib/services/jsonDocumentParse.js';
import { buildGridRoot } from '../src/lib/services/gridViewModel.js';

test('marks only leaf values as editable', () => {
  assert.equal(isGridCellEditable({ value: 'Alice', expandable: false, exists: true }), true);
  assert.equal(isGridCellEditable({ value: 42, expandable: false, exists: true }), true);
  assert.equal(isGridCellEditable({ value: null, expandable: false, exists: true }), true);
  assert.equal(isGridCellEditable({ value: { nested: true }, expandable: true, exists: true }), false);
  assert.equal(isGridCellEditable({ value: ['admin'], expandable: true, exists: true }), false);
});

test('does not mark synthetic array-object placeholders as editable', () => {
  const root = buildGridRoot([{ id: 1 }, { name: 'Ada' }]);

  assert.equal(root.rows[0].cells[1].value, null);
  assert.equal(root.rows[0].cells[1].exists, false);
  assert.equal(isGridCellEditable(root.rows[0].cells[1]), false);
});

test('formats edited strings while preserving quote style', () => {
  assert.deepEqual(formatGridEditValue('Alice', 'A "B"', '"Alice"'), {
    ok: true,
    text: '"A \\"B\\""',
  });
  assert.deepEqual(formatGridEditValue('Alice', "A'B", "'Alice'"), {
    ok: true,
    text: "'A\\'B'",
  });
});

test('validates number boolean and null edits against their current type', () => {
  assert.deepEqual(formatGridEditValue(42, '3.14', '42'), { ok: true, text: '3.14' });
  assert.deepEqual(formatGridEditValue(true, 'false', 'true'), { ok: true, text: 'false' });
  assert.deepEqual(formatGridEditValue(null, 'null', 'null'), { ok: true, text: 'null' });

  assert.equal(formatGridEditValue(42, 'abc', '42').ok, false);
  assert.equal(formatGridEditValue(true, '1', 'true').ok, false);
  assert.equal(formatGridEditValue(null, '', 'null').ok, false);
});

test('accepts JSON5 numeric forms when editing JSON5 numbers', () => {
  assert.deepEqual(formatGridEditValue(16, '0x20', '0x10', 'JSON5'), { ok: true, text: '0x20' });
  assert.deepEqual(formatGridEditValue(0.5, '.75', '.5', 'JSON5'), { ok: true, text: '.75' });
  assert.deepEqual(formatGridEditValue(1, '+2', '+1', 'JSON5'), { ok: true, text: '+2' });
  assert.deepEqual(formatGridEditValue(Infinity, '-Infinity', 'Infinity', 'JSON5'), { ok: true, text: '-Infinity' });
  assert.deepEqual(formatGridEditValue(Number.NaN, 'NaN', 'NaN', 'JSON5'), { ok: true, text: 'NaN' });
});

test('creates a value-only edit without changing surrounding JSON text', () => {
  const content = `{
  "userId": 123,
  "name": "Alice"
}`;
  const parsed = parseJsonDocument(content);

  assert.deepEqual(createGridValueEdit(content, parsed.pointers, '/name', 'Alice', 'Ada'), {
    ok: true,
    edit: {
      start: 29,
      end: 36,
      text: '"Ada"',
    },
  });
});

test('preserves JSON5 comments and single-quoted strings during edits', () => {
  const content = `{
  // profile
  name: 'Alice',
}`;
  const parsed = parseJsonDocument(content);
  const result = createGridValueEdit(content, parsed.pointers, '/name', 'Alice', "Ada's");

  assert.deepEqual(result, {
    ok: true,
    edit: {
      start: 23,
      end: 30,
      text: "'Ada\\'s'",
    },
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getGridSelectionForCell,
  getGridSelectionRange,
  getGridSelectionText,
  updateGridSelections,
} from '../src/lib/services/gridSelection.js';
import { buildGridRoot } from '../src/lib/services/gridViewModel.js';
import { parseJsonDocument } from '../src/lib/services/jsonDocumentParse.js';

const parsed = parseJsonDocument(`{
  "userId": 123,
  "profile": {
    "email": "alice@example.com"
  }
}`);

const parsedArrayObject = parseJsonDocument(`[
  {
    "id": 1,
    "name": "Ada"
  }
]`);

test('maps key selection to the original JSON key range', () => {
  assert.deepEqual(getGridSelectionRange(parsed.pointers, '/userId', 'key'), {
    start: 4,
    end: 12,
  });
});

test('maps value selection to the original JSON value range', () => {
  assert.deepEqual(getGridSelectionRange(parsed.pointers, '/profile/email', 'value'), {
    start: 47,
    end: 66,
  });
});

test('maps row selection across the original JSON key and value range', () => {
  assert.deepEqual(getGridSelectionRange(parsed.pointers, '/profile/email', 'row'), {
    start: 38,
    end: 66,
  });
});

test('replaces selection on a plain click and toggles with meta click', () => {
  const first = [{ id: '/userId:value', path: '/userId', target: 'value' }];
  const second = { id: '/profile/email:value', path: '/profile/email', target: 'value' };

  assert.deepEqual(updateGridSelections(first, second, {}), [second]);
  assert.deepEqual(updateGridSelections(first, second, { additive: true }), [...first, second]);
  assert.deepEqual(updateGridSelections([...first, second], second, { additive: true }), first);
});

test('selects a contiguous row range with shift click', () => {
  const orderedRows = ['/userId', '/profile', '/profile/email'];
  const anchor = { id: '/userId:row', path: '/userId', target: 'row' };
  const target = { id: '/profile/email:row', path: '/profile/email', target: 'row' };

  assert.deepEqual(
    updateGridSelections([anchor], target, {
      range: true,
      anchor,
      orderedRows,
    }),
    [
      { id: '/userId:row', path: '/userId', target: 'row' },
      { id: '/profile:row', path: '/profile', target: 'row' },
      { id: '/profile/email:row', path: '/profile/email', target: 'row' },
    ],
  );
});

test('copies a selected value cell as plain text', () => {
  assert.equal(
    getGridSelectionText(
      [{ id: '/profile/email:value', path: '/profile/email', target: 'value' }],
      parsed.data,
    ),
    'alice@example.com',
  );
});

test('copies selected rows as JSON lines', () => {
  assert.equal(
    getGridSelectionText(
      [
        { id: '/userId:row', path: '/userId', target: 'row' },
        { id: '/profile/email:row', path: '/profile/email', target: 'row' },
      ],
      parsed.data,
    ),
    '{"userId":123}\n{"email":"alice@example.com"}',
  );
});

test('maps an object-array cell selection to the exact cell range', () => {
  assert.deepEqual(getGridSelectionRange(parsedArrayObject.pointers, '/0/name', 'value'), {
    start: 31,
    end: 36,
  });
});

test('uses cell paths for object-array cell selections', () => {
  const model = buildGridRoot([{ id: 1, name: 'Ada' }]);
  const row = model.rows[0];

  assert.deepEqual(getGridSelectionForCell(model, row, 0), {
    id: '/0/id:value',
    path: '/0/id',
    target: 'value',
  });
  assert.deepEqual(getGridSelectionForCell(model, row, 1), {
    id: '/0/name:value',
    path: '/0/name',
    target: 'value',
  });
});

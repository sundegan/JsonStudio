import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePastedJson } from '../src/lib/services/diffPasteNormalize.js';

function createOptions() {
  return {
    async format(value) {
      return JSON.stringify(JSON.parse(value), null, 2);
    },
    async unescape(value) {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'string') {
        throw new Error('Content is not a string');
      }
      return parsed;
    },
  };
}

test('formats pasted JSON directly', async () => {
  const normalized = await normalizePastedJson('{"b":1,"a":2}', createOptions());

  assert.equal(normalized, '{\n  "b": 1,\n  "a": 2\n}');
});

test('unescapes and formats JSON string payloads', async () => {
  const normalized = await normalizePastedJson('"{\\"a\\":1}"', createOptions());

  assert.equal(normalized, '{\n  "a": 1\n}');
});

test('unescapes and formats slash-escaped JSON without wrapping quotes', async () => {
  const normalized = await normalizePastedJson('{\\"a\\":1}', createOptions());

  assert.equal(normalized, '{\n  "a": 1\n}');
});

test('returns null for empty content', async () => {
  const normalized = await normalizePastedJson('  \n', createOptions());

  assert.equal(normalized, null);
});

test('returns null for content that cannot become JSON', async () => {
  const normalized = await normalizePastedJson('not json', createOptions());

  assert.equal(normalized, null);
});

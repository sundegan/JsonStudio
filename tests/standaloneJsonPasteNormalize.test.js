import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePastedStandaloneJson } from '../src/lib/services/standaloneJsonPasteNormalize.js';

function createOptions() {
  return {
    async formatJson(value, indent = 2) {
      return JSON.stringify(JSON.parse(value), null, indent);
    },
    getStandaloneEscapedJsonContent(value) {
      try {
        const parsed = JSON.parse(value.trim());
        return typeof parsed === 'string' && parsed.trim().startsWith('{') ? parsed : null;
      } catch {
        return null;
      }
    },
  };
}

test('formats pasted standard JSON', async () => {
  const normalized = await normalizePastedStandaloneJson('{"b":1,"a":2}', createOptions());

  assert.equal(normalized, '{\n  "b": 1,\n  "a": 2\n}');
});

test('unescapes and formats standalone escaped JSON', async () => {
  const normalized = await normalizePastedStandaloneJson('"{\\"id\\":1}"', createOptions());

  assert.equal(normalized, '{\n  "id": 1\n}');
});

test('does not convert pasted JSON5 to standard JSON', async () => {
  const normalized = await normalizePastedStandaloneJson(
    "{ userId: 123, name: 'Alice', ok: true, }",
    createOptions(),
  );

  assert.equal(normalized, null);
});

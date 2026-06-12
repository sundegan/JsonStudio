import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpenedJson } from '../src/lib/services/openJsonNormalize.js';

function createOptions() {
  return {
    indent: 2,
    async formatJson(value, indent) {
      return JSON.stringify(JSON.parse(value), null, indent);
    },
    async detectDialect(value) {
      if (value.includes('// user')) return 'JSON5';
      JSON.parse(value);
      return 'JSON';
    },
    async formatJson5(value) {
      return `json5:${value}`;
    },
  };
}

test('formats opened standard JSON with the current indent', async () => {
  const normalized = await normalizeOpenedJson('{"userId":123,"roles":["admin"]}', createOptions());

  assert.equal(normalized, '{\n  "userId": 123,\n  "roles": [\n    "admin"\n  ]\n}');
});

test('formats opened JSON5 while preserving the JSON5 formatting path', async () => {
  const source = '{\n// user\nuserId: 123,\n}';

  assert.equal(await normalizeOpenedJson(source, createOptions()), `json5:${source}`);
});

test('keeps invalid opened content unchanged', async () => {
  const source = '{"userId":';

  assert.equal(await normalizeOpenedJson(source, createOptions()), source);
});

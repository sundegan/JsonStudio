import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJson5 } from '../src/lib/services/json5Format.js';

test('formats JSON5 without converting it to strict JSON syntax', async () => {
  const formatted = await formatJson5(
    "{ // user\n userId: 123, name: 'Alice', ok: true, roles: ['admin',], }",
    2,
  );

  assert.match(formatted, /\/\/ user/);
  assert.match(formatted, /userId: 123/);
  assert.match(formatted, /name: "Alice"/);
  assert.match(formatted, /roles: \["admin"\]/);
  assert.doesNotMatch(formatted, /"userId"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLineEndings, areStringsEqualNormalized } from '../src/lib/services/lineEndings.ts';

test('compares LF and Windows CRLF without changing JSON string escapes', () => {
  const content = '{\n  "message": "line\\r\\nnext"\n}';
  const windows = content.replaceAll('\n', '\r\n');
  assert.equal(areStringsEqualNormalized(content, windows), true);
  assert.equal(normalizeLineEndings(windows), content);
});

test('does not treat empty or edited content as an EOL-only difference', () => {
  assert.equal(areStringsEqualNormalized('{"name":"Alice"}', ''), false);
  assert.equal(areStringsEqualNormalized('{"name":"Alice"}', '{"name":"Bob"}'), false);
  assert.equal(areStringsEqualNormalized('', ''), true);
  assert.equal(areStringsEqualNormalized('"line\\r\\nnext"', '"line\\nnext"'), false);
});

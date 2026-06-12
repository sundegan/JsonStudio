import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInvalidJsonStats,
  createJsonDocumentModelCache,
} from '../src/lib/services/jsonDocumentModel.js';

test('defers pointer and Tree projection until Tree data is requested', () => {
  const cache = createJsonDocumentModelCache();
  const content = '{"items":[{"id":1},{"id":2}]}';

  const parsed = cache.parse('tab-1', content);
  assert.equal(parsed.stats.key_count, 3);
  assert.equal(cache.diagnostics().pointerModelCount, 0);

  const tree = cache.buildTree('tab-1', content);
  assert.equal(tree.nodeIndex.get('/items/1/id').value, 2);
  assert.equal(cache.diagnostics().pointerModelCount, 1);
});

test('creates invalid stats locally from the parser offset', () => {
  const content = '{\n  "value":,\n}';
  const stats = createInvalidJsonStats(
    content,
    new SyntaxError('Expected JSON value at position 13'),
  );

  assert.equal(stats.valid, false);
  assert.equal(stats.byte_size, Buffer.byteLength(content));
  assert.equal(stats.error_info.error_line, 2);
  assert.equal(stats.error_info.error_column, 12);
});

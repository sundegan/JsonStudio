import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TREE_MODEL_CACHE_SIZE,
  clearJsonTreeModelCache,
  getJsonDocumentStatsAsync,
  getCachedJsonTreeModel,
  getJsonTreeModelAsync,
  getJsonTreeModelCacheDiagnostics,
} from '../src/lib/services/jsonTreeModelCache.js';

test.beforeEach(() => {
  clearJsonTreeModelCache();
});

test('shares one parse between stats and Tree consumers', async () => {
  const content = '{"items":[{"id":1},{"id":2}]}';
  const statsPromise = getJsonDocumentStatsAsync('shared-tab', content);
  const treePromise = getJsonTreeModelAsync('shared-tab', content);

  const [stats, tree] = await Promise.all([statsPromise, treePromise]);
  assert.equal(tree.stats, stats);
  assert.deepEqual(getJsonTreeModelCacheDiagnostics(), {
    parses: 1,
    parseCacheHits: 0,
    parseInFlightHits: 1,
    treeBuilds: 1,
    treeCacheHits: 0,
    treeInFlightHits: 0,
    evictions: 0,
    size: 1,
    tabIds: ['shared-tab'],
  });
});

test('keeps only the five most recently used tab models', async () => {
  for (let index = 0; index < MAX_TREE_MODEL_CACHE_SIZE; index += 1) {
    await getJsonTreeModelAsync(`tab-${index}`, `{"value":${index}}`);
  }

  assert.ok(getCachedJsonTreeModel('tab-0', '{"value":0}'));
  await getJsonTreeModelAsync('tab-5', '{"value":5}');

  const diagnostics = getJsonTreeModelCacheDiagnostics();
  assert.equal(diagnostics.size, MAX_TREE_MODEL_CACHE_SIZE);
  assert.equal(diagnostics.evictions, 1);
  assert.deepEqual(diagnostics.tabIds, ['tab-2', 'tab-3', 'tab-4', 'tab-0', 'tab-5']);
  assert.equal(getCachedJsonTreeModel('tab-1', '{"value":1}'), null);
});

test('returns JSON statistics from the same parsed model', async () => {
  const content = '{"name":"中文","items":[{"id":1},{"id":2}]}';
  const stats = await getJsonDocumentStatsAsync('stats-tab', content);

  assert.deepEqual(stats, {
    valid: true,
    key_count: 4,
    depth: 3,
    byte_size: Buffer.byteLength(content),
    format_type: 'JSON',
    error_info: null,
  });
  assert.equal(getJsonTreeModelCacheDiagnostics().treeBuilds, 0);
});

test('returns invalid statistics without attempting a tree build', async () => {
  const content = '{"broken":';
  const stats = await getJsonDocumentStatsAsync('invalid-tab', content);

  assert.equal(stats.valid, false);
  assert.match(stats.error_info.error_message, /Expected JSON value/);
  await assert.rejects(
    getJsonTreeModelAsync('invalid-tab', content),
    /Expected JSON value/,
  );
  assert.equal(getJsonTreeModelCacheDiagnostics().treeBuilds, 0);
});

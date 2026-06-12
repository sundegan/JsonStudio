import {
  buildJsonTreeModelAsync,
  parseJsonDocumentAsync,
} from './jsonTreeWorker.js';
import { createInvalidJsonStats } from './jsonDocumentModel.js';

export const MAX_TREE_MODEL_CACHE_SIZE = 5;

/**
 * @typedef {Awaited<ReturnType<typeof parseJsonDocumentAsync>>['stats']} JsonStats
 * @typedef {Awaited<ReturnType<typeof buildJsonTreeModelAsync>>} JsonTreeModel
 * @typedef {{
 *   content: string
 *   stats?: JsonStats
 *   parsePromise?: Promise<{ stats: JsonStats }>
 *   tree?: JsonTreeModel
 *   treePromise?: Promise<JsonTreeModel>
 * }} CacheEntry
 */

/** @type {Map<string, CacheEntry>} */
const modelCache = new Map();
const diagnostics = {
  parses: 0,
  parseCacheHits: 0,
  parseInFlightHits: 0,
  treeBuilds: 0,
  treeCacheHits: 0,
  treeInFlightHits: 0,
  evictions: 0,
};

/**
 * Parse a document once and return only its lightweight statistics.
 * @param {string} tabId
 * @param {string} content
 */
export function getJsonDocumentStatsAsync(tabId, content) {
  const entry = getOrCreateEntry(tabId, content);
  if (entry.stats) {
    diagnostics.parseCacheHits += 1;
    return Promise.resolve(entry.stats);
  }
  if (entry.parsePromise) {
    diagnostics.parseInFlightHits += 1;
    return entry.parsePromise.then((result) => result.stats);
  }

  diagnostics.parses += 1;
  const parsePromise = parseJsonDocumentAsync(tabId, content)
    .then((result) => {
      if (modelCache.get(tabId) === entry) {
        entry.stats = result.stats;
        entry.parsePromise = undefined;
        touch(tabId, entry);
      }
      return result;
    })
    .catch((error) => {
      const result = { stats: createInvalidJsonStats(content, error) };
      if (modelCache.get(tabId) === entry) {
        entry.stats = result.stats;
        entry.parsePromise = undefined;
        touch(tabId, entry);
      }
      return result;
    });
  entry.parsePromise = parsePromise;
  return parsePromise.then((result) => result.stats);
}

/**
 * Parse content in the shared worker and return its detected dialect.
 * @param {string} cacheKey
 * @param {string} content
 */
export async function detectJsonDialectAsync(cacheKey, content) {
  const stats = await getJsonDocumentStatsAsync(cacheKey, content);
  return stats.format_type;
}

/**
 * Build Tree View data only when it is requested.
 * @param {string} tabId
 * @param {string} content
 */
export async function getJsonTreeModelAsync(tabId, content) {
  const entry = getOrCreateEntry(tabId, content);
  if (entry.tree) {
    diagnostics.treeCacheHits += 1;
    touch(tabId, entry);
    return entry.tree;
  }
  if (entry.treePromise) {
    diagnostics.treeInFlightHits += 1;
    return entry.treePromise;
  }

  const treePromise = (async () => {
    if (!entry.stats) {
      entry.stats = await getJsonDocumentStatsAsync(tabId, content);
    }
    if (!entry.stats.valid) {
      throw new SyntaxError(
        entry.stats.error_info?.error_message || 'Invalid JSON',
      );
    }
    diagnostics.treeBuilds += 1;
    const tree = await buildJsonTreeModelAsync(tabId, content);
    if (modelCache.get(tabId) === entry) {
      entry.tree = tree;
      entry.treePromise = undefined;
      touch(tabId, entry);
    }
    return tree;
  })().catch((error) => {
    if (modelCache.get(tabId) === entry) entry.treePromise = undefined;
    throw error;
  });

  entry.treePromise = treePromise;
  return treePromise;
}

/**
 * @param {string} tabId
 * @param {string} content
 */
export function getCachedJsonTreeModel(tabId, content) {
  const entry = modelCache.get(tabId);
  if (!entry?.tree || entry.content !== content) return null;
  diagnostics.treeCacheHits += 1;
  touch(tabId, entry);
  return entry.tree;
}

export function clearJsonTreeModelCache() {
  modelCache.clear();
  diagnostics.parses = 0;
  diagnostics.parseCacheHits = 0;
  diagnostics.parseInFlightHits = 0;
  diagnostics.treeBuilds = 0;
  diagnostics.treeCacheHits = 0;
  diagnostics.treeInFlightHits = 0;
  diagnostics.evictions = 0;
}

export function getJsonTreeModelCacheDiagnostics() {
  return {
    ...diagnostics,
    size: modelCache.size,
    tabIds: [...modelCache.keys()],
  };
}

/** @param {string} tabId @param {string} content */
function getOrCreateEntry(tabId, content) {
  const cached = modelCache.get(tabId);
  if (cached?.content === content) {
    touch(tabId, cached);
    return cached;
  }

  /** @type {CacheEntry} */
  const entry = { content };
  modelCache.set(tabId, entry);
  trimCache();
  return entry;
}

function trimCache() {
  while (modelCache.size > MAX_TREE_MODEL_CACHE_SIZE) {
    const oldestTabId = modelCache.keys().next().value;
    if (typeof oldestTabId !== 'string') return;
    modelCache.delete(oldestTabId);
    diagnostics.evictions += 1;
  }
}

/** @param {string} tabId @param {CacheEntry} entry */
function touch(tabId, entry) {
  modelCache.delete(tabId);
  modelCache.set(tabId, entry);
}

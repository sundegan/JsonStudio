import { createJsonDocumentModelCache } from './jsonDocumentModel.js';
import { createPersistentWorker } from './persistentWorker.js';

const treeWorker = createPersistentWorker(
  () => new Worker(new URL('../workers/jsonTree.worker.js', import.meta.url), {
    type: 'module',
  }),
);
const localDocuments = createJsonDocumentModelCache();
let taskQueue = Promise.resolve();

/**
 * @param {'parse' | 'build-tree'} operation
 * @param {string} cacheKey
 * @param {string} content
 */
function runDocumentTask(operation, cacheKey, content) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve().then(() => (
      operation === 'parse'
        ? localDocuments.parse(cacheKey, content)
        : localDocuments.buildTree(cacheKey, content)
    ));
  }

  const run = () => treeWorker.run({ operation, cacheKey, content }).promise
    .catch((error) => {
      throw new SyntaxError(error instanceof Error ? error.message : String(error));
    });
  const result = taskQueue.then(run, run);
  taskQueue = result.catch(() => {});
  return result;
}

/** @param {string} cacheKey @param {string} content */
export function parseJsonDocumentAsync(cacheKey, content) {
  return runDocumentTask('parse', cacheKey, content);
}

/** @param {string} cacheKey @param {string} content */
export function buildJsonTreeModelAsync(cacheKey, content) {
  return runDocumentTask('build-tree', cacheKey, content);
}

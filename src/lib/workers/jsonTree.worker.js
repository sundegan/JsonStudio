import { createJsonDocumentModelCache } from '../services/jsonDocumentModel.js';

const documents = createJsonDocumentModelCache();

/**
 * @param {MessageEvent<{
 *   id: number
 *   payload: {
 *     operation: 'parse' | 'build-tree'
 *     cacheKey: string
 *     content: string
 *   }
 * }>} event
 */
self.onmessage = (event) => {
  const { id, payload } = event.data;
  try {
    const result = payload.operation === 'parse'
      ? documents.parse(payload.cacheKey, payload.content)
      : documents.buildTree(payload.cacheKey, payload.content);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to parse JSON',
    });
  }
};

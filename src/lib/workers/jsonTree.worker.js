import { buildJsonTreeModel } from '../services/jsonTreeModel.js';

/** @param {MessageEvent<{ id: number, payload: { content: string } }>} event */
self.onmessage = (event) => {
  const { id, payload } = event.data;
  try {
    self.postMessage({ id, ok: true, result: buildJsonTreeModel(payload.content) });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to parse JSON',
    });
  }
};

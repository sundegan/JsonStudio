import { buildJsonTreeModel } from '../services/jsonTreeModel.js';

/** @param {MessageEvent<string>} event */
self.onmessage = (event) => {
  try {
    self.postMessage({ ok: true, result: buildJsonTreeModel(event.data) });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to parse JSON',
    });
  }
};

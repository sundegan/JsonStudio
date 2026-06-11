import { buildJsonTreeModel } from './jsonTreeModel.js';

/**
 * @typedef {{
 *   worker: Worker
 *   reject: (reason?: unknown) => void
 * }} ActiveTask
 */

/** @type {ActiveTask | null} */
let activeTask = null;

/**
 * @param {string} content
 * @returns {Promise<ReturnType<typeof buildJsonTreeModel>>}
 */
export function buildJsonTreeModelAsync(content) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(buildJsonTreeModel(content));
  }

  cancelJsonTreeBuild();
  const worker = new Worker(new URL('../workers/jsonTree.worker.js', import.meta.url), {
    type: 'module',
  });

  return new Promise((resolve, reject) => {
    activeTask = { worker, reject };
    worker.onmessage = (event) => {
      if (activeTask?.worker === worker) activeTask = null;
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new SyntaxError(event.data.error));
    };
    worker.onerror = (event) => {
      if (activeTask?.worker === worker) activeTask = null;
      worker.terminate();
      reject(new Error(event.message || 'JSON tree worker failed'));
    };
    worker.postMessage(content);
  });
}

export function cancelJsonTreeBuild() {
  const task = activeTask;
  activeTask = null;
  task?.worker.terminate();
  task?.reject(new DOMException('JSON tree build cancelled', 'AbortError'));
}

import { buildJsonTreeModel } from './jsonTreeModel.js';
import { createPersistentWorker } from './persistentWorker.js';

/**
 * @typedef {{
 *   cancel: () => void
 * }} ActiveTask
 */

/** @type {ActiveTask | null} */
let activeTask = null;
const treeWorker = createPersistentWorker(
  () => new Worker(new URL('../workers/jsonTree.worker.js', import.meta.url), {
    type: 'module',
  }),
);

/**
 * @param {string} content
 * @returns {Promise<ReturnType<typeof buildJsonTreeModel>>}
 */
export function buildJsonTreeModelAsync(content) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(buildJsonTreeModel(content));
  }

  cancelJsonTreeBuild();
  const task = treeWorker.run({ content });
  activeTask = task;
  return task.promise
    .catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new SyntaxError(error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      if (activeTask === task) activeTask = null;
    });
}

export function cancelJsonTreeBuild() {
  const task = activeTask;
  activeTask = null;
  task?.cancel();
}

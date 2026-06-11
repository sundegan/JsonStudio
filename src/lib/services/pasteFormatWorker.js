import { createPersistentWorker } from './persistentWorker.js';

/**
 * @typedef {{
 *   cancel: () => void
 * }} ActiveTask
 */

/** @type {ActiveTask | null} */
let activeTask = null;
const pasteFormatWorker = createPersistentWorker(
  () => new Worker(new URL('../workers/pasteFormat.worker.js', import.meta.url), {
    type: 'module',
  }),
);

/**
 * @param {string} content
 * @param {number} indent
 * @returns {Promise<string | null>}
 */
export function formatPastedJsonAsync(content, indent = 2) {
  if (typeof Worker === 'undefined') return Promise.resolve(null);

  cancelPasteFormat();
  const task = pasteFormatWorker.run({ content, indent });
  activeTask = task;
  return task.promise.finally(() => {
    if (activeTask === task) activeTask = null;
  });
}

export function cancelPasteFormat() {
  const task = activeTask;
  activeTask = null;
  task?.cancel();
}

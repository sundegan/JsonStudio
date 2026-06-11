import { extractLogJsonFragments } from './logJsonFragments.js';
import { createPersistentWorker } from './persistentWorker.js';

/**
 * @typedef {{
 *   cancel: () => void
 * }} ActiveTask
 */

/** @type {ActiveTask | null} */
let activeTask = null;
const logJsonWorker = createPersistentWorker(
  () => new Worker(new URL('../workers/logJson.worker.js', import.meta.url), {
    type: 'module',
  }),
);

/**
 * @param {string} content
 * @param {Parameters<typeof extractLogJsonFragments>[1]} options
 * @returns {Promise<ReturnType<typeof extractLogJsonFragments>>}
 */
export function extractLogJsonFragmentsAsync(content, options = {}) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(extractLogJsonFragments(content, options));
  }

  cancelLogJsonDetection();
  const task = logJsonWorker.run({ content, options });
  activeTask = task;
  return task.promise.finally(() => {
    if (activeTask === task) activeTask = null;
  });
}

export function cancelLogJsonDetection() {
  const task = activeTask;
  activeTask = null;
  task?.cancel();
}

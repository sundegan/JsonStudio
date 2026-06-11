import { extractLogJsonFragments } from './logJsonFragments.js';

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
 * @param {Parameters<typeof extractLogJsonFragments>[1]} options
 * @returns {Promise<ReturnType<typeof extractLogJsonFragments>>}
 */
export function extractLogJsonFragmentsAsync(content, options = {}) {
  if (typeof Worker === 'undefined') {
    return Promise.resolve(extractLogJsonFragments(content, options));
  }

  cancelLogJsonDetection();
  const worker = new Worker(new URL('../workers/logJson.worker.js', import.meta.url), {
    type: 'module',
  });

  return new Promise((resolve, reject) => {
    activeTask = { worker, reject };
    worker.onmessage = (event) => {
      if (activeTask?.worker === worker) activeTask = null;
      worker.terminate();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      if (activeTask?.worker === worker) activeTask = null;
      worker.terminate();
      reject(new Error(event.message || 'Log JSON worker failed'));
    };
    worker.postMessage({ content, options });
  });
}

export function cancelLogJsonDetection() {
  const task = activeTask;
  activeTask = null;
  task?.worker.terminate();
  task?.reject(new DOMException('Log JSON detection cancelled', 'AbortError'));
}

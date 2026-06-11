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
 * @param {number} indent
 * @returns {Promise<string | null>}
 */
export function formatPastedJsonAsync(content, indent = 2) {
  if (typeof Worker === 'undefined') return Promise.resolve(null);

  cancelPasteFormat();
  const worker = new Worker(new URL('../workers/pasteFormat.worker.js', import.meta.url), {
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
      reject(new Error(event.message || 'Paste format worker failed'));
    };
    worker.postMessage({ content, indent });
  });
}

export function cancelPasteFormat() {
  const task = activeTask;
  activeTask = null;
  task?.worker.terminate();
  task?.reject(new DOMException('Paste formatting cancelled', 'AbortError'));
}

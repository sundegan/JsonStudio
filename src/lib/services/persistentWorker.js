/**
 * @typedef {{
 *   id: number
 *   resolve: (value: any) => void
 *   reject: (reason?: unknown) => void
 *   settled: boolean
 * }} WorkerTask
 */

/**
 * Reuse one worker across completed tasks. Cancelling active CPU work replaces
 * the worker because Web Workers cannot interrupt a running message handler.
 *
 * @param {() => Worker} workerFactory
 */
export function createPersistentWorker(workerFactory) {
  /** @type {Worker | null} */
  let worker = null;
  /** @type {WorkerTask | null} */
  let activeTask = null;
  let nextTaskId = 1;

  function ensureWorker() {
    if (worker) return worker;

    const nextWorker = workerFactory();
    nextWorker.onmessage = (event) => {
      if (worker !== nextWorker) return;
      const task = activeTask;
      if (!task || event.data.id !== task.id) return;

      activeTask = null;
      task.settled = true;
      if (event.data.ok) task.resolve(event.data.result);
      else task.reject(new Error(event.data.error));
    };
    nextWorker.onerror = (event) => {
      if (worker !== nextWorker) return;
      const task = activeTask;
      nextWorker.terminate();
      worker = null;
      activeTask = null;
      if (task) {
        task.settled = true;
        task.reject(new Error(event.message || 'Worker failed'));
      }
    };
    worker = nextWorker;
    return nextWorker;
  }

  /** @param {unknown} payload */
  function run(payload) {
    if (activeTask) {
      throw new Error('Persistent worker already has an active task');
    }

    /** @type {(value: any) => void} */
    let resolveTask = () => {};
    /** @type {(reason?: unknown) => void} */
    let rejectTask = () => {};
    const promise = new Promise((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    /** @type {WorkerTask} */
    const task = {
      id: nextTaskId++,
      resolve: resolveTask,
      reject: rejectTask,
      settled: false,
    };
    activeTask = task;

    try {
      ensureWorker().postMessage({ id: task.id, payload });
    } catch (error) {
      activeTask = null;
      worker?.terminate();
      worker = null;
      task.settled = true;
      task.reject(error);
    }

    return {
      promise,
      cancel() {
        if (task.settled) return;
        task.settled = true;
        if (activeTask === task) activeTask = null;
        worker?.terminate();
        worker = null;
        task.reject(new DOMException('Worker task cancelled', 'AbortError'));
      },
    };
  }

  return { run };
}

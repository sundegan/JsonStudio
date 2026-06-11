import { extractLogJsonFragments } from '../services/logJsonFragments.js';

/** @param {MessageEvent<{ content: string, options: Parameters<typeof extractLogJsonFragments>[1] }>} event */
self.onmessage = (event) => {
  try {
    self.postMessage({
      ok: true,
      result: extractLogJsonFragments(event.data.content, event.data.options),
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Log JSON detection failed',
    });
  }
};

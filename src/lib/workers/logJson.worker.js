import { extractLogJsonFragments } from '../services/logJsonFragments.js';

/** @param {MessageEvent<{
 *   id: number
 *   payload: {
 *     content: string
 *     options: Parameters<typeof extractLogJsonFragments>[1]
 *   }
 * }>} event
 */
self.onmessage = (event) => {
  const { id, payload } = event.data;
  try {
    self.postMessage({
      id,
      ok: true,
      result: extractLogJsonFragments(payload.content, payload.options),
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Log JSON detection failed',
    });
  }
};

import { formatJsonText } from '../services/json5Format.js';
import { getStandaloneEscapedJsonContent } from '../services/logJsonFragments.js';
import { normalizePastedStandaloneJson } from '../services/standaloneJsonPasteNormalize.js';

/** @param {MessageEvent<{ id: number, payload: { content: string, indent: number } }>} event */
self.onmessage = async (event) => {
  const { id, payload } = event.data;
  try {
    const result = await normalizePastedStandaloneJson(payload.content, {
      indent: payload.indent,
      formatJson: formatJsonText,
      getStandaloneEscapedJsonContent,
    });
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to format pasted JSON',
    });
  }
};

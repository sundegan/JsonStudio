import { formatJsonText } from '../services/json5Format.js';
import { getStandaloneEscapedJsonContent } from '../services/logJsonFragments.js';
import { normalizePastedStandaloneJson } from '../services/standaloneJsonPasteNormalize.js';

/** @param {MessageEvent<{ content: string, indent: number }>} event */
self.onmessage = async (event) => {
  try {
    const result = await normalizePastedStandaloneJson(event.data.content, {
      indent: event.data.indent,
      formatJson: formatJsonText,
      getStandaloneEscapedJsonContent,
    });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to format pasted JSON',
    });
  }
};

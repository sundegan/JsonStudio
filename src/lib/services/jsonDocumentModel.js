import { buildJsonTreeModelFromDocument } from './jsonTreeModel.js';
import {
  buildJsonSourcePointers,
  parseJsonSourceDocument,
  utf8ByteLength,
} from './jsonSourceModel.js';

const MAX_DOCUMENT_MODEL_CACHE_SIZE = 5;

/**
 * @param {string} content
 * @param {unknown} error
 */
export function createInvalidJsonStats(content, error) {
  const message = error instanceof Error ? error.message : String(error);
  const offsetMatch = message.match(/at position (\d+)/);
  const offset = offsetMatch
    ? Math.min(content.length, Number.parseInt(offsetMatch[1], 10))
    : null;
  let line = null;
  let column = null;

  if (offset !== null) {
    line = 1;
    column = 1;
    for (let index = 0; index < offset; index += 1) {
      if (content[index] === '\n') {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
  }

  return {
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: utf8ByteLength(content),
    format_type: '',
    error_info: {
      valid: false,
      error_message: message,
      error_line: line,
      error_column: column,
    },
  };
}

export function createJsonDocumentModelCache(
  maxSize = MAX_DOCUMENT_MODEL_CACHE_SIZE,
) {
  /**
   * @typedef {{
   *   content: string
   *   document: ReturnType<typeof parseJsonSourceDocument>
   * }} DocumentEntry
   */
  /** @type {Map<string, DocumentEntry>} */
  const documents = new Map();

  /** @param {string} cacheKey @param {string} content */
  function getDocument(cacheKey, content) {
    const cached = documents.get(cacheKey);
    if (cached?.content === content) {
      touch(cacheKey, cached);
      return cached.document;
    }

    const document = parseJsonSourceDocument(content, {
      dialect: 'AUTO',
      retainSourceModel: true,
      buildPointers: false,
    });
    const entry = { content, document };
    documents.set(cacheKey, entry);
    trim();
    return document;
  }

  /** @param {string} cacheKey @param {string} content */
  function parse(cacheKey, content) {
    return {
      stats: getDocument(cacheKey, content).stats,
    };
  }

  /** @param {string} cacheKey @param {string} content */
  function buildTree(cacheKey, content) {
    const document = getDocument(cacheKey, content);
    if (!document.pointersBuilt && 'sourceModel' in document) {
      document.pointers = buildJsonSourcePointers(document.sourceModel);
      document.pointersBuilt = true;
    }
    return buildJsonTreeModelFromDocument(document);
  }

  function diagnostics() {
    return {
      size: documents.size,
      cacheKeys: [...documents.keys()],
      pointerModelCount: [...documents.values()]
        .filter((entry) => entry.document.pointersBuilt)
        .length,
    };
  }

  function clear() {
    documents.clear();
  }

  function trim() {
    while (documents.size > maxSize) {
      const oldestKey = documents.keys().next().value;
      if (typeof oldestKey !== 'string') return;
      documents.delete(oldestKey);
    }
  }

  /** @param {string} cacheKey @param {DocumentEntry} entry */
  function touch(cacheKey, entry) {
    documents.delete(cacheKey);
    documents.set(cacheKey, entry);
  }

  return { parse, buildTree, diagnostics, clear };
}

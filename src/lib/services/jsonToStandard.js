import { parseJsonSourceDocument } from './jsonSourceModel.js';

/**
 * Convert a valid JSONC or JSON5 document into formatted, strict JSON.
 *
 * Object entries are serialized from the source model so duplicate keys remain
 * intact. JSON5 non-finite numbers are represented as null in strict JSON.
 *
 * @param {string} content
 * @param {number} [indent]
 * @returns {string}
 */
export function convertToStandardJson(content, indent = 2) {
  const parsed = parseJsonSourceDocument(content, {
    dialect: 'AUTO',
    retainSourceModel: true,
  });
  if (!('sourceModel' in parsed)) {
    throw new Error('Cannot build JSON source model');
  }

  return serializeSourceNode(parsed.sourceModel, indent, 0);
}

/**
 * @param {import('./jsonSourceModel.js').JsonSourceNode} node
 * @param {number} indent
 * @param {number} depth
 * @returns {string}
 */
function serializeSourceNode(node, indent, depth) {
  if (node.kind === 'object') {
    if (node.entries.length === 0) return '{}';
    const innerIndent = ' '.repeat(indent * (depth + 1));
    const outerIndent = ' '.repeat(indent * depth);
    const entries = node.entries.map((entry) => (
      `${innerIndent}${JSON.stringify(entry.key)}: ${serializeSourceNode(entry.value, indent, depth + 1)}`
    ));
    return `{\n${entries.join(',\n')}\n${outerIndent}}`;
  }

  if (node.kind === 'array') {
    if (node.items.length === 0) return '[]';
    const innerIndent = ' '.repeat(indent * (depth + 1));
    const outerIndent = ' '.repeat(indent * depth);
    const items = node.items.map((item) => `${innerIndent}${serializeSourceNode(item, indent, depth + 1)}`);
    return `[\n${items.join(',\n')}\n${outerIndent}]`;
  }

  if (node.kind === 'number' && !Number.isFinite(Number(node.value))) return 'null';
  return JSON.stringify(node.value);
}

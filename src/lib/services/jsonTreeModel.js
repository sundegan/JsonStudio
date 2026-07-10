import { parseJsonDocument } from './jsonDocumentParse.js';
import { getJsonSourceValue, isJsonSourceNode } from './jsonSourceModel.js';

/**
 * @typedef {'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'} TreeNodeType
 * @typedef {'object' | 'array'} ParentType
 * @typedef {{
 *   key: string
 *   value: unknown
 *   type: TreeNodeType
 *   path: string
 *   parentType: ParentType
 *   parentKeys: string[]
 *   children?: TreeNode[]
 *   startOffset: number
 *   endOffset: number
 *   entryStartOffset: number
 *   entryEndOffset: number
 * }} TreeNode
 */

/**
 * Build the complete tree representation away from the UI component.
 * @param {string} content
 * @returns {{
 *   rootData: unknown
 *   pointers: Record<string, { valueStart?: number, valueEnd?: number, keyStart?: number, keyEnd?: number }>
 *   dialect: 'JSON' | 'JSON5'
 *   hasDuplicateSourceKeys: boolean
 *   nodes: TreeNode[]
 *   nodeIndex: Map<string, TreeNode>
 *   stats: {
 *     valid: boolean
 *     key_count: number
 *     depth: number
 *     byte_size: number
 *     format_type: 'JSON' | 'JSON5'
 *     error_info: null
 *   }
 * }}
 */
export function buildJsonTreeModel(content) {
  const parsed = parseJsonDocument(content);
  return buildJsonTreeModelFromDocument(parsed);
}

/**
 * Derive Tree View data from a document that has already been parsed.
 * @param {ReturnType<typeof parseJsonDocument>} parsed
 */
export function buildJsonTreeModelFromDocument(parsed) {
  const sourceModel = 'sourceModel' in parsed ? parsed.sourceModel : null;
  const nodes = parseToTree(sourceModel ?? parsed.data, parsed.pointers, '');
  /** @type {'JSON' | 'JSON5'} */
  const dialect = parsed.dialect === 'JSON5' ? 'JSON5' : 'JSON';

  return {
    rootData: parsed.data,
    pointers: parsed.pointers,
    dialect,
    hasDuplicateSourceKeys: Boolean(sourceModel?.hasDuplicateKeys),
    nodes,
    nodeIndex: indexTreeNodes(nodes),
    stats: parsed.stats,
  };
}

/**
 * @param {unknown} data
 * @param {Record<string, { valueStart?: number, valueEnd?: number, keyStart?: number, keyEnd?: number }>} pointers
 * @param {string} parentPath
 * @returns {TreeNode[]}
 */
function parseToTree(data, pointers, parentPath) {
  /** @type {TreeNode[]} */
  const nodes = [];
  if (data === null) return nodes;

  if (isJsonSourceNode(data)) {
    if (data.kind === 'array') {
      data.items.forEach((item, index) => {
        const path = parentPath ? `${parentPath}/${index}` : `/${index}`;
        nodes.push(createTreeNode(`[${index}]`, item, path, 'array', [], pointers));
      });
    } else if (data.kind === 'object') {
      const keys = data.entries.map((entry) => entry.key);
      data.entries.forEach((entry) => {
        const path = childPathForSourceEntry(parentPath, entry.key, entry.occurrence ?? 0);
        nodes.push(createTreeNode(
          entry.key,
          entry.value,
          path,
          'object',
          keys,
          pointers,
        ));
      });
    }
    return nodes;
  }

  if (Array.isArray(data)) {
    data.forEach((item, index) => {
      const path = parentPath ? `${parentPath}/${index}` : `/${index}`;
      nodes.push(createTreeNode(`[${index}]`, item, path, 'array', [], pointers));
    });
  } else if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (data));
    const keys = entries.map(([key]) => key);
    entries.forEach(([key, value]) => {
      const path = parentPath
        ? `${parentPath}/${encodePointerSegment(key)}`
        : `/${encodePointerSegment(key)}`;
      nodes.push(createTreeNode(
        key,
        value,
        path,
        'object',
        keys,
        pointers,
      ));
    });
  }

  return nodes;
}

/**
 * @param {string} key
 * @param {unknown} sourceValue
 * @param {string} path
 * @param {ParentType} parentType
 * @param {string[]} parentKeys
 * @param {Record<string, { valueStart?: number, valueEnd?: number, keyStart?: number, keyEnd?: number }>} pointers
 * @returns {TreeNode}
 */
function createTreeNode(key, sourceValue, path, parentType, parentKeys, pointers) {
  const type = getValueType(sourceValue);
  const pointerInfo = pointers[path];
  const sourceNode = isJsonSourceNode(sourceValue) ? sourceValue : null;
  const startOffset = sourceNode?.start ?? pointerInfo?.valueStart ?? 0;
  const endOffset = sourceNode?.end ?? pointerInfo?.valueEnd ?? 0;
  /** @type {TreeNode} */
  const node = {
    key,
    value: type === 'object' || type === 'array' ? null : getJsonSourceValue(sourceValue),
    type,
    path,
    parentType,
    parentKeys,
    startOffset,
    endOffset,
    entryStartOffset: pointerInfo?.keyStart ?? startOffset,
    entryEndOffset: endOffset,
  };

  if (type === 'object' || type === 'array') {
    node.children = parseToTree(sourceValue, pointers, path);
  }
  return node;
}

/**
 * @param {TreeNode[]} nodes
 * @returns {Map<string, TreeNode>}
 */
function indexTreeNodes(nodes) {
  /** @type {Map<string, TreeNode>} */
  const index = new Map();
  const pending = [...nodes];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node) continue;
    index.set(node.path, node);
    if (node.children) pending.push(...node.children);
  }
  return index;
}

/**
 * Find the most specific Tree node containing an editor offset. Object properties
 * use a range from the key through the value, including the colon and
 * any whitespace between them.
 * @param {TreeNode[]} nodes
 * @param {number} offset
 * @returns {TreeNode | null}
 */
export function findJsonTreeNodeAtOffset(nodes, offset) {
  for (const node of nodes) {
    if (!containsSourceOffset(node, offset)) continue;

    if (node.children) {
      const childMatch = findJsonTreeNodeAtOffset(node.children, offset);
      if (childMatch) return childMatch;
    }

    return node;
  }

  return null;
}

/** @param {TreeNode} node @param {number} offset */
function containsSourceOffset(node, offset) {
  return isOffsetInRange(offset, node.entryStartOffset, node.entryEndOffset);
}

/** @param {number} offset @param {number | undefined} start @param {number | undefined} end */
function isOffsetInRange(offset, start, end) {
  if (start == null || end == null) return false;
  const exclusiveEnd = end <= start ? start + 1 : end;
  return offset >= start && offset < exclusiveEnd;
}

/**
 * @param {unknown} value
 * @returns {TreeNodeType}
 */
function getValueType(value) {
  value = getJsonSourceValue(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

/** @param {string} segment */
function encodePointerSegment(segment) {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * @param {string} parentPath
 * @param {string} key
 * @param {number} occurrence
 */
function childPathForSourceEntry(parentPath, key, occurrence) {
  const basePath = parentPath
    ? `${parentPath}/${encodePointerSegment(key)}`
    : `/${encodePointerSegment(key)}`;
  return occurrence === 0 ? basePath : `${basePath}~${occurrence + 1}`;
}

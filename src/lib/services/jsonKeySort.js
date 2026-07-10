/**
 * Sort object keys recursively while preserving array order.
 * @param {string} content
 * @param {'asc' | 'desc'} direction
 * @param {number} [indent]
 * @returns {string}
 */
export function sortJsonKeys(content, direction, indent = 2) {
  const parsed = parseJsonSourceDocument(content, {
    dialect: 'JSON',
    retainSourceModel: true,
  });
  if ('sourceModel' in parsed && parsed.sourceModel.hasDuplicateKeys) {
    throw new Error('Cannot sort JSON with duplicate keys');
  }
  return JSON.stringify(sortValue(parsed.data, direction), null, indent);
}

/** @param {unknown} value @param {'asc' | 'desc'} direction @returns {unknown} */
function sortValue(value, direction) {
  if (Array.isArray(value)) return value.map((item) => sortValue(item, direction));
  if (!value || typeof value !== 'object') return value;

  const entries = Object.entries(value).sort(([left], [right]) => {
    const comparison = left.localeCompare(right);
    return direction === 'asc' ? comparison : -comparison;
  });
  return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item, direction)]));
}
import { parseJsonSourceDocument } from './jsonSourceModel.js';

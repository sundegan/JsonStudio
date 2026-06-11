import { parseJsonSourceDocument } from './jsonSourceModel.js';

/**
 * Parse JSON and JSON5 in one pass while reporting the syntax actually used.
 * @param {string} content
 */
export function parseJsonDocument(content) {
  return parseJsonSourceDocument(content, {
    dialect: 'AUTO',
    retainSourceModel: false,
  });
}

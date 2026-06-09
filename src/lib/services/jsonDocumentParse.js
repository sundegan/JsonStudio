import jsonSourceMap from '@mischnic/json-sourcemap';
import { buildJsonSourcePointers, parseJsonSourceModel } from './jsonSourceModel.js';

const { parse } = jsonSourceMap;

/**
 * Parse editor content using the same JSON -> JSON5 fallback behavior across views.
 * @param {string} content
 */
export function parseJsonDocument(content) {
  try {
    const parsed = parse(content, undefined, { dialect: 'JSON' });
    const sourceModel = parseJsonSourceModel(content);
    return {
      ...parsed,
      pointers: {
        ...parsed.pointers,
        ...buildJsonSourcePointers(sourceModel),
      },
      sourceModel,
      dialect: 'JSON',
    };
  } catch (jsonError) {
    try {
      return {
        ...parse(content, undefined, { dialect: 'JSON5' }),
        dialect: 'JSON5',
      };
    } catch {
      throw jsonError;
    }
  }
}

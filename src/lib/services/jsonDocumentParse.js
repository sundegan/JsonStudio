import jsonSourceMap from '@mischnic/json-sourcemap';

const { parse } = jsonSourceMap;

/**
 * Parse editor content using the same JSON -> JSON5 fallback behavior across views.
 * @param {string} content
 */
export function parseJsonDocument(content) {
  try {
    return {
      ...parse(content, undefined, { dialect: 'JSON' }),
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

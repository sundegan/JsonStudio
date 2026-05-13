/**
 * @typedef {{
 *   indent?: number;
 *   formatJson: (value: string, indent?: number) => Promise<string>;
 *   getStandaloneEscapedJsonContent: (value: string) => string | null;
 * }} NormalizeStandaloneJsonPasteOptions
 */

/**
 * Auto-format pasted standalone standard JSON and escaped JSON strings only.
 * JSON5 must stay untouched because formatting converts it to standard JSON.
 *
 * @param {string} sourceValue
 * @param {NormalizeStandaloneJsonPasteOptions} options
 * @returns {Promise<string | null>}
 */
export async function normalizePastedStandaloneJson(sourceValue, options) {
  const trimmed = sourceValue.trim();
  if (!trimmed) return null;

  const indent = options.indent ?? 2;
  const escapedJson = options.getStandaloneEscapedJsonContent(trimmed);
  if (escapedJson) {
    return await options.formatJson(escapedJson, indent);
  }

  try {
    JSON.parse(trimmed);
    return await options.formatJson(sourceValue, indent);
  } catch {
    return null;
  }
}

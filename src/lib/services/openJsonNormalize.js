/**
 * @typedef {{
 *   valid: boolean;
 *   format_type: string;
 * }} OpenedJsonStats
 */

/**
 * @typedef {{
 *   indent?: number;
 *   formatJson: (value: string, indent?: number) => Promise<string>;
 *   getJsonStats: (value: string) => Promise<OpenedJsonStats>;
 *   formatJson5: (value: string, indent?: number) => Promise<string>;
 * }} NormalizeOpenedJsonOptions
 */

/**
 * Format valid JSON and JSON5 files before they enter editor tabs.
 * Invalid or unrelated text is kept unchanged so opening a file never destroys
 * content that the formatter cannot understand.
 *
 * @param {string} sourceValue
 * @param {NormalizeOpenedJsonOptions} options
 * @returns {Promise<string>}
 */
export async function normalizeOpenedJson(sourceValue, options) {
  if (!sourceValue.trim()) return sourceValue;

  const indent = options.indent ?? 2;
  try {
    JSON.parse(sourceValue);
    return await options.formatJson(sourceValue, indent);
  } catch {
  }

  try {
    const stats = await options.getJsonStats(sourceValue);
    if (stats.valid && stats.format_type === 'JSON5') {
      return await options.formatJson5(sourceValue, indent);
    }
  } catch {
  }

  return sourceValue;
}

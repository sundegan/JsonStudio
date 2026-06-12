/**
 * @typedef {{
 *   indent?: number;
 *   formatJson: (value: string, indent?: number) => Promise<string>;
 *   detectDialect: (value: string) => Promise<'JSON' | 'JSON5' | ''>;
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
    const dialect = await options.detectDialect(sourceValue);
    if (dialect === 'JSON') {
      return await options.formatJson(sourceValue, indent);
    }
    if (dialect === 'JSON5') {
      return await options.formatJson5(sourceValue, indent);
    }
  } catch {
  }

  return sourceValue;
}

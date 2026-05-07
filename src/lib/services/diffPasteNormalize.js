/**
 * @typedef {{
 *   format: (value: string) => Promise<string>;
 *   unescape: (value: string) => Promise<string>;
 * }} NormalizePastedJsonOptions
 */

/**
 * @param {string} value
 * @param {NormalizePastedJsonOptions} options
 * @returns {Promise<string | null>}
 */
export async function normalizePastedJson(value, options) {
  if (!value.trim()) {
    return null;
  }

  const jsonString = parseJsonString(value);
  if (jsonString) {
    const formattedStringContent = await tryFormat(jsonString, options);
    if (formattedStringContent) {
      return formattedStringContent;
    }
  }

  const directFormatted = await tryFormat(value, options);
  if (directFormatted) {
    return directFormatted;
  }

  const unescaped = await tryUnescape(value, options);
  if (!unescaped || unescaped === value) {
    return null;
  }

  return await tryFormat(unescaped, options);
}

/**
 * @param {string} value
 * @param {NormalizePastedJsonOptions} options
 */
async function tryFormat(value, options) {
  try {
    return await options.format(value);
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 */
function parseJsonString(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 * @param {NormalizePastedJsonOptions} options
 */
async function tryUnescape(value, options) {
  try {
    return await options.unescape(value);
  } catch {
    try {
      const escapedLineBreaks = value.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      const parsed = JSON.parse(`"${escapedLineBreaks}"`);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
}

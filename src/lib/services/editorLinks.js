const URL_PATTERN = /^https?:\/\/\S+$/i;

/**
 * @param {string} value
 */
export function isOpenableUrl(value) {
  return URL_PATTERN.test(value.trim());
}

/**
 * @param {string} lineText
 * @param {number} column
 */
export function getJsonStringUrlAtColumn(lineText, column) {
  const index = Math.max(0, column - 1);

  for (let start = 0; start < lineText.length; start += 1) {
    if (lineText[start] !== '"') continue;

    let escaped = false;
    for (let end = start + 1; end < lineText.length; end += 1) {
      const char = lineText[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char !== '"') continue;

      if (index >= start && index <= end) {
        const raw = lineText.slice(start, end + 1);
        try {
          const value = JSON.parse(raw);
          return typeof value === 'string' && isOpenableUrl(value) ? value.trim() : null;
        } catch {
          return null;
        }
      }
      start = end;
      break;
    }
  }

  return null;
}

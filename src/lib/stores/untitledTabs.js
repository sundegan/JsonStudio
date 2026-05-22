export const UNTITLED_NAME = 'Untitled';
export const FIRST_UNTITLED_NAME = `${UNTITLED_NAME}-1`;

/**
 * @param {{ filePath: string | null; fileName: string | null }[]} tabs
 */
export function getNextUntitledName(tabs) {
  const usedIndexes = new Set(
    tabs
      .filter(isUntitledTab)
      .map(tab => getUntitledIndex(tab.fileName || ''))
      .filter(index => index > 0)
  );

  for (let index = 1; index <= tabs.length + 1; index += 1) {
    if (!usedIndexes.has(index)) {
      return `${UNTITLED_NAME}-${index}`;
    }
  }

  return `${UNTITLED_NAME}-${tabs.length + 1}`;
}

/**
 * @param {string | null | undefined} fileName
 */
export function getSaveFileName(fileName) {
  const name = fileName?.trim();
  if (!name) return 'untitled.json';
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
}

/**
 * @param {{ filePath: string | null; fileName: string | null }} tab
 */
function isUntitledTab(tab) {
  return !tab.filePath && !!tab.fileName && /^Untitled(?:-\d+)?$/.test(tab.fileName);
}

/**
 * @param {string} fileName
 */
function getUntitledIndex(fileName) {
  if (fileName === UNTITLED_NAME) {
    return 1;
  }

  const match = /^Untitled-(\d+)$/.exec(fileName);
  return match ? Number(match[1]) : 0;
}

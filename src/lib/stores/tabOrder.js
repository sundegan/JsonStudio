/**
 * Move an item to a requested insertion index. The insertion index is measured
 * against the original array boundaries, so callers can use 0..tabs.length.
 *
 * @template T
 * @param {T[]} tabs
 * @param {number} fromIndex
 * @param {number} insertionIndex
 * @returns {T[]}
 */
export function moveTabToInsertionIndex(tabs, fromIndex, insertionIndex) {
  if (fromIndex < 0 || fromIndex >= tabs.length) {
    return tabs;
  }

  const boundedInsertionIndex = Math.max(0, Math.min(insertionIndex, tabs.length));
  const adjustedInsertionIndex = fromIndex < boundedInsertionIndex
    ? boundedInsertionIndex - 1
    : boundedInsertionIndex;

  if (fromIndex === adjustedInsertionIndex) {
    return tabs;
  }

  const newTabs = [...tabs];
  const [removed] = newTabs.splice(fromIndex, 1);
  newTabs.splice(adjustedInsertionIndex, 0, removed);
  return newTabs;
}

/**
 * Find the tab boundary nearest to a horizontal pointer position.
 *
 * @param {{ id: string; left: number; width: number }[]} tabRects
 * @param {number} pointerX
 * @returns {{ targetTabId: string; position: 'before' | 'after'; insertionIndex: number } | null}
 */
export function getTabInsertionTarget(tabRects, pointerX) {
  if (tabRects.length === 0) {
    return null;
  }

  for (let index = 0; index < tabRects.length; index += 1) {
    const rect = tabRects[index];
    const center = rect.left + rect.width / 2;
    if (pointerX < center) {
      return {
        targetTabId: rect.id,
        position: 'before',
        insertionIndex: index,
      };
    }
  }

  const lastIndex = tabRects.length - 1;
  return {
    targetTabId: tabRects[lastIndex].id,
    position: 'after',
    insertionIndex: tabRects.length,
  };
}

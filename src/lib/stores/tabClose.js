/**
 * @param {Array<{ id: string, isModified: boolean }>} tabs
 * @param {string} tabId
 */
export function shouldConfirmCloseTab(tabs, tabId) {
  return Boolean(tabs.find(tab => tab.id === tabId)?.isModified);
}

/**
 * @param {Array<{ id: string, isPinned: boolean, isModified: boolean }>} tabs
 * @param {string} keepTabId
 */
export function shouldConfirmCloseOtherTabs(tabs, keepTabId) {
  return tabs.some(tab => tab.id !== keepTabId && !tab.isPinned && tab.isModified);
}

/**
 * @param {Array<{ isModified: boolean }>} tabs
 */
export function shouldConfirmCloseAllTabs(tabs) {
  return tabs.some(tab => tab.isModified);
}

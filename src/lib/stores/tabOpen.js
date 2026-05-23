export const MAX_TABS = 15;

/**
 * @param {{ tabs: Array<any>, activeTabId: string | null }} state
 * @param {string} content
 * @param {string} filePath
 * @param {string | null} fileName
 * @returns {{ state: { tabs: Array<any>, activeTabId: string | null }, maxTabsReached: boolean }}
 */
export function openFileInTabs(state, content, filePath, fileName) {
  const existingTab = state.tabs.find(tab => tab.filePath === filePath);
  if (existingTab) {
    return {
      state: {
        ...state,
        activeTabId: existingTab.id,
        tabs: state.tabs.map(tab =>
          tab.id === existingTab.id && !tab.isModified
            ? { ...tab, content, filePath, fileName, isModified: false }
            : tab
        ),
      },
      maxTabsReached: false,
    };
  }

  return {
    state,
    maxTabsReached: state.tabs.length >= MAX_TABS,
  };
}

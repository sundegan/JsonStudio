/**
 * @param {{ tabs: Array<any>, activeTabId: string | null }} state
 * @param {string} filePath
 * @param {string | null} fileName
 * @returns {{ tabs: Array<any>, activeTabId: string | null }}
 */
export function openFileInTabs(state, filePath, fileName) {
  const existingTab = state.tabs.find(tab => tab.filePath === filePath);
  if (existingTab) {
    return {
      ...state,
      activeTabId: existingTab.id,
      tabs: state.tabs.map(tab =>
        tab.id === existingTab.id && !tab.isModified
          ? { ...tab, filePath, fileName, isModified: false, contentVersion: (tab.contentVersion ?? 0) + 1 }
          : tab
      ),
    };
  }

  return state;
}

/**
 * @param {{ tabs: Array<any>, activeTabId: string | null }} state
 * @param {string} content
 * @param {string} filePath
 * @param {string | null} fileName
 * @returns {{ tabs: Array<any>, activeTabId: string | null }}
 */
export function openFileInTabs(state, content, filePath, fileName) {
  const existingTab = state.tabs.find(tab => tab.filePath === filePath);
  if (existingTab) {
    return {
      ...state,
      activeTabId: existingTab.id,
      tabs: state.tabs.map(tab =>
        tab.id === existingTab.id && !tab.isModified
          ? { ...tab, content, filePath, fileName, isModified: false }
          : tab
      ),
    };
  }

  return state;
}

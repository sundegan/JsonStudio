import { writable, derived } from 'svelte/store';
import type { JsonStats } from '$lib/services/json';

export interface Tab {
  id: string;                    // Unique identifier
  filePath: string | null;       // File path
  fileName: string | null;       // File name
  content: string;               // Editor content
  isModified: boolean;           // Modified flag
  stats: JsonStats;              // JSON statistics
  isDefault: boolean;            // Default tab flag
  isPinned: boolean;             // Pinned tab flag
}

export interface TabsState {
  tabs: Tab[];                   // All tabs
  activeTabId: string | null;    // Currently active tab ID
}

export interface DiffModeState {
  leftTabs: Tab[];               // Left side tabs in diff mode
  rightTabs: Tab[];              // Right side tabs in diff mode
  leftActiveTabId: string | null;
  rightActiveTabId: string | null;
}

const STORAGE_KEY = 'jsonstudio_tabs_state';
const MAX_TABS = 10;

// Create empty stats object
function createEmptyStats(): JsonStats {
  return {
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    error_info: null,
  };
}

// Generate unique ID
function generateId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Create new tab
export function createNewTab(
  content: string = '',
  filePath: string | null = null,
  fileName: string | null = null,
  isDefault: boolean = false,
  isPinned: boolean = false
): Tab {
  return {
    id: generateId(),
    filePath,
    fileName,
    content,
    isModified: false,
    stats: createEmptyStats(),
    isDefault,
    isPinned,
  };
}

function createDefaultTab(): Tab {
  return createNewTab('', null, null, true);
}

const defaultState: TabsState = {
  tabs: [createDefaultTab()],
  activeTabId: null,
};

// Load state from localStorage
function loadState(): TabsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: TabsState = JSON.parse(stored);
      // Don't restore file paths for security
      const sanitizedTabs: Tab[] = parsed.tabs.map(tab => ({
        ...tab,
        filePath: null,
        fileName: null,
        isModified: false,
        isDefault: tab.isDefault ?? false,
        isPinned: tab.isPinned ?? false,
      }));
      
      // Ensure at least one tab
      if (sanitizedTabs.length === 0) {
        sanitizedTabs.push(createDefaultTab());
      }
      
      // Set first tab as active if no active tab
      const activeId = parsed.activeTabId && sanitizedTabs.find(t => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : sanitizedTabs[0].id;
      
      return {
        tabs: sanitizedTabs,
        activeTabId: activeId,
      };
    }
  } catch (e) {
    console.error('Failed to load tabs state:', e);
  }
  
  const newTab = createNewTab();
  return {
    tabs: [newTab],
    activeTabId: newTab.id,
  };
}

// Save state to localStorage
function saveState(state: TabsState) {
  try {
    // Limit what we save to avoid localStorage quota issues
    const toSave: TabsState = {
      tabs: state.tabs.map(tab => ({
        ...tab,
        // Don't persist file paths for security
        filePath: null,
        fileName: null,
        // Limit content size for storage
        content: tab.content.length > 100000 ? '' : tab.content,
      })),
      activeTabId: state.activeTabId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('Failed to save tabs state:', e);
  }
}

function createTabsStore() {
  const { subscribe, set, update } = writable<TabsState>(loadState());
  
  // Separate writable store for diff mode state
  const diffModeStore = writable<DiffModeState | null>(null);
  let diffModeState: DiffModeState | null = null;
  
  // Subscribe to keep local reference in sync (no need to unsubscribe as it's internal)
  diffModeStore.subscribe(value => {
    diffModeState = value;
  });

  function moveTab(tabs: Tab[], fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return tabs;
    const newTabs = [...tabs];
    const [removed] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, removed);
    return newTabs;
  }

  return {
    subscribe,
    
    // Add new tab
    addTab: (content: string = '', filePath: string | null = null, fileName: string | null = null) => {
      update(state => {
        // Check max tabs limit
        if (state.tabs.length >= MAX_TABS) {
          console.warn(`Maximum ${MAX_TABS} tabs allowed`);
          return state;
        }
        
        const newTab = createNewTab(content, filePath, fileName);
        const newState = {
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Remove tab by ID
    removeTab: (tabId: string) => {
      update(state => {
        const tabIndex = state.tabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return state;
        
        const newTabs = state.tabs.filter(t => t.id !== tabId);
        
        // Ensure at least one tab
        if (newTabs.length === 0) {
          newTabs.push(createNewTab());
        }
        
        // Update active tab if removed tab was active
        let newActiveId = state.activeTabId;
        if (state.activeTabId === tabId) {
          // Switch to previous tab or next tab
          const newIndex = Math.max(0, tabIndex - 1);
          newActiveId = newTabs[newIndex].id;
        }
        
        const newState = {
          tabs: newTabs,
          activeTabId: newActiveId,
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Switch active tab
    setActiveTab: (tabId: string) => {
      update(state => {
        if (!state.tabs.find(t => t.id === tabId)) {
          return state;
        }
        const newState = {
          ...state,
          activeTabId: tabId,
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Update tab content
    updateTabContent: (tabId: string, content: string) => {
      update(state => {
        const newState = {
          ...state,
          tabs: state.tabs.map(tab => 
            tab.id === tabId 
              ? { ...tab, content, isModified: tab.filePath ? true : tab.isModified }
              : tab
          ),
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Update tab file info
    updateTabFile: (tabId: string, filePath: string | null, fileName: string | null) => {
      update(state => {
        const newState = {
          ...state,
          tabs: state.tabs.map(tab =>
            tab.id === tabId
              ? { ...tab, filePath, fileName, isModified: false, isDefault: false }
              : tab
          ),
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Update tab modified state
    updateTabModified: (tabId: string, isModified: boolean) => {
      update(state => {
        const newState = {
          ...state,
          tabs: state.tabs.map(tab =>
            tab.id === tabId
              ? { ...tab, isModified }
              : tab
          ),
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Update tab stats
    updateTabStats: (tabId: string, stats: JsonStats) => {
      update(state => {
        const newState = {
          ...state,
          tabs: state.tabs.map(tab =>
            tab.id === tabId
              ? { ...tab, stats }
              : tab
          ),
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Reorder tabs (for drag & drop)
    reorderTabs: (fromIndex: number, toIndex: number) => {
      update(state => {
        const newTabs = moveTab(state.tabs, fromIndex, toIndex);
        const newState = {
          ...state,
          tabs: newTabs,
        };
        saveState(newState);
        return newState;
      });
    },

    // Close all tabs except the specified one
    closeOtherTabs: (tabId: string) => {
      update(state => {
        const keepTab = state.tabs.find(tab => tab.id === tabId);
        if (!keepTab) {
          return state;
        }
        const keepTabs = state.tabs.filter(tab => tab.id === tabId || tab.isPinned);
        const newState: TabsState = {
          tabs: keepTabs,
          activeTabId: keepTabs.find(tab => tab.id === tabId)?.id || keepTabs[0].id,
        };
        saveState(newState);
        return newState;
      });
    },

    // Toggle pinned state for a tab
    togglePinTab: (tabId: string) => {
      update(state => {
        const tabIndex = state.tabs.findIndex(tab => tab.id === tabId);
        if (tabIndex === -1) return state;

        const targetTab = state.tabs[tabIndex];
        const nextPinned = !targetTab.isPinned;
        const updatedTab = { ...targetTab, isPinned: nextPinned };
        const updatedTabs = [...state.tabs];
        updatedTabs[tabIndex] = updatedTab;

        let newTabs = updatedTabs;
        if (nextPinned) {
          const lastPinnedIndex = updatedTabs.reduce(
            (last, tab, index) => (tab.isPinned && index !== tabIndex ? index : last),
            -1
          );
          const insertIndex = lastPinnedIndex + 1;
          newTabs = moveTab(updatedTabs, tabIndex, insertIndex);
        } else {
          const firstUnpinnedIndex = updatedTabs.findIndex(
            (tab, index) => !tab.isPinned && index !== tabIndex
          );
          const insertIndex = firstUnpinnedIndex === -1 ? updatedTabs.length - 1 : firstUnpinnedIndex;
          newTabs = moveTab(updatedTabs, tabIndex, insertIndex);
        }

        const newState: TabsState = {
          ...state,
          tabs: newTabs,
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Close all tabs
    closeAllTabs: () => {
      const newTab = createDefaultTab();
      const newState: TabsState = {
        tabs: [newTab],
        activeTabId: newTab.id,
      };
      set(newState);
      saveState(newState);
    },
    
    // Reset store
    reset: () => {
      const newTab = createDefaultTab();
      const newState: TabsState = {
        tabs: [newTab],
        activeTabId: newTab.id,
      };
      set(newState);
      saveState(newState);
    },
    
    // Diff mode operations
    
    // Enter diff mode: clone current tabs to both sides
    enterDiffMode: () => {
      update(state => {
        // Clone tabs for both sides (deep copy)
        const leftTabs = state.tabs.map(tab => ({ ...tab }));
        const rightTabs = state.tabs.map(tab => ({ ...tab }));
        
        const newDiffState: DiffModeState = {
          leftTabs,
          rightTabs,
          leftActiveTabId: state.activeTabId,
          rightActiveTabId: state.activeTabId,
        };
        
        diffModeStore.set(newDiffState);
        
        return state;
      });
    },
    
    // Exit diff mode: merge left and right tabs
    exitDiffMode: () => {
      if (!diffModeState) return;
      
      update(state => {
        // Merge strategy:
        // 1. Keep all left tabs
        // 2. Add right tabs that don't exist in left (by id or filePath)
        const leftTabIds = new Set(diffModeState!.leftTabs.map(t => t.id));
        const leftFilePaths = new Set(
          diffModeState!.leftTabs
            .filter(t => t.filePath)
            .map(t => t.filePath)
        );
        
        const mergedTabs = [...diffModeState!.leftTabs];
        
        for (const rightTab of diffModeState!.rightTabs) {
          // Skip if same id exists in left
          if (leftTabIds.has(rightTab.id)) continue;
          
          // Skip if same filePath exists in left (unless it's null/untitled)
          if (rightTab.filePath && leftFilePaths.has(rightTab.filePath)) continue;
          
          // Add unique right tab
          mergedTabs.push(rightTab);
        }
        
        // Ensure at least one tab
        if (mergedTabs.length === 0) {
          mergedTabs.push(createDefaultTab());
        }
        
        // Set active tab (prefer left active, fallback to first tab)
        let newActiveId = diffModeState!.leftActiveTabId;
        if (!mergedTabs.find(t => t.id === newActiveId)) {
          newActiveId = mergedTabs[0].id;
        }
        
        diffModeStore.set(null);
        
        const newState: TabsState = {
          tabs: mergedTabs,
          activeTabId: newActiveId,
        };
        
        saveState(newState);
        return newState;
      });
    },
    
    // Subscribe to diff mode state
    subscribeDiffMode: (callback: (state: DiffModeState | null) => void) => {
      return diffModeStore.subscribe(callback);
    },
    
    // Get diff mode state (for one-time access)
    getDiffModeState: () => diffModeState,
    
    // Add tab to left side in diff mode
    addDiffLeftTab: (content: string = '', filePath: string | null = null, fileName: string | null = null) => {
      if (!diffModeState) return;
      
      if (diffModeState.leftTabs.length >= MAX_TABS) {
        console.warn(`Maximum ${MAX_TABS} tabs allowed`);
        return;
      }
      
      const newTab = createNewTab(content, filePath, fileName);
      diffModeStore.update(state => {
        if (!state) return state;
        return {
          ...state,
          leftTabs: [...state.leftTabs, newTab],
          leftActiveTabId: newTab.id,
        };
      });
    },
    
    // Add tab to right side in diff mode
    addDiffRightTab: (content: string = '', filePath: string | null = null, fileName: string | null = null) => {
      if (!diffModeState) return;
      
      if (diffModeState.rightTabs.length >= MAX_TABS) {
        console.warn(`Maximum ${MAX_TABS} tabs allowed`);
        return;
      }
      
      const newTab = createNewTab(content, filePath, fileName);
      diffModeStore.update(state => {
        if (!state) return state;
        return {
          ...state,
          rightTabs: [...state.rightTabs, newTab],
          rightActiveTabId: newTab.id,
        };
      });
    },
    
    // Remove tab from left side in diff mode
    removeDiffLeftTab: (tabId: string) => {
      if (!diffModeState) return;
      
      diffModeStore.update(state => {
        if (!state) return state;
        
        const tabIndex = state.leftTabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return state;
        
        const newTabs = state.leftTabs.filter(t => t.id !== tabId);
        
        // Ensure at least one tab
        if (newTabs.length === 0) {
          newTabs.push(createNewTab());
        }
        
        // Update active tab if removed tab was active
        let newActiveId = state.leftActiveTabId;
        if (state.leftActiveTabId === tabId) {
          const newIndex = Math.max(0, tabIndex - 1);
          newActiveId = newTabs[newIndex].id;
        }
        
        return {
          ...state,
          leftTabs: newTabs,
          leftActiveTabId: newActiveId,
        };
      });
    },
    
    // Remove tab from right side in diff mode
    removeDiffRightTab: (tabId: string) => {
      if (!diffModeState) return;
      
      diffModeStore.update(state => {
        if (!state) return state;
        
        const tabIndex = state.rightTabs.findIndex(t => t.id === tabId);
        if (tabIndex === -1) return state;
        
        const newTabs = state.rightTabs.filter(t => t.id !== tabId);
        
        // Ensure at least one tab
        if (newTabs.length === 0) {
          newTabs.push(createNewTab());
        }
        
        // Update active tab if removed tab was active
        let newActiveId = state.rightActiveTabId;
        if (state.rightActiveTabId === tabId) {
          const newIndex = Math.max(0, tabIndex - 1);
          newActiveId = newTabs[newIndex].id;
        }
        
        return {
          ...state,
          rightTabs: newTabs,
          rightActiveTabId: newActiveId,
        };
      });
    },
    
    // Set active tab on left side in diff mode
    setDiffLeftActiveTab: (tabId: string) => {
      if (!diffModeState) return;
      diffModeStore.update(state => {
        if (!state) return state;
        if (!state.leftTabs.find(t => t.id === tabId)) return state;
        return {
          ...state,
          leftActiveTabId: tabId,
        };
      });
    },
    
    // Set active tab on right side in diff mode
    setDiffRightActiveTab: (tabId: string) => {
      if (!diffModeState) return;
      diffModeStore.update(state => {
        if (!state) return state;
        if (!state.rightTabs.find(t => t.id === tabId)) return state;
        return {
          ...state,
          rightActiveTabId: tabId,
        };
      });
    },
    
    // Update tab content on left side in diff mode
    updateDiffLeftTabContent: (tabId: string, content: string) => {
      if (!diffModeState) return;
      diffModeStore.update(state => {
        if (!state) return state;
        return {
          ...state,
          leftTabs: state.leftTabs.map(tab =>
            tab.id === tabId
              ? { ...tab, content, isModified: tab.filePath ? true : tab.isModified }
              : tab
          ),
        };
      });
    },
    
    // Update tab content on right side in diff mode
    updateDiffRightTabContent: (tabId: string, content: string) => {
      if (!diffModeState) return;
      diffModeStore.update(state => {
        if (!state) return state;
        return {
          ...state,
          rightTabs: state.rightTabs.map(tab =>
            tab.id === tabId
              ? { ...tab, content, isModified: tab.filePath ? true : tab.isModified }
              : tab
          ),
        };
      });
    },
    
    // Update tab stats on left side in diff mode
    updateDiffLeftTabStats: (tabId: string, stats: JsonStats) => {
      if (!diffModeState) return;
      diffModeStore.update(state => {
        if (!state) return state;
        return {
          ...state,
          leftTabs: state.leftTabs.map(tab =>
            tab.id === tabId ? { ...tab, stats } : tab
          ),
        };
      });
    },
    
    // Update tab stats on right side in diff mode
    updateDiffRightTabStats: (tabId: string, stats: JsonStats) => {
      if (!diffModeState) return;
      diffModeStore.update(state => {
        if (!state) return state;
        return {
          ...state,
          rightTabs: state.rightTabs.map(tab =>
            tab.id === tabId ? { ...tab, stats } : tab
          ),
        };
      });
    },
  };
}

export const tabsStore = createTabsStore();

// Derived store for active tab
export const activeTab = derived(
  tabsStore,
  $tabsStore => $tabsStore.tabs.find(t => t.id === $tabsStore.activeTabId) || $tabsStore.tabs[0]
);

// Derived store for tab count
export const tabCount = derived(
  tabsStore,
  $tabsStore => $tabsStore.tabs.length
);

import { writable, derived } from 'svelte/store';
import type { JsonStats } from '$lib/services/json';
import { fileWatcherService } from '$lib/services/fileWatcher';
import { FIRST_UNTITLED_NAME, getNextUntitledName } from './untitledTabs.js';
import { openFileInTabs } from './tabOpen.js';

export interface Tab {
  id: string;                    // Unique identifier
  filePath: string | null;       // File path
  fileName: string | null;       // File name
  content: string;               // Editor content
  isModified: boolean;           // Modified flag
  stats: JsonStats;              // JSON statistics
  isPinned: boolean;             // Pinned tab flag
}

export interface TabsState {
  tabs: Tab[];                   // All tabs
  activeTabId: string | null;    // Currently active tab ID
}

const STORAGE_KEY = 'jsonstudio_tabs_state';
// Create empty stats object
function createEmptyStats(): JsonStats {
  return {
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    format_type: '',
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
  fileName: string | null = FIRST_UNTITLED_NAME,
  isPinned: boolean = false
): Tab {
  return {
    id: generateId(),
    filePath,
    fileName,
    content,
    isModified: false,
    stats: createEmptyStats(),
    isPinned,
  };
}

// Create default state with proper activeTabId
function createDefaultState(): TabsState {
  const firstTab = createNewTab();
  return {
    tabs: [firstTab],
    activeTabId: firstTab.id,
  };
}

const defaultState: TabsState = createDefaultState();

// Load state from localStorage
function loadState(): TabsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: TabsState = JSON.parse(stored);
      const sanitizedTabs: Tab[] = parsed.tabs.reduce<Tab[]>((result, tab) => {
        const filePath = tab.filePath ?? null;
        const fileName = tab.fileName ?? (filePath ? null : getNextUntitledName(result));
        result.push({
          ...tab,
          filePath,
          fileName,
          isModified: false,
          isPinned: tab.isPinned ?? false,
        });
        return result;
      }, []);
      
      // Ensure at least one tab
      if (sanitizedTabs.length === 0) {
        sanitizedTabs.push(createNewTab());
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
    // localStorage typically has 5-10MB limit, we use 1MB per tab as safe limit
    const MAX_CONTENT_SIZE = 1024 * 1024; // 1MB
    
    const toSave: TabsState = {
      tabs: state.tabs.map(tab => ({
        ...tab,
        // Limit content size for storage
        content: tab.content.length > MAX_CONTENT_SIZE ? '' : tab.content,
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
        const newTab = createNewTab(
          content,
          filePath,
          fileName ?? (filePath ? null : getNextUntitledName(state.tabs))
        );
        const newState = {
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        };
        saveState(newState);
        return newState;
      });
    },
    
    // Open file: reuse empty tab if possible, otherwise create new tab
    openFile: (content: string, filePath: string, fileName: string | null) => {
      update(state => {
        const existingState = openFileInTabs(state, content, filePath, fileName);
        if (existingState !== state) {
          saveState(existingState);
          return existingState;
        }

        const currentTab = state.tabs.find(t => t.id === state.activeTabId);
        
        // If current tab is empty and unmodified, reuse it
        if (currentTab && !currentTab.content && !currentTab.filePath && !currentTab.isModified) {
          const newState = {
            ...state,
            tabs: state.tabs.map(tab =>
              tab.id === currentTab.id
                ? { ...tab, content, filePath, fileName, isModified: false }
                : tab
            ),
          };
          saveState(newState);
          return newState;
        }
        
        // Create new tab
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
        
        // Update active tab if removed tab was active
        let newActiveId = state.activeTabId;
        if (state.activeTabId === tabId) {
          if (newTabs.length > 0) {
            // Switch to previous tab or next tab
            const newIndex = Math.min(tabIndex, newTabs.length - 1);
            newActiveId = newTabs[newIndex].id;
          }
        }
        
        // Ensure at least one tab
        if (newTabs.length === 0) {
          const newTab = createNewTab();
          newTabs.push(newTab);
          newActiveId = newTab.id;
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
    updateTabContent: (tabId: string, content: string, markModified: boolean = true) => {
      update(state => {
        const newState = {
          ...state,
          tabs: state.tabs.map(tab => 
            tab.id === tabId 
              ? { ...tab, content, isModified: (tab.filePath && markModified) ? true : tab.isModified }
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
              ? { ...tab, filePath, fileName, isModified: false }
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
      const newTab = createNewTab();
      const newState: TabsState = {
        tabs: [newTab],
        activeTabId: newTab.id,
      };
      set(newState);
      saveState(newState);
    },
    
    // Reset store
    reset: () => {
      const newTab = createNewTab();
      const newState: TabsState = {
        tabs: [newTab],
        activeTabId: newTab.id,
      };
      set(newState);
      saveState(newState);
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

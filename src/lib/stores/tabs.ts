import { writable, derived } from 'svelte/store';
import type { JsonStats } from '$lib/services/json';

export interface Tab {
  id: string;                    // Unique identifier
  filePath: string | null;       // File path
  fileName: string | null;       // File name
  content: string;               // Editor content
  isModified: boolean;           // Modified flag
  stats: JsonStats;              // JSON statistics
}

export interface TabsState {
  tabs: Tab[];                   // All tabs
  activeTabId: string | null;    // Currently active tab ID
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
  fileName: string | null = null
): Tab {
  return {
    id: generateId(),
    filePath,
    fileName,
    content,
    isModified: false,
    stats: createEmptyStats(),
  };
}

const defaultState: TabsState = {
  tabs: [createNewTab()],
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
      }));
      
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
        const newTabs = [...state.tabs];
        const [removed] = newTabs.splice(fromIndex, 1);
        newTabs.splice(toIndex, 0, removed);
        
        const newState = {
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
    }
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

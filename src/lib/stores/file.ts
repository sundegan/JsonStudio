import { writable } from 'svelte/store';

export interface FileState {
  currentFilePath: string | null;
  currentFileName: string | null;
  isModified: boolean;
}

const STORAGE_KEY = 'jsonstudio_file_state';

const defaultState: FileState = {
  currentFilePath: null,
  currentFileName: null,
  isModified: false
};

function loadState(): FileState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Don't restore currentFilePath and isModified on app start
      return defaultState;
    }
  } catch (e) {
    console.error('Failed to load file state:', e);
  }
  return defaultState;
}

function saveState(state: FileState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save file state:', e);
  }
}

function createFileStateStore() {
  const { subscribe, set, update } = writable<FileState>(loadState());

  return {
    subscribe,
    
    setCurrentFile: (path: string | null, name: string | null) => {
      update(state => {
        const newState = { ...state, currentFilePath: path, currentFileName: name, isModified: false };
        saveState(newState);
        return newState;
      });
    },

    setModified: (modified: boolean) => {
      update(state => {
        const newState = { ...state, isModified: modified };
        saveState(newState);
        return newState;
      });
    },

    reset: () => {
      set(defaultState);
      saveState(defaultState);
    }
  };
}

export const fileStateStore = createFileStateStore();

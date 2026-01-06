import { writable } from 'svelte/store';

export interface ShortcutConfig {
  id: string;
  name: string;
  description: string;
  defaultKey: string;
  currentKey: string;
}

export interface ShortcutsSettings {
  showApp: ShortcutConfig;
  formatClipboard: ShortcutConfig;
}

const defaultShortcuts: ShortcutsSettings = {
  showApp: {
    id: 'show_app',
    name: 'Show App',
    description: 'Bring Json Studio to front',
    defaultKey: 'CommandOrControl+Shift+J',
    currentKey: 'CommandOrControl+Shift+J'
  },
  formatClipboard: {
    id: 'format_clipboard',
    name: 'Format Clipboard',
    description: 'Format JSON in clipboard and display',
    defaultKey: 'CommandOrControl+Shift+V',
    currentKey: 'CommandOrControl+Shift+V'
  }
};

const STORAGE_KEY = 'jsonstudio_shortcuts';

function createShortcutsStore() {
  const { subscribe, set, update } = writable<ShortcutsSettings>(defaultShortcuts);

  return {
    subscribe,
    init: () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          set(parsed);
        } catch (e) {
          console.error('Failed to parse shortcuts settings:', e);
          set(defaultShortcuts);
        }
      }
    },
    updateShortcut: async (id: string, key: string) => {
      // Update frontend state first
      update(state => {
        const newState = { ...state };
        for (const shortcutKey in newState) {
          const shortcut = newState[shortcutKey as keyof ShortcutsSettings];
          if (shortcut.id === id) {
            shortcut.currentKey = key;
          }
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
        return newState;
      });

      // Notify backend to re-register shortcut
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('update_shortcut', { id, key });
      } catch (error) {
        console.error('Failed to update shortcut:', error);
      }
    },
    resetShortcut: (id: string) => {
      update(state => {
        const newState = { ...state };
        for (const shortcutKey in newState) {
          const shortcut = newState[shortcutKey as keyof ShortcutsSettings];
          if (shortcut.id === id) {
            shortcut.currentKey = shortcut.defaultKey;
          }
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
        return newState;
      });
    },
    reset: () => {
      set(defaultShortcuts);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultShortcuts));
    }
  };
}

export const shortcutsStore = createShortcutsStore();

// Format shortcut key display (convert CommandOrControl to platform-specific symbols)
export function formatShortcutKey(key: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  
  let formatted = key
    .replace(/CommandOrControl/g, isMac ? '⌘' : 'Ctrl')
    .replace(/Command/g, '⌘')
    .replace(/Control/g, 'Ctrl')
    .replace(/Shift/g, isMac ? '⇧' : 'Shift')
    .replace(/Alt/g, isMac ? '⌥' : 'Alt')
    .replace(/Option/g, '⌥')
    .replace(/\+/g, isMac ? '' : '+');
  
  return formatted;
}

import { writable, get } from 'svelte/store';

export interface ShortcutConfig {
  id: string;
  name: string;
  description: string;
  defaultKey: string;
  currentKey: string;
  isGlobal?: boolean;
}

export interface ShortcutsSettings {
  // Global shortcuts (registered via Tauri backend)
  showApp: ShortcutConfig;
  formatClipboard: ShortcutConfig;
  // Editor shortcuts (handled via frontend keydown)
  newFile: ShortcutConfig;
  openFile: ShortcutConfig;
  saveFile: ShortcutConfig;
  format: ShortcutConfig;
  minify: ShortcutConfig;
  escape: ShortcutConfig;
  unescape: ShortcutConfig;
  minifyEscape: ShortcutConfig;
  foldAll: ShortcutConfig;
  unfoldAll: ShortcutConfig;
  togglePinTab: ShortcutConfig;
  closeOtherTabs: ShortcutConfig;
  closeAllTabs: ShortcutConfig;
  quitApp: ShortcutConfig;
}

const defaultShortcuts: ShortcutsSettings = {
  showApp: {
    id: 'show_app',
    name: 'Show App',
    description: 'Bring Json Studio to front',
    defaultKey: 'CommandOrControl+Shift+J',
    currentKey: 'CommandOrControl+Shift+J',
    isGlobal: true,
  },
  formatClipboard: {
    id: 'format_clipboard',
    name: 'Format Clipboard',
    description: 'Format JSON in clipboard and display',
    defaultKey: 'CommandOrControl+Shift+V',
    currentKey: 'CommandOrControl+Shift+V',
    isGlobal: true,
  },
  newFile: {
    id: 'new_file',
    name: 'New File',
    description: 'Create a new tab',
    defaultKey: 'CommandOrControl+N',
    currentKey: 'CommandOrControl+N',
  },
  openFile: {
    id: 'open_file',
    name: 'Open File',
    description: 'Open a file',
    defaultKey: 'CommandOrControl+O',
    currentKey: 'CommandOrControl+O',
  },
  saveFile: {
    id: 'save_file',
    name: 'Save File',
    description: 'Save current file',
    defaultKey: 'CommandOrControl+S',
    currentKey: 'CommandOrControl+S',
  },
  format: {
    id: 'format',
    name: 'Format',
    description: 'Format JSON',
    defaultKey: 'CommandOrControl+Shift+F',
    currentKey: 'CommandOrControl+Shift+F',
  },
  minify: {
    id: 'minify',
    name: 'Minify',
    description: 'Minify JSON',
    defaultKey: 'CommandOrControl+Shift+M',
    currentKey: 'CommandOrControl+Shift+M',
  },
  escape: {
    id: 'escape',
    name: 'Escape',
    description: 'Escape JSON string',
    defaultKey: 'CommandOrControl+Shift+E',
    currentKey: 'CommandOrControl+Shift+E',
  },
  unescape: {
    id: 'unescape',
    name: 'Unescape',
    description: 'Unescape JSON string',
    defaultKey: 'CommandOrControl+Shift+U',
    currentKey: 'CommandOrControl+Shift+U',
  },
  minifyEscape: {
    id: 'minify_escape',
    name: 'Minify + Escape',
    description: 'Minify and escape JSON',
    defaultKey: 'CommandOrControl+Shift+K',
    currentKey: 'CommandOrControl+Shift+K',
  },
  foldAll: {
    id: 'fold_all',
    name: 'Fold All',
    description: 'Fold all JSON nodes',
    defaultKey: 'CommandOrControl+Shift+[',
    currentKey: 'CommandOrControl+Shift+[',
  },
  unfoldAll: {
    id: 'unfold_all',
    name: 'Unfold All',
    description: 'Unfold all JSON nodes',
    defaultKey: 'CommandOrControl+Shift+]',
    currentKey: 'CommandOrControl+Shift+]',
  },
  togglePinTab: {
    id: 'toggle_pin_tab',
    name: 'Pin or Unpin Tab',
    description: 'Toggle the pinned state of the current tab',
    defaultKey: 'CommandOrControl+Shift+P',
    currentKey: 'CommandOrControl+Shift+P',
  },
  closeOtherTabs: {
    id: 'close_other_tabs',
    name: 'Close Other Tabs',
    description: 'Close all tabs except the current one',
    defaultKey: 'CommandOrControl+Alt+W',
    currentKey: 'CommandOrControl+Alt+W',
  },
  closeAllTabs: {
    id: 'close_all_tabs',
    name: 'Close All Tabs',
    description: 'Close all open tabs',
    defaultKey: 'CommandOrControl+Shift+W',
    currentKey: 'CommandOrControl+Shift+W',
  },
  quitApp: {
    id: 'quit_app',
    name: 'Quit',
    description: 'Quit the application',
    defaultKey: 'CommandOrControl+Q',
    currentKey: 'CommandOrControl+Q',
  },
};

const STORAGE_KEY = 'jsonstudio_shortcuts';
const CLOSE_OTHER_TABS_SHORTCUT_MIGRATION_KEY = 'jsonstudio_close_other_tabs_shortcut_v2';
let globalShortcutUpdateQueue: Promise<void> = Promise.resolve();

function getDefaultShortcuts(): ShortcutsSettings {
  return JSON.parse(JSON.stringify(defaultShortcuts));
}

function invokeGlobalShortcutUpdate(id: string, key: string): Promise<void> {
  const operation = globalShortcutUpdateQueue.then(async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('update_shortcut', { id, key });
  });
  globalShortcutUpdateQueue = operation.catch(() => {});
  return operation;
}

function createShortcutsStore() {
  const { subscribe, set, update } = writable<ShortcutsSettings>(getDefaultShortcuts());

  function updateStoredShortcut(id: string, key: string): void {
    update(state => {
      const newState = { ...state };
      for (const shortcutKey in newState) {
        const k = shortcutKey as keyof ShortcutsSettings;
        if (newState[k].id === id) {
          newState[k] = { ...newState[k], currentKey: key };
          break;
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
      return newState;
    });
  }

  return {
    subscribe,
    init: () => {
      const stored = localStorage.getItem(STORAGE_KEY);
      let current = getDefaultShortcuts();
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          for (const key in current) {
            const k = key as keyof ShortcutsSettings;
            if (parsed[k] && parsed[k].currentKey) {
              current[k].currentKey = parsed[k].currentKey;
            }
          }
          if (
            !localStorage.getItem(CLOSE_OTHER_TABS_SHORTCUT_MIGRATION_KEY)
            && current.closeOtherTabs.currentKey === 'CommandOrControl+Shift+W'
          ) {
            current.closeOtherTabs.currentKey = current.closeOtherTabs.defaultKey;
          }
          localStorage.setItem(CLOSE_OTHER_TABS_SHORTCUT_MIGRATION_KEY, '1');
          set(current);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        } catch (e) {
          console.error('Failed to parse shortcuts settings:', e);
          current = getDefaultShortcuts();
          set(current);
        }
      }

      void syncGlobalShortcuts(current);
    },
    updateShortcut: async (id: string, key: string) => {
      const shortcut = Object.values(get({ subscribe })).find(item => item.id === id);
      if (!shortcut) return;

      if (shortcut.isGlobal) {
        try {
          await invokeGlobalShortcutUpdate(id, key);
        } catch (error) {
          console.error('Failed to update shortcut:', error);
          return;
        }
      }

      updateStoredShortcut(id, key);
    },
    resetShortcut: async (id: string) => {
      const shortcut = Object.values(get({ subscribe })).find(item => item.id === id);
      if (!shortcut) return;

      if (shortcut.isGlobal) {
        try {
          await invokeGlobalShortcutUpdate(id, shortcut.defaultKey);
        } catch (error) {
          console.error('Failed to reset global shortcut:', error);
          return;
        }
      }

      updateStoredShortcut(id, shortcut.defaultKey);
    },
    reset: async () => {
      const nextState = getDefaultShortcuts();

      for (const key in nextState) {
        const k = key as keyof ShortcutsSettings;
        const shortcut = nextState[k];
        if (shortcut.isGlobal) {
          try {
            await invokeGlobalShortcutUpdate(shortcut.id, shortcut.defaultKey);
          } catch (error) {
            nextState[k].currentKey = get({ subscribe })[k].currentKey;
            console.error(`Failed to reset global shortcut ${shortcut.id}:`, error);
          }
        }
      }

      set(nextState);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    },
    matchShortcut(e: KeyboardEvent): string | null {
      const state = get({ subscribe });
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      for (const shortcutKey in state) {
        const shortcut = state[shortcutKey as keyof ShortcutsSettings];
        if (shortcut.isGlobal) continue;
        if (matchKey(shortcut.currentKey, e, cmdOrCtrl)) {
          return shortcut.id;
        }
      }
      return null;
    },
  };
}

async function syncGlobalShortcuts(shortcuts: ShortcutsSettings): Promise<void> {
  for (const key in shortcuts) {
    const shortcut = shortcuts[key as keyof ShortcutsSettings];
    if (shortcut.isGlobal) {
      try {
        await invokeGlobalShortcutUpdate(shortcut.id, shortcut.currentKey);
      } catch (error) {
        console.error(`Failed to initialize global shortcut ${shortcut.id}:`, error);
      }
    }
  }
}

function matchKey(shortcutKey: string, e: KeyboardEvent, cmdOrCtrl: boolean): boolean {
  const parts = shortcutKey.split('+');
  let needCmd = false;
  let needShift = false;
  let needAlt = false;
  let mainKey = '';

  for (const part of parts) {
    const p = part.trim();
    if (p === 'CommandOrControl' || p === 'Command' || p === 'Control') {
      needCmd = true;
    } else if (p === 'Shift') {
      needShift = true;
    } else if (p === 'Alt' || p === 'Option') {
      needAlt = true;
    } else {
      mainKey = p;
    }
  }

  if (needCmd !== cmdOrCtrl) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;

  const eventKey = e.key.toUpperCase();
  const target = mainKey.toUpperCase();

  if (eventKey === target) return true;
  if (e.code === `Key${target}`) return true;
  if (target === '[' && (e.key === '[' || e.code === 'BracketLeft')) return true;
  if (target === ']' && (e.key === ']' || e.code === 'BracketRight')) return true;

  return false;
}

export const shortcutsStore = createShortcutsStore();

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

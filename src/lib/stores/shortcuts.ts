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

interface GlobalShortcutsState {
  enabled: boolean;
  pending: boolean;
  error: string | null;
}

interface GlobalShortcutUpdate {
  bindings: Array<{ id: string; key: string }>;
  error: string | null;
}

const globalShortcutStatus = writable<GlobalShortcutsState>({
  enabled: true,
  pending: false,
  error: null,
});

export const globalShortcutsState = { subscribe: globalShortcutStatus.subscribe };

let shortcutUpdateQueue: Promise<void> = Promise.resolve();
let pendingUpdates = 0;

function getDefaultShortcuts(): ShortcutsSettings {
  return JSON.parse(JSON.stringify(defaultShortcuts));
}

function enqueueShortcutUpdate(update: () => Promise<void>): Promise<void> {
  pendingUpdates += 1;
  globalShortcutStatus.update(state => ({ ...state, pending: true }));
  const operation = shortcutUpdateQueue.then(async () => {
    globalShortcutStatus.update(state => ({ ...state, error: null }));
    try {
      await update();
    } catch (error) {
      globalShortcutStatus.update(state => ({
        ...state,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      pendingUpdates -= 1;
      globalShortcutStatus.update(state => ({ ...state, pending: pendingUpdates > 0 }));
    }
  });
  shortcutUpdateQueue = operation.catch(() => {});
  return operation;
}

function createShortcutsStore() {
  const { subscribe, set } = writable<ShortcutsSettings>(getDefaultShortcuts());
  let initialization: Promise<void> | null = null;

  function persist(shortcuts: ShortcutsSettings, enabled: boolean): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...shortcuts,
      globalShortcutsEnabled: enabled,
    }));
  }

  async function syncGlobalShortcuts(shortcuts: ShortcutsSettings, enabled: boolean): Promise<void> {
    const { invoke, isTauri } = await import('@tauri-apps/api/core');
    if (!isTauri()) return;

    const bindings = enabled
      ? Object.values(shortcuts)
        .filter(shortcut => shortcut.isGlobal)
        .map(shortcut => ({ id: shortcut.id, key: shortcut.currentKey }))
      : [];
    const result = await invoke<GlobalShortcutUpdate>('update_global_shortcuts', { bindings });
    if (result?.error) {
      // Even a failed rollback must report any bindings that remain active.
      const actualEnabled = result.bindings.length > 0;
      globalShortcutStatus.update(state => ({ ...state, enabled: actualEnabled }));
      persist(get({ subscribe }), actualEnabled);
      throw new Error(result.error);
    }
  }

  async function commit(
    next: ShortcutsSettings,
    enabled: boolean,
    synchronize: boolean,
  ): Promise<void> {
    const previous = get({ subscribe });
    const previousEnabled = get(globalShortcutStatus).enabled;
    if (synchronize) await syncGlobalShortcuts(next, enabled);

    try {
      persist(next, enabled);
    } catch (error) {
      if (synchronize) {
        try {
          await syncGlobalShortcuts(previous, previousEnabled);
        } catch (rollbackError) {
          throw new Error(`${String(error)}; failed to restore previous shortcuts: ${String(rollbackError)}`);
        }
      }
      throw error;
    }

    set(next);
    globalShortcutStatus.update(state => ({ ...state, enabled }));
  }

  function changeShortcut(id: string, key: string | null): Promise<void> {
    return enqueueShortcutUpdate(async () => {
      const current = get({ subscribe });
      const entry = Object.entries(current).find(([, shortcut]) => shortcut.id === id);
      if (!entry) return;

      const [shortcutKey, shortcut] = entry;
      const next = {
        ...current,
        [shortcutKey]: { ...shortcut, currentKey: key ?? shortcut.defaultKey },
      };
      await commit(next, get(globalShortcutStatus).enabled, !!shortcut.isGlobal);
    });
  }

  return {
    subscribe,
    init: () => {
      if (initialization) return initialization;
      let current = getDefaultShortcuts();
      let enabled = true;
      let loadError: string | null = null;
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (typeof parsed.globalShortcutsEnabled === 'boolean') {
            enabled = parsed.globalShortcutsEnabled;
          }
          for (const key in current) {
            const k = key as keyof ShortcutsSettings;
            if (typeof parsed[k]?.currentKey === 'string' && parsed[k].currentKey) {
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
        }
      } catch (error) {
        // Do not register defaults when the saved opt-out could not be read.
        enabled = false;
        loadError = error instanceof Error ? error.message : String(error);
      }
      set(current);
      globalShortcutStatus.update(state => ({ ...state, enabled }));

      initialization = enqueueShortcutUpdate(async () => {
        await syncGlobalShortcuts(current, enabled);
        if (loadError) {
          throw new Error(loadError);
        }
        persist(current, enabled);
      });
      return initialization;
    },
    setGlobalShortcutsEnabled: (enabled: boolean) => enqueueShortcutUpdate(async () => {
      await commit(get({ subscribe }), enabled, true);
    }),
    updateShortcut: (id: string, key: string) => changeShortcut(id, key),
    resetShortcut: (id: string) => changeShortcut(id, null),
    reset: () => enqueueShortcutUpdate(async () => {
      await commit(getDefaultShortcuts(), get(globalShortcutStatus).enabled, true);
    }),
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

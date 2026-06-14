import { expect } from '@playwright/test';

const TAB_STATE_KEY = 'jsonstudio_tabs_state';
const SETTINGS_KEY = 'app-settings';

function emptyStats() {
  return {
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    format_type: '',
    error_info: null,
  };
}

export async function installTauriEditorHarness(page, content = '', options = {}) {
  await page.addInitScript(({ tabStateKey, settingsKey, initialContent, stats, showTreeView }) => {
    localStorage.setItem(tabStateKey, JSON.stringify({
      tabs: [{
        id: 'editor-test-tab',
        filePath: null,
        fileName: 'Editor Test',
        content: initialContent,
        isModified: false,
        stats,
        isPinned: false,
        contentVersion: initialContent ? 1 : 0,
      }],
      activeTabId: 'editor-test-tab',
    }));
    localStorage.setItem(settingsKey, JSON.stringify({
      language: 'en',
      showTreeView,
      showFolderView: false,
      autoSave: false,
      isDarkMode: false,
    }));

    let callbackId = 0;
    const callbacks = new Map();
    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main' },
      },
      plugins: {
        path: { sep: '/', delimiter: ':' },
      },
      transformCallback(callback) {
        const id = ++callbackId;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      runCallback(id, payload) {
        callbacks.get(id)?.(payload);
      },
      convertFileSrc(path) {
        return path;
      },
      async invoke(command) {
        if (command === 'get_pending_files') return [];
        if (command === 'plugin:event|listen') return ++callbackId;
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener() {},
    };
  }, {
    tabStateKey: TAB_STATE_KEY,
    settingsKey: SETTINGS_KEY,
    initialContent: content,
    stats: emptyStats(),
    showTreeView: options.showTreeView ?? false,
  });
}

export async function openEmptyEditor(page) {
  await installTauriEditorHarness(page);
  await page.goto('/');

  const editorSurface = page.locator('[data-testid="json-editor"] .view-lines');
  await expect(editorSurface).toBeVisible();
  await editorSurface.click();
  return editorSurface;
}

export async function pasteIntoEditor(page, value) {
  await page.evaluate((content) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', content);
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    }));
  }, value);
}

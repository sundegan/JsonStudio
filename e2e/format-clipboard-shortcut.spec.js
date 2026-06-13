import { expect, test } from '@playwright/test';

const TAB_STATE_KEY = 'jsonstudio_tabs_state';
const SETTINGS_KEY = 'app-settings';
const FORMATTED_CLIPBOARD = `{
  "name": "JsonStudio",
  "enabled": true
}`;
const ESCAPED_JSON_ARRAY_CLIPBOARD =
  '"[{\\"id\\":101,\\"name\\":\\"Alice\\",\\"role\\":\\"Developer\\",\\"active\\":true},{\\"id\\":102,\\"name\\":\\"James\\",\\"role\\":\\"Designer\\",\\"active\\":false}]"';

async function installTauriShortcutHarness(page, clipboardContent = FORMATTED_CLIPBOARD) {
  await page.addInitScript(({ tabStateKey, settingsKey, clipboardPayload }) => {
    localStorage.setItem(tabStateKey, JSON.stringify({
      tabs: [{
        id: 'initial-tab',
        filePath: null,
        fileName: 'Untitled-1',
        isModified: false,
        stats: {
          valid: false,
          key_count: 0,
          depth: 0,
          byte_size: 0,
          format_type: '',
          error_info: null,
        },
        isPinned: false,
        contentVersion: 0,
      }],
      activeTabId: 'initial-tab',
    }));
    localStorage.setItem(settingsKey, JSON.stringify({
      language: 'en',
      showTreeView: false,
      showFolderView: false,
      autoSave: false,
      isDarkMode: false,
    }));

    let callbackId = 0;
    const callbacks = new Map();
    const eventListeners = new Map();

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
      async invoke(command, args = {}) {
        if (command === 'get_pending_files') return [];
        if (command === 'plugin:event|listen') {
          const listeners = eventListeners.get(args.event) || [];
          listeners.push(args.handler);
          eventListeners.set(args.event, listeners);
          return args.handler;
        }
        if (command === 'plugin:event|unlisten') {
          const listeners = eventListeners.get(args.event) || [];
          eventListeners.set(
            args.event,
            listeners.filter(handler => handler !== args.eventId),
          );
          return null;
        }
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener() {},
    };

    const emit = (event, payload) => {
      for (const handler of eventListeners.get(event) || []) {
        callbacks.get(handler)?.({ event, payload });
      }
    };

    window.__jsonStudioShortcutHarness = {
      listenerCount(event) {
        return eventListeners.get(event)?.length || 0;
      },
    };

    window.addEventListener('keydown', (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'v'
      ) {
        emit('clipboard-content', clipboardPayload);
      }
    });
  }, {
    tabStateKey: TAB_STATE_KEY,
    settingsKey: SETTINGS_KEY,
    clipboardPayload: clipboardContent,
  });
}

test('Ctrl+Shift+V formats clipboard content into exactly one new tab', async ({ page }) => {
  await installTauriShortcutHarness(page);
  await page.goto('/');

  await expect.poll(() => page.evaluate(
    () => window.__jsonStudioShortcutHarness.listenerCount('clipboard-content'),
  )).toBe(1);
  await expect(page.locator('.tab-button')).toHaveCount(1);

  const commandKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(commandKey);
  await page.keyboard.down('Shift');
  await page.keyboard.press('v');
  await page.keyboard.up('Shift');
  await page.keyboard.up(commandKey);

  await expect(page.locator('.tab-button')).toHaveCount(2);
  await expect(page.getByTestId('editor-line-count')).toContainText('5 lines');
  await expect(page.locator('[data-testid="json-editor"] .view-lines')).toContainText(
    '"name": "JsonStudio"',
  );

  await page.waitForTimeout(200);
  await expect(page.locator('.tab-button')).toHaveCount(2);
});

test('Ctrl+Shift+V unescapes and formats escaped JSON arrays from clipboard', async ({ page }) => {
  await installTauriShortcutHarness(page, ESCAPED_JSON_ARRAY_CLIPBOARD);
  await page.goto('/');

  await expect.poll(() => page.evaluate(
    () => window.__jsonStudioShortcutHarness.listenerCount('clipboard-content'),
  )).toBe(1);

  const commandKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(commandKey);
  await page.keyboard.down('Shift');
  await page.keyboard.press('v');
  await page.keyboard.up('Shift');
  await page.keyboard.up(commandKey);

  await expect(page.locator('.tab-button')).toHaveCount(2);
  await expect(page.getByTestId('editor-line-count')).toContainText('15 lines');
  await expect(page.locator('[data-testid="json-editor"] .view-lines')).toContainText('"id": 101');
  await expect(page.locator('[data-testid="json-editor"] .view-lines')).toContainText('"name": "Alice"');
  await expect(page.locator('[data-testid="json-editor"] .view-lines')).toContainText('"active": false');
});

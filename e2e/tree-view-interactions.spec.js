import { expect, test } from '@playwright/test';

const TAB_STATE_KEY = 'jsonstudio_tabs_state';
const SETTINGS_KEY = 'app-settings';
const DOCUMENT = `{
  "first": "one",
  "second": "two",
  "profile": {
    "name": "Alice",
    "age": 20
  }
}`;

async function installTauriHarness(page) {
  await page.addInitScript(({ tabStateKey, settingsKey, content }) => {
    localStorage.setItem(tabStateKey, JSON.stringify({
      tabs: [{
        id: 'tree-test-tab',
        filePath: null,
        fileName: 'Tree Test',
        content,
        isModified: false,
        stats: {
          valid: true,
          key_count: 6,
          depth: 2,
          byte_size: content.length,
          format_type: 'JSON',
          error_info: null,
        },
        isPinned: false,
        contentVersion: 1,
      }],
      activeTabId: 'tree-test-tab',
    }));
    localStorage.setItem(settingsKey, JSON.stringify({
      language: 'en',
      showTreeView: true,
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
    content: DOCUMENT,
  });
}

async function openTreeDocument(page) {
  await installTauriHarness(page);
  await page.goto('/');
  await expect(page.getByTestId('tree-ready')).toBeAttached();
  await expect(page.getByTestId('editor-line-count')).toContainText('8 lines');
}

function treeRow(page, path) {
  return page.locator(`[data-tree-path="${path}"]`);
}

test.beforeEach(async ({ page }) => {
  await openTreeDocument(page);
});

test('single click selects the Tree node and jumps to its editor range', async ({ page }) => {
  const nameRow = treeRow(page, '/profile/name');
  await nameRow.click();

  await expect(nameRow.locator('..')).toHaveClass(/tree-node-selected/);
  await expect(page.locator('.monaco-editor')).toHaveClass(/focused/);
  const editorSelection = page.locator('.monaco-editor .selected-text');
  await expect(editorSelection).toHaveCount(1);
  const selectionBox = await editorSelection.boundingBox();
  expect(selectionBox?.width).toBeGreaterThan(0);
  expect(selectionBox?.height).toBeGreaterThan(0);
});

test('double click edits a primitive value and writes it back to the editor', async ({ page }) => {
  const nameRow = treeRow(page, '/profile/name');
  await nameRow.locator('[data-tree-edit-kind="value"]').dblclick();

  const input = nameRow.locator('.tree-edit-input');
  await expect(input).toBeFocused();
  await input.fill('Bob');
  await input.press('Enter');

  await expect(nameRow.locator('.tree-value')).toHaveText('Bob');
  await expect(page.locator('[data-testid="json-editor"] .view-lines')).toContainText(
    '"name": "Bob"',
  );
});

test('dragging a Tree node reorders the JSON document', async ({ page }) => {
  const firstRow = treeRow(page, '/first');
  const secondRow = treeRow(page, '/second');
  const firstBox = await firstRow.boundingBox();
  const secondBox = await secondRow.boundingBox();

  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();

  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height * 0.85,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(page.locator('[data-testid="json-editor"] .view-lines')).toContainText(
    '"second": "two"',
  );
  await expect.poll(async () => {
    const lines = await page
      .locator('[data-testid="json-editor"] .view-line')
      .allTextContents();
    const secondLine = lines.findIndex((line) => line.includes('"second"'));
    const firstLine = lines.findIndex((line) => line.includes('"first"'));
    return secondLine >= 0 && firstLine >= 0 && secondLine < firstLine;
  }).toBe(true);
  await expect(treeRow(page, '/first').locator('..')).toHaveClass(/tree-node-selected/);
});

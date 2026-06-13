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
        id: 'grid-test-tab',
        filePath: null,
        fileName: 'Grid Test',
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
      activeTabId: 'grid-test-tab',
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

async function openGridDocument(page) {
  await installTauriHarness(page);
  await page.goto('/');
  await expect(page.getByTestId('tree-ready')).toBeAttached();
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await expect(page.getByRole('grid')).toBeVisible();
}

function gridRow(page, key) {
  return page.locator('.gv-tr').filter({
    has: page.locator('.gv-td').first().getByText(key, { exact: true }),
  });
}

test.beforeEach(async ({ page }) => {
  await openGridDocument(page);
});

test('displays primitive and nested JSON values in Grid View', async ({ page }) => {
  const grid = page.getByRole('grid');
  await expect(gridRow(page, 'first')).toContainText('one');
  await expect(gridRow(page, 'second')).toContainText('two');

  await grid.getByRole('button', { name: /profile/ }).click();

  await expect(grid.getByText('name', { exact: true })).toBeVisible();
  await expect(grid.getByText('Alice', { exact: true })).toBeVisible();
  await expect(grid.getByText('age', { exact: true })).toBeVisible();
  await expect(grid.getByText('20', { exact: true })).toBeVisible();
});

test('single click selects a Grid value and jumps to its editor range', async ({ page }) => {
  const valueCell = gridRow(page, 'second').locator('.gv-td').nth(1);
  await valueCell.locator('.gv-cell').click();

  await expect(valueCell).toHaveClass(/gv-td--selected/);
  const editorHighlight = page.locator('.monaco-editor .json-external-selection');
  await expect(editorHighlight).toHaveCount(1);
  const highlightBox = await editorHighlight.boundingBox();
  expect(highlightBox?.width).toBeGreaterThan(0);
  expect(highlightBox?.height).toBeGreaterThan(0);
});

test('edits a Grid value and writes it back to the editor', async ({ page }) => {
  const valueCell = gridRow(page, 'second').locator('.gv-td').nth(1);
  await valueCell.getByRole('button', { name: 'Edit value' }).click();

  const input = valueCell.locator('.gv-edit-input');
  await expect(input).toBeFocused();
  await input.fill('updated');
  await input.press('Enter');

  await expect(gridRow(page, 'second').locator('.gv-td').nth(1)).toContainText('updated');
  await expect(page.locator('[data-testid="json-editor"] .view-lines')).toContainText(
    '"second": "updated"',
  );
});

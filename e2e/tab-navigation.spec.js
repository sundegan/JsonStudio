import { expect, test } from '@playwright/test';

const TAB_STATE_KEY = 'jsonstudio_tabs_state';
const SETTINGS_KEY = 'app-settings';

function createTab(id, fileName, content = '') {
  return {
    id,
    filePath: null,
    fileName,
    content,
    isModified: false,
    stats: {
      valid: false,
      key_count: 0,
      depth: 0,
      byte_size: content.length,
      format_type: '',
      error_info: null,
    },
    isPinned: false,
    contentVersion: content ? 1 : 0,
  };
}

async function installTabHarness(page, tabs, activeTabId = tabs[0].id) {
  await page.addInitScript(({ tabStateKey, settingsKey, initialTabs, initialActiveTabId }) => {
    localStorage.setItem(tabStateKey, JSON.stringify({
      tabs: initialTabs,
      activeTabId: initialActiveTabId,
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
    initialTabs: tabs,
    initialActiveTabId: activeTabId,
  });
}

async function openEditor(page) {
  await page.goto('/');
  await expect(page.getByTestId('json-editor').locator('.view-lines')).toBeVisible();
}

async function expectEditorDocument(page, expectedMarker, unexpectedMarkers = []) {
  const editor = page.getByTestId('json-editor').locator('.view-lines');
  await expect(editor).toContainText(expectedMarker);
  for (const marker of unexpectedMarkers) {
    await expect(editor).not.toContainText(marker);
  }
}

test('creates a new tab and activates it', async ({ page }) => {
  await installTabHarness(page, [
    createTab('first-tab', 'Untitled-1'),
  ]);
  await openEditor(page);

  await page.getByRole('button', { name: 'New', exact: true }).click();

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(page.getByRole('tab', { name: 'Untitled-2' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Untitled-1' })).toHaveAttribute('aria-selected', 'false');
});

test('switches between tabs and restores each document', async ({ page }) => {
  await installTabHarness(page, [
    createTab('first-tab', 'First.json', '{\n  "document": "first-content",\n  "value": 101\n}'),
    createTab('second-tab', 'Second.json', '{\n  "document": "second-content",\n  "value": 202\n}'),
  ], 'first-tab');
  await openEditor(page);

  await expectEditorDocument(page, '"first-content"', ['"second-content"']);

  await page.getByRole('tab', { name: 'Second.json' }).click();

  await expect(page.getByRole('tab', { name: 'Second.json' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'First.json' })).toHaveAttribute('aria-selected', 'false');
  await expectEditorDocument(page, '"second-content"', ['"first-content"']);

  await page.getByRole('tab', { name: 'First.json' }).click();

  await expect(page.getByRole('tab', { name: 'First.json' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Second.json' })).toHaveAttribute('aria-selected', 'false');
  await expectEditorDocument(page, '"first-content"', ['"second-content"']);
});

test('reorders tabs with pointer drag and persists the new order', async ({ page }) => {
  await installTabHarness(page, [
    createTab('first-tab', 'First.json', '{\n  "document": "first-after-drag",\n  "value": 101\n}'),
    createTab('second-tab', 'Second.json', '{\n  "document": "second-after-drag",\n  "value": 202\n}'),
    createTab('third-tab', 'Third.json', '{\n  "document": "third-after-drag",\n  "value": 303\n}'),
  ]);
  await openEditor(page);
  await expectEditorDocument(page, '"first-after-drag"', [
    '"second-after-drag"',
    '"third-after-drag"',
  ]);

  const firstTab = page.getByTestId('tab-first-tab');
  const thirdTab = page.getByTestId('tab-third-tab');
  const firstBox = await firstTab.boundingBox();
  const thirdBox = await thirdTab.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(thirdBox).not.toBeNull();

  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    thirdBox.x + thirdBox.width - 2,
    thirdBox.y + thirdBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect(page.getByRole('tab')).toHaveText([
    'Second.json',
    'Third.json',
    'First.json',
  ]);
  await expect.poll(() => page.evaluate((storageKey) => {
    const state = JSON.parse(localStorage.getItem(storageKey));
    return state.tabs.map(tab => tab.id);
  }, TAB_STATE_KEY)).toEqual([
    'second-tab',
    'third-tab',
    'first-tab',
  ]);

  await expect(page.getByTestId('tab-first-tab')).toHaveAttribute('aria-selected', 'true');
  await expectEditorDocument(page, '"first-after-drag"', [
    '"second-after-drag"',
    '"third-after-drag"',
  ]);

  await page.getByTestId('tab-second-tab').click();
  await expect(page.getByTestId('tab-second-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tab-first-tab')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('tab-third-tab')).toHaveAttribute('aria-selected', 'false');
  await expectEditorDocument(page, '"second-after-drag"', [
    '"first-after-drag"',
    '"third-after-drag"',
  ]);

  await page.getByTestId('tab-third-tab').click();
  await expect(page.getByTestId('tab-third-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tab-first-tab')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('tab-second-tab')).toHaveAttribute('aria-selected', 'false');
  await expectEditorDocument(page, '"third-after-drag"', [
    '"first-after-drag"',
    '"second-after-drag"',
  ]);

  await page.getByTestId('tab-first-tab').click();
  await expect(page.getByTestId('tab-first-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tab-second-tab')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('tab-third-tab')).toHaveAttribute('aria-selected', 'false');
  await expectEditorDocument(page, '"first-after-drag"', [
    '"second-after-drag"',
    '"third-after-drag"',
  ]);
});

test('scrolls the tab bar horizontally with a vertical mouse wheel', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  const tabs = Array.from(
    { length: 10 },
    (_, index) => createTab(`tab-${index + 1}`, `Document-${index + 1}.json`),
  );
  await installTabHarness(page, tabs);
  await openEditor(page);

  const tabBar = page.locator('.tabs-container');
  await expect.poll(() => tabBar.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect.poll(() => tabBar.evaluate(element => element.scrollLeft)).toBe(0);

  await tabBar.hover();
  await page.mouse.wheel(0, 320);

  await expect.poll(() => tabBar.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});

import { expect, test } from '@playwright/test';
import {
  installTauriEditorHarness,
  openEmptyEditor,
  pasteIntoEditor,
} from './helpers/editorHarness.js';

const ESCAPED_JSON = String.raw`"{\"people\":[{\"name\":\"Alice\",\"age\":20},{\"name\":\"Bob\",\"age\":30}],\"meta\":{\"count\":2}}"`;
const MIXED_LOG = 'INFO trace=abc payload={"id":1,"path":"/api"} cost=12ms';

test('shows the JSON fragments panel for mixed log content', async ({ page }) => {
  await installTauriEditorHarness(page, MIXED_LOG, { showTreeView: true });
  await page.addInitScript(() => {
    window.__treeViewWasMounted = false;
    window.addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('.json-tree-container')) {
          window.__treeViewWasMounted = true;
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  });
  await page.goto('/');

  const panel = page.getByRole('region', { name: 'JSON Fragments' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('1 fragments detected');
  await expect(panel).toContainText('payload');
  await expect(panel.locator('.view-lines')).toContainText('"path": "/api"');
  await expect(page.getByTestId('editor-format-type')).toHaveText('Mixed');
  expect(await page.evaluate(() => window.__treeViewWasMounted)).toBe(false);

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('editor-format-type')).toHaveText('Mixed');
});

test('restores mixed log layout without flashing Tree View after a tab switch', async ({ page }) => {
  await installTauriEditorHarness(page, MIXED_LOG, { showTreeView: true });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'JSON Fragments' })).toBeVisible();

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('.json-tree-container')).toBeVisible();

  const treeViewWasVisibleAfterSwitch = await page.evaluate(async () => {
    const mixedTab = document.querySelector('[data-testid="tab-editor-test-tab"]');
    if (!(mixedTab instanceof HTMLElement)) throw new Error('Mixed log tab was not found');
    mixedTab.click();

    return await new Promise((resolve) => {
      let wasVisible = false;
      let frames = 0;
      const inspect = () => {
        wasVisible ||= Boolean(document.querySelector('.json-tree-container'));
        frames += 1;
        if (frames >= 3 || document.querySelector('[aria-label="JSON Fragments"]')) {
          resolve(wasVisible);
          return;
        }
        requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    });
  });

  expect(treeViewWasVisibleAfterSwitch).toBe(false);
  await expect(page.getByRole('region', { name: 'JSON Fragments' })).toBeVisible();
  await expect(page.getByTestId('editor-format-type')).toHaveText('Mixed');
});

test('keeps Tree View mounted while editing standard JSON', async ({ page }) => {
  await installTauriEditorHarness(page, '{"id":1}', { showTreeView: true });
  await page.goto('/');
  const treeView = page.locator('.json-tree-container');
  await expect(treeView).toBeVisible();

  await page.evaluate(() => {
    window.__treeViewWasRemoved = false;
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.json-tree-container')) {
        window.__treeViewWasRemoved = true;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  const editorSurface = page.getByTestId('json-editor').locator('.view-lines');
  await editorSurface.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await page.waitForTimeout(600);

  await expect(treeView).toBeVisible();
  expect(await page.evaluate(() => window.__treeViewWasRemoved)).toBe(false);
});

test('formats standalone escaped JSON without entering mixed log mode', async ({ page }) => {
  const editorSurface = await openEmptyEditor(page);

  await pasteIntoEditor(page, ESCAPED_JSON);

  await expect(page.getByTestId('editor-line-count')).toContainText('16 lines');
  await expect(editorSurface).toContainText('"people":');
  await expect(editorSurface).toContainText('"name": "Alice"');
  await expect(editorSurface).toContainText('"count": 2');
  await expect(page.getByRole('region', { name: 'JSON Fragments' })).toHaveCount(0);
});

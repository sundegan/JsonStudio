import { expect, test } from '@playwright/test';
import {
  installTauriEditorHarness,
  openEmptyEditor,
  pasteIntoEditor,
} from './helpers/editorHarness.js';

const ESCAPED_JSON = String.raw`"{\"people\":[{\"name\":\"Alice\",\"age\":20},{\"name\":\"Bob\",\"age\":30}],\"meta\":{\"count\":2}}"`;
const MIXED_LOG = 'INFO trace=abc payload={"id":1,"path":"/api"} cost=12ms';

test('shows the JSON fragments panel for mixed log content', async ({ page }) => {
  await installTauriEditorHarness(page, MIXED_LOG);
  await page.goto('/');

  const panel = page.getByRole('region', { name: 'JSON Fragments' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('1 fragments detected');
  await expect(panel).toContainText('payload');
  await expect(panel.locator('.view-lines')).toContainText('"path": "/api"');
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

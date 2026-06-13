import { expect, test } from '@playwright/test';
import {
  openEmptyEditor,
  pasteIntoEditor,
} from './helpers/editorHarness.js';

const STANDARD_JSON = '{"people":[{"name":"Alice","age":20},{"name":"Bob","age":30}],"meta":{"count":2}}';

test('parses standard JSON as a normal JSON document', async ({ page }) => {
  const editorSurface = await openEmptyEditor(page);

  await page.keyboard.insertText(STANDARD_JSON);

  await expect(page.getByTestId('editor-line-count')).toContainText('1 lines');
  await expect(editorSurface).toContainText('"people"');
  await expect(editorSurface).toContainText('"Alice"');
  await expect(page.getByText('7 keys', { exact: true })).toBeVisible();
  await expect(page.getByText('JSON', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'JSON Fragments' })).toHaveCount(0);
});

test('formats pasted standard JSON without entering mixed log mode', async ({ page }) => {
  const editorSurface = await openEmptyEditor(page);

  await pasteIntoEditor(page, STANDARD_JSON);

  await expect(page.getByTestId('editor-line-count')).toContainText('16 lines');
  await expect(editorSurface).toContainText('"people":');
  await expect(editorSurface).toContainText('"name": "Alice"');
  await expect(editorSurface).toContainText('"count": 2');
  await expect(page.getByText('JSON', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'JSON Fragments' })).toHaveCount(0);
});

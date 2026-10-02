import { expect, test } from '@playwright/test';
import { installTauriEditorHarness } from './helpers/editorHarness.js';

const NESTED_JSON = `{
  "1": {
    "ChickenNuggets": {
      "0": {
        "IncomeCoins": 15
      },
      "1": {
        "IncomeCoins": 17
      },
      "2": {
        "IncomeCoins": 19
      }
    },
    "Categories": "SIDEDISH",
    "Type": "MEAL"
  },
  "2": {
    "value": 2
  }
}`;

test('folds a JSON object through its matching closing brace', async ({ page }) => {
  await installTauriEditorHarness(page, NESTED_JSON);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  await expect(editor.locator('.view-lines')).toBeVisible();

  const lineTwo = editor
    .locator('.margin-view-overlays > div')
    .filter({ has: page.locator('.line-numbers', { hasText: /^2$/ }) });
  await lineTwo.locator('.cldr').click();

  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"1": {');
  await expect(viewLines).toContainText('"2": {');
  await expect(viewLines).not.toContainText('"ChickenNuggets": {');
  await expect(viewLines).not.toContainText('"IncomeCoins": 17');
});

const ISSUE_79_JSON = `{
  "source": "test.docx",
  "entities": 414,
  "entity_labels": {
    "labelA": 1,
    "labelB": 2
  },
  "ner_method": "llm",
  "rel_method": "llm"
}`;

test('folds the root object past nested fields and trailing properties', async ({ page }) => {
  await installTauriEditorHarness(page, ISSUE_79_JSON);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"rel_method": "llm"');

  const rootLine = editor
    .locator('.margin-view-overlays > div')
    .filter({ has: page.locator('.line-numbers', { hasText: /^1$/ }) });
  await rootLine.locator('.cldr').click();

  await expect(viewLines).not.toContainText('"entity_labels": {');
  await expect(viewLines).not.toContainText('"ner_method": "llm"');
  await expect(viewLines).not.toContainText('"rel_method": "llm"');
});

test('folds an unindented JSON object through its closing brace', async ({ page }) => {
  const unindentedJson = ['{', '"nested":{', '"value":1', '},', '"tail":2', '}'].join('\n');
  await installTauriEditorHarness(page, unindentedJson);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('"tail":2');

  const rootLine = editor
    .locator('.margin-view-overlays > div')
    .filter({ has: page.locator('.line-numbers', { hasText: /^1$/ }) });
  await rootLine.locator('.cldr').click();

  await expect(viewLines).not.toContainText('"tail":2');
});

test('folds JSON5 after a continued string containing an escaped quote', async ({ page }) => {
  const content = [
    '{',
    "  text: 'foo\\",
    "\\'bar',",
    '  nested: {',
    '    value: 1',
    '  },',
    '  tail: 2',
    '}',
  ].join('\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('tail: 2');

  const rootLine = editor
    .locator('.margin-view-overlays > div')
    .filter({ has: page.locator('.line-numbers', { hasText: /^1$/ }) });
  await rootLine.locator('.cldr').click();

  await expect(viewLines).not.toContainText('nested: {');
  await expect(viewLines).not.toContainText('tail: 2');
});

test('folds JSON5 after a line comment terminated by a Unicode separator', async ({ page }) => {
  const content = [
    '{',
    '  // ignored } \u2028 nested: {',
    '    value: 1',
    '  },',
    '  tail: 2',
    '}',
  ].join('\n');
  await installTauriEditorHarness(page, content);
  await page.goto('/');

  const editor = page.getByTestId('json-editor');
  const viewLines = editor.locator('.view-lines');
  await expect(viewLines).toContainText('tail: 2');

  const rootLine = editor
    .locator('.margin-view-overlays > div')
    .filter({ has: page.locator('.line-numbers', { hasText: /^1$/ }) });
  await rootLine.locator('.cldr').click();

  await expect(viewLines).not.toContainText('nested: {');
  await expect(viewLines).not.toContainText('tail: 2');
});

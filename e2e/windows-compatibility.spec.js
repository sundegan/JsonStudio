import { expect, test } from '@playwright/test';
import {
  installTauriEditorHarness,
  pasteIntoEditor,
} from './helpers/editorHarness.js';

const DOCUMENT = {
  first: 'one',
  second: 'two',
  profile: { name: 'Alice', age: 20 },
};
const SOURCE = JSON.stringify(DOCUMENT);

async function editorState(page) {
  return page.evaluate(async () => {
    const { initMonaco } = await import('/src/lib/services/monaco.ts');
    const { getDocumentContent } = await import('/src/lib/stores/documentStore.ts');
    const editor = (await initMonaco()).editor.getEditors()[0];
    const model = editor.getModel();
    return {
      value: editor.getValue(),
      document: getDocumentContent('editor-test-tab'),
      eol: model.getEOL(),
      selection: model.getValueInRange(editor.getSelection()),
    };
  });
}

async function openPastedDocument(page) {
  await installTauriEditorHarness(page, '', { showTreeView: true });
  await page.goto('/');
  const surface = page.getByTestId('json-editor').locator('.view-lines');
  await expect(surface).toBeVisible();
  await surface.click();
  await pasteIntoEditor(page, SOURCE);
  await expect(page.getByTestId('editor-line-count')).toContainText('9 lines');
  await expect(page.getByTestId('tree-ready')).toBeAttached();
}

for (const platform of [
  { name: 'Windows', navigator: 'Win32', ua: 'Windows NT 10.0; Win64; x64', eol: '\r\n' },
  { name: 'macOS', navigator: 'MacIntel', ua: 'Macintosh; Intel Mac OS X 10_15_7', eol: '\n' },
]) {
  test.describe(platform.name, () => {
    test.use({
      userAgent: `Mozilla/5.0 (${platform.ua}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36`,
    });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(value => {
        Object.defineProperty(navigator, 'platform', { get: () => value });
      }, platform.navigator);
    });

    test('pasted content stays identical to the Monaco model', async ({ page }) => {
      await openPastedDocument(page);
      const state = await editorState(page);
      expect(state.eol).toBe(platform.eol);
      expect(state.document).toBe(state.value);
      expect(JSON.parse(state.value)).toEqual(DOCUMENT);
    });

    test('Tree selection and edits use the correct character offsets', async ({ page }) => {
      await openPastedDocument(page);
      const row = page.locator('[data-tree-path="/profile/name"]');
      await row.click();
      expect((await editorState(page)).selection).toBe('"name": "Alice",');
      await row.locator('[data-tree-edit-kind="value"]').dblclick();
      const input = row.locator('.tree-edit-input');
      await input.fill('Bob');
      await input.press('Enter');
      await expect(row.locator('.tree-value')).toHaveText('Bob');
      const state = await editorState(page);
      expect(JSON.parse(state.value)).toEqual({
        ...DOCUMENT,
        profile: { ...DOCUMENT.profile, name: 'Bob' },
      });
      expect(state.document).toBe(state.value);
    });

    test('Grid edits do not overwrite adjacent JSON characters', async ({ page }) => {
      await openPastedDocument(page);
      await page.getByRole('button', { name: 'Grid', exact: true }).click();
      const row = page.locator('.gv-tr').filter({
        has: page.locator('.gv-td').first().getByText('second', { exact: true }),
      });
      await row.locator('.gv-td').nth(1).getByRole('button', { name: 'Edit value' }).click();
      const input = row.locator('.gv-edit-input');
      await input.fill('updated');
      await input.press('Enter');
      await expect(row).toContainText('updated');
      expect(JSON.parse((await editorState(page)).value)).toEqual({
        ...DOCUMENT, second: 'updated',
      });
    });

    test('toolbar transformations and undo preserve the document', async ({ page }) => {
      await openPastedDocument(page);
      const commandKey = platform.name === 'Windows' ? 'Control' : 'Meta';
      await page.keyboard.press(`${commandKey}+Shift+m`);
      await expect.poll(async () => (await editorState(page)).value).toBe(SOURCE);
      await page.getByRole('button', { name: 'Escape', exact: true }).click();
      await expect.poll(async () => JSON.parse((await editorState(page)).value)).toBe(SOURCE);
      await page.getByRole('button', { name: 'Unescape', exact: true }).click();
      await expect.poll(async () => (await editorState(page)).value).toBe(SOURCE);
      await page.getByRole('button', { name: 'Prettify', exact: true }).click();
      await expect(page.getByTestId('editor-line-count')).toContainText('9 lines');
      const before = (await editorState(page)).value;
      await page.getByRole('button', { name: 'Min+Esc', exact: true }).click();
      await expect.poll(async () => JSON.parse((await editorState(page)).value)).toBe(SOURCE);
      await page.getByTestId('json-editor').locator('.view-lines').click();
      await page.keyboard.press(`${commandKey}+z`);
      await expect.poll(async () => (await editorState(page)).value).toBe(before);
    });

    test('restored BOM-prefixed content is synchronized before toolbar actions', async ({ page }) => {
      await installTauriEditorHarness(page, `\uFEFF${JSON.stringify(DOCUMENT, null, 2)}`);
      await page.goto('/');
      await expect(page.getByTestId('json-editor').locator('.view-lines')).toBeVisible();
      await expect.poll(async () => {
        const state = await editorState(page);
        return state.document === state.value;
      }).toBe(true);
      await page.getByRole('button', { name: 'Minify', exact: true }).click();
      await expect.poll(async () => (await editorState(page)).value).toBe(SOURCE);
    });
  });
}

import { expect, test } from '@playwright/test';
import {
  getOpenedExternalUrls,
  installTauriEditorHarness,
} from './helpers/editorHarness.js';

const DOCUMENT = '"https://example.com/docs?q=1"';
const URL = 'https://example.com/docs?q=1';
const EMBEDDED_URL_DOCUMENT = '{"message":"visit https://example.com/docs?q=1 now"}';

async function openUrlDocument(page, content = DOCUMENT) {
  await installTauriEditorHarness(page, content, { isTauri: true });
  await page.goto('/');
  await expect(page.locator('[data-testid="json-editor"] .view-lines')).toContainText(URL);
}

async function clickUrlLine(page, options = {}) {
  const editorSurface = page.locator('[data-testid="json-editor"] .view-lines');
  await expect(editorSurface).toBeVisible();
  await expect(editorSurface).toContainText(URL);

  const box = await editorSurface.boundingBox();
  expect(box).toBeTruthy();

  const position = options.position ?? {
    x: Math.min(140, box.width / 2),
    y: 12,
  };
  const x = box.x + position.x;
  const y = box.y + position.y;

  await page.mouse.move(x, y);
  await page.waitForTimeout(500);

  if (options.modifiers?.includes('ControlOrMeta')) {
    await page.keyboard.down('Control');
    await page.keyboard.down('Meta');
    await page.mouse.click(x, y);
    await page.keyboard.up('Meta');
    await page.keyboard.up('Control');
    return;
  }

  await page.mouse.click(x, y);
}

test('main editor opens JSON string URLs through the Tauri opener on modifier click', async ({ page }) => {
  await openUrlDocument(page);

  await clickUrlLine(page);
  await expect.poll(() => getOpenedExternalUrls(page)).toEqual([]);

  await clickUrlLine(page, { modifiers: ['ControlOrMeta'] });
  await expect.poll(() => getOpenedExternalUrls(page)).toEqual([URL]);
});

test('main editor opens Monaco-detected links embedded inside JSON strings', async ({ page }) => {
  await openUrlDocument(page, EMBEDDED_URL_DOCUMENT);

  await clickUrlLine(page, {
    modifiers: ['ControlOrMeta'],
    position: {
      x: 185,
      y: 12,
    },
  });
  await expect.poll(() => getOpenedExternalUrls(page)).toEqual([URL]);
});

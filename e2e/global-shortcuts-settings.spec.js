import { expect, test } from '@playwright/test';
import { installTauriEditorHarness } from './helpers/editorHarness.js';

async function installShortcutSettingsHarness(page, saved = {}, language = 'en') {
  await installTauriEditorHarness(page);
  await page.addInitScript(({ saved, language }) => {
    if (!localStorage.getItem('jsonstudio_shortcuts')) {
      localStorage.setItem('jsonstudio_shortcuts', JSON.stringify(saved));
    }
    const settings = JSON.parse(localStorage.getItem('app-settings'));
    localStorage.setItem('app-settings', JSON.stringify({ ...settings, language }));
    window.isTauri = true;

    const originalInvoke = window.__TAURI_INTERNALS__.invoke;
    let release = null;
    let delay = null;
    const harness = {
      calls: [],
      active: [],
      nextError: null,
      pauseNextUpdate() {
        delay = new Promise(resolve => { release = resolve; });
      },
      resumeUpdate() {
        release?.();
      },
    };
    window.__globalShortcutsHarness = harness;
    window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
      if (command === 'desktop_platform') return 'macos';
      if (command === 'plugin:app|version') return '1.4.0';
      if (command === 'plugin:window|is_focused') return true;
      if (command === 'plugin:window|is_fullscreen' || command === 'plugin:window|is_maximized') return false;
      if (command === 'update_global_shortcuts') {
        harness.calls.push(structuredClone(args.bindings));
        if (delay) {
          const waiting = delay;
          delay = null;
          await waiting;
        }
        if (harness.nextError) {
          const error = harness.nextError;
          harness.nextError = null;
          return { bindings: harness.active, error };
        }
        harness.active = structuredClone(args.bindings);
        return { bindings: harness.active, error: null };
      }
      return originalInvoke(command, args);
    };
  }, { saved, language });
}

async function openShortcutSettings(page, language = 'en') {
  await page.goto('/');
  await page.getByRole('button', {
    name: language === 'zh' ? '打开应用设置与快捷键配置' : 'Open settings and shortcuts',
    exact: true,
  }).click();
  await page.locator('.settings-tabs').getByRole('button', {
    name: language === 'zh' ? '快捷键' : 'Shortcuts',
    exact: true,
  }).click();
  const toggle = page.getByRole('switch', {
    name: language === 'zh' ? '启用全局快捷键' : 'Enable global shortcuts',
  });
  await expect(toggle).toBeEnabled();
  return toggle;
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 960, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`one global switch fits the settings panel at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await installShortcutSettingsHarness(page);
    const toggle = await openShortcutSettings(page);
    await expect(toggle).toBeChecked();
    await expect(page.getByRole('switch')).toHaveCount(1);
    await expect(page.locator('.settings-shortcut-group-row')).toContainText('Global Shortcuts');
    const bounds = await page.locator('.settings-shortcut-group-row').boundingBox();
    const switchBounds = await toggle.boundingBox();
    expect(switchBounds.x + switchBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    expect(await page.locator('.settings-dialog').evaluate(
      element => element.scrollWidth <= element.clientWidth,
    )).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('global-shortcuts.png') });
  });
}

test('turning off global shortcuts survives reload and retains custom keys', async ({ page }) => {
  await installShortcutSettingsHarness(page, { showApp: { currentKey: 'CommandOrControl+Alt+J' } });
  const toggle = await openShortcutSettings(page);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('jsonstudio_shortcuts')).globalShortcutsEnabled,
  )).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Open settings and shortcuts', exact: true }).click();
  await page.locator('.settings-tabs').getByRole('button', { name: 'Shortcuts', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  expect(await page.evaluate(() => window.__globalShortcutsHarness.calls)).toEqual([[]]);
  expect(await page.evaluate(
    () => JSON.parse(localStorage.getItem('jsonstudio_shortcuts')).showApp.currentKey,
  )).toBe('CommandOrControl+Alt+J');
});

test('disabled global keys can be edited and are restored when the switch is enabled', async ({ page }) => {
  await installShortcutSettingsHarness(page, { globalShortcutsEnabled: false });
  const toggle = await openShortcutSettings(page);
  const showAppRow = page.locator('.settings-item').filter({
    has: page.getByText('Show App', { exact: true }),
  });
  await showAppRow.locator('input').click();
  const commandKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${commandKey}+Alt+k`);
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('jsonstudio_shortcuts')).showApp.currentKey,
  )).toBe('CommandOrControl+Alt+K');
  expect(await page.evaluate(() => window.__globalShortcutsHarness.active)).toEqual([]);
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(await page.evaluate(() => window.__globalShortcutsHarness.active)).toContainEqual({
    id: 'show_app',
    key: 'CommandOrControl+Alt+K',
  });
});

test('resetting shortcut keys does not enable global shortcuts', async ({ page }) => {
  await installShortcutSettingsHarness(page, {
    globalShortcutsEnabled: false,
    showApp: { currentKey: 'CommandOrControl+Alt+J' },
  });
  const toggle = await openShortcutSettings(page);
  await page.getByRole('button', { name: 'Reset All Shortcuts', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('jsonstudio_shortcuts')).showApp.currentKey,
  )).toBe('CommandOrControl+Shift+J');
  expect(await page.evaluate(() => window.__globalShortcutsHarness.active)).toEqual([]);
});

test('registration failure leaves the switch off and allows a successful retry', async ({ page }) => {
  await installShortcutSettingsHarness(page, { globalShortcutsEnabled: false });
  const toggle = await openShortcutSettings(page);
  await page.evaluate(() => { window.__globalShortcutsHarness.nextError = 'Shortcut already in use'; });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Shortcut already in use');
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});

test('unregistration failure keeps the switch on and shows the error', async ({ page }) => {
  await installShortcutSettingsHarness(page);
  const toggle = await openShortcutSettings(page);
  await page.evaluate(() => { window.__globalShortcutsHarness.nextError = 'Could not unregister'; });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Could not unregister');
});

test('pending changes disable the switch, recorders, and resets until completion', async ({ page }) => {
  await installShortcutSettingsHarness(page);
  const toggle = await openShortcutSettings(page);
  await page.evaluate(() => window.__globalShortcutsHarness.pauseNextUpdate());
  await toggle.click();
  await expect(toggle).toBeDisabled();
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('button', { name: 'Reset All Shortcuts', exact: true })).toBeDisabled();
  for (const input of await page.locator('.settings-section input').all()) {
    await expect(input).toBeDisabled();
  }
  await page.evaluate(() => window.__globalShortcutsHarness.resumeUpdate());
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
});

test('the global switch is localized in Chinese', async ({ page }) => {
  await installShortcutSettingsHarness(page, {}, 'zh');
  const toggle = await openShortcutSettings(page, 'zh');
  await expect(toggle).toBeChecked();
  await expect(page.locator('.settings-shortcut-group-row')).toContainText('全局快捷键');
});

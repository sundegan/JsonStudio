import { expect, test } from '@playwright/test';
import { installTauriEditorHarness } from './helpers/editorHarness.js';

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

async function openUpdateHarness(page, options = {}) {
  await installTauriEditorHarness(page, '', { isTauri: true });
  await page.addInitScript(({ version, language, isDarkMode }) => {
    const settings = JSON.parse(localStorage.getItem('app-settings'));
    localStorage.setItem('app-settings', JSON.stringify({ ...settings, language, isDarkMode }));
    const originalInvoke = window.__TAURI_INTERNALS__.invoke;
    let releaseCheck;
    let releaseInstall;
    const harness = {
      version,
      checks: [],
      closedResources: [],
      installs: 0,
      restarts: 0,
      nextCheckError: null,
      nextInstallError: null,
      nextRestartError: null,
      pauseCheck: false,
      pauseInstall: false,
      menuHandler: null,
      resumeCheck() { releaseCheck?.(); },
      resumeInstall() { releaseInstall?.(); },
    };
    window.__appUpdateHarness = harness;
    window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
      if (command === 'desktop_platform') return 'macos';
      if (command === 'plugin:app|version') return '1.4.0';
      if (command === 'plugin:window|is_focused') return true;
      if (command === 'plugin:window|is_fullscreen' || command === 'plugin:window|is_maximized') return false;
      if (command === 'plugin:event|listen' && args.event === 'check-for-update') {
        harness.menuHandler = args.handler;
      }
      if (command === 'plugin:updater|check') {
        harness.checks.push(Date.now());
        if (harness.pauseCheck) {
          harness.pauseCheck = false;
          await new Promise(resolve => { releaseCheck = resolve; });
        }
        if (harness.nextCheckError) {
          const error = harness.nextCheckError;
          harness.nextCheckError = null;
          throw new Error(error);
        }
        return harness.version ? {
          rid: harness.checks.length,
          currentVersion: '1.4.0',
          version: harness.version,
          body: 'Update test',
          rawJson: {},
        } : null;
      }
      if (command === 'plugin:updater|download_and_install') {
        harness.installs += 1;
        if (harness.pauseInstall) {
          harness.pauseInstall = false;
          await new Promise(resolve => { releaseInstall = resolve; });
        }
        if (harness.nextInstallError) {
          const error = harness.nextInstallError;
          harness.nextInstallError = null;
          throw new Error(error);
        }
        return null;
      }
      if (command === 'plugin:resources|close') {
        harness.closedResources.push(args.rid);
        return null;
      }
      if (command === 'restart_app') {
        harness.restarts += 1;
        if (harness.nextRestartError) {
          const error = harness.nextRestartError;
          harness.nextRestartError = null;
          throw new Error(error);
        }
        return null;
      }
      return originalInvoke(command, args);
    };
  }, {
    version: options.version === undefined ? '1.4.1' : options.version,
    language: options.language ?? 'en',
    isDarkMode: options.isDarkMode ?? false,
  });
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.goto('/');
  await expect(page.locator('.toolbar-settings-btn')).toBeVisible();
}

async function showInitialUpdate(page) {
  await page.clock.fastForward(5000);
  await expect(page.locator('.update-notification')).toBeVisible();
  await page.clock.runFor(300);
}

async function checkCount(page) {
  return page.evaluate(() => window.__appUpdateHarness.checks.length);
}

test('checks after five seconds and repeats every twelve hours', async ({ page }) => {
  await openUpdateHarness(page, { version: null });
  expect(await checkCount(page)).toBe(0);
  await page.clock.fastForward(4999);
  expect(await checkCount(page)).toBe(0);
  await page.clock.runFor(1);
  await expect.poll(() => checkCount(page)).toBe(1);
  await page.clock.fastForward(CHECK_INTERVAL_MS - 5001);
  expect(await checkCount(page)).toBe(1);
  await page.clock.runFor(1);
  await expect.poll(() => checkCount(page)).toBe(2);
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  await expect.poll(() => checkCount(page)).toBe(3);
  await expect(page.locator('.settings-update-badge')).toHaveCount(0);
  await expect(page.locator('.update-notification')).toHaveCount(0);
});

for (const scenario of [
  { width: 1440, height: 900, language: 'en', isDarkMode: false },
  { width: 960, height: 640, language: 'en', isDarkMode: false },
  { width: 390, height: 844, language: 'en', isDarkMode: false },
  { width: 1440, height: 900, language: 'zh', isDarkMode: true },
]) {
  test(`dismissed updates remain accessible at ${scenario.width}px in ${scenario.language}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await openUpdateHarness(page, scenario);
    const settings = page.locator('.toolbar-settings-btn');
    const originalBounds = await settings.boundingBox();
    await showInitialUpdate(page);
    const badge = settings.locator('.settings-update-badge');
    await expect(badge).toBeVisible();
    await expect(settings).toHaveAccessibleName(
      scenario.language === 'zh' ? '发现新版本，打开设置更新' : 'New version available. Open settings to update',
    );
    const bounds = await settings.boundingBox();
    expect(bounds.width).toBe(originalBounds.width);
    expect(bounds.height).toBe(originalBounds.height);
    const badgeBounds = await badge.boundingBox();
    expect(badgeBounds.x).toBeGreaterThanOrEqual(bounds.x);
    expect(badgeBounds.x + badgeBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    await page.screenshot({ path: testInfo.outputPath('update-notification.png'), animations: 'disabled' });
    await page.locator('.update-close-btn').click();
    await expect(page.locator('.update-notification')).toHaveCount(0);
    await expect(badge).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('update-badge-dismissed.png'), animations: 'disabled' });
    await settings.click();
    const application = page.locator('.settings-tabs').getByRole('button', {
      name: scenario.language === 'zh' ? '应用' : 'Application', exact: true,
    });
    await expect(application).toHaveAttribute('aria-current', 'page');
    const tabBounds = await application.boundingBox();
    const navBounds = await page.locator('.settings-tabs').boundingBox();
    expect(tabBounds.x).toBeGreaterThanOrEqual(navBounds.x - 1);
    expect(tabBounds.x + tabBounds.width).toBeLessThanOrEqual(navBounds.x + navBounds.width + 1);
    await expect(page.getByRole('dialog').getByRole('button', {
      name: scenario.language === 'zh' ? '立即更新' : 'Update', exact: true,
    })).toBeVisible();
    await expect(badge).toBeVisible();
    await page.clock.runFor(300);
    await page.screenshot({ path: testInfo.outputPath('update-settings.png'), animations: 'disabled' });
  });
}

test('a dismissed version stays quiet but a newer version is announced', async ({ page }) => {
  await openUpdateHarness(page);
  await showInitialUpdate(page);
  await page.locator('.update-close-btn').click();
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  await expect.poll(() => checkCount(page)).toBe(2);
  await expect(page.locator('.update-notification')).toHaveCount(0);
  await expect(page.locator('.settings-update-badge')).toBeVisible();
  expect(await page.evaluate(() => window.__appUpdateHarness.closedResources)).toEqual([1]);
  await page.evaluate(() => { window.__appUpdateHarness.version = '1.4.2'; });
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  await expect.poll(() => checkCount(page)).toBe(3);
  await expect(page.locator('.update-notification')).toBeVisible();
});

test('failed periodic checks preserve the update badge and installation action', async ({ page }) => {
  await openUpdateHarness(page);
  await showInitialUpdate(page);
  await page.locator('.update-close-btn').click();
  await page.evaluate(() => { window.__appUpdateHarness.nextCheckError = 'Network unavailable'; });
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  await expect.poll(() => checkCount(page)).toBe(2);
  await expect(page.locator('.update-notification')).toHaveCount(0);
  await expect(page.locator('.settings-update-badge')).toBeVisible();
  await page.locator('.toolbar-settings-btn').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  await expect(page.locator('.settings-error')).toHaveCount(0);
  expect(await page.evaluate(() => window.__appUpdateHarness.closedResources)).toEqual([]);
});

test('an initial background failure is silent and retried on the next cycle', async ({ page }) => {
  await openUpdateHarness(page);
  await page.evaluate(() => { window.__appUpdateHarness.nextCheckError = 'Network unavailable'; });
  await page.clock.fastForward(5000);
  await expect.poll(() => checkCount(page)).toBe(1);
  await expect(page.locator('.update-notification')).toHaveCount(0);
  await expect(page.locator('.settings-update-badge')).toHaveCount(0);
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  await expect.poll(() => checkCount(page)).toBe(2);
  await expect(page.locator('.update-notification')).toBeVisible();
  await expect(page.locator('.settings-update-badge')).toBeVisible();
});

test('manual checks report errors and can discover an update on retry', async ({ page }) => {
  await openUpdateHarness(page, { version: null });
  await page.locator('.toolbar-settings-btn').click();
  await page.locator('.settings-tabs').getByRole('button', { name: 'Application', exact: true }).click();
  await page.evaluate(() => { window.__appUpdateHarness.nextCheckError = 'Network unavailable'; });
  await page.getByRole('button', { name: 'Check Update', exact: true }).click();
  await expect(page.locator('.settings-error')).toHaveText('Network unavailable');
  await page.evaluate(() => { window.__appUpdateHarness.version = '1.4.1'; });
  await page.getByRole('button', { name: 'Check Update', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  await expect(page.locator('.settings-update-badge')).toBeVisible();
  await expect(page.locator('.update-notification')).toBeAttached();
});

test('periodic checks skip an ongoing check and resume on the next cycle', async ({ page }) => {
  await openUpdateHarness(page, { version: null });
  await page.evaluate(() => { window.__appUpdateHarness.pauseCheck = true; });
  await page.clock.fastForward(5000);
  await expect.poll(() => checkCount(page)).toBe(1);
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  expect(await checkCount(page)).toBe(1);
  await page.evaluate(() => window.__appUpdateHarness.resumeCheck());
  await page.locator('.toolbar-settings-btn').click();
  await page.locator('.settings-tabs').getByRole('button', { name: 'Application', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check Update', exact: true })).toBeEnabled();
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  await expect.poll(() => checkCount(page)).toBe(2);
});

test('installation and pending restart are not interrupted by periodic checks', async ({ page }) => {
  await openUpdateHarness(page);
  await showInitialUpdate(page);
  await page.evaluate(() => { window.__appUpdateHarness.pauseInstall = true; });
  await page.locator('.update-primary-btn').click();
  await expect(page.locator('.update-title')).toHaveText('Installing update');
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  expect(await checkCount(page)).toBe(1);
  await page.locator('.toolbar-settings-btn').click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Update', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__appUpdateHarness.resumeInstall());
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Restart App', exact: true })).toBeVisible();
  await expect(page.locator('.toolbar-settings-btn')).toHaveAccessibleName('Update installed. Open settings to restart');
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  expect(await checkCount(page)).toBe(1);
  await expect(page.locator('.settings-update-badge')).toBeVisible();
});

test('installation errors retain the badge and allow retry from settings', async ({ page }) => {
  await openUpdateHarness(page);
  await showInitialUpdate(page);
  await page.evaluate(() => { window.__appUpdateHarness.nextInstallError = 'Download failed'; });
  await page.locator('.update-primary-btn').click();
  await expect(page.locator('.update-error')).toHaveText('Download failed');
  await page.locator('.toolbar-settings-btn').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Restart App', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__appUpdateHarness.installs)).toBe(2);
});

test('a failed restart preserves the installed update and allows restarting again', async ({ page }) => {
  await openUpdateHarness(page);
  await showInitialUpdate(page);
  await page.locator('.update-primary-btn').click();
  await expect(page.locator('.update-title')).toHaveText('Update installed');
  await page.evaluate(() => { window.__appUpdateHarness.nextRestartError = 'Restart failed'; });
  await page.locator('.update-primary-btn').click();
  await expect(page.locator('.update-error')).toHaveText('Restart failed');
  await expect(page.locator('.toolbar-settings-btn')).toHaveAccessibleName('Update installed. Open settings to restart');
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  expect(await checkCount(page)).toBe(1);
  await page.locator('.toolbar-settings-btn').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Update', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Restart App', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__appUpdateHarness.restarts)).toBe(2);
  expect(await page.evaluate(() => window.__appUpdateHarness.installs)).toBe(1);
});

test('a successful check without an update clears the badge', async ({ page }) => {
  await openUpdateHarness(page);
  await showInitialUpdate(page);
  await page.evaluate(() => { window.__appUpdateHarness.version = null; });
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  await expect.poll(() => checkCount(page)).toBe(2);
  await expect(page.locator('.settings-update-badge')).toHaveCount(0);
  await expect(page.locator('.toolbar-settings-btn')).toHaveAccessibleName('Open settings and shortcuts');
  expect(await page.evaluate(() => window.__appUpdateHarness.closedResources)).toEqual([1]);
});

test('native menu updates share the badge and pending restart state', async ({ page }) => {
  await openUpdateHarness(page);
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__.runCallback(window.__appUpdateHarness.menuHandler, {
      event: 'check-for-update', id: 1, payload: null,
    });
  });
  await expect(page.locator('.toolbar-settings-btn')).toHaveAccessibleName('Update installed. Open settings to restart');
  await expect(page.locator('.settings-update-badge')).toBeVisible();
  expect(await page.evaluate(() => window.__appUpdateHarness.installs)).toBe(1);
  await page.clock.fastForward(CHECK_INTERVAL_MS);
  expect(await checkCount(page)).toBe(1);
});

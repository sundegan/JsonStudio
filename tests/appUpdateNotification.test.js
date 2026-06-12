import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('app update notification is mounted in the editor shell', () => {
  const editor = readFileSync(
    new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url),
    'utf8'
  );

  assert.match(editor, /import AppUpdateNotification from '\$lib\/components\/AppUpdateNotification\.svelte';/);
  assert.match(editor, /<AppUpdateNotification \/>/);
});

test('app update notification checks, installs, and restarts through Tauri updater APIs', () => {
  const component = readFileSync(
    new URL('../src/lib/components/AppUpdateNotification.svelte', import.meta.url),
    'utf8'
  );
  const store = readFileSync(
    new URL('../src/lib/stores/appUpdateStore.ts', import.meta.url),
    'utf8'
  );

  assert.match(component, /appUpdateStore/);
  assert.match(store, /@tauri-apps\/plugin-updater/);
  assert.match(store, /checkForAppUpdate/);
  assert.match(store, /installAppUpdate/);
  assert.match(store, /restartAfterAppUpdate/);
  assert.match(store, /invoke\('restart_app'\)/);
  assert.match(component, /settings\.installUpdate/);
  assert.match(component, /settings\.restartApp/);
});

test('update UI reassures users before restart and shares auto-check state with settings', () => {
  const notification = readFileSync(
    new URL('../src/lib/components/AppUpdateNotification.svelte', import.meta.url),
    'utf8'
  );
  const settingsPanel = readFileSync(
    new URL('../src/lib/components/SettingsPanel.svelte', import.meta.url),
    'utf8'
  );
  const zh = readFileSync(new URL('../src/lib/i18n/locales/zh.ts', import.meta.url), 'utf8');
  const en = readFileSync(new URL('../src/lib/i18n/locales/en.ts', import.meta.url), 'utf8');

  assert.match(notification, /updates\.availablePrompt/);
  assert.match(notification, /updates\.restartReassurance/);
  assert.match(settingsPanel, /appUpdateStore\.subscribe/);
  assert.match(settingsPanel, /updates\.availablePrompt/);
  assert.match(settingsPanel, /updates\.restartReassurance/);
  assert.match(zh, /当前打开的内容会保留，可放心重启。/);
  assert.match(en, /Your open content will be preserved\. It is safe to restart\./);
});

test('app update notification delays automatic checks and can be dismissed when actionable', () => {
  const notification = readFileSync(
    new URL('../src/lib/components/AppUpdateNotification.svelte', import.meta.url),
    'utf8'
  );

  assert.match(notification, /const AUTO_CHECK_DELAY_MS = 5000;/);
  assert.match(notification, /setTimeout\(\(\) => \{/);
  assert.match(notification, /onclick=\{dismiss\}/);
  assert.match(notification, /\{#if !isBusy && hasAction\}/);
  assert.match(notification, /if \(isBusy\) return;/);
});

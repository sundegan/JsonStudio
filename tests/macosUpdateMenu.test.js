import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('macOS app menu exposes check update and emits frontend event', () => {
  const libRs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

  assert.match(libRs, /SubmenuBuilder::new\(app,\s*"Json Studio"\)/);
  assert.match(libRs, /fn about_menu_text\(language: &str\) -> &'static str/);
  assert.match(libRs, /\.text\("show_about",\s*about_menu_text\(language\)\)/);
  assert.match(libRs, /fn check_for_update_menu_text\(language: &str\) -> &'static str/);
  assert.match(libRs, /"en"\s*=>\s*"Check for Updates\.\.\."/);
  assert.match(libRs, /_\s*=>\s*"检查更新\.\.\."/);
  assert.match(libRs, /\.text\("check_for_update",\s*check_for_update_menu_text\(language\)\)/);
  assert.match(libRs, /fn set_app_menu_language\(app: tauri::AppHandle, language: String\)/);
  assert.match(libRs, /\.hide\(\)/);
  assert.match(libRs, /\.hide_others\(\)/);
  assert.match(libRs, /\.show_all\(\)/);
  assert.match(libRs, /SubmenuBuilder::new\(app,\s*"Edit"\)/);
  assert.match(libRs, /\.undo\(\)/);
  assert.match(libRs, /\.redo\(\)/);
  assert.match(libRs, /\.cut\(\)/);
  assert.match(libRs, /\.copy\(\)/);
  assert.match(libRs, /\.paste\(\)/);
  assert.match(libRs, /\.select_all\(\)/);
  assert.match(libRs, /\.items\(&\[&app_menu,\s*&edit_menu\]\)/);
  assert.match(libRs, /app\.on_menu_event/);
  assert.match(libRs, /event\.id\(\)\.0\.as_str\(\)/);
  assert.match(libRs, /"show_about"/);
  assert.match(libRs, /emit\("show-about"/);
  assert.match(libRs, /"check_for_update"/);
  assert.match(libRs, /emit\("check-for-update"/);
});

test('custom about dialog listens for menu event and shows app metadata', () => {
  const aboutDialog = readFileSync(new URL('../src/lib/components/AboutDialog.svelte', import.meta.url), 'utf8');
  const jsonEditor = readFileSync(new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url), 'utf8');

  assert.match(jsonEditor, /import AboutDialog from '\$lib\/components\/AboutDialog\.svelte';/);
  assert.match(jsonEditor, /<AboutDialog \/>/);
  assert.match(aboutDialog, /listen\('show-about'/);
  assert.match(aboutDialog, /getVersion\(\)/);
  assert.match(aboutDialog, /src="\/app-icon\.png"/);
  assert.match(aboutDialog, /const githubLabel = 'sundegan\/JsonStudio';/);
  assert.match(aboutDialog, /<strong title=\{githubUrl\}>\{githubLabel\}<\/strong>/);
  assert.match(aboutDialog, /openUrl\('https:\/\/github\.com\/sundegan\/JsonStudio'\)/);
  assert.match(aboutDialog, /text-overflow: ellipsis;/);
  assert.match(aboutDialog, /white-space: nowrap;/);
  assert.doesNotMatch(aboutDialog, /short_version|Version \\{version\\} \\(\\{version\\}\\)/);
});

test('settings panel listens for menu check update event', () => {
  const settingsPanel = readFileSync(
    new URL('../src/lib/components/SettingsPanel.svelte', import.meta.url),
    'utf8'
  );

  assert.match(settingsPanel, /import \{ listen \} from '@tauri-apps\/api\/event';/);
  assert.match(settingsPanel, /checkInstallAndNotifyAppUpdate/);
  assert.match(settingsPanel, /listen\('check-for-update'/);
  assert.match(settingsPanel, /handleMenuCheckForUpdate/);
  assert.match(settingsPanel, /message: async content => window\.alert\(content\)/);
  assert.match(settingsPanel, /confirm: async content => window\.confirm\(content\)/);
  assert.match(settingsPanel, /relaunch: \(\) => invoke\('restart_app'\)/);
  assert.doesNotMatch(settingsPanel, /async function handleMenuCheckForUpdate\(\) \{\n\s+isOpen = true;/);
});

test('settings panel groups categories into tabs', () => {
  const settingsPanel = readFileSync(
    new URL('../src/lib/components/SettingsPanel.svelte', import.meta.url),
    'utf8'
  );

  assert.match(settingsPanel, /type SettingsTab = 'appearance' \| 'editor' \| 'shortcuts' \| 'application';/);
  assert.match(settingsPanel, /const settingsTabs: Array<\{ id: SettingsTab; labelKey: string \}> = \[/);
  assert.match(settingsPanel, /class="settings-tabs"/);
  assert.match(settingsPanel, /class="settings-tab \{activeTab === tab\.id \? 'is-active' : ''\}"/);
  assert.match(settingsPanel, /\{#if activeTab === 'appearance'\}/);
  assert.match(settingsPanel, /\{#if activeTab === 'editor'\}/);
  assert.match(settingsPanel, /\{#if activeTab === 'shortcuts' && shortcuts\}/);
  assert.match(settingsPanel, /\{#if activeTab === 'application'\}/);
  assert.match(settingsPanel, /grid-template-columns: 168px minmax\(0, 1fr\);/);
  assert.match(settingsPanel, /height: min\(680px, calc\(100vh - 48px\)\);/);
  assert.match(settingsPanel, /scrollbar-gutter: stable;/);
  assert.match(settingsPanel, /\.settings-body::-webkit-scrollbar/);
  assert.match(settingsPanel, /@media \(max-width: 760px\)/);
});

test('settings store syncs macOS menu language with app language', () => {
  const settingsStore = readFileSync(new URL('../src/lib/stores/settings.ts', import.meta.url), 'utf8');

  assert.match(settingsStore, /async function syncAppMenuLanguage\(language: Locale\)/);
  assert.match(settingsStore, /invoke\('set_app_menu_language', \{ language \}\)/);
  assert.match(settingsStore, /void syncAppMenuLanguage\(settings\.language\)/);
  assert.match(settingsStore, /void syncAppMenuLanguage\(value as Locale\)/);
});

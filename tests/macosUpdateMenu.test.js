import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('macOS app menu exposes check update and emits frontend event', () => {
  const libRs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

  assert.match(libRs, /SubmenuBuilder::new\(app,\s*"Json Studio"\)/);
  assert.match(libRs, /\.text\("check_for_update",\s*"检查更新\.\.\."\)/);
  assert.match(libRs, /app\.on_menu_event/);
  assert.match(libRs, /event\.id\(\)\.0\.as_str\(\)/);
  assert.match(libRs, /"check_for_update"/);
  assert.match(libRs, /emit\("check-for-update"/);
});

test('settings panel listens for menu check update event', () => {
  const settingsPanel = readFileSync(
    new URL('../src/lib/components/SettingsPanel.svelte', import.meta.url),
    'utf8'
  );

  assert.match(settingsPanel, /import \{ listen \} from '@tauri-apps\/api\/event';/);
  assert.match(settingsPanel, /listen\('check-for-update'/);
  assert.match(settingsPanel, /handleMenuCheckForUpdate/);
  assert.match(settingsPanel, /isOpen = true/);
  assert.match(settingsPanel, /handleCheckForUpdate\(\)/);
});

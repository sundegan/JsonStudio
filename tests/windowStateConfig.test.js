import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('tauri registers the window state plugin', () => {
  const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
  const libRs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

  assert.match(cargoToml, /tauri-plugin-window-state\s*=\s*"2"/);
  assert.match(libRs, /tauri_plugin_window_state::Builder::default\(\)\.build\(\)/);
  assert.match(libRs, /schedule_main_window_bounds_clamp\(&app_handle\)/);
  assert.match(libRs, /RESTORED_WINDOW_MAX_SCREEN_RATIO: f64 = 0\.9/);
});

test('tauri default window size fits common laptop screens', () => {
  const config = JSON.parse(
    readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
  );
  const mainWindow = config.app.windows[0];

  assert.equal(mainWindow.width, 1280);
  assert.equal(mainWindow.height, 800);
  assert.equal(mainWindow.minWidth, 960);
  assert.equal(mainWindow.minHeight, 640);
  assert.ok(mainWindow.minWidth <= mainWindow.width);
  assert.ok(mainWindow.minHeight <= mainWindow.height);
});

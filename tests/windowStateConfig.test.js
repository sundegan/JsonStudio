import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('tauri registers the window state plugin', () => {
  const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
  const libRs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

  assert.match(cargoToml, /tauri-plugin-window-state\s*=\s*"2"/);
  assert.match(libRs, /tauri_plugin_window_state::Builder::default\(\)\.build\(\)/);
});

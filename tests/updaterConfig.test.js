import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('tauri updater plugin is wired for desktop releases', () => {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
  const libRs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const windowCommands = readFileSync(
    new URL('../src-tauri/src/commands/window.rs', import.meta.url),
    'utf8'
  );
  const tauriConfig = JSON.parse(
    readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
  );
  const defaultCapability = JSON.parse(
    readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8')
  );

  assert.equal(packageJson.dependencies['@tauri-apps/plugin-updater'], '^2.10.1');
  assert.match(cargoToml, /tauri-plugin-updater\s*=\s*"2"/);
  assert.match(libRs, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(libRs, /restart_app/);
  assert.match(windowCommands, /pub fn restart_app\(app: tauri::AppHandle\)/);
  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
  assert.ok(defaultCapability.permissions.includes('updater:default'));
});

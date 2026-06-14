import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const devConfig = JSON.parse(readFileSync(
  new URL('../src-tauri/tauri.dev.conf.json', import.meta.url),
  'utf8',
));
const releaseConfig = JSON.parse(readFileSync(
  new URL('../src-tauri/tauri.conf.json', import.meta.url),
  'utf8',
));
const makefile = readFileSync(new URL('../Makefile', import.meta.url), 'utf8');

test('development mode uses a distinct Tauri application identifier', () => {
  assert.equal(devConfig.identifier, 'com.jsonstudio.app.dev');
  assert.notEqual(devConfig.identifier, releaseConfig.identifier);
  assert.match(
    makefile,
    /pnpm tauri dev --config src-tauri\/tauri\.dev\.conf\.json/,
  );
});

test('mock update development mode uses the development Tauri config', () => {
  assert.match(
    makefile,
    /VITE_MOCK_APP_UPDATE=1 pnpm tauri dev --config src-tauri\/tauri\.dev\.conf\.json/,
  );
});

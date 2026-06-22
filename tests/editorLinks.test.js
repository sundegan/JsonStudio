import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('monaco editor delegates native link opening to the Tauri opener', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/MonacoEditor.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ openUrl \} from '@tauri-apps\/plugin-opener';/);
  assert.match(source, /registerLinkOpener/);
  assert.match(source, /resource\.toString\(true\)/);
  assert.match(source, /await openEditorUrl\(url\)/);
  assert.match(source, /return true/);
  assert.doesNotMatch(source, /editor\.onMouseDown/);
  assert.doesNotMatch(source, /getJsonStringUrlAtColumn/);
});

test('external link helper uses Tauri opener and browser fallback', () => {
  const source = readFileSync(
    new URL('../src/lib/services/externalLinks.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ isTauri \} from '@tauri-apps\/api\/core';/);
  assert.match(source, /import \{ openUrl \} from '@tauri-apps\/plugin-opener';/);
  assert.match(source, /if \(!isTauri\(\)\)/);
  assert.match(source, /void openUrl\(url\)\.catch/);
  assert.match(source, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
  assert.match(source, /window\.location\.assign\(url\)/);
});

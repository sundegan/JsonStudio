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

test('monaco find widget close hover is hidden without intercepting interactions', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/MonacoEditor.svelte', import.meta.url),
    'utf8',
  );
  const appCss = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');

  assert.match(source, /new MutationObserver/);
  assert.match(source, /findWidgetManagedHoverSelector/);
  assert.match(source, /hideFindWidgetManagedHovers/);
  assert.match(source, /monacoHoverObserver\.observe\(document\.body/);
  assert.match(source, /classList\.add\(\s*'jsonstudio-hidden-monaco-hover'/);
  assert.match(appCss, /\.jsonstudio-hidden-monaco-hover\s*\{[\s\S]*display: none !important;/);
  assert.doesNotMatch(source, /findWidgetTooltipSelectors/);
  assert.doesNotMatch(source, /removeFindWidgetTooltips/);
  assert.doesNotMatch(source, /removeAttribute\('title'\)/);
  assert.doesNotMatch(source, /stopImmediatePropagation/);
  assert.doesNotMatch(source, /stopPropagation/);
  assert.doesNotMatch(source, /preventDefault/);
  assert.doesNotMatch(source, /addEventListener\('mouseover'/);
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

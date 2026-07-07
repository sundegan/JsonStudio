import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layoutSource = readFileSync(new URL('../src/routes/+layout.svelte', import.meta.url), 'utf8');
const appCssSource = readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
const tauriConfig = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
);

test('app shell disables the default browser context menu', () => {
  assert.match(
    layoutSource,
    /const handleContextMenu = \(event: MouseEvent\) => \{\s*event\.preventDefault\(\);\s*\};/
  );
  assert.match(
    layoutSource,
    /document\.addEventListener\('contextmenu', handleContextMenu\);/
  );
  assert.match(
    layoutSource,
    /document\.removeEventListener\('contextmenu', handleContextMenu\);/
  );
});

test('app shell disables browser zoom affordances', () => {
  assert.equal(tauriConfig.app.windows[0].zoomHotkeysEnabled, false);
  assert.match(
    layoutSource,
    /document\.addEventListener\('wheel', handleWheel, \{ passive: false \}\);/
  );
  assert.match(
    layoutSource,
    /document\.addEventListener\('keydown', handleKeydown\);/
  );
  assert.match(
    layoutSource,
    /document\.addEventListener\('gesturestart', handleGesture\);/
  );
  assert.match(
    layoutSource,
    /document\.addEventListener\('gesturechange', handleGesture\);/
  );
  assert.match(
    layoutSource,
    /document\.removeEventListener\('wheel', handleWheel\);/
  );
  assert.match(
    layoutSource,
    /document\.removeEventListener\('keydown', handleKeydown\);/
  );
});

test('app shell disables browser-style element dragging', () => {
  assert.match(
    appCssSource,
    /img,\s*a\s*\{\s*-webkit-user-drag: none;\s*\}/
  );
});

test('app shell disables browser-style text selection for chrome UI', () => {
  assert.match(
    appCssSource,
    /html\s*\{[\s\S]*?user-select: none;[\s\S]*?-webkit-user-select: none;[\s\S]*?\}/
  );
  assert.match(
    appCssSource,
    /body\s*\{[\s\S]*?user-select: none;[\s\S]*?-webkit-user-select: none;[\s\S]*?\}/
  );
  assert.match(
    appCssSource,
    /#app-root\s*\{[\s\S]*?user-select: none;[\s\S]*?-webkit-user-select: none;[\s\S]*?\}/
  );
  assert.match(
    appCssSource,
    /input,\s*textarea,\s*\[contenteditable="true"\]\s*\{[\s\S]*?user-select: text;[\s\S]*?-webkit-user-select: text;[\s\S]*?\}/
  );
  assert.match(layoutSource, /const handleSelectStart = \(event: Event\) => \{/);
  assert.match(layoutSource, /'\.monaco-editor'/);
  assert.match(layoutSource, /document\.addEventListener\('selectstart', handleSelectStart\);/);
  assert.match(layoutSource, /document\.removeEventListener\('selectstart', handleSelectStart\);/);
  assert.doesNotMatch(appCssSource, /\.monaco-editor,\s*\.monaco-editor \*/);
});

test('app shell refreshes expanded window frame state without resize listeners', () => {
  assert.match(
    layoutSource,
    /window\.addEventListener\('focus', syncWindowFrameState\);/
  );
  assert.match(
    layoutSource,
    /document\.addEventListener\('visibilitychange', handleDocumentVisibilityChange\);/
  );
  assert.match(
    layoutSource,
    /if \(focused\) syncWindowFrameState\(\);/
  );
  assert.doesNotMatch(layoutSource, /addEventListener\('pageshow'/);
  assert.doesNotMatch(layoutSource, /appWindow\.onResized/);
});

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const toolbarSource = readFileSync(
  new URL('../src/lib/components/editor/JsonEditorToolbar.svelte', import.meta.url),
  'utf8'
);

test('export image is grouped inside the file operations dropdown', () => {
  const exportMenuItemPattern = /<button class="[^"]*\bopen-menu-item\b[^"]*" onclick=\{handleExportImageFromMenu\}[\s\S]*?\$t\('toolbar\.exportImage'\)/;
  assert.match(toolbarSource, exportMenuItemPattern);
});

test('file operations group does not render export image as a standalone toolbar button', () => {
  const fileOperationsGroup = toolbarSource.match(
    /<!-- 1\. File operations -->([\s\S]*?)<div class="toolbar-divider"[^>]*><\/div>/
  )?.[1];

  assert.ok(fileOperationsGroup, 'file operations group should be present');
  assert.doesNotMatch(fileOperationsGroup, /<button class="toolbar-btn" onclick=\{handleExportImage\}/);
});

test('save only clears modified state when document content is unchanged after write', () => {
  const saveBody = toolbarSource.match(/async function handleSaveFile[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(saveBody, /getDocumentContent\(activeTab\.id\) === currentContent/);
  assert.match(saveBody, /tabsStore\.updateTabModified\(activeTab\.id, false\)/);
});

test('macOS custom traffic lights are hidden while fullscreen', () => {
  assert.match(
    toolbarSource,
    /\{#if platform === 'macos' && !isWindowFullscreen\}[\s\S]*class="window-controls macos toolbar-window-controls"/,
  );
  assert.match(toolbarSource, /applyWindowState\(true, false\)/);
  assert.match(toolbarSource, /window\.addEventListener\('focus', syncWindowState\);/);
  assert.match(toolbarSource, /document\.addEventListener\('visibilitychange', handleDocumentVisibilityChange\);/);
  assert.match(toolbarSource, /if \(focused\) syncWindowState\(\);/);
  assert.doesNotMatch(toolbarSource, /addEventListener\('pageshow'/);
  assert.doesNotMatch(toolbarSource, /appWindow\.onResized/);
});

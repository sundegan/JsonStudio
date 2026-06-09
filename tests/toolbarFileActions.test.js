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
    /<!-- 1\. File operations -->([\s\S]*?)<div class="toolbar-divider"><\/div>/
  )?.[1];

  assert.ok(fileOperationsGroup, 'file operations group should be present');
  assert.doesNotMatch(fileOperationsGroup, /<button class="toolbar-btn" onclick=\{handleExportImage\}/);
});

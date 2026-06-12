import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampPanelWidth, getDefaultPanelWidth } from '../src/lib/services/panelResize.js';

test('keeps the side panel within min and max widths', () => {
  assert.equal(clampPanelWidth(120, 1200), 280);
  assert.equal(clampPanelWidth(1200, 1200), 840);
  assert.equal(clampPanelWidth(2000, 1800), 1260);
});

test('preserves a usable editor width when the workspace is narrow', () => {
  assert.equal(clampPanelWidth(700, 900), 630);
  assert.equal(clampPanelWidth(600, 520), 280);
});

test('uses a responsive default width for wide workspaces', () => {
  assert.equal(getDefaultPanelWidth(1800), 684);
  assert.equal(getDefaultPanelWidth(900), 342);
  assert.equal(getDefaultPanelWidth(520), 280);
});

test('keeps the side panel toggle discoverable around the splitter', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url),
    'utf8',
  );
  const globalStyles = readFileSync(
    new URL('../src/app.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /\.json-view-toggler-zone::before \{/);
  assert.match(source, /left: -18px;/);
  assert.match(source, /right: -4px;/);
  assert.match(source, /\.json-view-toggler-zone\.left::before \{[\s\S]*right: -18px;/);
  assert.match(source, /\.json-view-toggle-btn \{[\s\S]*left: 1px;/);
  assert.match(source, /\.json-view-toggler-zone\.left \.json-view-toggle-btn \{[\s\S]*right: 1px;/);
  assert.doesNotMatch(source, /\.json-view-toggler-zone\.is-closed::before/);
  assert.match(globalStyles, /\.json-tree-resizer,\n\.json-folder-resizer \{[\s\S]*z-index: 20;/);
});

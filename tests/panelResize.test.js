import test from 'node:test';
import assert from 'node:assert/strict';
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

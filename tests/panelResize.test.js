import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPanelWidth,
  getDefaultFolderWidth,
  getDefaultPanelWidth,
  getSidebarResizeResistance,
  shouldCollapseSidebar,
} from '../src/lib/services/panelResize.js';

test('keeps the side panel within min and max widths', () => {
  assert.equal(clampPanelWidth(120, 1200), 280);
  assert.equal(clampPanelWidth(1200, 1200), 840);
  assert.equal(clampPanelWidth(2000, 1800), 1260);
});

test('preserves a usable editor width when the workspace is narrow', () => {
  assert.equal(clampPanelWidth(700, 900), 630);
  assert.equal(clampPanelWidth(600, 520), 280);
});

test('uses a balanced responsive default width for the tree view', () => {
  assert.equal(getDefaultPanelWidth(1800), 420);
  assert.equal(getDefaultPanelWidth(1440), 420);
  assert.equal(getDefaultPanelWidth(900), 288);
  assert.equal(getDefaultPanelWidth(520), 280);
});

test('uses a compact responsive default width for the folder view', () => {
  assert.equal(getDefaultFolderWidth(1440), 240);
  assert.equal(getDefaultFolderWidth(900), 240);
  assert.equal(getDefaultFolderWidth(520), 182);
});

test('resists a narrow sidebar drag before collapsing it', () => {
  assert.equal(getSidebarResizeResistance(280, 280), 0);
  assert.equal(getSidebarResizeResistance(250, 280), 30);
  assert.equal(shouldCollapseSidebar(225, 280), false);
  assert.equal(shouldCollapseSidebar(224, 280), true);
});

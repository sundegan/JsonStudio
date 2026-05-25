import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MAX_TABS, openFileInTabs } from '../src/lib/stores/tabOpen.js';
import {
  shouldConfirmCloseAllTabs,
  shouldConfirmCloseOtherTabs,
  shouldConfirmCloseTab,
} from '../src/lib/stores/tabClose.js';

function createTab(overrides = {}) {
  return {
    id: 'tab-1',
    filePath: null,
    fileName: 'Untitled-1',
    content: '',
    isModified: false,
    isPinned: false,
    ...overrides,
  };
}

test('allows up to 15 tabs', () => {
  assert.equal(MAX_TABS, 15);
});

test('reopening an unmodified file reuses and refreshes the existing tab', () => {
  const state = {
    tabs: [createTab({ id: 'tab-1', filePath: '/tmp/a.json', fileName: 'a.json', content: '{"old":true}' })],
    activeTabId: 'other-tab',
  };

  const result = openFileInTabs(state, '{"new":true}', '/tmp/a.json', 'a.json');

  assert.equal(result.maxTabsReached, false);
  assert.equal(result.state.activeTabId, 'tab-1');
  assert.equal(result.state.tabs[0].content, '{"new":true}');
  assert.equal(result.state.tabs.length, 1);
});

test('reopening a modified file activates the existing tab without discarding edits', () => {
  const state = {
    tabs: [createTab({ id: 'tab-1', filePath: '/tmp/a.json', content: '{"draft":true}', isModified: true })],
    activeTabId: 'other-tab',
  };

  const result = openFileInTabs(state, '{"disk":true}', '/tmp/a.json', 'a.json');

  assert.equal(result.state.activeTabId, 'tab-1');
  assert.equal(result.state.tabs[0].content, '{"draft":true}');
  assert.equal(result.state.tabs[0].isModified, true);
});

test('opening a new file reports the tab limit only when no existing tab can be reused', () => {
  const tabs = Array.from({ length: MAX_TABS }, (_, index) =>
    createTab({ id: `tab-${index}`, filePath: `/tmp/${index}.json` })
  );

  const result = openFileInTabs({ tabs, activeTabId: tabs[0].id }, '{}', '/tmp/new.json', 'new.json');

  assert.equal(result.state.tabs.length, MAX_TABS);
  assert.equal(result.maxTabsReached, true);
});

test('toolbar reports the tab limit instead of success when new tab creation fails', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/JsonEditorToolbar.svelte', import.meta.url),
    'utf8',
  );
  const handlerBody = source.match(/function handleNewFile\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(handlerBody, /const\s+created\s*=\s*tabsStore\.addTab\(\)/);
  assert.match(handlerBody, /if\s*\(!created\)/);
  assert.match(handlerBody, /Maximum \$\{MAX_TABS\} tabs reached/);
  assert.match(handlerBody, /return/);
  assert.match(handlerBody, /New tab created/);
});

test('tab bar does not expose a separate inline new-tab button', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/TabBar.svelte', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /function handleNewTab\(\)/);
  assert.doesNotMatch(source, /title="New Tab \(Cmd\+T\)"/);
});

test('close confirmation is required only when unsaved changes would be discarded', () => {
  const tabs = [
    createTab({ id: 'keep', isModified: false }),
    createTab({ id: 'pinned', isPinned: true, isModified: true }),
    createTab({ id: 'dirty', isModified: true }),
  ];

  assert.equal(shouldConfirmCloseTab(tabs, 'dirty'), true);
  assert.equal(shouldConfirmCloseTab(tabs, 'keep'), false);
  assert.equal(shouldConfirmCloseOtherTabs(tabs, 'keep'), true);
  assert.equal(shouldConfirmCloseOtherTabs(tabs, 'dirty'), false);
  assert.equal(shouldConfirmCloseAllTabs(tabs), true);
  assert.equal(shouldConfirmCloseAllTabs([createTab({ isModified: false })]), false);
});

test('editor setValue keeps destructive operations undoable through Monaco edits', async () => {
  const source = await readFile(new URL('../src/lib/components/editor/MonacoEditor.svelte', import.meta.url), 'utf8');
  const setValueBody = source.match(/export function setValue\(newValue: string\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(setValueBody, /pushEditOperations/);
  assert.doesNotMatch(setValueBody, /editor\.setValue\(newValue\)/);
});

test('editor range replacement keeps grid edits undoable through Monaco edits', async () => {
  const source = await readFile(new URL('../src/lib/components/editor/MonacoEditor.svelte', import.meta.url), 'utf8');
  const replaceBody = source.match(/export function replaceRangeByOffsets\(start: number, end: number, text: string\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(replaceBody, /pushEditOperations/);
  assert.match(replaceBody, /getPositionAt/);
});

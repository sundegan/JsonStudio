import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openFileInTabs } from '../src/lib/stores/tabOpen.js';
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

test('reopening an unmodified file reuses and refreshes the existing tab', () => {
  const state = {
    tabs: [createTab({ id: 'tab-1', filePath: '/tmp/a.json', fileName: 'a.json', content: '{"old":true}' })],
    activeTabId: 'other-tab',
  };

  const result = openFileInTabs(state, '{"new":true}', '/tmp/a.json', 'a.json');

  assert.equal(result.activeTabId, 'tab-1');
  assert.equal(result.tabs[0].content, '{"new":true}');
  assert.equal(result.tabs.length, 1);
});

test('reopening a modified file activates the existing tab without discarding edits', () => {
  const state = {
    tabs: [createTab({ id: 'tab-1', filePath: '/tmp/a.json', content: '{"draft":true}', isModified: true })],
    activeTabId: 'other-tab',
  };

  const result = openFileInTabs(state, '{"disk":true}', '/tmp/a.json', 'a.json');

  assert.equal(result.activeTabId, 'tab-1');
  assert.equal(result.tabs[0].content, '{"draft":true}');
  assert.equal(result.tabs[0].isModified, true);
});

test('opening a new file leaves creation to the tabs store', () => {
  const state = {
    tabs: [createTab({ id: 'tab-1', filePath: '/tmp/a.json' })],
    activeTabId: 'tab-1',
  };

  const result = openFileInTabs(state, '{}', '/tmp/new.json', 'new.json');

  assert.equal(result, state);
});

test('toolbar creates new tabs directly', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/JsonEditorToolbar.svelte', import.meta.url),
    'utf8',
  );
  const handlerBody = source.match(/function handleNewFile\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(handlerBody, /tabsStore\.addTab\(\)/);
  assert.doesNotMatch(handlerBody, /Maximum/);
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

test('tab bar scrolls the active tab into view when the active tab changes', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/TabBar.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /bind:this=\{tabsContainer\}/);
  assert.match(source, /querySelectorAll<HTMLElement>/);
  assert.match(source, /element\.dataset\.tabId === tabId/);
  assert.match(source, /scrollIntoView\(/);
  assert.match(source, /inline:\s*'nearest'/);
});

test('tab bar uses pointer events instead of native html drag events', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/TabBar.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /onpointerdown=/);
  assert.match(source, /onpointermove=/);
  assert.match(source, /onpointerup=/);
  assert.doesNotMatch(source, /draggable="true"/);
  assert.doesNotMatch(source, /ondragstart=/);
});

test('tab bar maps normal wheel scrolling to horizontal scrolling', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/TabBar.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /onwheel=\{handleTabsWheel\}/);
  assert.match(source, /scrollLeft \+= event\.deltaX \|\| event\.deltaY/);
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

test('editor keeps a Monaco model per tab and disposes closed tab models', async () => {
  const source = await readFile(new URL('../src/lib/components/editor/MonacoEditor.svelte', import.meta.url), 'utf8');

  assert.match(source, /const modelsByKey = new Map/);
  assert.match(source, /const MAX_CACHED_MODELS = 5/);
  assert.match(source, /editor\.setModel\(model\)/);
  assert.match(source, /export function retainModels\(keys: string\[\]\)/);
  assert.match(source, /model\.dispose\(\)/);
});

test('main editor uses one lightweight tokenizer for JSON and JSON5', async () => {
  const source = await readFile(new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url), 'utf8');

  assert.match(source, /language="json5"/);
  assert.doesNotMatch(source, /quickDetectFormatAndSwitchLanguage/);
  assert.doesNotMatch(source, /setLanguage\(/);
});

test('async stats results are discarded after content or tab changes', async () => {
  const source = await readFile(new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url), 'utf8');

  assert.match(source, /const tabId = currentTab\.id;/);
  assert.match(source, /const source = content;/);
  assert.match(source, /sourceTab\.content !== source/);
  assert.match(source, /\$activeTab\?\.id !== tabId \|\| content !== source/);
});

test('large clipboard events do not repeat JSON formatting on the UI thread', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url),
    'utf8',
  );

  const formattedHandler = source.match(
    /unlistenFormatted = await listen<string>\('clipboard-formatted'[\s\S]*?\n      \}\);/,
  )?.[0] || '';
  assert.match(formattedHandler, /tabsStore\.addTab\(event\.payload\)/);
  assert.doesNotMatch(formattedHandler, /normalize|formatJsonText|openClipboardContentInNewTab/);
});

test('log JSON detection runs in a cancellable worker after debounce', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url),
    'utf8',
  );
  const workerClient = await readFile(
    new URL('../src/lib/services/logJsonWorker.js', import.meta.url),
    'utf8',
  );

  assert.match(source, /extractLogJsonFragmentsAsync/);
  assert.match(source, /cancelLogJsonDetection\(\)/);
  assert.match(source, /setTimeout\(async \(\) =>/);
  assert.match(workerClient, /createPersistentWorker\(/);
  assert.match(workerClient, /logJsonWorker\.run\(\{ content, options \}\)/);
  assert.match(workerClient, /task\?\.cancel\(\)/);
  assert.match(workerClient, /new Worker\(new URL\('\.\.\/workers\/logJson\.worker\.js'/);
});

test('editor paste formatting runs outside the UI thread and discards stale results', async () => {
  const editorSource = await readFile(
    new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url),
    'utf8',
  );
  const monacoSource = await readFile(
    new URL('../src/lib/components/editor/MonacoEditor.svelte', import.meta.url),
    'utf8',
  );
  const workerClient = await readFile(
    new URL('../src/lib/services/pasteFormatWorker.js', import.meta.url),
    'utf8',
  );

  assert.match(monacoSource, /editor\.onDidPaste/);
  assert.match(editorSource, /onPaste=\{handleEditorPaste\}/);
  assert.match(editorSource, /const tabId = sourceTab\.id/);
  assert.match(editorSource, /formatPastedJsonAsync\(sourceValue, tabSize\)/);
  assert.match(editorSource, /\$activeTab\?\.id !== tabId/);
  assert.match(editorSource, /currentSourceTab\?\.content !== sourceValue/);
  assert.match(editorSource, /tabsStore\.updateTabContent\(tabId, normalized\)/);
  assert.match(editorSource, /function syncActiveTab[\s\S]*?cancelPasteFormat\(\)/);
  assert.match(workerClient, /createPersistentWorker\(/);
  assert.match(workerClient, /pasteFormatWorker\.run\(\{ content, indent \}\)/);
  assert.match(workerClient, /task\?\.cancel\(\)/);
  assert.match(workerClient, /new Worker\(new URL\('\.\.\/workers\/pasteFormat\.worker\.js'/);
});

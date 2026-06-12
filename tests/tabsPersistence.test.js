import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/lib/stores/tabs.ts', import.meta.url),
  'utf8',
);
const documentStoreSource = readFileSync(
  new URL('../src/lib/stores/documentStore.ts', import.meta.url),
  'utf8',
);

test('tab persistence stores metadata without document content', () => {
  assert.doesNotMatch(source, /content: string;\s*\/\/ Editor content/);
  assert.match(source, /contentVersion: number;/);
  assert.match(source, /tabs: state\.tabs\.map\(tab => \(\{ \.\.\.tab \}\)\)/);
  assert.doesNotMatch(source, /tab\.content\.length/);
});

test('legacy persisted content is migrated to the document store', () => {
  assert.match(source, /const legacyContent = typeof \(tab as any\)\.content === 'string'/);
  assert.match(source, /setDocumentContent\(tab\.id, legacyContent\)/);
});

test('high-frequency content and tab switches persist only metadata to localStorage', () => {
  assert.match(source, /const PERSIST_DEBOUNCE_MS = 500;/);
  assert.match(source, /function scheduleSaveState\(state: TabsState\)/);
  assert.match(source, /updateTabContent:[\s\S]*?scheduleSaveState\(newState\)/);
  assert.match(source, /setDocumentContent\(tabId, content\)/);
  assert.match(source, /setActiveTab:[\s\S]*?scheduleSaveState\(newState\)/);
  assert.match(source, /flushPersistence: flushPendingPersistence/);
});

test('large document persistence is delayed outside the tab switch path', () => {
  assert.match(documentStoreSource, /const LARGE_DOCUMENT_THRESHOLD_BYTES = 512 \* 1024;/);
  assert.match(documentStoreSource, /const LARGE_DOCUMENT_PERSIST_DEBOUNCE_MS = 3_000;/);
  assert.match(documentStoreSource, /requestIdleCallback\(callback, \{ timeout: IDLE_PERSIST_TIMEOUT_MS \}\)/);
  assert.match(source, /flushDocumentPersistence\(\)/);
});

test('closing other tabs removes document content for discarded tabs', () => {
  assert.match(source, /const keepTabIds = new Set\(keepTabs\.map\(tab => tab\.id\)\)/);
  assert.match(source, /for \(const tab of state\.tabs\)[\s\S]*?removeDocumentContent\(tab\.id\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { openClipboardContentInNewTab } from '../src/lib/services/clipboardTabs.js';

test('opens formatted clipboard content in a new tab without updating the current tab', async () => {
  const calls = [];
  const tabsStore = {
    addTab(content) {
      calls.push(['addTab', content]);
    },
    updateTabContent(tabId, content) {
      calls.push(['updateTabContent', tabId, content]);
    },
  };

  const result = await openClipboardContentInNewTab('{"ok":true}', {
    tabsStore,
    normalize: async (value) => value.replace('true', 'false'),
  });

  assert.deepEqual(result, { content: '{"ok":false}' });
  assert.deepEqual(calls, [['addTab', '{"ok":false}']]);
});

test('falls back to the original clipboard payload when normalization returns null', async () => {
  const calls = [];

  const result = await openClipboardContentInNewTab('not json', {
    tabsStore: {
      addTab(content) {
        calls.push(['addTab', content]);
      },
    },
    normalize: async () => null,
  });

  assert.deepEqual(result, { content: 'not json' });
  assert.deepEqual(calls, [['addTab', 'not json']]);
});

test('returns normalized content after adding clipboard content to a new tab', async () => {
  const result = await openClipboardContentInNewTab('{"ok":true}', {
    tabsStore: {
      addTab() {
        return false;
      },
    },
    normalize: async (value) => value,
  });

  assert.deepEqual(result, { content: '{"ok":true}' });
});

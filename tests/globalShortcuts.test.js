import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { get } from 'svelte/store';

const STORAGE_KEY = 'jsonstudio_shortcuts';
let moduleId = 0;

async function createHarness(saved) {
  const storage = new Map();
  if (saved !== undefined) {
    storage.set(STORAGE_KEY, typeof saved === 'string' ? saved : JSON.stringify(saved));
  }
  const harness = {
    calls: [],
    active: [],
    handleUpdate: null,
    storageError: false,
    storage,
  };
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) {
      if (harness.storageError) {
        harness.storageError = false;
        throw new Error('Storage unavailable');
      }
      storage.set(key, String(value));
    },
  };
  globalThis.window = {
    __TAURI_INTERNALS__: {
      async invoke(command, args) {
        assert.equal(command, 'update_global_shortcuts');
        harness.calls.push(structuredClone(args.bindings));
        if (harness.handleUpdate) return harness.handleUpdate(args.bindings);
        harness.active = structuredClone(args.bindings);
        return { bindings: harness.active, error: null };
      },
    },
  };
  globalThis.isTauri = true;
  const module = await import(`../src/lib/stores/shortcuts.ts?test=${++moduleId}`);
  harness.store = module.shortcutsStore;
  harness.status = () => get(module.globalShortcutsState);
  harness.settings = () => get(module.shortcutsStore);
  harness.saved = () => JSON.parse(storage.get(STORAGE_KEY));
  return harness;
}

test('native handlers only run for key presses and startup does not register defaults', async () => {
  const [libSource, shortcutSource] = await Promise.all([
    readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/src/commands/shortcuts.rs', import.meta.url), 'utf8'),
  ]);
  const handlerCount = (shortcutSource.match(/\.on_shortcut\(/g) || []).length;
  const pressGuardCount = (
    shortcutSource.match(/event\.state != ShortcutState::Pressed/g) || []
  ).length;
  assert.equal(handlerCount, 2);
  assert.equal(pressGuardCount, handlerCount);
  assert.doesNotMatch(libSource, /register_global_shortcut\(/);
  assert.match(libSource, /update_global_shortcuts/);
  assert.match(shortcutSource, /#\[derive\(Default\)\][\s\S]*?bindings: Mutex<Vec/);
});

test('format clipboard delegates JSON normalization to the frontend worker', async () => {
  const source = await readFile(
    new URL('../src-tauri/src/commands/shortcuts.rs', import.meta.url),
    'utf8',
  );
  const handler = source.match(
    /pub async fn format_clipboard_and_show[\s\S]*?\n}\n\nfn ensure_window_in_front/,
  )?.[0] || '';
  assert.match(handler, /\.emit\("clipboard-content", clipboard_text\)/);
  assert.doesNotMatch(handler, /serde_json::from_str|serde_json::to_string_pretty/);
});

test('new and legacy settings default to enabled and retain custom bindings', async () => {
  for (const saved of [undefined, { showApp: { currentKey: 'Control+Alt+J' } }]) {
    const harness = await createHarness(saved);
    await harness.store.init();
    assert.equal(harness.status().enabled, true);
    assert.equal(harness.saved().globalShortcutsEnabled, true);
    assert.equal(harness.active.length, 2);
    if (saved) assert.equal(harness.active[0].key, 'Control+Alt+J');
  }
});

test('a saved opt-out never registers default or custom global hotkeys', async () => {
  const harness = await createHarness({
    globalShortcutsEnabled: false,
    showApp: { currentKey: 'Control+Alt+J' },
  });
  await harness.store.init();
  assert.deepEqual(harness.calls, [[]]);
  assert.equal(harness.status().enabled, false);
  assert.equal(harness.settings().showApp.currentKey, 'Control+Alt+J');
});

test('initialization is idempotent across multiple callers', async () => {
  const harness = await createHarness();
  const first = harness.store.init();
  assert.equal(harness.store.init(), first);
  await first;
  await harness.store.init();
  assert.equal(harness.calls.length, 1);
});

test('disabling releases both hotkeys and survives a restart without losing bindings', async () => {
  const harness = await createHarness({ showApp: { currentKey: 'Control+Alt+J' } });
  await harness.store.init();
  await harness.store.setGlobalShortcutsEnabled(false);
  assert.deepEqual(harness.active, []);
  assert.equal(harness.saved().globalShortcutsEnabled, false);
  const restarted = await createHarness(harness.saved());
  await restarted.store.init();
  assert.deepEqual(restarted.calls, [[]]);
  assert.equal(restarted.settings().showApp.currentKey, 'Control+Alt+J');
});

test('editing keys while disabled does not register them and enabling uses the latest keys', async () => {
  const harness = await createHarness({ globalShortcutsEnabled: false });
  await harness.store.init();
  await harness.store.updateShortcut('show_app', 'Control+Alt+J');
  assert.deepEqual(harness.active, []);
  assert.equal(harness.saved().showApp.currentKey, 'Control+Alt+J');
  assert.equal(harness.saved().globalShortcutsEnabled, false);
  await harness.store.setGlobalShortcutsEnabled(true);
  assert.equal(harness.active[0].key, 'Control+Alt+J');
  assert.equal(harness.active.length, 2);
});

test('single and bulk resets preserve the global opt-out', async () => {
  const harness = await createHarness({
    globalShortcutsEnabled: false,
    showApp: { currentKey: 'Control+Alt+J' },
    formatClipboard: { currentKey: 'Control+Alt+V' },
  });
  await harness.store.init();
  await harness.store.resetShortcut('show_app');
  assert.equal(harness.settings().showApp.currentKey, harness.settings().showApp.defaultKey);
  assert.equal(harness.status().enabled, false);
  await harness.store.reset();
  assert.equal(harness.settings().formatClipboard.currentKey, harness.settings().formatClipboard.defaultKey);
  assert.equal(harness.saved().globalShortcutsEnabled, false);
  assert(harness.calls.every(bindings => bindings.length === 0));
});

test('a failed enable leaves the switch off, preserves keys, and exposes the error', async () => {
  const harness = await createHarness({ globalShortcutsEnabled: false });
  await harness.store.init();
  harness.handleUpdate = () => ({ bindings: [], error: 'Shortcut already in use' });
  await harness.store.setGlobalShortcutsEnabled(true);
  assert.deepEqual(harness.status(), {
    enabled: false,
    pending: false,
    error: 'Shortcut already in use',
  });
  assert.equal(harness.saved().globalShortcutsEnabled, false);
});

test('a failed disable keeps the switch on and does not persist a false opt-out', async () => {
  const harness = await createHarness();
  await harness.store.init();
  harness.handleUpdate = () => ({ bindings: harness.active, error: 'Could not unregister' });
  await harness.store.setGlobalShortcutsEnabled(false);
  assert.equal(harness.status().enabled, true);
  assert.equal(harness.saved().globalShortcutsEnabled, true);
  assert.equal(harness.status().error, 'Could not unregister');
});

test('failed binding updates and resets do not overwrite the saved keys', async () => {
  const harness = await createHarness({ showApp: { currentKey: 'Control+Alt+J' } });
  await harness.store.init();
  harness.handleUpdate = () => ({ bindings: harness.active, error: 'Registration failed' });
  await harness.store.updateShortcut('show_app', 'Control+Alt+K');
  assert.equal(harness.saved().showApp.currentKey, 'Control+Alt+J');
  await harness.store.resetShortcut('show_app');
  assert.equal(harness.settings().showApp.currentKey, 'Control+Alt+J');
  await harness.store.reset();
  assert.equal(harness.saved().showApp.currentKey, 'Control+Alt+J');
});

test('queued edits and toggles read the latest state and persist in execution order', async () => {
  const harness = await createHarness();
  await harness.store.init();
  await Promise.all([
    harness.store.setGlobalShortcutsEnabled(false),
    harness.store.updateShortcut('show_app', 'Control+Alt+J'),
    harness.store.setGlobalShortcutsEnabled(true),
    harness.store.updateShortcut('format_clipboard', 'Control+Alt+V'),
  ]);
  assert.equal(harness.status().enabled, true);
  assert.equal(harness.saved().showApp.currentKey, 'Control+Alt+J');
  assert.equal(harness.saved().formatClipboard.currentKey, 'Control+Alt+V');
  assert.deepEqual(harness.calls.slice(1, 3), [[], []]);
  assert.deepEqual(harness.active, [
    { id: 'show_app', key: 'Control+Alt+J' },
    { id: 'format_clipboard', key: 'Control+Alt+V' },
  ]);
});

test('a pending native update does not optimistically change the switch', async () => {
  const harness = await createHarness();
  await harness.store.init();
  let finish;
  harness.handleUpdate = bindings => new Promise(resolve => {
    finish = () => {
      harness.active = bindings;
      resolve({ bindings, error: null });
    };
  });
  const operation = harness.store.setGlobalShortcutsEnabled(false);
  assert.equal(harness.status().pending, true);
  assert.equal(harness.status().enabled, true);
  await new Promise(resolve => setImmediate(resolve));
  finish();
  await operation;
  assert.equal(harness.status().pending, false);
  assert.equal(harness.status().enabled, false);
});

test('a rollback failure reflects remaining native bindings and can be retried', async () => {
  const harness = await createHarness({ globalShortcutsEnabled: false });
  await harness.store.init();
  harness.handleUpdate = bindings => ({
    bindings: bindings.slice(0, 1),
    error: 'Registration failed; rollback failed',
  });
  await harness.store.setGlobalShortcutsEnabled(true);
  assert.equal(harness.status().enabled, true);
  assert.equal(harness.saved().globalShortcutsEnabled, true);
  assert.match(harness.status().error, /rollback failed/);
  harness.handleUpdate = null;
  await harness.store.setGlobalShortcutsEnabled(false);
  assert.equal(harness.status().enabled, false);
  assert.equal(harness.status().error, null);
});

test('a persistence failure restores the previous native registration', async () => {
  const harness = await createHarness();
  await harness.store.init();
  harness.storageError = true;
  await harness.store.setGlobalShortcutsEnabled(false);
  assert.equal(harness.active.length, 2);
  assert.equal(harness.status().enabled, true);
  assert.equal(harness.saved().globalShortcutsEnabled, true);
  assert.equal(harness.status().error, 'Storage unavailable');
});

test('corrupt saved settings fail closed without overwriting the stored data', async () => {
  const harness = await createHarness('{invalid');
  await harness.store.init();
  assert.deepEqual(harness.calls, [[]]);
  assert.equal(harness.status().enabled, false);
  assert(harness.status().error);
  assert.equal(harness.storage.get(STORAGE_KEY), '{invalid');
});

test('app-local shortcuts are unaffected by the global opt-out', async () => {
  const harness = await createHarness({ globalShortcutsEnabled: false });
  await harness.store.init();
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  assert.equal(harness.store.matchShortcut({
    key: 's',
    code: 'KeyS',
    ctrlKey: !isMac,
    metaKey: isMac,
    shiftKey: false,
    altKey: false,
  }), 'save_file');
  await harness.store.updateShortcut('save_file', 'CommandOrControl+Alt+S');
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.saved().globalShortcutsEnabled, false);
});

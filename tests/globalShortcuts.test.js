import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('global shortcut handlers only run for key press events', async () => {
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
  assert.doesNotMatch(libSource, /\.on_shortcut\(/);
  assert.match(libSource, /register_global_shortcut/);
});

test('shortcut updates unregister the current binding and restore it on failure', async () => {
  const source = await readFile(
    new URL('../src-tauri/src/commands/shortcuts.rs', import.meta.url),
    'utf8',
  );

  assert.match(source, /let mut keys = registry[\s\S]*?\.keys[\s\S]*?\.lock\(\)/);
  assert.match(source, /let old_key = keys[\s\S]*?\.get\(&id\)/);
  assert.match(source, /if shortcuts\.is_registered\(old_key\.as_str\(\)\)/);
  assert.match(source, /shortcuts[\s\S]*?\.unregister\(old_key\.as_str\(\)\)/);
  assert.match(source, /register_global_shortcut\(&app, &id, &old_key\)/);
  assert.match(source, /failed to restore previous shortcut/);
  assert.match(source, /keys\.insert\(id, key\)/);
});

test('synchronizing an unchanged registered shortcut is a no-op', async () => {
  const source = await readFile(
    new URL('../src-tauri/src/commands/shortcuts.rs', import.meta.url),
    'utf8',
  );

  assert.match(source, /if old_key == key && shortcuts\.is_registered\(key\.as_str\(\)\)/);
  assert.match(source, /if old_key == key[\s\S]*?return Ok\(\(\)\)/);
});

test('saved global shortcuts are synchronized when the frontend starts', async () => {
  const source = await readFile(
    new URL('../src/lib/stores/shortcuts.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /void syncGlobalShortcuts\(current\)/);
  assert.match(source, /if \(shortcut\.isGlobal\)/);
  assert.match(
    source,
    /invokeGlobalShortcutUpdate\(shortcut\.id, shortcut\.currentKey\)/,
  );
  assert.match(source, /Failed to initialize global shortcut \$\{shortcut\.id\}/);
});

test('global shortcut settings are persisted only after backend registration succeeds', async () => {
  const source = await readFile(
    new URL('../src/lib/stores/shortcuts.ts', import.meta.url),
    'utf8',
  );

  const updateHandler = source.match(
    /updateShortcut: async[\s\S]*?\n    \},\n    resetShortcut:/,
  )?.[0] || '';
  const resetHandler = source.match(
    /resetShortcut: async[\s\S]*?\n    \},\n    reset:/,
  )?.[0] || '';

  assert.match(updateHandler, /await invokeGlobalShortcutUpdate\(id, key\)/);
  assert.match(updateHandler, /updateStoredShortcut\(id, key\)/);
  assert.ok(
    updateHandler.indexOf('await invokeGlobalShortcutUpdate(id, key)') <
      updateHandler.indexOf('updateStoredShortcut(id, key)'),
  );

  assert.match(resetHandler, /await invokeGlobalShortcutUpdate\(id, shortcut\.defaultKey\)/);
  assert.match(resetHandler, /updateStoredShortcut\(id, shortcut\.defaultKey\)/);
  assert.ok(
    resetHandler.indexOf('await invokeGlobalShortcutUpdate(id, shortcut.defaultKey)') <
      resetHandler.indexOf('updateStoredShortcut(id, shortcut.defaultKey)'),
  );

  const resetAllHandler = source.match(
    /reset: async[\s\S]*?\n    \},\n    matchShortcut/,
  )?.[0] || '';
  assert.match(
    resetAllHandler,
    /nextState\[k\]\.currentKey = get\(\{ subscribe \}\)\[k\]\.currentKey/,
  );
  assert.match(resetAllHandler, /set\(nextState\)/);
});

test('frontend global shortcut updates are serialized in call order', async () => {
  const source = await readFile(
    new URL('../src/lib/stores/shortcuts.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /let globalShortcutUpdateQueue: Promise<void> = Promise\.resolve\(\)/);
  assert.match(source, /globalShortcutUpdateQueue\.then\(async \(\) =>/);
  assert.match(source, /globalShortcutUpdateQueue = operation\.catch\(\(\) => \{\}\)/);
});

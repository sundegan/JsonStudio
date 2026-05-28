import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('export image toolbar saves PNG bytes to a selected file location', async () => {
  const source = await readFile(
    new URL('../src/lib/components/editor/JsonEditorToolbar.svelte', import.meta.url),
    'utf8',
  );
  const handlerBody = source.match(/async function handleExportImage\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(source, /saveBinaryFileDialog/);
  assert.match(source, /pngBase64ToBytes/);
  assert.match(source, /json-export\.png/);
  assert.match(handlerBody, /saveBinaryFileDialog\(pngBytes,\s*fileName,\s*'png'\)/);
  assert.match(handlerBody, /toolbar\.exportImageSaved/);
  assert.doesNotMatch(handlerBody, /copyImageToClipboard/);
  assert.doesNotMatch(handlerBody, /toolbar\.exportImageCopied/);
});

test('export image service exposes PNG base64 to byte conversion', async () => {
  const source = await readFile(
    new URL('../src/lib/services/exportImage.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /export function pngBase64ToBytes/);
  assert.match(source, /Uint8Array/);
});

test('export image no longer registers image clipboard backend code', async () => {
  const commandName = ['copy', 'image', 'to', 'clipboard'].join('_');
  const clipboardModule = ['pub mod', 'clipboard'].join(' ');
  const writeImagePermission = ['clipboard-manager', 'allow-write-image'].join(':');
  const [libSource, commandsSource, capabilitySource] = await Promise.all([
    readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/src/commands/mod.rs', import.meta.url), 'utf8'),
    readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
  ]);

  assert.equal(libSource.includes(commandName), false);
  assert.equal(commandsSource.includes(clipboardModule), false);
  assert.equal(capabilitySource.includes(writeImagePermission), false);
});

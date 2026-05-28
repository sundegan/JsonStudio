import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readIcoSizes(path) {
  const bytes = readFileSync(path);
  const type = bytes.readUInt16LE(2);
  const count = bytes.readUInt16LE(4);

  assert.equal(type, 1);

  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = bytes[offset] || 256;
    const height = bytes[offset + 1] || 256;
    sizes.push(`${width}x${height}`);
  }

  return sizes;
}

test('Windows icon includes sizes used by Explorer and the taskbar', () => {
  const sizes = readIcoSizes(new URL('../src-tauri/icons/icon.ico', import.meta.url));

  assert.deepEqual(sizes, ['16x16', '24x24', '32x32', '48x48', '64x64', '128x128', '256x256']);
});

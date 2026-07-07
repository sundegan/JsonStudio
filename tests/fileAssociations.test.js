import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tauriConfig = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);
const libRs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const fileCommandsRs = readFileSync(
  new URL('../src-tauri/src/commands/file.rs', import.meta.url),
  'utf8',
);
const jsonFileExtensions = [
  'json',
  'json5',
  'jsonl',
  'ndjson',
  'jsonc',
  'geojson',
  'topojson',
  'har',
  'webmanifest',
  'ipynb',
  'sarif',
];

test('tauri associates JSON family file extensions with the app', () => {
  const jsonAssociation = tauriConfig.bundle.fileAssociations.find((association) =>
    association.ext.includes('json'),
  );

  assert.ok(jsonAssociation);
  assert.deepEqual(jsonAssociation.ext, jsonFileExtensions);
  assert.equal(jsonAssociation.role, 'Editor');
  assert.equal(jsonAssociation.rank, 'Owner');
});

test('native file opening accepts the associated JSON family extensions', () => {
  for (const extension of jsonFileExtensions) {
    assert.match(fileCommandsRs, new RegExp(`"${extension}"`));
  }
  assert.match(libRs, /JSON_FILE_EXTENSIONS/);
  assert.doesNotMatch(libRs, /SUPPORTED_JSON_EXTENSIONS/);
  assert.match(fileCommandsRs, /pub\(crate\) const JSON_FILE_EXTENSIONS/);
  assert.match(fileCommandsRs, /\.add_filter\("JSON Files", JSON_FILE_EXTENSIONS\)/);
});

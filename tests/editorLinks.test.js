import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getJsonStringUrlAtColumn, isOpenableUrl } from '../src/lib/services/editorLinks.js';

test('recognizes http and https urls only', () => {
  assert.equal(isOpenableUrl('https://example.com/a?b=1'), true);
  assert.equal(isOpenableUrl('http://example.com'), true);
  assert.equal(isOpenableUrl('  https://example.com  '), true);
  assert.equal(isOpenableUrl('ftp://example.com'), false);
  assert.equal(isOpenableUrl('hello https://example.com'), false);
});

test('extracts a clickable url from a JSON string value at the clicked column', () => {
  const line = '  "site": "https://example.com/docs?q=1",';

  assert.equal(getJsonStringUrlAtColumn(line, line.indexOf('example') + 1), 'https://example.com/docs?q=1');
  assert.equal(getJsonStringUrlAtColumn(line, line.indexOf('site') + 1), null);
});

test('trims whitespace around extracted urls', () => {
  const line = '  "site": "  https://example.com/docs  ",';

  assert.equal(getJsonStringUrlAtColumn(line, line.indexOf('example') + 1), 'https://example.com/docs');
});

test('extracts escaped urls without including JSON quotes', () => {
  const line = '  "site": "https:\\/\\/example.com\\/docs",';

  assert.equal(getJsonStringUrlAtColumn(line, line.indexOf('example') + 1), 'https://example.com/docs');
});

test('ignores non-url JSON strings', () => {
  const line = '  "message": "visit docs later",';

  assert.equal(getJsonStringUrlAtColumn(line, line.indexOf('docs') + 1), null);
});

test('monaco editor opens clicked JSON string urls with the Tauri opener only on command or control click', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/MonacoEditor.svelte', import.meta.url),
    'utf8',
  );

  assert.match(source, /import \{ openUrl \} from '@tauri-apps\/plugin-opener';/);
  assert.match(source, /getJsonStringUrlAtColumn/);
  assert.match(source, /editor\.onMouseDown/);
  assert.match(source, /browserEvent\.metaKey/);
  assert.match(source, /browserEvent\.ctrlKey/);
  assert.match(source, /await openUrl\(url\)/);
  assert.match(source, /window\.open\(url, '_blank'\)/);
});

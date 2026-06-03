import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/lib/stores/tabs.ts', import.meta.url),
  'utf8',
);

test('tab persistence clears stats when saved content is empty', () => {
  assert.match(source, /function getStatsForPersistedContent\(content: string, stats: JsonStats \| undefined\): JsonStats/);
  assert.match(source, /return content\.trim\(\) \? \(stats \?\? createEmptyStats\(\)\) : createEmptyStats\(\);/);
  assert.match(source, /stats: getStatsForPersistedContent\(content, tab\.stats\)/);
});

test('tab persistence clears stats when oversized content is omitted from localStorage', () => {
  assert.match(source, /const MAX_PERSISTED_CONTENT_SIZE = 1024 \* 1024;/);
  assert.match(source, /const content = tab\.content\.length > MAX_PERSISTED_CONTENT_SIZE \? '' : tab\.content;/);
  assert.match(source, /stats: getStatsForPersistedContent\(content, tab\.stats\)/);
});

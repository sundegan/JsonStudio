import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('editor no longer exposes JSON auto-repair prompts or actions', () => {
  const source = readFileSync(
    new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(source, /jsonrepair/);
  assert.doesNotMatch(source, /function\s+fixJson\b/);
  assert.doesNotMatch(source, /json-fix-bar/);
  assert.doesNotMatch(source, /fixJson\./);
});

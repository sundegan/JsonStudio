import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const components = new URL('../src/lib/components/editor/', import.meta.url);

test('diff mode exposes the shared toolbar for the active editor side', async () => {
  const [diffEditor, editor, toolbar] = await Promise.all([
    readFile(new URL('MonacoDiffEditor.svelte', components), 'utf8'),
    readFile(new URL('JsonEditor.svelte', components), 'utf8'),
    readFile(new URL('JsonEditorToolbar.svelte', components), 'utf8'),
  ]);

  assert.match(diffEditor, /type DiffSide = 'original' \| 'modified'/);
  assert.match(diffEditor, /originalEditor\.onMouseDown\(\(\) => setActiveSide\('original'\)\)/);
  assert.match(diffEditor, /modifiedEditor\.onMouseDown\(\(\) => setActiveSide\('modified'\)\)/);
  assert.match(diffEditor, /onDidFocusEditorText\(\(\) => setActiveSide/);
  assert.match(diffEditor, /originalEditor\.onDidLayoutChange\(\(\{ width \}\) =>/);
  assert.match(diffEditor, /if \(destroyed \|\| !container\.isConnected\) return;/);
  assert.match(diffEditor, /destroyed \|\|\s*model\.isDisposed\(\)/);
  assert.match(diffEditor, /export function getValue\(\)/);
  assert.match(diffEditor, /export function setValue\(value: string\)/);
  assert.match(diffEditor, /export function foldAll\(\)/);
  assert.match(diffEditor, /export function unfoldAll\(\)/);
  assert.match(diffEditor, /export function getEditorInstance\(\)/);
  assert.match(diffEditor, /class="diff-pane-header"/);
  assert.match(diffEditor, /class="diff-back-btn"/);
  assert.match(diffEditor, /class="diff-pane-badge">JSON A<\/span>/);
  assert.match(diffEditor, /class="diff-pane-badge">JSON B<\/span>/);
  assert.match(diffEditor, /flex: 0 0 40px/);
  assert.doesNotMatch(diffEditor, /diff-side-label/);
  assert.doesNotMatch(diffEditor, /\$t\('diff\.(original|modified)'\)/);

  assert.match(editor, /isDiffMode\s*\? activeDiffSide === 'original' \? diffOriginal : diffModified/);
  assert.match(editor, /isDiffMode\s*\? diffEditor/);
  assert.match(editor, /bind:this=\{diffEditor\}/);
  assert.match(editor, /onActiveSideChange=\{handleDiffActiveSideChange\}/);
  assert.match(editor, /onExit=\{toggleDiffMode\}/);
  assert.match(editor, /if \(isDiffMode\) \{[\s\S]*?diffOriginal = value;[\s\S]*?diffModified = value;[\s\S]*?return;/);
  assert.match(editor, /const value = diffOriginal;[\s\S]*?updateDiffStatsForSide\('left', value\)/);
  assert.match(editor, /const value = diffModified;[\s\S]*?updateDiffStatsForSide\('right', value\)/);
  assert.match(editor, /return \(\) => clearTimeout\(timer\)/);

  assert.doesNotMatch(toolbar, /Diff mode: only show exit button/);
  assert.match(toolbar, /let isSubPageMode = \$derived\(isDiffMode \|\| isConvertMode \|\| isCodegenMode \|\| isSchemaMode\)/);
  assert.match(toolbar, /type JsonOperationContext =/);
  assert.match(toolbar, /jsonEditor\?\.getEditorInstance\(\) \?\? null\) !== context\.editor/);
  assert.match(toolbar, /context\.editor\.getValue\(\) === context\.content/);
  assert.match(toolbar, /setJsonContentValue\(formatted, operation\)/);
  assert.match(toolbar, /isDiffMode \? \$t\('toolbar\.exitDiff'\) : \$t\('toolbar\.diff'\)/);
  assert.match(toolbar, /disabled=\{isDiffMode \|\| isCodegenMode \|\| isSchemaMode\}/);
  assert.match(toolbar, /disabled=\{isDiffMode \|\| isConvertMode \|\| isSchemaMode\}/);
  assert.match(toolbar, /disabled=\{isDiffMode \|\| isConvertMode \|\| isCodegenMode\}/);
});

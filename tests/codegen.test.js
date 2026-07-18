import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CODEGEN_LANGUAGES, generateCode, supportsReverse } from '../src/lib/services/codegen.ts';

const SAMPLE_JSON = JSON.stringify({
  userId: 1,
  displayName: 'Ada',
  active: true,
  tags: ['math'],
  profile: { score: 1.5 },
});

test('quicktype generates a structure for every configured frontend language', async () => {
  const quicktypeLanguages = CODEGEN_LANGUAGES.filter(
    ({ id }) => id !== 'protobuf' && id !== 'thrift',
  );

  for (const { id } of quicktypeLanguages) {
    const generated = await generateCode(SAMPLE_JSON, id, 'UserProfile');
    assert.ok(generated.trim().length > 0, `${id} generated no code`);
  }
});

test('every configured Codegen language supports reverse conversion', () => {
  const unsupported = CODEGEN_LANGUAGES
    .map(({ id }) => id)
    .filter((language) => !supportsReverse(language));

  assert.deepEqual(unsupported, []);
});

test('PHP treats date-only strings as string fields', async () => {
  const generated = await generateCode(
    JSON.stringify({ created_at: '2026-07-13' }),
    'php',
    'UserProfile',
  );

  assert.match(generated, /private string \$createdAt;/);
});

test('PHP keeps date-time strings mapped to DateTime', async () => {
  const generated = await generateCode(
    JSON.stringify({ created_at: '2026-07-13T00:00:00Z' }),
    'php',
    'UserProfile',
  );

  assert.match(generated, /private DateTime \$createdAt;/);
});

test('tool sub-pages keep edits local to their active editor', async () => {
  const [codegenView, convertView, toolbar, editor, cargoConfig] = await Promise.all([
    readFile(new URL('../src/lib/components/editor/CodeGenView.svelte', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/components/editor/ConvertView.svelte', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/components/editor/JsonEditorToolbar.svelte', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/components/editor/JsonEditor.svelte', import.meta.url), 'utf8'),
    readFile(new URL('../.cargo/config.toml', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(codegenView, /cg-naming-toggle|fieldNaming|toggleFieldNaming/);
  assert.match(codegenView, /onJsonContentChange\(rightEditor\?\.getValue\(\) \|\| ''\)/);
  assert.match(convertView, /onJsonContentChange\(rightEditor!\.getValue\(\)\)/);
  assert.match(convertView, /onJsonOutputActiveChange\(direction === 'fmt2json'\)/);
  assert.match(codegenView, /folding: true/);
  assert.match(codegenView, /foldingStrategy: 'indentation'/);
  assert.match(codegenView, /glyphMargin: true/);
  assert.match(codegenView, /showFoldingControls: 'always'/);
  assert.match(codegenView, /getAction\('editor\.foldAll'\)\?\.run\(\)/);
  assert.match(codegenView, /getAction\('editor\.unfoldAll'\)\?\.run\(\)/);
  assert.match(codegenView, /onEditorReady\(\)/);
  assert.match(toolbar, /jsonContent/);
  assert.match(toolbar, /jsonEditor\?\.setValue\(value\)/);
  assert.match(toolbar, /foldEditor\?\.foldAll\(\)/);
  assert.match(toolbar, /foldEditor\?\.unfoldAll\(\)/);
  assert.match(toolbar, /canUseJsonTools/);
  assert.match(toolbar, /let isSubPageMode = \$derived\(isDiffMode \|\| isConvertMode \|\| isCodegenMode \|\| isSchemaMode\)/);
  assert.match(toolbar, /disabled=\{isProcessing \|\| !canUseJsonTools\}\s+aria-label=\{\$t\('toolbar\.keyNamingTooltip'\)\}/);
  assert.match(toolbar, /disabled=\{isSubPageMode\}/);
  assert.match(toolbar, /if \(isSubPageMode\) return;/);
  assert.match(editor, /jsonContent=\{jsonToolContent\}/);
  assert.match(editor, /jsonEditor=\{jsonToolEditor\}/);
  assert.match(editor, /foldEditor=\{foldEditor\}/);
  assert.match(editor, /onEditorReady=\{handleCodegenEditorReady\}/);
  assert.match(editor, /let codegenInputContent = \$state\(''\)/);
  assert.match(editor, /let convertInputContent = \$state\(''\)/);
  assert.match(editor, /let isConvertJsonOutputActive = \$state\(false\)/);
  assert.match(editor, /let schemaInputContent = \$state\(''\)/);
  assert.match(editor, /inputValue=\{convertInputContent\}/);
  assert.match(editor, /inputValue=\{codegenInputContent\}/);
  assert.match(editor, /inputValue=\{schemaInputContent\}/);
  assert.match(editor, /function getSubPageInputContent\(\)/);
  assert.match(editor, /isConvertMode && isConvertJsonOutputActive/);
  assert.doesNotMatch(editor, /tabsStore\.updateTabContent\(currentTab\.id, reverseOutput\)/);
  assert.doesNotMatch(editor, /originalJson5Content/);
  assert.match(cargoConfig, /TSLP_LINK_MODE = "static"/);
  assert.match(cargoConfig, /TSLP_LANGUAGES =/);
});

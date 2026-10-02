import test from 'node:test';
import assert from 'node:assert/strict';
import { getJson5FoldingRanges } from '../src/lib/services/json5Folding.js';
import { parseJsonDocument } from '../src/lib/services/jsonDocumentParse.js';

function foldingRanges(content) {
  const lines = content.split(/\r\n|\r|\n/);
  return getJson5FoldingRanges({
    getLineCount: () => lines.length,
    getLineContent: (lineNumber) => lines[lineNumber - 1],
  }).sort((a, b) => a.start - b.start || b.end - a.end);
}

test('folds the full root object in issue #79, including trailing properties', () => {
  const content = `{
  "source": "test.docx",
  "entities": 414,
  "entity_labels": {
    "labelA": 1,
    "labelB": 2
  },
  "ner_method": "llm",
  "rel_method": "llm"
}`;

  assert.equal(parseJsonDocument(content).data.rel_method, 'llm');
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 10 },
    { start: 4, end: 7 },
  ]);
});

test('matches nested objects without relying on indentation', () => {
  const content = ['{', '"outer":{', '"value":1', '},', '"last":true', '}'].join('\n');

  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 6 },
    { start: 2, end: 4 },
  ]);
});

test('ignores braces in strings and both kinds of JSON5 comments', () => {
  const content = [
    '[',
    '  {',
    '    text: "braces { [ } ] and //",',
    "    other: 'quoted \\' } still text',",
    '    // } ] [',
    '    /* [ {',
    '       } ] */',
    '    values: [',
    '      1,',
    '      2',
    '    ]',
    '  }',
    ']',
  ].join('\n');

  assert.equal(parseJsonDocument(content).dialect, 'JSON5');
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 13 },
    { start: 2, end: 12 },
    { start: 8, end: 11 },
  ]);
});

test('consumes line continuations without escaping the next line', () => {
  const content = [
    '{',
    "  text: 'foo\\",
    "\\'bar',",
    '  nested: {',
    '    value: 1',
    '  }',
    '}',
  ].join('\n');

  assert.equal(parseJsonDocument(content).data.text, "foo'bar");
  for (const source of [content, content.replaceAll('\n', '\r\n')]) {
    assert.deepEqual(foldingRanges(source), [
      { start: 1, end: 7 },
      { start: 4, end: 6 },
    ]);
  }
});

test('ends line comments at Unicode line terminators within a Monaco line', () => {
  for (const terminator of ['\u2028', '\u2029']) {
    const content = [
      '{',
      `  // ignored } ${terminator} nested: {`,
      '    value: 1',
      '  },',
      '  tail: 2',
      '}',
    ].join('\n');

    assert.equal(parseJsonDocument(content).data.nested.value, 1);
    assert.deepEqual(foldingRanges(content), [
      { start: 1, end: 6 },
      { start: 2, end: 4 },
    ]);
  }
});

test('does not treat Unicode line terminators inside strings as comments', () => {
  const content = [
    '{',
    "  text: 'ignored }\u2028 // [ \u2029',",
    '  nested: {',
    '    value: 1',
    '  }',
    '}',
  ].join('\n');

  assert.equal(parseJsonDocument(content).data.nested.value, 1);
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 6 },
    { start: 3, end: 5 },
  ]);
});

test('recovers after an unterminated string on a hard line break', () => {
  const content = [
    '{',
    '  text: "unfinished',
    '  nested: {',
    '    value: 1',
    '  }',
    '}',
  ].join('\n');

  assert.throws(() => parseJsonDocument(content), SyntaxError);
  assert.deepEqual(foldingRanges(content), [
    { start: 1, end: 6 },
    { start: 3, end: 5 },
  ]);
});

test('does not close a parent using a mismatched nested delimiter', () => {
  assert.deepEqual(foldingRanges('{\n  array: [\n  }\n}'), []);
  assert.deepEqual(foldingRanges('{"nested": {"value": 1}}'), []);
});

test('scans deeply nested arrays without recursive traversal', () => {
  const depth = 1500;
  const content = `${Array(depth).fill('[').join('\n')}\n0\n${Array(depth).fill(']').join('\n')}`;
  const ranges = foldingRanges(content);

  assert.equal(ranges.length, depth);
  assert.deepEqual(ranges[0], { start: 1, end: depth * 2 + 1 });
});

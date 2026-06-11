import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonDocument } from '../src/lib/services/jsonDocumentParse.js';

test('parses standard JSON documents', () => {
  const parsed = parseJsonDocument('{"name":"Alice"}');

  assert.deepEqual(parsed.data, { name: 'Alice' });
  assert.equal(parsed.dialect, 'JSON');
  assert.equal('sourceModel' in parsed, false);
});

test('auto-detects valid JSON5 documents in one parse', () => {
  const parsed = parseJsonDocument(`{
    // comment
    userId: 42,
    name: 'Alice',
  }`);

  assert.deepEqual(parsed.data, { userId: 42, name: 'Alice' });
  assert.equal(parsed.dialect, 'JSON5');
});

test('parses JSON5 syntax and source ranges with the source model parser', () => {
  const parsed = parseJsonDocument(`\ufeff{
    // supported JSON5 forms
    unquoted: 'value',
    numbers: [.5, 1., +2, -0x10, Infinity, NaN],
  }`);

  assert.equal(parsed.dialect, 'JSON5');
  assert.equal(parsed.data.unquoted, 'value');
  assert.deepEqual(parsed.data.numbers.slice(0, 5), [0.5, 1, 2, -16, Infinity]);
  assert.equal(Number.isNaN(parsed.data.numbers[5]), true);
  assert.equal(parsed.pointers['/unquoted'].keyStart, 36);
  assert.equal(parsed.pointers['/unquoted'].valueStart, 46);
});

test('keeps strict validation while automatically accepting JSON5 syntax', () => {
  assert.equal(parseJsonDocument('{"value": 1}').dialect, 'JSON');
  assert.equal(parseJsonDocument('{"value": 1,}').dialect, 'JSON5');
  assert.throws(() => parseJsonDocument('{"value": 01}'), SyntaxError);
  assert.equal(parseJsonDocument('{"value": "\\x41"}').data.value, 'A');
  assert.equal(parseJsonDocument('{value: "\\q"}').data.value, 'q');
  assert.throws(() => parseJsonDocument('{value: "\\1"}'), SyntaxError);
  assert.throws(() => parseJsonDocument('{value: .}'), SyntaxError);
  assert.equal(parseJsonDocument("{value: 'raw\ttab'}").data.value, 'raw\ttab');
});

test('detects a document-level trailing comma without reparsing preceding JSON', () => {
  const parsed = parseJsonDocument('[{"id":1},{"id":2},]');

  assert.equal(parsed.dialect, 'JSON5');
  assert.deepEqual(parsed.data, [{ id: 1 }, { id: 2 }]);
  assert.equal(parsed.pointers['/1/id'].valueStart, 16);
});

test('decodes JSON and JSON5 string escapes without losing source offsets', () => {
  const parsed = parseJsonDocument(`{key: "\\v\\x41\\0", continued: 'a\\
b'}`);

  assert.equal(parsed.data.key, '\vA\0');
  assert.equal(parsed.data.continued, 'ab');
  assert.equal(parsed.pointers['/continued'].valueStart, 29);
  assert.equal(parsed.pointers['/continued'].valueEnd, 35);
});

test('accepts JSON line-separator characters that JSON5 treats as line terminators', () => {
  const parsed = parseJsonDocument('{"value":"a\u2028b\u2029c"}');
  const json5 = parseJsonDocument("{value:'a\u2028b\u2029c'}");

  assert.equal(parsed.dialect, 'JSON');
  assert.equal(parsed.data.value, 'a\u2028b\u2029c');
  assert.equal(json5.dialect, 'JSON5');
  assert.equal(json5.data.value, 'a\u2028b\u2029c');
});

test('creates own properties for prototype-sensitive keys', () => {
  const parsed = parseJsonDocument('{"__proto__":{"polluted":true},"constructor":1}');

  assert.equal(Object.hasOwn(parsed.data, '__proto__'), true);
  assert.deepEqual(parsed.data.__proto__, { polluted: true });
  assert.equal(parsed.data.constructor, 1);
});

test('preserves source-map offsets for documents with leading whitespace', () => {
  const parsed = parseJsonDocument(`
  {
    "a": 1
  }`);

  assert.equal(parsed.pointers['/a'].keyStart, 9);
});

test('includes a source model for standard JSON duplicate keys', () => {
  const parsed = parseJsonDocument('{"meta":{"count":1},"meta":{"count":2}}');

  assert.equal(parsed.sourceModel.kind, 'object');
  assert.equal(parsed.sourceModel.hasDuplicateKeys, true);
  assert.deepEqual(parsed.sourceModel.entries.map((entry) => entry.key), ['meta', 'meta']);
});

test('retains the source model when duplicate keys are nested', () => {
  const parsed = parseJsonDocument('{"outer":{"value":1,"value":2}}');

  assert.equal('sourceModel' in parsed, true);
  assert.equal(parsed.sourceModel.hasDuplicateKeys, true);
  assert.deepEqual(
    parsed.sourceModel.entries[0].value.entries.map((entry) => entry.key),
    ['value', 'value'],
  );
});

test('maps duplicate object keys to distinct source pointer ranges', () => {
  const parsed = parseJsonDocument('{"meta":{"count":1},"meta":{"count":2}}');

  assert.deepEqual(
    [parsed.pointers['/meta'].valueStart, parsed.pointers['/meta~2'].valueStart],
    [8, 27],
  );
});

test('keeps duplicate source paths distinct from real keys with numeric suffixes', () => {
  const parsed = parseJsonDocument('{"key":1,"key":2,"key#2":3,"key~2":4}');

  assert.deepEqual(
    [
      parsed.pointers['/key'].valueStart,
      parsed.pointers['/key~2'].valueStart,
      parsed.pointers['/key#2'].valueStart,
      parsed.pointers['/key~02'].valueStart,
    ],
    [7, 15, 25, 35],
  );
});

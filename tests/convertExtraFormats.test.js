import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMarkdownTable, formatProperties, parseMarkdownTable, parseProperties } from '../src/lib/services/convertExtraFormats.js';

test('converts Properties and INI configuration text', () => {
  assert.deepEqual(parseProperties('host=localhost\nport=8080'), { host: 'localhost', port: 8080 });
  assert.deepEqual(parseProperties('[server]\nhost=localhost', { ini: true }), { server: { host: 'localhost' } });
  assert.equal(formatProperties({ server: { host: 'localhost' } }, { ini: true }), '[server]\nhost=localhost');
  assert.deepEqual(parseProperties('db.host=localhost\ndb.port=5432'), { db: { host: 'localhost', port: 5432 } });
  assert.throws(() => parseProperties('host=localhost\ninvalid line'));
});

test('round-trips single-entry Properties and flat INI documents', () => {
  const properties = formatProperties({ host: 'localhost' });
  const ini = formatProperties({ host: 'localhost', port: 8080 }, { ini: true });

  assert.deepEqual(parseProperties(properties), { host: 'localhost' });
  assert.deepEqual(parseProperties(ini, { ini: true }), { host: 'localhost', port: 8080 });
});

test('preserves ambiguous Properties strings as strings', () => {
  const source = {
    empty: '',
    booleanText: 'true',
    numberText: '42',
    nullText: 'null',
    padded: ' Alice ',
  };

  assert.deepEqual(parseProperties(formatProperties(source)), source);
});

test('preserves prototype-sensitive Properties keys', () => {
  const source = JSON.parse('{"__proto__":"safe","constructor":"value"}');

  assert.deepEqual(parseProperties(formatProperties(source)), source);
});

test('rejects non-scalar Properties and INI values instead of stringifying them', () => {
  assert.throws(() => formatProperties({ profile: { enabled: true } }), /scalar/);
  assert.throws(() => formatProperties({ values: [1, 2] }, { ini: true }), /scalar/);
  assert.throws(() => formatProperties({ 'invalid key': 'value' }), /key/);
  assert.throws(() => formatProperties({ multiline: 'line 1\nline 2' }), /line breaks/);
});

test('converts Markdown tables', () => {
  const source = '| id | name |\n| --- | --- |\n| 1 | Alice |';
  assert.deepEqual(parseMarkdownTable(source), [{ id: 1, name: 'Alice' }]);
  assert.equal(formatMarkdownTable([{ id: 1, name: 'Alice' }]), source);
  assert.throws(() => formatMarkdownTable({}), /at least one column/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_UNTITLED_NAME,
  getNextUntitledName,
  getSaveFileName,
} from '../src/lib/stores/untitledTabs.js';

test('first untitled tab starts at Untitled-1', () => {
  assert.equal(FIRST_UNTITLED_NAME, 'Untitled-1');
  assert.equal(getNextUntitledName([]), 'Untitled-1');
});

test('new untitled tabs use the next available number', () => {
  const tabs = [
    { filePath: null, fileName: 'Untitled-1' },
    { filePath: null, fileName: 'Untitled-2' },
  ];

  assert.equal(getNextUntitledName(tabs), 'Untitled-3');
});

test('closed untitled tab numbers are reused', () => {
  const tabs = [
    { filePath: null, fileName: 'Untitled-1' },
    { filePath: null, fileName: 'Untitled-3' },
  ];

  assert.equal(getNextUntitledName(tabs), 'Untitled-2');
});

test('saved files do not reserve untitled numbers', () => {
  const tabs = [
    { filePath: '/tmp/Untitled-1.json', fileName: 'Untitled-1' },
    { filePath: null, fileName: 'Untitled-2' },
  ];

  assert.equal(getNextUntitledName(tabs), 'Untitled-1');
});

test('legacy Untitled tab is treated as Untitled-1', () => {
  const tabs = [
    { filePath: null, fileName: 'Untitled' },
  ];

  assert.equal(getNextUntitledName(tabs), 'Untitled-2');
});

test('save filenames reuse the current tab name with a json extension', () => {
  assert.equal(getSaveFileName('Untitled-2'), 'Untitled-2.json');
  assert.equal(getSaveFileName('sample.json'), 'sample.json');
  assert.equal(getSaveFileName(null), 'untitled.json');
});

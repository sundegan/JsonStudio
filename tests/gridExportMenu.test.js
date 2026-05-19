import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCloseGridExportMenu } from '../src/lib/services/gridExportMenu.js';

test('keeps export menu open when clicking inside the export control', () => {
  assert.equal(
    shouldCloseGridExportMenu({
      closest: (selector) => selector === '.gv-export',
    }),
    false,
  );
});

test('closes export menu when clicking outside the export control', () => {
  assert.equal(shouldCloseGridExportMenu({ closest: () => null }), true);
  assert.equal(shouldCloseGridExportMenu(null), true);
});

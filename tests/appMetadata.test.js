import assert from 'node:assert/strict';
import test from 'node:test';

import { formatAppVersion } from '../src/lib/services/appMetadata.js';

test('app versions use one lowercase v prefix', () => {
  assert.equal(formatAppVersion('1.2.1'), 'v1.2.1');
  assert.equal(formatAppVersion('v1.2.1'), 'v1.2.1');
  assert.equal(formatAppVersion('V1.2.1'), 'v1.2.1');
  assert.equal(formatAppVersion(' 9.9.9-dev '), 'v9.9.9-dev');
  assert.equal(formatAppVersion('', 'Unknown version'), 'Unknown version');
});

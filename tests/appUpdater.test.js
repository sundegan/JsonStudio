import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialUpdaterState,
  checkForAppUpdate,
  installAppUpdate,
} from '../src/lib/services/appUpdater.js';

test('creates initial updater state with the current app version', () => {
  assert.deepEqual(createInitialUpdaterState('1.2.1'), {
    currentVersion: '1.2.1',
    status: 'idle',
    update: null,
    messageKey: 'settings.updateReady',
    error: null,
  });
});

test('reports when no update is available', async () => {
  const state = await checkForAppUpdate(createInitialUpdaterState('1.2.1'), {
    check: async () => null,
  });

  assert.equal(state.status, 'idle');
  assert.equal(state.messageKey, 'settings.updateLatest');
  assert.equal(state.update, null);
  assert.equal(state.error, null);
});

test('keeps update metadata when a new version is available', async () => {
  const update = {
    version: '1.2.2',
    body: 'Bug fixes',
    downloadAndInstall: async () => {},
  };

  const state = await checkForAppUpdate(createInitialUpdaterState('1.2.1'), {
    check: async () => update,
  });

  assert.equal(state.status, 'available');
  assert.equal(state.messageKey, 'settings.updateAvailable');
  assert.equal(state.update, update);
  assert.equal(state.error, null);
});

test('installs update and marks the app ready to restart', async () => {
  let installed = false;
  const update = {
    version: '1.2.2',
    downloadAndInstall: async () => {
      installed = true;
    },
  };

  const state = await installAppUpdate(
    { ...createInitialUpdaterState('1.2.1'), status: 'available', update },
    { relaunch: async () => {} }
  );

  assert.equal(installed, true);
  assert.equal(state.status, 'ready-to-restart');
  assert.equal(state.messageKey, 'settings.updateReadyToRestart');
});

test('captures updater errors without discarding the current version', async () => {
  const state = await checkForAppUpdate(createInitialUpdaterState('1.2.1'), {
    check: async () => {
      throw new Error('network unavailable');
    },
  });

  assert.equal(state.currentVersion, '1.2.1');
  assert.equal(state.status, 'error');
  assert.equal(state.messageKey, 'settings.updateFailed');
  assert.equal(state.error, 'network unavailable');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkInstallAndNotifyAppUpdate,
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

test('menu updater notifies when the app is already up to date', async () => {
  const messages = [];
  const result = await checkInstallAndNotifyAppUpdate({
    check: async () => null,
    message: async (content) => messages.push(content),
    confirm: async () => false,
    relaunch: async () => {},
    labels: {
      latest: 'You are on the latest version',
      available: version => `New version available: ${version}`,
      readyToRestart: 'Restart now?',
      failed: 'Update check failed',
    },
  });

  assert.equal(result.status, 'latest');
  assert.deepEqual(messages, ['You are on the latest version']);
});

test('menu updater downloads available updates and can restart', async () => {
  const actions = [];
  const update = {
    version: '1.2.2',
    downloadAndInstall: async () => actions.push('download'),
  };

  const result = await checkInstallAndNotifyAppUpdate({
    check: async () => update,
    message: async (content) => actions.push(`message:${content}`),
    confirm: async (content) => {
      actions.push(`confirm:${content}`);
      return true;
    },
    relaunch: async () => actions.push('restart'),
    labels: {
      latest: 'latest',
      available: version => `available ${version}`,
      readyToRestart: 'restart?',
      failed: 'failed',
    },
  });

  assert.equal(result.status, 'installed');
  assert.deepEqual(actions, [
    'message:available 1.2.2',
    'download',
    'confirm:restart?',
    'restart',
  ]);
});

test('menu updater reports check and install errors', async () => {
  const messages = [];
  const result = await checkInstallAndNotifyAppUpdate({
    check: async () => {
      throw new Error('network unavailable');
    },
    message: async (content) => messages.push(content),
    confirm: async () => false,
    relaunch: async () => {},
    labels: {
      latest: 'latest',
      available: version => `available ${version}`,
      readyToRestart: 'restart?',
      failed: 'failed',
    },
  });

  assert.equal(result.status, 'error');
  assert.deepEqual(messages, ['failed\nnetwork unavailable']);
});

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

  const state = await installAppUpdate({
    ...createInitialUpdaterState('1.2.1'), status: 'available', update,
  });

  assert.equal(installed, true);
  assert.equal(state.status, 'ready-to-restart');
  assert.equal(state.messageKey, 'settings.updateReadyToRestart');
});

test('keeps update metadata when install fails so the UI can retry', async () => {
  const update = {
    version: '1.2.2',
    downloadAndInstall: async () => {
      throw new Error('download failed');
    },
  };

  const state = await installAppUpdate({
    ...createInitialUpdaterState('1.2.1'), status: 'available', update,
  });

  assert.equal(state.status, 'error');
  assert.equal(state.messageKey, 'settings.updateFailed');
  assert.equal(state.update, update);
  assert.equal(state.error, 'download failed');
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

test('repeated checks close the superseded update resource even for the same version', async () => {
  let closed = false;
  const previousUpdate = {
    version: '1.4.1',
    downloadAndInstall: async () => {},
    close: async () => { closed = true; },
  };
  const update = { version: '1.4.1', downloadAndInstall: async () => {} };

  const state = await checkForAppUpdate({
    ...createInitialUpdaterState('1.4.0'), status: 'available', update: previousUpdate,
  }, { check: async () => update });

  assert.equal(closed, true);
  assert.equal(state.update, update);
  assert.equal(state.status, 'available');
});

test('a check without an update closes the previously available resource', async () => {
  let closed = false;
  const update = {
    version: '1.4.1',
    downloadAndInstall: async () => {},
    close: async () => { closed = true; },
  };

  const state = await checkForAppUpdate({
    ...createInitialUpdaterState('1.4.0'), status: 'available', update,
  }, { check: async () => null });

  assert.equal(closed, true);
  assert.equal(state.update, null);
  assert.equal(state.status, 'idle');
});

test('a failed check keeps the previous update resource open for installation', async () => {
  const update = {
    version: '1.4.1',
    downloadAndInstall: async () => {},
    close: async () => assert.fail('a failed check must preserve the available resource'),
  };

  const state = await checkForAppUpdate({
    ...createInitialUpdaterState('1.4.0'), status: 'available', update,
  }, { check: async () => { throw new Error('Network unavailable'); } });

  assert.equal(state.update, update);
  assert.equal(state.status, 'error');
});

test('checks do not close an update resource that is still in use', async () => {
  const update = {
    version: '1.4.1',
    downloadAndInstall: async () => {},
    close: async () => assert.fail('the active resource must remain open'),
  };

  const state = await checkForAppUpdate({
    ...createInitialUpdaterState('1.4.0'), status: 'available', update,
  }, { check: async () => update });

  assert.equal(state.update, update);
  assert.equal(state.status, 'available');
});

test('resource cleanup errors do not discard a newly detected update', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const previousUpdate = {
    version: '1.4.1',
    downloadAndInstall: async () => {},
    close: async () => { throw new Error('Resource cleanup failed'); },
  };
  const update = { version: '1.4.2', downloadAndInstall: async () => {} };

  const state = await checkForAppUpdate({
    ...createInitialUpdaterState('1.4.0'), status: 'available', update: previousUpdate,
  }, { check: async () => update });

  assert.equal(state.update, update);
  assert.equal(state.status, 'available');
  assert.equal(warnings.length, 1);
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

test('menu updater can install through the shared app update state', async () => {
  const actions = [];
  const update = {
    version: '1.4.1',
    downloadAndInstall: async () => assert.fail('shared installation should be used'),
  };

  const result = await checkInstallAndNotifyAppUpdate({
    check: async () => update,
    install: async receivedUpdate => {
      assert.equal(receivedUpdate, update);
      actions.push('install');
    },
    message: async content => actions.push(content),
    confirm: async () => false,
    relaunch: async () => assert.fail('restart should require confirmation'),
    labels: {
      latest: 'latest',
      available: version => `available ${version}`,
      readyToRestart: 'restart?',
      failed: 'failed',
    },
  });

  assert.equal(result.status, 'installed');
  assert.deepEqual(actions, ['available 1.4.1', 'install']);
});

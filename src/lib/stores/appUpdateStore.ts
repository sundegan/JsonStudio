import { get, writable } from 'svelte/store';
import {
  checkForAppUpdate,
  createInitialUpdaterState,
  installAppUpdate,
  restartAfterAppUpdate,
} from '$lib/services/appUpdater';

type AppUpdaterState = ReturnType<typeof createInitialUpdaterState>;

const appUpdateState = writable<AppUpdaterState>(createInitialUpdaterState(''));
let hasLoadedCurrentVersion = false;

export const appUpdateStore = {
  subscribe: appUpdateState.subscribe,
};

export async function initAppUpdater() {
  if (hasLoadedCurrentVersion) return;
  hasLoadedCurrentVersion = true;

  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    const version = await getVersion();
    appUpdateState.update(state => ({ ...state, currentVersion: version }));
  } catch {
    // Browser previews do not expose the Tauri app API.
  }
}

export async function checkAppUpdates(options: { showErrors?: boolean } = {}) {
  appUpdateState.update(state => ({
    ...state,
    status: 'checking',
    messageKey: 'settings.updateChecking',
    error: null,
  }));

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const nextState = await checkForAppUpdate(get(appUpdateState), { check });
    appUpdateState.set(nextState);
    return nextState;
  } catch (error) {
    const previousState = get(appUpdateState);
    const nextState: AppUpdaterState = {
      ...previousState,
      status: options.showErrors ? 'error' : 'idle',
      messageKey: options.showErrors ? 'settings.updateFailed' : 'settings.updateReady',
      error: options.showErrors ? (error instanceof Error ? error.message : String(error)) : null,
    };
    appUpdateState.set(nextState);
    return nextState;
  }
}

export async function installAvailableAppUpdate() {
  appUpdateState.update(state => ({
    ...state,
    status: 'installing',
    messageKey: 'settings.updateInstalling',
    error: null,
  }));

  const nextState = await installAppUpdate(get(appUpdateState));
  appUpdateState.set(nextState);
  return nextState;
}

export async function restartInstalledAppUpdate() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await restartAfterAppUpdate({ relaunch: () => invoke('restart_app') });
  } catch (error) {
    appUpdateState.update(state => ({
      ...state,
      status: 'error',
      messageKey: 'settings.updateFailed',
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

import { get, writable } from 'svelte/store';
import {
  checkForAppUpdate,
  createInitialUpdaterState,
  installAppUpdate,
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
  const previousState = get(appUpdateState);
  if (
    previousState.status === 'checking' ||
    previousState.status === 'installing' ||
    previousState.status === 'ready-to-restart'
  ) {
    return previousState;
  }

  appUpdateState.update(state => ({
    ...state,
    status: 'checking',
    messageKey: 'settings.updateChecking',
    error: null,
  }));

  if (isMockAppUpdateEnabled()) {
    const nextState: AppUpdaterState = {
      ...get(appUpdateState),
      status: 'available',
      update: {
        version: '9.9.9-dev',
        body: 'Local mock update for testing the in-app update notification.',
        downloadAndInstall: async () => {
          await new Promise(resolve => setTimeout(resolve, 900));
        },
      },
      messageKey: 'settings.updateAvailable',
      error: null,
    };
    appUpdateState.set(nextState);
    return nextState;
  }

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const checkedState = await checkForAppUpdate(get(appUpdateState), { check });
    const nextState = !options.showErrors && checkedState.status === 'error'
      ? previousState
      : checkedState;
    appUpdateState.set(nextState);
    return nextState;
  } catch (error) {
    const nextState: AppUpdaterState = options.showErrors ? {
      ...previousState,
      status: 'error',
      messageKey: 'settings.updateFailed',
      error: error instanceof Error ? error.message : String(error),
    } : previousState;
    appUpdateState.set(nextState);
    return nextState;
  }
}

function isMockAppUpdateEnabled() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  if (import.meta.env.VITE_MOCK_APP_UPDATE === '1') return true;

  const params = new URLSearchParams(window.location.search);
  return params.get('mockUpdate') === '1' || window.localStorage.getItem('mock-app-update') === '1';
}

export async function installAvailableAppUpdate() {
  const previousState = get(appUpdateState);
  if (
    previousState.status === 'checking' ||
    previousState.status === 'installing' ||
    previousState.status === 'ready-to-restart'
  ) {
    return previousState;
  }

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
    await invoke('restart_app');
  } catch (error) {
    appUpdateState.update(state => ({
      ...state,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

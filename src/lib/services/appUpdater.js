/**
 * @typedef {'idle' | 'checking' | 'available' | 'installing' | 'ready-to-restart' | 'error'} UpdaterStatus
 * @typedef {{
 *   version?: string,
 *   body?: string,
 *   downloadAndInstall: () => Promise<void>,
 *   close?: () => Promise<void>,
 * }} AppUpdate
 * @typedef {{
 *   currentVersion: string,
 *   status: UpdaterStatus,
 *   update: AppUpdate | null,
 *   messageKey: string,
 *   error: string | null,
 * }} UpdaterState
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown updater error';
}

/**
 * @param {string} currentVersion
 * @returns {UpdaterState}
 */
export function createInitialUpdaterState(currentVersion = '') {
  return {
    currentVersion,
    status: 'idle',
    update: null,
    messageKey: 'settings.updateReady',
    error: null,
  };
}

/**
 * @param {UpdaterState} state
 * @param {{ check: () => Promise<AppUpdate | null> }} deps
 * @returns {Promise<UpdaterState>}
 */
export async function checkForAppUpdate(state, deps) {
  try {
    const update = await deps.check();
    if (state.update?.close && state.update !== update) {
      try {
        await state.update.close();
      } catch (error) {
        console.warn('Failed to close superseded app update:', error);
      }
    }

    if (!update) {
      return {
        ...state,
        status: 'idle',
        update: null,
        messageKey: 'settings.updateLatest',
        error: null,
      };
    }

    return {
      ...state,
      status: 'available',
      update,
      messageKey: 'settings.updateAvailable',
      error: null,
    };
  } catch (error) {
    return {
      ...state,
      status: 'error',
      messageKey: 'settings.updateFailed',
      error: getErrorMessage(error),
    };
  }
}

/**
 * @param {UpdaterState} state
 * @returns {Promise<UpdaterState>}
 */
export async function installAppUpdate(state) {
  if (!state.update) {
    return {
      ...state,
      status: 'error',
      messageKey: 'settings.updateFailed',
      error: 'No update is available to install.',
    };
  }

  try {
    await state.update.downloadAndInstall();
    return {
      ...state,
      status: 'ready-to-restart',
      messageKey: 'settings.updateReadyToRestart',
      error: null,
    };
  } catch (error) {
    return {
      ...state,
      status: 'error',
      messageKey: 'settings.updateFailed',
      error: getErrorMessage(error),
    };
  }
}

/**
 * @param {{
 *   check: () => Promise<AppUpdate | null>,
 *   install?: (update: AppUpdate) => Promise<void>,
 *   message: (content: string) => Promise<void>,
 *   confirm: (content: string) => Promise<boolean>,
 *   relaunch: () => Promise<void>,
 *   labels: {
 *     latest: string,
 *     available: (version?: string) => string,
 *     readyToRestart: string,
 *     failed: string,
 *   },
 * }} deps
 * @returns {Promise<{ status: 'latest' | 'installed' | 'error' }>}
 */
export async function checkInstallAndNotifyAppUpdate(deps) {
  try {
    const update = await deps.check();
    if (!update) {
      await deps.message(deps.labels.latest);
      return { status: 'latest' };
    }

    await deps.message(deps.labels.available(update.version));
    if (deps.install) {
      await deps.install(update);
    } else {
      await update.downloadAndInstall();
    }

    const shouldRestart = await deps.confirm(deps.labels.readyToRestart);
    if (shouldRestart) {
      await deps.relaunch();
    }

    return { status: 'installed' };
  } catch (error) {
    await deps.message(`${deps.labels.failed}\n${getErrorMessage(error)}`);
    return { status: 'error' };
  }
}

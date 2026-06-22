import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

const EXTERNAL_URL_PATTERN = /^https?:\/\//i;

/**
 * Open an external URL from both Tauri and browser preview contexts.
 *
 * @param {string} url
 * @returns {void}
 */
export function openExternalUrl(url) {
  if (!EXTERNAL_URL_PATTERN.test(url)) return;

  if (!isTauri()) {
    openWithBrowserFallback(url);
    return;
  }

  void openUrl(url).catch(error => {
    console.error('Failed to open external link:', error);
    openWithBrowserFallback(url);
  });
}

/**
 * @param {string} url
 * @returns {void}
 */
function openWithBrowserFallback(url) {
  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');
  if (openedWindow) return;

  window.location.assign(url);
}

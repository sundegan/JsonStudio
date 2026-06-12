export const APP_WEBSITE_URL = 'https://jsonstudio.js.org/';
export const APP_GITHUB_URL = 'https://github.com/sundegan/JsonStudio';
export const APP_CHANGELOG_URL = 'https://jsonstudio.js.org/changelog';

/**
 * @param {string | null | undefined} version
 * @param {string} fallback
 */
export function formatAppVersion(version, fallback = '') {
  const normalized = typeof version === 'string' ? version.trim() : '';
  if (!normalized) return fallback;
  return normalized.startsWith('v') || normalized.startsWith('V')
    ? `v${normalized.slice(1)}`
    : `v${normalized}`;
}

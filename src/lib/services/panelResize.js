const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 1500;
const EDITOR_MIN_WIDTH = 240;
const PANEL_MAX_RATIO = 0.7;
const PANEL_DEFAULT_RATIO = 0.38;

// Folder sidebar constraints
const FOLDER_MIN_WIDTH = 160;
const FOLDER_MAX_WIDTH = 480;
const FOLDER_MAX_RATIO = 0.35;
const FOLDER_EDITOR_MIN_WIDTH = 320;

/**
 * Clamp the right panel so it remains useful without starving the editor.
 * @param {number} requestedWidth
 * @param {number} workspaceWidth
 */
export function clampPanelWidth(requestedWidth, workspaceWidth) {
  const ratioMax = Math.floor(workspaceWidth * PANEL_MAX_RATIO);
  const dynamicMax = Math.max(
    PANEL_MIN_WIDTH,
    Math.min(ratioMax, workspaceWidth - EDITOR_MIN_WIDTH),
  );
  const maxWidth = Math.min(PANEL_MAX_WIDTH, dynamicMax);
  return Math.min(maxWidth, Math.max(PANEL_MIN_WIDTH, requestedWidth));
}

/**
 * Clamp the left folder sidebar width.
 * Narrower constraints than the right panel — the folder list needs less space.
 * @param {number} requestedWidth
 * @param {number} workspaceWidth
 */
export function clampFolderWidth(requestedWidth, workspaceWidth) {
  const ratioMax = Math.floor(workspaceWidth * FOLDER_MAX_RATIO);
  const dynamicMax = Math.min(
    FOLDER_MAX_WIDTH,
    Math.min(ratioMax, workspaceWidth - FOLDER_EDITOR_MIN_WIDTH),
  );
  const maxWidth = Math.max(FOLDER_MIN_WIDTH, dynamicMax);
  return Math.min(maxWidth, Math.max(FOLDER_MIN_WIDTH, requestedWidth));
}

/**
 * Use a roomier split by default so the side panel feels like a peer view,
 * not a cramped inspector.
 * @param {number} workspaceWidth
 */
export function getDefaultPanelWidth(workspaceWidth) {
  return clampPanelWidth(Math.round(workspaceWidth * PANEL_DEFAULT_RATIO), workspaceWidth);
}

const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 1500;
const EDITOR_MIN_WIDTH = 240;
const PANEL_MAX_RATIO = 0.7;
const PANEL_DEFAULT_RATIO = 0.32;
const PANEL_DEFAULT_MAX_WIDTH = 420;

// Folder sidebar constraints
const FOLDER_MIN_WIDTH = 160;
const FOLDER_MAX_WIDTH = 480;
const FOLDER_MAX_RATIO = 0.35;
const FOLDER_EDITOR_MIN_WIDTH = 320;
const FOLDER_DEFAULT_WIDTH = 240;
export const SIDEBAR_COLLAPSE_THRESHOLD = 56;

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
  return clampPanelWidth(
    Math.min(PANEL_DEFAULT_MAX_WIDTH, Math.round(workspaceWidth * PANEL_DEFAULT_RATIO)),
    workspaceWidth,
  );
}

/**
 * Give the file browser enough room for filenames without taking focus from
 * the editor on a standard desktop window.
 * @param {number} workspaceWidth
 */
export function getDefaultFolderWidth(workspaceWidth) {
  return clampFolderWidth(FOLDER_DEFAULT_WIDTH, workspaceWidth);
}

/**
 * Measure how far a resize gesture has pushed beyond the panel's minimum.
 * The panel stays at its minimum width during this range to avoid accidental
 * collapse from a short drag.
 * @param {number} requestedWidth
 * @param {number} minimumWidth
 */
export function getSidebarResizeResistance(requestedWidth, minimumWidth) {
  return Math.max(0, minimumWidth - requestedWidth);
}

/**
 * @param {number} requestedWidth
 * @param {number} minimumWidth
 */
export function shouldCollapseSidebar(requestedWidth, minimumWidth) {
  return getSidebarResizeResistance(requestedWidth, minimumWidth) >= SIDEBAR_COLLAPSE_THRESHOLD;
}

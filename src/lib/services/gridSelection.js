/**
 * @typedef {'key' | 'value' | 'row'} GridSelectionTarget
 */

/**
 * @typedef {{ id: string; path: string; target: GridSelectionTarget }} GridSelection
 */

/**
 * @typedef {{
 *   kind: 'object' | 'array-object' | 'array' | 'scalar';
 *   columns: string[];
 * }} GridSelectionModel
 */

/**
 * @typedef {{
 *   path: string;
 *   cells: { path: string }[];
 * }} GridSelectionRow
 */

/**
 * @param {GridSelectionModel} model
 * @param {GridSelectionRow} row
 * @param {number} cellIndex
 * @returns {GridSelection}
 */
export function getGridSelectionForCell(model, row, cellIndex) {
  const selectsWholeRow =
    cellIndex === 0 &&
    model.columns.length > 1 &&
    (model.kind === 'object' || model.kind === 'array');
  const target = selectsWholeRow ? 'row' : 'value';
  const path = target === 'row' ? row.path : row.cells[cellIndex].path;

  return {
    id: `${path}:${target}`,
    path,
    target,
  };
}

/**
 * @param {Record<string, any>} pointers
 * @param {string} path
 * @param {GridSelectionTarget} target
 */
export function getGridSelectionRange(pointers, path, target) {
  const pointer = pointers[path];
  if (!pointer) return null;

  if (target === 'key' && pointer.key && pointer.keyEnd) {
    return { start: pointer.key.pos, end: pointer.keyEnd.pos };
  }

  if (target === 'row') {
    const start = pointer.key?.pos ?? pointer.value?.pos;
    const end = pointer.valueEnd?.pos ?? pointer.value?.pos;
    return start == null || end == null ? null : { start, end };
  }

  if (pointer.value && pointer.valueEnd) {
    return { start: pointer.value.pos, end: pointer.valueEnd.pos };
  }

  return null;
}

/**
 * @param {GridSelection[]} current
 * @param {GridSelection} next
 * @param {{
 *   additive?: boolean;
 *   range?: boolean;
 *   anchor?: GridSelection | null;
 *   orderedRows?: string[];
 * }} options
 */
export function updateGridSelections(current, next, options = {}) {
  if (
    options.range &&
    options.anchor?.target === 'row' &&
    next.target === 'row' &&
    options.orderedRows?.length
  ) {
    const start = options.orderedRows.indexOf(options.anchor.path);
    const end = options.orderedRows.indexOf(next.path);
    if (start >= 0 && end >= 0) {
      return options.orderedRows
        .slice(Math.min(start, end), Math.max(start, end) + 1)
        .map((path) => ({ id: `${path}:row`, path, target: 'row' }));
    }
  }

  if (!options.additive) return [next];

  const exists = current.some((selection) => selection.id === next.id);
  return exists
    ? current.filter((selection) => selection.id !== next.id)
    : [...current, next];
}

/**
 * @param {{ closest?: (selector: string) => unknown } | null | undefined} target
 */
export function shouldClearGridSelection(target) {
  return !target?.closest?.('.gv-table');
}

/**
 * @param {unknown} value
 * @param {string} path
 */
function getValueAtPath(value, path) {
  if (path === '/' || path === '') return value;

  return path
    .split('/')
    .slice(1)
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, segment) => {
      if (current == null) return undefined;
      if (Array.isArray(current)) return current[Number(segment)];
      if (typeof current === 'object') return /** @type {Record<string, unknown>} */ (current)[segment];
      return undefined;
    }, value);
}

/**
 * @param {GridSelection[]} selections
 * @param {unknown} rootValue
 */
export function getGridSelectionText(selections, rootValue) {
  return selections
    .map((selection) => {
      const value = getValueAtPath(rootValue, selection.path);
      if (selection.target === 'value') {
        return value == null ? String(value) : typeof value === 'object' ? JSON.stringify(value) : String(value);
      }

      const key = selection.path.split('/').at(-1)?.replaceAll('~1', '/').replaceAll('~0', '~') ?? '';
      return JSON.stringify({ [key]: value });
    })
    .join('\n');
}

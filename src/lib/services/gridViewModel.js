import { getJsonSourceValue, isJsonSourceNode } from './jsonSourceModel.js';

/**
 * @typedef {{
 *   value: unknown;
 *   path: string;
 *   expandable: boolean;
 *   exists: boolean;
 *   sourceNode?: import('./jsonSourceModel.js').JsonSourceNode | null;
 * }} GridCell
 *
 * @typedef {{
 *   path: string;
 *   source: unknown;
 *   cells: GridCell[];
 * }} GridRow
 *
 * @typedef {{
 *   kind: 'object' | 'array-object' | 'array' | 'scalar';
 *   path: string;
 *   source: unknown;
 *   showHeader: boolean;
 *   columns: string[];
 *   rows: GridRow[];
 * }} GridModel
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  value = getJsonSourceValue(value);
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string | number} value
 */
function escapePointerSegment(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

/**
 * @param {string} parentPath
 * @param {string | number} key
 */
function childPath(parentPath, key) {
  const segment = escapePointerSegment(key);
  return parentPath === '/' ? `/${segment}` : `${parentPath}/${segment}`;
}

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {GridCell}
 */
function createCell(value, path, exists = true) {
  const cellValue = getJsonSourceValue(value);
  return {
    value: cellValue,
    path,
    expandable: isPlainObject(value) || Array.isArray(cellValue),
    exists,
    sourceNode: isJsonSourceNode(value) ? value : null,
  };
}

/**
 * @param {string} path
 * @param {unknown} source
 * @param {GridCell[]} cells
 * @returns {GridRow}
 */
function createRow(path, source, cells) {
  return { path, source, cells };
}

/**
 * @param {unknown} value
 * @param {string} [path]
 * @returns {GridModel}
 */
export function buildGridRoot(value, path = '/', showHeader = true) {
  if (isJsonSourceNode(value)) {
    if (value.kind === 'object') {
      return {
        kind: 'object',
        path,
        source: value.value,
        showHeader: false,
        columns: ['key', 'value'],
        rows: value.entries.map((entry) => {
          const pathForValue = childPathForSourceEntry(path, entry.key, entry.occurrence ?? 0);
          return createRow(pathForValue, { [entry.key]: entry.value.value }, [
            createCell(entry.key, pathForValue),
            createCell(entry.value, pathForValue),
          ]);
        }),
      };
    }

    if (value.kind === 'array') {
      const allObjects = value.items.length > 0 && value.items.every((entry) =>
        isJsonSourceNode(entry) && entry.kind === 'object'
      );

      if (allObjects) {
        const objectItems = /** @type {import('./jsonSourceModel.js').JsonSourceObjectNode[]} */ (value.items);
        const columns = [...new Set(objectItems.flatMap((entry) => entry.entries.map((item) => item.key)))];
        return {
          kind: 'array-object',
          path,
          source: value.value,
          showHeader,
          columns,
          rows: objectItems.map((entry, index) => {
            const rowPath = childPath(path, index);
            const entriesByKey = new Map(entry.entries.map((item) => [item.key, item]));
            return createRow(
              rowPath,
              entry.value,
              columns.map((column) => {
                const item = entriesByKey.get(column);
                return createCell(
                  item ? item.value : null,
                  childPath(rowPath, column),
                  Boolean(item),
                );
              }),
            );
          }),
        };
      }

      return {
        kind: 'array',
        path,
        source: value.value,
        showHeader: false,
        columns: ['index', 'value'],
        rows: value.items.map((entry, index) => {
          const rowPath = childPath(path, index);
          return createRow(rowPath, entry.value, [
            createCell(index, rowPath),
            createCell(entry, rowPath),
          ]);
        }),
      };
    } else {
      value = value.value;
    }
  }

  if (isPlainObject(value)) {
    return {
      kind: 'object',
      path,
      source: value,
      showHeader: false,
      columns: ['key', 'value'],
      rows: Object.entries(value).map(([key, entryValue]) => {
        const pathForValue = childPath(path, key);
        return createRow(pathForValue, { [key]: entryValue }, [
          createCell(key, pathForValue),
          createCell(entryValue, pathForValue),
        ]);
      }),
    };
  }

  if (Array.isArray(value)) {
    const allObjects = value.length > 0 && value.every((entry) => isPlainObject(entry));

    if (allObjects) {
      const columns = [...new Set(value.flatMap((entry) => Object.keys(entry)))];
      return {
        kind: 'array-object',
        path,
        source: value,
        showHeader,
        columns,
        rows: value.map((entry, index) => {
          const rowPath = childPath(path, index);
          return createRow(
            rowPath,
            entry,
            columns.map((column) =>
              createCell(
                Object.prototype.hasOwnProperty.call(entry, column) ? entry[column] : null,
                childPath(rowPath, column),
                Object.prototype.hasOwnProperty.call(entry, column),
              ),
            ),
          );
        }),
      };
    }

    return {
      kind: 'array',
      path,
      source: value,
      showHeader: false,
      columns: ['index', 'value'],
      rows: value.map((entry, index) => {
        const rowPath = childPath(path, index);
        return createRow(rowPath, entry, [
          createCell(index, rowPath),
          createCell(entry, rowPath),
        ]);
      }),
    };
  }

  return {
    kind: 'scalar',
    path,
    source: value,
    showHeader,
    columns: ['value'],
    rows: [createRow(path, value, [createCell(value, path)])],
  };
}

/**
 * @param {GridCell | null | undefined} cell
 * @returns {GridModel | null}
 */
export function getGridChild(cell) {
  if (!cell?.expandable) return null;
  return buildGridRoot(cell.sourceNode ?? cell.value, cell.path, false);
}

/**
 * @param {unknown} value
 */
export function summarizeGridValue(value) {
  value = getJsonSourceValue(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.length}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).length}}`;
  return String(value);
}

/**
 * @param {string | number} label
 * @param {unknown} value
 */
export function describeExpandableGridValue(label, value) {
  value = getJsonSourceValue(value);
  if (Array.isArray(value)) return `${label} [${value.length}]`;
  if (isPlainObject(value)) return `${label} {}`;
  return String(label);
}

/**
 * @param {string} parentPath
 * @param {string} key
 * @param {number} occurrence
 */
function childPathForSourceEntry(parentPath, key, occurrence) {
  const basePath = childPath(parentPath, key);
  return occurrence === 0 ? basePath : `${basePath}~${occurrence + 1}`;
}

/**
 * @param {GridModel} model
 * @returns {string[]}
 */
export function collectExpandableGridPaths(model) {
  const paths = [];

  for (const row of model.rows) {
    for (const cell of row.cells) {
      if (!cell.expandable) continue;

      paths.push(cell.path);
      const child = getGridChild(cell);
      if (child) {
        paths.push(...collectExpandableGridPaths(child));
      }
    }
  }

  return paths;
}

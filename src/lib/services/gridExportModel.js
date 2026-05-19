import {
  buildGridRoot,
  getGridChild,
  summarizeGridValue,
} from './gridViewModel.js';

/**
 * @typedef {{
 *   value: unknown;
 *   path: string;
 *   expandable: boolean;
 *   exists: boolean;
 *   child?: GridExportModel | null;
 * }} GridExportCell
 *
 * @typedef {{
 *   path: string;
 *   source: unknown;
 *   cells: GridExportCell[];
 * }} GridExportRow
 *
 * @typedef {{
 *   kind: 'object' | 'array-object' | 'array' | 'scalar';
 *   path: string;
 *   source: unknown;
 *   showHeader: boolean;
 *   columns: string[];
 *   rows: GridExportRow[];
 * }} GridExportModel
 *
 * @typedef {{
 *   key: string;
 *   value: string;
 *   type: string;
 *   child: GridExportSection | null;
 * }} GridExportSectionRow
 *
 * @typedef {{
 *   kind: GridExportModel['kind'];
 *   rows: GridExportSectionRow[];
 * }} GridExportSection
 */

/**
 * @param {GridExportModel} model
 * @returns {GridExportModel}
 */
function cloneWithChildren(model) {
  return {
    ...model,
    rows: model.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => {
        const child = cell.expandable ? getGridChild(cell) : null;
        return {
          ...cell,
          child: child ? cloneWithChildren(child) : null,
        };
      }),
    })),
  };
}

/** @param {unknown} value */
function getValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

/**
 * @param {GridExportModel} model
 * @param {GridExportRow} row
 */
function getRowLabel(model, row) {
  if (model.kind === 'array') return String(row.cells[0].value);
  if (model.kind === 'object') return String(row.cells[0].value);
  if (model.kind === 'array-object') return row.path.split('/').at(-1) ?? '';
  return '';
}

/**
 * @param {GridExportModel} model
 * @returns {GridExportSection}
 */
function buildSection(model) {
  if (model.kind === 'array-object') {
    return {
      kind: model.kind,
      rows: model.rows.map((row) => ({
        key: getRowLabel(model, row),
        value: '',
        type: 'object',
        child: {
          kind: 'object',
          rows: row.cells.map((cell, index) => ({
            key: model.columns[index],
            value: summarizeGridValue(cell.value),
            type: getValueType(cell.value),
            child: cell.child ? buildSection(cell.child) : null,
          })),
        },
      })),
    };
  }

  return {
    kind: model.kind,
    rows: model.rows.map((row) => {
      const valueCell = model.kind === 'scalar'
        ? row.cells[0]
        : row.cells[row.cells.length - 1];
      return {
        key: model.kind === 'scalar' ? '' : getRowLabel(model, row),
        value: summarizeGridValue(valueCell.value),
        type: getValueType(valueCell.value),
        child: valueCell.child ? buildSection(valueCell.child) : null,
      };
    }),
  };
}

/**
 * @param {unknown} value
 * @returns {GridExportModel}
 */
export function buildGridExportModel(value) {
  return cloneWithChildren(buildGridRoot(value));
}

/**
 * @param {unknown} value
 * @returns {GridExportSection}
 */
export function buildGridExportSections(value) {
  return buildSection(buildGridExportModel(value));
}

/**
 * @param {string | null | undefined} pathOrName
 * @param {'pdf' | 'xlsx'} extension
 */
export function getGridExportFileName(pathOrName, extension) {
  if (!pathOrName) return `grid-export.${extension}`;
  const fileName = pathOrName.split(/[\\/]/).pop() ?? '';
  const stem = fileName.replace(/\.[^.]+$/, '') || 'grid-export';
  return `${stem}-grid.${extension}`;
}

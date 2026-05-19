import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { buildGridExportSections } from './gridExportModel.js';

const PDF_CELL_PADDING = 3;
const PDF_NESTED_GUTTER = PDF_CELL_PADDING * 2;
const PDF_CHAR_WIDTH = 2.3;
const PDF_MIN_KEY_WIDTH = 18;
const PDF_MIN_VALUE_WIDTH = 24;

/**
 * @typedef {{
 *   keyWidth: number;
 *   valueWidth: number;
 *   totalWidth: number;
 *   children: Record<string, GridPdfLayout>;
 * }} GridPdfLayout
 */

/** @param {string} value */
function estimatePdfTextWidth(value) {
  return Math.max(0, String(value).length * PDF_CHAR_WIDTH);
}

/**
 * @param {import('./gridExportModel.js').GridExportSection} section
 * @param {number} maxWidth
 * @returns {GridPdfLayout}
 */
function buildPdfLayout(section, maxWidth) {
  /** @type {Record<string, GridPdfLayout>} */
  const childLayouts = {};
  const keyWidth = Math.max(
    PDF_MIN_KEY_WIDTH,
    ...section.rows.map((row) => estimatePdfTextWidth(row.key) + PDF_NESTED_GUTTER),
  );

  const valueTextWidth = Math.max(
    PDF_MIN_VALUE_WIDTH,
    ...section.rows.map((row) => estimatePdfTextWidth(row.value) + PDF_NESTED_GUTTER),
  );
  const childLimit = Math.max(PDF_MIN_VALUE_WIDTH, maxWidth - keyWidth - PDF_NESTED_GUTTER);

  let childWidth = 0;
  for (const row of section.rows) {
    if (!row.child) continue;
    const layout = buildPdfLayout(row.child, childLimit);
    childLayouts[row.key] = layout;
    childWidth = Math.max(childWidth, layout.totalWidth + PDF_NESTED_GUTTER);
  }

  const valueWidth = Math.min(
    Math.max(PDF_MIN_VALUE_WIDTH, valueTextWidth, childWidth),
    Math.max(PDF_MIN_VALUE_WIDTH, maxWidth - keyWidth),
  );

  return {
    keyWidth,
    valueWidth,
    totalWidth: keyWidth + valueWidth,
    children: childLayouts,
  };
}

/**
 * @param {unknown} value
 * @param {number} maxWidth
 */
export function getGridPdfLayout(value, maxWidth) {
  return buildPdfLayout(buildGridExportSections(value), maxWidth);
}

/**
 * @param {import('./gridExportModel.js').GridExportSection} section
 * @param {GridPdfLayout} layout
 */
function measurePdfSectionHeight(section, layout) {
  const doc = new jsPDF();
  autoTable(doc, {
    body: section.rows.map((row) => [row.key, row.value]),
    columns: [
      { header: '', dataKey: 'key' },
      { header: '', dataKey: 'value' },
    ],
    showHead: 'never',
    theme: 'grid',
    startY: 0,
    margin: { left: 0 },
    tableWidth: layout.totalWidth,
    styles: { fontSize: 10, cellPadding: PDF_CELL_PADDING },
    columnStyles: {
      0: { cellWidth: layout.keyWidth },
      1: { cellWidth: layout.valueWidth },
    },
    didParseCell: (data) => {
      const row = section.rows[data.row.index];
      const childLayout = row?.child ? layout.children[row.key] : null;
      if (data.column.index !== 1 || !row?.child || !childLayout) return;
      data.cell.styles.minCellHeight = measurePdfSectionHeight(row.child, childLayout) + PDF_NESTED_GUTTER;
    },
    didDrawPage: () => {},
  });

  const table = /** @type {jsPDF & { lastAutoTable?: { body?: { height: number }[] } }} */ (doc).lastAutoTable;
  return table?.body?.reduce((height, row) => height + row.height, 0) ?? 0;
}

/**
 * @param {unknown} value
 * @param {string} key
 * @param {number} maxWidth
 */
export function getGridPdfSectionHeight(value, key, maxWidth) {
  const section = buildGridExportSections(value);
  const layout = buildPdfLayout(section, maxWidth);
  const row = section.rows.find((entry) => entry.key === key);
  const childLayout = row?.child ? layout.children[key] : null;
  if (!row?.child || !childLayout) return 0;
  return measurePdfSectionHeight(row.child, childLayout);
}

/**
 * @param {jsPDF} doc
 * @param {import('./gridExportModel.js').GridExportSection} section
 * @param {GridPdfLayout} layout
 * @param {number} startY
 * @param {number} left
 * @returns {number}
 */
function renderPdfSection(doc, section, layout, startY, left) {
  autoTable(doc, {
    body: section.rows.map((row) => [row.key, row.value]),
    columns: [
      { header: '', dataKey: 'key' },
      { header: '', dataKey: 'value' },
    ],
    showHead: 'never',
    theme: 'grid',
    startY,
    margin: { left },
    tableWidth: layout.totalWidth,
    styles: { fontSize: 10, cellPadding: PDF_CELL_PADDING },
    columnStyles: {
      0: { cellWidth: layout.keyWidth },
      1: { cellWidth: layout.valueWidth },
    },
    didParseCell: (data) => {
      const row = section.rows[data.row.index];
      const childLayout = row?.child ? layout.children[row.key] : null;
      if (data.column.index !== 1 || !row?.child || !childLayout) return;
      data.cell.styles.minCellHeight = measurePdfSectionHeight(row.child, childLayout) + PDF_NESTED_GUTTER;
    },
    didDrawCell: (data) => {
      const row = section.rows[data.row.index];
      const childLayout = row?.child ? layout.children[row.key] : null;
      if (data.column.index !== 1 || !row?.child || !childLayout) return;
      renderPdfSection(
        doc,
        row.child,
        childLayout,
        data.cell.y + PDF_CELL_PADDING,
        data.cell.x + PDF_CELL_PADDING,
      );
    },
  });
  return /** @type {jsPDF & { lastAutoTable?: { finalY?: number } }} */ (doc).lastAutoTable?.finalY ?? startY;
}

/**
 * @param {import('./gridExportModel.js').GridExportSection} section
 * @returns {number}
 */
function getSheetSectionHeight(section) {
  return section.rows.reduce(
    (height, row) => height + (row.child ? getSheetSectionHeight(row.child) : 1),
    0,
  );
}

/**
 * @param {string[][]} rows
 * @param {number} rowIndex
 * @param {number} columnIndex
 * @param {string} value
 */
function setSheetCell(rows, rowIndex, columnIndex, value) {
  rows[rowIndex] ??= [];
  rows[rowIndex][columnIndex] = value;
}

/**
 * @param {import('./gridExportModel.js').GridExportSection} section
 * @param {string[][]} rows
 * @param {import('xlsx').Range[]} merges
 * @param {number} startRow
 * @param {number} startColumn
 * @returns {number}
 */
function writeSheetSection(section, rows, merges, startRow = 0, startColumn = 0) {
  let rowIndex = startRow;

  for (const row of section.rows) {
    setSheetCell(rows, rowIndex, startColumn, row.key);

    if (!row.child) {
      setSheetCell(rows, rowIndex, startColumn + 1, row.value);
      rowIndex += 1;
      continue;
    }

    const childHeight = getSheetSectionHeight(row.child);
    if (childHeight > 1) {
      merges.push({
        s: { r: rowIndex, c: startColumn },
        e: { r: rowIndex + childHeight - 1, c: startColumn },
      });
    }
    writeSheetSection(row.child, rows, merges, rowIndex, startColumn + 1);
    rowIndex += childHeight;
  }

  return rowIndex - startRow;
}

/** @param {string[][]} rows */
export function getGridSheetColumnWidths(rows) {
  /** @type {number[]} */
  const widths = [];
  for (const row of rows) {
    row.forEach((value, index) => {
      widths[index] = Math.max(widths[index] ?? 0, String(value).length);
    });
  }
  return widths;
}

/** @param {unknown} value */
export function createGridPdfBytes(value) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const section = buildGridExportSections(value);
  const layout = buildPdfLayout(section, pageWidth - 28);
  renderPdfSection(doc, section, layout, 14, 14);
  return new Uint8Array(doc.output('arraybuffer'));
}

/** @param {unknown} value */
export function createGridXlsxBytes(value) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {import('xlsx').Range[]} */
  const merges = [];
  writeSheetSection(buildGridExportSections(value), rows, merges);
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = getGridSheetColumnWidths(rows).map((width) => ({ wch: width + 2 }));
  worksheet['!merges'] = merges;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Grid');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}

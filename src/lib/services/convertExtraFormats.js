// @ts-nocheck
import { parseConvertStructuredFormat } from './convertStructuredFormats.js';

export function parseProperties(content, { ini = false } = {}) {
  const result = parseConvertStructuredFormat(ini ? 'INI' : 'Properties', content);
  if (result === null) throw new Error(`Invalid ${ini ? 'INI' : 'Properties'} document`);
  return result;
}

export function formatProperties(value, { ini = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Properties/INI requires a JSON object');
  const lines = [];
  for (const [key, raw] of Object.entries(value)) {
    assertPropertiesKey(key, ini ? 'INI section/key' : 'Properties key');
    if (ini && raw && typeof raw === 'object' && !Array.isArray(raw)) {
      lines.push(`[${key}]`);
      for (const [childKey, childValue] of Object.entries(raw)) {
        assertPropertiesKey(childKey, 'INI key');
        lines.push(`${childKey}=${formatPropertiesValue(childValue)}`);
      }
      lines.push('');
    } else {
      lines.push(`${key}=${formatPropertiesValue(raw)}`);
    }
  }
  return lines.join('\n').replace(/\n+$/, '');
}

function formatPropertiesValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'object') {
    throw new Error('Properties/INI values must be scalar');
  }
  if (typeof value === 'string') {
    if (/\r|\n/.test(value)) throw new Error('Properties/INI values cannot contain line breaks');
    const trimmed = value.trim();
    const needsQuotes = value === ''
      || value !== trimmed
      || /[\\"']/.test(value)
      || /^(?:true|false|null|nil|~|N\/A|-?\d+(?:\.\d+)?)$/i.test(trimmed);
    return needsQuotes ? JSON.stringify(value) : value;
  }
  return String(value);
}

function assertPropertiesKey(key, label) {
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
    throw new Error(`${label} must contain only letters, numbers, dots, underscores, or hyphens`);
  }
}

export function parseMarkdownTable(content) {
  const result = parseConvertStructuredFormat('Markdown Table', content);
  if (result === null) throw new Error('Invalid Markdown table');
  return result;
}

export function formatMarkdownTable(value) {
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.length || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Markdown table requires a JSON object or object array');
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!headers.length) throw new Error('Markdown table requires at least one column');
  const render = (cells) => `| ${cells.map((cell) => String(cell ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>')).join(' | ')} |`;
  return [render(headers), render(headers.map(() => '---')), ...rows.map((row) => render(headers.map((key) => formatMarkdownValue(row[key]))))].join('\n');
}

function formatMarkdownValue(value) {
  if (value === null) return 'null';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** @param {{ kind: string, raw: string }[]} fragments @param {string} content */
export function detectWholeConvertFormat(fragments, content) {
  if (fragments.length !== 1 || fragments[0].raw.trim() !== content.trim()) return null;
  return ({ YAML: 'yaml', XML: 'xml', TOML: 'toml', CSV: 'csv', Properties: 'properties', INI: 'ini', 'Markdown Table': 'markdown' })[fragments[0].kind] ?? null;
}

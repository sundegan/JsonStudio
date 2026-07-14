// @ts-nocheck

export function parseConvertStructuredFormat(kind, value) {
  const parser = ({
    Properties: parseProperties,
    INI: parseIni,
    'Markdown Table': parseMarkdownTable,
  })[kind];
  return parser ? parser(value, true) : null;
}

function parseProperties(value, explicit = false) {
  const lines = value.split('\n').filter((line) => line.trim() && !/^\s*[#!]/.test(line));
  if (lines.length < (explicit ? 1 : 2) || !lines.some((line) => /^(?:export\s+)?[\w.-]+\s*[=:]/.test(line))) return null;
  const result = {};
  let section = result;
  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = getOrCreateObject(result, sectionMatch[1]);
      continue;
    }
    const match = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*[=:]\s*(.*)$/);
    if (!match) return null;
    setDottedValue(section, match[1], inferScalar(match[2]));
  }
  return Object.keys(result).length ? result : null;
}

function parseIni(value, explicit = false) {
  const hasSection = /^\s*\[[^\]]+\]\s*$/m.test(value);
  if (!explicit && (!hasSection || !/^\s*;/m.test(value))) return null;
  if (!/^\s*[\w.-]+\s*=\s*/m.test(value)) return null;
  const result = {};
  let section = result;
  for (const line of value.split('\n')) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = getOrCreateObject(result, sectionMatch[1]);
      continue;
    }
    if (!line.trim() || /^\s*[;#]/.test(line)) continue;
    const entry = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
    if (!entry) return null;
    setOwnValue(section, entry[1], inferScalar(entry[2]));
  }
  return Object.keys(result).length ? result : null;
}

function parseMarkdownTable(value) {
  const lines = value.trim().split('\n').filter(Boolean);
  if (lines.length < 3 || !/^\|?\s*:?-{3,}/.test(lines[1])) return null;
  const row = (line) => line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/<br\s*\/?>/gi, '\n').replace(/\\\|/g, '|'));
  const headers = row(lines[0]);
  if (headers.some((header) => !header)) return null;
  const result = lines
    .slice(2)
    .filter((line) => line.includes('|'))
    .map((line) => Object.fromEntries(row(line).map((cell, index) => [headers[index], inferScalar(cell)])));
  return result.length ? result : null;
}

function inferScalar(value) {
  const raw = String(value).trim();
  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.at(-1) === quote) {
    const quoted = raw.slice(1, -1);
    if (quote === '"') {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'string') return parsed;
      } catch {
        // Fall through to the unescaped inner text for non-JSON quoted values.
      }
    }
    return quote === "'"
      ? quoted.replace(/''/g, "'").replace(/\\(['\\])/g, '$1')
      : quoted;
  }
  if (/^(?:null|nil|~|N\/A)$/i.test(raw) || raw === '') return null;
  if (/^(?:true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function setOwnValue(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function getOrCreateObject(target, key) {
  if (!Object.hasOwn(target, key) || !target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
    setOwnValue(target, key, {});
  }
  return target[key];
}

function setDottedValue(target, key, value) {
  const parts = key.split('.');
  let cursor = target;
  for (const part of parts.slice(0, -1)) cursor = getOrCreateObject(cursor, part);
  setOwnValue(cursor, parts.at(-1), value);
}

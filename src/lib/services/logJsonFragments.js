import { jsonrepair } from 'jsonrepair';

export const MAX_LOG_JSON_INPUT_LENGTH = 1024 * 1024;
export const MAX_LOG_JSON_FRAGMENTS = 20;

/**
 * @typedef {{
 *   label: string;
 *   line: number;
 *   column: number;
 *   raw: string;
 *   formatted: string;
 *   kind: 'JSON' | 'JSON5' | 'Escaped JSON' | 'Repaired JSON';
 * }} LogJsonFragment
 */

/**
 * @param {string} content
 * @param {{ indent?: number, maxInputLength?: number, maxFragments?: number }} [options]
 * @returns {LogJsonFragment[]}
 */
export function extractLogJsonFragments(content, options = {}) {
  const indent = options.indent ?? 2;
  const maxInputLength = options.maxInputLength ?? MAX_LOG_JSON_INPUT_LENGTH;
  const maxFragments = options.maxFragments ?? MAX_LOG_JSON_FRAGMENTS;
  const maxCandidates = maxFragments * 10;

  if (!content.trim() || content.length > maxInputLength) {
    return [];
  }

  const candidates = findJsonCandidates(content, maxCandidates);
  const fragments = [];

  for (const candidate of candidates) {
    const parsed = normalizeJsonCandidate(candidate.raw, indent);
    if (!parsed) continue;
    fragments.push({
      label: inferFragmentLabel(content, candidate.start, fragments.length + 1),
      line: candidate.line,
      column: candidate.column,
      raw: candidate.raw,
      formatted: parsed.formatted,
      kind: parsed.kind,
    });
    if (fragments.length >= maxFragments) break;
  }

  return fragments;
}

/**
 * Returns the inner JSON-ish document when the whole input is an escaped JSON
 * string, e.g. "{\"id\":1}". Mixed logs should still use fragment extraction.
 *
 * @param {string} content
 * @returns {string | null}
 */
export function getStandaloneEscapedJsonContent(content) {
  try {
    const parsed = JSON.parse(content.trim());
    if (typeof parsed !== 'string' || !parsed.trim()) {
      return null;
    }

    const fragments = extractLogJsonFragments(parsed);
    if (fragments.length === 1 && fragments[0].raw.trim() === parsed.trim()) {
      return parsed;
    }
  } catch {
  }
  return null;
}

/**
 * @param {string} value
 * @param {number} indent
 * @returns {{ formatted: string, kind: LogJsonFragment['kind'] } | null}
 */
function normalizeJsonCandidate(value, indent) {
  const direct = tryFormatJson(value, indent);
  if (direct) return { formatted: direct, kind: 'JSON' };

  const unescaped = tryUnescapeLoose(value);
  if (unescaped && unescaped !== value) {
    const formatted = tryFormatJson(unescaped, indent);
    if (formatted) return { formatted, kind: 'Escaped JSON' };
  }

  if (isRepairCandidate(value)) {
    const repaired = tryRepair(value, indent);
    if (repaired) return { formatted: repaired, kind: getRepairKind(value) };
  }

  if (unescaped && unescaped !== value) {
    if (isRepairCandidate(unescaped)) {
      const repairedUnescaped = tryRepair(unescaped, indent);
      if (repairedUnescaped) {
        return { formatted: repairedUnescaped, kind: getRepairKind(unescaped) };
      }
    }
  }

  return null;
}

/**
 * @param {string} value
 * @param {number} indent
 * @returns {string | null}
 */
function tryFormatJson(value, indent) {
  try {
    return JSON.stringify(JSON.parse(value), null, indent);
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 * @param {number} indent
 * @returns {string | null}
 */
function tryRepair(value, indent) {
  try {
    const repaired = jsonrepair(value);
    return JSON.stringify(JSON.parse(repaired), null, indent);
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function tryUnescapeLoose(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    try {
      const escapedLineBreaks = value.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      const parsed = JSON.parse(`"${escapedLineBreaks}"`);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
}

/**
 * @param {string} value
 * @returns {LogJsonFragment['kind']}
 */
function getRepairKind(value) {
  return hasJson5Syntax(value) ? 'JSON5' : 'Repaired JSON';
}

/**
 * Keep jsonrepair from turning ordinary log markers like [INFO] into JSON.
 *
 * @param {string} value
 */
function isRepairCandidate(value) {
  return hasJson5Syntax(value);
}

/**
 * @param {string} value
 */
function hasJson5Syntax(value) {
  return (
    /([{,]\s*)[A-Za-z_$][\w$-]*\s*:/.test(value) ||
    /'([^'\\]|\\.)*'/.test(value) ||
    /,\s*[}\]]/.test(value) ||
    /\/\/|\/\*/.test(value)
  );
}

/**
 * @param {string} content
 * @param {number} maxFragments
 * @returns {{ start: number, end: number, raw: string, line: number, column: number }[]}
 */
function findJsonCandidates(content, maxFragments) {
  const candidates = [];
  let line = 1;
  let column = 1;
  let index = 0;

  while (index < content.length && candidates.length < maxFragments) {
    const char = content[index];
    if (char === '{' || char === '[') {
      const end = findMatchingJsonEnd(content, index, char);
      if (end !== -1) {
        candidates.push({
          start: index,
          end,
          raw: content.slice(index, end + 1),
          line,
          column,
        });
        ({ line, column } = advancePosition(content.slice(index, end + 1), line, column));
        index = end + 1;
        continue;
      }
    }

    if (char === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    index += 1;
  }

  return candidates;
}

/**
 * @param {string} content
 * @param {number} start
 * @param {'{' | '['} openChar
 * @returns {number}
 */
function findMatchingJsonEnd(content, start, openChar) {
  const closeChar = openChar === '{' ? '}' : ']';
  const stack = [closeChar];
  /** @type {'"' | "'" | null} */
  let quote = null;
  let quoteIsSlashEscaped = false;
  let escaped = false;

  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];

    if (quote) {
      if (quoteIsSlashEscaped) {
        if (char === quote && countBackslashesBefore(content, index) % 2 === 1) {
          quote = null;
          quoteIsSlashEscaped = false;
        }
      } else if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      quoteIsSlashEscaped = countBackslashesBefore(content, index) % 2 === 1;
      continue;
    }

    if (char === '{') {
      stack.push('}');
      continue;
    }
    if (char === '[') {
      stack.push(']');
      continue;
    }
    if (char === '}' || char === ']') {
      if (char !== stack[stack.length - 1]) {
        return -1;
      }
      stack.pop();
      if (stack.length === 0) {
        return index;
      }
    }
  }

  return -1;
}

/**
 * @param {string} content
 * @param {number} index
 * @returns {number}
 */
function countBackslashesBefore(content, index) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && content[cursor] === '\\'; cursor -= 1) {
    count += 1;
  }
  return count;
}

/**
 * @param {string} text
 * @param {number} line
 * @param {number} column
 * @returns {{ line: number, column: number }}
 */
function advancePosition(text, line, column) {
  for (const char of text) {
    if (char === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/**
 * @param {string} content
 * @param {number} start
 * @param {number} fallbackIndex
 * @returns {string}
 */
function inferFragmentLabel(content, start, fallbackIndex) {
  const before = content.slice(Math.max(0, start - 80), start);
  const match = before.match(/([A-Za-z_$][\w.$-]*)\s*[:=]\s*["']?\s*$/);
  if (match) {
    return match[1];
  }
  return `Fragment ${fallbackIndex}`;
}

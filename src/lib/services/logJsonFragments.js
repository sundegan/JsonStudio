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
  const acceptedRanges = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (isInsideAcceptedRange(acceptedRanges, candidate)) continue;

    const parsed = normalizeJsonCandidate(candidate.raw, indent);
    if (!parsed) {
      insertNestedCandidates(candidates, index + 1, findNestedJsonCandidates(content, candidate));
      continue;
    }
    if (isLikelyLogBracketMarker(content, candidate)) continue;
    const preferredNested = findPreferredNestedPayloadCandidates(content, candidate, indent);
    if (preferredNested.length > 0 && shouldPreferNestedPayload(candidate, parsed)) {
      insertNestedCandidates(candidates, index + 1, preferredNested);
      continue;
    }

    fragments.push({
      label: inferFragmentLabel(content, candidate.start, fragments.length + 1),
      line: candidate.line,
      column: candidate.column,
      raw: candidate.raw,
      formatted: parsed.formatted,
      kind: parsed.kind,
    });
    acceptedRanges.push({ start: candidate.start, end: candidate.end });
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
  const unescaped = tryUnescapeLoose(value);
  if (unescaped && unescaped !== value && startsLikeJson(unescaped)) {
    const formatted = tryFormatJson(unescaped, indent);
    if (formatted) return { formatted, kind: 'Escaped JSON' };
  }

  const direct = tryFormatJson(value, indent);
  if (direct) return { formatted: direct, kind: 'JSON' };

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
  const structuralCandidates = findStructuralJsonCandidates(content, maxFragments);
  if (structuralCandidates.length === 1 && isWholeContentCandidate(content, structuralCandidates[0])) {
    return structuralCandidates;
  }

  const stringCandidates = findEscapedJsonStringCandidates(content, maxFragments, structuralCandidates);
  return [...structuralCandidates, ...stringCandidates]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, maxFragments);
}

/**
 * @param {string} content
 * @param {{ start: number, end: number }} candidate
 */
function isWholeContentCandidate(content, candidate) {
  let start = 0;
  while (start < content.length && /\s/.test(content[start])) start += 1;

  let end = content.length - 1;
  while (end >= 0 && /\s/.test(content[end])) end -= 1;

  return candidate.start === start && candidate.end === end;
}

/**
 * @param {string} content
 * @param {number} maxFragments
 * @returns {{ start: number, end: number, raw: string, line: number, column: number }[]}
 */
function findStructuralJsonCandidates(content, maxFragments) {
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
 * @param {{ start: number, end: number }} parent
 * @returns {{ start: number, end: number, raw: string, line: number, column: number }[]}
 */
function findNestedJsonCandidates(content, parent) {
  const candidates = [];
  let index = parent.start + 1;

  while (index < parent.end) {
    const char = content[index];
    if (char === '{' || char === '[') {
      const end = findMatchingJsonEnd(content, index, char);
      if (end !== -1 && end < parent.end) {
        const position = getLineColumnAt(content, index);
        candidates.push({
          start: index,
          end,
          raw: content.slice(index, end + 1),
          line: position.line,
          column: position.column,
        });
      }
    }
    index += 1;
  }

  return candidates;
}

/**
 * @param {{ start: number, end: number }[]} candidates
 * @param {number} insertAt
 * @param {{ start: number, end: number, raw: string, line: number, column: number }[]} nested
 */
function insertNestedCandidates(candidates, insertAt, nested) {
  if (nested.length === 0) return;
  const existing = new Set(candidates.map((candidate) => `${candidate.start}:${candidate.end}`));
  const uniqueNested = nested.filter((candidate) => !existing.has(`${candidate.start}:${candidate.end}`));
  if (uniqueNested.length === 0) return;
  candidates.splice(insertAt, 0, ...uniqueNested.sort((a, b) => a.start - b.start || a.end - b.end));
}

/**
 * @param {string} content
 * @param {{ start: number, end: number }} parent
 * @param {number} indent
 * @returns {{ start: number, end: number, raw: string, line: number, column: number }[]}
 */
function findPreferredNestedPayloadCandidates(content, parent, indent) {
  return findNestedJsonCandidates(content, parent).filter((candidate) =>
    hasExplicitFragmentLabel(content, candidate.start) &&
    normalizeJsonCandidate(candidate.raw, indent)?.kind === 'JSON'
  );
}

/**
 * @param {{ raw: string }} candidate
 * @param {{ kind: LogJsonFragment['kind'] }} parsed
 */
function shouldPreferNestedPayload(candidate, parsed) {
  if (parsed.kind === 'JSON') return false;
  return hasBareScalarEnvelopeField(candidate.raw);
}

/**
 * JSON-like log envelopes often combine metadata fields that are not JSON
 * scalars with one real JSON payload field, for example:
 * `{operation:Foo.Bar, payload:{"id":1}}`.
 *
 * @param {string} value
 */
function hasBareScalarEnvelopeField(value) {
  return /[{,]\s*[A-Za-z_$][\w$-]*\s*:\s*[^"',{}\[\]\s][^,{}\[\]]*/.test(value);
}

/**
 * Log prefixes often contain numeric markers like `[1780570105923755786]`.
 * They are valid JSON arrays but not useful payload fragments, and parsing
 * them as numbers loses precision in JavaScript.
 *
 * @param {string} content
 * @param {{ start: number, end: number, raw: string }} candidate
 */
function isLikelyLogBracketMarker(content, candidate) {
  if (!/^\[\d{10,}\]$/.test(candidate.raw.trim())) return false;
  if (isWholeContentCandidate(content, candidate)) return false;

  const label = inferFragmentLabel(content, candidate.start, 1);
  return label === 'Fragment 1';
}

/**
 * @param {{ start: number, end: number }[]} ranges
 * @param {{ start: number, end: number }} candidate
 */
function isInsideAcceptedRange(ranges, candidate) {
  return ranges.some((range) => candidate.start > range.start && candidate.end < range.end);
}

/**
 * @param {string} content
 * @param {number} start
 */
function hasExplicitFragmentLabel(content, start) {
  return inferFragmentLabel(content, start, 1) !== 'Fragment 1';
}

/**
 * @param {string} content
 * @param {number} maxFragments
 * @param {{ start: number, end: number }[]} structuralCandidates
 * @returns {{ start: number, end: number, raw: string, line: number, column: number }[]}
 */
function findEscapedJsonStringCandidates(content, maxFragments, structuralCandidates) {
  const candidates = [];
  let index = 0;

  while (index < content.length && candidates.length < maxFragments) {
    const char = content[index];
    if (char !== '"' && char !== "'") {
      index += 1;
      continue;
    }

    const end = findQuotedStringEnd(content, index, char);
    if (end === -1) break;

    const raw = content.slice(index, end + 1);
    if (char === "'" && isShellQuotedJsonBlock(raw)) {
      index += 1;
      continue;
    }

    if (
      isInsideStructuralCandidate(structuralCandidates, index, end) ||
      hasStructuralCandidateInside(structuralCandidates, index, end) ||
      !isEscapedJsonStringCandidate(raw)
    ) {
      index = end + 1;
      continue;
    }

    const position = getLineColumnAt(content, index);
    candidates.push({
      start: index,
      end,
      raw,
      line: position.line,
      column: position.column,
    });
    index = end + 1;
  }

  return candidates;
}

/**
 * @param {{ start: number, end: number }[]} candidates
 * @param {number} start
 * @param {number} end
 */
function hasStructuralCandidateInside(candidates, start, end) {
  return candidates.some((candidate) => candidate.start > start && candidate.end < end);
}

/**
 * @param {{ start: number, end: number }[]} candidates
 * @param {number} start
 * @param {number} end
 */
function isInsideStructuralCandidate(candidates, start, end) {
  return candidates.some((candidate) => candidate.start < start && candidate.end > end);
}

/**
 * @param {string} raw
 */
function isEscapedJsonStringCandidate(raw) {
  const unescaped = tryUnescapeLoose(raw);
  if (!unescaped) return false;
  return startsLikeJson(unescaped);
}

/**
 * Shell commands often wrap JSON request bodies in single quotes. Treat that
 * outer quote as a shell boundary, not as a JSON string that should hide all
 * nested escaped JSON fields from the scanner.
 *
 * @param {string} raw
 */
function isShellQuotedJsonBlock(raw) {
  if (!raw.startsWith("'") || !raw.endsWith("'")) return false;
  return startsLikeJson(raw.slice(1, -1));
}

/**
 * @param {string} value
 */
function startsLikeJson(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * @param {string} content
 * @param {number} start
 * @param {'"' | "'"} quote
 */
function findQuotedStringEnd(content, start, quote) {
  let escaped = false;
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) {
      return index;
    }
  }
  return -1;
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
  const match = before.match(
    /(?:--?([A-Za-z_$][\w.$-]*)|["']?([A-Za-z_$][\w.$-]*)["']?\s*[:=])\s*["']?\s*$/
  );
  if (match) {
    return match[1] || match[2];
  }
  return `Fragment ${fallbackIndex}`;
}

/**
 * @param {string} content
 * @param {number} offset
 * @returns {{ line: number, column: number }}
 */
function getLineColumnAt(content, offset) {
  return advancePosition(content.slice(0, offset), 1, 1);
}

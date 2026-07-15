import { jsonrepair } from 'jsonrepair';
import {
  findGoMapLiteralOpener,
  formatPrintedStructure,
  isCSharpRecord,
  isGoFormatStruct,
  isJavaKeyValueObject,
  isRustDebugCollection,
} from './logPrintedStructures.js';

const MAX_LOG_JSON_INPUT_LENGTH = 1024 * 1024;
const MAX_LOG_JSON_FRAGMENTS = 20;

/**
 * Every bounded, nonempty document is eligible for extraction. Validity from
 * a previous editor state must not suppress detection after the user edits a
 * JSON document into mixed log text.
 *
 * @param {string} content
 * @param {number} [maxInputLength]
 */
export function canExtractLogJsonFragments(
  content,
  maxInputLength = MAX_LOG_JSON_INPUT_LENGTH,
) {
  return Boolean(content.trim() && content.length <= maxInputLength);
}

/**
 * @typedef {{
 *   label: string;
 *   line: number;
 *   column: number;
 *   raw: string;
 *   formatted: string;
 *   kind: 'JSON' | 'JSON5' | 'Escaped JSON' | 'Java/Kotlin toString' | 'C# record' | 'Go fmt' | 'Python repr' | 'Rust Debug';
 * }} LogJsonFragment
 */

/**
 * @typedef {'Printed Structure' | 'Go fmt' | 'C# record'} PrintedStructureKindHint
 */

/**
 * @typedef {{
 *   start: number;
 *   end: number;
 *   raw: string;
 *   line: number;
 *   column: number;
 *   kindHint?: PrintedStructureKindHint;
 * }} PrintedStructureCandidate
 */

/**
 * @param {string} content
 * @param {{ indent?: number, maxInputLength?: number, maxFragments?: number }} [options]
 * @returns {LogJsonFragment[]}
 */
export function extractLogJsonFragments(content, options = {}) {
  return extractLogJsonFragmentsInternal(content, options, true);
}

/**
 * @param {string} content
 * @param {{ indent?: number, maxInputLength?: number, maxFragments?: number }} options
 * @param {boolean} excludeStandaloneEscapedJson
 * @returns {LogJsonFragment[]}
 */
function extractLogJsonFragmentsInternal(
  content,
  options,
  excludeStandaloneEscapedJson,
) {
  const indent = options.indent ?? 2;
  const maxInputLength = options.maxInputLength ?? MAX_LOG_JSON_INPUT_LENGTH;
  const maxFragments = options.maxFragments ?? MAX_LOG_JSON_FRAGMENTS;
  const maxCandidates = maxFragments * 10;

  if (!canExtractLogJsonFragments(content, maxInputLength)) {
    return [];
  }
  if (
    excludeStandaloneEscapedJson &&
    getStandaloneEscapedJsonContent(content)
  ) {
    return [];
  }

  const candidates = findJsonCandidates(content, maxCandidates);
  const fragments = [];
  const acceptedRanges = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (isInsideAcceptedRange(acceptedRanges, candidate)) continue;

    const parsed = normalizeJsonCandidate(
      candidate.raw,
      indent,
      candidate.kindHint,
    );
    if (!parsed) {
      insertNestedCandidates(
        candidates,
        index + 1,
        findNestedJsonCandidates(content, candidate),
      );
      continue;
    }
    if (isLikelyLogBracketMarker(content, candidate)) continue;
    const preferredNested = findPreferredNestedPayloadCandidates(
      content,
      candidate,
      indent,
    );
    if (
      preferredNested.length > 0 &&
      shouldPreferNestedPayload(candidate, parsed)
    ) {
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
  const trimmed = content.trim();
  if (trimmed[0] !== '"' || trimmed.at(-1) !== '"') {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'string' || !parsed.trim()) {
      return null;
    }

    const fragments = extractLogJsonFragmentsInternal(parsed, {}, false);
    if (fragments.length === 1 && fragments[0].raw.trim() === parsed.trim()) {
      return parsed;
    }
  } catch {}
  return null;
}

/**
 * @param {string} value
 * @param {number} indent
 * @param {PrintedStructureKindHint | undefined} kindHint
 * @returns {{ formatted: string, kind: LogJsonFragment['kind'] } | null}
 */
function normalizeJsonCandidate(value, indent, kindHint) {
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

  const printedStructure = formatPrintedStructure(value, indent, kindHint);
  if (printedStructure) return printedStructure;

  // A top-level bare `%+v` struct such as `{Level:info Msg:a b Code:5}` reaches
  // here without a "Go fmt" hint, because language parsers are gated on log
  // context (level keyword or field label) that whole-content input lacks.
  // Try Go parsing before jsonrepair, which would otherwise swallow a
  // multi-word value like `Msg:connection refused: timeout` into one string and
  // emit a plausible-but-wrong JSON5 result. isGoFormatStruct requires
  // whitespace-separated fields with no top-level comma, so comma-delimited
  // JSON5 never matches here.
  if (!kindHint && isGoFormatStruct(value)) {
    const goStructure = formatPrintedStructure(value, indent, 'Go fmt');
    if (goStructure) return goStructure;
  }

  if (hasJson5Syntax(value)) {
    const repaired = tryRepair(value, indent);
    if (repaired) return { formatted: repaired, kind: 'JSON5' };
  }

  if (unescaped && unescaped !== value) {
    if (hasJson5Syntax(unescaped)) {
      const repairedUnescaped = tryRepair(unescaped, indent);
      if (repairedUnescaped) {
        return { formatted: repairedUnescaped, kind: 'JSON5' };
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
      const escapedLineBreaks = value
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
      const parsed = JSON.parse(`"${escapedLineBreaks}"`);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
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
 * @returns {PrintedStructureCandidate[]}
 */
function findJsonCandidates(content, maxFragments) {
  const structuralCandidates = findStructuralJsonCandidates(
    content,
    maxFragments,
  );
  if (
    structuralCandidates.length === 1 &&
    isWholeContentCandidate(content, structuralCandidates[0])
  ) {
    return structuralCandidates;
  }

  const printedStructureCandidates = findPrintedStructureCandidates(
    content,
    maxFragments,
  );
  const stringCandidates = findEscapedJsonStringCandidates(
    content,
    maxFragments,
    structuralCandidates,
  );
  return [
    ...structuralCandidates,
    ...printedStructureCandidates,
    ...stringCandidates,
  ]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, maxFragments);
}

/**
 * Find log values whose syntax is specific to direct language-level printing.
 * These candidates require either a field label or a conventional log level so
 * ordinary source declarations such as `class User { ... }` remain untouched.
 *
 * @param {string} content
 * @param {number} maxCandidates
 * @returns {{ start: number, end: number, raw: string, line: number, column: number, kindHint: PrintedStructureKindHint }[]}
 */
function findPrintedStructureCandidates(content, maxCandidates) {
  /** @type {{ start: number, end: number, raw: string, line: number, column: number, kindHint: PrintedStructureKindHint }[]} */
  const candidates = [];
  /** @type {Set<string>} */
  const seen = new Set();

  /** @param {number} start @param {number} end @param {PrintedStructureKindHint} kindHint */
  const add = (start, end, kindHint) => {
    if (end === -1 || candidates.length >= maxCandidates) return;
    const key = `${start}:${end}`;
    if (seen.has(key) || !isLanguageLogCandidate(content, start, end)) return;
    seen.add(key);
    const position = getLineColumnAt(content, start);
    candidates.push({
      start,
      end,
      raw: content.slice(start, end + 1),
      line: position.line,
      column: position.column,
      kindHint,
    });
  };

  const typedValue =
    /\b(?:(?:[A-Z][\w$]*)(?:\.[A-Z][\w$]*)*|(?:[a-z_][\w$]*\.)+[A-Z][\w$]*)(?:<[^>\n]+>)?(?:@[\da-fA-F]+)?(?=[({])/g;
  for (const match of content.matchAll(typedValue)) {
    const start = match.index ?? 0;
    const openIndex = start + match[0].length;
    const openChar = /** @type {'{' | '('} */ (content[openIndex]);
    add(
      start,
      findMatchingJsonEnd(content, openIndex, openChar),
      'Printed Structure',
    );
  }

  const csharpRecordValue =
    /\b(?:[A-Za-z_][\w$]*\.)*[A-Z][\w$]*(?:<[^>\n]+>)?\s+(?=\{)/g;
  for (const match of content.matchAll(csharpRecordValue)) {
    const start = match.index ?? 0;
    const openIndex = start + match[0].length;
    const end = findMatchingJsonEnd(content, openIndex, '{');
    if (end !== -1 && isCSharpRecord(content.slice(start, end + 1))) {
      add(start, end, 'C# record');
    }
  }

  const rustDebugValue =
    /\b(?:[A-Za-z_][\w$]*::)*[A-Z][\w$]*(?:<[^>\n]+>)?\s*(?=[({\[])/g;
  for (const match of content.matchAll(rustDebugValue)) {
    const start = match.index ?? 0;
    const openIndex = start + match[0].length;
    const openChar = /** @type {'{' | '(' | '['} */ (content[openIndex]);
    add(
      start,
      findMatchingJsonEnd(content, openIndex, openChar),
      'Printed Structure',
    );
  }

  for (const match of content.matchAll(/\bmap\[[^\]\n]+\]/g)) {
    const start = match.index ?? 0;
    const opener = findGoMapLiteralOpener(content, start + match[0].length);
    if (opener !== -1)
      add(start, findMatchingJsonEnd(content, opener, '{'), 'Go fmt');
  }

  for (const match of content.matchAll(/\bmap\[/g)) {
    const start = match.index ?? 0;
    add(start, findMatchingJsonEnd(content, start + 3, '['), 'Go fmt');
  }

  // Go `%#v` slices and arrays: `[]int{...}`, `[3]int{...}`, `[]*pkg.T{...}`.
  // The element type sits between the length brackets and the literal body, so
  // the whole span must be captured as one value rather than letting the
  // leading `[]`/`[N]` close as an empty JSON array.
  const goTypedCollection =
    /(?:\[\d*\]\*?)+(?:[A-Za-z_][\w$]*\.)*[A-Za-z_][\w$]*(?=\{)/g;
  for (const match of content.matchAll(goTypedCollection)) {
    const start = match.index ?? 0;
    const openIndex = start + match[0].length;
    add(start, findMatchingJsonEnd(content, openIndex, '{'), 'Go fmt');
  }

  // Rust anonymous tuples such as `(1, "a")`. A bare `(` is never valid JSON,
  // so an opening parenthesis right after a label or log level is a printed
  // tuple. Named forms like `Some(..)` are already covered above.
  for (const match of content.matchAll(/(?<![\w$)\]])\(/g)) {
    const openIndex = match.index ?? 0;
    const end = findMatchingJsonEnd(content, openIndex, '(');
    if (end === -1) continue;
    const body = content.slice(openIndex + 1, end);
    if (!isRustTupleBody(body)) continue;
    add(openIndex, end, 'Printed Structure');
  }

  return candidates;
}

/**
 * Distinguish a Rust tuple like `(1, "a")` from prose in parentheses such as
 * `(see docs)`. A tuple needs at least two comma-separated top-level items,
 * each a Rust scalar or nested tuple/collection — never a bare word phrase.
 * Single-element tuples print with a trailing comma (`(42,)`) and are covered
 * by the same rule.
 *
 * @param {string} body
 */
function isRustTupleBody(body) {
  if (!body.trim()) return false;
  if (/[:=]/.test(body.replace(/"[^"]*"|'[^']*'/g, ''))) return false;
  const items = splitTopLevelParen(body).filter((item) => item.trim());
  if (items.length < 2) return false;
  return items.every((item) => isRustScalarItem(item.trim()));
}

/** @param {string} item */
function isRustScalarItem(item) {
  return (
    item === 'true' ||
    item === 'false' ||
    item === 'None' ||
    /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(item) ||
    /^"(?:[^"\\]|\\.)*"$/.test(item) ||
    /^'(?:[^'\\]|\\.)*'$/.test(item) ||
    item.startsWith('(') ||
    item.startsWith('[') ||
    item.startsWith('{') ||
    /^(?:[A-Za-z_][\w$]*::)*[A-Z][\w$]*\s*[({[]/.test(item)
  );
}

/** @param {string} value split on top-level commas, respecting bracket nesting */
function splitTopLevelParen(value) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  const stack = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{' || char === '[' || char === '(') stack.push(char);
    else if (char === '}' || char === ']' || char === ')') stack.pop();
    else if (char === ',' && stack.length === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/**
 * Go typed slice/array literals begin with `[]` or `[N]` immediately followed
 * by an element type and a `{` body. The structural scanner would otherwise
 * close the leading brackets as an empty array and drop the rest.
 *
 * @param {string} content
 * @param {number} start
 * @param {number} end
 */
function isGoTypedCollectionPrefix(content, start, end) {
  if (content[start] !== '[') return false;
  const after = content.slice(end + 1, end + 81);
  return /^\*?(?:\[\d*\]\*?)*(?:[A-Za-z_][\w$]*\.)*[A-Za-z_][\w$]*\{/.test(
    after,
  );
}

/**
 * @param {string} content
 * @param {number} start
 * @param {number} end
 */
function isLanguageLogCandidate(content, start, end) {
  if (isWholeContentCandidate(content, { start, end })) return false;
  const before = content.slice(Math.max(0, start - 160), start);
  if (isSourceDeclarationPrefix(before)) return false;
  return (
    hasExplicitFragmentLabel(content, start) ||
    /\b(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i.test(before)
  );
}

/** @param {string} value */
function isSourceDeclarationPrefix(value) {
  return /\b(?:class|interface|enum|record|struct|type|func|function)\b(?:\s+[\w$<>,.()[\]]+)*\s*$/i.test(
    value,
  );
}

/**
 * Empty structures after a type name are not data: they occur in Go type
 * declarations and in empty Java/Go printed values. Retain ordinary labeled
 * JSON values such as `payload={}` and `payload=[]` while suppressing only
 * the typed forms.
 *
 * @param {string} content
 * @param {number} start
 * @param {number} end
 * @param {string} raw
 */
function isEmptyTypedStructure(content, start, end, raw) {
  const before = content.slice(Math.max(0, start - 160), start);
  if (raw === '[]') {
    return (
      isLanguageLogCandidate(content, start, end) && /\bmap\s*$/.test(before)
    );
  }
  if (raw !== '{}') return false;
  if (!isLanguageLogCandidate(content, start, end)) return false;
  return (
    /\b(?:interface|struct|any|error)\s*$/.test(before) ||
    /(?:[A-Z][\w$]*|[a-z_][\w$]*(?:\.[A-Z][\w$]*)+)\s*$/.test(before)
  );
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
 * @returns {PrintedStructureCandidate[]}
 */
function findStructuralJsonCandidates(content, maxFragments) {
  /** @type {PrintedStructureCandidate[]} */
  const candidates = [];
  let line = 1;
  let column = 1;
  let index = 0;

  while (index < content.length && candidates.length < maxFragments) {
    const char = content[index];
    if (char === '{' || char === '[') {
      const end = findMatchingJsonEnd(content, index, char);
      if (end !== -1) {
        const raw = content.slice(index, end + 1);
        const before = content.slice(Math.max(0, index - 160), index);
        if (
          isSourceDeclarationPrefix(before) ||
          isEmptyTypedStructure(content, index, end, raw) ||
          isGoTypedCollectionPrefix(content, index, end)
        ) {
          ({ line, column } = advancePosition(raw, line, column));
          index = end + 1;
          continue;
        }
        candidates.push({
          start: index,
          end,
          raw,
          line,
          column,
          kindHint: getStructuralKindHint(content, index, end, raw),
        });
        ({ line, column } = advancePosition(
          content.slice(index, end + 1),
          line,
          column,
        ));
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
 * @param {number} end
 * @param {string} raw
 * @returns {PrintedStructureKindHint | undefined}
 */
function getStructuralKindHint(content, start, end, raw) {
  if (!isLanguageLogCandidate(content, start, end)) return undefined;
  if (isGoFormatStruct(raw)) return 'Go fmt';
  return isJavaKeyValueObject(raw) || isRustDebugCollection(raw)
    ? 'Printed Structure'
    : undefined;
}

/**
 * @param {string} content
 * @param {{ start: number, end: number, kindHint?: PrintedStructureKindHint }} parent
 * @returns {PrintedStructureCandidate[]}
 */
function findNestedJsonCandidates(content, parent) {
  /** @type {PrintedStructureCandidate[]} */
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
 * @param {PrintedStructureCandidate[]} nested
 */
function insertNestedCandidates(candidates, insertAt, nested) {
  if (nested.length === 0) return;
  const existing = new Set(
    candidates.map((candidate) => `${candidate.start}:${candidate.end}`),
  );
  const uniqueNested = nested.filter(
    (candidate) => !existing.has(`${candidate.start}:${candidate.end}`),
  );
  if (uniqueNested.length === 0) return;
  candidates.splice(
    insertAt,
    0,
    ...uniqueNested.sort((a, b) => a.start - b.start || a.end - b.end),
  );
}

/**
 * @param {string} content
 * @param {{ start: number, end: number, kindHint?: PrintedStructureKindHint }} parent
 * @param {number} indent
 * @returns {PrintedStructureCandidate[]}
 */
function findPreferredNestedPayloadCandidates(content, parent, indent) {
  return findNestedJsonCandidates(content, parent).filter(
    (candidate) =>
      hasExplicitFragmentLabel(content, candidate.start) &&
      normalizeJsonCandidate(candidate.raw, indent, candidate.kindHint)
        ?.kind === 'JSON',
  );
}

/**
 * @param {{ raw: string }} candidate
 * @param {{ kind: LogJsonFragment['kind'] }} parsed
 */
function shouldPreferNestedPayload(candidate, parsed) {
  if (parsed.kind !== 'JSON5') return false;
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
  return [
    ...value.matchAll(
      /[{,]\s*[A-Za-z_$][\w$-]*\s*:\s*([^"',{}\[\]\s][^,{}\[\]]*)/g,
    ),
  ].some((match) => !isJsonLikeBareScalar(match[1].trim()));
}

/** @param {string} value */
function isJsonLikeBareScalar(value) {
  return (
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
  );
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
  return ranges.some(
    (range) => candidate.start > range.start && candidate.end <= range.end,
  );
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
function findEscapedJsonStringCandidates(
  content,
  maxFragments,
  structuralCandidates,
) {
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
  return candidates.some(
    (candidate) => candidate.start > start && candidate.end < end,
  );
}

/**
 * @param {{ start: number, end: number }[]} candidates
 * @param {number} start
 * @param {number} end
 */
function isInsideStructuralCandidate(candidates, start, end) {
  return candidates.some(
    (candidate) => candidate.start < start && candidate.end > end,
  );
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
 * @param {'{' | '[' | '('} openChar
 * @returns {number}
 */
function findMatchingJsonEnd(content, start, openChar) {
  const closeChar = openChar === '{' ? '}' : openChar === '(' ? ')' : ']';
  const stack = [closeChar];
  /** @type {'"' | "'" | null} */
  let quote = null;
  let quoteIsSlashEscaped = false;
  let escaped = false;

  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index];

    if (quote) {
      if (quoteIsSlashEscaped) {
        if (
          char === quote &&
          countBackslashesBefore(content, index) % 2 === 1
        ) {
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
    if (char === '(') {
      stack.push(')');
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
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
  for (
    let cursor = index - 1;
    cursor >= 0 && content[cursor] === '\\';
    cursor -= 1
  ) {
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
    /(?:--?([A-Za-z_$][\w.$-]*)|["']?([A-Za-z_$][\w.$-]*)["']?\s*[:=])\s*["']?\s*&?\s*$/,
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

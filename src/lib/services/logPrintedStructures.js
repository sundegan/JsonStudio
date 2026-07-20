/**
 * Parsers for common language-level debug output embedded in log text.
 * Candidate discovery stays in logJsonFragments.js; this module only converts
 * a bounded, already-identified value into JSON-compatible data.
 */

/** @typedef {'Printed Structure' | 'Go fmt' | 'C# record'} PrintedStructureHint */
/** @typedef {'Java/Kotlin toString' | 'C# record' | 'Go fmt' | 'Python repr' | 'Rust Debug' | 'JavaScript inspection'} PrintedStructureKind */

/**
 * @param {string} value
 * @param {number} indent
 * @param {PrintedStructureHint | undefined} kindHint
 * @returns {{ formatted: string, kind: PrintedStructureKind } | null}
 */
export function formatPrintedStructure(value, indent, kindHint) {
  if (kindHint === 'Go fmt') {
    const goValue = parseGoTypedValue(value) ?? parseGoPrintedValue(value);
    return goValue === null ? null : formatStructure(goValue, indent, 'Go fmt');
  }

  if (kindHint === 'C# record') {
    const csharpValue = parseCSharpRecord(value);
    return csharpValue === null
      ? null
      : formatStructure(csharpValue, indent, 'C# record');
  }

  if (kindHint !== 'Printed Structure') return null;

  const javascriptValue = parseJavaScriptInspection(value);
  if (javascriptValue !== null)
    return formatStructure(javascriptValue, indent, 'JavaScript inspection');

  const pythonValue = parsePythonRepr(value);
  if (pythonValue !== null)
    return formatStructure(pythonValue, indent, 'Python repr');

  const goValue = parseGoTypedValue(value);
  if (goValue !== null) return formatStructure(goValue, indent, 'Go fmt');

  // Rust-specific syntax (tuples, `::` paths, `Type { ... }`) must be tried
  // before the JVM parser, which would otherwise claim a bracketed tuple list
  // by returning its unparsed elements as strings.
  if (isRustDebugCollection(value.trim())) {
    const rustValue = parseRustDebug(value);
    if (rustValue !== undefined)
      return formatStructure(rustValue, indent, 'Rust Debug');
  }

  const jvmValue = parseJvmEqualsStructure(value);
  if (jvmValue !== null)
    return formatStructure(jvmValue, indent, 'Java/Kotlin toString');

  const rustValue = parseRustDebug(value);
  return rustValue === undefined
    ? null
    : formatStructure(rustValue, indent, 'Rust Debug');
}

/**
 * @param {unknown} value
 * @param {number} indent
 * @param {PrintedStructureKind} kind
 */
function formatStructure(value, indent, kind) {
  return { formatted: JSON.stringify(value, null, indent), kind };
}

/**
 * Java toString and Kotlin data class output both use `Type(field=value)`.
 * Runtime output does not reliably identify which JVM language produced it,
 * so they intentionally share one parser and the established Java label.
 *
 * @param {string} value
 * @returns {object | null}
 */
function parseJvmEqualsStructure(value) {
  const parsed = parseJvmEqualsValue(value);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

/** @param {string} value @returns {unknown} */
function parseJvmEqualsValue(value) {
  const input = value
    .trim()
    .replace(
      /^[A-Za-z_$][\w$.]*@[\da-fA-F]+(?=\{)/,
      (match) => match.split('@')[0],
    );
  if (
    input === 'Optional.empty' ||
    input === 'Optional.empty()' ||
    input === 'null'
  )
    return null;
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (isNumericLiteral(input)) return Number(input);
  if (isQuotedValue(input)) return parseQuotedValue(input);

  const optional = input.match(/^Optional(?:\.of)?\s*[\[(]([\s\S]*)[\])]$/);
  if (optional) return parseJvmEqualsValue(optional[1]);

  if (input.startsWith('{') && input.endsWith('}')) {
    return parseKeyValueObject(input.slice(1, -1), '=', parseJvmEqualsValue);
  }
  if (input.startsWith('[') && input.endsWith(']')) {
    return splitTopLevel(input.slice(1, -1))
      .filter((item) => item.trim())
      .map(parseJvmEqualsValue);
  }

  const wrapped = input.match(
    /^[A-Za-z_$][\w$.]*(?:<[^>]+>)?\s*([({\[])([\s\S]*)$/,
  );
  if (!wrapped) return input;
  const [, open, rest] = wrapped;
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  if (!rest.endsWith(close)) return input;
  const body = rest.slice(0, -1);
  if (open === '[')
    return splitTopLevel(body)
      .filter((item) => item.trim())
      .map(parseJvmEqualsValue);
  return parseKeyValueObject(body, '=', parseJvmEqualsValue);
}

/** @param {string} value @returns {object | unknown[] | null} */
function parseJavaScriptInspection(value) {
  const input = value.trim();
  const map = input.match(/^Map\(\d+\)\s*\{([\s\S]*)\}$/);
  if (map) {
    const result = {};
    for (const entry of splitTopLevel(map[1])) {
      if (!entry.trim()) continue;
      const arrow = findTopLevelArrow(entry);
      if (arrow === -1) return null;
      const key = parseJavaScriptInspectionValue(entry.slice(0, arrow));
      if (key !== null && typeof key === 'object') return null;
      setOwnValue(
        result,
        String(key),
        parseJavaScriptInspectionValue(entry.slice(arrow + 2)),
      );
    }
    return result;
  }

  const set = input.match(/^Set\(\d+\)\s*\{([\s\S]*)\}$/);
  if (set) {
    return splitTopLevel(set[1])
      .filter((item) => item.trim())
      .map(parseJavaScriptInspectionValue);
  }

  return null;
}

/** @param {string} value @returns {unknown} */
function parseJavaScriptInspectionValue(value) {
  const input = value.trim();
  const collection = parseJavaScriptInspection(input);
  if (collection !== null) return collection;
  if (input === 'undefined' || input === 'NaN' || input === 'Infinity') {
    return null;
  }
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (input === 'null') return null;
  if (isNumericLiteral(input)) return Number(input);
  if (isQuotedValue(input)) return parseQuotedValue(input);
  if (input.startsWith('{') && input.endsWith('}')) {
    const object = parseKeyValueObject(
      input.slice(1, -1),
      ':',
      parseJavaScriptInspectionValue,
    );
    if (object !== null) return object;
  }
  if (input.startsWith('[') && input.endsWith(']')) {
    return splitTopLevel(input.slice(1, -1))
      .filter((item) => item.trim())
      .map(parseJavaScriptInspectionValue);
  }
  return input;
}

/** @param {string} value @returns {number} */
function findTopLevelArrow(value) {
  let quote = null;
  let escaped = false;
  const stack = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '(') stack.push(')');
    else if (char === '}' || char === ']' || char === ')') {
      if (stack.at(-1) === char) stack.pop();
    } else if (char === '=' && value[index + 1] === '>' && stack.length === 0) {
      return index;
    }
  }
  return -1;
}

/** @param {string} value @returns {object | null} */
function parseCSharpRecord(value) {
  const body = getCSharpRecordBody(value);
  if (body === null || findTopLevelSeparator(body, '=') === -1) return null;
  return parseKeyValueObject(body, '=', parseCSharpValue);
}

/** @param {string} value @returns {unknown} */
function parseCSharpValue(value) {
  const input = value.trim();
  if (input === 'null') return null;
  if (input === 'True' || input === 'true') return true;
  if (input === 'False' || input === 'false') return false;
  if (isNumericLiteral(input)) return Number(input);
  if (isQuotedValue(input)) return parseQuotedValue(input);
  if (input.startsWith('[') && input.endsWith(']')) {
    return splitTopLevel(input.slice(1, -1))
      .filter((item) => item.trim())
      .map(parseCSharpValue);
  }

  return parseCSharpRecord(input) ?? input;
}

/** @param {string} value @returns {string | null} */
function getCSharpRecordBody(value) {
  const match = value
    .trim()
    .match(/^(?:[A-Za-z_][\w$]*\.)*[A-Z][\w$]*(?:<[^>\n]+>)?\s+\{([\s\S]*)\}$/);
  return match ? match[1] : null;
}

/** @param {string} value @returns {object | null} */
function parsePythonRepr(value) {
  const input = value.trim();
  const ordered = input.match(/^OrderedDict\(\[([\s\S]*)\]\)$/);
  if (ordered) {
    const result = {};
    for (const item of splitTopLevel(ordered[1])) {
      const pair = item.trim();
      if (!pair.startsWith('(') || !pair.endsWith(')')) return null;
      const values = splitTopLevel(pair.slice(1, -1));
      if (values.length !== 2) return null;
      const key = parsePythonValue(values[0]);
      if (typeof key !== 'string') return null;
      setOwnValue(result, key, parsePythonValue(values[1]));
    }
    return result;
  }

  if (!/\b(?:True|False|None)\b/.test(input)) return null;
  const wrapped = input.match(/^[A-Z][\w$]*(?:<[^>]+>)?\(([\s\S]*)\)$/);
  return wrapped
    ? parseKeyValueObject(wrapped[1], '=', parsePythonValue)
    : null;
}

/** @param {string} value @returns {unknown} */
function parsePythonValue(value) {
  const input = value.trim();
  if (input === 'True') return true;
  if (input === 'False') return false;
  if (input === 'None') return null;
  if (isNumericLiteral(input)) return Number(input);
  if (isQuotedValue(input)) return parseQuotedValue(input);
  if (input.startsWith('[') && input.endsWith(']')) {
    return splitTopLevel(input.slice(1, -1))
      .filter((item) => item.trim())
      .map(parsePythonValue);
  }
  if (input.startsWith('{') && input.endsWith('}')) {
    return parseKeyValueObject(input.slice(1, -1), ':', parsePythonValue);
  }
  return input;
}

/** @param {string} value @returns {unknown | undefined} */
function parseRustDebug(value) {
  const input = value.trim();
  if (input.startsWith('{') || input.startsWith('[') || input.startsWith('('))
    return parseRustValue(input);
  if (!/^(?:[A-Za-z_][\w$]*::)*[A-Z][\w$]*(?:<[^>\n]+>)?\s*[({\[]/.test(input))
    return undefined;
  return parseRustValue(input);
}

/** @param {string} value @returns {unknown | undefined} */
function parseRustValue(value) {
  const input = value.trim();
  if (input === 'None' || input === '()') return null;
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (isNumericLiteral(input)) return Number(input);
  if (isQuotedValue(input)) return parseQuotedValue(input);
  if (input.startsWith('{') && input.endsWith('}'))
    return parseRustObject(input.slice(1, -1));
  if (input.startsWith('[') && input.endsWith(']'))
    return parseRustSequence(input.slice(1, -1));
  // Anonymous tuple such as `(1, "a")`. Rust prints struct fields with `:` and
  // struct-variant data with `{`, so a top-level `(...)` without a `=`/`:`
  // separator is a positional tuple and maps to a JSON array.
  if (input.startsWith('(') && input.endsWith(')')) {
    const body = input.slice(1, -1);
    if (
      findTopLevelSeparator(body, '=') === -1 &&
      findTopLevelSeparator(body, ':') === -1
    ) {
      return parseRustSequence(body);
    }
    return undefined;
  }

  const wrapped = input.match(
    /^(?:[A-Za-z_][\w$]*::)*([A-Z][\w$]*)(?:<[^>\n]+>)?\s*([({\[])([\s\S]*)$/,
  );
  if (!wrapped) return input;
  const [, typeName, open, rest] = wrapped;
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  if (!rest.endsWith(close)) return undefined;
  const body = rest.slice(0, -1);
  if (open === '{') return parseRustObject(body);
  if (open === '[') return parseRustSequence(body);
  if (typeName === 'Some' || typeName === 'Ok' || typeName === 'Err') {
    return findTopLevelSeparator(body, '=') === -1
      ? parseRustValue(body)
      : undefined;
  }
  if (findTopLevelSeparator(body, '=') !== -1) return undefined;
  return parseRustSequence(body);
}

/** @param {string} body @returns {unknown[] | undefined} */
function parseRustSequence(body) {
  const result = [];
  for (const entry of splitTopLevel(body)) {
    if (!entry.trim()) continue;
    const parsedValue = parseRustValue(entry);
    if (parsedValue === undefined) return undefined;
    result.push(parsedValue);
  }
  return result;
}

/** @param {string} body @returns {object | undefined} */
function parseRustObject(body) {
  const entries = splitTopLevel(body).filter((item) => item.trim());
  if (!entries.length) return undefined;
  const result = {};
  for (const entry of entries) {
    const separator = findTopLevelSeparator(entry, ':');
    if (separator === -1) return undefined;
    const key = parseRustKey(entry.slice(0, separator));
    if (key === null) return undefined;
    const parsedValue = parseRustValue(entry.slice(separator + 1));
    if (parsedValue === undefined) return undefined;
    setOwnValue(result, key, parsedValue);
  }
  return result;
}

/** @param {string} value @returns {string | null} */
function parseRustKey(value) {
  const input = value.trim();
  if (isQuotedValue(input)) {
    const key = parseQuotedValue(input);
    return typeof key === 'string' ? key : null;
  }
  if (/^r#[A-Za-z_][\w$]*$/.test(input)) return input.slice(2);
  if (/^[A-Za-z_][\w$]*$/.test(input) || isNumericLiteral(input)) return input;
  return null;
}

/**
 * Parse the body of a typed Go literal. `%#v` output is comma-separated
 * (`main.User{Name:"Bob", Age:30}`) while `%+v` output with a type name is
 * whitespace-separated (`main.User{Name:Bob Age:30}`). Comma-split entries are
 * preferred; when the body has no top-level comma it is parsed as whitespace-
 * separated fields so both flag styles round-trip through the same type prefix.
 *
 * @param {string} body
 * @returns {object | null}
 */
function parseGoTypedBody(body) {
  if (splitTopLevel(body).length > 1) {
    return parseGoCommaObject(body);
  }
  return parseGoFields(body, 1) ?? parseGoCommaObject(body);
}

/** @param {string} value @returns {object | null} */
function parseGoTypedValue(value) {
  const input = value.trim().replace(/^&(?=[A-Za-z_])/, '');
  const mapType = input.match(/^map\[[^\]\n]+\]/);
  if (mapType) {
    const opener = findGoMapLiteralOpener(input, mapType[0].length);
    if (opener !== -1 && input.endsWith('}')) {
      const body = input.slice(opener + 1, -1);
      return body.trim() ? parseGoTypedBody(body) : {};
    }
  }
  const collection = parseGoTypedCollection(input);
  if (collection !== null) return collection;
  const wrapped = input.match(
    /^(?:[A-Za-z_][\w$]*\.)*[A-Za-z_][\w$]*(?:\[[^\n{}]*\])?\{([\s\S]*)\}$/,
  );
  if (!wrapped) return null;
  return parseGoTypedBody(wrapped[1]);
}

/**
 * Parse a Go typed slice or array literal such as `[]int{1, 2}`,
 * `[3]string{"a"}`, `[]*main.Item{...}`, or multi-dimensional `[][]int{...}`.
 * The element type between the length brackets and the `{` body is discarded;
 * elements are comma-separated like other `%#v` literals.
 *
 * @param {string} input
 * @returns {unknown[] | null}
 */
function parseGoTypedCollection(input) {
  const match = input.match(
    /^\*?(?:\[\d*\]\*?)+(?:[A-Za-z_][\w$]*\.)*[A-Za-z_][\w$]*\{([\s\S]*)\}$/,
  );
  if (!match) return null;
  return splitTopLevel(match[1])
    .filter((item) => item.trim())
    .map(parseGoValue);
}

/** @param {string} value @returns {object | null} */
function parseGoPrintedValue(value) {
  const input = value.trim();
  if (input.startsWith('map[') && input.endsWith(']')) {
    return parseGoFields(input.slice(4, -1), 1);
  }
  if (input.startsWith('{') && input.endsWith('}')) {
    return parseGoFields(input.slice(1, -1), 2);
  }
  return null;
}

/** @param {string} body @returns {object | null} */
function parseGoCommaObject(body) {
  const entries = splitTopLevel(body).filter((item) => item.trim());
  if (!entries.length) return null;
  const result = {};
  for (const entry of entries) {
    const separator = findTopLevelSeparator(entry, ':');
    if (separator === -1) return null;
    const rawKey = entry.slice(0, separator).trim();
    const key = isQuotedValue(rawKey) ? parseQuotedValue(rawKey) : rawKey;
    if (typeof key !== 'string' || !/^[A-Za-z_][\w.-]*$/.test(key)) return null;
    setOwnValue(result, key, parseGoValue(entry.slice(separator + 1)));
  }
  return result;
}

/**
 * Parse `%+v` struct and map output, where fields are separated by whitespace
 * rather than commas. At least two struct fields are required because a
 * one-field `{Key:value}` value is indistinguishable from JSON5.
 *
 * @param {string} body
 * @param {number} minimumFields
 * @returns {object | null}
 */
function parseGoFields(body, minimumFields) {
  const entries = splitGoFields(body);
  if (!entries || entries.length < minimumFields) return null;
  const result = {};
  for (const { key, value } of entries)
    setOwnValue(result, key, parseGoValue(value));
  return result;
}

/** @param {string} value @returns {unknown} */
function parseGoValue(value) {
  const input = value.trim();
  if (input.startsWith('&')) return parseGoValue(input.slice(1));
  if (input === 'nil') return null;
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (isNumericLiteral(input)) return Number(input);
  if (isQuotedValue(input)) return parseQuotedValue(input);
  if (input.startsWith('map[') && input.endsWith(']'))
    return parseGoFields(input.slice(4, -1), 1) ?? input;
  if (input.startsWith('{') && input.endsWith('}'))
    return parseGoFields(input.slice(1, -1), 1) ?? input;

  const slice = parseGoTypedCollection(input);
  if (slice !== null) return slice;
  if (input.startsWith('[') && input.endsWith(']'))
    return splitGoSequence(input.slice(1, -1)).map(parseGoValue);

  const typed = parseGoTypedValue(input);
  return typed ?? input;
}

/**
 * @param {string} body
 * @returns {{ key: string, value: string }[] | null}
 */
function splitGoFields(body) {
  const entries = [];
  let cursor = 0;
  while (cursor < body.length) {
    while (cursor < body.length && /[\s,]/.test(body[cursor])) cursor += 1;
    if (cursor >= body.length) break;
    const field = body.slice(cursor).match(/^([A-Za-z_][\w.-]*)\s*:/);
    if (!field) return null;
    const key = field[1];
    cursor += field[0].length;
    const valueStart = cursor;
    cursor = findGoValueEnd(body, cursor);
    const fieldValue = body.slice(valueStart, cursor).trim();
    if (!fieldValue) return null;
    entries.push({ key, value: fieldValue });
  }
  return entries;
}

/** @param {string} value @param {number} start */
function findGoValueEnd(value, start) {
  const stack = [];
  let quote = null;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '(') stack.push(')');
    else if (char === '}' || char === ']' || char === ')') {
      if (stack.at(-1) === char) stack.pop();
    } else if (stack.length === 0 && char === ',') {
      if (/^\s*[A-Za-z_][\w.-]*:(?!\s)/.test(value.slice(index + 1))) {
        return index;
      }
    } else if (stack.length === 0 && /\s/.test(char)) {
      // `%+v` emits `Key:Value` with no space after the colon, so a following
      // `word:` only starts a new field when its colon is immediately followed
      // by a value. `word: ` (colon then space) is prose inside the current
      // value (e.g. `Msg:connection refused: timeout`) and must not split it.
      if (/^\s+[A-Za-z_][\w.-]*:(?!\s)/.test(value.slice(index))) return index;
    }
  }
  return value.length;
}

/** @param {string} value */
function splitGoSequence(value) {
  const commaSeparated = splitTopLevel(value);
  if (commaSeparated.length > 1)
    return commaSeparated.filter((item) => item.trim());

  const items = [];
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
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '(') stack.push(')');
    else if (char === '}' || char === ']' || char === ')') {
      if (stack.at(-1) === char) stack.pop();
    } else if (stack.length === 0 && /\s/.test(char)) {
      const item = value.slice(start, index).trim();
      if (item) items.push(item);
      while (index + 1 < value.length && /\s/.test(value[index + 1]))
        index += 1;
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) items.push(last);
  return items;
}

/**
 * @param {string} body
 * @param {'=' | ':'} separator
 * @param {(value: string) => unknown} parseValue
 * @returns {object | null}
 */
function parseKeyValueObject(body, separator, parseValue) {
  const entries = splitKeyValueEntries(body, separator);
  if (!entries.length) return null;
  const result = {};
  for (const entry of entries) {
    const index = findTopLevelSeparator(entry, separator);
    if (index === -1) return null;
    const rawKey = entry.slice(0, index).trim();
    const key = isQuotedValue(rawKey) ? parseQuotedValue(rawKey) : rawKey;
    if (typeof key !== 'string' || !key) return null;
    setOwnValue(result, key, parseValue(entry.slice(index + 1)));
  }
  return result;
}

/**
 * Java, Kotlin, and C# string fields are commonly printed without quotes.
 * A comma inside such a value is indistinguishable from a delimiter until a
 * following top-level `key=` entry appears, so keep delimiter-less segments
 * attached to the preceding field.
 *
 * @param {string} body
 * @param {'=' | ':'} separator
 * @returns {string[]}
 */
function splitKeyValueEntries(body, separator) {
  const entries = [];
  for (const part of splitTopLevel(body)) {
    if (!part.trim()) continue;
    if (isKeyValueEntryStart(part, separator) || entries.length === 0) {
      entries.push(part);
    } else {
      entries[entries.length - 1] += `,${part}`;
    }
  }
  return entries;
}

/**
 * A continuation of an unquoted string may itself contain `=` or `:`. Only a
 * separator preceded by a valid field name starts the next entry.
 *
 * @param {string} value
 * @param {'=' | ':'} separator
 */
function isKeyValueEntryStart(value, separator) {
  const index = findTopLevelSeparator(value, separator);
  if (index === -1) return false;
  const key = value.slice(0, index).trim();
  return /^[A-Za-z_$][\w$.-]*$/.test(key) || isQuotedValue(key);
}

/** @param {string} value */
function splitTopLevel(value) {
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
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '(') stack.push(')');
    else if (char === '}' || char === ']' || char === ')') {
      if (stack.at(-1) === char) stack.pop();
    } else if (char === ',' && stack.length === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/** @param {string} value @param {'=' | ':'} separator */
function findTopLevelSeparator(value, separator) {
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
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '(') stack.push(')');
    else if (char === '}' || char === ']' || char === ')') {
      if (stack.at(-1) === char) stack.pop();
    } else if (char === separator && stack.length === 0) return index;
  }
  return -1;
}

/** @param {string} value */
function isQuotedValue(value) {
  const input = value.trim();
  return (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  );
}

/** @param {string} value */
function parseQuotedValue(value) {
  const input = value.trim();
  if (input.startsWith('"')) {
    try {
      return JSON.parse(input);
    } catch {
      return input.slice(1, -1);
    }
  }
  return input.slice(1, -1).replace(/\\(['\\])/g, '$1');
}

/** @param {string} value */
function isNumericLiteral(value) {
  return /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

/** @param {object} target @param {string} key @param {unknown} value */
function setOwnValue(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** @param {string} value */
export function isGoFormatStruct(value) {
  if (!value.startsWith('{') || !value.endsWith('}')) return false;
  if (/\/\/|\/\*/.test(value)) return false;
  const body = value.slice(1, -1);
  if (!/[^\s,]\s+[A-Za-z_][\w.-]*\s*:/.test(body)) return false;
  const fields = splitGoFields(body);
  return Boolean(fields && fields.length >= 2);
}

/** @param {string} value */
export function isJavaKeyValueObject(value) {
  return (
    value.startsWith('{') &&
    value.endsWith('}') &&
    findTopLevelSeparator(value.slice(1, -1), '=') !== -1
  );
}

/** @param {string} value */
export function isCSharpRecord(value) {
  const body = getCSharpRecordBody(value);
  return body !== null && findTopLevelSeparator(body, '=') !== -1;
}

/** @param {string} value */
export function isRustDebugCollection(value) {
  if (
    /\b(?:Some|None|Ok|Err)\b|\b(?:[A-Za-z_][\w$]*::)*[A-Z][\w$]*\s*\{/.test(
      value,
    )
  ) {
    return true;
  }
  // A `[...]` or `(...)` whose top-level items are themselves tuples is Rust
  // Debug output; JSON has no tuple syntax so bare `(` cannot appear otherwise.
  if (
    (value.startsWith('[') && value.endsWith(']')) ||
    (value.startsWith('(') && value.endsWith(')'))
  ) {
    return splitTopLevel(value.slice(1, -1)).some((item) =>
      item.trim().startsWith('('),
    );
  }
  return false;
}

/**
 * Locate the map literal after a Go map type. `interface{}` is part of the
 * type, so its braces must be skipped before parsing the literal itself.
 *
 * @param {string} value
 * @param {number} start
 */
export function findGoMapLiteralOpener(value, start) {
  let cursor = start;
  while (cursor < value.length) {
    const opener = value.indexOf('{', cursor);
    if (opener === -1 || value.slice(cursor, opener).includes('\n')) return -1;
    const typePrefix = value.slice(cursor, opener);
    if (!/^[\s\[\]A-Za-z0-9_.$]*$/.test(typePrefix)) return -1;
    if (/\binterface\s*$/.test(typePrefix) && value[opener + 1] === '}') {
      cursor = opener + 2;
      continue;
    }
    return opener;
  }
  return -1;
}

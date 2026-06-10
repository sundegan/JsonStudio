/**
 * @param {{ value: unknown; expandable: boolean; exists?: boolean }} cell
 */
export function isGridCellEditable(cell) {
  return cell.exists !== false && !cell.expandable && (
    cell.value === null ||
    typeof cell.value === 'string' ||
    typeof cell.value === 'number' ||
    typeof cell.value === 'boolean'
  );
}

/**
 * @param {{ key: string; isComposing?: boolean }} event
 */
export function isGridEditCommitKey(event) {
  return event.key === 'Enter' && !event.isComposing;
}

/**
 * @param {string} nextKey
 * @param {string[]} siblingKeys
 */
function validateGridKeyName(nextKey, siblingKeys) {
  if (!nextKey) return { ok: false, error: 'Key cannot be empty' };
  if (siblingKeys.includes(nextKey)) return { ok: false, error: 'Key already exists' };
  return { ok: true };
}

/**
 * @param {string} value
 */
function quoteSingleString(value) {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\b', '\\b')
    .replaceAll('\f', '\\f')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t')}'`;
}

/**
 * @param {unknown} currentValue
 * @param {string} input
 * @param {string} originalSource
 * @param {'JSON' | 'JSON5'} [dialect]
 */
export function formatGridEditValue(currentValue, input, originalSource, dialect = 'JSON') {
  if (typeof currentValue === 'string') {
    return {
      ok: true,
      text: originalSource.startsWith("'")
        ? quoteSingleString(input)
        : JSON.stringify(input),
    };
  }

  const trimmed = input.trim();

  if (typeof currentValue === 'number') {
    const strictJsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
    const json5Number = /^[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/;
    const isValidNumber = dialect === 'JSON5'
      ? json5Number.test(trimmed)
      : strictJsonNumber.test(trimmed);
    const parsedNumber = Number(trimmed);
    const preservesJson5SpecialNumber = dialect === 'JSON5' && (
      trimmed === 'Infinity' ||
      trimmed === '+Infinity' ||
      trimmed === '-Infinity' ||
      trimmed === 'NaN' ||
      trimmed === '+NaN' ||
      trimmed === '-NaN'
    );
    return isValidNumber && (Number.isFinite(parsedNumber) || preservesJson5SpecialNumber)
      ? { ok: true, text: trimmed }
      : { ok: false, error: 'Invalid number' };
  }

  if (typeof currentValue === 'boolean') {
    return trimmed === 'true' || trimmed === 'false'
      ? { ok: true, text: trimmed }
      : { ok: false, error: 'Expected true or false' };
  }

  if (currentValue === null) {
    return trimmed === 'null'
      ? { ok: true, text: trimmed }
      : { ok: false, error: 'Expected null' };
  }

  return { ok: false, error: 'Value is not editable' };
}

/**
 * @param {string} content
 * @param {Record<string, any>} pointers
 * @param {string} path
 * @param {unknown} currentValue
 * @param {string} input
 * @param {'JSON' | 'JSON5'} [dialect]
 */
export function createGridValueEdit(content, pointers, path, currentValue, input, dialect = 'JSON') {
  const pointer = pointers[path];
  if (!pointer?.value || !pointer?.valueEnd) {
    return { ok: false, error: 'Value range not found' };
  }

  const start = pointer.value.pos;
  const end = pointer.valueEnd.pos;
  const originalSource = content.slice(start, end);
  const formatted = formatGridEditValue(currentValue, input, originalSource, dialect);
  if (!formatted.ok) return formatted;

  return {
    ok: true,
    edit: {
      start,
      end,
      text: formatted.text,
    },
  };
}

/**
 * @param {Record<string, any>} pointers
 * @param {string} path
 * @param {string} nextKey
 * @param {string[]} siblingKeys
 */
export function createGridKeyEdit(pointers, path, nextKey, siblingKeys) {
  const validation = validateGridKeyName(nextKey, siblingKeys);
  if (!validation.ok) return validation;

  const pointer = pointers[path];
  if (!pointer?.key || !pointer?.keyEnd) {
    return { ok: false, error: 'Key range not found' };
  }

  return {
    ok: true,
    edit: {
      start: pointer.key.pos,
      end: pointer.keyEnd.pos,
      text: JSON.stringify(nextKey),
    },
  };
}

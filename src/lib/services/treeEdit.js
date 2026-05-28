/**
 * @param {{ parentType?: 'object' | 'array' }} node
 */
export function isTreeKeyEditable(node) {
  return node.parentType === 'object';
}

/**
 * @param {string} nextKey
 * @param {string[]} siblingKeys
 */
export function validateTreeKeyName(nextKey, siblingKeys) {
  if (!nextKey) return { ok: false, error: 'Key cannot be empty' };
  if (siblingKeys.includes(nextKey)) return { ok: false, error: 'Key already exists' };
  return { ok: true };
}

/**
 * @param {Record<string, any>} pointers
 * @param {string} path
 * @param {string} nextKey
 * @param {string[]} siblingKeys
 */
export function createTreeKeyEdit(pointers, path, nextKey, siblingKeys) {
  const validation = validateTreeKeyName(nextKey, siblingKeys);
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

/**
 * @param {string} content
 * @param {Record<string, any>} pointers
 * @param {string} path
 * @param {unknown} value
 */
export function createTreeValueCopyText(content, pointers, path, value) {
  const pointer = pointers[path];
  const start = pointer?.value?.pos;
  const end = pointer?.valueEnd?.pos;

  if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
    return content.slice(start, end);
  }

  return JSON.stringify(value) ?? 'null';
}

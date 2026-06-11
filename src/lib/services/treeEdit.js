/**
 * @param {{ parentType?: 'object' | 'array' }} node
 */
export function isTreeKeyEditable(node) {
  return node.parentType === 'object';
}

/**
 * @param {string} nextKey
 * @param {string[]} parentKeys
 * @param {string} [currentKey]
 */
export function validateTreeKeyName(nextKey, parentKeys, currentKey) {
  if (!nextKey) return { ok: false, error: 'Key cannot be empty' };
  if (nextKey !== currentKey && parentKeys.includes(nextKey)) {
    return { ok: false, error: 'Key already exists' };
  }
  return { ok: true };
}

/**
 * @param {Record<string, any>} pointers
 * @param {string} path
 * @param {string} nextKey
 * @param {string[]} parentKeys
 * @param {string} [currentKey]
 */
export function createTreeKeyEdit(pointers, path, nextKey, parentKeys, currentKey) {
  const validation = validateTreeKeyName(nextKey, parentKeys, currentKey);
  if (!validation.ok) return validation;

  const pointer = pointers[path];
  if (pointer?.keyStart == null || pointer?.keyEnd == null) {
    return { ok: false, error: 'Key range not found' };
  }

  return {
    ok: true,
    edit: {
      start: pointer.keyStart,
      end: pointer.keyEnd,
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
  const start = pointer?.valueStart;
  const end = pointer?.valueEnd;

  if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
    return content.slice(start, end);
  }

  return JSON.stringify(value) ?? 'null';
}

/**
 * @typedef {'before' | 'inside' | 'after'} TreeDropPosition
 * @typedef {{ data: unknown; sourcePath: string; targetPath: string; position: TreeDropPosition }} TreeMoveRequest
 * @typedef {{ ok: true; data: unknown; movedPath: string; editKey?: boolean } | { ok: false; error: string }} TreeMoveResult
 */

/**
 * @param {string} segment
 */
function decodePointerSegment(segment) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * @param {string | number} segment
 */
function encodePointerSegment(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * @param {string} path
 */
function splitPointer(path) {
  if (path === '') return [];
  return path.split('/').slice(1).map(decodePointerSegment);
}

/**
 * @param {string[]} segments
 */
function joinPointer(segments) {
  return segments.length === 0
    ? ''
    : `/${segments.map(encodePointerSegment).join('/')}`;
}

/**
 * @param {unknown} value
 */
function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {unknown} value
 * @returns {'object' | 'array' | null}
 */
function getContainerType(value) {
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object') return 'object';
  return null;
}

/**
 * @param {unknown} data
 * @param {string[]} segments
 * @returns {any}
 */
function getAtPath(data, segments) {
  /** @type {any} */
  let current = data;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (current && typeof current === 'object') {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * @param {unknown} data
 * @param {string[]} parentSegments
 * @returns {{ container: any; type: 'object' | 'array' } | null}
 */
function getParentInfo(data, parentSegments) {
  const container = getAtPath(data, parentSegments);
  const type = getContainerType(container);
  return type ? { container, type } : null;
}

/**
 * @param {{ container: any; type: 'object' | 'array' }} parent
 * @param {string} key
 */
function hasContainerKey(parent, key) {
  if (parent.type === 'array') {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < parent.container.length;
  }
  return Object.prototype.hasOwnProperty.call(parent.container, key);
}

/**
 * @param {string} sourcePath
 * @param {string} targetPath
 */
function isSelfOrDescendantDrop(sourcePath, targetPath) {
  return targetPath === sourcePath || targetPath.startsWith(`${sourcePath}/`);
}

/**
 * @param {unknown} position
 */
function isTreeDropPosition(position) {
  return position === 'before' || position === 'inside' || position === 'after';
}

/**
 * @param {string[]} sourceParentSegments
 * @param {'object' | 'array'} sourceParentType
 * @param {string} sourceKey
 * @param {string[]} targetSegments
 */
function adjustPathAfterSourceRemoval(sourceParentSegments, sourceParentType, sourceKey, targetSegments) {
  if (sourceParentType !== 'array') return targetSegments;
  if (targetSegments.length <= sourceParentSegments.length) return targetSegments;
  if (!sourceParentSegments.every((segment, index) => targetSegments[index] === segment)) {
    return targetSegments;
  }

  const sourceIndex = Number(sourceKey);
  const targetIndexPosition = sourceParentSegments.length;
  const targetIndex = Number(targetSegments[targetIndexPosition]);
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex) || targetIndex <= sourceIndex) {
    return targetSegments;
  }

  const adjusted = [...targetSegments];
  adjusted[targetIndexPosition] = String(targetIndex - 1);
  return adjusted;
}

/**
 * @param {string[]} sourceSegments
 */
function createArrayElementObjectKey(sourceSegments) {
  const index = sourceSegments.at(-1);
  const parentKey = sourceSegments.at(-2);
  return parentKey == null ? `[${index}]` : `${parentKey}[${index}]`;
}

/**
 * @param {Record<string, unknown>} targetContainer
 * @param {string} baseKey
 */
function createUniqueObjectKey(targetContainer, baseKey) {
  if (!Object.prototype.hasOwnProperty.call(targetContainer, baseKey)) return baseKey;

  let index = 2;
  let nextKey = `${baseKey} ${index}`;
  while (Object.prototype.hasOwnProperty.call(targetContainer, nextKey)) {
    index += 1;
    nextKey = `${baseKey} ${index}`;
  }
  return nextKey;
}

/**
 * @param {TreeMoveRequest} request
 * @returns {TreeMoveResult}
 */
export function createTreeDragMove({ data, sourcePath, targetPath, position }) {
  if (!isTreeDropPosition(position)) return { ok: false, error: 'treeView.dragInvalidTarget' };
  if (!sourcePath || !targetPath) return { ok: false, error: 'treeView.dragInvalidTarget' };
  if (isSelfOrDescendantDrop(sourcePath, targetPath)) {
    return { ok: false, error: 'treeView.dragIntoDescendant' };
  }

  const nextData = cloneJsonValue(data);
  const sourceSegments = splitPointer(sourcePath);
  const targetSegments = splitPointer(targetPath);
  const sourceKey = sourceSegments.at(-1);
  if (sourceKey == null) return { ok: false, error: 'treeView.dragInvalidTarget' };

  const sourceParentSegments = sourceSegments.slice(0, -1);
  const sourceParent = getParentInfo(nextData, sourceParentSegments);
  if (!sourceParent) return { ok: false, error: 'treeView.dragInvalidTarget' };
  if (!hasContainerKey(sourceParent, sourceKey)) return { ok: false, error: 'treeView.dragInvalidTarget' };

  const sourceValue = sourceParent.type === 'array'
    ? sourceParent.container[Number(sourceKey)]
    : sourceParent.container[sourceKey];

  if (position === 'inside') {
    const targetContainer = getAtPath(nextData, targetSegments);
    const targetType = getContainerType(targetContainer);
    if (!targetType) {
      return { ok: false, error: 'treeView.dragInvalidTarget' };
    }

    const shouldWrapObjectFieldForArray = sourceParent.type === 'object' && targetType === 'array';
    const shouldNameArrayElementForObject = sourceParent.type === 'array' && targetType === 'object';
    if (targetType !== sourceParent.type && !shouldWrapObjectFieldForArray && !shouldNameArrayElementForObject) {
      return { ok: false, error: 'treeView.dragInvalidTarget' };
    }

    if (
      targetType === 'object' &&
      !shouldNameArrayElementForObject &&
      Object.prototype.hasOwnProperty.call(targetContainer, sourceKey)
    ) {
      return { ok: false, error: 'treeView.dragDuplicateKey' };
    }

    removeSource(sourceParent, sourceKey);
    const targetSegmentsAfterRemoval = adjustPathAfterSourceRemoval(
      sourceParentSegments,
      sourceParent.type,
      sourceKey,
      targetSegments,
    );

    if (shouldWrapObjectFieldForArray) {
      const movedPath = insertInside(
        targetContainer,
        targetType,
        sourceKey,
        { [sourceKey]: sourceValue },
        targetSegmentsAfterRemoval,
      );
      return { ok: true, data: nextData, movedPath };
    }

    if (shouldNameArrayElementForObject) {
      const nextKey = createUniqueObjectKey(
        targetContainer,
        createArrayElementObjectKey(sourceSegments),
      );
      const movedPath = insertInside(targetContainer, targetType, nextKey, sourceValue, targetSegmentsAfterRemoval);
      return { ok: true, data: nextData, movedPath, editKey: true };
    }

    const movedPath = insertInside(targetContainer, targetType, sourceKey, sourceValue, targetSegmentsAfterRemoval);
    return { ok: true, data: nextData, movedPath };
  }

  const targetKey = targetSegments.at(-1);
  if (targetKey == null) return { ok: false, error: 'treeView.dragInvalidTarget' };

  const targetParentSegments = targetSegments.slice(0, -1);
  const targetParent = getParentInfo(nextData, targetParentSegments);
  if (!targetParent || targetParent.type !== sourceParent.type) {
    return { ok: false, error: 'treeView.dragInvalidTarget' };
  }
  if (!hasContainerKey(targetParent, targetKey)) return { ok: false, error: 'treeView.dragInvalidTarget' };

  if (
    targetParent.type === 'object' &&
    sourceParent.container !== targetParent.container &&
    Object.prototype.hasOwnProperty.call(targetParent.container, sourceKey)
  ) {
    return { ok: false, error: 'treeView.dragDuplicateKey' };
  }

  const sameParent = sourceParent.container === targetParent.container;
  removeSource(sourceParent, sourceKey);
  const targetParentSegmentsAfterRemoval = adjustPathAfterSourceRemoval(
    sourceParentSegments,
    sourceParent.type,
    sourceKey,
    targetParentSegments,
  );
  const movedPath = insertBeside(
    targetParent,
    targetParentSegmentsAfterRemoval,
    sourceKey,
    sourceValue,
    targetKey,
    position,
    sameParent,
  );

  return { ok: true, data: nextData, movedPath };
}

/**
 * @param {{ container: any; type: 'object' | 'array' }} sourceParent
 * @param {string} sourceKey
 */
function removeSource(sourceParent, sourceKey) {
  if (sourceParent.type === 'array') {
    sourceParent.container.splice(Number(sourceKey), 1);
    return;
  }
  delete sourceParent.container[sourceKey];
}

/**
 * @param {any} targetContainer
 * @param {'object' | 'array'} targetType
 * @param {string} sourceKey
 * @param {unknown} sourceValue
 * @param {string[]} targetSegments
 */
function insertInside(targetContainer, targetType, sourceKey, sourceValue, targetSegments) {
  if (targetType === 'array') {
    const nextIndex = targetContainer.length;
    targetContainer.push(sourceValue);
    return joinPointer([...targetSegments, String(nextIndex)]);
  }

  targetContainer[sourceKey] = sourceValue;
  return joinPointer([...targetSegments, sourceKey]);
}

/**
 * @param {{ container: any; type: 'object' | 'array' }} targetParent
 * @param {string[]} targetParentSegments
 * @param {string} sourceKey
 * @param {unknown} sourceValue
 * @param {string} targetKey
 * @param {'before' | 'after'} position
 * @param {boolean} sameParent
 */
function insertBeside(targetParent, targetParentSegments, sourceKey, sourceValue, targetKey, position, sameParent) {
  if (targetParent.type === 'array') {
    const sourceIndex = Number(sourceKey);
    const originalTargetIndex = Number(targetKey);
    const targetIndex = sameParent && sourceIndex < originalTargetIndex
      ? originalTargetIndex - 1
      : originalTargetIndex;
    const insertionIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    targetParent.container.splice(insertionIndex, 0, sourceValue);
    return joinPointer([...targetParentSegments, String(insertionIndex)]);
  }

  const entries = Object.entries(targetParent.container);
  const targetIndex = entries.findIndex(([key]) => key === targetKey);
  const insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
  /** @type {Array<[string, unknown]>} */
  const nextEntries = [
    ...entries.slice(0, insertionIndex),
    [sourceKey, sourceValue],
    ...entries.slice(insertionIndex),
  ];

  for (const key of Object.keys(targetParent.container)) {
    delete targetParent.container[key];
  }
  for (const [key, value] of nextEntries) {
    targetParent.container[key] = value;
  }

  return joinPointer([...targetParentSegments, sourceKey]);
}

<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { t } from '$lib/i18n';
  import { createGridValueEdit, isGridEditCommitKey } from '$lib/services/gridEdit.js';
  import { openExternalUrl } from '$lib/services/externalLinks.js';
  import {
    getCachedJsonTreeModel,
    getJsonTreeModelAsync,
  } from '$lib/services/jsonTreeModelCache.js';
  import { createTreeDragMove, createTreeKeyEdit, createTreeValueCopyText, isTreeKeyEditable as isEditableTreeKey } from '$lib/services/treeEdit.js';
  import { runTreeQuery, type QueryMode } from '$lib/services/treeQuery';
  import ConfirmDialog from '../dialogs/ConfirmDialog.svelte';
  import type MonacoEditor from './MonacoEditor.svelte';

  type TreeNode = {
    key: string;
    value: unknown;
    type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
    path: string;
    parentType: 'object' | 'array';
    parentKeys: string[];
    children?: TreeNode[];
    startOffset: number;
    endOffset: number;
  };

  type TreeEditState = {
    kind: 'key' | 'value';
    path: string;
    input: string;
    error: string;
  };

  type TreeDropPosition = 'before' | 'inside' | 'after';

  type TreeRow = {
    node: TreeNode;
    depth: number;
    isLast: boolean;
    parentLines: boolean[];
  };

  type VirtualTreeWindow = {
    rows: TreeRow[];
    totalRows: number;
    offset: number;
  };

  type VisibleTreeIndex = {
    totalRows: number;
    siblingOffsets: WeakMap<TreeNode[], Uint32Array>;
  };

  type QueryExample = {
    query: string;
    result: string;
  };

  let { content, editor, tabId } = $props<{
    content: string;
    editor: MonacoEditor | null;
    tabId: string;
  }>();

  const QUERY_DOCS_URL: Record<QueryMode, string> = {
    jmespath: 'https://jmespath.org',
    jsonpath: 'https://datatracker.ietf.org/doc/html/rfc9535',
  };
  const EXAMPLE_DATA = `{
  "people": [
    {"name": "Alice", "age": 20},
    {"name": "Bob",   "age": 30}
  ],
  "meta": {"count": 2}
}`;
  const QUERY_EXAMPLES: Record<QueryMode, QueryExample[]> = {
    jmespath: [
      { query: 'people[0].name', result: '"Alice"' },
      { query: 'people[*].name', result: '["Alice", "Bob"]' },
      { query: 'people[?age > `25`].name', result: '["Bob"]' },
      { query: 'meta.count', result: '2' },
      { query: 'length(people)', result: '2' },
    ],
    jsonpath: [
      { query: '$.people[0].name', result: '"Alice"' },
      { query: '$.people[*].name', result: '["Alice", "Bob"]' },
      { query: '$.people[?(@.age > 25)].name', result: '["Bob"]' },
      { query: '$.meta.count', result: '2' },
      { query: '$..name', result: '["Alice", "Bob"]' },
    ],
  };

  const dispatch = createEventDispatcher<{ toast: { message: string } }>();
  let treeNodes = $state.raw<TreeNode[]>([]);
  let treeError = $state('');
  let isLoading = $state(false);
  let previousContent = $state('');
  let previousTabId = $state('');
  let renderedTabId = '';
  let parsedPointers = $state.raw<Record<string, any>>({});
  let parsedDialect = $state<'JSON' | 'JSON5'>('JSON');
  let hasDuplicateSourceKeys = $state(false);
  let rootData = $state.raw<unknown>(null);
  let selectedPath = $state<string | null>(null);
  let searchQuery = $state('');
  let queryMode = $state<QueryMode>('jmespath');
  let queryModeMenuOpen = $state(false);
  let queryError = $state('');
  let queryMatchedRoot = $state(false);
  let queryMatches = $state<Set<string>>(new Set());
  let queryExpandedNodes = $state<Set<string>>(new Set());
  let queryRunId = 0;
  let expandedNodes = $state<Set<string>>(new Set());
  let isAllExpanded = $state(false);
  let helpOpen = $state(false);
  let treeEdit = $state<TreeEditState | null>(null);
  let treeEditInput = $state<HTMLInputElement | null>(null);
  let draggedPath = $state<string | null>(null);
  let dragTargetPath = $state<string | null>(null);
  let dragPosition = $state<TreeDropPosition | null>(null);
  let pendingMovedPath = $state<string | null>(null);
  let pendingEditKeyPath = $state<string | null>(null);
  let pointerDragStart = $state<{ path: string; x: number; y: number } | null>(null);
  let isPointerDragging = $state(false);
  let suppressNextTreeClick = $state(false);
  let treeNodeByPath = $state.raw<Map<string, TreeNode>>(new Map());
  let duplicateKeysDialogOpen = $state(false);
  const TREE_BUILD_DEBOUNCE_MS = 100;
  const TREE_ROW_HEIGHT = 26;
  const TREE_OVERSCAN_ROWS = 20;
  let treeBuildTimer: ReturnType<typeof setTimeout> | null = null;
  let treeBuildFrame: number | null = null;
  let treeBuildVersion = 0;
  let completedTreeBuildVersion = $state(0);
  let treeScrollTop = $state(0);
  let treeViewportHeight = $state(400);
  let treeContentElement = $state<HTMLDivElement | null>(null);
  let visibleTreeIndex = $derived.by(() => buildVisibleTreeIndex(
    treeNodes,
    expandedNodes,
    queryExpandedNodes,
  ));
  let virtualTreeWindow = $derived.by(() => buildVirtualTreeWindow(
    treeNodes,
    expandedNodes,
    queryExpandedNodes,
    visibleTreeIndex,
    treeScrollTop,
    treeViewportHeight,
  ));

  // Build tree when the active document changes.
  $effect(() => {
    if (content !== previousContent || tabId !== previousTabId) {
      previousContent = content;
      previousTabId = tabId;
      treeEdit = null;
      scheduleTreeBuild(tabId, content);
    }
  });

  onDestroy(() => {
    if (treeBuildTimer) clearTimeout(treeBuildTimer);
    if (treeBuildFrame !== null) cancelAnimationFrame(treeBuildFrame);
  });

  function scheduleTreeBuild(sourceTabId: string, source: string) {
    if (treeBuildTimer) clearTimeout(treeBuildTimer);
    if (treeBuildFrame !== null) cancelAnimationFrame(treeBuildFrame);
    isLoading = false;
    treeError = '';
    const version = ++treeBuildVersion;
    const cached = getCachedJsonTreeModel(sourceTabId, source);
    if (cached) {
      applyTreeModel(cached, version, sourceTabId);
      return;
    }

    treeBuildFrame = requestAnimationFrame(() => {
      treeBuildFrame = null;
      treeBuildTimer = setTimeout(() => {
        treeBuildTimer = null;
        if (
          version !== treeBuildVersion ||
          tabId !== sourceTabId ||
          content !== source
        ) return;
        void buildTree(sourceTabId, source, version);
      }, TREE_BUILD_DEBOUNCE_MS);
    });
  }

  $effect(() => {
    const query = searchQuery.trim();
    const data = rootData;
    const nodes = treeNodes;
    void updateQueryMatches(queryMode, query, data, nodes);
  });

  async function buildTree(sourceTabId: string, source: string, version: number) {
    if (!source.trim()) {
      treeNodes = [];
      treeNodeByPath = new Map();
      pendingMovedPath = null;
      pendingEditKeyPath = null;
      treeError = '';
      rootData = null;
      parsedPointers = {};
      hasDuplicateSourceKeys = false;
      queryError = '';
      queryMatchedRoot = false;
      isAllExpanded = false;
      resetTreeScroll();
      isLoading = false;
      completedTreeBuildVersion = version;
      return;
    }

    isLoading = true;
    treeError = '';

    try {
      const parsed = await getJsonTreeModelAsync(sourceTabId, source);
      if (
        version !== treeBuildVersion ||
        tabId !== sourceTabId ||
        content !== source
      ) return;
      applyTreeModel(parsed, version, sourceTabId);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (
        version !== treeBuildVersion ||
        tabId !== sourceTabId ||
        content !== source
      ) return;
      treeError = e instanceof Error ? e.message : 'Failed to parse JSON';
      treeNodes = [];
      treeNodeByPath = new Map();
      pendingMovedPath = null;
      pendingEditKeyPath = null;
      rootData = null;
      parsedPointers = {};
      hasDuplicateSourceKeys = false;
      isAllExpanded = false;
      resetTreeScroll();
      completedTreeBuildVersion = version;
    } finally {
      if (
        version === treeBuildVersion &&
        tabId === sourceTabId &&
        content === source
      ) {
        isLoading = false;
      }
    }
  }

  function applyTreeModel(
    parsed: Awaited<ReturnType<typeof getJsonTreeModelAsync>>,
    version: number,
    sourceTabId: string,
  ) {
    const preserveViewState = renderedTabId === sourceTabId;
    const preservedScrollTop = treeContentElement?.scrollTop ?? treeScrollTop;
    const wasAllExpanded = isAllExpanded;
    treeError = '';
    rootData = parsed.rootData;
    parsedPointers = parsed.pointers;
    parsedDialect = parsed.dialect;
    hasDuplicateSourceKeys = parsed.hasDuplicateSourceKeys;
    const nodes = parsed.nodes as TreeNode[];
    treeNodes = nodes;
    treeNodeByPath = parsed.nodeIndex as Map<string, TreeNode>;

    const nextExpanded = preserveViewState
      ? new Set(
          [...expandedNodes].filter((path) => {
            const node = treeNodeByPath.get(path);
            return node ? hasChildren(node) : false;
          }),
        )
      : new Set(nodes.filter((node) => hasChildren(node)).map((node) => node.path));
    if (pendingMovedPath) {
      getAncestorPaths(pendingMovedPath).forEach((path) => nextExpanded.add(path));
      selectedPath = pendingMovedPath;
      pendingMovedPath = null;
    }
    if (pendingEditKeyPath) {
      treeEdit = createTreeKeyEditState(pendingEditKeyPath);
      pendingEditKeyPath = null;
      tick().then(() => {
        treeEditInput?.focus();
        treeEditInput?.select();
      });
    }
    expandedNodes = nextExpanded;
    if (preserveViewState && wasAllExpanded) {
      const expandableNodes = [...treeNodeByPath.values()].filter((node) => hasChildren(node));
      isAllExpanded = expandableNodes.length > 0
        && expandableNodes.every((node) => nextExpanded.has(node.path));
    } else {
      isAllExpanded = false;
    }
    renderedTabId = sourceTabId;
    if (preserveViewState) {
      tick().then(() => {
        if (tabId !== sourceTabId || renderedTabId !== sourceTabId) return;
        if (!treeContentElement) {
          treeScrollTop = preservedScrollTop;
          return;
        }
        treeContentElement.scrollTop = preservedScrollTop;
        treeScrollTop = treeContentElement.scrollTop;
      });
    } else {
      resetTreeScroll();
    }
    isLoading = false;
    completedTreeBuildVersion = version;
  }

  function createTreeKeyEditState(path: string): TreeEditState | null {
    const node = treeNodeByPath.get(path);
    if (!node || !isTreeKeyEditable(node)) return null;

    return {
      kind: 'key',
      path,
      input: node.key,
      error: '',
    };
  }

  function getAncestorPaths(path: string): string[] {
    const segments = path.split('/').slice(1);
    return segments.slice(0, -1).map((_, index) => `/${segments.slice(0, index + 1).join('/')}`);
  }

  function formatValue(node: TreeNode): string {
    if (node.type === 'string') {
      const str = String(node.value);
      if (str.length > 50) {
        return str.slice(0, 47) + '...';
      }
      return str;
    }
    if (node.type === 'null') {
      return 'null';
    }
    if (node.type === 'boolean') {
      return String(node.value);
    }
    if (node.type === 'number') {
      return String(node.value);
    }
    return '';
  }

  function hasChildren(node: TreeNode): boolean {
    return (node.type === 'object' || node.type === 'array') && (node.children?.length ?? 0) > 0;
  }

  function getChildCount(node: TreeNode): number {
    return node.children?.length || 0;
  }

  function buildVisibleTreeIndex(
    nodes: TreeNode[],
    expanded: Set<string>,
    queryExpanded: Set<string>,
  ): VisibleTreeIndex {
    const siblingOffsets = new WeakMap<TreeNode[], Uint32Array>();

    function indexSiblings(siblings: TreeNode[]): number {
      const offsets = new Uint32Array(siblings.length + 1);

      siblings.forEach((node, index) => {
        let rowCount = 1;
        if (
          node.children
          && (expanded.has(node.path) || queryExpanded.has(node.path))
        ) {
          rowCount += indexSiblings(node.children);
        }
        offsets[index + 1] = offsets[index] + rowCount;
      });

      siblingOffsets.set(siblings, offsets);
      return offsets[offsets.length - 1];
    }

    return {
      totalRows: indexSiblings(nodes),
      siblingOffsets,
    };
  }

  function findSiblingIndex(offsets: Uint32Array, rowIndex: number): number {
    let low = 0;
    let high = offsets.length - 1;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (offsets[middle + 1] <= rowIndex) low = middle + 1;
      else high = middle;
    }

    return low;
  }

  function buildVirtualTreeWindow(
    nodes: TreeNode[],
    expanded: Set<string>,
    queryExpanded: Set<string>,
    index: VisibleTreeIndex,
    scrollTop: number,
    viewportHeight: number,
  ): VirtualTreeWindow {
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN_ROWS,
    );
    const endIndex = Math.ceil(
      (scrollTop + viewportHeight) / TREE_ROW_HEIGHT,
    ) + TREE_OVERSCAN_ROWS;
    const rows: TreeRow[] = [];

    if (expanded.size === 0 && queryExpanded.size === 0) {
      const visibleNodes = nodes.slice(startIndex, endIndex);
      return {
        rows: visibleNodes.map((node, index) => ({
          node,
          depth: 0,
          isLast: startIndex + index === nodes.length - 1,
          parentLines: [],
        })),
        totalRows: nodes.length,
        offset: startIndex * TREE_ROW_HEIGHT,
      };
    }

    function collectRows(
      siblings: TreeNode[],
      depth: number,
      parentLines: boolean[],
      rangeStart: number,
      rangeEnd: number,
    ) {
      const offsets = index.siblingOffsets.get(siblings);
      if (!offsets || rangeStart >= rangeEnd || siblings.length === 0) return;

      let siblingIndex = findSiblingIndex(offsets, rangeStart);
      while (siblingIndex < siblings.length && offsets[siblingIndex] < rangeEnd) {
        const node = siblings[siblingIndex];
        const nodeStart = offsets[siblingIndex];
        const nodeEnd = offsets[siblingIndex + 1];
        const isLast = siblingIndex === siblings.length - 1;

        if (nodeStart >= rangeStart && nodeStart < rangeEnd) {
          rows.push({ node, depth, isLast, parentLines });
        }

        if (
          node.children
          && (expanded.has(node.path) || queryExpanded.has(node.path))
          && nodeEnd > nodeStart + 1
        ) {
          collectRows(
            node.children,
            depth + 1,
            depth === 0 ? [] : [...parentLines, !isLast],
            Math.max(0, rangeStart - nodeStart - 1),
            Math.min(nodeEnd - nodeStart - 1, rangeEnd - nodeStart - 1),
          );
        }

        siblingIndex += 1;
      }
    }

    collectRows(nodes, 0, [], startIndex, Math.min(endIndex, index.totalRows));
    return {
      rows,
      totalRows: index.totalRows,
      offset: startIndex * TREE_ROW_HEIGHT,
    };
  }

  function resetTreeScroll() {
    treeScrollTop = 0;
    if (treeContentElement) treeContentElement.scrollTop = 0;
  }

  function handleTreeScroll(event: Event) {
    treeScrollTop = (event.currentTarget as HTMLDivElement).scrollTop;
  }

  function syncTreeScrollPosition() {
    tick().then(() => {
      if (treeContentElement) treeScrollTop = treeContentElement.scrollTop;
    });
  }

  function toggleNode(node: TreeNode) {
    if (expandedNodes.has(node.path)) {
      expandedNodes.delete(node.path);
    } else {
      expandedNodes.add(node.path);
    }
    expandedNodes = new Set(expandedNodes);
    isAllExpanded = false;
    syncTreeScrollPosition();
  }

  function selectNode(node: TreeNode) {
    const editorInstance = editor?.getEditorInstance();
    const model = editorInstance?.getModel();
    if (!editorInstance || !model) return;

    selectedPath = node.path;

    const endOffset = node.endOffset <= node.startOffset ? node.startOffset + 1 : node.endOffset;
    const start = model.getPositionAt(node.startOffset);
    const end = model.getPositionAt(endOffset);
    
    editorInstance.setSelection({
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column
    });
    
    editorInstance.revealPositionInCenter(start);
    editorInstance.focus();
  }

  function handleTreeNodeClick(event: MouseEvent, node: TreeNode) {
    if (suppressNextTreeClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextTreeClick = false;
      return;
    }
    selectNode(node);
  }

  function handleNodeKeydown(event: KeyboardEvent, node: TreeNode) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectNode(node);
  }

  function isTreeValueEditable(node: TreeNode) {
    return !hasDuplicateSourceKeys && node.type !== 'object' && node.type !== 'array';
  }

  function isTreeKeyEditable(node: TreeNode) {
    return !hasDuplicateSourceKeys && isEditableTreeKey(node);
  }

  function canAttemptTreeKeyEdit(node: TreeNode) {
    return isEditableTreeKey(node);
  }

  function isTreeDragEnabled() {
    if (parsedDialect !== 'JSON') return false;
    if (hasDuplicateSourceKeys) return false;
    return !treeError && rootData !== null && searchQuery.trim() === '';
  }

  function getTreeDropPosition(clientY: number, element: HTMLElement, node: TreeNode): TreeDropPosition {
    const rect = element.getBoundingClientRect();
    const y = clientY - rect.top;
    if (node.type !== 'object' && node.type !== 'array') {
      return y < rect.height * 0.5 ? 'before' : 'after';
    }
    if (y < rect.height * 0.25) return 'before';
    if (y > rect.height * 0.75) return 'after';
    return 'inside';
  }

  function clearTreeDragState() {
    draggedPath = null;
    dragTargetPath = null;
    dragPosition = null;
    pointerDragStart = null;
    isPointerDragging = false;
  }

  function showTreeDragError(errorKey: string) {
    dispatch('toast', { message: $t(errorKey) });
  }

  function showDuplicateKeysReadOnly() {
    duplicateKeysDialogOpen = true;
  }

  function getTreePointerDropTarget(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY);
    const targetElement = element?.closest<HTMLElement>('[data-tree-path]');
    const targetPath = targetElement?.dataset.treePath;
    const targetNode = targetPath ? treeNodeByPath.get(targetPath) : null;

    if (!targetElement || !targetNode) {
      return null;
    }

    return {
      path: targetNode.path,
      position: getTreeDropPosition(clientY, targetElement, targetNode),
    };
  }

  function updateTreePointerDragTarget(clientX: number, clientY: number) {
    const dropTarget = getTreePointerDropTarget(clientX, clientY);

    if (!dropTarget) {
      dragTargetPath = null;
      dragPosition = null;
      return;
    }

    dragTargetPath = dropTarget.path;
    dragPosition = dropTarget.position;
  }

  function moveTreeNode(sourcePath: string, targetPath: string, position: TreeDropPosition) {
    if (hasDuplicateSourceKeys) {
      showDuplicateKeysReadOnly();
      return;
    }
    if (!isTreeDragEnabled()) {
      showTreeDragError('treeView.dragJsonOnly');
      return;
    }

    const result = createTreeDragMove({
      data: rootData,
      sourcePath,
      targetPath,
      position,
    });

    if (!result.ok) {
      showTreeDragError(result.error);
      return;
    }

    pendingMovedPath = result.movedPath;
    pendingEditKeyPath = result.editKey ? result.movedPath : null;
    selectedPath = result.movedPath;
    expandedNodes = new Set([...expandedNodes, ...getAncestorPaths(result.movedPath)]);
    editor?.setValue(JSON.stringify(result.data, null, 2));
    dispatch('toast', { message: $t('treeView.dragMoved') });
  }

  function handleTreePointerDown(event: PointerEvent, node: TreeNode) {
    if (event.button !== 0) return;
    if (event.detail > 1) return;

    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, textarea')) return;

    draggedPath = node.path;
    pointerDragStart = { path: node.path, x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleTreePointerMove(event: PointerEvent) {
    const start = pointerDragStart;
    if (!start) return;

    const moveX = Math.abs(event.clientX - start.x);
    const moveY = Math.abs(event.clientY - start.y);
    if (!isPointerDragging && Math.max(moveX, moveY) < 4) return;

    event.preventDefault();
    if (!isTreeDragEnabled()) {
      if (hasDuplicateSourceKeys) showDuplicateKeysReadOnly();
      else showTreeDragError('treeView.dragJsonOnly');
      clearTreeDragState();
      return;
    }

    isPointerDragging = true;
    updateTreePointerDragTarget(event.clientX, event.clientY);
  }

  function handleTreePointerUp(event: PointerEvent) {
    const start = pointerDragStart;
    const wasDragging = isPointerDragging;
    const dropTarget = getTreePointerDropTarget(event.clientX, event.clientY);
    const targetPath = dropTarget?.path ?? dragTargetPath;
    const position = dropTarget?.position ?? dragPosition;

    if (start && wasDragging) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextTreeClick = true;

      if (targetPath && position) {
        moveTreeNode(start.path, targetPath, position);
      }
    }

    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // The pointer can already be released if the OS cancels the gesture.
    }
    clearTreeDragState();
  }

  function handleTreePointerCancel() {
    clearTreeDragState();
  }

  function getTreeEditKindFromEvent(
    event: MouseEvent,
    node: TreeNode,
  ): TreeEditState['kind'] | null {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button,input,textarea,select')) return null;

    const explicitTarget = target.closest('[data-tree-edit-kind]') as HTMLElement | null;
    const explicitKind = explicitTarget?.dataset.treeEditKind;
    if (explicitKind === 'key' || explicitKind === 'value') return explicitKind;

    const row = event.currentTarget as HTMLElement | null;
    const keyTarget = row?.querySelector('[data-tree-edit-kind="key"]') as HTMLElement | null;
    const valueTarget = row?.querySelector('[data-tree-edit-kind="value"]') as HTMLElement | null;
    const keyDistance = getHorizontalDistanceFromElement(event.clientX, keyTarget);
    const valueDistance = getHorizontalDistanceFromElement(event.clientX, valueTarget);

    if (keyDistance < valueDistance && canAttemptTreeKeyEdit(node)) return 'key';
    if (valueDistance < Number.POSITIVE_INFINITY && isTreeValueEditable(node)) return 'value';
    if (isTreeValueEditable(node)) return 'value';
    if (canAttemptTreeKeyEdit(node)) return 'key';
    return null;
  }

  function getHorizontalDistanceFromElement(clientX: number, element: HTMLElement | null) {
    if (!element) return Number.POSITIVE_INFINITY;
    const rect = element.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right) return 0;
    return Math.min(Math.abs(clientX - rect.left), Math.abs(clientX - rect.right));
  }

  function handleTreeNodeDoubleClick(event: MouseEvent, node: TreeNode) {
    const kind = getTreeEditKindFromEvent(event, node);
    if (!kind) return;
    beginTreeEdit(event, node, kind);
  }

  function beginTreeEdit(event: MouseEvent, node: TreeNode, kind: TreeEditState['kind']) {
    if (hasDuplicateSourceKeys) {
      event.stopPropagation();
      showDuplicateKeysReadOnly();
      return;
    }
    if (kind === 'key' && !isTreeKeyEditable(node)) return;
    if (kind === 'value' && !isTreeValueEditable(node)) return;
    event.stopPropagation();
    treeEdit = {
      kind,
      path: node.path,
      input: kind === 'key'
        ? node.key
        : node.value === null
          ? 'null'
          : String(node.value),
      error: '',
    };
    tick().then(() => treeEditInput?.focus());
  }

  function handleTreeEditInput(event: Event) {
    if (!treeEdit) return;
    treeEdit = {
      ...treeEdit,
      input: (event.currentTarget as HTMLInputElement).value,
      error: '',
    };
  }

  function handleTreeEditKeydown(event: KeyboardEvent, node: TreeNode) {
    event.stopPropagation();
    if (!isGridEditCommitKey(event)) return;
    event.preventDefault();
    commitTreeEdit(node);
  }

  function commitTreeEdit(node: TreeNode) {
    if (!treeEdit || treeEdit.path !== node.path) return;

    const result = treeEdit.kind === 'key'
      ? createTreeKeyEdit(parsedPointers, node.path, treeEdit.input, node.parentKeys, node.key)
      : createGridValueEdit(
          content,
          parsedPointers,
          node.path,
          node.value,
          treeEdit.input,
          parsedDialect,
        );

    if (!result.ok || !('edit' in result)) {
      treeEdit = {
        ...treeEdit,
        error: 'error' in result && typeof result.error === 'string'
          ? result.error
          : 'Invalid edit',
      };
      tick().then(() => treeEditInput?.focus());
      return;
    }

    editor?.replaceRangeByOffsets(result.edit.start, result.edit.end, result.edit.text);
    treeEdit = null;
  }

  function isEditing(node: TreeNode, kind: TreeEditState['kind']) {
    return treeEdit?.path === node.path && treeEdit.kind === kind;
  }

  function expandAll() {
    const allPaths = new Set<string>();
    const collectPaths = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        if (!hasChildren(node)) return;
        allPaths.add(node.path);
        collectPaths(node.children!);
      });
    };
    collectPaths(treeNodes);
    expandedNodes = allPaths;
    isAllExpanded = true;
    syncTreeScrollPosition();
  }

  function collapseAll() {
    expandedNodes = new Set();
    isAllExpanded = false;
    resetTreeScroll();
  }

  async function copyEntry(node: TreeNode) {
    const entryText = createTreeValueCopyText(content, parsedPointers, node.path, node.value);

    try {
      await navigator.clipboard.writeText(entryText);
      dispatch('toast', { message: $t('treeView.valueCopied') });
    } catch (e) {}
  }

  function getTypeIcon(type: TreeNode['type']): string {
    switch (type) {
      case 'object': return '{}';
      case 'array': return '[]';
      case 'string': return 'str';
      case 'number': return 'num';
      case 'boolean': return 'bool';
      case 'null': return '∅';
      default: return '';
    }
  }

  async function updateQueryMatches(
    mode: QueryMode,
    query: string,
    data: unknown,
    nodes: TreeNode[]
  ) {
    const runId = ++queryRunId;
    if (!query || data == null || nodes.length === 0) {
      queryMatches = new Set();
      queryExpandedNodes = new Set();
      queryError = '';
      queryMatchedRoot = false;
      return;
    }

    const { matches, expanded, error, matchedRoot } = await runTreeQuery({
      mode,
      query,
      data,
      nodes,
    });
    if (runId !== queryRunId) return;
    queryMatches = matches;
    queryExpandedNodes = matchedRoot
      ? new Set([...expanded, ...nodes.map((node) => node.path)])
      : expanded;
    queryError = error;
    queryMatchedRoot = matchedRoot;
  }

  function getQueryModeLabel(mode: QueryMode): string {
    return mode === 'jsonpath' ? 'JSONPath' : 'JMESPath';
  }

  function getQueryDocsUrl(mode: QueryMode): string {
    return QUERY_DOCS_URL[mode];
  }

  function getQueryExamples(mode: QueryMode): QueryExample[] {
    return QUERY_EXAMPLES[mode];
  }

  function selectQueryMode(mode: QueryMode) {
    queryMode = mode;
    queryModeMenuOpen = false;
  }

  function hideHelp() {
    helpOpen = false;
  }

  function hideFloatingControls() {
    helpOpen = false;
    queryModeMenuOpen = false;
  }
</script>

<svelte:window onclick={hideFloatingControls} />

<div class="json-tree-panel" style={`--tree-row-height: ${TREE_ROW_HEIGHT}px`}>

  <!-- Toolbar -->
  <div class="json-tree-toolbar">
    <div class="json-tree-search-box">
      <svg class="json-tree-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        class="json-tree-search-input"
        placeholder={queryMode === 'jsonpath' ? $t('treeView.searchPlaceholderJsonpath') : $t('treeView.searchPlaceholder')}
        value={searchQuery}
        oninput={(e) => { searchQuery = e.currentTarget.value; }}
        spellcheck="false"
      />
      {#if searchQuery}
        <button
          class="json-tree-clear-btn"
          onclick={() => { searchQuery = ''; }}
          title={$t('treeView.clearQuery')}
          type="button"
        >
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </div>

    <div class="json-tree-toolbar-actions">
      <div class="json-tree-mode-field">
        <button
          class="json-tree-mode-button"
          class:is-open={queryModeMenuOpen}
          type="button"
          aria-label={$t('treeView.queryMode')}
          aria-haspopup="listbox"
          aria-expanded={queryModeMenuOpen}
          title={$t('treeView.queryMode')}
          onclick={(e) => {
            e.stopPropagation();
            queryModeMenuOpen = !queryModeMenuOpen;
            helpOpen = false;
          }}
        >
          <span>{getQueryModeLabel(queryMode)}</span>
          <svg class="json-tree-mode-arrow" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
          </svg>
        </button>

        {#if queryModeMenuOpen}
          <div
            class="json-tree-mode-menu"
            role="listbox"
            aria-label={$t('treeView.queryMode')}
            tabindex="-1"
          >
            <button
              class="json-tree-mode-option {queryMode === 'jmespath' ? 'is-active' : ''}"
              type="button"
              role="option"
              aria-selected={queryMode === 'jmespath'}
              onclick={() => selectQueryMode('jmespath')}
            >
              {$t('treeView.modeJmespath')}
            </button>
            <button
              class="json-tree-mode-option {queryMode === 'jsonpath' ? 'is-active' : ''}"
              type="button"
              role="option"
              aria-selected={queryMode === 'jsonpath'}
              onclick={() => selectQueryMode('jsonpath')}
            >
              {$t('treeView.modeJsonpath')}
            </button>
          </div>
        {/if}
      </div>

      <div
        class="json-tree-help"
        role="group"
        aria-label={`${getQueryModeLabel(queryMode)} Help`}
      >
        <button
          class="json-tree-help-btn"
          class:is-active={helpOpen}
          onclick={(e) => { e.stopPropagation(); helpOpen = !helpOpen; }}
          type="button"
          title={`${getQueryModeLabel(queryMode)} ${$t('treeView.syntaxGuide')}`}
          aria-expanded={helpOpen}
          aria-controls={`${queryMode}-help`}
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM7.25 7.5a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .74.75v3.25h.25a.5.5 0 0 1 0 1h-1.5a.5.5 0 0 1 0-1h.25V8.25h-.01a.75.75 0 0 1-.49-.75Z"/>
          </svg>
        </button>
        
        {#if helpOpen}
          <div
            class="json-tree-help-popover"
            id={`${queryMode}-help`}
            role="dialog"
            aria-label={`${getQueryModeLabel(queryMode)} Help`}
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.key === 'Escape' && hideHelp()}
          >
            <div class="json-tree-help-header">
              <span class="json-tree-help-title">{getQueryModeLabel(queryMode)} {$t('treeView.cheatSheet')}</span>
              <a 
                href={getQueryDocsUrl(queryMode)}
                target="_blank" 
                rel="noopener noreferrer" 
                class="json-tree-help-link"
                onclick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openExternalUrl(getQueryDocsUrl(queryMode));
                }}
              >
                {$t('treeView.docs')}
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            </div>
            
            <div class="json-tree-help-content">
              <div class="json-tree-help-section">
                <div class="json-tree-help-label">{$t('treeView.exampleData')}</div>
                <div class="json-tree-help-code-wrapper">
                  <button
                    class="json-tree-copy-code-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(EXAMPLE_DATA);
                      dispatch('toast', { message: $t('treeView.exampleCopied') });
                    }}
                    title={$t('treeView.copyExample')}
                    type="button"
                  >
                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                  <pre class="json-tree-help-code-block">{EXAMPLE_DATA}</pre>
                </div>
              </div>

              <div class="json-tree-help-section">
                <div class="json-tree-help-label">{$t('treeView.exampleQueries')}</div>
                <div class="json-tree-help-grid">
                  {#each getQueryExamples(queryMode) as example}
                    <div class="help-item">
                      <div class="help-query">{example.query}</div>
                      <div class="help-desc">{example.result}</div>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <button 
        class="json-tree-action-btn" 
        onclick={isAllExpanded ? collapseAll : expandAll} 
        disabled={treeNodes.length === 0} 
        title={isAllExpanded ? $t('treeView.collapseAll') : $t('treeView.expandAll')}
      >
        {#if isAllExpanded}
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m17 11-5-5-5 5M17 18l-5-5-5 5"/>
          </svg>
        {:else}
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m7 13 5 5 5-5M7 6l5 5 5-5"/>
          </svg>
        {/if}
      </button>
    </div>
  </div>

  {#if queryError}
    <div class="json-tree-query-error" role="alert">
      {queryError}
    </div>
  {:else if queryMatchedRoot}
    <div class="json-tree-query-info" role="status">
      {$t('treeView.rootMatched')}
    </div>
  {/if}

  <!-- Tree Content -->
  <div
    class="json-tree-content"
    bind:this={treeContentElement}
    bind:clientHeight={treeViewportHeight}
    onscroll={handleTreeScroll}
    data-testid="tree-viewport"
  >
    {#if isLoading}
      <div class="json-tree-empty" data-testid="tree-loading">
        <svg class="w-8 h-8 text-(--text-secondary) animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <div class="text-xs text-(--text-secondary) mt-2">{$t('treeView.parsing')}</div>
      </div>
    {:else if treeError}
      <div class="json-tree-empty" data-testid="tree-error">
        <svg class="w-12 h-12 text-(--text-secondary) opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <div class="text-xs font-medium text-(--text-primary) mt-3 opacity-70">{$t('treeView.invalidJson')}</div>
      </div>
    {:else if treeNodes.length === 0}
      <div class="json-tree-empty" data-testid="tree-empty">
        <svg class="w-12 h-12 text-(--text-secondary) opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="2" width="6" height="6" rx="1"/>
          <rect x="3" y="14" width="6" height="6" rx="1"/>
          <rect x="15" y="14" width="6" height="6" rx="1"/>
          <path d="M12 8v3"/>
          <path d="M12 11h-6"/>
          <path d="M12 11h6"/>
          <path d="M6 14v-3"/>
          <path d="M18 14v-3"/>
        </svg>
        <div class="text-xs font-medium text-(--text-primary) mt-3 opacity-60">{$t('treeView.noData')}</div>
        <div class="text-xs text-(--text-secondary) mt-1 opacity-50">{$t('treeView.noDataHint')}</div>
      </div>
    {:else}
      <div
        data-testid="tree-ready"
        data-tree-build-version={completedTreeBuildVersion}
        class="sr-only"
      >Tree ready</div>
      {#snippet renderRow(row: TreeRow)}
        {@const node = row.node}
        {@const depth = row.depth}
        {@const isLast = row.isLast}
        {@const parentLines = row.parentLines}
        {@const hasChild = hasChildren(node)}
        {@const isExpanded = expandedNodes.has(node.path) || queryExpandedNodes.has(node.path)}
        {@const isSelected = selectedPath === node.path}
        {@const isMatched = queryMatches.has(node.path)}
        {@const childCount = getChildCount(node)}
        {@const showValue = node.type !== 'object' && node.type !== 'array'}
        
        <div
          class="tree-node"
          class:tree-node-selected={isSelected}
          class:tree-node-matched={isMatched}
          class:tree-node-dragging={draggedPath === node.path}
          class:tree-node-drop-before={dragTargetPath === node.path && dragPosition === 'before'}
          class:tree-node-drop-inside={dragTargetPath === node.path && dragPosition === 'inside'}
          class:tree-node-drop-after={dragTargetPath === node.path && dragPosition === 'after'}
        >
          <div 
            class="tree-node-content"
            data-tree-path={node.path}
            onclick={(e) => handleTreeNodeClick(e, node)}
            ondblclick={(e) => handleTreeNodeDoubleClick(e, node)}
            onkeydown={(e) => handleNodeKeydown(e, node)}
            onpointerdown={(e) => handleTreePointerDown(e, node)}
            onpointermove={handleTreePointerMove}
            onpointerup={handleTreePointerUp}
            onpointercancel={handleTreePointerCancel}
            role="button"
            tabindex="0"
          >
            <!-- Tree Lines -->
            {#if depth > 0}
              <div class="tree-lines">
                {#each parentLines as hasLine}
                  <div class="tree-line-segment">
                    {#if hasLine}
                      <div class="tree-line-vertical"></div>
                    {/if}
                  </div>
                {/each}
                
                <!-- Current level connector -->
                <div class="tree-connector">
                  {#if isLast}
                    <div class="tree-line-corner-last"></div>
                  {:else}
                    <div class="tree-line-corner"></div>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- Expand/Collapse Button -->
            <div class="tree-toggle-area">
              {#if hasChild}
                <button
                  class="tree-toggle-btn"
                  onclick={(e) => { e.stopPropagation(); toggleNode(node); }}
                  aria-label={isExpanded ? `Collapse ${node.key}` : `Expand ${node.key}`}
                  title={isExpanded ? `Collapse ${node.key}` : `Expand ${node.key}`}
                  type="button"
                >
                  <svg 
                    class="w-3 h-3 transition-transform duration-150 {isExpanded ? 'rotate-90' : ''}" 
                    viewBox="0 0 24 24" 
                    fill="currentColor"
                  >
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                  </svg>
                </button>
              {/if}
            </div>

            <!-- Type Icon -->
            <div class="tree-type-icon tree-type-{node.type}">
              {getTypeIcon(node.type)}
            </div>

            <!-- Key-Value Pair -->
            <div class="tree-key-value">
              {#if isEditing(node, 'key')}
                <span class="tree-edit-field">
                  <input
                    class="tree-edit-input"
                    bind:this={treeEditInput}
                    value={treeEdit?.input ?? ''}
                    oninput={handleTreeEditInput}
                    onblur={() => commitTreeEdit(node)}
                    onkeydown={(e) => handleTreeEditKeydown(e, node)}
                    onclick={(e) => e.stopPropagation()}
                    spellcheck="false"
                  />
                  {#if treeEdit?.error}
                    <span class="tree-edit-error">{treeEdit.error}</span>
                  {/if}
                </span>
              {:else}
                {#if canAttemptTreeKeyEdit(node)}
                  <span
                    class="tree-edit-target"
                    class:tree-edit-target--editable={isTreeKeyEditable(node)}
                    data-tree-edit-kind="key"
                    role="button"
                    tabindex="-1"
                    aria-label="Edit key"
                  >
                    <span class="tree-key">{node.key}</span>
                  </span>
                {:else}
                  <span class="tree-key">{node.key}</span>
                {/if}
              {/if}
              {#if showValue}
                <span class="tree-colon">:</span>
                {#if isEditing(node, 'value')}
                  <span class="tree-edit-field">
                    <input
                      class="tree-edit-input"
                      bind:this={treeEditInput}
                      value={treeEdit?.input ?? ''}
                      oninput={handleTreeEditInput}
                      onblur={() => commitTreeEdit(node)}
                      onkeydown={(e) => handleTreeEditKeydown(e, node)}
                      onclick={(e) => e.stopPropagation()}
                      spellcheck="false"
                    />
                    {#if treeEdit?.error}
                      <span class="tree-edit-error">{treeEdit.error}</span>
                    {/if}
                  </span>
                {:else}
                  <span
                    class="tree-edit-target"
                    class:tree-edit-target--editable={isTreeValueEditable(node)}
                    data-tree-edit-kind="value"
                    role="button"
                    tabindex="-1"
                    aria-label="Edit value"
                  >
                    <span class="tree-value tree-value-{node.type}">{formatValue(node)}</span>
                  </span>
                {/if}
              {:else if hasChild}
                <span class="tree-child-count">({childCount})</span>
              {/if}
            </div>

            <!-- Copy Value Button -->
            <button
              class="tree-copy-btn"
              onclick={(e) => { e.stopPropagation(); copyEntry(node); }}
              title={$t('treeView.copyValue')}
              type="button"
            >
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
        </div>

      {/snippet}

      <div
        class="tree-virtual-list"
        style:height={`${virtualTreeWindow.totalRows * TREE_ROW_HEIGHT}px`}
        data-visible-row-count={virtualTreeWindow.totalRows}
      >
        <div
          class="tree-virtual-window"
          style:top={`${virtualTreeWindow.offset}px`}
        >
          {#each virtualTreeWindow.rows as row (row.node.path)}
            {@render renderRow(row)}
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<ConfirmDialog
  bind:isOpen={duplicateKeysDialogOpen}
  title={$t('treeView.duplicateKeysReadOnlyTitle')}
  message={$t('treeView.duplicateKeysReadOnly')}
  confirmText={$t('common.ok')}
  showCancel={false}
  onConfirm={() => { duplicateKeysDialogOpen = false; }}
  onCancel={() => { duplicateKeysDialogOpen = false; }}
/>

<style>
  /* Query Toolbar */
  .json-tree-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .json-tree-mode-field {
    position: relative;
    flex-shrink: 0;
  }

  .json-tree-mode-button {
    height: 26px;
    min-width: 88px;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 22px 0 9px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
    background: color-mix(in srgb, var(--bg-primary) 94%, var(--bg-secondary));
    color: var(--text-primary);
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    outline: none;
    transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
  }

  .json-tree-mode-button:hover,
  .json-tree-mode-button.is-open {
    border-color: color-mix(in srgb, var(--accent) 24%, var(--border));
    background: color-mix(in srgb, var(--accent) 4%, var(--bg-primary));
  }

  .json-tree-mode-button:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .json-tree-mode-arrow {
    position: absolute;
    top: 50%;
    right: 7px;
    width: 13px;
    height: 13px;
    color: var(--text-secondary);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
    transform: translateY(-50%);
    transition: color 0.16s ease;
  }

  .json-tree-mode-button:hover .json-tree-mode-arrow,
  .json-tree-mode-button.is-open .json-tree-mode-arrow,
  .json-tree-mode-button:focus-visible .json-tree-mode-arrow {
    color: var(--accent);
  }

  .json-tree-mode-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: 100%;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-primary);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  }

  .json-tree-mode-option {
    width: 100%;
    height: 28px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 10.5px;
    font-weight: 600;
    text-align: left;
  }

  .json-tree-mode-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .json-tree-mode-option.is-active {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
  }

  .json-tree-search-box {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    transition: all 0.2s ease;
    height: 28px;
    min-width: 0;
    overflow: hidden;
  }

  .json-tree-search-box:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .json-tree-search-icon {
    width: 14px;
    height: 14px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .json-tree-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--text-primary);
    min-width: 0;
  }

  .json-tree-search-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.5;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .json-tree-clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .json-tree-clear-btn:hover {
    background: var(--text-secondary);
    color: var(--bg-primary);
  }

  .json-tree-query-error {
    margin: 0 10px;
    padding: 6px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
    color: var(--text-primary);
    font-size: 11px;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
  }

  .json-tree-query-info {
    margin: 0 10px;
    padding: 6px 10px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-tertiary) 75%, var(--bg-secondary));
    color: var(--text-secondary);
    font-size: 11px;
    border: 1px solid var(--border);
  }

  /* Help Button & Popover */
  .json-tree-help {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .json-tree-help-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    color: var(--text-secondary);
    opacity: 0.4;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    overflow: visible;
  }

  .json-tree-help-btn:hover,
  .json-tree-help-btn.is-active {
    opacity: 0.8;
    color: var(--text-primary);
  }

  .json-tree-help-popover {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 380px;
    max-width: calc(100vw - 20px);
    max-height: 400px;
    padding: 0;
    border-radius: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    color: var(--text-primary);
    font-size: 12px;
    overflow: hidden;
    z-index: 2000;
    display: flex;
    flex-direction: column;
  }

  .json-tree-help-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
  }

  .json-tree-help-title {
    font-weight: 600;
    color: var(--text-primary);
  }

  .json-tree-help-link {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
  }

  .json-tree-help-link:hover {
    text-decoration: underline;
  }

  .json-tree-help-content {
    padding: 14px;
    overflow-y: auto;
  }

  .json-tree-help-section {
    margin-bottom: 16px;
  }

  .json-tree-help-section:last-child {
    margin-bottom: 0;
  }

  .json-tree-help-label {
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-secondary);
    font-weight: 600;
    margin-bottom: 6px;
  }

  .json-tree-help-code-wrapper {
    position: relative;
  }

  .json-tree-copy-code-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s ease;
  }

  .json-tree-help-code-wrapper:hover .json-tree-copy-code-btn {
    opacity: 1;
  }

  .json-tree-copy-code-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .json-tree-help-code-block {
    font-family: 'JetBrains Mono', monospace;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-primary);
    overflow-x: auto;
  }

  .json-tree-help-grid {
    display: grid;
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .help-item {
    display: grid;
    grid-template-columns: 1fr 1fr;
    background: var(--bg-primary);
    padding: 8px 10px;
  }

  .help-item:hover {
    background: var(--bg-secondary);
  }

  .help-query {
    font-family: 'JetBrains Mono', monospace;
    color: var(--accent);
    font-size: 11px;
  }

  .help-desc {
    color: var(--text-secondary);
    font-size: 11px;
    text-align: right;
  }

  .tree-edit-target,
  .tree-edit-field {
    display: inline-flex;
    align-items: center;
    min-width: 0;
  }

  .tree-edit-target--editable {
    cursor: text;
  }

  .tree-edit-field {
    position: relative;
    flex-wrap: nowrap;
  }

  .tree-edit-input {
    width: min(180px, 100%);
    height: 20px;
    padding: 0 5px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
    outline: none;
  }

  .tree-edit-input:focus {
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .tree-edit-error {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    z-index: 10;
    padding: 3px 6px;
    border: 1px solid color-mix(in srgb, var(--error, #ef4444) 45%, var(--border));
    border-radius: 4px;
    background: var(--bg-primary);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    color: var(--error, #ef4444);
    font-size: 10px;
    white-space: nowrap;
    pointer-events: none;
  }

  .tree-node-dragging {
    opacity: 0.55;
  }

  .tree-node-drop-before::after,
  .tree-node-drop-after::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    height: 2px;
    border-radius: 999px;
    background: var(--accent);
    pointer-events: none;
    z-index: 2;
  }

  .tree-node-drop-before::after {
    top: 0;
  }

  .tree-node-drop-after::after {
    bottom: 0;
  }

  .tree-node-drop-inside .tree-node-content {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .tree-virtual-list {
    position: relative;
    width: fit-content;
    min-width: 100%;
  }

  .tree-virtual-window {
    position: absolute;
    top: 0;
    left: 6px;
    width: max-content;
    min-width: calc(100% - 6px);
  }

  .tree-virtual-list .tree-node,
  .tree-virtual-list .tree-node-content {
    height: var(--tree-row-height);
    min-height: var(--tree-row-height);
  }

</style>

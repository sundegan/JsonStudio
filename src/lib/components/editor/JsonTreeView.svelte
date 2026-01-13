<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type MonacoEditor from './MonacoEditor.svelte';

  type TreeNode = {
    key: string;
    value: unknown;
    type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
    path: string;
    children?: TreeNode[];
    startOffset: number;
    endOffset: number;
  };

  const { content, editor } = $props<{
    content: string;
    editor: MonacoEditor | null;
  }>();

  const dispatch = createEventDispatcher<{ toast: { message: string } }>();
  let treeNodes = $state<TreeNode[]>([]);
  let treeError = $state('');
  let isLoading = $state(false);
  let previousContent = $state('');
  let selectedPath = $state<string | null>(null);
  let searchQuery = $state('');
  let expandedNodes = $state<Set<string>>(new Set());

  // Build tree when content changes
  $effect(() => {
    if (content !== previousContent) {
      previousContent = content;
      buildTree();
    }
  });

  async function buildTree() {
    if (!content.trim()) {
      treeNodes = [];
      treeError = '';
      return;
    }

    isLoading = true;
    treeError = '';

    try {
      const [jsonSourceMap] = await Promise.all([
        import('json-source-map')
      ]);

      const parsed = jsonSourceMap.parse(content);
      const nodes = parseToTree(parsed.data, parsed.pointers, '');
      treeNodes = nodes;
      
      // Auto-expand first level
      if (nodes.length > 0) {
        expandedNodes = new Set(nodes.map(n => n.path));
      }
    } catch (e) {
      treeError = e instanceof Error ? e.message : 'Failed to parse JSON';
      treeNodes = [];
    } finally {
      isLoading = false;
    }
  }

  function parseToTree(data: unknown, pointers: any, parentPath: string): TreeNode[] {
    const nodes: TreeNode[] = [];

    if (data === null) {
      return [];
    }

    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        const path = parentPath ? `${parentPath}/${index}` : `/${index}`;
        const pointerInfo = pointers[path];
        const valueInfo = pointerInfo?.value || pointerInfo?.key || pointerInfo;
        
        const node: TreeNode = {
          key: `[${index}]`,
          value: item,
          type: getValueType(item),
          path,
          startOffset: valueInfo?.pos ?? 0,
          endOffset: valueInfo?.valueEnd?.pos ?? valueInfo?.keyEnd?.pos ?? valueInfo?.pos ?? 0,
        };

        if (node.type === 'object' || node.type === 'array') {
          node.children = parseToTree(item, pointers, path);
        }

        nodes.push(node);
      });
    } else if (typeof data === 'object' && data !== null) {
      Object.entries(data).forEach(([key, value]) => {
        const path = parentPath ? `${parentPath}/${encodePointerSegment(key)}` : `/${encodePointerSegment(key)}`;
        const pointerInfo = pointers[path];
        const valueInfo = pointerInfo?.value || pointerInfo?.key || pointerInfo;

        const node: TreeNode = {
          key,
          value,
          type: getValueType(value),
          path,
          startOffset: valueInfo?.pos ?? 0,
          endOffset: valueInfo?.valueEnd?.pos ?? valueInfo?.keyEnd?.pos ?? valueInfo?.pos ?? 0,
        };

        if (node.type === 'object' || node.type === 'array') {
          node.children = parseToTree(value, pointers, path);
        }

        nodes.push(node);
      });
    }

    return nodes;
  }

  function encodePointerSegment(segment: string): string {
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
  }

  function getValueType(value: unknown): TreeNode['type'] {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
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

  function toggleNode(node: TreeNode) {
    if (expandedNodes.has(node.path)) {
      expandedNodes.delete(node.path);
    } else {
      expandedNodes.add(node.path);
    }
    expandedNodes = new Set(expandedNodes);
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

  function expandAll() {
    const allPaths = new Set<string>();
    const collectPaths = (nodes: TreeNode[]) => {
      nodes.forEach(node => {
        allPaths.add(node.path);
        if (node.children) {
          collectPaths(node.children);
        }
      });
    };
    collectPaths(treeNodes);
    expandedNodes = allPaths;
  }

  function collapseAll() {
    expandedNodes = new Set();
  }

  function filterNodes(nodes: TreeNode[], query: string): TreeNode[] {
    if (!query.trim()) return nodes;
    
    const lowerQuery = query.toLowerCase();
    return nodes.filter(node => {
      const keyMatch = node.key.toLowerCase().includes(lowerQuery);
      const valueMatch = String(node.value).toLowerCase().includes(lowerQuery);
      const hasMatchingChildren = node.children && filterNodes(node.children, query).length > 0;
      
      return keyMatch || valueMatch || hasMatchingChildren;
    });
  }

  let filteredTree = $derived(filterNodes(treeNodes, searchQuery));

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      dispatch('toast', { message: 'Path copied' });
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

  function isLastChild(nodes: TreeNode[], index: number): boolean {
    return index === nodes.length - 1;
  }
</script>

<div class="json-tree-panel">
  <!-- Header -->
  <div class="json-tree-header">
    <div class="flex items-center gap-2">
      <div class="json-tree-icon">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="2" width="6" height="6" rx="1"/>
          <rect x="3" y="14" width="6" height="6" rx="1"/>
          <rect x="15" y="14" width="6" height="6" rx="1"/>
          <path d="M12 8v3"/>
          <path d="M12 11h-6"/>
          <path d="M12 11h6"/>
          <path d="M6 14v-3"/>
          <path d="M18 14v-3"/>
        </svg>
      </div>
      <div style="font-size: 14px;" class="font-semibold text-(--text-primary)">Tree View</div>
    </div>
  </div>

  <!-- Toolbar -->
  <div class="json-tree-toolbar">
    <div class="json-tree-search-box">
      <svg class="w-3.5 h-3.5 text-(--text-secondary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        class="json-tree-search-input"
        placeholder="Filter..."
        value={searchQuery}
        oninput={(e) => { searchQuery = e.currentTarget.value; }}
      />
      {#if searchQuery}
        <button
          class="json-tree-clear-btn"
          onclick={() => { searchQuery = ''; }}
          title="Clear"
          type="button"
        >
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </div>

    <div class="json-tree-actions">
      <button class="json-tree-action-btn" onclick={expandAll} disabled={treeNodes.length === 0} title="Expand All">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
      <button class="json-tree-action-btn" onclick={collapseAll} disabled={treeNodes.length === 0} title="Collapse All">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
    </div>
  </div>

  {#if treeError}
    <div class="json-tree-error">
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4M12 16h.01"/>
      </svg>
      <span>{treeError}</span>
    </div>
  {/if}

  <!-- Tree Content -->
  <div class="json-tree-content">
    {#if isLoading}
      <div class="json-tree-empty">
        <svg class="w-8 h-8 text-(--text-secondary) animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <div class="text-xs text-(--text-secondary) mt-2">Parsing...</div>
      </div>
    {:else if treeNodes.length === 0 && !treeError}
      <div class="json-tree-empty">
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
        <div class="text-xs font-medium text-(--text-primary) mt-3 opacity-60">No JSON Data</div>
        <div class="text-xs text-(--text-secondary) mt-1 opacity-50">Enter valid JSON to view structure</div>
      </div>
    {:else}
      {#snippet renderNode(node: TreeNode, depth: number, isLast: boolean, parentLines: boolean[])}
        {@const hasChild = hasChildren(node)}
        {@const isExpanded = expandedNodes.has(node.path)}
        {@const isSelected = selectedPath === node.path}
        {@const childCount = getChildCount(node)}
        {@const showValue = node.type !== 'object' && node.type !== 'array'}
        
        <div class="tree-node" class:tree-node-selected={isSelected}>
          <div 
            class="tree-node-content"
            onclick={() => selectNode(node)}
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
              <span class="tree-key">{node.key}</span>{#if showValue}<span class="tree-colon">:</span><span class="tree-value tree-value-{node.type}">{formatValue(node)}</span>{:else if hasChild}<span class="tree-child-count">({childCount})</span>{/if}
            </div>

            <!-- Copy Path Button -->
            <button
              class="tree-copy-btn"
              onclick={(e) => { e.stopPropagation(); copyPath(node.path); }}
              title="Copy path"
              type="button"
            >
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              </svg>
            </button>
          </div>
        </div>

        {#if hasChild && isExpanded && node.children}
          {#if depth === 0}
            <!-- Root node children don't need parent vertical lines -->
            {#each node.children as child, i}
              {@render renderNode(child, depth + 1, isLastChild(node.children!, i), [])}
            {/each}
          {:else}
            <!-- Non-root node children need parent vertical lines -->
            {@const newParentLines = [...parentLines, !isLast]}
            {#each node.children as child, i}
              {@render renderNode(child, depth + 1, isLastChild(node.children!, i), newParentLines)}
            {/each}
          {/if}
        {/if}
      {/snippet}

      <div class="tree-list">
        {#each filteredTree as node, i}
          {@render renderNode(node, 0, isLastChild(filteredTree, i), [])}
        {/each}
      </div>
    {/if}
  </div>
</div>

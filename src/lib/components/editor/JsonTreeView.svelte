<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
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

  let { content, editor } = $props<{
    content: string;
    editor: MonacoEditor | null;
  }>();

  const dispatch = createEventDispatcher<{ toast: { message: string } }>();
  let treeNodes = $state<TreeNode[]>([]);
  let treeError = $state('');
  let isLoading = $state(false);
  let previousContent = $state('');
  let rootData = $state<unknown>(null);
  let selectedPath = $state<string | null>(null);
  let searchQuery = $state('');
  let queryMatches = $state<Set<string>>(new Set());
  let queryExpandedNodes = $state<Set<string>>(new Set());
  let queryRunId = 0;
  let expandedNodes = $state<Set<string>>(new Set());
  let isAllExpanded = $state(false);
  let helpOpen = $state(false);

  // Build tree when content changes
  $effect(() => {
    if (content !== previousContent) {
      previousContent = content;
      buildTree();
    }
  });

  $effect(() => {
    const query = searchQuery.trim();
    const data = rootData;
    const nodes = treeNodes;
    void updateQueryMatches(query, data, nodes);
  });

  async function buildTree() {
    if (!content.trim()) {
      treeNodes = [];
      treeError = '';
      rootData = null;
      isAllExpanded = false;
      return;
    }

    isLoading = true;
    treeError = '';

    try {
      const [jsonSourceMap] = await Promise.all([
        import('json-source-map')
      ]);

      const parsed = jsonSourceMap.parse(content);
      rootData = parsed.data;
      const nodes = parseToTree(parsed.data, parsed.pointers, '');
      treeNodes = nodes;
      
      // Auto-expand first level
      if (nodes.length > 0) {
        expandedNodes = new Set(nodes.map(n => n.path));
      }
      isAllExpanded = false;
    } catch (e) {
      treeError = e instanceof Error ? e.message : 'Failed to parse JSON';
      treeNodes = [];
      rootData = null;
      isAllExpanded = false;
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

  function decodePointerSegment(segment: string): string {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
  }

  function pointerToJmesPath(path: string, data: unknown): string {
    if (!path || path === '/') return '';
    const segments = path.split('/').slice(1).map(decodePointerSegment);
    let result = '';
    let current = data;
    for (const segment of segments) {
      const isArrayIndex = Array.isArray(current) && /^[0-9]+$/.test(segment);
      if (isArrayIndex) {
        result += `[${segment}]`;
        current = (current as any)[Number(segment)];
        continue;
      }
      const isIdentifier = /^[A-Za-z_][0-9A-Za-z_]*$/.test(segment);
      const token = isIdentifier ? segment : JSON.stringify(segment);
      result = result ? `${result}.${token}` : token;
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[segment];
      } else {
        current = undefined;
      }
    }
    return result;
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
    isAllExpanded = false;
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
    isAllExpanded = true;
  }

  function collapseAll() {
    expandedNodes = new Set();
    isAllExpanded = false;
  }

  async function copyEntry(node: TreeNode) {
    const dotPath = pointerToJmesPath(node.path, rootData) || node.key;
    const valueText = JSON.stringify(node.value) ?? 'null';
    const entryText = `${dotPath}: ${valueText}`;

    try {
      await navigator.clipboard.writeText(entryText);
      dispatch('toast', { message: 'Path + value copied' });
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

  function collectNodes(nodes: TreeNode[], list: TreeNode[]) {
    nodes.forEach(node => {
      list.push(node);
      if (node.children) {
        collectNodes(node.children, list);
      }
    });
  }

  function addAncestorPaths(path: string, expanded: Set<string>) {
    if (!path || path === '/') return;
    const segments = path.split('/').slice(1);
    let current = '';
    for (const segment of segments) {
      current += `/${segment}`;
      expanded.add(current);
    }
  }

  async function updateQueryMatches(
    query: string,
    data: unknown,
    nodes: TreeNode[]
  ) {
    const runId = ++queryRunId;
    if (!query || !data || nodes.length === 0) {
      queryMatches = new Set();
      queryExpandedNodes = new Set();
      return;
    }

    let result: unknown;
    try {
      const jmespath = await import('jmespath');
      const search = jmespath.search ?? jmespath.default?.search ?? jmespath.default;
      if (typeof search !== 'function') {
        throw new Error('JMESPath search not available');
      }
      result = search(data, query);
    } catch (e) {
      if (runId !== queryRunId) return;
      queryMatches = new Set();
      queryExpandedNodes = new Set();
      return;
    }

    if (runId !== queryRunId) return;
    const resultItems = Array.isArray(result) ? result : [result];
    const needsDeepEqual = resultItems.some(item => item && typeof item === 'object');
    let deepEqual: ((a: unknown, b: unknown) => boolean) | null = null;
    if (needsDeepEqual) {
      const deepEqualModule = await import('fast-deep-equal');
      deepEqual = deepEqualModule.default ?? deepEqualModule;
    }

    const allNodes: TreeNode[] = [];
    collectNodes(nodes, allNodes);

    const matched = new Set<string>();
    const expanded = new Set<string>();
    allNodes.forEach(node => {
      for (const item of resultItems) {
        if (item && typeof item === 'object') {
          if (deepEqual && deepEqual(node.value, item)) {
            matched.add(node.path);
            addAncestorPaths(node.path, expanded);
            break;
          }
        } else if (Object.is(node.value, item)) {
          matched.add(node.path);
          addAncestorPaths(node.path, expanded);
          break;
        }
      }
    });

    queryMatches = matched;
    queryExpandedNodes = expanded;
  }

  function hideHelp() {
    helpOpen = false;
  }
</script>

<svelte:window onclick={hideHelp} />

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
      <svg class="json-tree-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        class="json-tree-search-input"
        placeholder="JMESPath Query..."
        value={searchQuery}
        oninput={(e) => { searchQuery = e.currentTarget.value; }}
        spellcheck="false"
      />
      {#if searchQuery}
        <button
          class="json-tree-clear-btn"
          onclick={() => { searchQuery = ''; }}
          title="Clear query"
          type="button"
        >
          <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      {/if}
    </div>

    <div class="json-tree-toolbar-actions">
      <div
        class="json-tree-help"
        role="group"
        aria-label="JMESPath Help"
      >
        <button
          class="json-tree-help-btn"
          class:is-active={helpOpen}
          onclick={(e) => { e.stopPropagation(); helpOpen = !helpOpen; }}
          type="button"
          title="JMESPath Syntax Guide"
          aria-expanded={helpOpen}
          aria-controls="jmespath-help"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM7.25 7.5a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .74.75v3.25h.25a.5.5 0 0 1 0 1h-1.5a.5.5 0 0 1 0-1h.25V8.25h-.01a.75.75 0 0 1-.49-.75Z"/>
          </svg>
        </button>
        
        {#if helpOpen}
          <div
            class="json-tree-help-popover"
            id="jmespath-help"
            role="dialog"
            aria-label="JMESPath Help"
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.key === 'Escape' && hideHelp()}
          >
            <div class="json-tree-help-header">
              <span class="json-tree-help-title">JMESPath Cheat Sheet</span>
              <a 
                href="https://jmespath.org" 
                target="_blank" 
                rel="noopener noreferrer" 
                class="json-tree-help-link"
                onclick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    await openUrl('https://jmespath.org');
                  } catch (err) {
                    console.error('Failed to open link:', err);
                    window.open('https://jmespath.org', '_blank');
                  }
                }}
              >
                Docs
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
            </div>
            
            <div class="json-tree-help-content">
              <div class="json-tree-help-section">
                <div class="json-tree-help-label">Example JSON Data</div>
                <div class="json-tree-help-code-wrapper">
                  <button
                    class="json-tree-copy-code-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(`{
  "people": [
    {"name": "Alice", "age": 20},
    {"name": "Bob",   "age": 30}
  ],
  "meta": {"count": 2}
}`);
                      dispatch('toast', { message: 'Example JSON copied' });
                    }}
                    title="Copy example"
                    type="button"
                  >
                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                  <pre class="json-tree-help-code-block">{`{
  "people": [
    {"name": "Alice", "age": 20},
    {"name": "Bob",   "age": 30}
  ],
  "meta": {"count": 2}
}`}</pre>
                </div>
              </div>

              <div class="json-tree-help-section">
                <div class="json-tree-help-label">Example Queries</div>
                <div class="json-tree-help-grid">
                  <div class="help-item">
                    <div class="help-query">people[0].name</div>
                    <div class="help-desc">"Alice"</div>
                  </div>
                  <div class="help-item">
                    <div class="help-query">people[*].name</div>
                    <div class="help-desc">["Alice", "Bob"]</div>
                  </div>
                  <div class="help-item">
                    <div class="help-query">people[?age > `25`].name</div>
                    <div class="help-desc">["Bob"]</div>
                  </div>
                  <div class="help-item">
                    <div class="help-query">meta.count</div>
                    <div class="help-desc">2</div>
                  </div>
                  <div class="help-item">
                    <div class="help-query">length(people)</div>
                    <div class="help-desc">2</div>
                  </div>
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
        title={isAllExpanded ? "Collapse All" : "Expand All"}
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

  <!-- Tree Content -->
  <div class="json-tree-content">
    {#if isLoading}
      <div class="json-tree-empty">
        <svg class="w-8 h-8 text-(--text-secondary) animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <div class="text-xs text-(--text-secondary) mt-2">Parsing...</div>
      </div>
    {:else if treeError}
      <div class="json-tree-empty">
        <svg class="w-12 h-12 text-(--text-secondary) opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <div class="text-xs font-medium text-(--text-primary) mt-3 opacity-70">Invalid JSON Format</div>
      </div>
    {:else if treeNodes.length === 0}
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
        {@const isExpanded = expandedNodes.has(node.path) || queryExpandedNodes.has(node.path)}
        {@const isSelected = selectedPath === node.path}
        {@const isMatched = queryMatches.has(node.path)}
        {@const childCount = getChildCount(node)}
        {@const showValue = node.type !== 'object' && node.type !== 'array'}
        
        <div class="tree-node" class:tree-node-selected={isSelected} class:tree-node-matched={isMatched}>
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
              onclick={(e) => { e.stopPropagation(); copyEntry(node); }}
              title="Copy path + value"
              type="button"
            >
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
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
        {#each treeNodes as node, i}
          {@render renderNode(node, 0, isLastChild(treeNodes, i), [])}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /* New Styles for JMESPath Toolbar */
  .json-tree-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
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
    right: -50px;
    width: 380px;
    max-width: 90vw;
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

</style>

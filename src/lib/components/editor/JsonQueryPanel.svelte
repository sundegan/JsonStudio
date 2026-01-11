<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import type MonacoEditor from './MonacoEditor.svelte';

  const JSON_QUERY_MAX_HIGHLIGHTS = 500;

  type JsonQueryResult = {
    pointer: string;
    preview: string;
    valueText: string;
    startOffset: number;
    endOffset: number;
  };

  const { content, editor, onClose } = $props<{
    content: string;
    editor: MonacoEditor | null;
    onClose: () => void;
  }>();

  const dispatch = createEventDispatcher<{ toast: { message: string } }>();
  let jsonQuery = $state('$.');
  let jsonQueryResults = $state<JsonQueryResult[]>([]);
  let jsonQueryError = $state('');
  let jsonQueryIsRunning = $state(false);
  let jsonQueryDecorations = $state<string[]>([]);
  let jsonQuerySelectedIndex = $state<number | null>(null);
  let jsonQueryStats = $state({ total: 0, highlighted: 0, timeMs: 0 });
  let currentPage = $state(1);
  let pageSize = $state(20);
  let previousContent = $state(content);

  $effect(() => {
    if (content === previousContent) return;
    previousContent = content;
    clearJsonQueryState();
  });

  onDestroy(() => {
    clearJsonQueryDecorations();
  });

  function clearJsonQueryState() {
    jsonQueryResults = [];
    jsonQueryError = '';
    jsonQuerySelectedIndex = null;
    jsonQueryStats = { total: 0, highlighted: 0, timeMs: 0 };
    currentPage = 1;
    clearJsonQueryDecorations();
  }

  function clearJsonQueryDecorations() {
    const editorInstance = editor?.getEditorInstance();
    if (!editorInstance) return;
    jsonQueryDecorations = editorInstance.deltaDecorations(jsonQueryDecorations, []);
  }

  async function runJsonQuery() {
    if (!content.trim()) {
      jsonQueryError = 'Editor is empty';
      return;
    }

    jsonQueryIsRunning = true;
    jsonQueryError = '';
    jsonQueryResults = [];
    jsonQuerySelectedIndex = null;
    currentPage = 1;
    clearJsonQueryDecorations();

    const startTime = performance.now();

    try {
      // Auto-detect JSON Pointer vs. JSONPath syntax.
      if (jsonQuery.startsWith('/')) {
        // JSON Pointer mode.
        await handleJsonPointer(startTime);
      } else {
        // JSONPath mode.
        await handleJsonPath(startTime);
      }
    } catch (e) {
      jsonQueryError = e instanceof Error ? e.message : 'Query error';
    } finally {
      jsonQueryIsRunning = false;
    }
  }

  async function handleJsonPointer(startTime: number) {
    const [{ default: jsonSourceMap }] = await Promise.all([
      import('json-source-map')
    ]);

    const parsed = jsonSourceMap.parse(content);
    const pointer = jsonQuery;

    // Ensure the pointer exists in the source map.
    const pointerInfo = parsed.pointers[pointer];
    if (!pointerInfo) {
      jsonQueryError = `Pointer not found: ${pointer}`;
      return;
    }

    const valueInfo = pointerInfo.value || pointerInfo.key || pointerInfo;
    if (!valueInfo || valueInfo.pos == null) {
      jsonQueryError = 'Invalid pointer location';
      return;
    }

    const startOffset = valueInfo.pos;
    const endOffset = valueInfo.valueEnd?.pos ?? valueInfo.keyEnd?.pos ?? valueInfo.pos;

    const resolvePointer = jsonSourceMap.resolvePointer || resolveJsonPointer;
    const value = resolvePointer(parsed.data, pointer);
    const preview = formatJsonQueryPreview(value);
    const valueText = formatJsonQueryValueText(value);

    const result = {
      pointer,
      preview,
      valueText,
      startOffset,
      endOffset
    };

    jsonQueryResults = [result];
    jsonQueryStats = {
      total: 1,
      highlighted: 1,
      timeMs: Math.round(performance.now() - startTime)
    };

    applyJsonQueryDecorations([result]);
    // Auto-select and jump to the result.
    selectJsonQueryResult(0);
  }

  async function handleJsonPath(startTime: number) {
    const [{ JSONPath }, jsonSourceMap] = await Promise.all([
      import('jsonpath-plus'),
      import('json-source-map')
    ]);

    const parsed = jsonSourceMap.parse(content);
    const pointers = JSONPath({
      path: jsonQuery,
      json: parsed.data,
      resultType: 'pointer'
    }) as string[];

    const results: JsonQueryResult[] = [];
    const resolvePointer = jsonSourceMap.resolvePointer || resolveJsonPointer;

    for (const pointer of pointers) {
      const pointerInfo = parsed.pointers[pointer];
      if (!pointerInfo) continue;

      const valueInfo = pointerInfo.value || pointerInfo.key || pointerInfo;
      if (!valueInfo || valueInfo.pos == null) continue;

      const startOffset = valueInfo.pos;
      const endOffset = valueInfo.valueEnd?.pos ?? valueInfo.keyEnd?.pos ?? valueInfo.pos;
      const value = resolvePointer(parsed.data, pointer);
      const preview = formatJsonQueryPreview(value);
      const valueText = formatJsonQueryValueText(value);

      results.push({
        pointer,
        preview,
        valueText,
        startOffset,
        endOffset
      });
    }

    jsonQueryResults = results;
    jsonQueryStats = {
      total: results.length,
      highlighted: Math.min(results.length, JSON_QUERY_MAX_HIGHLIGHTS),
      timeMs: Math.round(performance.now() - startTime)
    };

    applyJsonQueryDecorations(results);
  }

  function formatJsonQueryPreview(value: unknown): string {
    if (value == null) return 'null';
    if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}...` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return '{...}';
    return String(value);
  }

  function formatJsonQueryValueText(value: unknown): string {
    if (value == null) return 'null';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch (e) {
      return String(value);
    }
  }

  function resolveJsonPointer(data: unknown, pointer: string): unknown {
    if (pointer === '' || pointer === '#') return data;
    const segments = pointer.replace(/^#?\/?/, '').split('/');
    let current: any = data;
    for (const raw of segments) {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (current == null) return undefined;
      current = current[key];
    }
    return current;
  }

  function applyJsonQueryDecorations(results: JsonQueryResult[]) {
    const editorInstance = editor?.getEditorInstance();
    const model = editorInstance?.getModel();
    if (!editorInstance || !model) return;

    // Cap highlighted ranges to keep large result sets responsive.
    const decorations = results.slice(0, JSON_QUERY_MAX_HIGHLIGHTS).map((result, index) => {
      const endOffset = result.endOffset <= result.startOffset ? result.startOffset + 1 : result.endOffset;
      const start = model.getPositionAt(result.startOffset);
      const end = model.getPositionAt(endOffset);
      return {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column
        },
        options: {
          inlineClassName: index === jsonQuerySelectedIndex ? 'json-query-match-active' : 'json-query-match'
        }
      };
    });

    jsonQueryDecorations = editorInstance.deltaDecorations(jsonQueryDecorations, decorations);
  }

  function selectJsonQueryResult(index: number) {
    const editorInstance = editor?.getEditorInstance();
    const model = editorInstance?.getModel();
    const result = jsonQueryResults[index];
    if (!editorInstance || !model || !result) return;

    jsonQuerySelectedIndex = index;
    applyJsonQueryDecorations(jsonQueryResults);

    const start = model.getPositionAt(result.startOffset);
    editorInstance.revealPositionInCenter(start);
    editorInstance.setPosition(start);
  }

  async function copyJsonQueryText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      dispatch('toast', { message: 'Copied' });
    } catch (e) {}
  }

  async function copySampleJson() {
    const sampleJson = '{ "store": { "book": [{"title": "..."}] } }';
    await copyJsonQueryText(sampleJson);
  }
</script>

<div class="json-query-panel">
  <!-- Header with gradient -->
  <div class="json-query-header">
    <div class="flex items-center gap-2">
      <div class="json-query-icon">
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
          <path d="M11 8v6M8 11h6"/>
        </svg>
      </div>
      <div class="text-sm font-semibold text-(--text-primary)">JSON Query</div>
    </div>
    <button
      class="json-query-close-btn"
      onclick={onClose}
      title="Close (Esc)"
      type="button"
      aria-label="Close JSON Query panel"
    >
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  </div>

  <!-- Query Input Section -->
  <div class="json-query-input-section">
    <div class="json-query-search-box">
      <svg class="w-4 h-4 text-(--text-secondary) shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        class="json-query-input"
        placeholder="JSONPath: $.store.book[0].title or Pointer: /store/book/0/title"
        value={jsonQuery}
        oninput={(e) => { jsonQuery = e.currentTarget.value; }}
        onkeydown={(e) => { if (e.key === 'Enter') runJsonQuery(); }}
      />
      {#if jsonQuery && jsonQuery !== '$.'}
        <button
          class="json-query-clear-input"
          onclick={() => { jsonQuery = '$.'; }}
          title="Clear"
          type="button"
          aria-label="Clear query input"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M15 9l-6 6M9 9l6 6"/>
          </svg>
        </button>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      <button
        class="json-query-run-btn"
        onclick={runJsonQuery}
        disabled={jsonQueryIsRunning}
        type="button"
      >
        {#if jsonQueryIsRunning}
          <svg class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <span>Running...</span>
        {:else}
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>Run</span>
        {/if}
      </button>
      <button
        class="json-query-clear-btn"
        onclick={clearJsonQueryState}
        disabled={jsonQueryResults.length === 0}
        type="button"
      >
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
        </svg>
        Clear
      </button>

      {#if jsonQueryStats.total > 0}
        <div class="json-query-stats">
          <span class="json-query-badge json-query-badge-primary">
            {jsonQueryStats.total} {jsonQueryStats.total === 1 ? 'match' : 'matches'}
          </span>
          <span class="json-query-badge json-query-badge-secondary">
            {jsonQueryStats.timeMs}ms
          </span>
          {#if jsonQueryStats.highlighted < jsonQueryStats.total}
            <span class="json-query-badge json-query-badge-warning" title="Only first 500 results are highlighted in editor">
              {jsonQueryStats.highlighted} highlighted
            </span>
          {/if}
        </div>
      {/if}
    </div>

    {#if jsonQueryError}
      <div class="json-query-error">
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 8v4M12 16h.01"/>
        </svg>
        <span>{jsonQueryError}</span>
      </div>
    {/if}
  </div>

  <!-- Results Section -->
  <div class="json-query-results">
    {#if jsonQueryResults.length === 0 && !jsonQueryIsRunning && !jsonQueryError}
      <div class="json-query-empty-state">
        <svg class="w-16 h-16 text-(--text-secondary) opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
          <path d="M11 8v6M8 11h6"/>
        </svg>
        <div class="text-sm font-medium text-(--text-primary) mt-3">Ready to Query</div>
        <div class="text-xs text-(--text-secondary) mt-1.5 text-center px-6 leading-relaxed">
          Use <a href="https://datatracker.ietf.org/doc/draft-ietf-jsonpath-base/" target="_blank" rel="noopener noreferrer" class="json-query-doc-link">
            <strong>JSONPath</strong>
            <svg class="json-query-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a> to query multiple values, or <a href="https://datatracker.ietf.org/doc/html/rfc6901" target="_blank" rel="noopener noreferrer" class="json-query-doc-link">
            <strong>JSON Pointer</strong>
            <svg class="json-query-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a> to navigate to a specific location
        </div>

        <div class="json-query-examples">
          <div class="json-query-sample-header">
            <div class="text-xs font-medium text-(--text-secondary)">Sample JSON Data:</div>
            <button
              class="json-query-sample-copy-btn"
              onclick={copySampleJson}
              type="button"
              title="Copy sample JSON"
              aria-label="Copy sample JSON data"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
          </div>
          <div class="json-query-sample-json">
            <code>{"{"} "store": {"{"} "book": [{"{"}"title": "..."{"}"}] {"}"} {"}"}</code>
          </div>

          <div class="text-xs font-medium text-(--text-secondary) mb-2 mt-5">JSONPath Examples:</div>
          <button class="json-query-example-item" onclick={() => { jsonQuery = '$..*'; }} type="button">
            <code>$..*</code>
            <span>All values in document</span>
          </button>
          <button class="json-query-example-item" onclick={() => { jsonQuery = '$..title'; }} type="button">
            <code>$..title</code>
            <span>All "title" fields</span>
          </button>
          <button class="json-query-example-item" onclick={() => { jsonQuery = '$.store.book[0]'; }} type="button">
            <code>$.store.book[0]</code>
            <span>First book in store</span>
          </button>

          <div class="text-xs font-medium text-(--text-secondary) mb-2 mt-3">JSON Pointer Examples:</div>
          <button class="json-query-example-item" onclick={() => { jsonQuery = '/store'; }} type="button">
            <code>/store</code>
            <span>Jump to store object</span>
          </button>
          <button class="json-query-example-item" onclick={() => { jsonQuery = '/store/book/0'; }} type="button">
            <code>/store/book/0</code>
            <span>Jump to first book</span>
          </button>
          <button class="json-query-example-item" onclick={() => { jsonQuery = '/store/book/0/title'; }} type="button">
            <code>/store/book/0/title</code>
            <span>Jump to book title</span>
          </button>
        </div>
      </div>
    {:else}
      {#each jsonQueryResults.slice((currentPage - 1) * pageSize, currentPage * pageSize) as result, index}
        {@const actualIndex = (currentPage - 1) * pageSize + index}
        <div
          class="json-query-result-item {jsonQuerySelectedIndex === actualIndex ? 'json-query-result-active' : ''}"
          onclick={() => selectJsonQueryResult(actualIndex)}
          role="button"
          tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectJsonQueryResult(actualIndex); } }}
          aria-label="Navigate to {result.pointer}"
        >
          <div class="json-query-result-indicator"></div>
          <div class="flex-1 min-w-0">
            <div class="json-query-result-pointer">{result.pointer}</div>
            <div class="json-query-result-preview">{result.preview}</div>
          </div>
          <div class="json-query-result-actions-right">
            <button
              class="json-query-action-btn-compact"
              onclick={(e) => { e.stopPropagation(); copyJsonQueryText(result.pointer); }}
              title="Copy pointer path"
              type="button"
            >
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              </svg>
              <span>Path</span>
            </button>
            <button
              class="json-query-action-btn-compact"
              onclick={(e) => { e.stopPropagation(); copyJsonQueryText(result.valueText); }}
              title="Copy value"
              type="button"
            >
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
              <span>Value</span>
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Pagination -->
  {#if jsonQueryResults.length > 0}
    {@const totalPages = Math.ceil(jsonQueryResults.length / pageSize)}
    <div class="json-query-pagination">
      <div class="json-query-pagination-nav">
        <button
          class="json-query-page-btn"
          onclick={() => { currentPage = Math.max(1, currentPage - 1); }}
          disabled={currentPage === 1 || totalPages === 1}
          type="button"
          title="Previous page"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>

        <div class="json-query-page-info">
          {#if totalPages > 1}
            <span class="text-xs font-medium text-(--text-primary)">{currentPage}</span>
            <span class="text-xs text-(--text-secondary)">/ {totalPages}</span>
          {:else}
            <span class="text-xs text-(--text-secondary)">{jsonQueryResults.length} results</span>
          {/if}
        </div>

        <button
          class="json-query-page-btn"
          onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); }}
          disabled={currentPage === totalPages || totalPages === 1}
          type="button"
          title="Next page"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>

      <div class="json-query-page-size">
        <svg class="w-3.5 h-3.5 text-(--text-secondary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M3 12h18M3 18h18"/>
        </svg>
        <select
          class="json-query-page-select"
          bind:value={pageSize}
          onchange={() => { currentPage = 1; }}
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
    </div>
  {/if}
</div>

<script lang="ts">
  import { t } from '$lib/i18n';
  import {
    buildGridRoot,
    collectExpandableGridPaths,
    describeExpandableGridValue,
    getGridChild,
    summarizeGridValue,
  } from '$lib/services/gridViewModel.js';
  import {
    getGridSelectionForCell,
    getGridSelectionRange,
    getGridSelectionText,
    shouldClearGridSelection,
    updateGridSelections,
  } from '$lib/services/gridSelection.js';
  import { parseJsonDocument } from '$lib/services/jsonDocumentParse.js';
  import { onMount } from 'svelte';
  import type MonacoEditor from './MonacoEditor.svelte';

  let { content, editor } = $props<{ content: string; editor: MonacoEditor | null }>();

  type GridCell = {
    value: unknown;
    path: string;
    expandable: boolean;
  };

  type GridRow = {
    path: string;
    source: unknown;
    cells: GridCell[];
  };

  type GridModel = {
    kind: 'object' | 'array-object' | 'array' | 'scalar';
    path: string;
    source: unknown;
    showHeader: boolean;
    columns: string[];
    rows: GridRow[];
  };

  type GridState =
    | { kind: 'empty' }
    | { kind: 'invalid'; error: string }
    | { kind: 'ok'; root: GridModel; pointers: Record<string, any> };

  type GridSelectionTarget = 'key' | 'value' | 'row';

  type GridSelection = {
    id: string;
    path: string;
    target: GridSelectionTarget;
  };

  let searchQuery = $state('');
  let expandedPaths = $state(new Set<string>());
  let selections = $state<GridSelection[]>([]);
  let selectionAnchor = $state<GridSelection | null>(null);

  $effect(() => {
    content;
    selections = [];
    selectionAnchor = null;
  });

  let gridState = $derived.by<GridState>(() => {
    const trimmed = content.trim();
    if (!trimmed) return { kind: 'empty' };

    try {
      const parsed = parseJsonDocument(content);
      return { kind: 'ok', root: buildGridRoot(parsed.data), pointers: parsed.pointers };
    } catch (error) {
      return {
        kind: 'invalid',
        error: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  });

  let expandablePaths = $derived.by(() =>
    gridState.kind === 'ok' ? collectExpandableGridPaths(gridState.root) : []
  );
  let isAllExpanded = $derived.by(() =>
    expandablePaths.length > 0 && expandablePaths.every((path) => expandedPaths.has(path))
  );

  function matchesQuery(row: GridRow) {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return row.cells.some((cell) =>
      cellText(cell.value).toLowerCase().includes(query)
    );
  }

  function cellText(value: unknown) {
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function cellType(value: unknown) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value === 'object' ? 'object' : typeof value;
  }

  function cellLabel(model: GridModel, row: GridRow, cellIndex: number) {
    if (model.kind === 'object' && cellIndex === 1) {
      return String(row.cells[0].value);
    }
    if (model.kind === 'array' && cellIndex === 1) {
      return Number(row.cells[0].value);
    }
    return model.columns[cellIndex];
  }

  function toggleExpanded(path: string) {
    const next = new Set(expandedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedPaths = next;
  }

  function collapseAll() {
    expandedPaths = new Set();
  }

  function expandAll() {
    expandedPaths = new Set(expandablePaths);
  }

  function handleCellClick(event: MouseEvent, model: GridModel, row: GridRow, cellIndex: number) {
    event.stopPropagation();
    const root = (event.currentTarget as HTMLElement | null)?.closest('.gv-root');
    if (root instanceof HTMLElement) root.focus();
    const selection = getGridSelectionForCell(model, row, cellIndex) satisfies GridSelection;
    const orderedRows = model.rows.map((entry) => entry.path);
    const nextSelections = updateGridSelections(selections, selection, {
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      anchor: selectionAnchor,
      orderedRows,
    }) as GridSelection[];

    selections = nextSelections;
    selectionAnchor = event.shiftKey && selectionAnchor ? selectionAnchor : selection;
  }

  function handleCellMouseDown(event: MouseEvent) {
    if (event.shiftKey) {
      event.preventDefault();
    }
  }

  function clearSelections() {
    selections = [];
    selectionAnchor = null;
  }

  function isSelected(path: string, target: GridSelection['target']) {
    return selections.some((selection) => selection.path === path && selection.target === target);
  }

  async function handleKeydown(event: KeyboardEvent) {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const commandKey = isMac ? event.metaKey : event.ctrlKey;
    if (!commandKey || event.key.toLowerCase() !== 'c') return;
    if (gridState.kind !== 'ok' || selections.length === 0) return;

    event.preventDefault();
    try {
      await navigator.clipboard.writeText(getGridSelectionText(selections, gridState.root.source));
    } catch (error) {
      console.error('Failed to copy grid selection:', error);
    }
  }

  onMount(() => {
    function handleDocumentPointerDown(event: PointerEvent) {
      if (selections.length === 0) return;
      if (!shouldClearGridSelection(event.target as { closest?: (selector: string) => unknown } | null)) return;
      clearSelections();
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown);
  });

  $effect(() => {
    if (gridState.kind !== 'ok' || selections.length === 0) {
      editor?.clearExternalSelectionHighlights();
      return;
    }

    const editorInstance = editor?.getEditorInstance();
    const model = editorInstance?.getModel();
    if (!editorInstance || !model) return;

    const sourceRanges = selections
      .map((selection) => getGridSelectionRange(gridState.pointers, selection.path, selection.target))
      .filter((range): range is { start: number; end: number } => range !== null);

    const ranges = sourceRanges.map((range) => {
        const start = model.getPositionAt(range.start);
        const end = model.getPositionAt(Math.max(range.start + 1, range.end));
        return {
          selectionStartLineNumber: start.lineNumber,
          selectionStartColumn: start.column,
          positionLineNumber: end.lineNumber,
          positionColumn: end.column,
        };
      });

    if (ranges.length === 0) {
      editor?.clearExternalSelectionHighlights();
      return;
    }

    editorInstance.setSelections(ranges);
    editor?.setExternalSelectionHighlights(
      sourceRanges.map((range) => {
        const start = model.getPositionAt(range.start);
        const end = model.getPositionAt(Math.max(range.start + 1, range.end));
        return {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
      }),
    );
    editorInstance.revealPositionInCenter({
      lineNumber: ranges[0].selectionStartLineNumber,
      column: ranges[0].selectionStartColumn,
    });
  });

</script>

<div class="gv-root" tabindex="0" role="grid" onkeydown={handleKeydown}>
  {#if gridState.kind === 'empty'}
    <div class="gv-empty">
      <div class="gv-empty-title">{$t('gridView.noData')}</div>
      <div class="gv-empty-hint">{$t('gridView.noDataHint')}</div>
    </div>
  {:else if gridState.kind === 'invalid'}
    <div class="gv-empty">
      <div class="gv-empty-title">{$t('gridView.invalidJson')}</div>
      <div class="gv-empty-hint gv-empty-hint--error">{gridState.error}</div>
    </div>
  {:else}
    <div class="gv-toolbar">
      <div class="gv-search-box">
        <input
          class="gv-search-input"
          placeholder={$t('gridView.searchPlaceholder')}
          bind:value={searchQuery}
          spellcheck="false"
          autocomplete="off"
        />
      </div>
      <button
        class="gv-toolbar-btn"
        onclick={isAllExpanded ? collapseAll : expandAll}
        disabled={expandablePaths.length === 0}
        title={isAllExpanded ? $t('gridView.collapseAll') : $t('gridView.expandAll')}
        type="button"
      >
        {#if isAllExpanded}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m17 11-5-5-5 5M17 18l-5-5-5 5"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m7 13 5 5 5-5M7 6l5 5 5-5"/>
          </svg>
        {/if}
      </button>
    </div>

    {#snippet renderCell(cell: GridCell, label: string | number)}
      {#if cell.expandable}
        {@const child = getGridChild(cell)}
        <div class="gv-nested">
          <button
            class="gv-expand"
            onclick={(event) => {
              event.stopPropagation();
              toggleExpanded(cell.path);
            }}
            type="button"
            title={cell.path}
          >
            <span class="gv-toggle-mark" class:gv-toggle-mark--expanded={expandedPaths.has(cell.path)}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M4 2.5 8 6 4 9.5" />
              </svg>
            </span>
            <span class="gv-nested-label">{describeExpandableGridValue(label, cell.value)}</span>
          </button>
          {#if expandedPaths.has(cell.path) && child}
            <div class="gv-inline-child">
              {@render renderGrid(child)}
            </div>
          {/if}
        </div>
      {:else}
        <span class="gv-cell gv-cell--{cellType(cell.value)}" title={cell.path}>
          {summarizeGridValue(cell.value)}
        </span>
      {/if}
    {/snippet}

    {#snippet renderGrid(model: GridModel)}
      {@const visibleRows = model.rows.filter(matchesQuery)}
      <div class="gv-grid-block">
        <table class="gv-table">
          {#if model.showHeader}
            <thead>
              <tr>
                {#each model.columns as column}
                  <th class="gv-th">{column}</th>
                {/each}
              </tr>
            </thead>
          {/if}
          <tbody>
            {#each visibleRows as row}
              <tr class="gv-tr" class:gv-tr--selected={isSelected(row.path, 'row')}>
                {#each row.cells as cell, cellIndex}
                  {@const cellSelection = getGridSelectionForCell(model, row, cellIndex)}
                  <td
                    class="gv-td"
                    class:gv-td--selected={cellSelection.target !== 'row' && isSelected(cellSelection.path, 'value')}
                    onmousedown={handleCellMouseDown}
                    onclick={(event) => handleCellClick(event, model, row, cellIndex)}
                  >
                    {@render renderCell(cell, cellLabel(model, row, cellIndex))}
                  </td>
                {/each}
              </tr>
            {:else}
              <tr>
                <td class="gv-empty-result" colspan={model.columns.length}>
                  {$t('gridView.noMatches')}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/snippet}

    <div class="gv-scroll">
      {@render renderGrid(gridState.root)}
    </div>
  {/if}
</div>

<style>
  .gv-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg-primary);
  }
  .gv-empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
  }
  .gv-empty-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .gv-empty-hint {
    max-width: 240px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .gv-empty-hint--error {
    color: var(--error, #ef4444);
    font-family: monospace;
  }
  .gv-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
  }
  .gv-search-box {
    flex: 1;
  }
  .gv-search-input {
    width: 100%;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 11px;
  }
  .gv-toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .gv-toolbar-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  .gv-toolbar-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .gv-toolbar-btn svg {
    width: 16px;
    height: 16px;
  }
  .gv-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px;
  }
  .gv-table {
    width: max-content;
    border-collapse: collapse;
    border: 1px solid var(--border);
    font-size: 12px;
    background: var(--bg-primary);
  }
  .gv-th {
    height: 32px;
    padding: 0 12px;
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-secondary) 92%, var(--bg-primary));
    color: var(--text-secondary);
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .gv-th:last-child {
    border-right: 0;
  }
  .gv-tr {
    transition: background 0.15s ease;
  }
  .gv-tr:hover {
    background: color-mix(in srgb, var(--bg-hover) 86%, transparent);
  }
  .gv-tr--selected {
    background: var(--accent-glow);
  }
  .gv-tr--selected:hover {
    background: var(--accent-glow);
  }
  .gv-td {
    min-height: 36px;
    padding: 8px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    border-right: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    vertical-align: top;
    cursor: pointer;
  }
  .gv-td--selected {
    background: var(--accent-glow);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 72%, transparent);
  }
  .gv-tr:last-child > .gv-td {
    border-bottom: 0;
  }
  .gv-td:last-child {
    border-right: 0;
  }
  .gv-tr .gv-td:first-child {
    min-width: 0;
    font-weight: 600;
    white-space: nowrap;
  }
  .gv-expand {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
  }
  .gv-toggle-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    color: var(--text-secondary);
    transition: transform 0.15s ease, color 0.15s ease;
  }
  .gv-toggle-mark svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
  .gv-toggle-mark--expanded {
    transform: rotate(90deg);
    color: var(--accent);
  }
  .gv-nested {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .gv-nested-label {
    color: var(--text-primary);
    font-weight: 600;
  }
  .gv-inline-child {
    margin-top: 6px;
    margin-left: 18px;
    padding: 0;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-primary) 88%, var(--bg-secondary));
  }
  .gv-tr--selected .gv-inline-child,
  .gv-tr--selected .gv-inline-child .gv-table,
  .gv-tr--selected .gv-inline-child .gv-td,
  .gv-td--selected .gv-inline-child,
  .gv-td--selected .gv-inline-child .gv-table,
  .gv-td--selected .gv-inline-child .gv-td {
    background: transparent;
  }
  .gv-tr--selected .gv-inline-child .gv-tr--selected > .gv-td {
    background: var(--accent-glow);
  }
  .gv-td--selected .gv-inline-child .gv-tr--selected > .gv-td {
    background: var(--accent-glow);
  }
  .gv-cell {
    display: inline-block;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
    font-size: 12px;
  }
  .gv-cell--null { color: var(--text-tertiary); font-style: italic; }
  .gv-cell--object,
  .gv-cell--array {
    padding: 2px 6px;
    border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    background: color-mix(in srgb, var(--bg-hover) 60%, transparent);
    color: var(--text-secondary);
  }
  .gv-empty-result {
    padding: 18px;
    color: var(--text-tertiary);
    text-align: center;
  }
  .gv-inline-child .gv-td {
    border-bottom-color: var(--border);
  }
</style>

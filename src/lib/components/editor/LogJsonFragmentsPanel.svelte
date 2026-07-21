<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import { Copy } from '@lucide/svelte';
  import { t } from '$lib/i18n';
  import { registerMonacoThemes, type EditorTheme } from '$lib/config/monacoThemes';
  import { initMonaco } from '$lib/services/monaco';

  export interface LogJsonFragment {
    label: string;
    line: number;
    column: number;
    raw: string;
    formatted: string;
    kind: string;
  }

  let {
    fragments = [],
    selectedIndex = 0,
    theme = 'vs',
    tabSize = 2,
  }: {
    fragments: LogJsonFragment[];
    selectedIndex: number;
    theme?: EditorTheme;
    tabSize?: number;
  } = $props();

  const dispatch = createEventDispatcher<{
    select: { index: number };
    copy: { value: string };
    close: void;
  }>();

  let selectedFragment = $derived(fragments[selectedIndex] || fragments[0] || null);
  let listWidth = $state(240);
  let panelHeightRatio = $state(0.5);
  let workspaceHeight = $state(0);
  let isResizing = $state(false);
  let isHeightResizing = $state(false);
  let panelElement = $state<HTMLElement | null>(null);
  let resultEditorContainer = $state<HTMLDivElement | null>(null);
  let resultEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let monaco: typeof Monaco | null = null;

  const MIN_LIST_WIDTH = 180;
  const MAX_LIST_WIDTH = 420;
  const MIN_PANEL_HEIGHT = 160;
  const MAX_PANEL_HEIGHT_RATIO = 0.7;
  const DEFAULT_LOG_JSON_FOLD_LEVEL = 5;
  let stopResizeListeners: (() => void) | null = null;
  let workspaceResizeObserver: ResizeObserver | null = null;
  let pendingFoldTimer: ReturnType<typeof setTimeout> | null = null;

  function clampListWidth(width: number) {
    return Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, width));
  }

  function clampPanelHeight(height: number) {
    const maxPanelHeight = Math.max(
      MIN_PANEL_HEIGHT,
      Math.floor(workspaceHeight * MAX_PANEL_HEIGHT_RATIO),
    );
    return Math.min(maxPanelHeight, Math.max(MIN_PANEL_HEIGHT, height));
  }

  function getPanelHeight() {
    return clampPanelHeight(workspaceHeight * panelHeightRatio);
  }

  function startResize(event: PointerEvent) {
    event.preventDefault();
    stopResizeListeners?.();
    isHeightResizing = false;
    const startX = event.clientX;
    const startWidth = listWidth;
    isResizing = true;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isResizing) return;
      listWidth = clampListWidth(startWidth + moveEvent.clientX - startX);
    };

    const handlePointerUp = () => {
      isResizing = false;
      stopResizeListeners?.();
      stopResizeListeners = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    stopResizeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }

  function startHeightResize(event: PointerEvent) {
    event.preventDefault();
    stopResizeListeners?.();
    isResizing = false;
    const startY = event.clientY;
    const startHeight = getPanelHeight();
    isHeightResizing = true;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isHeightResizing) return;
      const nextHeight = clampPanelHeight(startHeight + startY - moveEvent.clientY);
      panelHeightRatio = nextHeight / workspaceHeight;
    };

    const handlePointerUp = () => {
      isHeightResizing = false;
      stopResizeListeners?.();
      stopResizeListeners = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    stopResizeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }

  function syncResultEditor(fragment: LogJsonFragment | null) {
    if (!resultEditor || !fragment) return;
    if (resultEditor.getValue() !== fragment.formatted) {
      resultEditor.setValue(fragment.formatted);
      resultEditor.setScrollTop(0);
      resultEditor.setScrollLeft(0);
      scheduleDefaultFold();
    }
  }

  function scheduleDefaultFold() {
    if (!resultEditor) return;
    if (pendingFoldTimer) clearTimeout(pendingFoldTimer);
    pendingFoldTimer = setTimeout(() => {
      pendingFoldTimer = null;
      resultEditor?.getAction(`editor.foldLevel${DEFAULT_LOG_JSON_FOLD_LEVEL}`)?.run();
      resultEditor?.setScrollTop(0);
      resultEditor?.setScrollLeft(0);
    }, 0);
  }

  function clearPendingDefaultFold() {
    if (!pendingFoldTimer) return;
    clearTimeout(pendingFoldTimer);
    pendingFoldTimer = null;
  }

  function selectFragment(index: number) {
    syncResultEditor(fragments[index] || fragments[0] || null);
    dispatch('select', { index });
  }

  $effect(() => {
    syncResultEditor(fragments[selectedIndex] || fragments[0] || null);
  });

  $effect(() => {
    if (monaco && theme) {
      monaco.editor.setTheme(theme);
    }
  });

  $effect(() => {
    if (!resultEditor) return;
    resultEditor.updateOptions({ tabSize });
    const model = resultEditor.getModel();
    model?.updateOptions({
      tabSize,
      indentSize: tabSize,
      insertSpaces: true,
    });
  });

  onMount(async () => {
    const workspaceElement = panelElement?.parentElement;
    workspaceResizeObserver = new ResizeObserver(([entry]) => {
      workspaceHeight = entry.contentRect.height;
    });
    if (workspaceElement) {
      workspaceHeight = workspaceElement.clientHeight;
      workspaceResizeObserver.observe(workspaceElement);
    }

    const monacoInstance = await initMonaco();
    if (!resultEditorContainer) return;

    monaco = monacoInstance;
    registerMonacoThemes(monacoInstance);

    resultEditor = monacoInstance.editor.create(resultEditorContainer, {
      value: selectedFragment?.formatted || '',
      language: 'json',
      theme,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      folding: true,
      showFoldingControls: 'always',
      foldingStrategy: 'indentation',
      lineNumbers: 'on',
      wordWrap: 'off',
      automaticLayout: true,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
      tabSize,
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
      renderLineHighlight: 'none',
      matchBrackets: 'never',
      selectionHighlight: false,
      occurrencesHighlight: 'off',
      cursorStyle: 'line-thin',
      cursorBlinking: 'solid',
      cursorWidth: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      padding: { top: 10, bottom: 10 },
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        useShadows: false,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      contextmenu: false,
    });

    if (theme) {
      monacoInstance.editor.setTheme(theme);
    }

    scheduleDefaultFold();
  });

  onDestroy(() => {
    stopResizeListeners?.();
    workspaceResizeObserver?.disconnect();
    clearPendingDefaultFold();
    resultEditor?.dispose();
  });
</script>

{#if selectedFragment}
  <section
    class="log-json-panel"
    class:is-height-resizing={isHeightResizing}
    aria-label={$t('logJson.title')}
    bind:this={panelElement}
    style={`height: ${getPanelHeight()}px;`}
  >
    <div
      class="log-json-height-resizer"
      role="separator"
      aria-orientation="horizontal"
      aria-label={$t('logJson.resizeHeight')}
      title={$t('logJson.resizeHeight')}
      onpointerdown={startHeightResize}
    ></div>
    <div class="log-json-header">
      <div class="log-json-title-group">
        <div class="log-json-title">{$t('logJson.title')}</div>
        <div class="log-json-count">
          {$t('logJson.detected').replace('{count}', String(fragments.length))}
        </div>
      </div>
      <div class="log-json-actions">
        <button
          class="log-json-close"
          type="button"
          onclick={() => dispatch('close')}
          title={$t('logJson.close')}
          aria-label={$t('logJson.close')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>

    <div
      class="log-json-body"
      class:is-resizing={isResizing}
      style={`grid-template-columns: ${listWidth}px 6px minmax(0, 1fr);`}
    >
      <div class="log-json-list" role="tablist" aria-label={$t('logJson.fragments')}>
        {#each fragments as fragment, index}
          <button
            class="log-json-fragment {index === selectedIndex ? 'is-active' : ''}"
            type="button"
            role="tab"
            aria-selected={index === selectedIndex}
            onclick={() => selectFragment(index)}
          >
            <span class="log-json-fragment-row">
              <span class="log-json-fragment-name">{fragment.label}</span>
              <span class="log-json-fragment-meta">
                {$t('logJson.position')
                  .replace('{line}', String(fragment.line))
                  .replace('{column}', String(fragment.column))}
              </span>
            </span>
          </button>
        {/each}
      </div>

      <div
        class="log-json-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={$t('logJson.resize')}
        title={$t('logJson.resize')}
        onpointerdown={startResize}
      ></div>

      <div class="log-json-result">
        <button
          class="log-json-copy"
          type="button"
          onclick={() => dispatch('copy', { value: selectedFragment.formatted })}
          title={$t('logJson.copy')}
          aria-label={$t('logJson.copy')}
        >
          <Copy size={14} strokeWidth={2} />
        </button>
        <div class="log-json-result-editor" bind:this={resultEditorContainer}></div>
      </div>
    </div>
  </section>
{/if}

<style>
  .log-json-panel {
    min-height: 160px;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
    position: relative;
  }

  .log-json-panel.is-height-resizing {
    cursor: row-resize;
    user-select: none;
  }

  .log-json-height-resizer {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: row-resize;
    z-index: 3;
  }

  .log-json-height-resizer::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 2px;
    height: 1px;
    background: transparent;
    transition: background 0.15s ease;
  }

  .log-json-height-resizer:hover::before,
  .log-json-panel.is-height-resizing .log-json-height-resizer::before {
    background: color-mix(in srgb, var(--accent) 45%, var(--border));
  }

  .log-json-header {
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .log-json-title-group {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .log-json-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .log-json-count {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .log-json-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .log-json-close {
    height: 24px;
    width: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
    transition: all 0.15s ease;
  }

  .log-json-close svg {
    width: 13px;
    height: 13px;
  }

  .log-json-close:hover {
    color: var(--text-primary);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    background: var(--bg-hover);
  }

  .log-json-body {
    min-height: 0;
    flex: 1;
    display: grid;
    min-width: 0;
  }

  .log-json-body.is-resizing {
    cursor: col-resize;
    user-select: none;
  }

  .log-json-list {
    min-width: 0;
    overflow: auto;
    padding: 6px;
  }

  .log-json-resizer {
    width: 6px;
    cursor: col-resize;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    transition: background 0.15s ease;
  }

  .log-json-resizer:hover,
  .log-json-body.is-resizing .log-json-resizer {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-secondary));
  }

  .log-json-fragment {
    width: 100%;
    height: 30px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    text-align: left;
  }

  .log-json-fragment:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .log-json-fragment.is-active {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-primary));
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    color: var(--text-primary);
  }

  .log-json-fragment-row {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .log-json-fragment-name {
    min-width: 0;
    font-size: 11px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .log-json-fragment-meta {
    font-size: 10px;
    color: var(--text-tertiary);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .log-json-result {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .log-json-copy {
    position: absolute;
    top: 8px;
    right: 10px;
    z-index: 2;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-primary) 92%, transparent);
    color: var(--text-secondary);
    box-shadow: 0 2px 8px color-mix(in srgb, #000 18%, transparent);
    transition: all 0.15s ease;
  }

  .log-json-copy:hover {
    color: var(--text-primary);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    background: var(--bg-secondary);
  }

  .log-json-result-editor {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .log-json-result :global(.monaco-editor),
  .log-json-result :global(.monaco-editor-background),
  .log-json-result :global(.monaco-editor .margin) {
    background: var(--bg-primary);
  }

  .log-json-result :global(.monaco-scrollable-element) {
    padding-right: 40px;
  }

  .log-json-result :global(.monaco-editor .cursor) {
    display: none !important;
  }

  .log-json-result :global(.monaco-editor .bracket-match) {
    background: transparent !important;
    border-color: transparent !important;
  }
</style>

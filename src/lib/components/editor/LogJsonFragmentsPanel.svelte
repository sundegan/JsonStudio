<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { Copy } from '@lucide/svelte';
  import { t } from '$lib/i18n';

  export interface LogJsonFragment {
    label: string;
    line: number;
    column: number;
    raw: string;
    formatted: string;
    kind: 'JSON' | 'JSON5' | 'Escaped JSON' | 'Repaired JSON';
  }

  let {
    fragments = [],
    selectedIndex = 0,
  }: {
    fragments: LogJsonFragment[];
    selectedIndex: number;
  } = $props();

  const dispatch = createEventDispatcher<{
    select: { index: number };
    copy: { value: string };
    close: void;
  }>();

  let selectedFragment = $derived(fragments[selectedIndex] || fragments[0] || null);
  let listWidth = $state(240);
  let isResizing = $state(false);

  const MIN_LIST_WIDTH = 180;
  const MAX_LIST_WIDTH = 420;
  let stopResizeListeners: (() => void) | null = null;

  function clampListWidth(width: number) {
    return Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, width));
  }

  function startResize(event: PointerEvent) {
    event.preventDefault();
    stopResizeListeners?.();
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
    stopResizeListeners = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }

  onDestroy(() => {
    stopResizeListeners?.();
  });
</script>

{#if selectedFragment}
  <section class="log-json-panel" aria-label={$t('logJson.title')}>
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
            onclick={() => dispatch('select', { index })}
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
        <pre><code>{selectedFragment.formatted}</code></pre>
      </div>
    </div>
  </section>
{/if}

<style>
  .log-json-panel {
    height: 220px;
    min-height: 160px;
    max-height: 34%;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
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
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
    transition: all 0.15s ease;
  }

  .log-json-close {
    width: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
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
    overflow: auto;
    background: var(--bg-primary);
  }

  .log-json-copy {
    position: sticky;
    top: 8px;
    z-index: 2;
    width: 26px;
    height: 26px;
    margin: 8px 10px -34px auto;
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

  .log-json-result pre {
    margin: 0;
    min-height: 100%;
    padding: 10px 12px;
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
    font-size: 12px;
    line-height: 18px;
    color: var(--text-primary);
    white-space: pre;
  }
</style>

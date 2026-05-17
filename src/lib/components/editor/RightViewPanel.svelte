<script lang="ts">
  import { settingsStore } from '$lib/stores/settings';
  import { t } from '$lib/i18n';
  import JsonTreeView from './JsonTreeView.svelte';
  import GridView from './GridView.svelte';
  import type MonacoEditor from './MonacoEditor.svelte';

  type RightViewTab = 'tree' | 'grid' | 'graph';

  let {
    content,
    editor,
    onToast,
  } = $props<{
    content: string;
    editor: MonacoEditor | null;
    onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  }>();

  let activeTab = $state<RightViewTab>('tree');

  const tabs: { id: RightViewTab; labelKey: string; icon: string }[] = [
    {
      id: 'tree',
      labelKey: 'rightPanel.tree',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="2" width="6" height="6" rx="1"/>
        <rect x="3" y="14" width="6" height="6" rx="1"/>
        <rect x="15" y="14" width="6" height="6" rx="1"/>
        <path d="M12 8v3"/><path d="M12 11h-6"/><path d="M12 11h6"/>
        <path d="M6 14v-3"/><path d="M18 14v-3"/>
      </svg>`,
    },
    {
      id: 'grid',
      labelKey: 'rightPanel.grid',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>
      </svg>`,
    },
    {
      id: 'graph',
      labelKey: 'rightPanel.graph',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/>
        <path d="M7 12h5m5-5.5-5 5m0 1 5 5"/>
      </svg>`,
    },
  ];
</script>

<div class="rvp-root">
  <!-- Tab bar -->
  <div class="rvp-tabbar">
    <div class="rvp-tabs">
      {#each tabs as tab}
        <button
          class="rvp-tab"
          class:rvp-tab--active={activeTab === tab.id}
          onclick={() => { activeTab = tab.id; }}
          title={$t(tab.labelKey as any)}
          type="button"
        >
          <span class="rvp-tab-icon">{@html tab.icon}</span>
          <span class="rvp-tab-label">{$t(tab.labelKey as any)}</span>
        </button>
      {/each}
    </div>

    <!-- Close panel button -->
    <button
      class="rvp-close-btn"
      onclick={() => settingsStore.updateSetting('showTreeView', false)}
      title={$t('rightPanel.hide')}
      type="button"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  </div>

  <!-- View content -->
  <div class="rvp-content">
    <!-- Tree tab: always mounted so it keeps its query state, just hidden when not active -->
    <div class="rvp-view" class:rvp-view--hidden={activeTab !== 'tree'}>
      <JsonTreeView
        {content}
        {editor}
        on:toast={(e) => onToast(e.detail.message)}
      />
    </div>

    <!-- Grid tab: only mounted when active to avoid unnecessary JSON parsing overhead -->
    {#if activeTab === 'grid'}
      <div class="rvp-view">
        <GridView {content} {editor} />
      </div>
    {/if}

    <!-- Graph tab: placeholder for future implementation -->
    {#if activeTab === 'graph'}
      <div class="rvp-view rvp-graph-placeholder">
        <div class="rvp-graph-content">
          <!-- Graph icon -->
          <svg class="rvp-graph-icon" viewBox="0 0 80 80" fill="none">
            <circle cx="40" cy="40" r="38" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.2"/>
            <!-- Nodes -->
            <circle cx="40" cy="18" r="6" fill="var(--accent)" opacity="0.8"/>
            <circle cx="16" cy="56" r="6" fill="var(--accent)" opacity="0.6"/>
            <circle cx="64" cy="56" r="6" fill="var(--accent)" opacity="0.6"/>
            <circle cx="40" cy="44" r="5" fill="var(--accent)" opacity="0.4"/>
            <!-- Edges -->
            <line x1="40" y1="24" x2="40" y2="39" stroke="var(--accent)" stroke-width="1.5" opacity="0.5"/>
            <line x1="36" y1="47" x2="20" y2="52" stroke="var(--accent)" stroke-width="1.5" opacity="0.4"/>
            <line x1="44" y1="47" x2="60" y2="52" stroke="var(--accent)" stroke-width="1.5" opacity="0.4"/>
          </svg>

          <div class="rvp-graph-title">{$t('rightPanel.graphComingSoon')}</div>
          <div class="rvp-graph-hint">{$t('rightPanel.graphComingSoonHint')}</div>

          <!-- Tags -->
          <div class="rvp-graph-tags">
            <span class="rvp-graph-tag">D3.js</span>
            <span class="rvp-graph-tag">{$t('rightPanel.graphTagNodeGraph')}</span>
            <span class="rvp-graph-tag">{$t('rightPanel.graphTagForceLayout')}</span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .rvp-root {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    width: 100%;
    overflow: hidden;
    background: var(--bg-primary);
  }

  /* ── Tab Bar ── */
  .rvp-tabbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
    flex-shrink: 0;
    padding: 0 4px;
    height: 36px;
    gap: 2px;
  }

  .rvp-tabs {
    display: flex;
    align-items: center;
    gap: 1px;
    flex: 1;
    min-width: 0;
    height: 100%;
  }

  .rvp-tab {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    position: relative;
    border-radius: 0;
  }

  .rvp-tab:hover {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--bg-hover) 60%, transparent);
  }

  .rvp-tab--active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }

  .rvp-tab-icon {
    display: flex;
    align-items: center;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }

  :global(.rvp-tab-icon svg) {
    width: 14px;
    height: 14px;
  }

  .rvp-tab-label {
    font-size: 12px;
  }

  /* Close button */
  .rvp-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    transition: color 0.15s, background 0.15s;
  }
  .rvp-close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .rvp-close-btn svg { width: 14px; height: 14px; }

  /* ── View Content ── */
  .rvp-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
  }

  .rvp-view {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .rvp-view--hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* ── Graph Placeholder ── */
  .rvp-graph-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rvp-graph-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
    max-width: 240px;
  }

  .rvp-graph-icon {
    width: 72px;
    height: 72px;
    color: var(--text-secondary);
    opacity: 0.6;
    animation: rvp-float 3s ease-in-out infinite;
  }

  @keyframes rvp-float {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(-5px); }
  }

  .rvp-graph-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    opacity: 0.8;
  }

  .rvp-graph-hint {
    font-size: 11px;
    color: var(--text-secondary);
    opacity: 0.6;
    line-height: 1.6;
  }

  .rvp-graph-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin-top: 4px;
  }

  .rvp-graph-tag {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 20px;
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--border));
    letter-spacing: 0.03em;
  }
</style>

<script lang="ts">
  import { t } from '$lib/i18n';
  import JsonTreeView from './JsonTreeView.svelte';
  import GridView from './GridView.svelte';
  import type MonacoEditor from './MonacoEditor.svelte';

  type RightViewTab = 'tree' | 'grid';

  let {
    content,
    editor,
    activeTabPath,
    activeTabName,
    activeTabId,
    onToast,
  } = $props<{
    content: string;
    editor: MonacoEditor | null;
    activeTabPath: string | null;
    activeTabName: string | null;
    activeTabId: string;
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
  </div>

  <!-- View content -->
  <div class="rvp-content">
    <!-- Tree tab: always mounted so it keeps its query state, just hidden when not active -->
    <div class="rvp-view" class:rvp-view--hidden={activeTab !== 'tree'}>
      <JsonTreeView
        {content}
        {editor}
        tabId={activeTabId}
        on:toast={(e) => onToast(e.detail.message)}
      />
    </div>

    <!-- Grid tab: only mounted when active to avoid unnecessary JSON parsing overhead -->
    {#if activeTab === 'grid'}
      <div class="rvp-view">
        <GridView {content} {editor} {activeTabPath} {activeTabName} {onToast} />
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
</style>

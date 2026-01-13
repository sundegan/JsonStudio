<script lang="ts">
  import { tabsStore, type Tab } from '$lib/stores/tabs';
  import { createEventDispatcher } from 'svelte';
  
  const { leftTabs, rightTabs, leftActiveTabId, rightActiveTabId, isDarkMode } = $props<{
    leftTabs: Tab[];
    rightTabs: Tab[];
    leftActiveTabId: string | null;
    rightActiveTabId: string | null;
    isDarkMode: boolean;
  }>();
  
  const dispatch = createEventDispatcher();
  
  function handleLeftTabClick(tabId: string) {
    tabsStore.setDiffLeftActiveTab(tabId);
    dispatch('leftTabChange', { tabId });
  }
  
  function handleRightTabClick(tabId: string) {
    tabsStore.setDiffRightActiveTab(tabId);
    dispatch('rightTabChange', { tabId });
  }
  
  function handleCloseLeftTab(tabId: string, event: MouseEvent) {
    event.stopPropagation();
    
    const tab = leftTabs.find((t: Tab) => t.id === tabId);
    if (tab && tab.isModified) {
      const confirmClose = confirm(`"${tab.fileName || 'Untitled'}" has unsaved changes. Close anyway?`);
      if (!confirmClose) return;
    }
    
    tabsStore.removeDiffLeftTab(tabId);
  }
  
  function handleCloseRightTab(tabId: string, event: MouseEvent) {
    event.stopPropagation();
    
    const tab = rightTabs.find((t: Tab) => t.id === tabId);
    if (tab && tab.isModified) {
      const confirmClose = confirm(`"${tab.fileName || 'Untitled'}" has unsaved changes. Close anyway?`);
      if (!confirmClose) return;
    }
    
    tabsStore.removeDiffRightTab(tabId);
  }
  
  function handleNewLeftTab() {
    tabsStore.addDiffLeftTab();
  }
  
  function handleNewRightTab() {
    tabsStore.addDiffRightTab();
  }
  
  function getTabDisplayName(tab: Tab): string {
    if (tab.fileName) {
      return tab.fileName;
    }
    if (tab.isDefault) {
      return 'Default';
    }
    return 'Untitled';
  }
</script>

<div class="diff-tab-bar">
  <!-- Left tabs -->
  <div class="diff-tabs-container">
    {#each leftTabs as tab (tab.id)}
      <div
        class="diff-tab-button group
               {tab.id === leftActiveTabId 
                 ? 'bg-(--bg-primary) text-(--text-primary)' 
                 : 'bg-transparent text-(--text-secondary) hover:bg-(--bg-primary)/30'
               }"
        onclick={() => handleLeftTabClick(tab.id)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleLeftTabClick(tab.id); } }}
        role="tab"
        aria-selected={tab.id === leftActiveTabId}
        tabindex="0"
      >
        <!-- Tab name -->
        <span class="diff-tab-title">
          <span class="diff-tab-title-text truncate">
            {getTabDisplayName(tab)}
          </span>
          {#if tab.id === leftActiveTabId}
            <span
              class="diff-tab-active-dot"
              style={`background: ${isDarkMode ? '#7dd3fc' : '#22c55e'};`}
              aria-hidden="true"
            ></span>
          {/if}
        </span>
        
        <!-- Modified indicator or close button -->
        <span class="diff-tab-actions">
          {#if tab.isModified && tab.id !== leftActiveTabId}
            <span class="w-1.5 h-1.5 rounded-full bg-(--text-secondary)"></span>
          {:else}
            <button
              class="close-button w-5 h-5 flex items-center justify-center rounded-sm
                     opacity-0 group-hover:opacity-100
                     hover:bg-(--bg-hover)
                     transition-opacity duration-100"
              onclick={(e) => handleCloseLeftTab(tab.id, e)}
              title="Close (Cmd+W)"
              aria-label="Close tab"
              type="button"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>
              </svg>
            </button>
          {/if}
        </span>
      </div>
    {/each}
    
    <!-- New tab button -->
    <button
      class="diff-new-tab-button"
      onclick={handleNewLeftTab}
      title="New Tab"
      aria-label="New left tab"
      type="button"
    >
      <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
      </svg>
    </button>
  </div>
  
  <!-- Separator -->
  <div class="diff-separator"></div>
  
  <!-- Right tabs -->
  <div class="diff-tabs-container">
    {#each rightTabs as tab (tab.id)}
      <div
        class="diff-tab-button group
               {tab.id === rightActiveTabId 
                 ? 'bg-(--bg-primary) text-(--text-primary)' 
                 : 'bg-transparent text-(--text-secondary) hover:bg-(--bg-primary)/30'
               }"
        onclick={() => handleRightTabClick(tab.id)}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRightTabClick(tab.id); } }}
        role="tab"
        aria-selected={tab.id === rightActiveTabId}
        tabindex="0"
      >
        <!-- Tab name -->
        <span class="diff-tab-title">
          <span class="diff-tab-title-text truncate">
            {getTabDisplayName(tab)}
          </span>
          {#if tab.id === rightActiveTabId}
            <span
              class="diff-tab-active-dot"
              style={`background: ${isDarkMode ? '#7dd3fc' : '#22c55e'};`}
              aria-hidden="true"
            ></span>
          {/if}
        </span>
        
        <!-- Modified indicator or close button -->
        <span class="diff-tab-actions">
          {#if tab.isModified && tab.id !== rightActiveTabId}
            <span class="w-1.5 h-1.5 rounded-full bg-(--text-secondary)"></span>
          {:else}
            <button
              class="close-button w-5 h-5 flex items-center justify-center rounded-sm
                     opacity-0 group-hover:opacity-100
                     hover:bg-(--bg-hover)
                     transition-opacity duration-100"
              onclick={(e) => handleCloseRightTab(tab.id, e)}
              title="Close (Cmd+W)"
              aria-label="Close tab"
              type="button"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>
              </svg>
            </button>
          {/if}
        </span>
      </div>
    {/each}
    
    <!-- New tab button -->
    <button
      class="diff-new-tab-button"
      onclick={handleNewRightTab}
      title="New Tab"
      aria-label="New right tab"
      type="button"
    >
      <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .diff-tab-bar {
    display: grid;
    grid-template-columns: 1fr 1px 1fr;
    align-items: stretch;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    height: 24px;
    flex-shrink: 0;
  }
  
  .diff-separator {
    width: 1px;
    background: var(--border);
    flex-shrink: 0;
  }
  
  .diff-tabs-container {
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    overflow-y: hidden;
    min-width: 0;
    border-right: 1px solid var(--border);
  }
  
  .diff-tabs-container::-webkit-scrollbar {
    height: 0;
  }
  
  .diff-tabs-container {
    scrollbar-width: none;
  }
  
  .diff-tab-button {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20px;
    align-items: center;
    padding: 0 8px;
    min-width: 100px;
    max-width: 180px;
    cursor: pointer;
    user-select: none;
    transition: background-color 0.1s;
    border-right: 1px solid var(--border);
  }
  
  .diff-tab-title {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
  }
  
  .diff-tab-title-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .diff-tab-active-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  
  .diff-tab-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
  }
  
  .diff-new-tab-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    flex-shrink: 0;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.1s;
  }
  
  .diff-new-tab-button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  
  .diff-new-tab-button:active {
    background: var(--bg-tertiary);
  }
</style>

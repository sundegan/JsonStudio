<script lang="ts">
  import { tabsStore, type Tab } from '$lib/stores/tabs';
  import { createEventDispatcher } from 'svelte';
  
  const { tabs, activeTabId, isDarkMode } = $props<{
    tabs: Tab[];
    activeTabId: string | null;
    isDarkMode: boolean;
  }>();
  
  const dispatch = createEventDispatcher();
  
  let draggedTabId = $state<string | null>(null);
  let dragOverTabId = $state<string | null>(null);
  
  function handleTabClick(tabId: string) {
    tabsStore.setActiveTab(tabId);
  }
  
  function handleCloseTab(tabId: string, event: MouseEvent) {
    event.stopPropagation();
    
    const tab = tabs.find((t: Tab) => t.id === tabId);
    if (tab && tab.isModified) {
      const confirmClose = confirm(`"${tab.fileName || 'Untitled'}" has unsaved changes. Close anyway?`);
      if (!confirmClose) return;
    }
    
    tabsStore.removeTab(tabId);
  }
  
  function handleNewTab() {
    tabsStore.addTab();
  }
  
  // Drag and drop handlers
  function handleDragStart(tabId: string, event: DragEvent) {
    if (!event.dataTransfer) return;
    draggedTabId = tabId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/html', tabId);
    
    // Add dragging class with slight delay for visual feedback
    setTimeout(() => {
      const element = event.target as HTMLElement;
      element.classList.add('dragging');
    }, 0);
  }
  
  function handleDragEnd(event: DragEvent) {
    draggedTabId = null;
    dragOverTabId = null;
    
    const element = event.target as HTMLElement;
    element.classList.remove('dragging');
  }
  
  function handleDragOver(tabId: string, event: DragEvent) {
    event.preventDefault();
    if (!event.dataTransfer) return;
    
    event.dataTransfer.dropEffect = 'move';
    
    if (draggedTabId && draggedTabId !== tabId) {
      dragOverTabId = tabId;
    }
  }
  
  function handleDragLeave() {
    dragOverTabId = null;
  }
  
  function handleDrop(targetTabId: string, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    
    if (!draggedTabId || draggedTabId === targetTabId) {
      draggedTabId = null;
      dragOverTabId = null;
      return;
    }
    
    const fromIndex = tabs.findIndex((t: Tab) => t.id === draggedTabId);
    const toIndex = tabs.findIndex((t: Tab) => t.id === targetTabId);
    
    if (fromIndex !== -1 && toIndex !== -1) {
      tabsStore.reorderTabs(fromIndex, toIndex);
    }
    
    draggedTabId = null;
    dragOverTabId = null;
  }
  
  function getTabDisplayName(tab: Tab): string {
    if (tab.fileName) {
      return tab.fileName;
    }
    return 'Untitled';
  }
</script>

<div class="flex items-stretch bg-(--bg-secondary) border-b border-(--border) shrink-0" style="height: 24px;">
  <div class="flex items-stretch flex-1 min-w-0 overflow-x-auto overflow-y-hidden tabs-container">
    {#each tabs as tab (tab.id)}
      <div
        class="tab-button group relative flex items-center px-3 text-[13px] border-r border-(--border)
               transition-colors duration-100 min-w-[100px] max-w-[160px] cursor-pointer
               {tab.id === activeTabId 
                 ? 'bg-(--bg-primary) text-(--text-primary)' 
                 : 'bg-transparent text-(--text-secondary) hover:bg-(--bg-primary)/30'
               }
               {dragOverTabId === tab.id ? 'drag-over' : ''}"
        draggable="true"
        onclick={() => handleTabClick(tab.id)}
        ondragstart={(e) => handleDragStart(tab.id, e)}
        ondragend={handleDragEnd}
        ondragover={(e) => handleDragOver(tab.id, e)}
        ondragleave={handleDragLeave}
        ondrop={(e) => handleDrop(tab.id, e)}
        role="tab"
        aria-selected={tab.id === activeTabId}
        tabindex="0"
      >
        <!-- Tab name -->
        <span class="truncate text-center flex-1 mx-5">
          {getTabDisplayName(tab)}
        </span>
        
        <!-- Modified indicator or close button -->
        <span class="absolute right-1.5 flex items-center">
          {#if tab.isModified && tab.id !== activeTabId}
            <span class="w-1.5 h-1.5 rounded-full bg-(--text-secondary)"></span>
          {:else}
            <span
              class="close-button w-4 h-4 flex items-center justify-center rounded-sm
                     opacity-0 group-hover:opacity-100
                     hover:bg-(--bg-hover)
                     transition-opacity duration-100"
              onclick={(e) => handleCloseTab(tab.id, e)}
              role="button"
              tabindex="-1"
              title="Close (Cmd+W)"
            >
              <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
              </svg>
            </span>
          {/if}
        </span>
      </div>
    {/each}
  </div>
  
  <!-- Actions area -->
  <div class="flex items-center px-1 shrink-0">
    <button
      class="w-5 h-5 flex items-center justify-center rounded-sm
             text-(--text-secondary)
             hover:bg-(--bg-hover)
             active:bg-(--bg-tertiary)
             transition-colors duration-100"
      onclick={handleNewTab}
      title="New Tab (Cmd+T)"
    >
      <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .tab-button {
    user-select: none;
    cursor: pointer;
    position: relative;
  }
  
  .tab-button.dragging {
    opacity: 0.5;
  }
  
  /* Drag indicator */
  .tab-button.drag-over::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent, #3b82f6);
  }
  
  /* Custom scrollbar */
  .tabs-container::-webkit-scrollbar {
    height: 0;
  }
  
  .tabs-container {
    scrollbar-width: none;
  }
</style>

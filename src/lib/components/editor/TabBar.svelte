<script lang="ts">
  import { tabsStore, type Tab } from '$lib/stores/tabs';
  import { createEventDispatcher, onMount } from 'svelte';
  
  const { tabs, activeTabId, isDarkMode } = $props<{
    tabs: Tab[];
    activeTabId: string | null;
    isDarkMode: boolean;
  }>();
  
  const dispatch = createEventDispatcher();
  
  let draggedTabId = $state<string | null>(null);
  let dragOverTabId = $state<string | null>(null);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);
  let contextMenuTabId = $state<string | null>(null);
  let isContextMenuOpen = $state(false);
  let contextMenuRef: HTMLDivElement | null = null;
  
  function handleTabClick(tabId: string) {
    tabsStore.setActiveTab(tabId);
  }

  function closeContextMenu() {
    isContextMenuOpen = false;
    contextMenuTabId = null;
  }

  function handleTabContextMenu(tabId: string, event: MouseEvent) {
    event.preventDefault();
    const menuWidth = 180;
    const menuHeight = 80;
    const maxX = window.innerWidth - menuWidth - 8;
    const maxY = window.innerHeight - menuHeight - 8;
    contextMenuX = Math.max(8, Math.min(event.clientX, maxX));
    contextMenuY = Math.max(8, Math.min(event.clientY, maxY));
    contextMenuTabId = tabId;
    isContextMenuOpen = true;
  }

  function handleCloseOtherTabs() {
    if (contextMenuTabId) {
      tabsStore.closeOtherTabs(contextMenuTabId);
    }
    closeContextMenu();
  }

  function handleTogglePinTab() {
    if (contextMenuTabId) {
      tabsStore.togglePinTab(contextMenuTabId);
    }
    closeContextMenu();
  }

  function handleCloseAllTabs() {
    tabsStore.closeAllTabs();
    closeContextMenu();
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
    if (tab.isDefault) {
      return 'Default';
    }
    return 'Untitled';
  }

  function getContextMenuTab(): Tab | null {
    return contextMenuTabId ? tabs.find(tab => tab.id === contextMenuTabId) || null : null;
  }

  onMount(() => {
    const handleWindowClick = (event: MouseEvent) => {
      if (!isContextMenuOpen) return;
      const target = event.target as Node;
      if (contextMenuRef && contextMenuRef.contains(target)) return;
      closeContextMenu();
    };

    const handleWindowKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    window.addEventListener('click', handleWindowClick);
    window.addEventListener('keydown', handleWindowKeydown);

    return () => {
      window.removeEventListener('click', handleWindowClick);
      window.removeEventListener('keydown', handleWindowKeydown);
    };
  });
</script>

<div class="flex items-stretch bg-(--bg-secondary) border-b border-(--border) shrink-0" style="height: 24px;">
  <div class="flex items-stretch flex-1 min-w-0 overflow-x-auto overflow-y-hidden tabs-container">
    {#each tabs as tab (tab.id)}
      <div
        class="tab-button group grid items-center pl-2 pr-0 text-[13px] border-r border-(--border)
               transition-colors duration-100 min-w-[100px] max-w-[160px] cursor-pointer
               {tab.id === activeTabId 
                 ? 'bg-(--bg-primary) text-(--text-primary)' 
                 : 'bg-transparent text-(--text-secondary) hover:bg-(--bg-primary)/30'
               }
               {dragOverTabId === tab.id ? 'drag-over' : ''}"
        draggable="true"
        onclick={() => handleTabClick(tab.id)}
        oncontextmenu={(e) => handleTabContextMenu(tab.id, e)}
        ondragstart={(e) => handleDragStart(tab.id, e)}
        ondragend={handleDragEnd}
        ondragover={(e) => handleDragOver(tab.id, e)}
        ondragleave={handleDragLeave}
        ondrop={(e) => handleDrop(tab.id, e)}
        role="tab"
        aria-selected={tab.id === activeTabId}
        tabindex="0"
      >
        <span class="tab-spacer" aria-hidden="true"></span>
        <!-- Tab name -->
        <span class="tab-title">
          <span class="tab-title-text truncate text-center">
            {getTabDisplayName(tab)}
          </span>
          {#if tab.isPinned}
            <button
              class="pin-button"
              onclick={(e) => { e.stopPropagation(); tabsStore.togglePinTab(tab.id); }}
              title="Unpin"
              aria-label="Unpin tab"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
              </svg>
            </button>
          {/if}
          {#if tab.id === activeTabId}
            <span
              class="tab-active-dot"
              style={`background: ${isDarkMode ? '#7dd3fc' : '#22c55e'};`}
              aria-hidden="true"
            ></span>
          {/if}
        </span>
        
        <!-- Modified indicator or close button -->
        <span class="tab-actions">
          {#if tab.isModified && tab.id !== activeTabId}
            <span class="w-1.5 h-1.5 rounded-full bg-(--text-secondary)"></span>
          {:else}
            <span
              class="close-button w-6 h-6 flex items-center justify-end pr-1 rounded-sm
                     opacity-0 group-hover:opacity-100
                     hover:bg-(--bg-hover)
                     transition-opacity duration-100"
              onclick={(e) => handleCloseTab(tab.id, e)}
              role="button"
              tabindex="-1"
              title="Close (Cmd+W)"
            >
              <svg class="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>
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

{#if isContextMenuOpen}
  {@const contextTab = getContextMenuTab()}
  <div
    class="tab-context-menu"
    bind:this={contextMenuRef}
    style={`left: ${contextMenuX}px; top: ${contextMenuY}px;`}
    role="menu"
  >
    <button class="tab-context-menu-item" onclick={handleTogglePinTab} role="menuitem">
      {contextTab?.isPinned ? 'Unpin Tab' : 'Pin Tab'}
    </button>
    <button class="tab-context-menu-item" onclick={handleCloseOtherTabs} role="menuitem">
      Close Other Tabs
    </button>
    <button class="tab-context-menu-item" onclick={handleCloseAllTabs} role="menuitem">
      Close All Tabs
    </button>
  </div>
{/if}

<style>
  .tab-button {
    user-select: none;
    cursor: pointer;
    position: relative;
    grid-template-columns: 24px minmax(0, 1fr) 24px;
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

  .tab-context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 180px;
    padding: 4px;
    background: var(--bg-secondary, #1f1f1f);
    border: 1px solid var(--border, #333);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }

  .tab-context-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary, #e5e7eb);
    font-size: 12px;
    cursor: pointer;
  }

  .tab-context-menu-item:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.08));
  }

  .tab-active-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-primary, #e5e7eb);
    flex-shrink: 0;
  }

  .pin-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    padding: 2px;
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.15s ease;
    color: var(--text-secondary, #9ca3af);
  }

  .pin-button:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #e5e7eb);
    transform: scale(1.1);
  }

  .pin-button:active {
    transform: scale(0.95);
  }

  .tab-title {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 0;
    width: 100%;
  }

  .tab-title-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    justify-self: end;
  }

  .tab-spacer {
    width: 24px;
    justify-self: start;
  }
</style>

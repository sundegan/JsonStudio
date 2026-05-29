<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { tabsStore, type Tab } from '$lib/stores/tabs';
  import {
    shouldConfirmCloseAllTabs,
    shouldConfirmCloseOtherTabs,
    shouldConfirmCloseTab,
  } from '$lib/stores/tabClose.js';
  import { getTabInsertionTarget } from '$lib/stores/tabOrder.js';
  import { onMount, tick } from 'svelte';
  import ConfirmDialog from '../dialogs/ConfirmDialog.svelte';
  
  let { tabs, activeTabId } = $props<{
    tabs: Tab[];
    activeTabId: string | null;
  }>();
  
  let dragOverTabId = $state<string | null>(null);
  let dragOverPosition = $state<'before' | 'after'>('before');
  let dragInsertionIndex = $state<number | null>(null);
  let pointerDragStart = $state<{ tabId: string; x: number; y: number } | null>(null);
  let isPointerDragging = $state(false);
  let suppressNextClick = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);
  let contextMenuTabId = $state<string | null>(null);
  let isContextMenuOpen = $state(false);
  let contextMenuRef = $state<HTMLDivElement | null>(null);
  let tabsContainer = $state<HTMLDivElement | null>(null);
  
  // Confirm dialog state
  let isConfirmOpen = $state(false);
  let tabToClose = $state<string | null>(null);
  let confirmAction = $state<'tab' | 'others' | 'all' | null>(null);
  let confirmMessage = $state('');

  function handleTabClick(tabId: string, event: MouseEvent) {
    if (suppressNextClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = false;
      return;
    }
    tabsStore.setActiveTab(tabId);
  }

  function handleTabsWheel(event: WheelEvent) {
    const container = event.currentTarget as HTMLElement;
    if (container.scrollWidth <= container.clientWidth) return;

    const scrollDelta = event.deltaX || event.deltaY;
    if (!scrollDelta) return;

    event.preventDefault();
    container.scrollLeft += event.deltaX || event.deltaY;
  }

  function closeContextMenu() {
    isContextMenuOpen = false;
    contextMenuTabId = null;
  }

  function handleCloseOtherTabs() {
    if (contextMenuTabId) {
      if (shouldConfirmCloseOtherTabs(tabs, contextMenuTabId)) {
        tabToClose = contextMenuTabId;
        confirmAction = 'others';
        confirmMessage = 'Other tabs have unsaved changes. Close them anyway?';
        isConfirmOpen = true;
        closeContextMenu();
        return;
      }
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
    if (shouldConfirmCloseAllTabs(tabs)) {
      confirmAction = 'all';
      confirmMessage = 'Some tabs have unsaved changes. Close all tabs anyway?';
      isConfirmOpen = true;
      closeContextMenu();
      return;
    }
    tabsStore.closeAllTabs();
    closeContextMenu();
  }
  
  function onConfirmClose() {
    if (confirmAction === 'all') {
      tabsStore.closeAllTabs();
    } else if (confirmAction === 'others' && tabToClose) {
      tabsStore.closeOtherTabs(tabToClose);
    } else if (confirmAction === 'tab' && tabToClose) {
      tabsStore.removeTab(tabToClose);
    }
    tabToClose = null;
    confirmAction = null;
  }

  function onCancelClose() {
    tabToClose = null;
    confirmAction = null;
  }
  
  function resetPointerDragState() {
    dragOverTabId = null;
    dragOverPosition = 'before';
    dragInsertionIndex = null;
    pointerDragStart = null;
    isPointerDragging = false;
  }

  function getTabRects() {
    if (!tabsContainer) return [];
    return Array.from(tabsContainer.querySelectorAll<HTMLElement>('[data-tab-id]'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.dataset.tabId || '',
          left: rect.left,
          width: rect.width,
        };
      })
      .filter((rect) => rect.id);
  }

  function updatePointerDragTarget(clientX: number) {
    const target = getTabInsertionTarget(getTabRects(), clientX);
    if (!target) {
      dragOverTabId = null;
      dragInsertionIndex = null;
      return;
    }

    dragOverTabId = target.targetTabId;
    dragOverPosition = target.position;
    dragInsertionIndex = target.insertionIndex;
  }

  function handleTabMiddleClick(tabId: string, event: MouseEvent) {
    if (event.button !== 1) return;
    event.preventDefault();
    handleCloseTab(tabId, event);
  }

  function handleTabPointerDown(tabId: string, event: PointerEvent) {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest('button, [role="button"]')) return;

    closeContextMenu();
    pointerDragStart = { tabId, x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handleTabPointerMove(event: PointerEvent) {
    if (!pointerDragStart) return;

    const moveX = Math.abs(event.clientX - pointerDragStart.x);
    const moveY = Math.abs(event.clientY - pointerDragStart.y);
    if (!isPointerDragging && Math.max(moveX, moveY) < 4) return;

    event.preventDefault();
    isPointerDragging = true;
    updatePointerDragTarget(event.clientX);
  }

  function handleTabPointerUp(event: PointerEvent) {
    const start = pointerDragStart;
    const wasDragging = isPointerDragging;

    if (start && wasDragging) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = true;

      const fromIndex = tabs.findIndex((tab: Tab) => tab.id === start.tabId);
      if (fromIndex !== -1 && dragInsertionIndex !== null) {
        tabsStore.reorderTabs(fromIndex, dragInsertionIndex);
      }
    }

    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // The pointer can already be released if the OS cancels the gesture.
    }
    resetPointerDragState();
  }

  function handleTabPointerCancel() {
    resetPointerDragState();
  }

  async function handleOpenInFileExplorer() {
    const tab = getContextMenuTab();
    if (tab?.filePath) {
      await invoke('show_in_folder', { path: tab.filePath });
    }
    closeContextMenu();
  }

  function handleTabContextMenu(tabId: string, event: MouseEvent) {
    if (isPointerDragging) {
      event.preventDefault();
      return;
    }

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

  function handleCloseTab(tabId: string, event: MouseEvent) {
    event.stopPropagation();
    
    const tab = tabs.find((t: Tab) => t.id === tabId);
    if (shouldConfirmCloseTab(tabs, tabId)) {
      tabToClose = tabId;
      confirmAction = 'tab';
      confirmMessage = `"${tab.fileName || 'Untitled'}" has unsaved changes. Close anyway?`;
      isConfirmOpen = true;
      return;
    }
    
    tabsStore.removeTab(tabId);
  }
  
  function getTabDisplayName(tab: Tab): string {
    if (tab.fileName) {
      return tab.fileName;
    }
    return 'Untitled';
  }

  function getContextMenuTab(): Tab | null {
    return contextMenuTabId ? tabs.find((tab: Tab) => tab.id === contextMenuTabId) || null : null;
  }

  $effect(() => {
    const tabId = activeTabId;
    tabs.length;
    tick().then(() => {
      if (!tabId || !tabsContainer) return;
      const activeTab = Array.from(tabsContainer.querySelectorAll<HTMLElement>('[data-tab-id]'))
        .find((element) => element.dataset.tabId === tabId);
      activeTab?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    });
  });

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

<div class="flex items-center bg-(--bg-primary) border-b border-(--border) shrink-0 px-3 py-1" style="height: 30px;">
  <div class="flex items-center flex-1 min-w-0 overflow-x-auto overflow-y-hidden tabs-container gap-1.5 h-full" bind:this={tabsContainer} onwheel={handleTabsWheel}>
    {#each tabs as tab (tab.id)}
      <div
        class="tab-button group flex items-center justify-between px-2 text-[10.5px] 
               transition-all duration-200 min-w-[100px] max-w-[160px] cursor-pointer
               rounded-md border h-[22px]
               {tab.id === activeTabId 
                 ? 'bg-color-mix(in srgb, var(--accent) 10%, var(--bg-secondary)) text-(--accent) !border-color-mix(in srgb, var(--accent) 30%, var(--border)) shadow-sm font-semibold' 
                 : 'text-(--text-secondary) border-transparent hover:bg-(--bg-hover)'
               }
               {dragOverTabId === tab.id ? `drag-over drag-over-${dragOverPosition}` : ''}"
        onclick={(e) => handleTabClick(tab.id, e)}
        onauxclick={(e) => handleTabMiddleClick(tab.id, e)}
        oncontextmenu={(e) => handleTabContextMenu(tab.id, e)}
        onpointerdown={(e) => handleTabPointerDown(tab.id, e)}
        onpointermove={handleTabPointerMove}
        onpointerup={handleTabPointerUp}
        onpointercancel={handleTabPointerCancel}
        role="tab"
        aria-selected={tab.id === activeTabId}
        tabindex="0"
        data-tab-id={tab.id}
      >
        <!-- Left spacer to balance the right actions, ensuring perfect centering -->
        <div class="w-4 flex-shrink-0"></div>

        <!-- Center Group: Pin + Title -->
        <div class="flex items-center justify-center gap-1.5 flex-1 min-w-0 px-1">
          {#if tab.isPinned}
            <div class="flex items-center justify-center w-2.5 h-2.5 flex-shrink-0">
              <button
                class="pin-button flex-shrink-0"
                onclick={(e) => { e.stopPropagation(); tabsStore.togglePinTab(tab.id); }}
                title="Unpin"
                aria-label="Unpin tab"
              >
                <svg class="w-3 h-3 rotate-45 transform" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/>
                </svg>
              </button>
            </div>
          {/if}
          <span class="truncate block min-w-0">
            {getTabDisplayName(tab)}
          </span>
        </div>
        
        <!-- Right actions: Modified dot / Close button -->
        <div class="w-4 flex-shrink-0 flex items-center justify-center relative">
          {#if tab.isModified}
            <span class="w-1.5 h-1.5 rounded-full {tab.id === activeTabId ? 'bg-(--accent)' : 'bg-(--text-tertiary)'} transition-colors group-hover:opacity-0 absolute"></span>
            <span
              class="w-4 h-4 flex items-center justify-center rounded-md
                     opacity-0 group-hover:opacity-100
                     hover:bg-(--bg-tertiary) hover:text-(--text-primary)
                     transition-all duration-150 absolute"
              onclick={(e) => handleCloseTab(tab.id, e)}
              role="button"
              tabindex="-1"
              title="Close (Cmd+W)"
            >
              <svg class="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>
              </svg>
            </span>
          {:else}
            <span
              class="w-4 h-4 flex items-center justify-center rounded-md
                     opacity-0 group-hover:opacity-100
                     hover:bg-(--bg-tertiary) hover:text-(--text-primary)
                     transition-all duration-150"
              onclick={(e) => handleCloseTab(tab.id, e)}
              role="button"
              tabindex="-1"
              title="Close (Cmd+W)"
            >
              <svg class="w-2.5 h-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>
              </svg>
            </span>
          {/if}
        </div>
      </div>
    {/each}
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
    {#if contextTab?.filePath}
      <button class="tab-context-menu-item" onclick={handleOpenInFileExplorer} role="menuitem">
        Open in File Explorer
      </button>
      <div class="tab-context-menu-separator"></div>
    {/if}
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

<ConfirmDialog
  bind:isOpen={isConfirmOpen}
  title="Unsaved Changes"
  message={confirmMessage}
  confirmText="Close Anyway"
  cancelText="Cancel"
  isDanger={true}
  onConfirm={onConfirmClose}
  onCancel={onCancelClose}
/>

<style>
  .tab-button {
    user-select: none;
    cursor: pointer;
    position: relative;
  }
  

  /* Drag indicator */
  .tab-button.drag-over::before,
  .tab-button.drag-over::after {
    content: '';
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 2px;
    background: color-mix(in srgb, var(--accent) 80%, transparent);
    border-radius: 2px;
    box-shadow: 0 0 4px var(--accent-glow);
  }

  .tab-button.drag-over-before::before {
    left: -1px;
  }

  .tab-button.drag-over-after::after {
    right: -1px;
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
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .tab-context-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    border-radius: 6px;
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .tab-context-menu-item:hover {
    background: var(--bg-hover);
  }

  .tab-context-menu-separator {
    height: 1px;
    background: var(--border);
    margin: 4px 8px;
  }

  .pin-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: all 0.15s ease;
    color: var(--text-secondary);
  }

  .pin-button:hover {
    color: var(--accent);
    transform: scale(1.1);
  }

  .pin-button:active {
    transform: scale(0.9);
  }
</style>

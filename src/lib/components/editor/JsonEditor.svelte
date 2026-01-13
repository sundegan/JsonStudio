<script lang="ts">
  import { onMount } from 'svelte';
  import { getJsonStats, type JsonStats } from '$lib/services/json';
  import { readFile, getFileName } from '$lib/services/file';
  import { tabsStore, activeTab } from '$lib/stores/tabs';
  import MonacoEditor from './MonacoEditor.svelte';
  import MonacoDiffEditor from './MonacoDiffEditor.svelte';
  import TabBar from './TabBar.svelte';
  import DiffTabBar from './DiffTabBar.svelte';
  import JsonEditorToolbar from './JsonEditorToolbar.svelte';
  import JsonEditorStatusBar from './JsonEditorStatusBar.svelte';
  import JsonQueryPanel from './JsonQueryPanel.svelte';
  import JsonTreeView from './JsonTreeView.svelte';
  import JsonEditorToast from './JsonEditorToast.svelte';
  import { type EditorTheme } from '$lib/config/monacoThemes';
  import { settingsStore } from '$lib/stores/settings';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';

  let content = $state('');
  let stats = $state<JsonStats>({
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    error_info: null,
  });
  let toastMsg = $state('');
  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  let pasteFormatTimer: ReturnType<typeof setTimeout> | null = null;
  let monacoEditor: MonacoEditor;
  let toolbarRef: JsonEditorToolbar | null = null;
  let settingsPanel: SettingsPanel | null = null;
  let isDiffMode = $state(false);
  let diffOriginal = $state('');
  let diffModified = $state('');
  let diffLineCount = $state(0);
  let diffLeftStats = $state<JsonStats>({
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    error_info: null,
  });
  let diffRightStats = $state<JsonStats>({
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    error_info: null,
  });
  let diffLeftTimer: ReturnType<typeof setTimeout> | null = null;
  let diffRightTimer: ReturnType<typeof setTimeout> | null = null;
  let isJsonQueryOpen = $state(false);
  const TREE_MIN_WIDTH = 260;
  const TREE_MAX_WIDTH = 640;
  let treeViewWidth = $state(320);
  let isResizingTreeView = $state(false);
  
  let tabsState = $state<import('$lib/stores/tabs').TabsState>({
    tabs: [],
    activeTabId: null
  });
  
  let diffModeState = $state<import('$lib/stores/tabs').DiffModeState | null>(null);
  let diffModeUnsubscribe: (() => void) | null = null;
  
  let settings = $state<import('$lib/stores/settings').AppSettings>({
    isDarkMode: false,
    darkTheme: 'one-dark',
    lightTheme: 'vs',
    fontSize: 13,
    tabSize: 2,
  });
  
  onMount(() => {
    settingsStore.init();
    
    // Subscribe to diff mode state changes
    diffModeUnsubscribe = tabsStore.subscribeDiffMode((newState) => {
      diffModeState = newState;
    });
    
    // Listen to clipboard formatting events
    let unlistenFormatted: (() => void) | null = null;
    let unlistenRaw: (() => void) | null = null;
    let unlistenFileDrop: (() => void) | null = null;
    
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      
      // Listen for successfully formatted JSON
      unlistenFormatted = await listen<string>('clipboard-formatted', (event) => {
        const currentTab = $activeTab;
        if (!currentTab) return;
        
        content = event.payload;
        monacoEditor?.setValue(event.payload);
        tabsStore.updateTabContent(currentTab.id, event.payload);
        updateStats();
        showToast('Clipboard content formatted');
      });
      
      // Listen for raw paste (when JSON is invalid)
      unlistenRaw = await listen<string>('clipboard-pasted-raw', (event) => {
        const currentTab = $activeTab;
        if (!currentTab) return;
        
        content = event.payload;
        monacoEditor?.setValue(event.payload);
        tabsStore.updateTabContent(currentTab.id, event.payload);
        updateStats();
        showToast('Clipboard content pasted (invalid JSON)');
      });

      // Listen for file drop events
      // Tauri 2.0 uses 'tauri://drag-drop' event
      unlistenFileDrop = await listen<{ paths: string[], position: { x: number, y: number } }>('tauri://drag-drop', async (event) => {
        const paths = event.payload?.paths;
        if (paths && paths.length > 0) {
          const filePath = paths[0];
          try {
            const fileContent = await readFile(filePath);
            const name = await getFileName(filePath);
            
            const currentTab = $activeTab;
            
            // Always create a new tab for dropped files
            tabsStore.addTab(fileContent, filePath, name);
            // Content and editor will be updated by $effect when tab switches
            
            showToast(`Opened: ${name || 'file'}`);
          } catch (e) {
            showToast('Failed to open file');
            console.error('Drop file error:', e);
          }
        }
      });
    })();
    
    // Keyboard shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      
      // Cmd/Ctrl + T: New tab
      if (cmdOrCtrl && e.key === 't') {
        e.preventDefault();
        tabsStore.addTab();
        return;
      }
      
      // Cmd/Ctrl + W: Close current tab
      if (cmdOrCtrl && e.key === 'w') {
        e.preventDefault();
        const currentTab = $activeTab;
        if (currentTab) {
          if (currentTab.isModified) {
            const confirmClose = confirm(`"${currentTab.fileName || 'Untitled'}" has unsaved changes. Close anyway?`);
            if (!confirmClose) return;
          }
          tabsStore.removeTab(currentTab.id);
        }
        return;
      }
      
      // Cmd/Ctrl + Tab: Next tab
      if (cmdOrCtrl && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const currentIndex = tabsState.tabs.findIndex(t => t.id === tabsState.activeTabId);
        const nextIndex = (currentIndex + 1) % tabsState.tabs.length;
        tabsStore.setActiveTab(tabsState.tabs[nextIndex].id);
        return;
      }
      
      // Cmd/Ctrl + Shift + Tab: Previous tab
      if (cmdOrCtrl && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        const currentIndex = tabsState.tabs.findIndex(t => t.id === tabsState.activeTabId);
        const prevIndex = (currentIndex - 1 + tabsState.tabs.length) % tabsState.tabs.length;
        tabsStore.setActiveTab(tabsState.tabs[prevIndex].id);
        return;
      }
      
      // Cmd/Ctrl + 1-9: Switch to specific tab
      if (cmdOrCtrl && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const tabIndex = parseInt(e.key) - 1;
        if (tabIndex < tabsState.tabs.length) {
          tabsStore.setActiveTab(tabsState.tabs[tabIndex].id);
        }
        return;
      }
      
      // Cmd/Ctrl + N: New file
      if (cmdOrCtrl && e.key === 'n') {
        e.preventDefault();
        toolbarRef?.newFile();
      }
      
      // Cmd/Ctrl + O: Open file
      if (cmdOrCtrl && e.key === 'o') {
        e.preventDefault();
        toolbarRef?.openFile();
      }
      
      // Cmd/Ctrl + S: Save file
      if (cmdOrCtrl && e.key === 's') {
        e.preventDefault();
        toolbarRef?.saveFile();
      }
      
      // Cmd/Ctrl + Shift + S: Save as
      if (cmdOrCtrl && e.shiftKey && e.key === 's') {
        e.preventDefault();
        toolbarRef?.saveAsFile();
      }

      // Cmd/Ctrl + Shift + I: Open DevTools (only in development)
      if (cmdOrCtrl && e.shiftKey && e.key === 'i') {
        e.preventDefault();
        // Only enable in development mode
        if (import.meta.env.DEV) {
          openDevTools();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      if (unlistenFormatted) unlistenFormatted();
      if (unlistenRaw) unlistenRaw();
      if (unlistenFileDrop) unlistenFileDrop();
      if (diffModeUnsubscribe) diffModeUnsubscribe();
      window.removeEventListener('keydown', handleKeydown);
    };
  });
  
  $effect(() => {
    const unsubscribe = settingsStore.subscribe(newSettings => {
      settings = newSettings;
    });
    return () => unsubscribe();
  });
  
  // Track previous active tab ID to detect tab switches
  let prevActiveTabId = $state<string | null>(null);
  let isFirstSync = $state(true);
  let suppressNextEditorChange = $state(false);

  function getActiveTabFromState(state: import('$lib/stores/tabs').TabsState) {
    return state.tabs.find(tab => tab.id === state.activeTabId) || state.tabs[0] || null;
  }

  function syncActiveTab(state: import('$lib/stores/tabs').TabsState) {
    const currentTab = getActiveTabFromState(state);
    if (!currentTab) return;

    content = currentTab.content;
    stats = currentTab.stats;

    const editorValue = monacoEditor?.getValue();
    if (editorValue !== undefined && editorValue !== currentTab.content) {
      suppressNextEditorChange = true;
      monacoEditor?.setValue(currentTab.content);
      queueMicrotask(() => {
        suppressNextEditorChange = false;
      });
    }
  }
  
  $effect(() => {
    const unsubscribe = tabsStore.subscribe(newTabsState => {
      const oldActiveTabId = prevActiveTabId;
      const newActiveTabId = newTabsState.activeTabId;
      
      tabsState = newTabsState;
      
      // For the first sync, initialize prevActiveTabId and sync content
      if (isFirstSync) {
        isFirstSync = false;
        prevActiveTabId = newActiveTabId;
        syncActiveTab(newTabsState);
        return;
      }
      
      // Only sync content when switching tabs, not when updating current tab's content
      if (oldActiveTabId !== newActiveTabId) {
        prevActiveTabId = newActiveTabId;
        syncActiveTab(newTabsState);
      }
    });
    return () => unsubscribe();
  });
  
  let isDarkMode = $derived(settings.isDarkMode);
  let fontSize = $derived(settings.fontSize);
  let tabSize = $derived(settings.tabSize);
  let showTreeView = $derived(settings.showTreeView);
  let monacoTheme = $derived<EditorTheme>(isDarkMode ? settings.darkTheme : settings.lightTheme);
  $effect(() => {
    if (!showTreeView) {
      isResizingTreeView = false;
    }
  });
  
  // Track previous tabSize to detect changes
  let prevTabSize = $state(settings.tabSize);
  
  // Watch tabSize changes and reformat JSON content
  $effect(() => {
    const currentTabSize = tabSize;
    // Only reformat if tabSize actually changed and there's valid JSON content
    if (currentTabSize !== prevTabSize && content.trim()) {
      prevTabSize = currentTabSize;
      // Try to reformat the JSON with new indent size
      try {
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, currentTabSize);
        content = formatted;
        monacoEditor?.setValue(formatted);
      } catch (e) {
        // Content is not valid JSON, skip reformatting
      }
    }
  });

  $effect(() => {
    if (!isDiffMode || !diffModeState) return;
    if (diffLeftTimer) clearTimeout(diffLeftTimer);
    diffLeftTimer = setTimeout(() => {
      updateDiffStatsForSide('left');
      // Save left side content to left active tab
      if (diffModeState?.leftActiveTabId) {
        tabsStore.updateDiffLeftTabContent(diffModeState.leftActiveTabId, diffOriginal);
      }
    }, 200);
  });

  $effect(() => {
    if (!isDiffMode || !diffModeState) return;
    if (diffRightTimer) clearTimeout(diffRightTimer);
    diffRightTimer = setTimeout(() => {
      updateDiffStatsForSide('right');
      // Save right side content to right active tab
      if (diffModeState?.rightActiveTabId) {
        tabsStore.updateDiffRightTabContent(diffModeState.rightActiveTabId, diffModified);
      }
    }, 200);
  });

  function toggleTheme() {
    settingsStore.updateSetting('isDarkMode', !isDarkMode);
  }

  function toggleJsonQueryPanel() {
    isJsonQueryOpen = !isJsonQueryOpen;
  }

  function toggleDiffMode() {
    if (isDiffMode) {
      // Exit diff mode: merge tabs
      tabsStore.exitDiffMode();
      // diffModeState will be set to null via subscription
      isDiffMode = false;
      
      // Sync content back to normal mode
      const currentTab = $activeTab;
      if (currentTab) {
        content = currentTab.content;
        stats = currentTab.stats;
        monacoEditor?.setValue(currentTab.content);
      }
      return;
    }

    if (isJsonQueryOpen) {
      isJsonQueryOpen = false;
    }

    // Enter diff mode: clone tabs to both sides
    tabsStore.enterDiffMode();
    isDiffMode = true;
    diffLineCount = 0;
    
    // Get the latest diff mode state (subscription is synchronous, so state is already updated)
    const latestDiffState = tabsStore.getDiffModeState();
    if (latestDiffState) {
      const leftTab = latestDiffState.leftTabs.find(t => t.id === latestDiffState.leftActiveTabId);
      const rightTab = latestDiffState.rightTabs.find(t => t.id === latestDiffState.rightActiveTabId);
      
      diffOriginal = leftTab?.content || '';
      diffModified = rightTab?.content || '';
      diffLeftStats = leftTab?.stats || {
        valid: false,
        key_count: 0,
        depth: 0,
        byte_size: 0,
        error_info: null,
      };
      diffRightStats = rightTab?.stats || {
        valid: false,
        key_count: 0,
        depth: 0,
        byte_size: 0,
        error_info: null,
      };
    }
  }

  function openSettings() {
    if (settingsPanel) {
      settingsPanel.open();
    }
  }

  async function openDevTools() {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_devtools');
    } catch (error) {
      console.error('Failed to open devtools:', error);
    }
  }

  function showToast(msg: string) {
    toastMsg = msg;
  }

  function clampTreeWidth(width: number) {
    return Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, width));
  }

  function startTreeResize(event: PointerEvent) {
    if (!showTreeView) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treeViewWidth;
    isResizingTreeView = true;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isResizingTreeView) return;
      const delta = startX - moveEvent.clientX;
      treeViewWidth = clampTreeWidth(startWidth + delta);
    };

    const handlePointerUp = () => {
      isResizingTreeView = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function updateDiffStats(changes: Array<{
    originalStartLineNumber: number;
    originalEndLineNumber: number;
    modifiedStartLineNumber: number;
    modifiedEndLineNumber: number;
  }>) {
    let diffLines = 0;

    for (const change of changes) {
      const originalCount = change.originalStartLineNumber > 0
        ? Math.max(0, change.originalEndLineNumber - change.originalStartLineNumber + 1)
        : 0;
      const modifiedCount = change.modifiedStartLineNumber > 0
        ? Math.max(0, change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1)
        : 0;

      diffLines += Math.max(originalCount, modifiedCount);
    }

    diffLineCount = diffLines;
  }

  async function updateDiffStatsForSide(side: 'left' | 'right') {
    if (!diffModeState) return;
    
    const value = side === 'left' ? diffOriginal : diffModified;
    const tabId = side === 'left' ? diffModeState!.leftActiveTabId : diffModeState!.rightActiveTabId;
    if (!tabId) return;
    
    if (!value.trim()) {
      const emptyStats = {
        valid: false,
        key_count: 0,
        depth: 0,
        byte_size: 0,
        error_info: null,
      };
      if (side === 'left') {
        diffLeftStats = emptyStats;
        tabsStore.updateDiffLeftTabStats(tabId, emptyStats);
      } else {
        diffRightStats = emptyStats;
        tabsStore.updateDiffRightTabStats(tabId, emptyStats);
      }
      return;
    }

    try {
      const result = await getJsonStats(value);
      if (side === 'left') {
        diffLeftStats = result;
        tabsStore.updateDiffLeftTabStats(tabId, result);
      } else {
        diffRightStats = result;
        tabsStore.updateDiffRightTabStats(tabId, result);
      }
    } catch (e) {}
  }
  
  function handleDiffLeftTabChange(event: CustomEvent<{ tabId: string }>) {
    // Use getDiffModeState() to get the latest state immediately
    const latestState = tabsStore.getDiffModeState();
    if (!latestState) return;
    const tab = latestState.leftTabs.find(t => t.id === event.detail.tabId);
    if (tab) {
      diffOriginal = tab.content;
      diffLeftStats = tab.stats;
    }
  }
  
  function handleDiffRightTabChange(event: CustomEvent<{ tabId: string }>) {
    // Use getDiffModeState() to get the latest state immediately
    const latestState = tabsStore.getDiffModeState();
    if (!latestState) return;
    const tab = latestState.rightTabs.find(t => t.id === event.detail.tabId);
    if (tab) {
      diffModified = tab.content;
      diffRightStats = tab.stats;
    }
  }


  function handleEditorChange(newValue: string) {
    const currentTab = $activeTab;
    if (!currentTab) return;
    if (suppressNextEditorChange) {
      suppressNextEditorChange = false;
      return;
    }
    
    content = newValue;
    tabsStore.updateTabContent(currentTab.id, newValue);
    
    // Mark as modified if we have a current file
    if (currentTab.filePath && !currentTab.isModified) {
      tabsStore.updateTabModified(currentTab.id, true);
    }

    if (statsTimer) clearTimeout(statsTimer);
    if (!content.trim()) { 
      stats = {
        valid: false,
        key_count: 0,
        depth: 0,
        byte_size: 0,
        error_info: null,
      };
      tabsStore.updateTabStats(currentTab.id, stats);
      return;
    }
    statsTimer = setTimeout(updateStats, 300);
  }

  function handleEditorPaste() {
    if (pasteFormatTimer) clearTimeout(pasteFormatTimer);
    pasteFormatTimer = setTimeout(async () => {
      if (!content.trim()) {
        return;
      }
      await toolbarRef?.formatContent();
    }, 100);
  }

  function resetStats() {
    stats = {
      valid: false,
      key_count: 0,
      depth: 0,
      byte_size: 0,
      error_info: null,
    };
  }

  async function updateStats() {
    if (!content.trim()) return;
    const currentTab = $activeTab;
    if (!currentTab) return;
    
    try {
      stats = await getJsonStats(content);
      tabsStore.updateTabStats(currentTab.id, stats);
    } catch (e) {}
  }

</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Toolbar -->
  <JsonEditorToolbar
    bind:this={toolbarRef}
    isDiffMode={isDiffMode}
    content={content}
    activeTab={$activeTab}
    isDarkMode={isDarkMode}
    isJsonQueryOpen={isJsonQueryOpen}
    editor={monacoEditor}
    tabSize={tabSize}
    onToggleDiff={toggleDiffMode}
    onToggleJsonQuery={toggleJsonQueryPanel}
    onToggleTheme={toggleTheme}
    onOpenSettings={openSettings}
    onContentChange={(value) => { content = value; }}
    onStatsUpdate={updateStats}
    onStatsReset={resetStats}
    onToast={showToast}
  />
  
  <!-- Main content area: Tab Bar + Editor + Tree View -->
  <div class="flex flex-1 min-h-0" class:resizing-tree-view={isResizingTreeView}>
    <!-- Left section: Tab Bar + Editor -->
    <div class="flex flex-col flex-1 min-w-0">
      <!-- Tab Bar - show different tab bars based on mode -->
      {#if isDiffMode && diffModeState}
        <!-- Diff mode: show DiffTabBar with independent left/right tabs -->
        <DiffTabBar 
          leftTabs={diffModeState.leftTabs}
          rightTabs={diffModeState.rightTabs}
          leftActiveTabId={diffModeState.leftActiveTabId}
          rightActiveTabId={diffModeState.rightActiveTabId}
          isDarkMode={isDarkMode}
          on:leftTabChange={handleDiffLeftTabChange}
          on:rightTabChange={handleDiffRightTabChange}
        />
      {:else if tabsState.tabs.length > 1}
        <!-- Normal mode: only show when multiple tabs exist -->
        <TabBar 
          tabs={tabsState.tabs} 
          activeTabId={tabsState.activeTabId}
          isDarkMode={isDarkMode}
        />
      {/if}

      <!-- Editor main area -->
      <div class="flex-1 relative min-h-0">
        {#if isDiffMode}
          <div class="flex flex-col h-full">
            <div class="flex-1 min-h-0">
              <MonacoDiffEditor
                originalValue={diffOriginal}
                modifiedValue={diffModified}
                theme={monacoTheme}
                language="json"
                fontSize={fontSize}
                tabSize={tabSize}
                onOriginalChange={(value) => { diffOriginal = value; }}
                onModifiedChange={(value) => { diffModified = value; }}
                onDiffUpdate={updateDiffStats}
              />
            </div>
          </div>
        {:else}
          <div class="json-editor-workspace">
            <div class="json-editor-main">
              <MonacoEditor
                bind:this={monacoEditor}
                value={content}
                theme={monacoTheme}
                language="json"
                fontSize={fontSize}
                tabSize={tabSize}
                onChange={handleEditorChange}
                onPaste={handleEditorPaste}
              />

              {#if isJsonQueryOpen}
                <JsonQueryPanel
                  content={content}
                  editor={monacoEditor}
                  onClose={toggleJsonQueryPanel}
                  on:toast={(event) => showToast(event.detail.message)}
                />
              {/if}
            </div>
          </div>
        {/if}

        {#if toastMsg}
          <JsonEditorToast message={toastMsg} on:close={() => { toastMsg = ''; }} />
        {/if}
      </div>
    </div>

    <!-- Right section: Tree View (spans full height below toolbar) -->
    {#if showTreeView && !isDiffMode}
      <div
        class="json-tree-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize tree view"
        tabindex="0"
        onpointerdown={startTreeResize}
      ></div>
      <div class="json-tree-container" style={`width: ${treeViewWidth}px;`}>
        <JsonTreeView
          content={content}
          editor={monacoEditor}
          on:toast={(event) => showToast(event.detail.message)}
        />
      </div>
    {/if}
  </div>

  <JsonEditorStatusBar
    isDiffMode={isDiffMode}
    diffLineCount={diffLineCount}
    diffLeftStats={diffLeftStats}
    diffRightStats={diffRightStats}
    diffOriginal={diffOriginal}
    diffModified={diffModified}
    activeTab={$activeTab}
    stats={stats}
    content={content}
  />

  <!-- Settings panel -->
  <SettingsPanel bind:this={settingsPanel} />
</div>

<style>
  .json-editor-workspace {
    display: flex;
    height: 100%;
    position: relative;
  }
  
  .json-editor-main {
    flex: 1;
    min-width: 0;
    position: relative;
  }
  
  .json-tree-resizer {
    width: 4px;
    background: var(--bg-secondary);
    cursor: col-resize;
    flex-shrink: 0;
    transition: background 0.15s;
    position: relative;
  }
  
  .json-tree-resizer:hover {
    background: var(--accent, #3b82f6);
  }
  
  .json-tree-resizer::before {
    content: '';
    position: absolute;
    left: -2px;
    right: -2px;
    top: 0;
    bottom: 0;
  }
  
  .json-tree-container {
    flex-shrink: 0;
    overflow: hidden;
    border-left: 1px solid var(--border);
  }
  
  .resizing-tree-view {
    user-select: none;
    cursor: col-resize;
  }
  
  .resizing-tree-view * {
    cursor: col-resize !important;
  }

  :global {
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { getJsonStats, type JsonStats } from '$lib/services/json';
  import { readFile, getFileName } from '$lib/services/file';
  import { tabsStore, activeTab } from '$lib/stores/tabs';
  import MonacoEditor from './MonacoEditor.svelte';
  import MonacoDiffEditor from './MonacoDiffEditor.svelte';
  import ConvertView from './ConvertView.svelte';
  import TabBar from './TabBar.svelte';
  import JsonEditorToolbar from './JsonEditorToolbar.svelte';
  import JsonEditorStatusBar from './JsonEditorStatusBar.svelte';
  import JsonTreeView from './JsonTreeView.svelte';
  import JsonEditorToast from './JsonEditorToast.svelte';
  import { type EditorTheme } from '$lib/config/monacoThemes';
  import { settingsStore } from '$lib/stores/settings';
  import { shortcutsStore } from '$lib/stores/shortcuts';
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
  let isAlwaysOnTop = $state(false);
  let isDiffMode = $state(false);
  let isConvertMode = $state(false);
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
  const TREE_MIN_WIDTH = 260;
  const TREE_MAX_WIDTH = 640;
  let treeViewWidth = $state(320);
  let isResizingTreeView = $state(false);
  
  let tabsState = $state<import('$lib/stores/tabs').TabsState>({
    tabs: [],
    activeTabId: null
  });
  
  
  let settings = $state<import('$lib/stores/settings').AppSettings>({
    isDarkMode: false,
    darkTheme: 'one-dark',
    lightTheme: 'vs',
    language: 'zh',
    fontSize: 13,
    lineHeight: 20,
    tabSize: 2,
    showTreeView: true,
  });
  
  onMount(() => {
    settingsStore.init();
    
    // Listen to clipboard formatting events
    let unlistenFormatted: (() => void) | null = null;
    let unlistenRaw: (() => void) | null = null;
    let unlistenFileDrop: (() => void) | null = null;
    let unlistenOpenFile: (() => void) | null = null;
    
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
      unlistenFileDrop = await listen<{ paths: string[], position: { x: number, y: number } }>('tauri://drag-drop', async (event) => {
        const paths = event.payload?.paths;
        if (paths && paths.length > 0) {
          const filePath = paths[0];
          try {
            const fileContent = await readFile(filePath);
            const name = await getFileName(filePath);
            
            tabsStore.addTab(fileContent, filePath, name);
            showToast(`Opened: ${name || 'file'}`);
          } catch (e) {
            showToast('Failed to open file');
            console.error('Drop file error:', e);
          }
        }
      });

      // Listen for file open events (macOS "Open With" / double-click)
      unlistenOpenFile = await listen<string[]>('open-file', async (event) => {
        const paths = event.payload;
        if (!paths || paths.length === 0) return;
        for (const filePath of paths) {
          try {
            const fileContent = await readFile(filePath);
            const name = await getFileName(filePath);
            tabsStore.addTab(fileContent, filePath, name);
            showToast(`Opened: ${name || 'file'}`);
          } catch (e) {
            showToast('Failed to open file');
            console.error('Open file error:', e);
          }
        }
      });
    })();
    
    shortcutsStore.init();

    const handleKeydown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Fixed shortcuts (not customizable)
      if (cmdOrCtrl && e.key === 't') {
        e.preventDefault();
        tabsStore.addTab();
        return;
      }
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
      if (cmdOrCtrl && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const currentIndex = tabsState.tabs.findIndex(t => t.id === tabsState.activeTabId);
        const nextIndex = (currentIndex + 1) % tabsState.tabs.length;
        tabsStore.setActiveTab(tabsState.tabs[nextIndex].id);
        return;
      }
      if (cmdOrCtrl && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        const currentIndex = tabsState.tabs.findIndex(t => t.id === tabsState.activeTabId);
        const prevIndex = (currentIndex - 1 + tabsState.tabs.length) % tabsState.tabs.length;
        tabsStore.setActiveTab(tabsState.tabs[prevIndex].id);
        return;
      }
      if (cmdOrCtrl && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const tabIndex = parseInt(e.key) - 1;
        if (tabIndex < tabsState.tabs.length) {
          tabsStore.setActiveTab(tabsState.tabs[tabIndex].id);
        }
        return;
      }
      if (cmdOrCtrl && e.shiftKey && e.key === 'i') {
        e.preventDefault();
        if (import.meta.env.DEV) {
          openDevTools();
        }
        return;
      }

      // Customizable shortcuts via shortcuts store
      const matched = shortcutsStore.matchShortcut(e);
      if (matched) {
        e.preventDefault();
        switch (matched) {
          case 'new_file': toolbarRef?.newFile(); break;
          case 'open_file': toolbarRef?.openFile(); break;
          case 'save_file': toolbarRef?.saveFile(); break;
          case 'format': toolbarRef?.formatContent(); break;
          case 'minify': toolbarRef?.minifyContent(); break;
          case 'escape': toolbarRef?.escapeContent(); break;
          case 'unescape': toolbarRef?.unescapeContent(); break;
          case 'minify_escape': toolbarRef?.minifyEscapeContent(); break;
          case 'fold_all': toolbarRef?.foldAllContent(); break;
          case 'unfold_all': toolbarRef?.unfoldAllContent(); break;
          case 'diff': toggleDiffMode(); break;
        }
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      if (unlistenFormatted) unlistenFormatted();
      if (unlistenRaw) unlistenRaw();
      if (unlistenFileDrop) unlistenFileDrop();
      if (unlistenOpenFile) unlistenOpenFile();
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
  let lineHeight = $derived(settings.lineHeight);
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
    if (!isDiffMode) return;
    if (diffLeftTimer) clearTimeout(diffLeftTimer);
    diffLeftTimer = setTimeout(() => {
      updateDiffStatsForSide('left');
    }, 200);
  });

  $effect(() => {
    if (!isDiffMode) return;
    if (diffRightTimer) clearTimeout(diffRightTimer);
    diffRightTimer = setTimeout(() => {
      updateDiffStatsForSide('right');
    }, 200);
  });

  async function toggleAlwaysOnTop() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const newValue = !isAlwaysOnTop;
      await getCurrentWindow().setAlwaysOnTop(newValue);
      isAlwaysOnTop = newValue;
    } catch (error) {
      console.error('Failed to toggle always on top:', error);
    }
  }

  function toggleTheme() {
    settingsStore.updateSetting('isDarkMode', !isDarkMode);
  }

  function toggleDiffMode() {
    if (isDiffMode) {
      isDiffMode = false;
      
      const currentTab = $activeTab;
      if (currentTab) {
        content = currentTab.content;
        stats = currentTab.stats;
        monacoEditor?.setValue(currentTab.content);
      }
      return;
    }

    if (isConvertMode) {
      isConvertMode = false;
    }

    const emptyStats: JsonStats = {
      valid: false,
      key_count: 0,
      depth: 0,
      byte_size: 0,
      error_info: null,
    };

    isDiffMode = true;
    diffLineCount = 0;
    diffOriginal = content;
    diffModified = '';
    diffLeftStats = { ...stats };
    diffRightStats = emptyStats;
  }

  function toggleConvertMode() {
    if (isConvertMode) {
      isConvertMode = false;
      const currentTab = $activeTab;
      if (currentTab) {
        content = currentTab.content;
        stats = currentTab.stats;
        monacoEditor?.setValue(currentTab.content);
      }
      return;
    }

    if (isDiffMode) {
      toggleDiffMode();
    }
    isConvertMode = true;
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
    const value = side === 'left' ? diffOriginal : diffModified;
    
    if (!value.trim()) {
      const emptyStats: JsonStats = {
        valid: false,
        key_count: 0,
        depth: 0,
        byte_size: 0,
        error_info: null,
      };
      if (side === 'left') {
        diffLeftStats = emptyStats;
      } else {
        diffRightStats = emptyStats;
      }
      return;
    }

    try {
      const result = await getJsonStats(value);
      if (side === 'left') {
        diffLeftStats = result;
      } else {
        diffRightStats = result;
      }
    } catch (e) {}
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

  function handleToolbarContentChange(newValue: string) {
    const currentTab = $activeTab;
    content = newValue;
    if (!currentTab) return;
    tabsStore.updateTabContent(currentTab.id, newValue);
    if (currentTab.filePath && !currentTab.isModified) {
      tabsStore.updateTabModified(currentTab.id, true);
    }
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
  {#if !isConvertMode}
    <JsonEditorToolbar
      bind:this={toolbarRef}
      isDiffMode={isDiffMode}
      isConvertMode={isConvertMode}
      content={content}
      activeTab={$activeTab}
      isDarkMode={isDarkMode}
      isAlwaysOnTop={isAlwaysOnTop}
      editor={monacoEditor}
      tabSize={tabSize}
      onToggleDiff={toggleDiffMode}
      onToggleConvert={toggleConvertMode}
      onToggleTheme={toggleTheme}
      onToggleAlwaysOnTop={toggleAlwaysOnTop}
      onOpenSettings={openSettings}
      onContentChange={handleToolbarContentChange}
      onStatsUpdate={updateStats}
      onToast={showToast}
    />
  {/if}
  
  <!-- Main content area: Tab Bar + Editor + Tree View -->
  <div class="flex flex-1 min-h-0" class:resizing-tree-view={isResizingTreeView}>
    <!-- Left section: Tab Bar + Editor -->
    <div class="flex flex-col flex-1 min-w-0">
      <!-- Tab Bar - show different tab bars based on mode -->
      {#if !isDiffMode && !isConvertMode && tabsState.tabs.length > 1}
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
                lineHeight={lineHeight}
                tabSize={tabSize}
                onOriginalChange={(value) => { diffOriginal = value; }}
                onModifiedChange={(value) => { diffModified = value; }}
                onDiffUpdate={updateDiffStats}
              />
            </div>
          </div>
        {:else if isConvertMode}
          <ConvertView
            inputValue={content}
            theme={monacoTheme}
            fontSize={fontSize}
            lineHeight={lineHeight}
            tabSize={tabSize}
            onInputChange={handleToolbarContentChange}
            onToast={showToast}
            onExit={toggleConvertMode}
          />
        {:else}
          <div class="json-editor-workspace">
            <div class="json-editor-main">
              <MonacoEditor
                bind:this={monacoEditor}
                value={content}
                theme={monacoTheme}
                language="json"
                fontSize={fontSize}
                lineHeight={lineHeight}
                tabSize={tabSize}
                onChange={handleEditorChange}
                onPaste={handleEditorPaste}
              />
            </div>
          </div>
        {/if}

        {#if toastMsg}
          <JsonEditorToast message={toastMsg} on:close={() => { toastMsg = ''; }} />
        {/if}
      </div>
    </div>

    <!-- Right section: Tree View (spans full height below toolbar) -->
    {#if showTreeView && !isDiffMode && !isConvertMode}
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

  {#if !isConvertMode}
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
  {/if}

  <!-- Settings panel -->
  <SettingsPanel bind:this={settingsPanel} />
</div>

<style>
  :global {
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  }
</style>

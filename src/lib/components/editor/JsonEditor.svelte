<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { formatJson, type JsonStats } from '$lib/services/json';
  import { readFile, getFileName } from '$lib/services/file';
  import { tabsStore, activeTab } from '$lib/stores/tabs';
  import { fileWatcherService } from '$lib/services/fileWatcher';
  import MonacoEditor from './MonacoEditor.svelte';
  import MonacoDiffEditor from './MonacoDiffEditor.svelte';
  import ConvertView from './ConvertView.svelte';
  import CodeGenView from './CodeGenView.svelte';
  import SchemaView from './SchemaView.svelte';
  import TabBar from './TabBar.svelte';
  import JsonEditorToolbar from './JsonEditorToolbar.svelte';
  import JsonEditorStatusBar from './JsonEditorStatusBar.svelte';
  import RightViewPanel from './RightViewPanel.svelte';
  import FolderSidebar from './FolderSidebar.svelte';
  import JsonEditorToast from './JsonEditorToast.svelte';
  import LogJsonFragmentsPanel from './LogJsonFragmentsPanel.svelte';
  import ConfirmDialog from '../dialogs/ConfirmDialog.svelte';
  import { type EditorTheme } from '$lib/config/monacoThemes';
  import { settingsStore } from '$lib/stores/settings';
  import { shortcutsStore } from '$lib/stores/shortcuts';
  import { getDocumentContent, hasDocumentContent, loadDocumentContent } from '$lib/stores/documentStore';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import AboutDialog from '$lib/components/AboutDialog.svelte';
  import { MAX_LOG_JSON_INPUT_LENGTH } from '$lib/services/logJsonFragments.js';
  import {
    cancelLogJsonDetection,
    extractLogJsonFragmentsAsync,
  } from '$lib/services/logJsonWorker.js';
  import { cancelPasteFormat, formatPastedJsonAsync } from '$lib/services/pasteFormatWorker.js';
  import { normalizeOpenedJson } from '$lib/services/openJsonNormalize.js';
  import {
    detectJsonDialectAsync,
    getJsonDocumentStatsAsync,
  } from '$lib/services/jsonTreeModelCache.js';
  import { clampPanelWidth, getDefaultPanelWidth, clampFolderWidth } from '$lib/services/panelResize.js';
  import { t } from '$lib/i18n';

  type LogJsonFragment = {
    label: string;
    line: number;
    column: number;
    raw: string;
    formatted: string;
    kind: 'JSON' | 'JSON5' | 'Escaped JSON' | 'Repaired JSON';
  };
  type TabWithContent = import('$lib/stores/tabs').Tab & { content: string };

  let content = $state('');
  let lineCount = $state(0);
  let stats = $state<JsonStats>({
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    format_type: '',
    error_info: null,
  });
  let toastMsg = $state('');
  let toastType = $state<'success' | 'error' | 'info'>('success');
  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let logJsonTimer: ReturnType<typeof setTimeout> | null = null;
  let monacoEditor = $state<MonacoEditor | null>(null);
  let toolbarRef = $state<JsonEditorToolbar | null>(null);
  let settingsPanel = $state<SettingsPanel | null>(null);
  let isAlwaysOnTop = $state(false);
  let isDiffMode = $state(false);
  let isConvertMode = $state(false);
  let isCodegenMode = $state(false);
  let isSchemaMode = $state(false);
  let logJsonFragments = $state<LogJsonFragment[]>([]);
  let selectedLogJsonFragmentIndex = $state(0);
  let isLogJsonPanelOpen = $state(false);
  let logJsonSource = $state('');
  // When entering Convert/CodeGen/Schema with JSON5 content, the original JSON5
  // is saved here so it can be restored on exit. For standard JSON this stays empty,
  // meaning sub-page edits persist back to the main editor.
  let originalJson5Content = $state('');
  let diffOriginal = $state('');
  let diffModified = $state('');
  let diffLineCount = $state(0);
  let diffLeftStats = $state<JsonStats>({
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    format_type: '',
    error_info: null,
  });
  let diffRightStats = $state<JsonStats>({
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    format_type: '',
    error_info: null,
  });
  let diffLeftTimer: ReturnType<typeof setTimeout> | null = null;
  let diffRightTimer: ReturnType<typeof setTimeout> | null = null;
  let treeViewWidth = $state(380);
  let isResizingTreeView = $state(false);
  let folderViewWidth = $state(220);
  let isResizingFolderView = $state(false);
  let mainWorkspaceEl: HTMLDivElement | null = null;
  let rightPanelContent = $state('');
  let rightPanelActiveTabId = $state('');
  let rightPanelActiveTabPath = $state<string | null>(null);
  let rightPanelActiveTabName = $state<string | null>(null);
  let rightPanelSyncFrame: number | null = null;
  let rightPanelSyncVersion = 0;
  let postSwitchWorkFrame: number | null = null;
  let postSwitchWorkVersion = 0;
  let lineCountFrame: number | null = null;
  let lineCountVersion = 0;
  let editorModelKey = $state('');
  let isEditorModelPending = $state(false);
  let editorModelSwitchTimer: ReturnType<typeof setTimeout> | null = null;
  let editorModelSwitchVersion = 0;
  
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
    showFolderView: true,
    autoSave: false,
  });
  
  async function openFilePaths(paths: string[]) {
    for (const filePath of paths) {
      try {
        const fileContent = await readFile(filePath);
        const name = await getFileName(filePath);
        const { formatJson5, formatJsonText } = await import('$lib/services/json5Format.js');
        const normalizedContent = await normalizeOpenedJson(fileContent, {
          indent: settings.tabSize,
          formatJson: formatJsonText,
          detectDialect: (value) => detectJsonDialectAsync(`open:${filePath}`, value),
          formatJson5,
        });
        tabsStore.openFile(normalizedContent, filePath, name);
        
        await updateStats(true);  // Show JSON5 toast if detected
        showToast(`Opened: ${name || 'file'}`);
      } catch (e) {
        showToast('Failed to open file', 'error');
        console.error('Open file error:', e);
      }
    }
  }

  // Tracker for confirm dialog
  let isConfirmOpen = $state(false);
  let confirmMessage = $state('');
  let tabToClose = $state<string | null>(null);
  let confirmAction = $state<'close' | 'close_others' | null>(null);

  function handleConfirmClose() {
    if (confirmAction === 'close_others' && tabToClose) {
      tabsStore.closeOtherTabs(tabToClose);
    } else if (tabToClose) {
      tabsStore.removeTab(tabToClose);
    }
    tabToClose = null;
    confirmAction = null;
  }

  function handleCancelClose() {
    tabToClose = null;
    confirmAction = null;
  }

  onMount(() => {
    settingsStore.init();
    
    // Initialize file watcher service
    fileWatcherService.init();
    
    // Listen to clipboard formatting events
    let unlistenFormatted: (() => void) | null = null;
    let unlistenRaw: (() => void) | null = null;
    let unlistenFileDrop: (() => void) | null = null;
    let unlistenOpenFile: (() => void) | null = null;
    
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      
      // Listen for successfully formatted JSON
      unlistenFormatted = await listen<string>('clipboard-formatted', async (event) => {
        tabsStore.addTab(event.payload);
        showToast('Clipboard content formatted');
        queueMicrotask(() => {
          scheduleLogJsonDetection(event.payload);
          updateStats(true);
        });
      });
      
      // Listen for raw paste (when JSON is invalid)
      unlistenRaw = await listen<string>('clipboard-pasted-raw', async (event) => {
        tabsStore.addTab(event.payload);
        showToast('Clipboard content pasted (invalid JSON)');
        queueMicrotask(() => {
          scheduleLogJsonDetection(event.payload);
          updateStats(true);
        });
      });

      // Listen for file drop events
      unlistenFileDrop = await listen<{ paths: string[], position: { x: number, y: number } }>('tauri://drag-drop', async (event) => {
        const paths = event.payload?.paths;
        if (paths && paths.length > 0) {
          await openFilePaths(paths);
        }
      });

      // Listen for file open events (macOS "Open With" / double-click)
      unlistenOpenFile = await listen<string[]>('open-file', async (event) => {
        const paths = event.payload;
        if (!paths || paths.length === 0) return;
        await openFilePaths(paths);
      });

      // Retrieve files queued before frontend was ready (cold start)
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pending = await invoke<string[]>('get_pending_files');
        if (pending && pending.length > 0) {
          await openFilePaths(pending);
        }
      } catch (e) {
        console.error('Failed to get pending files:', e);
      }
    })();
    
    shortcutsStore.init();

    let workspaceResizeObserver: ResizeObserver | null = null;
    if (mainWorkspaceEl) {
      treeViewWidth = getDefaultPanelWidth(mainWorkspaceEl.clientWidth);
      workspaceResizeObserver = new ResizeObserver(([entry]) => {
        if (isResizingTreeView) return;
        treeViewWidth = clampPanelWidth(treeViewWidth, entry.contentRect.width);
        monacoEditor?.getEditorInstance()?.layout();
      });
      workspaceResizeObserver.observe(mainWorkspaceEl);
    }

    const handleKeydown = async (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Fixed shortcuts (not customizable)
      if (cmdOrCtrl && e.key === 't') {
        e.preventDefault();
        tabsStore.addTab();
        return;
      }
      // Prevent native macOS/Tauri default window close behavior for Cmd+Shift+W
      if (cmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
      }

      if (cmdOrCtrl && !e.shiftKey && e.key === 'w') {
        e.preventDefault();
        const currentTab = $activeTab;
        if (currentTab) {
          if (currentTab.isModified) {
            tabToClose = currentTab.id;
            confirmMessage = `"${currentTab.fileName || 'Untitled'}" has unsaved changes. Close anyway?`;
            isConfirmOpen = true;
            return;
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
          case 'close_other_tabs': {
            const activeTabId = tabsState.activeTabId;
            if (activeTabId) {
              const { shouldConfirmCloseOtherTabs } = await import('$lib/stores/tabClose.js');
              if (shouldConfirmCloseOtherTabs(tabsState.tabs, activeTabId)) {
                tabToClose = activeTabId;
                confirmAction = 'close_others';
                confirmMessage = 'Other tabs have unsaved changes. Close them anyway?';
                isConfirmOpen = true;
              } else {
                tabsStore.closeOtherTabs(activeTabId);
              }
            }
            break;
          }
          case 'quit_app': {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('quit_app');
            } catch {
              window.close();
            }
            break;
          }
        }
      }
    };
    
    const flushPendingTabPersistence = () => {
      tabsStore.flushPersistence();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingTabPersistence();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('pagehide', flushPendingTabPersistence);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      flushPendingTabPersistence();
      workspaceResizeObserver?.disconnect();
      if (unlistenFormatted) unlistenFormatted();
      if (unlistenRaw) unlistenRaw();
      if (unlistenFileDrop) unlistenFileDrop();
      if (unlistenOpenFile) unlistenOpenFile();
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('pagehide', flushPendingTabPersistence);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      if (logJsonTimer) clearTimeout(logJsonTimer);
      cancelLogJsonDetection();
      cancelPasteFormat();
      fileWatcherService.destroy();
      fileWatcherService.unwatchAll();
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
  let prevActiveTabContent = $state<string>('');
  let isFirstSync = $state(true);

  function getActiveTabFromState(state: import('$lib/stores/tabs').TabsState) {
    return state.tabs.find(tab => tab.id === state.activeTabId) || state.tabs[0] || null;
  }

  function countLines(value: string) {
    if (!value) return 0;
    let count = 1;
    for (let index = 0; index < value.length; index += 1) {
      if (value.charCodeAt(index) === 10) count += 1;
    }
    return count;
  }

  function setContentState(value: string, options: {
    deferLineCount?: boolean;
    syncRightPanel?: boolean;
  } = {}) {
    content = value;
    if (lineCountFrame !== null) {
      cancelAnimationFrame(lineCountFrame);
      lineCountFrame = null;
    }
    const version = ++lineCountVersion;
    if (options.deferLineCount) {
      lineCountFrame = requestAnimationFrame(() => {
        lineCountFrame = requestAnimationFrame(() => {
          lineCountFrame = null;
          if (version !== lineCountVersion || content !== value) return;
          lineCount = countLines(value);
        });
      });
      return;
    }
    lineCount = countLines(value);

    if (options.syncRightPanel) {
      const currentTab = $activeTab;
      if (currentTab) {
        scheduleRightPanelTabSync({ ...currentTab, content: value }, false);
      }
    }
  }

  function applyRightPanelTab(tab: TabWithContent) {
    rightPanelContent = tab.content;
    rightPanelActiveTabId = tab.id;
    rightPanelActiveTabPath = tab.filePath ?? null;
    rightPanelActiveTabName = tab.fileName ?? null;
  }

  function scheduleRightPanelTabSync(
    tab: TabWithContent,
    deferUntilEditorPaint: boolean,
  ) {
    if (rightPanelSyncFrame !== null) {
      cancelAnimationFrame(rightPanelSyncFrame);
      rightPanelSyncFrame = null;
    }
    const version = ++rightPanelSyncVersion;

    if (!deferUntilEditorPaint) {
      applyRightPanelTab(tab);
      return;
    }

    rightPanelSyncFrame = requestAnimationFrame(() => {
      rightPanelSyncFrame = requestAnimationFrame(() => {
        rightPanelSyncFrame = null;
        if (version !== rightPanelSyncVersion) return;
        applyRightPanelTab(tab);
      });
    });
  }

  function schedulePostSwitchWork(tab: TabWithContent, deferUntilEditorPaint: boolean) {
    if (postSwitchWorkFrame !== null) {
      cancelAnimationFrame(postSwitchWorkFrame);
      postSwitchWorkFrame = null;
    }
    const version = ++postSwitchWorkVersion;

    const run = () => {
      if (version !== postSwitchWorkVersion) return;
      if ($activeTab?.id !== tab.id || content !== tab.content) return;
      scheduleLogJsonDetection(tab.content);
    };

    if (!deferUntilEditorPaint) {
      run();
      return;
    }

    postSwitchWorkFrame = requestAnimationFrame(() => {
      postSwitchWorkFrame = requestAnimationFrame(() => {
        postSwitchWorkFrame = null;
        run();
      });
    });
  }

  function attachEditorModel(tabId: string, deferModelAttach: boolean) {
    editorModelSwitchVersion += 1;
    const version = editorModelSwitchVersion;
    if (editorModelSwitchTimer !== null) {
      clearTimeout(editorModelSwitchTimer);
      editorModelSwitchTimer = null;
    }

    if (!deferModelAttach) {
      editorModelKey = tabId;
      isEditorModelPending = false;
      return;
    }

    isEditorModelPending = true;
    editorModelSwitchTimer = setTimeout(() => {
      editorModelSwitchTimer = null;
      if (version !== editorModelSwitchVersion || tabsState.activeTabId !== tabId) return;
      editorModelKey = tabId;
      isEditorModelPending = false;
    }, 0);
  }

  async function syncActiveTab(
    state: import('$lib/stores/tabs').TabsState,
    options: { deferSideEffects?: boolean } = {},
  ) {
    const currentTab = getActiveTabFromState(state);
    if (!currentTab) return;
    const tabId = currentTab.id;
    const version = currentTab.contentVersion;
    const loadedContent = hasDocumentContent(tabId)
      ? getDocumentContent(tabId)
      : await loadDocumentContent(tabId);
    const latestTab = getActiveTabFromState(tabsState);
    if (latestTab?.id !== tabId || latestTab.contentVersion !== version) return;

    cancelPasteFormat();
    setContentState(loadedContent, {
      deferLineCount: options.deferSideEffects ?? false,
    });
    attachEditorModel(tabId, options.deferSideEffects ?? false);
    stats = currentTab.stats;
    if (isCurrentLogJsonContent(logJsonSource) && logJsonSource !== loadedContent) {
      resetLogJsonFragments();
    }
    scheduleRightPanelTabSync({ ...currentTab, content: loadedContent }, options.deferSideEffects ?? false);
    schedulePostSwitchWork({ ...currentTab, content: loadedContent }, options.deferSideEffects ?? false);
  }
  
  // Handle file watching for active tab
  async function setupFileWatching(tab: import('$lib/stores/tabs').Tab | null) {
    if (!tab || !tab.filePath) return;
    
    try {
      await fileWatcherService.watchFile(tab.filePath, async (changedPath) => {
        const currentTab = tabsState.tabs.find(t => t.id === tab.id);
        if (!currentTab) return;
        const currentContent = getDocumentContent(currentTab.id);

        // File was modified externally
        if (currentTab.isModified) {
          // Show confirmation dialog
          showToast(`File "${currentTab.fileName}" was modified externally`, 'info');
        } else {
          // Auto reload if not modified
          try {
            const newContent = await readFile(changedPath);
            if (newContent !== currentContent) {
              tabsStore.updateTabContent(currentTab.id, newContent, false);
              await updateStats();
              showToast(`File "${currentTab.fileName}" reloaded`, 'success');
            }
          } catch (e) {
            showToast(`Failed to reload file "${currentTab.fileName}"`, 'error');
            console.error('Failed to reload file:', e);
          }
        }
      });
    } catch (e) {
      console.error('Failed to setup file watching:', e);
    }
  }
  
  $effect(() => {
    const unsubscribe = tabsStore.subscribe(newTabsState => {
      const oldActiveTabId = prevActiveTabId;
      const newActiveTabId = newTabsState.activeTabId;
      const currentTab = getActiveTabFromState(newTabsState);
      const newActiveTabVersion = currentTab?.contentVersion ?? 0;
      
      tabsState = newTabsState;
      monacoEditor?.retainModels(newTabsState.tabs.map(tab => tab.id));
      
      // For the first sync, initialize prevActiveTabId and sync content
      if (isFirstSync) {
        isFirstSync = false;
        prevActiveTabId = newActiveTabId;
        prevActiveTabContent = String(newActiveTabVersion);
        void syncActiveTab(newTabsState);
        setupFileWatching(currentTab);
        return;
      }
      
      // Sync content when:
      // 1. Switching tabs (activeTabId changed)
      // 2. Current tab's content changed externally (e.g., file opened into empty tab)
      const tabSwitched = oldActiveTabId !== newActiveTabId;
      const contentChangedExternally = prevActiveTabContent !== String(newActiveTabVersion);
      
      if (tabSwitched || contentChangedExternally) {
        prevActiveTabId = newActiveTabId;
        prevActiveTabContent = String(newActiveTabVersion);
        void syncActiveTab(newTabsState, {
          deferSideEffects: tabSwitched,
        });
        
        // Setup file watching for new active tab
        if (tabSwitched) {
          setupFileWatching(currentTab);
        }
      }
    });
    return () => unsubscribe();
  });
  
  let isDarkMode = $derived(settings.isDarkMode);
  let fontSize = $derived(settings.fontSize);
  let lineHeight = $derived(settings.lineHeight);
  let tabSize = $derived(settings.tabSize);
  let showTreeView = $derived(settings.showTreeView);
  let showFolderView = $derived(settings.showFolderView);
  let hasLogJsonFragmentsPanel = $derived(isLogJsonPanelOpen && logJsonFragments.length > 0);
  let monacoTheme = $derived<EditorTheme>(isDarkMode ? settings.darkTheme : settings.lightTheme);

  onDestroy(() => {
    if (rightPanelSyncFrame !== null) cancelAnimationFrame(rightPanelSyncFrame);
    if (postSwitchWorkFrame !== null) cancelAnimationFrame(postSwitchWorkFrame);
    if (lineCountFrame !== null) cancelAnimationFrame(lineCountFrame);
    if (editorModelSwitchTimer !== null) clearTimeout(editorModelSwitchTimer);
  });
  $effect(() => {
    if (!showTreeView) {
      isResizingTreeView = false;
    }
  });
  
  let prevTabSize: number | null = null;
  // Watch tabSize changes and reformat JSON content
  $effect(() => {
    // Only reformat when settings.tabSize actually changes to a different value
    // and there's content. We use an untracked read of the content to prevent
    // format loops on every keystroke.
    if (!monacoEditor) return;
    
    // We intentionally don't track prevTabSize here as an effect dependency
    const currentTabSize = settings.tabSize;
    if (!currentTabSize) return;

    if (prevTabSize !== null && currentTabSize !== prevTabSize) {
      // Use setTimeout to allow settings to settle and untrack the content read
      setTimeout(() => {
        const currentContent = content || '';
        if (currentContent.trim()) {
          toolbarRef?.formatContent();
        }
      }, 0);
    }
    prevTabSize = currentTabSize;
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
        const currentContent = getDocumentContent(currentTab.id);
        setContentState(currentContent, { syncRightPanel: true });
        stats = currentTab.stats;
        monacoEditor?.setValue(currentContent);
      }
      return;
    }

    if (isConvertMode) {
      isConvertMode = false;
    }
    if (isCodegenMode) {
      isCodegenMode = false;
    }
    if (isSchemaMode) {
      isSchemaMode = false;
    }

    const emptyStats: JsonStats = {
      valid: false,
      key_count: 0,
      depth: 0,
      byte_size: 0,
      format_type: '',
      error_info: null,
    };

    isDiffMode = true;
    diffLineCount = 0;
    diffOriginal = content;
    diffModified = '';
    diffLeftStats = { ...stats };
    diffRightStats = emptyStats;
  }

  // Sub-page toggle functions (Convert / CodeGen / Schema) share the same
  // JSON5 content protection pattern:
  //   Enter: convertJson5ToJsonIfNeeded() stashes original JSON5 → converts to JSON
  //   Exit:  if originalJson5Content is set → restore it (auto-conversion was done)
  //          if originalJson5Content is empty → keep current content (standard JSON,
  //          user edits in the sub-page persist back to the main editor)
  async function toggleConvertMode() {
    if (isConvertMode) {
      isConvertMode = false;
      
      if (originalJson5Content) {
        setContentState(originalJson5Content, { syncRightPanel: true });
        monacoEditor?.setValue(originalJson5Content);
        const currentTab = $activeTab;
        if (currentTab) {
          tabsStore.updateTabContent(currentTab.id, originalJson5Content);
        }
        originalJson5Content = '';
        await updateStats();
      } else {
        const currentTab = $activeTab;
        if (currentTab) {
          const currentContent = getDocumentContent(currentTab.id);
          setContentState(currentContent, { syncRightPanel: true });
          stats = currentTab.stats;
          monacoEditor?.setValue(currentContent);
        }
      }
      
      return;
    }

    if (isDiffMode) {
      toggleDiffMode();
    }
    if (isCodegenMode) {
      isCodegenMode = false;
    }
    if (isSchemaMode) {
      isSchemaMode = false;
    }
    
    // Convert JSON5 to standard JSON if needed
    await convertJson5ToJsonIfNeeded();
    
    isConvertMode = true;
  }

  async function toggleCodegenMode() {
    if (isCodegenMode) {
      isCodegenMode = false;
      
      if (originalJson5Content) {
        setContentState(originalJson5Content, { syncRightPanel: true });
        monacoEditor?.setValue(originalJson5Content);
        const currentTab = $activeTab;
        if (currentTab) {
          tabsStore.updateTabContent(currentTab.id, originalJson5Content);
        }
        originalJson5Content = '';
        await updateStats();
      } else {
        const currentTab = $activeTab;
        if (currentTab) {
          const currentContent = getDocumentContent(currentTab.id);
          setContentState(currentContent, { syncRightPanel: true });
          stats = currentTab.stats;
          monacoEditor?.setValue(currentContent);
        }
      }
      
      return;
    }

    if (isDiffMode) {
      isDiffMode = false;
    }
    if (isConvertMode) {
      isConvertMode = false;
    }
    if (isSchemaMode) {
      isSchemaMode = false;
    }
    
    // Convert JSON5 to standard JSON if needed
    await convertJson5ToJsonIfNeeded();
    
    isCodegenMode = true;
  }

  async function toggleSchemaMode() {
    if (isSchemaMode) {
      isSchemaMode = false;
      
      if (originalJson5Content) {
        setContentState(originalJson5Content, { syncRightPanel: true });
        monacoEditor?.setValue(originalJson5Content);
        const currentTab = $activeTab;
        if (currentTab) {
          tabsStore.updateTabContent(currentTab.id, originalJson5Content);
        }
        originalJson5Content = '';
        await updateStats();
      } else {
        const currentTab = $activeTab;
        if (currentTab) {
          const currentContent = getDocumentContent(currentTab.id);
          setContentState(currentContent, { syncRightPanel: true });
          stats = currentTab.stats;
          monacoEditor?.setValue(currentContent);
        }
      }
      
      return;
    }

    if (isDiffMode) {
      isDiffMode = false;
    }
    if (isConvertMode) {
      isConvertMode = false;
    }
    if (isCodegenMode) {
      isCodegenMode = false;
    }
    
    // Convert JSON5 to standard JSON if needed
    await convertJson5ToJsonIfNeeded();
    
    isSchemaMode = true;
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

  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success') {
    toastMsg = msg;
    toastType = type;
  }

  function resetLogJsonFragments() {
    if (logJsonTimer) {
      clearTimeout(logJsonTimer);
      logJsonTimer = null;
    }
    cancelLogJsonDetection();
    logJsonFragments = [];
    logJsonSource = '';
    selectedLogJsonFragmentIndex = 0;
    isLogJsonPanelOpen = false;
  }

  function applyLogJsonDetectionResult(value: string, fragments: LogJsonFragment[]) {
    const isWholeDocumentJson =
      fragments.length === 1 && fragments[0].raw.trim() === value.trim();

    if (fragments.length === 0 || isWholeDocumentJson) {
      logJsonFragments = [];
      logJsonSource = '';
      selectedLogJsonFragmentIndex = 0;
      isLogJsonPanelOpen = false;
      return;
    }

    logJsonFragments = fragments;
    logJsonSource = value;
    selectedLogJsonFragmentIndex = Math.min(selectedLogJsonFragmentIndex, fragments.length - 1);
    isLogJsonPanelOpen = true;
  }

  function scheduleLogJsonDetection(value: string) {
    if (logJsonTimer) clearTimeout(logJsonTimer);
    cancelLogJsonDetection();

    if (!value.trim() || value.length > MAX_LOG_JSON_INPUT_LENGTH) {
      resetLogJsonFragments();
      return;
    }

    logJsonTimer = setTimeout(async () => {
      try {
        const fragments = await extractLogJsonFragmentsAsync(value, {
          indent: tabSize,
        }) as LogJsonFragment[];
        if (content === value) applyLogJsonDetectionResult(value, fragments);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (content === value) resetLogJsonFragments();
      }
    }, 400);
  }

  function isCurrentLogJsonContent(text: string) {
    return logJsonSource === text && logJsonFragments.length > 0;
  }

  async function copyLogJsonFragment(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast($t('toast.logJsonCopied'));
    } catch (error) {
      console.error('Failed to copy log JSON fragment:', error);
      showToast($t('toast.logJsonCopyFailed'), 'error');
    }
  }

  function startTreeResize(event: PointerEvent) {
    if (!showTreeView || !mainWorkspaceEl) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = treeViewWidth;
    const workspaceWidth = mainWorkspaceEl.clientWidth;
    isResizingTreeView = true;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isResizingTreeView) return;
      const delta = startX - moveEvent.clientX;
      treeViewWidth = clampPanelWidth(startWidth + delta, workspaceWidth);
      requestAnimationFrame(() => monacoEditor?.getEditorInstance()?.layout());
    };

    const handlePointerUp = () => {
      isResizingTreeView = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function startFolderResize(event: PointerEvent) {
    if (!showFolderView || !mainWorkspaceEl) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = folderViewWidth;
    const workspaceWidth = mainWorkspaceEl.clientWidth;
    isResizingFolderView = true;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isResizingFolderView) return;
      const delta = moveEvent.clientX - startX;
      folderViewWidth = clampFolderWidth(startWidth + delta, workspaceWidth);
      requestAnimationFrame(() => monacoEditor?.getEditorInstance()?.layout());
    };

    const handlePointerUp = () => {
      isResizingFolderView = false;
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
        format_type: '',
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
      const result = await getJsonDocumentStatsAsync(`diff:${side}`, value) as JsonStats;
      const currentValue = side === 'left' ? diffOriginal : diffModified;
      if (currentValue !== value) return;
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
    if (isEditorModelPending || editorModelKey !== currentTab.id) return;
    setContentState(newValue, { syncRightPanel: true });
    tabsStore.updateTabContent(currentTab.id, newValue);

    if (statsTimer) clearTimeout(statsTimer);
    if (!content.trim()) { 
      stats = {
        valid: false,
        key_count: 0,
        depth: 0,
        byte_size: 0,
        format_type: '',
        error_info: null,
      };
      tabsStore.updateTabStats(currentTab.id, stats);
      resetLogJsonFragments();
      return;
    }
    
    statsTimer = setTimeout(updateStats, 300);
    scheduleLogJsonDetection(newValue);

    if (settings.autoSave) {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        const currentTab = $activeTab;
        if (currentTab && currentTab.isModified && currentTab.filePath) {
          toolbarRef?.saveFile(true);
        }
      }, 1000);
    }
  }

  function handleToolbarContentChange(newValue: string) {
    const currentTab = $activeTab;
    setContentState(newValue, { syncRightPanel: true });
    if (!currentTab) return;
    tabsStore.updateTabContent(currentTab.id, newValue);
    scheduleLogJsonDetection(newValue);

    if (settings.autoSave) {
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        const currentTab = $activeTab;
        if (currentTab && currentTab.isModified && currentTab.filePath) {
          toolbarRef?.saveFile(true);
        }
      }, 1000);
    }
  }

  async function handleEditorPaste() {
    const sourceTab = $activeTab;
    if (!sourceTab) return;
    if (isEditorModelPending || editorModelKey !== sourceTab.id) return;
    const tabId = sourceTab.id;
    const sourceValue = content;
    if (!sourceValue.trim()) return;

    try {
      const normalized = await formatPastedJsonAsync(sourceValue, tabSize);
      if (!normalized || normalized === sourceValue) return;
      const currentSourceTab = tabsState.tabs.find(tab => tab.id === tabId);
      if (
        $activeTab?.id !== tabId ||
        !currentSourceTab ||
        getDocumentContent(tabId) !== sourceValue ||
        content !== sourceValue ||
        monacoEditor?.getValue() !== sourceValue
      ) {
        return;
      }

      setContentState(normalized, { syncRightPanel: true });
      monacoEditor.setValue(normalized);
      tabsStore.updateTabContent(tabId, normalized);
      scheduleLogJsonDetection(normalized);
      await updateStats();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Failed to format pasted JSON:', error);
      }
    }
  }

  async function updateStats(showJson5Toast: boolean = false) {
    if (!content.trim()) return;
    const currentTab = $activeTab;
    if (!currentTab) return;
    const tabId = currentTab.id;
    const source = content;
    
    try {
      const result = await getJsonDocumentStatsAsync(tabId, source) as JsonStats;
      const sourceTab = tabsState.tabs.find(tab => tab.id === tabId);
      if (!sourceTab || getDocumentContent(tabId) !== source) return;

      tabsStore.updateTabStats(tabId, result);
      if ($activeTab?.id !== tabId || content !== source) return;

      stats = result;
      
      // Show toast when JSON5 format is detected (only if requested)
      if (showJson5Toast && result.format_type === 'JSON5') {
        showToast($t('toast.json5Detected'), 'info');
      }
      
    } catch (e) {}
  }

  // Called before entering Convert / CodeGen / Schema sub-pages.
  // These pages require standard JSON input, so JSON5 content is converted
  // automatically. The original JSON5 is stashed in `originalJson5Content`
  // and will be restored when the user exits the sub-page.
  // For standard JSON content this is a no-op (originalJson5Content stays empty).
  async function convertJson5ToJsonIfNeeded() {
    if (stats.format_type === 'JSON5') {
      try {
        originalJson5Content = content;
        
        const converted = await formatJson(content, tabSize);
        setContentState(converted, { syncRightPanel: true });
        monacoEditor?.setValue(converted);
        
        const currentTab = $activeTab;
        if (currentTab) {
          tabsStore.updateTabContent(currentTab.id, converted);
        }
        
        await updateStats();
        showToast($t('toast.json5Converted'), 'info');
      } catch (e) {
        showToast($t('toast.json5ConvertFailed'), 'error');
      }
    }
  }

</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Toolbar -->
  {#if !isConvertMode && !isCodegenMode && !isSchemaMode}
    <JsonEditorToolbar
      bind:this={toolbarRef}
      isDiffMode={isDiffMode}
      isConvertMode={isConvertMode}
      isCodegenMode={isCodegenMode}
      isSchemaMode={isSchemaMode}
      content={content}
      activeTab={$activeTab}
      isDarkMode={isDarkMode}
      isAlwaysOnTop={isAlwaysOnTop}
      editor={monacoEditor}
      tabSize={tabSize}
      onToggleDiff={toggleDiffMode}
      onToggleConvert={toggleConvertMode}
      onToggleCodegen={toggleCodegenMode}
      onToggleSchema={toggleSchemaMode}
      onToggleTheme={toggleTheme}
      onToggleAlwaysOnTop={toggleAlwaysOnTop}
      onOpenSettings={openSettings}
      onContentChange={handleToolbarContentChange}
      onStatsUpdate={updateStats}
      onToast={showToast}
    />
  {/if}
  
  <!-- Main content area: Tab Bar + Editor + Tree View -->
  <div
    bind:this={mainWorkspaceEl}
    class="json-main-workspace"
    class:resizing-tree-view={isResizingTreeView || isResizingFolderView}
  >
    {#if !isDiffMode && !isConvertMode && !isCodegenMode && !isSchemaMode && !hasLogJsonFragmentsPanel}
      <!-- Folder Sidebar Area -->
      {#if showFolderView}
        <div class="json-folder-container" style={`width: ${folderViewWidth}px;`}>
          <FolderSidebar />
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="json-folder-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize folder panel"
          tabindex="0"
          onpointerdown={startFolderResize}
        ></div>
      {/if}

      <div class="json-view-toggler-zone left" class:is-closed={!showFolderView}>
        <button 
          class="json-view-toggle-btn"
          onclick={() => settingsStore.updateSetting('showFolderView', !showFolderView)}
          title={showFolderView ? $t('folderView.hide') : $t('folderView.show')}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            {#if showFolderView}
              <polygon points="16,4 8,12 16,20" /> <!-- Left arrow -->
            {:else}
              <polygon points="8,4 16,12 8,20" /> <!-- Right arrow -->
            {/if}
          </svg>
        </button>
      </div>
    {/if}

    <!-- Center section: Tab Bar + Editor -->
    <div class="json-editor-left">
      <!-- Tab Bar - show different tab bars based on mode -->
      {#if !isDiffMode && !isConvertMode && !isCodegenMode && !isSchemaMode && tabsState.tabs.length >= 1}
        <TabBar 
          tabs={tabsState.tabs} 
          activeTabId={tabsState.activeTabId}
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
        {:else if isCodegenMode}
          <CodeGenView
            inputValue={content}
            theme={monacoTheme}
            fontSize={fontSize}
            lineHeight={lineHeight}
            tabSize={tabSize}
            onInputChange={handleToolbarContentChange}
            onToast={showToast}
            onExit={toggleCodegenMode}
          />
        {:else if isSchemaMode}
          <SchemaView
            inputValue={content}
            theme={monacoTheme}
            fontSize={fontSize}
            lineHeight={lineHeight}
            tabSize={tabSize}
            onInputChange={handleToolbarContentChange}
            onToast={showToast}
            onExit={toggleSchemaMode}
          />
        {:else}
          <div class="json-editor-workspace">
            <div class="json-editor-main">
              <MonacoEditor
                bind:this={monacoEditor}
                value={content}
                modelKey={editorModelKey}
                theme={monacoTheme}
                language="json5"
                readOnly={isEditorModelPending}
                deferValueSync={isEditorModelPending}
                fontSize={fontSize}
                lineHeight={lineHeight}
                tabSize={tabSize}
                onChange={handleEditorChange}
                onPaste={handleEditorPaste}
              />
            </div>
            {#if hasLogJsonFragmentsPanel}
              <LogJsonFragmentsPanel
                fragments={logJsonFragments}
                selectedIndex={selectedLogJsonFragmentIndex}
                theme={monacoTheme}
                tabSize={tabSize}
                on:select={(event) => { selectedLogJsonFragmentIndex = event.detail.index; }}
                on:copy={(event) => copyLogJsonFragment(event.detail.value)}
                on:close={() => { isLogJsonPanelOpen = false; }}
              />
            {/if}
          </div>
        {/if}

        {#if toastMsg}
          <JsonEditorToast message={toastMsg} type={toastType} on:close={() => { toastMsg = ''; }} />
        {/if}
      </div>
    </div>

    <!-- Unified Right Section & Toggler -->
    {#if !isDiffMode && !isConvertMode && !isCodegenMode && !isSchemaMode && !hasLogJsonFragmentsPanel}
      
      {#if showTreeView}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="json-tree-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize view panel"
          tabindex="0"
          onpointerdown={startTreeResize}
        ></div>
      {/if}

      <div class="json-view-toggler-zone" class:is-closed={!showTreeView}>
        <button 
          class="json-view-toggle-btn"
          onclick={() => settingsStore.updateSetting('showTreeView', !showTreeView)}
          title={showTreeView ? $t('rightPanel.hide') : $t('rightPanel.show')}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
            {#if showTreeView}
              <polygon points="8,4 16,12 8,20" /> <!-- Right arrow -->
            {:else}
              <polygon points="16,4 8,12 16,20" /> <!-- Left arrow -->
            {/if}
          </svg>
        </button>
      </div>

      {#if showTreeView}
        <div class="json-tree-container" style={`width: ${treeViewWidth}px;`}>
          <RightViewPanel
            content={rightPanelContent}
            editor={monacoEditor}
            activeTabPath={rightPanelActiveTabPath}
            activeTabName={rightPanelActiveTabName}
            activeTabId={rightPanelActiveTabId}
            onToast={showToast}
          />
        </div>
      {/if}
    {/if}
  </div>

  {#if !isConvertMode && !isCodegenMode && !isSchemaMode}
    <JsonEditorStatusBar
      isDiffMode={isDiffMode}
      diffLineCount={diffLineCount}
      diffLeftStats={diffLeftStats}
      diffRightStats={diffRightStats}
      diffOriginal={diffOriginal}
      diffModified={diffModified}
      activeTab={$activeTab}
      stats={stats}
      lineCount={lineCount}
    />
  {/if}

  <!-- Settings panel -->
  <SettingsPanel bind:this={settingsPanel} />
  <AboutDialog />

  <ConfirmDialog
    bind:isOpen={isConfirmOpen}
    title="Unsaved Changes"
    message={confirmMessage}
    confirmText="Close Anyway"
    cancelText="Cancel"
    isDanger={true}
    onConfirm={handleConfirmClose}
    onCancel={handleCancelClose}
  />
</div>

<style>
  .json-folder-container {
    height: 100%;
    min-width: 0;
    flex-shrink: 0;
    overflow: hidden;
  }

  .json-view-toggler-zone {
    position: relative;
    width: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Only add the invisible hover area when closed */
  .json-view-toggler-zone.is-closed::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -10px;
    right: -10px;
    z-index: 1; /* For hover detection area */
  }

  .json-view-toggle-btn {
    position: absolute;
    left: -7px;
    width: 14px;
    height: 56px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    opacity: 0;
    transition: opacity 0.2s, background 0.2s, color 0.2s;
    z-index: 2;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
  }

  /* Left-side specific toggler styling */
  .json-view-toggler-zone.left .json-view-toggle-btn {
    left: auto;
    right: -7px;
  }

  /* Trigger hover from the resizer or the zone */
  :global(.json-tree-resizer:hover) + .json-view-toggler-zone .json-view-toggle-btn,
  :global(.json-folder-resizer:hover) + .json-view-toggler-zone .json-view-toggle-btn,
  .json-view-toggler-zone:hover .json-view-toggle-btn,
  .json-view-toggle-btn:focus-visible {
    opacity: 1;
  }

  .json-view-toggle-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .json-view-toggle-btn svg {
    width: 18px;
    height: 18px;
  }

  .json-view-toggler-zone.is-closed .json-view-toggle-btn {
    left: -14px;
    border-right: none;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    opacity: 1;
  }

  .json-view-toggler-zone.left.is-closed .json-view-toggle-btn {
    left: auto;
    right: -14px;
    border-right: 1px solid var(--border);
    border-left: none;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-top-right-radius: 7px;
    border-bottom-right-radius: 7px;
    opacity: 1;
  }
</style>

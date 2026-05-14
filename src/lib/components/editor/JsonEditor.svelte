<script lang="ts">
  import { onMount } from 'svelte';
  import { getJsonStats, type JsonStats } from '$lib/services/json';
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
  import JsonTreeView from './JsonTreeView.svelte';
  import JsonEditorToast from './JsonEditorToast.svelte';
  import LogJsonFragmentsPanel from './LogJsonFragmentsPanel.svelte';
  import ConfirmDialog from '../dialogs/ConfirmDialog.svelte';
  import { type EditorTheme } from '$lib/config/monacoThemes';
  import { settingsStore } from '$lib/stores/settings';
  import { shortcutsStore } from '$lib/stores/shortcuts';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';
  import { jsonrepair } from 'jsonrepair';
  import {
    extractLogJsonFragments,
    getStandaloneEscapedJsonContent,
    MAX_LOG_JSON_INPUT_LENGTH,
  } from '$lib/services/logJsonFragments.js';
  import { normalizePastedStandaloneJson } from '$lib/services/standaloneJsonPasteNormalize.js';
  import { t } from '$lib/i18n';

  type LogJsonFragment = {
    label: string;
    line: number;
    column: number;
    raw: string;
    formatted: string;
    kind: 'JSON' | 'JSON5' | 'Escaped JSON' | 'Repaired JSON';
  };

  let content = $state('');
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
  let pasteFormatTimer: ReturnType<typeof setTimeout> | null = null;
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
  let jsonError = $state<{ message: string } | null>(null);
  let logJsonFragments = $state<LogJsonFragment[]>([]);
  let selectedLogJsonFragmentIndex = $state(0);
  let isLogJsonPanelOpen = $state(false);
  let logJsonSource = $state('');
  // When entering Convert/CodeGen/Schema with JSON5 content, the original JSON5
  // is saved here so it can be restored on exit. For standard JSON this stays empty,
  // meaning sub-page edits persist back to the main editor.
  let originalJson5Content = $state('');
  let isFixing = $state(false);
  let jsonErrorTimer: ReturnType<typeof setTimeout> | null = null;
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
    autoSave: false,
  });
  
  async function openFilePaths(paths: string[]) {
    for (const filePath of paths) {
      try {
        const fileContent = await readFile(filePath);
        const name = await getFileName(filePath);
        const maxTabsReached = tabsStore.openFile(fileContent, filePath, name);
        
        if (maxTabsReached) {
          showToast('Maximum 10 tabs reached', 'info');
          break;
        }
        
        quickDetectFormatAndSwitchLanguage(fileContent);  // Immediate language switch
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

  function handleConfirmClose() {
    if (tabToClose) {
      tabsStore.removeTab(tabToClose);
      tabToClose = null;
    }
  }

  function handleCancelClose() {
    tabToClose = null;
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
        const currentTab = $activeTab;
        if (!currentTab) return;

        const nextContent = await normalizeEditorPastedStandaloneJson(event.payload).catch(() => null) || event.payload;
        
        content = nextContent;
        monacoEditor?.setValue(nextContent);
        tabsStore.updateTabContent(currentTab.id, nextContent);
        quickDetectFormatAndSwitchLanguage(nextContent);  // Immediate language switch
        scheduleLogJsonDetection(nextContent);
        updateStats(true);  // Show JSON5 toast if detected
        showToast('Clipboard content formatted');
      });
      
      // Listen for raw paste (when JSON is invalid)
      unlistenRaw = await listen<string>('clipboard-pasted-raw', async (event) => {
        const currentTab = $activeTab;
        if (!currentTab) return;

        const nextContent = await normalizeEditorPastedStandaloneJson(event.payload).catch(() => null) || event.payload;
        
        content = nextContent;
        monacoEditor?.setValue(nextContent);
        tabsStore.updateTabContent(currentTab.id, nextContent);
        quickDetectFormatAndSwitchLanguage(nextContent);  // Immediate language switch
        scheduleLogJsonDetection(nextContent);
        updateStats(true);  // Show JSON5 toast if detected
        showToast('Clipboard content pasted (invalid JSON)');
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
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      if (logJsonTimer) clearTimeout(logJsonTimer);
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
    restoreEditorLanguage(currentTab.content, currentTab.stats);
    checkJsonError(currentTab.content);
    scheduleLogJsonDetection(currentTab.content);
  }
  
  // Handle file watching for active tab
  async function setupFileWatching(tab: import('$lib/stores/tabs').Tab | null) {
    if (!tab || !tab.filePath) return;
    
    try {
      await fileWatcherService.watchFile(tab.filePath, async (changedPath) => {
        const currentTab = tabsState.tabs.find(t => t.id === tab.id);
        if (!currentTab) return;

        // File was modified externally
        if (currentTab.isModified) {
          // Show confirmation dialog
          showToast(`File "${currentTab.fileName}" was modified externally`, 'info');
        } else {
          // Auto reload if not modified
          try {
            const newContent = await readFile(changedPath);
            if (newContent !== currentTab.content) {
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
      const newActiveTabContent = currentTab?.content || '';
      
      tabsState = newTabsState;
      
      // For the first sync, initialize prevActiveTabId and sync content
      if (isFirstSync) {
        isFirstSync = false;
        prevActiveTabId = newActiveTabId;
        prevActiveTabContent = newActiveTabContent;
        syncActiveTab(newTabsState);
        setupFileWatching(currentTab);
        return;
      }
      
      // Sync content when:
      // 1. Switching tabs (activeTabId changed)
      // 2. Current tab's content changed externally (e.g., file opened into empty tab)
      const tabSwitched = oldActiveTabId !== newActiveTabId;
      const contentChangedExternally = prevActiveTabContent !== newActiveTabContent && 
                                       newActiveTabContent !== content;
      
      if (tabSwitched || contentChangedExternally) {
        prevActiveTabId = newActiveTabId;
        prevActiveTabContent = newActiveTabContent;
        syncActiveTab(newTabsState);
        
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
  let monacoTheme = $derived<EditorTheme>(isDarkMode ? settings.darkTheme : settings.lightTheme);
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
        content = currentTab.content;
        stats = currentTab.stats;
        monacoEditor?.setValue(currentTab.content);
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
        content = originalJson5Content;
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
          content = currentTab.content;
          stats = currentTab.stats;
          monacoEditor?.setValue(currentTab.content);
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
        content = originalJson5Content;
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
          content = currentTab.content;
          stats = currentTab.stats;
          monacoEditor?.setValue(currentTab.content);
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
        content = originalJson5Content;
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
          content = currentTab.content;
          stats = currentTab.stats;
          monacoEditor?.setValue(currentTab.content);
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
    logJsonFragments = [];
    logJsonSource = '';
    selectedLogJsonFragmentIndex = 0;
    isLogJsonPanelOpen = false;
  }

  function scheduleLogJsonDetection(value: string) {
    if (logJsonTimer) clearTimeout(logJsonTimer);

    if (
      !value.trim() ||
      value.length > MAX_LOG_JSON_INPUT_LENGTH ||
      getStandaloneEscapedJsonContent(value)
    ) {
      resetLogJsonFragments();
      return;
    }

    logJsonTimer = setTimeout(() => {
      if (content !== value) {
        return;
      }
      const fragments = extractLogJsonFragments(value, { indent: tabSize }) as LogJsonFragment[];
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
      jsonError = null;
      monacoEditor?.setLanguage('plaintext');
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

  function replaceActiveEditorContent(value: string) {
    const currentTab = $activeTab;
    content = value;
    monacoEditor?.setValue(value);
    if (currentTab) {
      tabsStore.updateTabContent(currentTab.id, value);
    }
    scheduleLogJsonDetection(value);
  }

  async function normalizeEditorPastedStandaloneJson(sourceValue: string) {
    const trimmed = sourceValue.trim();
    if (!trimmed) return null;

    const { formatJson } = await import('$lib/services/json');
    return await normalizePastedStandaloneJson(sourceValue, {
      indent: tabSize,
      formatJson,
      getStandaloneEscapedJsonContent,
    });
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
      jsonError = null;
      resetLogJsonFragments();
      monacoEditor?.setLanguage('json');
      return;
    }
    
    quickDetectFormatAndSwitchLanguage(newValue);
    
    statsTimer = setTimeout(updateStats, 300);
    checkJsonError(newValue);
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
    content = newValue;
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

  // Paste auto-format: only format standard JSON. JSON5 content must not be
  // auto-formatted because the backend converts it to standard JSON (losing
  // comments, Infinity, unquoted keys, single-quote strings, etc.).
  function handleEditorPaste() {
    if (pasteFormatTimer) clearTimeout(pasteFormatTimer);
    pasteFormatTimer = setTimeout(async () => {
      if (!content.trim()) {
        return;
      }
      const sourceValue = content;
      try {
        const normalized = await normalizeEditorPastedStandaloneJson(sourceValue);
        if (normalized && monacoEditor?.getValue() === sourceValue) {
          replaceActiveEditorContent(normalized);
          await updateStats();
          return;
        }
      } catch {
      }

      if (monacoEditor?.getValue() === sourceValue) {
        await updateStats(true);
      }
    }, 100);
  }

  // Detect whether the editor content is JSON or JSON5 and switch Monaco's
  // language mode accordingly. This is called on every content change so
  // Monaco's built-in JSON validator does not flag valid JSON5 as errors.
  //
  // - JSON  → 'json' mode   (Monaco validation active — shows real errors)
  // - JSON5 → 'json5' mode  (custom tokenizer, no validation — we rely on backend)
  // - Invalid → 'json' mode (Monaco shows errors + our repair banner)
  function restoreEditorLanguage(text: string, knownStats?: JsonStats | null) {
    if (!text.trim()) {
      monacoEditor?.setLanguage('json');
      return;
    }

    if (knownStats?.format_type === 'JSON5') {
      monacoEditor?.setLanguage('json5');
      return;
    }

    if (knownStats?.format_type === 'JSON') {
      monacoEditor?.setLanguage('json');
      return;
    }

    const fragments = extractLogJsonFragments(text, { indent: tabSize, maxFragments: 1 }) as LogJsonFragment[];
    const isWholeDocumentJson =
      fragments.length === 1 && fragments[0].raw.trim() === text.trim();
    if (fragments.length > 0 && !isWholeDocumentJson) {
      monacoEditor?.setLanguage('plaintext');
      return;
    }

    quickDetectFormatAndSwitchLanguage(text);
  }

  // Quickly detect format and switch language mode to prevent validation errors
  async function quickDetectFormatAndSwitchLanguage(text: string) {
    if (!text.trim()) {
      monacoEditor?.setLanguage('json');  // Reset to JSON for empty content
      return;
    }
    
    try {
      JSON.parse(text);
      monacoEditor?.setLanguage('json');
      return;
    } catch {
      // If standard JSON fails, check if it's valid JSON5
      try {
        const { getJsonStats } = await import('$lib/services/json');
        const result = await getJsonStats(text);
        if (content !== text) {
          return;
        }
        
        if (result.valid && result.format_type === 'JSON5') {
          monacoEditor?.setLanguage('json5');
        } else {
          monacoEditor?.setLanguage('json');
        }
      } catch {
        if (content !== text) {
          return;
        }
        monacoEditor?.setLanguage('json');
      }
    }
  }

  async function updateStats(showJson5Toast: boolean = false) {
    if (!content.trim()) return;
    const currentTab = $activeTab;
    if (!currentTab) return;
    
    try {
      stats = await getJsonStats(content);
      tabsStore.updateTabStats(currentTab.id, stats);
      
      // Show toast when JSON5 format is detected (only if requested)
      if (showJson5Toast && stats.format_type === 'JSON5') {
        showToast($t('toast.json5Detected'), 'info');
      }
      
      // Switch language mode based on format (confirmed by backend)
      if (stats.format_type === 'JSON5') {
        monacoEditor?.setLanguage('json5');
      } else if (stats.format_type === 'JSON') {
        monacoEditor?.setLanguage('json');
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
        
        const { formatJson } = await import('$lib/services/json');
        const converted = await formatJson(content, tabSize);
        content = converted;
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

  function checkJsonError(text: string) {
    if (jsonErrorTimer) clearTimeout(jsonErrorTimer);
    jsonErrorTimer = setTimeout(async () => {
      if (content !== text) {
        return;
      }
      if (!text.trim()) {
        jsonError = null;
        return;
      }
      if (isCurrentLogJsonContent(text)) {
        jsonError = null;
        return;
      }
      try {
        JSON.parse(text);
        jsonError = null;
      } catch (e: any) {
        if (isCurrentLogJsonContent(text)) {
          jsonError = null;
          return;
        }
        // If standard JSON fails, check if it's valid JSON5
        try {
          const result = await getJsonStats(text);
          if (content !== text) {
            return;
          }
          if (result.valid) {
            jsonError = null;  // Valid JSON5, no error
          } else {
            if (isCurrentLogJsonContent(text)) {
              jsonError = null;
              return;
            }
            jsonError = { message: e?.message || 'Invalid JSON' };
          }
        } catch {
          if (isCurrentLogJsonContent(text)) {
            jsonError = null;
            return;
          }
          jsonError = { message: e?.message || 'Invalid JSON' };
        }
      }
    }, 500);
  }

  function fixJson() {
    if (!content.trim() || isFixing) return;
    isFixing = true;
    try {
      const repaired = jsonrepair(content);
      const parsed = JSON.parse(repaired);
      const formatted = JSON.stringify(parsed, null, tabSize);
      content = formatted;
      monacoEditor?.setValue(formatted);
      const currentTab = $activeTab;
      if (currentTab) {
        tabsStore.updateTabContent(currentTab.id, formatted);
        if (currentTab.filePath && !currentTab.isModified) {
          tabsStore.updateTabModified(currentTab.id, true);
        }
      }
      jsonError = null;
      updateStats();
      showToast($t('fixJson.success'));
    } catch (e: any) {
      jsonError = { message: $t('fixJson.unrepairable') };
      showToast($t('fixJson.failed'), 'error');
    } finally {
      isFixing = false;
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
  <div class="flex flex-1 min-h-0" class:resizing-tree-view={isResizingTreeView}>
    <!-- Left section: Tab Bar + Editor -->
    <div class="flex flex-col flex-1 min-w-0">
      <!-- Tab Bar - show different tab bars based on mode -->
      {#if !isDiffMode && !isConvertMode && !isCodegenMode && !isSchemaMode && tabsState.tabs.length > 1}
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
            {#if jsonError}
              <div class="json-fix-bar">
                <div class="json-fix-bar-left">
                  <svg class="json-fix-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span class="json-fix-bar-msg">{jsonError.message}</span>
                </div>
                <div class="json-fix-bar-actions">
                  <button class="json-fix-btn" onclick={fixJson} disabled={isFixing}>
                    <svg class="json-fix-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    {$t('fixJson.fix')}
                  </button>
                  <button class="json-fix-dismiss" onclick={() => { jsonError = null; }} title={$t('fixJson.dismiss')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/if}
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
            {#if isLogJsonPanelOpen && logJsonFragments.length > 0}
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

    <!-- Right section: Tree View (spans full height below toolbar) -->
    {#if showTreeView && !isDiffMode && !isConvertMode && !isCodegenMode && !isSchemaMode}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
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
      content={content}
    />
  {/if}

  <!-- Settings panel -->
  <SettingsPanel bind:this={settingsPanel} />

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
  :global {
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  }

  .json-fix-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 12px;
    background: color-mix(in srgb, var(--error, #ef4444) 8%, var(--bg-secondary));
    border-bottom: 1px solid color-mix(in srgb, var(--error, #ef4444) 25%, var(--border));
    flex-shrink: 0;
    animation: fadeIn 0.2s ease;
  }

  .json-fix-bar-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .json-fix-bar-icon {
    width: 14px;
    height: 14px;
    color: var(--error, #ef4444);
    flex-shrink: 0;
  }

  .json-fix-bar-msg {
    font-size: 12px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .json-fix-bar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .json-fix-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 50%, var(--border));
    border-radius: 5px;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
    color: var(--accent);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .json-fix-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .json-fix-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .json-fix-btn-icon {
    width: 12px;
    height: 12px;
  }

  .json-fix-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }

  .json-fix-dismiss:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .json-fix-dismiss svg {
    width: 12px;
    height: 12px;
  }
</style>

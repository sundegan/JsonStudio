<script lang="ts">
  import { onMount } from 'svelte';
  import { getJsonStats, escapeString, unescapeString, type JsonStats } from '$lib/services/json';
  import { openFileDialog, saveFile, saveFileDialog, readFile, getFileName } from '$lib/services/file';
  import { fileStateStore } from '$lib/stores/file';
  import MonacoEditor from './MonacoEditor.svelte';
  import MonacoDiffEditor from './MonacoDiffEditor.svelte';
  import { type EditorTheme } from '$lib/config/monacoThemes';
  import { settingsStore } from '$lib/stores/settings';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';

  const LARGE_FILE_THRESHOLD = 1024 * 1024;

  let content = $state('');
  let stats = $state<JsonStats>({
    valid: false,
    key_count: 0,
    depth: 0,
    byte_size: 0,
    error_info: null,
  });
  let toastMsg = $state('');
  let isProcessing = $state(false);
  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  let pasteFormatTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let monacoEditor: MonacoEditor;
  let settingsPanel: SettingsPanel | null = null;
  let isDiffMode = $state(false);
  let diffOriginal = $state('');
  let diffModified = $state('');
  let diffLeftLabel = $state('Left');
  let diffRightLabel = $state('Editor');
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
  
  let fileState = $state<import('$lib/stores/file').FileState>({
    currentFilePath: null,
    currentFileName: null,
    isModified: false
  });
  
  let settings = $state<import('$lib/stores/settings').AppSettings>({
    isDarkMode: false,
    darkTheme: 'one-dark',
    lightTheme: 'vs',
    fontSize: 13,
    tabSize: 2,
  });
  
  onMount(() => {
    settingsStore.init();
    
    // Listen to clipboard formatting events
    let unlistenFormatted: (() => void) | null = null;
    let unlistenRaw: (() => void) | null = null;
    let unlistenFileDrop: (() => void) | null = null;
    
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      
      // Listen for successfully formatted JSON
      unlistenFormatted = await listen<string>('clipboard-formatted', (event) => {
        content = event.payload;
        monacoEditor?.setValue(event.payload);
        updateStats();
        showToast('Clipboard content formatted');
      });
      
      // Listen for raw paste (when JSON is invalid)
      unlistenRaw = await listen<string>('clipboard-pasted-raw', (event) => {
        content = event.payload;
        monacoEditor?.setValue(event.payload);
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
            
            content = fileContent;
            monacoEditor?.setValue(fileContent);
            
            fileStateStore.setCurrentFile(filePath, name);
            
            await updateStats();
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
      
      // Cmd/Ctrl + N: New file
      if (cmdOrCtrl && e.key === 'n') {
        e.preventDefault();
        handleNewFile();
      }
      
      // Cmd/Ctrl + O: Open file
      if (cmdOrCtrl && e.key === 'o') {
        e.preventDefault();
        handleOpenFile();
      }
      
      // Cmd/Ctrl + S: Save file
      if (cmdOrCtrl && e.key === 's') {
        e.preventDefault();
        handleSaveFile();
      }
      
      // Cmd/Ctrl + Shift + S: Save as
      if (cmdOrCtrl && e.shiftKey && e.key === 's') {
        e.preventDefault();
        handleSaveAsFile();
      }

      // Cmd/Ctrl + Shift + I: Open DevTools
      if (cmdOrCtrl && e.shiftKey && e.key === 'i') {
        e.preventDefault();
        openDevTools();
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    
    return () => {
      if (unlistenFormatted) unlistenFormatted();
      if (unlistenRaw) unlistenRaw();
      if (unlistenFileDrop) unlistenFileDrop();
      window.removeEventListener('keydown', handleKeydown);
    };
  });
  
  $effect(() => {
    const unsubscribe = settingsStore.subscribe(newSettings => {
      settings = newSettings;
    });
    return () => unsubscribe();
  });
  
  $effect(() => {
    const unsubscribe = fileStateStore.subscribe(newFileState => {
      fileState = newFileState;
    });
    return () => unsubscribe();
  });
  
  let isDarkMode = $derived(settings.isDarkMode);
  let fontSize = $derived(settings.fontSize);
  let tabSize = $derived(settings.tabSize);
  let monacoTheme = $derived<EditorTheme>(isDarkMode ? settings.darkTheme : settings.lightTheme);
  
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
    const leftValue = diffOriginal;
    if (diffLeftTimer) clearTimeout(diffLeftTimer);
    diffLeftTimer = setTimeout(() => {
      updateDiffStatsForSide('left');
    }, 200);
  });

  $effect(() => {
    if (!isDiffMode) return;
    const rightValue = diffModified;
    if (diffRightTimer) clearTimeout(diffRightTimer);
    diffRightTimer = setTimeout(() => {
      updateDiffStatsForSide('right');
    }, 200);
  });

  function toggleTheme() {
    settingsStore.updateSetting('isDarkMode', !isDarkMode);
  }

  function toggleDiffMode() {
    if (isDiffMode) {
      isDiffMode = false;
      return;
    }

    isDiffMode = true;
    diffLineCount = 0;
    diffOriginal = content;
    diffModified = '';
    diffLeftLabel = 'Editor';
    diffRightLabel = 'Right';
    diffLeftStats = {
      valid: false,
      key_count: 0,
      depth: 0,
      byte_size: 0,
      error_info: null,
    };
    diffRightStats = {
      valid: false,
      key_count: 0,
      depth: 0,
      byte_size: 0,
      error_info: null,
    };
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
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg = ''; }, 3000);
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
      const emptyStats = {
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
    content = newValue;
    
    // Mark as modified if we have a current file
    if (fileState.currentFilePath && !fileState.isModified) {
      fileStateStore.setModified(true);
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
      return;
    }
    statsTimer = setTimeout(updateStats, 300);
  }

  function handleEditorPaste() {
    if (pasteFormatTimer) clearTimeout(pasteFormatTimer);
    pasteFormatTimer = setTimeout(async () => {
      if (isProcessing || !content.trim()) {
        return;
      }
      await handleFormat();
    }, 100);
  }

  async function updateStats() {
    if (!content.trim()) return;
    try {
      stats = await getJsonStats(content);
    } catch (e) {}
  }

  async function handleFormat() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { formatJson } = await import('$lib/services/json');
        const formatted = await formatJson(content, tabSize);
        content = formatted;
        monacoEditor?.setValue(formatted);
      } else {
        // Use custom formatting with current tabSize setting
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, tabSize);
        content = formatted;
        monacoEditor?.setValue(formatted);
      }
      await updateStats();
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleMinify() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      let minified = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { minifyJson } = await import('$lib/services/json');
        minified = await minifyJson(content);
      } else {
        minified = monacoEditor?.minify() || '';
      }
      
      if (minified) {
        content = minified;
        monacoEditor?.setValue(minified);        
        await updateStats();
      }
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleEscape() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      let escaped = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
        escaped = await escapeString(content);
      } else {
        escaped = JSON.stringify(content);
      }
      
      content = escaped;
      monacoEditor?.setValue(escaped);
      await updateStats();
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleUnescape() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      let unescaped = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
        unescaped = await unescapeString(content);
      } else {
        const u = JSON.parse(content);
        if (typeof u === 'string') {
          unescaped = u;
        } else {
          throw new Error('Content is not a string');
        }
      }
      
      if (unescaped) {
        content = unescaped;
        monacoEditor?.setValue(unescaped);
        await updateStats();
      }
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleMinifyEscape() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      let minified = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { minifyJson } = await import('$lib/services/json');
        minified = await minifyJson(content);
      } else {
        minified = monacoEditor?.minify() || '';
      }
      
      if (minified) {
        const escaped = JSON.stringify(minified);
        content = escaped;
        monacoEditor?.setValue(escaped);
        await updateStats();
      }
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  function handleClear() {
    content = '';
    monacoEditor?.setValue('');
    stats = {
      valid: false,
      key_count: 0,
      depth: 0,
      byte_size: 0,
      error_info: null,
    };
  }

  async function handleCopy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      showToast('Copied');
    } catch (e) {}
  }

  function handleFoldAll() {
    monacoEditor?.foldAll();
  }

  function handleUnfoldAll() {
    monacoEditor?.unfoldAll();
  }

  async function handleOpenFile() {
    try {
      const result = await openFileDialog();
      if (result) {
        const [path, fileContent] = result;
        const name = await getFileName(path);
        
        content = fileContent;
        monacoEditor?.setValue(fileContent);
        
        fileStateStore.setCurrentFile(path, name);
        
        await updateStats();
        showToast(`Opened: ${name || 'file'}`);
      }
    } catch (e) {
      showToast('Failed to open file');
      console.error('Open file error:', e);
    }
  }

  async function handleSaveFile() {
    if (!content.trim()) {
      showToast('Nothing to save');
      return;
    }

    try {
      if (fileState.currentFilePath) {
        // Save to existing file
        await saveFile(fileState.currentFilePath, content);
        fileStateStore.setModified(false);
        showToast(`Saved: ${fileState.currentFileName || 'file'}`);
      } else {
        // No current file, use save as
        await handleSaveAsFile();
      }
    } catch (e) {
      showToast('Failed to save file');
      console.error('Save file error:', e);
    }
  }

  async function handleSaveAsFile() {
    if (!content.trim()) {
      showToast('Nothing to save');
      return;
    }

    try {
      const path = await saveFileDialog(content);
      if (path) {
        const name = await getFileName(path);
        fileStateStore.setCurrentFile(path, name);
        showToast(`Saved: ${name || 'file'}`);
      }
    } catch (e) {
      showToast('Failed to save file');
      console.error('Save as file error:', e);
    }
  }

  function handleNewFile() {
    content = '';
    monacoEditor?.setValue('');
    fileStateStore.setCurrentFile(null, null);
    stats = {
      valid: false,
      key_count: 0,
      depth: 0,
      byte_size: 0,
      error_info: null,
    };
    showToast('New file');
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Toolbar -->
  <div class="flex items-center gap-0.5 px-2 py-1.5 bg-(--bg-secondary) border-b border-(--border) shrink-0">
    <!-- File operations group -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleNewFile}
        disabled={isDiffMode}
        title="New File (Cmd+N)"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <path d="M14 2v6h6M12 18v-6M9 15h6"/>
        </svg>
      </button>
      
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleOpenFile}
        disabled={isDiffMode}
        title="Open File (Cmd+O)"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
        </svg>
      </button>
      
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleSaveFile}
        disabled={isDiffMode || !content.trim()}
        title="Save File (Cmd+S)"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
          <path d="M17 21v-8H7v8M7 3v5h8"/>
        </svg>
      </button>
    </div>

    <div class="w-px h-4 bg-(--border) mx-1.5"></div>

    <!-- Format operations group -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--accent)
               hover:bg-(--accent)/10
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleFormat}
        disabled={isDiffMode || isProcessing || !content.trim()}
        title="Format"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h10M4 18h14"/>
        </svg>
      </button>
      
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleMinify}
        disabled={isDiffMode || isProcessing || !content.trim()}
        title="Minify"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>
        </svg>
      </button>
    </div>

    <div class="w-px h-4 bg-(--border) mx-1.5"></div>

    <!-- Fold operations group -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleFoldAll}
        disabled={isDiffMode || isProcessing || !content.trim()}
        title="Fold All"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h16M4 18h16"/>
          <path d="M9 6v6l3-3-3-3"/>
        </svg>
      </button>
      
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleUnfoldAll}
        disabled={isDiffMode || isProcessing || !content.trim()}
        title="Unfold All"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h16M4 18h16"/>
          <path d="M9 6v6l3 3 3-3V6"/>
        </svg>
      </button>
    </div>

    <div class="w-px h-4 bg-(--border) mx-1.5"></div>

    <!-- Escape operations group -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleEscape}
        disabled={isDiffMode || isProcessing || !content.trim()}
        title="Escape"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M7 8l-4 4 4 4M17 8l4 4-4 4"/>
        </svg>
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleUnescape}
        disabled={isDiffMode || isProcessing || !content.trim()}
        title="Unescape"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 8l4 4-4 4M15 8l-4 4 4 4"/>
        </svg>
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleMinifyEscape}
        disabled={isDiffMode || isProcessing || !content.trim()}
        title="Minify + Escape"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M8 12h8"/>
        </svg>
      </button>
    </div>

    <div class="flex-1"></div>

    <!-- Right side operations group -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleCopy}
        disabled={isDiffMode || !content}
        title="Copy"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--error)/10 hover:text-(--error)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleClear}
        disabled={isDiffMode || !content}
        title="Clear"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
        </svg>
      </button>

      <div class="w-px h-4 bg-(--border) mx-1.5"></div>

      <!-- Diff toggle button -->
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               {isDiffMode ? 'text-(--accent) bg-(--accent)/10' : 'text-(--text-secondary)'}
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               transition-all duration-150"
        onclick={toggleDiffMode}
        title={isDiffMode ? 'Exit Diff' : 'Diff'}
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/>
          <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/>
          <path d="M12 4v16"/>
          <path d="M7 12h3M14 12h3"/>
        </svg>
      </button>

      <div class="w-px h-4 bg-(--border) mx-1.5"></div>

      <!-- Theme toggle button -->
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--warning)/10 hover:text-(--warning)
               active:scale-95
               transition-all duration-150"
        onclick={toggleTheme}
        title={isDarkMode ? 'Light Mode' : 'Dark Mode'}
      >
        {#if isDarkMode}
          <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
        {:else}
          <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
        {/if}
      </button>

      <!-- Settings button -->
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               transition-all duration-150"
        onclick={openSettings}
        title="Settings"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>
  </div>

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
    {/if}

    {#if toastMsg}
      <div 
        class="absolute top-6 right-6 flex items-center gap-2.5 rounded-lg text-sm font-medium z-50 animate-[fadeIn_0.2s_ease-out]"
        style="padding: 10px 16px; background-color: var(--bg-primary); border: 1px solid var(--border); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);"
      >
        <div class="flex items-center justify-center w-5 h-5 rounded-full" style="background-color: var(--success);">
          <svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <span class="text-(--text-primary)">{toastMsg}</span>
      </div>
    {/if}
  </div>

  <div class="flex items-center gap-2 bg-(--bg-secondary) border-t border-(--border) text-xs" style="padding: 2px 10px;">
    {#if isDiffMode}
      <span class="text-(--text-secondary)">
        {diffLeftStats.key_count} keys · {diffLeftStats.depth} levels · {formatBytes(diffLeftStats.byte_size)} · {diffOriginal ? diffOriginal.split('\n').length : 0} lines
      </span>
      <span class="flex-1 text-center text-(--text-secondary)">
        Diff {diffLineCount} lines
      </span>
      <span class="text-(--text-secondary)">
        {diffRightStats.key_count} keys · {diffRightStats.depth} levels · {formatBytes(diffRightStats.byte_size)} · {diffModified ? diffModified.split('\n').length : 0} lines
      </span>
    {:else}
      <!-- File info on the left -->
      {#if fileState.currentFileName}
        <span class="text-(--text-primary) font-medium">{fileState.currentFileName}</span>
        {#if fileState.isModified}
          <span class="text-(--warning)" title="Modified">●</span>
        {/if}
        <div class="w-px h-3 bg-(--border)"></div>
      {/if}
      
      {#if stats}
        <span class="text-(--text-secondary)">{stats.key_count} keys</span>
        <div class="w-px h-3 bg-(--border)"></div>
        <span class="text-(--text-secondary)">{stats.depth} levels</span>
        <div class="w-px h-3 bg-(--border)"></div>
        <span class="text-(--text-secondary)">{formatBytes(stats.byte_size)}</span>
      {/if}

      <div class="w-px h-3 bg-(--border)"></div>
      <span class="text-(--text-secondary)">{content ? content.split('\n').length : 0} lines</span>
      
      <span class="flex-1"></span>
    {/if}
  </div>

  <!-- Settings panel -->
  <SettingsPanel bind:this={settingsPanel} />
</div>

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>

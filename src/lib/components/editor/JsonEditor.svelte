<script lang="ts">
  import { onMount } from 'svelte';
  import { getJsonStats, type JsonStats } from '$lib/services/json';
  import { readFile, getFileName } from '$lib/services/file';
  import { fileStateStore } from '$lib/stores/file';
  import MonacoEditor from './MonacoEditor.svelte';
  import MonacoDiffEditor from './MonacoDiffEditor.svelte';
  import JsonEditorToolbar from './JsonEditorToolbar.svelte';
  import JsonEditorStatusBar from './JsonEditorStatusBar.svelte';
  import JsonQueryPanel from './JsonQueryPanel.svelte';
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

  function toggleTheme() {
    settingsStore.updateSetting('isDarkMode', !isDarkMode);
  }

  function toggleJsonQueryPanel() {
    isJsonQueryOpen = !isJsonQueryOpen;
  }

  function toggleDiffMode() {
    if (isDiffMode) {
      isDiffMode = false;
      return;
    }

    if (isJsonQueryOpen) {
      isJsonQueryOpen = false;
    }

    isDiffMode = true;
    diffLineCount = 0;
    diffOriginal = content;
    diffModified = '';
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
    try {
      stats = await getJsonStats(content);
    } catch (e) {}
  }

</script>

<div class="flex flex-col h-full overflow-hidden">
  <JsonEditorToolbar
    bind:this={toolbarRef}
    isDiffMode={isDiffMode}
    content={content}
    fileState={fileState}
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

      {#if isJsonQueryOpen}
        <JsonQueryPanel
          content={content}
          editor={monacoEditor}
          onClose={toggleJsonQueryPanel}
          on:toast={(event) => showToast(event.detail.message)}
        />
      {/if}
    {/if}

    {#if toastMsg}
      <JsonEditorToast message={toastMsg} on:close={() => { toastMsg = ''; }} />
    {/if}
  </div>

  <JsonEditorStatusBar
    isDiffMode={isDiffMode}
    diffLineCount={diffLineCount}
    diffLeftStats={diffLeftStats}
    diffRightStats={diffRightStats}
    diffOriginal={diffOriginal}
    diffModified={diffModified}
    fileState={fileState}
    stats={stats}
    content={content}
  />

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

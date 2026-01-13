<script lang="ts">
  import { escapeString, unescapeString } from '$lib/services/json';
  import { openFileDialog, saveFile as writeFile, saveFileDialog, getFileName } from '$lib/services/file';
  import { tabsStore, type Tab } from '$lib/stores/tabs';
  import type MonacoEditor from './MonacoEditor.svelte';

  const LARGE_FILE_THRESHOLD = 1024 * 1024;

  const {
    isDiffMode,
    content,
    activeTab,
    isDarkMode,
    isJsonQueryOpen,
    editor,
    tabSize,
    onToggleDiff,
    onToggleJsonQuery,
    onToggleTheme,
    onOpenSettings,
    onContentChange,
    onStatsUpdate,
    onStatsReset,
    onToast
  } = $props<{
    isDiffMode: boolean;
    content: string;
    activeTab: Tab | null;
    isDarkMode: boolean;
    isJsonQueryOpen: boolean;
    editor: MonacoEditor | null;
    tabSize: number;
    onToggleDiff: () => void;
    onToggleJsonQuery: () => void;
    onToggleTheme: () => void;
    onOpenSettings: () => void;
    onContentChange: (value: string) => void;
    onStatsUpdate: () => Promise<void> | void;
    onStatsReset: () => void;
    onToast: (message: string) => void;
  }>();

  let isProcessing = $state(false);
  let hasContent = $derived(Boolean(content.trim()));

  function setContentValue(value: string) {
    onContentChange(value);
    editor?.setValue(value);
  }

  export async function formatContent() {
    await handleFormat();
  }

  export async function openFile() {
    await handleOpenFile();
  }

  export async function saveFile() {
    await handleSaveFile();
  }

  export async function saveAsFile() {
    await handleSaveAsFile();
  }

  export function newFile() {
    handleNewFile();
  }

  async function handleFormat() {
    if (!content.trim()) return;
    if (isProcessing) return;
    isProcessing = true;
    const contentSize = content.length;

    try {
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { formatJson } = await import('$lib/services/json');
        const formatted = await formatJson(content, tabSize);
        setContentValue(formatted);
      } else {
        // Use custom formatting with current tabSize setting.
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, tabSize);
        setContentValue(formatted);
      }
      await onStatsUpdate();
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleMinify() {
    if (!content.trim()) return;
    if (isProcessing) return;
    isProcessing = true;
    const contentSize = content.length;

    try {
      let minified = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { minifyJson } = await import('$lib/services/json');
        minified = await minifyJson(content);
      } else {
        minified = editor?.minify() || '';
      }

      if (minified) {
        setContentValue(minified);
        await onStatsUpdate();
      }
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleEscape() {
    if (!content.trim()) return;
    if (isProcessing) return;
    isProcessing = true;
    const contentSize = content.length;

    try {
      let escaped = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
        escaped = await escapeString(content);
      } else {
        escaped = JSON.stringify(content);
      }

      setContentValue(escaped);
      await onStatsUpdate();
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleUnescape() {
    if (!content.trim()) return;
    if (isProcessing) return;
    isProcessing = true;
    const contentSize = content.length;

    try {
      let unescaped = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
        unescaped = await unescapeString(content);
      } else {
        const parsed = JSON.parse(content);
        if (typeof parsed === 'string') {
          unescaped = parsed;
        } else {
          throw new Error('Content is not a string');
        }
      }

      if (unescaped) {
        setContentValue(unescaped);
        await onStatsUpdate();
      }
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleMinifyEscape() {
    if (!content.trim()) return;
    if (isProcessing) return;
    isProcessing = true;
    const contentSize = content.length;

    try {
      let minified = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { minifyJson } = await import('$lib/services/json');
        minified = await minifyJson(content);
      } else {
        minified = editor?.minify() || '';
      }

      if (minified) {
        const escaped = JSON.stringify(minified);
        setContentValue(escaped);
        await onStatsUpdate();
      }
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  function handleClear() {
    setContentValue('');
    onStatsReset();
  }

  async function handleCopy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      onToast('Copied');
    } catch (e) {}
  }

  function handleFoldAll() {
    editor?.foldAll();
  }

  function handleUnfoldAll() {
    editor?.unfoldAll();
  }

  async function handleOpenFile() {
    try {
      const result = await openFileDialog();
      if (result) {
        const [path, fileContent] = result;
        const name = await getFileName(path);

        // Always create a new tab for the file
        tabsStore.addTab(fileContent, path, name);

        await onStatsUpdate();
        onToast(`Opened: ${name || 'file'}`);
      }
    } catch (e) {
      onToast('Failed to open file');
      console.error('Open file error:', e);
    }
  }

  async function handleSaveFile() {
    if (!content.trim()) {
      onToast('Nothing to save');
      return;
    }

    if (!activeTab) {
      onToast('No active tab');
      return;
    }

    try {
      if (activeTab.filePath) {
        // Save to existing file.
        await writeFile(activeTab.filePath, content);
        tabsStore.updateTabModified(activeTab.id, false);
        onToast(`Saved: ${activeTab.fileName || 'file'}`);
      } else {
        // No current file, use save as.
        await handleSaveAsFile();
      }
    } catch (e) {
      onToast('Failed to save file');
      console.error('Save file error:', e);
    }
  }

  async function handleSaveAsFile() {
    if (!content.trim()) {
      onToast('Nothing to save');
      return;
    }

    if (!activeTab) {
      onToast('No active tab');
      return;
    }

    try {
      const path = await saveFileDialog(content);
      if (path) {
        const name = await getFileName(path);
        tabsStore.updateTabFile(activeTab.id, path, name);
        onToast(`Saved: ${name || 'file'}`);
      }
    } catch (e) {
      onToast('Failed to save file');
      console.error('Save as file error:', e);
    }
  }

  function handleNewFile() {
    tabsStore.addTab();
    onToast('New tab created');
  }
</script>

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
      <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <path d="M12 11v6M9 14h6"/>
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
      disabled={isDiffMode || !hasContent}
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
      disabled={isDiffMode || isProcessing || !hasContent}
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
      disabled={isDiffMode || isProcessing || !hasContent}
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
      disabled={isDiffMode || isProcessing || !hasContent}
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
      disabled={isDiffMode || isProcessing || !hasContent}
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
      disabled={isDiffMode || isProcessing || !hasContent}
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
      disabled={isDiffMode || isProcessing || !hasContent}
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
      disabled={isDiffMode || isProcessing || !hasContent}
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
      disabled={isDiffMode || !hasContent}
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
      disabled={isDiffMode || !hasContent}
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
      onclick={onToggleDiff}
      title={isDiffMode ? 'Exit Diff' : 'Diff'}
    >
      <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/>
        <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/>
        <path d="M12 4v16"/>
        <path d="M7 12h3M14 12h3"/>
      </svg>
    </button>

    <!-- JSON Query toggle button -->
    <button
      class="w-8 h-8 flex items-center justify-center rounded-md
             {isJsonQueryOpen ? 'text-(--accent) bg-(--accent)/10' : 'text-(--text-secondary)'}
             hover:bg-(--bg-tertiary) hover:text-(--text-primary)
             active:scale-95
             disabled:opacity-30 disabled:cursor-not-allowed
             transition-all duration-150"
      onclick={onToggleJsonQuery}
      disabled={isDiffMode}
      title="JSON Query"
    >
      <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
        <path d="M11 8v6M8 11h6"/>
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
      onclick={onToggleTheme}
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
      onclick={onOpenSettings}
      title="Settings"
    >
      <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
  </div>
</div>

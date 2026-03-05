<script lang="ts">
  import { escapeString, unescapeString } from '$lib/services/json';
  import { openFileDialog, saveFile as writeFile, saveFileDialog, getFileName } from '$lib/services/file';
  import { exportJsonAsImage, copyImageToClipboard } from '$lib/services/exportImage';
  import { tabsStore, type Tab } from '$lib/stores/tabs';
  import { shortcutsStore, formatShortcutKey, type ShortcutsSettings } from '$lib/stores/shortcuts';
  import { settingsStore } from '$lib/stores/settings';
  import { t } from '$lib/i18n';
  import type { EditorTheme } from '$lib/config/monacoThemes';
  import type MonacoEditor from './MonacoEditor.svelte';

  let shortcuts = $state<ShortcutsSettings | null>(null);

  $effect(() => {
    const unsubscribe = shortcutsStore.subscribe(s => { shortcuts = s; });
    return () => unsubscribe();
  });

  function shortcutLabel(key: keyof ShortcutsSettings): string {
    if (!shortcuts) return '';
    return formatShortcutKey(shortcuts[key].currentKey);
  }

  const LARGE_FILE_THRESHOLD = 1024 * 1024;

  const {
    isDiffMode,
    isConvertMode,
    isCodegenMode,
    isSchemaMode,
    content,
    activeTab,
    isDarkMode,
    isAlwaysOnTop,
    editor,
    tabSize,
    onToggleDiff,
    onToggleConvert,
    onToggleCodegen,
    onToggleSchema,
    onToggleTheme,
    onToggleAlwaysOnTop,
    onOpenSettings,
    onContentChange,
    onStatsUpdate,
    onToast
  } = $props<{
    isDiffMode: boolean;
    isConvertMode: boolean;
    isCodegenMode: boolean;
    isSchemaMode: boolean;
    content: string;
    activeTab: Tab | null;
    isDarkMode: boolean;
    isAlwaysOnTop: boolean;
    editor: MonacoEditor | null;
    tabSize: number;
    onToggleDiff: () => void;
    onToggleConvert: () => void;
    onToggleCodegen: () => void;
    onToggleSchema: () => void;
    onToggleTheme: () => void;
    onToggleAlwaysOnTop: () => void;
    onOpenSettings: () => void;
    onContentChange: (value: string) => void;
    onStatsUpdate: () => Promise<void> | void;
    onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  }>();

  let isProcessing = $state(false);
  let isExporting = $state(false);
  let hasContent = $derived(Boolean(content.trim()));

  let appSettings = $state<import('$lib/stores/settings').AppSettings>({
    isDarkMode: false, darkTheme: 'one-dark', lightTheme: 'vs',
    language: 'zh', fontSize: 13, lineHeight: 20, tabSize: 2, showTreeView: true,
  });

  $effect(() => {
    const unsub = settingsStore.subscribe(s => { appSettings = s; });
    return () => unsub();
  });

  async function handleExportImage() {
    if (!hasContent || isExporting) return;
    isExporting = true;
    try {
      const currentTheme: EditorTheme = appSettings.isDarkMode
        ? appSettings.darkTheme
        : appSettings.lightTheme;
      const pngBase64 = await exportJsonAsImage({
        content,
        theme: currentTheme,
        fontSize: appSettings.fontSize,
        lineHeight: appSettings.lineHeight,
      });
      await copyImageToClipboard(pngBase64);
      onToast($t('toolbar.exportImageCopied'));
    } catch (e: any) {
      console.error('Export image failed:', e);
      onToast($t('toolbar.exportImageFailed'), 'error');
    } finally {
      isExporting = false;
    }
  }

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

  export async function minifyContent() {
    await handleMinify();
  }

  export async function escapeContent() {
    await handleEscape();
  }

  export async function unescapeContent() {
    await handleUnescape();
  }

  export async function minifyEscapeContent() {
    await handleMinifyEscape();
  }

  export function foldAllContent() {
    handleFoldAll();
  }

  export function unfoldAllContent() {
    handleUnfoldAll();
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
      onToast('Failed to open file', 'error');
      console.error('Open file error:', e);
    }
  }

  async function handleSaveFile() {
    if (!content.trim()) {
      onToast('Nothing to save', 'info');
      return;
    }

    if (!activeTab) {
      onToast('No active tab', 'info');
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
      onToast('Failed to save file', 'error');
      console.error('Save file error:', e);
    }
  }

  async function handleSaveAsFile() {
    if (!content.trim()) {
      onToast('Nothing to save', 'info');
      return;
    }

    if (!activeTab) {
      onToast('No active tab', 'info');
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
      onToast('Failed to save file', 'error');
      console.error('Save as file error:', e);
    }
  }

  function handleNewFile() {
    tabsStore.addTab();
    onToast('New tab created');
  }
</script>

<div class="je-toolbar">
  {#if isDiffMode}
    <!-- Diff mode: only show exit button -->
    <div class="toolbar-group">
      <button class="toolbar-back-btn" onclick={onToggleDiff} title={$t('toolbar.exitDiff')}>
        <svg class="toolbar-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5"/>
          <path d="M12 19l-7-7 7-7"/>
        </svg>
      </button>
    </div>
  {:else}
    <!-- 1. File operations -->
    <div class="toolbar-group">
      <button class="toolbar-btn" onclick={handleNewFile} title="{$t('toolbar.new')} ({shortcutLabel('newFile')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 11v6M9 14h6"/></svg>
        {$t('toolbar.new')}
      </button>
      <button class="toolbar-btn" onclick={handleOpenFile} title="{$t('toolbar.open')} ({shortcutLabel('openFile')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        {$t('toolbar.open')}
      </button>
      <button class="toolbar-btn" onclick={handleExportImage} disabled={!hasContent || isExporting} title={$t('toolbar.exportImage')}>
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        {$t('toolbar.exportImage')}
      </button>
    </div>

    <div class="toolbar-divider"></div>

    <!-- 2. JSON transform -->
    <div class="toolbar-group">
      <button class="toolbar-btn is-primary" onclick={handleFormat} disabled={isProcessing || !hasContent} title="{$t('toolbar.format')} ({shortcutLabel('format')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 4c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3"/>
          <path d="M15 4c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3"/>
        </svg>
        {$t('toolbar.format')}
      </button>
      <button class="toolbar-btn" onclick={handleMinify} disabled={isProcessing || !hasContent} title="{$t('toolbar.minify')} ({shortcutLabel('minify')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M9 4l3 2 3-2"/><path d="M4 10h16M4 14h16"/><path d="M12 22v-4M9 20l3-2 3 2"/></svg>
        {$t('toolbar.minify')}
      </button>
      <button class="toolbar-btn" onclick={handleEscape} disabled={isProcessing || !hasContent} title="{$t('toolbar.escape')} ({shortcutLabel('escape')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
        {$t('toolbar.escape')}
      </button>
      <button class="toolbar-btn" onclick={handleUnescape} disabled={isProcessing || !hasContent} title="{$t('toolbar.unescape')} ({shortcutLabel('unescape')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2"/><path d="M9 12h6"/></svg>
        {$t('toolbar.unescape')}
      </button>
      <button class="toolbar-btn" onclick={handleMinifyEscape} disabled={isProcessing || !hasContent} title="{$t('toolbar.minifyEscape')} ({shortcutLabel('minifyEscape')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/></svg>
        {$t('toolbar.minifyEscape')}
      </button>
      <button class="toolbar-btn" onclick={handleFoldAll} disabled={isProcessing || !hasContent} title="{$t('toolbar.foldAll')} ({shortcutLabel('foldAll')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l5 4 5-4"/><path d="M7 20l5-4 5 4"/></svg>
        {$t('toolbar.foldAll')}
      </button>
      <button class="toolbar-btn" onclick={handleUnfoldAll} disabled={isProcessing || !hasContent} title="{$t('toolbar.unfoldAll')} ({shortcutLabel('unfoldAll')})">
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8l5-4 5 4"/><path d="M7 16l5 4 5-4"/></svg>
        {$t('toolbar.unfoldAll')}
      </button>
    </div>

    <div class="toolbar-divider"></div>

    <!-- 3. Diff, Convert & Codegen -->
    <div class="toolbar-group">
      <button class="toolbar-btn" onclick={onToggleDiff} disabled={isConvertMode || isCodegenMode || isSchemaMode} title={$t('toolbar.diff')}>
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 4v16"/></svg>
        {$t('toolbar.diff')}
      </button>
      <button class="toolbar-btn {isConvertMode ? 'is-active' : ''}" onclick={onToggleConvert} disabled={!hasContent || isCodegenMode || isSchemaMode} title={isConvertMode ? $t('toolbar.exitConvert') : $t('toolbar.convert')}>
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 4 20 7 17 10"/><path d="M4 12v-1a3 3 0 0 1 3-3h13"/><polyline points="7 20 4 17 7 14"/><path d="M20 12v1a3 3 0 0 1-3 3H4"/></svg>
        {isConvertMode ? $t('toolbar.exitConvert') : $t('toolbar.convert')}
      </button>
      <button class="toolbar-btn {isCodegenMode ? 'is-active' : ''}" onclick={onToggleCodegen} disabled={!hasContent || isConvertMode || isSchemaMode} title={isCodegenMode ? $t('toolbar.exitCodegen') : $t('toolbar.codegen')}>
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 6 1 12 7 18"/><polyline points="17 6 23 12 17 18"/><line x1="14" y1="4" x2="10" y2="20"/></svg>
        {isCodegenMode ? $t('toolbar.exitCodegen') : $t('toolbar.codegen')}
      </button>
      <button class="toolbar-btn {isSchemaMode ? 'is-active' : ''}" onclick={onToggleSchema} disabled={!hasContent || isConvertMode || isCodegenMode} title={isSchemaMode ? $t('toolbar.exitSchema') : $t('toolbar.schema')}>
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3l9 4.5v5c0 4.7-3.8 9-9 10.5C6.8 21.5 3 17.2 3 12.5v-5L12 3z"/>
          <path d="M9 12l2 2 4-4"/>
        </svg>
        {isSchemaMode ? $t('toolbar.exitSchema') : $t('toolbar.schema')}
      </button>
    </div>
  {/if}

  <div class="flex-1"></div>

  <!-- 4. App controls (icon-only) -->
  <div class="toolbar-group">
    <button
      class="toolbar-icon-btn"
      onclick={onToggleTheme}
      title={isDarkMode ? $t('toolbar.lightMode') : $t('toolbar.darkMode')}
    >
      {#if isDarkMode}
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"/>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      {:else}
        <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      {/if}
    </button>
    <button
      class="toolbar-icon-btn"
      onclick={onOpenSettings}
      title={$t('toolbar.settings')}
    >
      <svg class="toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
    <button
      class="toolbar-icon-btn {isAlwaysOnTop ? 'is-active' : ''}"
      onclick={onToggleAlwaysOnTop}
      title={isAlwaysOnTop ? $t('toolbar.unpinFromTop') : $t('toolbar.pinToTop')}
    >
      <svg class="toolbar-icon" viewBox="0 0 24 24" fill={isAlwaysOnTop ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/>
      </svg>
    </button>
  </div>
</div>

<style>
  .je-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-primary);
    padding: 3px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .toolbar-divider {
    width: 1px;
    height: 16px;
    background: var(--border);
    margin: 0 4px;
  }

  .toolbar-btn {
    height: 28px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .toolbar-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toolbar-btn:active:not(:disabled) {
    transform: translateY(1px);
  }

  .toolbar-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .toolbar-btn.is-primary {
    color: var(--accent);
  }

  .toolbar-btn.is-primary:hover:not(:disabled) {
    background: var(--accent-glow);
  }

  .toolbar-btn.is-active {
    color: var(--accent);
    background: var(--accent-glow);
  }

  .toolbar-icon-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .toolbar-icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toolbar-icon-btn:active {
    transform: translateY(1px);
  }

  .toolbar-icon-btn.is-active {
    color: var(--accent);
    background: var(--accent-glow);
  }

  .toolbar-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .toolbar-back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toolbar-back-btn:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg-primary);
  }

  .toolbar-back-icon {
    width: 16px;
    height: 16px;
  }
</style>

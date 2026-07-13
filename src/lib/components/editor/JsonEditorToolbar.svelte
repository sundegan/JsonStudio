<script lang="ts">
  import { onMount } from 'svelte';
  import { escapeString, minifyJson, unescapeString } from '$lib/services/json';
  import { sortJsonKeys } from '$lib/services/jsonKeySort.js';
  import { convertToStandardJson } from '$lib/services/jsonToStandard.js';
  import { openFileDialog, saveFile as writeFile, saveFileDialog, saveBinaryFileDialog, getFileName } from '$lib/services/file';
  import { exportJsonAsImage, pngBase64ToBytes } from '$lib/services/exportImage';
  import { tabsStore, type Tab } from '$lib/stores/tabs';
  import { getDocumentContent } from '$lib/stores/documentStore';
  import { shortcutsStore, formatShortcutKey, type ShortcutsSettings } from '$lib/stores/shortcuts';
  import { settingsStore } from '$lib/stores/settings';
  import { getSaveFileName } from '$lib/stores/untitledTabs.js';
  import { normalizeOpenedJson } from '$lib/services/openJsonNormalize.js';
  import {
    detectJsonDialectAsync,
    getJsonDocumentStatsAsync,
  } from '$lib/services/jsonTreeModelCache.js';
  import { t } from '$lib/i18n';
  import type { EditorTheme } from '$lib/config/monacoThemes';
  import type { Window as TauriWindow } from '@tauri-apps/api/window';
  import type MonacoEditor from './MonacoEditor.svelte';
  import { folderStore } from '$lib/stores/folder';
  import {
    getOppositeKeyNamingFromString,
    tryConvertJsonStringPreservingFormat,
  } from '$lib/services/jsonKeyNaming';

  type TitlebarPlatform = 'macos' | 'windows' | 'linux';

  let shortcuts = $state<ShortcutsSettings | null>(null);
  let appWindow = $state<TauriWindow | null>(null);
  let platform = $state<TitlebarPlatform>('macos');
  let isWindowFullscreen = $state(false);
  let isWindowExpanded = $state(false);

  $effect(() => {
    const unsubscribe = shortcutsStore.subscribe(s => { shortcuts = s; });
    return () => unsubscribe();
  });

  function shortcutLabel(key: keyof ShortcutsSettings): string {
    if (!shortcuts) return '';
    return formatShortcutKey(shortcuts[key].currentKey);
  }

  async function detectPlatform(): Promise<TitlebarPlatform> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const desktopPlatform = await invoke<string>('desktop_platform');
      if (desktopPlatform === 'macos') return 'macos';
      if (desktopPlatform === 'windows') return 'windows';
      if (desktopPlatform === 'linux') return 'linux';
      console.warn('Unknown desktop platform:', desktopPlatform);
    } catch (error) {
      console.warn('Failed to detect desktop platform:', error);
    }
    return 'macos';
  }

  async function updateWindowState() {
    if (!appWindow) return;
    const fullscreen = await appWindow.isFullscreen();
    const maximized = platform === 'macos' ? false : await appWindow.isMaximized();
    applyWindowState(fullscreen, maximized);
  }

  function applyWindowState(fullscreen: boolean, maximized: boolean) {
    isWindowFullscreen = fullscreen;
    isWindowExpanded = fullscreen || maximized;
    window.dispatchEvent(new CustomEvent('jsonstudio-window-expanded-change', {
      detail: { expanded: isWindowExpanded },
    }));
  }

  function shouldStartWindowDrag(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;

    if (target.closest('.toolbar-drag-spacer')) return true;

    const interactiveTarget = target.closest([
      'button',
      'a',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '.toolbar-open-dropdown',
      '.toolbar-file-actions-dropdown'
    ].join(','));

    if (interactiveTarget) return false;

    return Boolean(target.closest([
      '.je-toolbar',
      '.toolbar-actions-strip',
      '.toolbar-group',
      '.toolbar-divider',
      '.toolbar-open-wrap',
      '.toolbar-file-actions-wrap',
      '.window-controls'
    ].join(',')));
  }

  async function handleTitlebarMouseDown(event: MouseEvent) {
    const canDragTarget = shouldStartWindowDrag(event.target);

    if (!appWindow || event.button !== 0 || !canDragTarget) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.detail === 2) {
      await togglePrimaryWindowExpansion();
      return;
    }

    await appWindow.startDragging();
  }

  const closeWindow = () => appWindow?.close();
  const minimizeWindow = () => appWindow?.minimize();

  async function toggleMaximizeWindow() {
    if (!appWindow) return;
    await appWindow.toggleMaximize();
    await updateWindowState();
  }

  async function toggleFullscreenWindow() {
    if (!appWindow) return;
    const nextFullscreen = !(await appWindow.isFullscreen());
    await appWindow.setFullscreen(nextFullscreen);
    if (nextFullscreen) {
      applyWindowState(true, false);
      return;
    }
    applyWindowState(false, platform === 'macos' ? false : await appWindow.isMaximized());
  }

  async function togglePrimaryWindowExpansion() {
    if (platform === 'macos') {
      await toggleFullscreenWindow();
      return;
    }
    await toggleMaximizeWindow();
  }

  onMount(() => {
    const windowStateUnlisteners: Array<() => void> = [];
    let disposed = false;
    const addWindowStateUnlistener = (unlisten: () => void) => {
      if (disposed) {
        unlisten();
        return;
      }
      windowStateUnlisteners.push(unlisten);
    };
    const syncWindowState = () => {
      void updateWindowState();
    };
    const handleDocumentVisibilityChange = () => {
      if (!document.hidden) syncWindowState();
    };

    void (async () => {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (!isTauri()) return;

      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      appWindow = getCurrentWindow();
      platform = await detectPlatform();
      await updateWindowState();

      const unlistenFocus = await appWindow.onFocusChanged(({ payload: focused }) => {
        if (focused) syncWindowState();
      });
      addWindowStateUnlistener(unlistenFocus);
    })();

    window.addEventListener('focus', syncWindowState);
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener('focus', syncWindowState);
      document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);
      for (const unlisten of windowStateUnlisteners) unlisten();
    };
  });

  const LARGE_FILE_THRESHOLD = 1024 * 1024;

  function getExportImageFileName(fileName: string | null | undefined) {
    const name = fileName?.trim();
    if (!name) return 'json-export.png';
    return `${name.replace(/\.[^.]+$/, '') || 'json-export'}.png`;
  }

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
  let showOpenMenu = $state(false);
  let showFileActionsMenu = $state(false);
  let openMenuEl = $state<HTMLDivElement | null>(null);
  let fileActionsMenuEl = $state<HTMLDivElement | null>(null);
  let dropdownTop = $state(0);
  let dropdownLeft = $state(0);
  let fileActionsDropdownTop = $state(0);
  let fileActionsDropdownLeft = $state(0);
  let showTransformMoreMenu = $state(false);
  let isFolded = $state(false);
  let transformMoreMenuEl = $state<HTMLDivElement | null>(null);
  let transformMoreDropdownTop = $state(0);
  let transformMoreDropdownLeft = $state(0);
  type KeySortState = 'none' | 'asc' | 'desc';
  let keySortState = $state<KeySortState>('none');
  let keySortOriginalContent: string | null = null;
  let lastSortedContent: string | null = null;

  // 自定义 Tooltip 提示状态与 Action
  let tooltipText = $state('');
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  function tooltip(node: HTMLElement, text: string) {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function handleEnter() {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        const rect = node.getBoundingClientRect();
        tooltipText = text;
        tooltipX = rect.left + rect.width / 2;
        tooltipY = rect.bottom + 6;
      }, 150); // 150ms 延迟，比原生 title 明显快捷，又防误触
    }

    function handleLeave() {
      if (timeout) clearTimeout(timeout);
      tooltipText = '';
    }

    node.addEventListener('mouseenter', handleEnter);
    node.addEventListener('mouseleave', handleLeave);
    node.addEventListener('click', handleLeave);
    node.addEventListener('focus', handleEnter);
    node.addEventListener('blur', handleLeave);

    return {
      update(newText: string) {
        if (tooltipText === text) {
          tooltipText = newText;
        }
        text = newText;
      },
      destroy() {
        if (timeout) clearTimeout(timeout);
        node.removeEventListener('mouseenter', handleEnter);
        node.removeEventListener('mouseleave', handleLeave);
        node.removeEventListener('click', handleLeave);
        node.removeEventListener('focus', handleEnter);
        node.removeEventListener('blur', handleLeave);
        if (tooltipText === text) {
          tooltipText = '';
        }
      }
    };
  }

  $effect(() => {
    if (keySortState !== 'none' && content !== lastSortedContent) {
      keySortState = 'none';
      keySortOriginalContent = null;
      lastSortedContent = null;
    }
  });

  function checkIsFolded(): boolean {
    const rawEditor = editor?.getEditorInstance();
    if (!rawEditor) return false;
    const viewState = rawEditor.saveViewState();
    const collapsedRegions = viewState?.contributionsState?.['editor.contrib.folding']?.collapsedRegions;
    return Array.isArray(collapsedRegions) && collapsedRegions.length > 0;
  }

  $effect(() => {
    if (!editor) return;
    const raw = editor.getEditorInstance();
    if (!raw) return;

    // Update initial state
    isFolded = checkIsFolded();

    // Listen to events that may change folding
    const disposable1 = raw.onDidScrollChange(() => {
      isFolded = checkIsFolded();
    });
    const disposable2 = raw.onDidChangeModelContent(() => {
      isFolded = checkIsFolded();
    });
    const disposable3 = raw.onMouseDown(() => {
      setTimeout(() => {
        isFolded = checkIsFolded();
      }, 50);
    });
    const disposable4 = raw.onKeyDown(() => {
      setTimeout(() => {
        isFolded = checkIsFolded();
      }, 50);
    });

    return () => {
      disposable1.dispose();
      disposable2.dispose();
      disposable3.dispose();
      disposable4.dispose();
    };
  });

  function handleWindowClick(e: MouseEvent) {
    if (showOpenMenu && openMenuEl && !openMenuEl.contains(e.target as Node)) {
      showOpenMenu = false;
    }
    if (showFileActionsMenu && fileActionsMenuEl && !fileActionsMenuEl.contains(e.target as Node)) {
      showFileActionsMenu = false;
    }
    if (showTransformMoreMenu && transformMoreMenuEl && !transformMoreMenuEl.contains(e.target as Node)) {
      showTransformMoreMenu = false;
    }
  }

  function toggleOpenMenu() {
    if (!showOpenMenu && openMenuEl) {
      const rect = openMenuEl.getBoundingClientRect();
      dropdownTop = rect.bottom + 5;
      dropdownLeft = rect.left;
    }
    showOpenMenu = !showOpenMenu;
    showFileActionsMenu = false;
    showTransformMoreMenu = false;
  }

  function toggleFileActionsMenu() {
    if (!showFileActionsMenu && fileActionsMenuEl) {
      const rect = fileActionsMenuEl.getBoundingClientRect();
      fileActionsDropdownTop = rect.bottom + 5;
      fileActionsDropdownLeft = rect.left;
    }
    showFileActionsMenu = !showFileActionsMenu;
    showOpenMenu = false;
    showTransformMoreMenu = false;
  }

  function toggleTransformMoreMenu() {
    if (!showTransformMoreMenu && transformMoreMenuEl) {
      const rect = transformMoreMenuEl.getBoundingClientRect();
      transformMoreDropdownTop = rect.bottom + 5;
      transformMoreDropdownLeft = rect.left;
    }
    showTransformMoreMenu = !showTransformMoreMenu;
    showOpenMenu = false;
    showFileActionsMenu = false;
  }

  async function handleToggleKeySortFromMenu() {
    showTransformMoreMenu = false;
    await handleToggleKeySort();
  }

  async function handleConvertToStandardJsonFromMenu() {
    showTransformMoreMenu = false;
    await handleConvertToStandardJson();
  }

  async function handleConvertKeyNamingFromMenu() {
    showTransformMoreMenu = false;
    await handleConvertKeyNaming();
  }

  async function handleOpenFolder() {
    showOpenMenu = false;
    await folderStore.openFolder();
  }

  function handleOpenFileFromMenu() {
    showOpenMenu = false;
    handleOpenFile();
  }

  async function handleExportImageFromMenu() {
    showFileActionsMenu = false;
    await handleExportImage();
  }

  let appSettings = $state<import('$lib/stores/settings').AppSettings>({
    isDarkMode: false, darkTheme: 'one-dark', lightTheme: 'vs',
    language: 'zh', fontSize: 13, lineHeight: 20, tabSize: 2, showTreeView: true, showFolderView: true, autoSave: false,
  });

  $effect(() => {
    const unsub = settingsStore.subscribe(s => { appSettings = s; });
    return () => unsub();
  });

  async function handleExportImage() {
    if (isExporting) return;
    if (!hasContent) {
      onToast($t('toolbar.noContentExport'), 'info');
      return;
    }
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
      const pngBytes = pngBase64ToBytes(pngBase64);
      const fileName = getExportImageFileName(activeTab?.fileName);
      const savedPath = await saveBinaryFileDialog(pngBytes, fileName, 'png');
      if (savedPath) {
        onToast($t('toolbar.exportImageSaved'));
      }
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

  export async function saveFile(isAutoSave = false) {
    await handleSaveFile(isAutoSave);
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
    if (isProcessing) return;
    if (!hasContent) {
      onToast($t('toolbar.noContentFormat'), 'info');
      return;
    }
    isProcessing = true;

    try {
      const { formatJson5, formatJsonText } = await import('$lib/services/json5Format.js');
      const stats = await getJsonDocumentStatsAsync(activeTab?.id ?? 'toolbar', content);
      const formatted = stats.valid && stats.format_type === 'JSON5'
        ? await formatJson5(content, tabSize)
        : await formatJsonText(content, tabSize);
      setContentValue(formatted);
      await onStatsUpdate();
    } catch (e) {
    } finally {
      isProcessing = false;
    }
  }

  async function handleMinify() {
    if (isProcessing) return;
    if (!hasContent) {
      onToast($t('toolbar.noContentMinify'), 'info');
      return;
    }
    isProcessing = true;
    const contentSize = content.length;

    try {
      let minified = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
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

  async function handleConvertToStandardJson() {
    if (isProcessing) return;
    if (!hasContent) {
      onToast($t('toolbar.noContentConvertToStandard'), 'info');
      return;
    }

    isProcessing = true;
    try {
      setContentValue(convertToStandardJson(content, tabSize));
      await onStatsUpdate();
      onToast($t('toolbar.convertToStandardSuccess'));
    } catch (error) {
      console.error('Convert to standard JSON failed:', error);
      onToast($t('toolbar.convertToStandardFailed'), 'error');
    } finally {
      isProcessing = false;
    }
  }

  async function handleConvertKeyNaming() {
    if (isProcessing) return;
    if (!hasContent) {
      onToast($t('toolbar.noContentKeyNaming'), 'info');
      return;
    }

    isProcessing = true;
    try {
      const target = getOppositeKeyNamingFromString(content);
      const converted = tryConvertJsonStringPreservingFormat(content, target);
      if (converted === null) {
        throw new Error('Invalid JSON');
      }

      setContentValue(converted);
      await onStatsUpdate();
      onToast(
        target === 'snake'
          ? $t('toolbar.keyNamingSnakeSuccess')
          : $t('toolbar.keyNamingCamelSuccess'),
      );
    } catch (error) {
      console.error('Convert JSON key naming failed:', error);
      onToast($t('toolbar.keyNamingFailed'), 'error');
    } finally {
      isProcessing = false;
    }
  }

  async function handleEscape() {
    if (isProcessing) return;
    if (!hasContent) {
      onToast($t('toolbar.noContentEscape'), 'info');
      return;
    }
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
    if (isProcessing) return;
    if (!hasContent) {
      onToast($t('toolbar.noContentUnescape'), 'info');
      return;
    }
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
    if (isProcessing) return;
    if (!hasContent) {
      onToast($t('toolbar.noContentProcess'), 'info');
      return;
    }
    isProcessing = true;
    const contentSize = content.length;

    try {
      let minified = '';
      if (contentSize > LARGE_FILE_THRESHOLD) {
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
    if (!hasContent) {
      onToast($t('toolbar.noContentFold'), 'info');
      return;
    }
    editor?.foldAll();
    isFolded = true;
  }

  function handleUnfoldAll() {
    if (!hasContent) {
      onToast($t('toolbar.noContentUnfold'), 'info');
      return;
    }
    editor?.unfoldAll();
    isFolded = false;
  }

  function handleToggleFold() {
    if (isFolded) {
      handleUnfoldAll();
    } else {
      handleFoldAll();
    }
  }

  async function handleToggleKeySort() {
    if (isProcessing) return;
    if (keySortState === 'desc') {
      const originalContent = keySortOriginalContent;
      keySortState = 'none';
      keySortOriginalContent = null;
      lastSortedContent = null;
      if (originalContent !== null) {
        setContentValue(originalContent);
        await onStatsUpdate();
      }
      return;
    }
    if (!hasContent) {
      onToast($t('toolbar.noContentSort'), 'info');
      return;
    }

    isProcessing = true;
    try {
      const nextState: KeySortState = keySortState === 'none' ? 'asc' : 'desc';
      const source = keySortOriginalContent ?? content;
      const sorted = sortJsonKeys(source, nextState, tabSize);
      if (keySortState === 'none') keySortOriginalContent = content;
      keySortState = nextState;
      lastSortedContent = sorted;
      setContentValue(sorted);
      await onStatsUpdate();
    } catch {
      onToast($t('toolbar.sortKeysFailed'), 'error');
    } finally {
      isProcessing = false;
    }
  }

  async function handleOpenFile() {
    try {
      const result = await openFileDialog();
      if (result) {
        const [path, fileContent] = result;
        const name = await getFileName(path);
        const { formatJson5, formatJsonText } = await import('$lib/services/json5Format.js');
        const normalizedContent = await normalizeOpenedJson(fileContent, {
          indent: tabSize,
          formatJson: formatJsonText,
          detectDialect: (value) => detectJsonDialectAsync(`open:${path}`, value),
          formatJson5,
        });

        // Smart open: reuse empty tab or create new one
        tabsStore.openFile(normalizedContent, path, name);

        await onStatsUpdate();
        onToast(`Opened: ${name || 'file'}`);
      }
    } catch (e) {
      onToast('Failed to open file', 'error');
      console.error('Open file error:', e);
    }
  }

  async function handleSaveFile(isAutoSave = false) {
    const currentContent = content;
    if (!currentContent.trim() && !isAutoSave) {
      onToast('Nothing to save', 'info');
      return;
    }
    if (!currentContent.trim() && isAutoSave) return;

    if (!activeTab) {
      if (!isAutoSave) onToast('No active tab', 'info');
      return;
    }

    try {
      if (activeTab.filePath) {
        // Save to existing file.
        await writeFile(activeTab.filePath, currentContent);
        if (getDocumentContent(activeTab.id) === currentContent) {
          tabsStore.updateTabModified(activeTab.id, false);
        }
        if (!isAutoSave) {
          onToast(`Saved: ${activeTab.fileName || 'file'}`);
        }
      } else {
        // No current file, use save as.
        if (!isAutoSave) {
          await handleSaveAsFile();
        }
      }
    } catch (e) {
      if (!isAutoSave) onToast('Failed to save file', 'error');
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
      const path = await saveFileDialog(content, getSaveFileName(activeTab.fileName));
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

<div
  class="je-toolbar"
  class:native-macos-titlebar={platform === 'macos'}
  role="toolbar"
  tabindex="-1"
  aria-label="JSON editor toolbar"
  onmousedown={handleTitlebarMouseDown}
>
  <div class="toolbar-actions-strip">
    {#if isDiffMode}
      <!-- Diff mode: only show exit button -->
      <div class="toolbar-group">
        <button class="toolbar-back-btn" onclick={onToggleDiff} use:tooltip={$t('toolbar.exitDiffTooltip')}>
          <svg class="toolbar-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5"/>
            <path d="M12 19l-7-7 7-7"/>
          </svg>
        </button>
      </div>
    {:else}
      <!-- 1. File operations -->
      <div class="toolbar-group">
        <button class="toolbar-btn" onclick={handleNewFile} use:tooltip={`${$t('toolbar.newTooltip')} (${shortcutLabel('newFile')})`}>
          <svg class="toolbar-icon" style="color: #0ea5e9;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 11v6M9 14h6"/></svg>
          {$t('toolbar.new')}
        </button>
        <div class="toolbar-open-wrap" bind:this={openMenuEl}>
          <button
            class="toolbar-btn toolbar-open-btn"
            onclick={() => toggleOpenMenu()}
            use:tooltip={$t('toolbar.openTooltip')}
          >
            <svg class="toolbar-icon" style="color: #eab308;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
            {$t('toolbar.open')}
            <svg class="open-caret" class:rotated={showOpenMenu} viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if showOpenMenu}
            <div
              class="toolbar-open-dropdown"
              style="top: {dropdownTop}px; left: {dropdownLeft}px;"
            >
              <button class="open-menu-item" onclick={handleOpenFileFromMenu}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M10 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5L10 1.5z" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M10 1.5V5.5h4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>Open File</span>
                <span class="open-menu-shortcut">{shortcutLabel('openFile')}</span>
              </button>
              <button class="open-menu-item" onclick={handleOpenFolder}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M1 4.5a1 1 0 011-1h3.586a1 1 0 01.707.293L7.707 5.5H13a1 1 0 011 1v6a1 1 0 01-1 1H2a1 1 0 01-1-1v-8z" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>Open Folder</span>
              </button>
            </div>
          {/if}
        </div>
        <div class="toolbar-file-actions-wrap" bind:this={fileActionsMenuEl}>
          <button
            class="toolbar-icon-btn"
            class:is-active={showFileActionsMenu}
            onclick={toggleFileActionsMenu}
            use:tooltip={$t('toolbar.exportImageTooltip')}
            aria-label={$t('toolbar.exportImage')}
          >
            <svg class="toolbar-icon" style="color: #94a3b8;" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.8"/>
              <circle cx="12" cy="12" r="1.8"/>
              <circle cx="19" cy="12" r="1.8"/>
            </svg>
          </button>
          {#if showFileActionsMenu}
            <div
              class="toolbar-file-actions-dropdown"
              style="top: {fileActionsDropdownTop}px; left: {fileActionsDropdownLeft}px;"
            >
              <button class="open-menu-item export-menu-item" onclick={handleExportImageFromMenu} disabled={isExporting}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="2" y="2" width="12" height="12" rx="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="5.5" cy="5.5" r="1" />
                  <path d="M14 10.5l-3-3L3 14" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span>{$t('toolbar.exportImage')}</span>
              </button>
            </div>
          {/if}
        </div>
      </div>

      <div class="toolbar-divider"></div>

      <!-- 2. JSON transform -->
      <div class="toolbar-group">
        <button class="toolbar-btn is-primary" onclick={handleFormat} disabled={isProcessing} use:tooltip={`${$t('toolbar.formatTooltip')} (${shortcutLabel('format')})`}>
          <svg class="toolbar-icon" style="color: #10b981;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 5c-2 0-3 1-3 3v2c0 1-1 2-2 2 1 0 2 1 2 2v2c0 2 1 3 3 3"/>
            <path d="M16 5c2 0 3 1 3 3v2c0 1 1 2 2 2-1 0-2 1-2 2v2c0 2-1 3-3 3"/>
          </svg>
          {$t('toolbar.format')}
        </button>
        <button class="toolbar-btn" onclick={handleMinify} disabled={isProcessing} use:tooltip={`${$t('toolbar.minifyTooltip')} (${shortcutLabel('minify')})`}>
          <svg class="toolbar-icon" style="color: #f97316;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M9 4l3 2 3-2"/><path d="M4 10h16M4 14h16"/><path d="M12 22v-4M9 20l3-2 3 2"/></svg>
          {$t('toolbar.minify')}
        </button>
        <button class="toolbar-btn" onclick={handleEscape} disabled={isProcessing} use:tooltip={`${$t('toolbar.escapeTooltip')} (${shortcutLabel('escape')})`}>
          <svg class="toolbar-icon" style="color: #8b5cf6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
          {$t('toolbar.escape')}
        </button>
        <button class="toolbar-btn" onclick={handleUnescape} disabled={isProcessing} use:tooltip={`${$t('toolbar.unescapeTooltip')} (${shortcutLabel('unescape')})`}>
          <svg class="toolbar-icon" style="color: #6366f1;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2"/><path d="M9 12h6"/></svg>
          {$t('toolbar.unescape')}
        </button>
        <button class="toolbar-btn" onclick={handleMinifyEscape} disabled={isProcessing} use:tooltip={`${$t('toolbar.minifyEscapeTooltip')} (${shortcutLabel('minifyEscape')})`}>
          <svg class="toolbar-icon" style="color: #ef4444;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8"/></svg>
          {$t('toolbar.minifyEscape')}
        </button>

        <button
          class="toolbar-btn"
          onclick={handleToggleFold}
          disabled={isProcessing}
          use:tooltip={isFolded ? `${$t('toolbar.unfoldAllTooltip')} (${shortcutLabel('unfoldAll')})` : `${$t('toolbar.foldAllTooltip')} (${shortcutLabel('foldAll')})`}
        >
          {#if isFolded}
            <svg class="toolbar-icon" style="color: #34d399;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8l5-4 5 4"/><path d="M7 16l5 4 5-4"/></svg>
            {$t('toolbar.unfoldAll')}
          {:else}
            <svg class="toolbar-icon" style="color: #10b981;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4l5 4 5-4"/><path d="M7 20l5-4 5 4"/></svg>
            {$t('toolbar.foldAll')}
          {/if}
        </button>

        <div class="toolbar-transform-more-wrap" bind:this={transformMoreMenuEl}>
          <button
            class="toolbar-icon-btn"
            class:is-active={showTransformMoreMenu}
            onclick={toggleTransformMoreMenu}
            use:tooltip={$t('toolbar.transformMoreTooltip')}
            aria-label={$t('toolbar.transformMoreTooltip')}
          >
            <svg class="toolbar-icon" style="color: #94a3b8;" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.8"/>
              <circle cx="12" cy="12" r="1.8"/>
              <circle cx="19" cy="12" r="1.8"/>
            </svg>
          </button>
          {#if showTransformMoreMenu}
            <div
              class="toolbar-transform-more-dropdown"
              style="top: {transformMoreDropdownTop}px; left: {transformMoreDropdownLeft}px;"
            >
              <button class="open-menu-item" onclick={handleToggleKeySortFromMenu} disabled={isProcessing}>
                {#if keySortState === 'desc'}
                  <svg class="toolbar-icon" style="color: #f97316;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15a7 7 0 1 0 1.5-8"/><path d="M5 5v5h5"/></svg>
                  <span>{$t('toolbar.restoreKeyOrderLabel')}</span>
                {:else if keySortState === 'asc'}
                  <svg class="toolbar-icon" style="color: #10b981;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16m0 0-3-3m3 3 3-3"/><path d="M14 5h2m-2 5h3m-3 5h4m-4 5h5"/></svg>
                  <span>{$t('toolbar.sortKeysDescLabel')}</span>
                {:else}
                  <svg class="toolbar-icon" style="color: #3b82f6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20V4m0 0-3 3m3-3 3 3"/><path d="M14 5h5m-5 5h4m-4 5h3m-3 5h2"/></svg>
                  <span>{$t('toolbar.sortKeysAscLabel')}</span>
                {/if}
              </button>
              <button class="open-menu-item" onclick={handleConvertToStandardJsonFromMenu} disabled={isProcessing}>
                <svg class="toolbar-icon" style="color: #14b8a6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 5H5a1.5 1.5 0 0 0-1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5 1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 0 5 19h1" />
                  <path d="M18 19h1a1.5 1.5 0 0 0 1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5 1.5 1.5 0 0 1-1.5-1.5v-4A1.5 1.5 0 0 0 19 5h-1" />
                  <path d="M7 12l4 4l6-8" />
                </svg>
                <span>{$t('toolbar.convertToStandardLabel')}</span>
              </button>
              <button
                class="open-menu-item"
                onclick={handleConvertKeyNamingFromMenu}
                disabled={isProcessing || isConvertMode || isCodegenMode || isSchemaMode}
                aria-label={$t('toolbar.keyNamingTooltip')}
              >
                <svg class="toolbar-icon" style="color: #a855f7;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 18 L6.5 5 L12 18"/>
                  <path d="M3 13h6"/>
                  <circle cx="19" cy="14" r="4"/>
                  <path d="M23 10v8"/>
                </svg>
                <span>{$t('toolbar.keyNamingLabel')}</span>
              </button>
            </div>
          {/if}
        </div>
      </div>

      <div class="toolbar-divider"></div>

      <!-- 3. Diff, Convert & Codegen -->
      <div class="toolbar-group">
        <button class="toolbar-btn" onclick={onToggleDiff} disabled={isConvertMode || isCodegenMode || isSchemaMode} use:tooltip={$t('toolbar.diffTooltip')}>
          <svg class="toolbar-icon" style="color: #14b8a6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 4v16"/></svg>
          {$t('toolbar.diff')}
        </button>
        <button class="toolbar-btn {isConvertMode ? 'is-active' : ''}" onclick={onToggleConvert} disabled={isCodegenMode || isSchemaMode} use:tooltip={isConvertMode ? $t('toolbar.exitConvertTooltip') : $t('toolbar.convertTooltip')}>
          <svg class="toolbar-icon" style="color: #3b82f6;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 4 20 7 17 10"/><path d="M4 12v-1a3 3 0 0 1 3-3h13"/><polyline points="7 20 4 17 7 14"/><path d="M20 12v1a3 3 0 0 1-3 3H4"/></svg>
          {isConvertMode ? $t('toolbar.exitConvert') : $t('toolbar.convert')}
        </button>
        <button class="toolbar-btn {isCodegenMode ? 'is-active' : ''}" onclick={onToggleCodegen} disabled={isConvertMode || isSchemaMode} use:tooltip={isCodegenMode ? $t('toolbar.exitCodegenTooltip') : $t('toolbar.codegenTooltip')}>
          <svg class="toolbar-icon" style="color: #d946ef;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 6 1 12 7 18"/><polyline points="17 6 23 12 17 18"/><line x1="14" y1="4" x2="10" y2="20"/></svg>
          {isCodegenMode ? $t('toolbar.exitCodegen') : $t('toolbar.codegen')}
        </button>
        <button class="toolbar-btn {isSchemaMode ? 'is-active' : ''}" onclick={onToggleSchema} disabled={isConvertMode || isCodegenMode} use:tooltip={isSchemaMode ? $t('toolbar.exitSchemaTooltip') : $t('toolbar.schemaTooltip')}>
          <svg class="toolbar-icon" style="color: #f59e0b;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l9 4.5v5c0 4.7-3.8 9-9 10.5C6.8 21.5 3 17.2 3 12.5v-5L12 3z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
          {isSchemaMode ? $t('toolbar.exitSchema') : $t('toolbar.schema')}
        </button>
      </div>
    {/if}
  </div>

  <div
    class="toolbar-drag-spacer"
    aria-hidden="true"
  ></div>

  <!-- 4. App controls (icon-only) -->
  <div class="toolbar-group">
    <button
      class="toolbar-icon-btn"
      onclick={onToggleTheme}
      use:tooltip={isDarkMode ? $t('toolbar.lightMode') : $t('toolbar.darkMode')}
    >
      {#if isDarkMode}
        <svg class="toolbar-icon" style="color: #facc15;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"/>
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      {:else}
        <svg class="toolbar-icon" style="color: #a78bfa;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      {/if}
    </button>
    <button
      class="toolbar-icon-btn"
      onclick={onOpenSettings}
      use:tooltip={$t('toolbar.settings')}
    >
      <svg class="toolbar-icon" style="color: #06b6d4;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
    <button
      class="toolbar-icon-btn {isAlwaysOnTop ? 'is-active' : ''}"
      onclick={onToggleAlwaysOnTop}
      use:tooltip={isAlwaysOnTop ? $t('toolbar.unpinFromTop') : $t('toolbar.pinToTop')}
    >
      <svg class="toolbar-icon" style="color: #ec4899;" viewBox="0 0 24 24" fill={isAlwaysOnTop ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 1 1 0 0 1 1 1z"/>
      </svg>
    </button>
  </div>

  {#if platform !== 'macos'}
    <div class={`window-controls desktop ${platform} toolbar-window-controls`} aria-label="Window controls">
      <button class="caption minimize" type="button" aria-label="Minimize" onclick={minimizeWindow}></button>
      <button
        class={`caption maximize ${isWindowExpanded ? 'is-expanded' : ''}`}
        type="button"
        aria-label={isWindowExpanded ? 'Restore' : 'Maximize'}
        onclick={toggleMaximizeWindow}
      ></button>
      <button class="caption close" type="button" aria-label="Close" onclick={closeWindow}></button>
    </div>
  {/if}
</div>

{#if tooltipText}
  <div 
    class="je-tooltip" 
    style="left: {tooltipX}px; top: {tooltipY}px;"
    role="tooltip"
  >
    {tooltipText}
  </div>
{/if}

<svelte:window onclick={handleWindowClick} />

<style>
  .je-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px 4px 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: hidden;
    overflow-y: hidden;
    user-select: none;
    -webkit-user-select: none;
  }

  .je-toolbar.native-macos-titlebar {
    padding-left: 75px;
  }

  .je-toolbar * {
    user-select: none;
    -webkit-user-select: none;
  }

  .toolbar-actions-strip {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex: 0 1 auto;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .toolbar-actions-strip::-webkit-scrollbar {
    display: none;
  }

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-primary);
    padding: 2px;
    border-radius: 7px;
    border: 1px solid var(--border);
  }

  .toolbar-divider {
    width: 1px;
    height: 16px;
    background: var(--border);
    margin: 0 3px;
  }

  /* Open dropdown */
  .toolbar-open-wrap,
  .toolbar-file-actions-wrap,
  .toolbar-transform-more-wrap {
    position: relative;
  }

  .toolbar-open-btn {
    gap: 4px;
  }

  .open-caret {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    transition: transform 0.15s ease;
    opacity: 0.6;
  }

  .open-caret.rotated {
    transform: rotate(180deg);
  }

  .toolbar-open-dropdown,
  .toolbar-file-actions-dropdown,
  .toolbar-transform-more-dropdown {
    position: fixed;
    min-width: 168px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
    z-index: 9999;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .toolbar-file-actions-dropdown,
  .toolbar-transform-more-dropdown {
    min-width: 150px;
  }

  .open-menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }

  .open-menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .open-menu-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .open-menu-item:disabled:hover {
    background: transparent;
    color: var(--text-secondary);
  }

  .open-menu-item svg {
    width: 14px !important;
    height: 14px !important;
    min-width: 14px !important;
    max-width: 14px !important;
    flex-shrink: 0;
    color: #eab308;
    transform: translateY(-0.5px);
  }

  .open-menu-item:last-child svg {
    color: #f5c542;
  }

  .open-menu-item.export-menu-item svg {
    color: #f43f5e;
  }

  .open-menu-shortcut {
    margin-left: auto;
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.7;
    font-family: 'JetBrains Mono', monospace;
  }

  .toolbar-btn {
    height: 26px;
    padding: 0 9px;
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
    width: 26px;
    height: 26px;
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

  .toolbar-btn .toolbar-icon {
    transform: translateY(-0.5px);
  }

  .toolbar-drag-spacer {
    align-self: stretch;
    flex: 1 1 auto;
    min-width: 48px;
    min-height: 26px;
    border-radius: 6px;
    cursor: default;
  }

  .toolbar-window-controls {
    flex: 0 0 auto;
  }

  .toolbar-back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toolbar-back-btn:hover {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent);
  }

  .toolbar-back-icon {
    width: 16px;
    height: 16px;
  }

  .je-tooltip {
    position: fixed;
    transform: translate(-50%, 0);
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    line-height: 1.2;
    white-space: nowrap;
    z-index: 10000;
    pointer-events: none;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    animation: je-tooltip-fade-in 0.08s ease-out;
  }

  @keyframes je-tooltip-fade-in {
    from {
      opacity: 0;
      transform: translate(-50%, -5px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>

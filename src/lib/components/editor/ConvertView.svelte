<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import loader from '@monaco-editor/loader';
  import type * as Monaco from 'monaco-editor';
  import { registerMonacoThemes, type EditorTheme } from '$lib/config/monacoThemes';
  import { convertJson, convertToJson, CONVERT_FORMATS, type ConvertFormat } from '$lib/services/convert';
  import { t } from '$lib/i18n';

  type Direction = 'json2fmt' | 'fmt2json';

  let {
    inputValue = '',
    theme = 'vs' as EditorTheme,
    fontSize = 13,
    lineHeight = 20,
    tabSize = 2,
    onInputChange = (_value: string) => {},
    onToast = (_msg: string) => {},
    onExit = () => {},
  }: {
    inputValue?: string;
    theme?: EditorTheme;
    fontSize?: number;
    lineHeight?: number;
    tabSize?: number;
    onInputChange?: (value: string) => void;
    onToast?: (msg: string) => void;
    onExit?: () => void;
  } = $props();

  let leftContainer: HTMLDivElement;
  let rightContainer: HTMLDivElement;
  let leftEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let rightEditor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let monaco = $state<typeof Monaco | null>(null);
  let selectedFormat = $state<ConvertFormat>('yaml');
  let direction = $state<Direction>('json2fmt');
  let convertError = $state('');
  let isConverting = $state(false);
  let isSyncingLeft = false;
  let convertTimer: ReturnType<typeof setTimeout> | null = null;
  let copied = $state(false);
  let csvDecorations: Monaco.editor.IEditorDecorationsCollection | null = null;

  const RAINBOW_COLORS = [
    '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
  ];

  function parseCsvColumns(line: string): { start: number; end: number }[] {
    const cols: { start: number; end: number }[] = [];
    let i = 0;
    let colStart = 0;
    while (i <= line.length) {
      if (i === line.length) {
        cols.push({ start: colStart, end: i });
        break;
      }
      if (line[i] === '"') {
        i++;
        while (i < line.length) {
          if (line[i] === '"') {
            if (i + 1 < line.length && line[i + 1] === '"') {
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            i++;
          }
        }
      } else if (line[i] === ',') {
        cols.push({ start: colStart, end: i });
        i++;
        colStart = i;
      } else {
        i++;
      }
    }
    return cols;
  }

  function applyCsvRainbow() {
    if (!rightEditor || !monaco || selectedFormat !== 'csv') {
      if (csvDecorations) { csvDecorations.clear(); csvDecorations = null; }
      return;
    }
    const model = rightEditor.getModel();
    if (!model) return;

    const lineCount = model.getLineCount();
    const decorations: Monaco.editor.IModelDeltaDecoration[] = [];

    for (let lineNum = 1; lineNum <= lineCount; lineNum++) {
      const lineContent = model.getLineContent(lineNum);
      if (!lineContent) continue;
      const cols = parseCsvColumns(lineContent);
      for (let colIdx = 0; colIdx < cols.length; colIdx++) {
        const col = cols[colIdx];
        if (col.start >= col.end) continue;
        const colorIdx = colIdx % RAINBOW_COLORS.length;
        decorations.push({
          range: new monaco.Range(lineNum, col.start + 1, lineNum, col.end + 1),
          options: { inlineClassName: `csv-rainbow-col-${colorIdx}` },
        });
      }
    }

    if (csvDecorations) {
      csvDecorations.clear();
    }
    csvDecorations = rightEditor.createDecorationsCollection(decorations);
  }

  $effect(() => {
    if (direction !== 'json2fmt') return;
    const val = inputValue;
    if (leftEditor && val !== leftEditor.getValue()) {
      isSyncingLeft = true;
      leftEditor.setValue(val);
      isSyncingLeft = false;
    }
  });

  $effect(() => {
    if (monaco && theme) {
      monaco.editor.setTheme(theme);
    }
  });

  $effect(() => {
    if (leftEditor) {
      leftEditor.updateOptions({ fontSize, lineHeight });
    }
    if (rightEditor) {
      rightEditor.updateOptions({ fontSize, lineHeight });
    }
  });

  $effect(() => {
    if (leftEditor) {
      leftEditor.getModel()?.updateOptions({ tabSize, indentSize: tabSize, insertSpaces: true });
    }
  });

  let pendingFormat: ConvertFormat | null = null;
  let pendingDirection: Direction | null = null;

  $effect(() => {
    const fmt = selectedFormat;
    const dir = direction;
    if (pendingFormat !== fmt || pendingDirection !== dir) {
      pendingFormat = fmt;
      pendingDirection = dir;
      const content = leftEditor?.getValue() || inputValue;
      doConvert(content);
    }
  });

  async function doConvert(content: string) {
    if (!content.trim()) {
      if (rightEditor) rightEditor.setValue('');
      convertError = '';
      return;
    }
    if (isConverting) return;
    isConverting = true;
    convertError = '';

    try {
      const fmt = selectedFormat;
      let result: string;

      if (direction === 'json2fmt') {
        result = await convertJson(content, fmt);
        if (rightEditor) {
          const model = rightEditor.getModel();
          if (model) {
            const fmtInfo = CONVERT_FORMATS.find(f => f.id === fmt);
            monaco?.editor.setModelLanguage(model, fmtInfo?.lang || 'plaintext');
          }
          rightEditor.setValue(result);
          if (fmt === 'csv') {
            applyCsvRainbow();
          } else if (csvDecorations) {
            csvDecorations.clear();
            csvDecorations = null;
          }
          scheduleScrollWidthFix(rightEditor);
        }
      } else {
        result = await convertToJson(content, fmt);
        if (rightEditor) {
          const model = rightEditor.getModel();
          if (model) {
            monaco?.editor.setModelLanguage(model, 'json');
          }
          rightEditor.setValue(result);
          if (csvDecorations) {
            csvDecorations.clear();
            csvDecorations = null;
          }
        }
      }
    } catch (e: any) {
      convertError = typeof e === 'string' ? e : e?.message || 'Conversion failed';
      if (rightEditor) rightEditor.setValue('');
    } finally {
      isConverting = false;
    }
  }

  let scrollFixTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleScrollWidthFix(editor: Monaco.editor.IStandaloneCodeEditor) {
    if (scrollFixTimer) clearTimeout(scrollFixTimer);
    scrollFixTimer = setTimeout(() => {
      scrollFixTimer = null;
      const model = editor.getModel();
      if (!model || !monaco) return;
      let maxLen = 0;
      let longestLine = 1;
      for (let i = 1; i <= model.getLineCount(); i++) {
        const len = model.getLineLength(i);
        if (len > maxLen) {
          maxLen = len;
          longestLine = i;
        }
      }
      const currentScrollWidth = editor.getScrollWidth();
      const fontInfo = editor.getOption(monaco.editor.EditorOption.fontInfo);
      const neededWidth = Math.ceil(maxLen * fontInfo.typicalHalfwidthCharacterWidth);
      if (neededWidth <= currentScrollWidth) return;

      editor.updateOptions({ smoothScrolling: false });
      editor.revealPosition(
        { lineNumber: longestLine, column: maxLen + 1 },
        1 /* Immediate */
      );
      setTimeout(() => {
        editor.setScrollLeft(0, 1 /* Immediate */);
        editor.setScrollTop(0, 1 /* Immediate */);
        editor.updateOptions({ smoothScrolling: true });
      }, 30);
    }, 100);
  }

  function handleLeftChange(value: string) {
    if (isSyncingLeft) return;
    if (direction === 'json2fmt') {
      onInputChange(value);
    }
    if (convertTimer) clearTimeout(convertTimer);
    convertTimer = setTimeout(() => doConvert(value), 300);
  }

  function toggleDirection() {
    const oldLeft = leftEditor?.getValue() || '';
    const oldRight = rightEditor?.getValue() || '';

    direction = direction === 'json2fmt' ? 'fmt2json' : 'json2fmt';

    if (leftEditor && rightEditor && monaco) {
      isSyncingLeft = true;
      leftEditor.setValue(oldRight);
      rightEditor.setValue('');

      const leftModel = leftEditor.getModel();
      if (leftModel) {
        if (direction === 'json2fmt') {
          monaco.editor.setModelLanguage(leftModel, 'json');
        } else {
          const fmtInfo = CONVERT_FORMATS.find(f => f.id === selectedFormat);
          monaco.editor.setModelLanguage(leftModel, fmtInfo?.lang || 'plaintext');
        }
      }

      leftEditor.updateOptions({ readOnly: false });
      rightEditor.updateOptions({ readOnly: true });

      isSyncingLeft = false;
      convertError = '';

      doConvert(oldRight);
    }
  }

  function updateLeftLanguage() {
    if (!leftEditor || !monaco) return;
    const model = leftEditor.getModel();
    if (!model) return;
    if (direction === 'fmt2json') {
      const fmtInfo = CONVERT_FORMATS.find(f => f.id === selectedFormat);
      monaco.editor.setModelLanguage(model, fmtInfo?.lang || 'plaintext');
    }
  }

  async function copyResult() {
    const text = rightEditor?.getValue() || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      onToast($t('convert.copied'));
      setTimeout(() => { copied = false; }, 1500);
    } catch (_) {}
  }

  function registerCsvLanguage(m: typeof Monaco) {
    if (m.languages.getLanguages().some(l => l.id === 'csv')) return;
    m.languages.register({ id: 'csv' });
    m.languages.setMonarchTokensProvider('csv', {
      tokenizer: { root: [[/./, '']] },
    });
  }

  onMount(async () => {
    const monacoInstance = await loader.init();
    monaco = monacoInstance;
    registerMonacoThemes(monacoInstance);
    registerCsvLanguage(monacoInstance);

    const commonOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
      theme,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize,
      lineHeight,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
      contextmenu: false,
      renderLineHighlight: 'line' as const,
      lineNumbersMinChars: 3,
      tabSize,
    };

    leftEditor = monacoInstance.editor.create(leftContainer, {
      ...commonOptions,
      value: inputValue,
      language: 'json',
    });

    rightEditor = monacoInstance.editor.create(rightContainer, {
      ...commonOptions,
      value: '',
      language: 'yaml',
      readOnly: true,
      wordWrap: 'off',
      stopRenderingLineAfter: -1,
    });

    leftEditor!.onDidChangeModelContent(() => {
      if (isSyncingLeft) return;
      handleLeftChange(leftEditor!.getValue());
    });

    doConvert(inputValue);
  });

  $effect(() => {
    const _fmt = selectedFormat;
    if (direction === 'fmt2json') {
      updateLeftLanguage();
    }
  });

  onDestroy(() => {
    if (convertTimer) clearTimeout(convertTimer);
    if (scrollFixTimer) clearTimeout(scrollFixTimer);
    leftEditor?.dispose();
    rightEditor?.dispose();
  });
</script>

<div class="cv">
  <div class="cv-body">
    <!-- Left pane -->
    <div class="cv-pane">
      <div class="cv-pane-header">
        <div class="cv-pane-header-left">
          <button class="cv-back-btn" onclick={onExit} title={$t('toolbar.exitConvert')}>
            <svg class="cv-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5"/>
              <path d="M12 19l-7-7 7-7"/>
            </svg>
          </button>
          {#if direction === 'json2fmt'}
            <div class="cv-pane-badge cv-badge-json">JSON</div>
          {:else}
            <div class="cv-format-selector">
              {#each CONVERT_FORMATS as fmt}
                <button
                  class="cv-format-btn {selectedFormat === fmt.id ? 'is-active' : ''}"
                  onclick={() => { selectedFormat = fmt.id; }}
                >
                  {fmt.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
      <div class="cv-editor">
        <div bind:this={leftContainer} class="cv-editor-mount"></div>
      </div>
    </div>

    <!-- Center divider with direction toggle -->
    <div class="cv-divider">
      <div class="cv-divider-line"></div>
      <button
        class="cv-divider-icon"
        onclick={toggleDirection}
        title={$t('convert.toggleDirection')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9h16l-4-4"/>
          <path d="M20 15H4l4 4"/>
        </svg>
      </button>
      <div class="cv-divider-line"></div>
    </div>

    <!-- Right pane -->
    <div class="cv-pane">
      <div class="cv-pane-header">
        <div class="cv-header-controls">
          {#if direction === 'json2fmt'}
            <div class="cv-format-selector">
              {#each CONVERT_FORMATS as fmt}
                <button
                  class="cv-format-btn {selectedFormat === fmt.id ? 'is-active' : ''}"
                  onclick={() => { selectedFormat = fmt.id; }}
                >
                  {fmt.label}
                </button>
              {/each}
            </div>
          {:else}
            <div class="cv-pane-badge cv-badge-json">JSON</div>
          {/if}
        </div>
        <div class="cv-pane-actions">
          <button
            class="cv-action-btn {copied ? 'is-copied' : ''}"
            onclick={copyResult}
            title={$t('convert.copyResult')}
            disabled={!!convertError}
          >
            {#if copied}
              <svg class="cv-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            {:else}
              <svg class="cv-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            {/if}
          </button>
        </div>
      </div>

      {#if convertError}
        <div class="cv-error">
          <svg class="cv-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{convertError}</span>
        </div>
      {/if}

      <div class="cv-editor">
        <div bind:this={rightContainer} class="cv-editor-mount"></div>
      </div>
    </div>
  </div>
</div>

<style>
  .cv {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .cv-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  /* Pane */
  .cv-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .cv-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 34px;
  }

  .cv-pane-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .cv-back-btn {
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

  .cv-back-btn:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .cv-back-icon {
    width: 15px;
    height: 15px;
  }

  .cv-pane-badge {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .cv-badge-json {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .cv-pane-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Center divider */
  .cv-divider {
    width: 1px;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    background: var(--border);
    position: relative;
  }

  .cv-divider-line {
    flex: 1;
  }

  .cv-divider-icon {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
    border: 1.5px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
    animation: cv-pulse 2s ease-in-out 3;
  }

  .cv-divider-icon:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    transform: translate(-50%, -50%) scale(1.15);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .cv-divider-icon:active {
    transform: translate(-50%, -50%) scale(0.95);
  }

  .cv-divider-icon svg {
    width: 16px;
    height: 16px;
  }

  @keyframes cv-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 30%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent); }
  }

  .cv-header-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Format selector */
  .cv-format-selector {
    display: flex;
    align-items: center;
    gap: 1px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
  }

  .cv-format-btn {
    padding: 3px 12px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    letter-spacing: 0.02em;
  }

  .cv-format-btn:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .cv-format-btn.is-active {
    background: var(--accent);
    color: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  /* Action button */
  .cv-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .cv-action-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .cv-action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .cv-action-btn.is-copied {
    color: var(--success);
  }

  .cv-action-icon {
    width: 14px;
    height: 14px;
  }

  /* Error */
  .cv-error {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: color-mix(in srgb, var(--error, #ef4444) 8%, transparent);
    color: var(--error, #ef4444);
    font-size: 11px;
    line-height: 1.4;
    border-bottom: 1px solid color-mix(in srgb, var(--error, #ef4444) 20%, transparent);
    flex-shrink: 0;
  }

  .cv-error-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.8;
  }

  /* Editor */
  .cv-editor {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .cv-editor-mount {
    width: 100%;
    height: 100%;
  }

  /* Rainbow CSV column colors */
  :global(.csv-rainbow-col-0) { color: #e6194b !important; }
  :global(.csv-rainbow-col-1) { color: #3cb44b !important; }
  :global(.csv-rainbow-col-2) { color: #4363d8 !important; }
  :global(.csv-rainbow-col-3) { color: #f58231 !important; }
  :global(.csv-rainbow-col-4) { color: #911eb4 !important; }
  :global(.csv-rainbow-col-5) { color: #42d4f4 !important; }
  :global(.csv-rainbow-col-6) { color: #f032e6 !important; }
  :global(.csv-rainbow-col-7) { color: #bfef45 !important; }
  :global(.csv-rainbow-col-8) { color: #fabed4 !important; }
  :global(.csv-rainbow-col-9) { color: #469990 !important; }
</style>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import loader from '@monaco-editor/loader';
  import type * as Monaco from 'monaco-editor';
  import { registerMonacoThemes, type EditorTheme } from '$lib/config/monacoThemes';
  import { generateSchema, validateWithSchema, type SchemaError } from '$lib/services/schema';
  import { t } from '$lib/i18n';

  type TabMode = 'generate' | 'validate';

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

  let mode = $state<TabMode>('generate');
  let schemaError = $state('');
  let validationErrors = $state<SchemaError[]>([]);
  let validationValid = $state<boolean | null>(null);
  let isSyncingLeft = false;
  let genTimer: ReturnType<typeof setTimeout> | null = null;
  let copied = $state(false);

  $effect(() => {
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

  function switchMode(newMode: TabMode) {
    if (mode === newMode) return;
    mode = newMode;
    schemaError = '';
    validationErrors = [];
    validationValid = null;

    if (!rightEditor) return;

    if (newMode === 'generate') {
      rightEditor.updateOptions({ readOnly: true });
      doGenerate(leftEditor?.getValue() || '');
    } else {
      rightEditor.updateOptions({ readOnly: false });
    }
  }

  function handleLeftChange(value: string) {
    onInputChange(value);
    if (mode === 'generate') {
      scheduleGenerate(value);
    }
  }

  function scheduleGenerate(value: string) {
    if (genTimer) clearTimeout(genTimer);
    genTimer = setTimeout(() => doGenerate(value), 400);
  }

  function doGenerate(jsonStr: string) {
    if (!rightEditor) return;
    schemaError = '';

    if (!jsonStr.trim()) {
      rightEditor.setValue('');
      return;
    }

    try {
      const schema = generateSchema(jsonStr);
      rightEditor.setValue(schema);
    } catch (e: any) {
      schemaError = e?.message || 'Failed to generate schema';
    }
  }

  function doValidate() {
    if (!leftEditor || !rightEditor) return;
    const jsonStr = leftEditor.getValue();
    const schemaStr = rightEditor.getValue();
    schemaError = '';
    validationErrors = [];
    validationValid = null;

    if (!jsonStr.trim()) {
      schemaError = $t('schema.emptyJson');
      return;
    }
    if (!schemaStr.trim()) {
      schemaError = $t('schema.emptySchema');
      return;
    }

    try {
      const result = validateWithSchema(jsonStr, schemaStr);
      validationValid = result.valid;
      validationErrors = result.errors;
      if (result.valid) {
        onToast($t('schema.validToast'));
      }
    } catch (e: any) {
      schemaError = e?.message || 'Validation failed';
    }
  }

  function copyResult() {
    if (!rightEditor) return;
    const text = rightEditor.getValue();
    if (!text) return;
    navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => { copied = false; }, 1500);
    onToast($t('schema.copied'));
  }

  onMount(async () => {
    const monacoInstance = await loader.init();
    monaco = monacoInstance;
    registerMonacoThemes(monacoInstance);

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
      language: 'json',
      readOnly: true,
    });

    leftEditor!.onDidChangeModelContent(() => {
      if (isSyncingLeft) return;
      handleLeftChange(leftEditor!.getValue());
    });

    doGenerate(inputValue);
  });

  onDestroy(() => {
    if (genTimer) clearTimeout(genTimer);
    leftEditor?.dispose();
    rightEditor?.dispose();
  });
</script>

<div class="sv">
  <div class="sv-body">
    <!-- Left pane: JSON data -->
    <div class="sv-pane">
      <div class="sv-pane-header">
        <div class="sv-pane-header-left">
          <button class="sv-back-btn" onclick={onExit} title={$t('toolbar.exitSchema')}>
            <svg class="sv-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5"/>
              <path d="M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div class="sv-pane-badge sv-badge-json">JSON</div>
        </div>
      </div>
      <div class="sv-editor">
        <div bind:this={leftContainer} class="sv-editor-mount"></div>
      </div>
    </div>

    <!-- Center divider -->
    <div class="sv-divider">
      <div class="sv-divider-line"></div>
      {#if mode === 'generate'}
        <div class="sv-divider-icon is-static" title={$t('schema.generateHint')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"/>
            <path d="M13 6l6 6-6 6"/>
          </svg>
        </div>
      {:else}
        <button
          class="sv-divider-icon {validationValid === true ? 'is-valid' : ''} {validationValid === false ? 'is-invalid' : ''}"
          onclick={doValidate}
          title={$t('schema.validateBtn')}
        >
          {#if validationValid === true}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 12l2 2 4-4"/>
              <path d="M12 3l9 4.5v5c0 4.7-3.8 9-9 10.5C6.8 21.5 3 17.2 3 12.5v-5L12 3z"/>
            </svg>
          {:else if validationValid === false}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l9 4.5v5c0 4.7-3.8 9-9 10.5C6.8 21.5 3 17.2 3 12.5v-5L12 3z"/>
              <path d="M10 10l4 4M14 10l-4 4"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l9 4.5v5c0 4.7-3.8 9-9 10.5C6.8 21.5 3 17.2 3 12.5v-5L12 3z"/>
            </svg>
          {/if}
        </button>
      {/if}
      <div class="sv-divider-line"></div>
    </div>

    <!-- Right pane: Schema -->
    <div class="sv-pane">
      <div class="sv-pane-header">
        <div class="sv-header-controls">
          <div class="sv-pane-badge sv-badge-schema">JSON Schema</div>
          <!-- Tab switcher -->
          <div class="sv-tabs">
            <button
              class="sv-tab {mode === 'generate' ? 'is-active' : ''}"
              onclick={() => switchMode('generate')}
            >
              <svg class="sv-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
              </svg>
              {$t('schema.tabGenerate')}
            </button>
            <button
              class="sv-tab {mode === 'validate' ? 'is-active' : ''}"
              onclick={() => switchMode('validate')}
            >
              <svg class="sv-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l9 4.5v5c0 4.7-3.8 9-9 10.5C6.8 21.5 3 17.2 3 12.5v-5L12 3z"/>
                <path d="M9 12l2 2 4-4"/>
              </svg>
              {$t('schema.tabValidate')}
            </button>
          </div>

          {#if mode === 'validate' && validationValid === true}
            <div class="sv-result-badge is-valid">
              <svg class="sv-result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              {$t('schema.valid')}
            </div>
          {:else if mode === 'validate' && validationValid === false}
            <div class="sv-result-badge is-invalid">
              <svg class="sv-result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              {$t('schema.invalid')} ({validationErrors.length})
            </div>
          {/if}
        </div>
        <div class="sv-pane-actions">
          <button
            class="sv-action-btn {copied ? 'is-copied' : ''}"
            onclick={copyResult}
            title={$t('schema.copySchema')}
          >
            {#if copied}
              <svg class="sv-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            {:else}
              <svg class="sv-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            {/if}
          </button>
        </div>
      </div>

      {#if schemaError}
        <div class="sv-error">
          <svg class="sv-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{schemaError}</span>
        </div>
      {/if}

      {#if validationErrors.length > 0}
        <div class="sv-error-list">
          {#each validationErrors as err}
            <div class="sv-error-item">
              <span class="sv-error-path">{err.path || '/'}</span>
              <span class="sv-error-msg">{err.message}</span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="sv-editor">
        <div bind:this={rightContainer} class="sv-editor-mount"></div>
      </div>
    </div>
  </div>
</div>

<style>
  .sv {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .sv-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .sv-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .sv-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 34px;
  }

  .sv-pane-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .sv-back-btn {
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

  .sv-back-btn:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .sv-back-icon {
    width: 15px;
    height: 15px;
  }

  .sv-pane-badge {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .sv-badge-json {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .sv-badge-schema {
    background: color-mix(in srgb, #8b5cf6 12%, transparent);
    color: #8b5cf6;
  }

  .sv-header-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Tab switcher */
  .sv-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
  }

  .sv-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .sv-tab:hover:not(.is-active) {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .sv-tab.is-active {
    background: var(--accent);
    color: white;
  }

  .sv-tab-icon {
    width: 12px;
    height: 12px;
  }

  /* Validation result badge */
  .sv-result-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    animation: sv-badge-in 0.2s ease-out;
  }

  .sv-result-badge.is-valid {
    background: color-mix(in srgb, var(--success) 12%, transparent);
    color: var(--success);
  }

  .sv-result-badge.is-invalid {
    background: color-mix(in srgb, var(--error, #ef4444) 12%, transparent);
    color: var(--error, #ef4444);
  }

  .sv-result-icon {
    width: 12px;
    height: 12px;
  }

  @keyframes sv-badge-in {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }

  .sv-pane-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Center divider */
  .sv-divider {
    width: 1px;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    background: var(--border);
    position: relative;
  }

  .sv-divider-line {
    flex: 1;
  }

  .sv-divider-icon {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--bg-secondary);
    border: 1.5px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
    animation: sv-pulse 2s ease-in-out 3;
  }

  .sv-divider-icon.is-static {
    cursor: default;
    animation: none;
    opacity: 0.6;
  }

  .sv-divider-icon:not(.is-static):not(.is-valid):not(.is-invalid):hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    transform: translate(-50%, -50%) scale(1.15);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .sv-divider-icon:not(.is-static):active {
    transform: translate(-50%, -50%) scale(0.95);
  }

  .sv-divider-icon.is-valid {
    background: color-mix(in srgb, var(--success) 15%, var(--bg-secondary));
    border-color: var(--success);
    color: var(--success);
    animation: none;
  }

  .sv-divider-icon.is-valid:hover {
    background: var(--success);
    border-color: var(--success);
    color: white;
    transform: translate(-50%, -50%) scale(1.15);
    box-shadow: 0 0 12px color-mix(in srgb, var(--success) 40%, transparent);
  }

  .sv-divider-icon.is-invalid {
    background: color-mix(in srgb, var(--error, #ef4444) 15%, var(--bg-secondary));
    border-color: var(--error, #ef4444);
    color: var(--error, #ef4444);
    animation: none;
  }

  .sv-divider-icon.is-invalid:hover {
    background: var(--error, #ef4444);
    border-color: var(--error, #ef4444);
    color: white;
    transform: translate(-50%, -50%) scale(1.15);
    box-shadow: 0 0 12px color-mix(in srgb, var(--error, #ef4444) 40%, transparent);
  }

  .sv-divider-icon svg {
    width: 22px;
    height: 22px;
  }

  @keyframes sv-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--text-secondary) 20%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--text-secondary) 0%, transparent); }
  }

  /* Action button */
  .sv-action-btn {
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

  .sv-action-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .sv-action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .sv-action-btn.is-copied {
    color: var(--success);
  }

  .sv-action-icon {
    width: 14px;
    height: 14px;
  }

  /* Error */
  .sv-error {
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

  .sv-error-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.8;
  }

  .sv-error-list {
    max-height: 120px;
    overflow-y: auto;
    border-bottom: 1px solid color-mix(in srgb, var(--error, #ef4444) 20%, transparent);
    flex-shrink: 0;
  }

  .sv-error-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 3px 10px;
    font-size: 11px;
    background: color-mix(in srgb, var(--error, #ef4444) 4%, transparent);
  }

  .sv-error-item:not(:last-child) {
    border-bottom: 1px solid color-mix(in srgb, var(--error, #ef4444) 8%, transparent);
  }

  .sv-error-path {
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
    font-weight: 600;
    color: var(--error, #ef4444);
    flex-shrink: 0;
  }

  .sv-error-msg {
    color: var(--text-secondary);
  }

  /* Editor */
  .sv-editor {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .sv-editor-mount {
    width: 100%;
    height: 100%;
  }
</style>

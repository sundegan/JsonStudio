<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import loader from '@monaco-editor/loader';
  import type * as Monaco from 'monaco-editor';
  import { registerMonacoThemes, type EditorTheme } from '$lib/config/monacoThemes';
  import { generateCode, codeToJson, supportsReverse, CODEGEN_LANGUAGES, type CodegenLanguage } from '$lib/services/codegen';
  import { t } from '$lib/i18n';

  type Direction = 'json2code' | 'code2json';

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
  let selectedLang = $state<CodegenLanguage>('typescript');
  let className = $state('MyModel');
  let direction = $state<Direction>('json2code');
  let genError = $state('');
  let isGenerating = $state(false);
  let isSyncingLeft = false;
  let genTimer: ReturnType<typeof setTimeout> | null = null;
  let copied = $state(false);

  $effect(() => {
    if (direction !== 'json2code') return;
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

  let pendingLang: CodegenLanguage | null = null;
  let pendingClassName: string | null = null;
  let pendingDirection: Direction | null = null;

  $effect(() => {
    const lang = selectedLang;
    const cls = className;
    const dir = direction;
    if (dir === 'code2json' && !supportsReverse(lang)) {
      direction = 'json2code';
      return;
    }
    if (pendingLang !== lang || pendingClassName !== cls || pendingDirection !== dir) {
      pendingLang = lang;
      pendingClassName = cls;
      pendingDirection = dir;
      const content = leftEditor?.getValue() || '';
      doConvert(content);
    }
  });

  async function doConvert(content: string) {
    if (!content.trim()) {
      if (rightEditor) rightEditor.setValue('');
      genError = '';
      return;
    }
    if (isGenerating) return;
    isGenerating = true;
    genError = '';

    try {
      const lang = selectedLang;
      let result: string;
      if (direction === 'json2code') {
        result = await generateCode(content, lang, className);
        if (rightEditor) {
          const model = rightEditor.getModel();
          if (model) {
            const langInfo = CODEGEN_LANGUAGES.find(l => l.id === lang);
            monaco?.editor.setModelLanguage(model, langInfo?.monacoLang || 'plaintext');
          }
          rightEditor.setValue(result);
        }
      } else {
        result = await codeToJson(content, lang, className);
        if (rightEditor) {
          const model = rightEditor.getModel();
          if (model) {
            monaco?.editor.setModelLanguage(model, 'json');
          }
          rightEditor.setValue(result);
        }
      }
    } catch (e: any) {
      genError = typeof e === 'string' ? e : e?.message || 'Conversion failed';
      if (rightEditor) rightEditor.setValue('');
    } finally {
      isGenerating = false;
    }
  }

  function handleLeftChange(value: string) {
    if (isSyncingLeft) return;
    if (direction === 'json2code') {
      onInputChange(value);
    }
    if (genTimer) clearTimeout(genTimer);
    genTimer = setTimeout(() => doConvert(value), 300);
  }

  function handleClassNameInput(e: Event) {
    className = (e.target as HTMLInputElement).value;
  }

  let canReverse = $derived(supportsReverse(selectedLang));

  function toggleDirection() {
    if (!canReverse) return;
    const oldLeft = leftEditor?.getValue() || '';
    const oldRight = rightEditor?.getValue() || '';

    direction = direction === 'json2code' ? 'code2json' : 'json2code';

    if (leftEditor && rightEditor && monaco) {
      isSyncingLeft = true;
      // Swap content
      leftEditor.setValue(oldRight);
      rightEditor.setValue('');

      // Update left editor language
      const leftModel = leftEditor.getModel();
      if (leftModel) {
        if (direction === 'json2code') {
          monaco.editor.setModelLanguage(leftModel, 'json');
        } else {
          const langInfo = CODEGEN_LANGUAGES.find(l => l.id === selectedLang);
          monaco.editor.setModelLanguage(leftModel, langInfo?.monacoLang || 'plaintext');
        }
      }

      leftEditor.updateOptions({ readOnly: false });
      rightEditor.updateOptions({ readOnly: true });

      isSyncingLeft = false;
      genError = '';

      // Trigger conversion with new content
      doConvert(oldRight);
    }
  }

  async function copyResult() {
    const text = rightEditor?.getValue() || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      onToast($t('codegen.copied'));
      setTimeout(() => { copied = false; }, 1500);
    } catch (_) {}
  }

  function updateLeftLanguage() {
    if (!leftEditor || !monaco) return;
    const model = leftEditor.getModel();
    if (!model) return;
    if (direction === 'code2json') {
      const langInfo = CODEGEN_LANGUAGES.find(l => l.id === selectedLang);
      monaco.editor.setModelLanguage(model, langInfo?.monacoLang || 'plaintext');
    }
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
      language: 'typescript',
      readOnly: true,
    });

    leftEditor!.onDidChangeModelContent(() => {
      if (isSyncingLeft) return;
      handleLeftChange(leftEditor!.getValue());
    });

    doConvert(inputValue);
  });

  onDestroy(() => {
    if (genTimer) clearTimeout(genTimer);
    leftEditor?.dispose();
    rightEditor?.dispose();
  });

  // When language changes in code2json mode, update left editor language
  $effect(() => {
    const _lang = selectedLang;
    if (direction === 'code2json') {
      updateLeftLanguage();
    }
  });
</script>

<div class="cg">
  <div class="cg-body">
    <!-- Left pane -->
    <div class="cg-pane">
      <div class="cg-pane-header">
        <div class="cg-pane-header-left">
          <button class="cg-back-btn" onclick={onExit} title={$t('toolbar.exitCodegen')}>
            <svg class="cg-back-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5"/>
              <path d="M12 19l-7-7 7-7"/>
            </svg>
          </button>
          {#if direction === 'json2code'}
            <div class="cg-pane-badge cg-badge-json">JSON</div>
          {:else}
            <select
              class="cg-lang-select"
              value={selectedLang}
              onchange={(e) => { selectedLang = (e.target as HTMLSelectElement).value as CodegenLanguage; }}
            >
              {#each CODEGEN_LANGUAGES as lang}
                <option value={lang.id}>{lang.label}</option>
              {/each}
            </select>
            <div class="cg-classname-wrap">
              <input
                class="cg-classname-input"
                type="text"
                value={className}
                oninput={handleClassNameInput}
                placeholder={$t('codegen.classNamePlaceholder')}
                spellcheck="false"
              />
            </div>
          {/if}
        </div>
      </div>
      <div class="cg-editor">
        <div bind:this={leftContainer} class="cg-editor-mount"></div>
      </div>
    </div>

    <!-- Center divider with direction toggle -->
    <div class="cg-divider">
      <div class="cg-divider-line"></div>
      <button
        class="cg-divider-icon"
        class:is-disabled={!canReverse}
        onclick={toggleDirection}
        title={canReverse ? $t('codegen.toggleDirection') : $t('codegen.reverseNotSupported')}
        disabled={!canReverse}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9h16l-4-4"/>
          <path d="M20 15H4l4 4"/>
        </svg>
      </button>
      <div class="cg-divider-line"></div>
    </div>

    <!-- Right pane -->
    <div class="cg-pane">
      <div class="cg-pane-header">
        <div class="cg-header-controls">
          {#if direction === 'json2code'}
            <select
              class="cg-lang-select"
              value={selectedLang}
              onchange={(e) => { selectedLang = (e.target as HTMLSelectElement).value as CodegenLanguage; }}
            >
              {#each CODEGEN_LANGUAGES as lang}
                <option value={lang.id}>{lang.label}</option>
              {/each}
            </select>
            <div class="cg-classname-wrap">
              <input
                class="cg-classname-input"
                type="text"
                value={className}
                oninput={handleClassNameInput}
                placeholder={$t('codegen.classNamePlaceholder')}
                spellcheck="false"
              />
            </div>
          {:else}
            <div class="cg-pane-badge cg-badge-json">JSON</div>
          {/if}
        </div>
        <div class="cg-pane-actions">
          <button
            class="cg-action-btn {copied ? 'is-copied' : ''}"
            onclick={copyResult}
            title={$t('codegen.copyResult')}
            disabled={!!genError}
          >
            {#if copied}
              <svg class="cg-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            {:else}
              <svg class="cg-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            {/if}
          </button>
        </div>
      </div>

      {#if genError}
        <div class="cg-error">
          <svg class="cg-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{genError}</span>
        </div>
      {/if}

      <div class="cg-editor">
        <div bind:this={rightContainer} class="cg-editor-mount"></div>
      </div>
    </div>
  </div>
</div>

<style>
  .cg {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .cg-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .cg-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .cg-pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    min-height: 34px;
  }

  .cg-pane-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .cg-back-btn {
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

  .cg-back-btn:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .cg-back-icon {
    width: 15px;
    height: 15px;
  }

  .cg-pane-badge {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .cg-badge-json {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .cg-header-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cg-lang-select {
    height: 26px;
    padding: 0 24px 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    outline: none;
    transition: border-color 0.15s ease;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
  }

  .cg-lang-select:focus {
    border-color: var(--accent);
  }

  .cg-lang-select option {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .cg-classname-wrap {
    display: flex;
    align-items: center;
  }

  .cg-classname-input {
    width: 120px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .cg-classname-input:focus {
    border-color: var(--accent);
  }

  .cg-classname-input::placeholder {
    color: var(--text-secondary);
    opacity: 0.5;
  }

  .cg-pane-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Center divider */
  .cg-divider {
    width: 1px;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    background: var(--border);
    position: relative;
  }

  .cg-divider-line {
    flex: 1;
  }

  .cg-divider-icon {
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
    animation: cg-pulse 2s ease-in-out 3;
  }

  .cg-divider-icon:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
    transform: translate(-50%, -50%) scale(1.15);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .cg-divider-icon:active:not(:disabled) {
    transform: translate(-50%, -50%) scale(0.95);
  }

  .cg-divider-icon.is-disabled {
    opacity: 0.35;
    cursor: not-allowed;
    animation: none;
    background: var(--bg-secondary);
    border-color: var(--border);
    color: var(--text-secondary);
  }

  .cg-divider-icon svg {
    width: 16px;
    height: 16px;
  }

  @keyframes cg-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 30%, transparent); }
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent); }
  }

  /* Action button */
  .cg-action-btn {
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

  .cg-action-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .cg-action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .cg-action-btn.is-copied {
    color: var(--success);
  }

  .cg-action-icon {
    width: 14px;
    height: 14px;
  }

  /* Error */
  .cg-error {
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

  .cg-error-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.8;
  }

  /* Editor */
  .cg-editor {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .cg-editor-mount {
    width: 100%;
    height: 100%;
  }
</style>

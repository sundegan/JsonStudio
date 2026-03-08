<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import { initMonaco } from '$lib/services/monaco';
  import { registerMonacoThemes, type EditorTheme } from '$lib/config/monacoThemes';

  let {
    originalValue = '',
    modifiedValue = '',
    language = 'json',
    theme = 'vs',
    readOnly = false,
    fontSize = 13,
    lineHeight = 20,
    tabSize = 2,
    onOriginalChange = (_value: string) => {},
    onModifiedChange = (_value: string) => {},
    onDiffUpdate = (_changes: Monaco.editor.ILineChange[]) => {},
  }: {
    originalValue?: string;
    modifiedValue?: string;
    language?: string;
    theme?: EditorTheme;
    readOnly?: boolean;
    fontSize?: number;
    lineHeight?: number;
    tabSize?: number;
    onOriginalChange?: (value: string) => void;
    onModifiedChange?: (value: string) => void;
    onDiffUpdate?: (changes: Monaco.editor.ILineChange[]) => void;
  } = $props();

  let container: HTMLDivElement;
  let diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null;
  let monaco = $state<typeof Monaco | null>(null);
  let originalModel: Monaco.editor.ITextModel | null = null;
  let modifiedModel: Monaco.editor.ITextModel | null = null;
  let isSyncingOriginal = false;
  let isSyncingModified = false;

  $effect(() => {
    // Always read originalValue first to establish dependency tracking
    // (avoid short-circuit evaluation preventing dependency registration)
    const currentOriginalValue = originalValue;
    if (originalModel && currentOriginalValue !== originalModel.getValue()) {
      isSyncingOriginal = true;
      // Use pushEditOperations to preserve undo history
      const fullRange = originalModel.getFullModelRange();
      originalModel.pushEditOperations(
        [],
        [{ range: fullRange, text: currentOriginalValue }],
        () => null
      );
      isSyncingOriginal = false;
    }
  });

  $effect(() => {
    // Always read modifiedValue first to establish dependency tracking
    // (avoid short-circuit evaluation preventing dependency registration)
    const currentModifiedValue = modifiedValue;
    if (modifiedModel && currentModifiedValue !== modifiedModel.getValue()) {
      isSyncingModified = true;
      // Use pushEditOperations to preserve undo history
      const fullRange = modifiedModel.getFullModelRange();
      modifiedModel.pushEditOperations(
        [],
        [{ range: fullRange, text: currentModifiedValue }],
        () => null
      );
      isSyncingModified = false;
    }
  });

  $effect(() => {
    if (monaco && theme) {
      monaco.editor.setTheme(theme);
    }
  });

  $effect(() => {
    if (diffEditor) {
      diffEditor.updateOptions({
        readOnly,
        originalEditable: !readOnly,
        fontSize,
        lineHeight,
      });
    }
  });

  $effect(() => {
    if (originalModel) {
      originalModel.updateOptions({
        tabSize,
        indentSize: tabSize,
        insertSpaces: true,
      });
    }
    if (modifiedModel) {
      modifiedModel.updateOptions({
        tabSize,
        indentSize: tabSize,
        insertSpaces: true,
      });
    }
  });

  onMount(async () => {
    const monacoInstance = await initMonaco();
    monaco = monacoInstance;

    registerMonacoThemes(monacoInstance);
    monacoInstance.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemaValidation: 'error',
      enableSchemaRequest: false,
    });

    const createdDiffEditor = monacoInstance.editor.createDiffEditor(container, {
      theme,
      automaticLayout: true,
      readOnly,
      originalEditable: !readOnly,
      renderSideBySide: true,
      minimap: { enabled: false },
      renderOverviewRuler: false,
      renderGutterMenu: false,
      renderMarginRevertIcon: false,
      scrollBeyondLastLine: false,
      fontSize,
      lineHeight,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
      contextmenu: false,
      renderIndicators: false,
      lineNumbersMinChars: 3,
      glyphMargin: false,
      lineDecorationsWidth: 0,
    });

    diffEditor = createdDiffEditor;
    const createdOriginalModel = monacoInstance.editor.createModel(originalValue, language);
    const createdModifiedModel = monacoInstance.editor.createModel(modifiedValue, language);
    originalModel = createdOriginalModel;
    modifiedModel = createdModifiedModel;
    createdDiffEditor.setModel({ original: createdOriginalModel, modified: createdModifiedModel });

    const editorOptions: Monaco.editor.IEditorOptions = {
      glyphMargin: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 3,
      folding: true,
      showFoldingControls: 'always',
      foldingStrategy: 'indentation',
    };
    createdDiffEditor.getOriginalEditor().updateOptions(editorOptions);
    createdDiffEditor.getModifiedEditor().updateOptions(editorOptions);

    createdOriginalModel.onDidChangeContent(() => {
      if (isSyncingOriginal) return;
      onOriginalChange(createdOriginalModel.getValue());
    });

    createdModifiedModel.onDidChangeContent(() => {
      if (isSyncingModified) return;
      onModifiedChange(createdModifiedModel.getValue());
    });

    createdDiffEditor.onDidUpdateDiff(() => {
      const changes = createdDiffEditor.getLineChanges() || [];
      onDiffUpdate(changes);
    });
  });

  onDestroy(() => {
    diffEditor?.dispose();
    originalModel?.dispose();
    modifiedModel?.dispose();
  });
</script>

<div bind:this={container} class="diff-editor-container"></div>

<style>
  .diff-editor-container {
    width: 100%;
    height: 100%;
    min-height: 200px;
  }

  .diff-editor-container :global(.margin > .toolbar) {
    display: none !important;
    width: 0 !important;
  }
</style>

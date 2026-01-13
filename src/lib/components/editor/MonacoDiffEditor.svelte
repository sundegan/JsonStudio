<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import loader from '@monaco-editor/loader';
  import type * as Monaco from 'monaco-editor';
  import { registerMonacoThemes, type EditorTheme } from '$lib/config/monacoThemes';

  let {
    originalValue = '',
    modifiedValue = '',
    language = 'json',
    theme = 'vs',
    readOnly = false,
    fontSize = 13,
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
    const monacoInstance = await loader.init();
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
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
      contextmenu: false,
      renderIndicators: false,
    });

    diffEditor = createdDiffEditor;
    const createdOriginalModel = monacoInstance.editor.createModel(originalValue, language);
    const createdModifiedModel = monacoInstance.editor.createModel(modifiedValue, language);
    originalModel = createdOriginalModel;
    modifiedModel = createdModifiedModel;
    createdDiffEditor.setModel({ original: createdOriginalModel, modified: createdModifiedModel });

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

<div bind:this={container} class="w-full h-full min-h-[200px]"></div>

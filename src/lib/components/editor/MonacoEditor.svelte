<script lang="ts">
  // Monaco Editor Svelte wrapper component
  import { onMount, onDestroy } from 'svelte';
  import loader from '@monaco-editor/loader';
  import type * as Monaco from 'monaco-editor';
  import { registerMonacoThemes, type EditorTheme } from '$lib/config/monacoThemes';
  
  // Props
  let {
    value = '',
    language = 'json',
    theme = 'vs',
    readOnly = false,
    minimap = false,
    folding = true,
    lineNumbers = true,
    wordWrap = 'on',
    automaticLayout = true,
    fontSize = 13,
    tabSize = 2,
    onChange = (value: string) => {},
    onPaste = (_event?: unknown) => {},
  }: {
    value?: string;
    language?: string;
    theme?: EditorTheme;
    readOnly?: boolean;
    minimap?: boolean;
    folding?: boolean;
    lineNumbers?: boolean;
    wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
    automaticLayout?: boolean;
    fontSize?: number;
    tabSize?: number;
    onChange?: (value: string) => void;
    onPaste?: (event?: unknown) => void;
  } = $props();

  let container: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let monaco = $state<typeof Monaco | null>(null);
  
  // Flag: distinguish between internal edits and external updates
  let isInternalChange = false;
  
  // Watch value changes
  $effect(() => {
    // If change triggered by internal edit, don't update editor
    if (isInternalChange) {
      isInternalChange = false;
      return;
    }
    
    // Only update editor when external value actually changes
    if (editor && value !== editor.getValue()) {
      const model = editor.getModel();
      if (model) {
        // Use pushEditOperations instead of setValue to preserve undo history
        const fullRange = model.getFullModelRange();
        model.pushEditOperations(
          [],
          [{ range: fullRange, text: value }],
          () => null
        );
      }
    }
  });
  
  // Watch theme changes and apply theme
  $effect(() => {
    if (monaco && theme) {
      monaco.editor.setTheme(theme);
    }
  });
  
  // Watch readOnly changes
  $effect(() => {
    if (editor) {
      editor.updateOptions({ readOnly });
    }
  });
  
  // Watch fontSize changes
  $effect(() => {
    const currentFontSize = fontSize;
    if (editor) {
      editor.updateOptions({ fontSize: currentFontSize });
    }
  });
  
  // Watch tabSize changes
  $effect(() => {
    const currentTabSize = tabSize;
    if (editor) {
      // Update editor options
      editor.updateOptions({ tabSize: currentTabSize });
      // Also update model options for tabSize to take effect (important for formatting)
      const model = editor.getModel();
      if (model) {
        model.updateOptions({ 
          tabSize: currentTabSize,
          indentSize: currentTabSize,
          insertSpaces: true 
        });
      }
    }
  });
  
  // Watch other editor option changes
  $effect(() => {
    if (editor) {
      editor.updateOptions({
        minimap: { enabled: minimap },
        lineNumbers: lineNumbers ? 'on' : 'off',
        wordWrap,
      });
    }
  });
  
  onMount(async () => {
    // Use loader to load Monaco (automatically handles worker)
    const monacoInstance = await loader.init();
    monaco = monacoInstance;
    
    // Register custom themes (loaded from config file)
    registerMonacoThemes(monacoInstance);
    
    // Configure JSON language features
    monacoInstance.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemaValidation: 'error',
      enableSchemaRequest: false,
    });
    
    // Create editor
    editor = monacoInstance.editor.create(container, {
      value,
      language,
      theme,
      readOnly,
      minimap: { enabled: minimap },
      folding,
      lineNumbers: lineNumbers ? 'on' : 'off',
      wordWrap,
      automaticLayout,
      fontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
      tabSize,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      padding: { top: 12, bottom: 12 },
      showFoldingControls: 'always',
      foldingStrategy: 'indentation',
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        useShadows: false,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      contextmenu: true,
      formatOnPaste: false,
      formatOnType: false,
    });
    
    // After assignment, $effect will automatically apply theme
    if (theme) {
      monacoInstance.editor.setTheme(theme);
    }
    
    // Listen to content changes
    if (editor) {
      editor.onDidChangeModelContent(() => {
        const currentValue = editor?.getValue() || '';
        if (currentValue !== value) {
          // Mark as internal change to avoid triggering $effect to reset value
          isInternalChange = true;
          onChange(currentValue);
        }
      });

      editor.onDidPaste((event) => {
        onPaste(event);
      });
    }
  });
  
  onDestroy(() => {
    editor?.dispose();
  });
  
  export function foldAll() {
    editor?.getAction('editor.foldAll')?.run();
  }
  
  export function unfoldAll() {
    editor?.getAction('editor.unfoldAll')?.run();
  }

  export function setValue(newValue: string) {
    editor?.setValue(newValue);
  }

  export function getValue(): string {
    return editor?.getValue() || '';
  }

  // Monaco Editor native format function
  export async function format(): Promise<void> {
    if (!editor) return;
    await editor.getAction('editor.action.formatDocument')?.run();
  }

  // Monaco Editor native minify function (remove all whitespace)
  export function minify(): string {
    if (!editor) return '';
    const content = editor.getValue();
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed);
    } catch (e) {
      return content;
    }
  }

  // Monaco Editor native validate function
  export function validate(): { valid: boolean; errors: string[] } {
    if (!editor || !monaco) {
      return { valid: true, errors: [] };
    }
    
    const model = editor.getModel();
    if (!model) {
      return { valid: true, errors: [] };
    }
    
    const monacoInstance = monaco;
    const markers = monacoInstance.editor.getModelMarkers({ resource: model.uri });
    const errors = markers
      .filter(m => m.severity === monacoInstance.MarkerSeverity.Error)
      .map(m => `Line ${m.startLineNumber}, Col ${m.startColumn}: ${m.message}`);
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Get editor instance
  export function getEditorInstance() {
    return editor;
  }
</script>

<div bind:this={container} class="w-full h-full min-h-[200px]"></div>

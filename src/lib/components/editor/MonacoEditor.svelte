<script lang="ts">
  // Monaco Editor Svelte wrapper component
  import { onMount, onDestroy } from 'svelte';
  import type * as Monaco from 'monaco-editor';
  import { initMonaco } from '$lib/services/monaco';
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
    lineHeight = 20,
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
    lineHeight?: number;
    tabSize?: number;
    onChange?: (value: string) => void;
    onPaste?: (event?: unknown) => void;
  } = $props();

  function registerJson5Language(monacoInstance: typeof Monaco) {
    // Avoid duplicate registration — Monaco language registry is global.
    // Check if 'json5' is already registered by looking at known language IDs.
    const langs = monacoInstance.languages.getLanguages();
    if (langs.some(l => l.id === 'json5')) return;
    
    monacoInstance.languages.register({ id: 'json5' });
    
    monacoInstance.languages.setLanguageConfiguration('json5', {
      brackets: [['{', '}'], ['[', ']']],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      folding: {
        markers: { start: /^\s*[{[]/, end: /^\s*[}\]]/ },
      },
    });
    
    monacoInstance.languages.setMonarchTokensProvider('json5', {
      tokenizer: {
        root: [
          // Comments
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
          
          // Quoted keys: string followed by optional whitespace and colon
          [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'string.key.json'],
          [/'(?:[^'\\]|\\.)*'(?=\s*:)/, 'string.key.json'],

          // Strings (double-quoted)
          [/"/, 'string', '@string_double'],
          // Strings (single-quoted, JSON5)
          [/'/, 'string', '@string_single'],
          
          // Unquoted keys: ASCII + Unicode identifier names (JSON5)
          [/[$_\p{L}][$\p{L}\p{N}\p{M}_]*(?=\s*:)/u, 'string.key.json'],
          
          // Special numeric literals
          [/[+-]?Infinity\b/, 'number'],
          [/NaN\b/, 'number'],
          // Hex numbers
          [/[+-]?0[xX][0-9a-fA-F]+\b/, 'number'],
          // Decimal numbers (with optional leading/trailing dot, exponent)
          [/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, 'number'],
          
          // Keywords
          [/\btrue\b/, 'keyword'],
          [/\bfalse\b/, 'keyword'],
          [/\bnull\b/, 'keyword'],
          
          // Brackets and delimiters
          [/[{}[\]]/, '@brackets'],
          [/[,:]/, 'delimiter'],
        ],
        
        comment: [
          [/[^/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[/*]/, 'comment'],
        ],
        
        string_double: [
          [/[^\\"]+/, 'string'],
          [/\\./, 'string.escape'],
          [/"/, 'string', '@pop'],
        ],
        
        string_single: [
          [/[^\\']+/, 'string'],
          [/\\./, 'string.escape'],
          [/'/, 'string', '@pop'],
        ],
      },
    });
  }

  let container: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let monaco = $state<typeof Monaco | null>(null);
  let externalSelectionDecorations: Monaco.editor.IEditorDecorationsCollection | null = null;
  let editorDomNode: HTMLElement | null = null;
  let findWidgetHoverHandler: ((event: MouseEvent) => void) | null = null;
  
  // Flag: distinguish between internal edits and external updates
  let isInternalChange = false;
  const findWidgetHoverSelectors = [
    '.find-widget .button.codicon-widget-close',
    '.find-widget .monaco-custom-toggle.codicon-find-selection',
    '.find-widget .codicon-find-selection',
  ].join(', ');
  
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
  
  // Watch lineHeight changes
  $effect(() => {
    const currentLineHeight = lineHeight;
    if (editor) {
      editor.updateOptions({ lineHeight: currentLineHeight });
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
    const monacoInstance = await initMonaco();
    monaco = monacoInstance;
    
    // Register custom themes (loaded from config file)
    registerMonacoThemes(monacoInstance);
    
    // Configure JSON language features
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (monacoInstance.languages.json as any).jsonDefaults?.setDiagnosticsOptions({
      validate: true,
      schemaValidation: 'error',
      enableSchemaRequest: false,
    });
    
    // Register custom JSON5 language for proper syntax highlighting.
    // We can't use 'json' mode (flags JSON5 syntax as errors) or 'javascript'
    // mode (top-level `{}` is parsed as a block, not an object — keys lose highlighting).
    registerJson5Language(monacoInstance);
    
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
      lineHeight,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
      tabSize,
      scrollBeyondLastLine: false,
      lineNumbersMinChars: 3,
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
      contextmenu: false,
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

    editorDomNode = editor?.getDomNode() as HTMLElement | null;
    if (editorDomNode) {
      findWidgetHoverHandler = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target.closest(findWidgetHoverSelectors)) {
          event.stopImmediatePropagation();
        }
      };
      editorDomNode.addEventListener('mouseover', findWidgetHoverHandler, true);
    }
  });
  
  onDestroy(() => {
    if (editorDomNode && findWidgetHoverHandler) {
      editorDomNode.removeEventListener('mouseover', findWidgetHoverHandler, true);
    }
    findWidgetHoverHandler = null;
    editorDomNode = null;
    externalSelectionDecorations?.clear();
    externalSelectionDecorations = null;
    editor?.dispose();
  });
  
  export function foldAll() {
    editor?.getAction('editor.foldAll')?.run();
  }
  
  export function unfoldAll() {
    editor?.getAction('editor.unfoldAll')?.run();
  }

  export function setValue(newValue: string) {
    if (!editor) return;
    const model = editor.getModel();
    if (model) {
      // Use pushEditOperations to preserve undo history
      const fullRange = model.getFullModelRange();
      model.pushEditOperations(
        [],
        [{ range: fullRange, text: newValue }],
        () => null
      );
    }
  }

  export function replaceRangeByOffsets(start: number, end: number, text: string) {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    const startPosition = model.getPositionAt(start);
    const endPosition = model.getPositionAt(end);
    model.pushEditOperations(
      [],
      [{
        range: {
          startLineNumber: startPosition.lineNumber,
          startColumn: startPosition.column,
          endLineNumber: endPosition.lineNumber,
          endColumn: endPosition.column,
        },
        text,
      }],
      () => null,
    );
  }

  export function getValue(): string {
    return editor?.getValue() || '';
  }

  export function setLanguage(lang: string) {
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, lang);
    }
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

  export function setExternalSelectionHighlights(ranges: Monaco.Range[]) {
    if (!editor || !monaco) return;

    const decorations = ranges.map((range) => ({
      range,
      options: {
        className: 'json-external-selection',
        isWholeLine: false,
      },
    }));

    if (!externalSelectionDecorations) {
      externalSelectionDecorations = editor.createDecorationsCollection(decorations);
      return;
    }

    externalSelectionDecorations.set(decorations);
  }

  export function clearExternalSelectionHighlights() {
    externalSelectionDecorations?.clear();
  }
</script>

<div bind:this={container} class="w-full h-full min-h-[200px]"></div>

<style>
  :global(.json-external-selection) {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
    border-radius: 2px;
  }
</style>

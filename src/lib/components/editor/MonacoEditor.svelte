<script lang="ts">
  // Monaco Editor Svelte 包装组件
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
  } = $props();

  let container: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
  let monaco = $state<typeof Monaco | null>(null);
  
  // 标志位：用于区分内部编辑和外部更新
  let isInternalChange = false;
  
  // 监听 value 变化
  $effect(() => {
    // 如果是内部编辑触发的变化，不需要更新编辑器
    if (isInternalChange) {
      isInternalChange = false;
      return;
    }
    
    // 只在外部值真正变化时才更新编辑器
    if (editor && value !== editor.getValue()) {
      const model = editor.getModel();
      if (model) {
        // 使用 pushEditOperations 而不是 setValue 来保留撤销历史
        const fullRange = model.getFullModelRange();
        model.pushEditOperations(
          [],
          [{ range: fullRange, text: value }],
          () => null
        );
      }
    }
  });
  
  // 监听 theme 变化并应用主题
  $effect(() => {
    if (monaco && theme) {
      monaco.editor.setTheme(theme);
    }
  });
  
  // 监听 readOnly 变化
  $effect(() => {
    if (editor) {
      editor.updateOptions({ readOnly });
    }
  });
  
  // 监听编辑器选项变化
  $effect(() => {
    if (editor) {
      editor.updateOptions({
        fontSize,
        tabSize,
        minimap: { enabled: minimap },
        lineNumbers: lineNumbers ? 'on' : 'off',
        wordWrap,
      });
    }
  });
  
  onMount(async () => {
    // 使用 loader 加载 Monaco（自动处理 worker）
    const monacoInstance = await loader.init();
    monaco = monacoInstance;
    
    // 注册自定义主题（从配置文件加载）
    registerMonacoThemes(monacoInstance);
    
    // 配置 JSON 语言特性
    monacoInstance.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemaValidation: 'error',
      enableSchemaRequest: false,
    });
    
    // 创建编辑器
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
    
    // 赋值后会自动触发 $effect 应用主题
    if (theme) {
      monacoInstance.editor.setTheme(theme);
    }
    
    // 监听内容变化
    if (editor) {
      editor.onDidChangeModelContent(() => {
        const currentValue = editor?.getValue() || '';
        if (currentValue !== value) {
          // 标记为内部变化，避免触发 $effect 重新设置值
          isInternalChange = true;
          onChange(currentValue);
        }
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

  // Monaco Editor 原生格式化功能
  export async function format(): Promise<void> {
    if (!editor) return;
    await editor.getAction('editor.action.formatDocument')?.run();
  }

  // Monaco Editor 原生压缩功能（移除所有空白）
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

  // Monaco Editor 原生校验功能
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

  // 获取编辑器实例
  export function getEditorInstance() {
    return editor;
  }
</script>

<div bind:this={container} class="w-full h-full min-h-[200px]"></div>

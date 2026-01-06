// Monaco Editor theme configuration
// Unified management of all editor theme definitions

import type * as Monaco from 'monaco-editor';

// Theme configuration type
export interface MonacoThemeConfig {
  base: 'vs' | 'vs-dark' | 'hc-black';
  inherit: boolean;
  rules: Monaco.editor.ITokenThemeRule[];
  colors: Monaco.editor.IColors;
}

// Theme configuration mapping
export const monacoThemes: Record<string, MonacoThemeConfig> = {
  // One Dark Pro theme (Atom style)
  'one-dark': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c678dd' },
      { token: 'string', foreground: '98c379' },
      { token: 'string.key.json', foreground: 'e06c75' },
      { token: 'string.value.json', foreground: '98c379' },
      { token: 'number', foreground: 'd19a66' },
      { token: 'delimiter', foreground: 'abb2bf' },
      { token: 'type', foreground: 'e5c07b' },
    ],
    colors: {
      'editor.background': '#282c34',
      'editor.foreground': '#abb2bf',
      'editor.lineHighlightBackground': '#2c313a',
      'editor.selectionBackground': '#3e4451',
      'editorCursor.foreground': '#528bff',
      'editorLineNumber.foreground': '#495162',
      'editorLineNumber.activeForeground': '#abb2bf',
      'editor.inactiveSelectionBackground': '#3a3f4b',
      'editorIndentGuide.background': '#3b4048',
      'editorIndentGuide.activeBackground': '#4b5263',
      'editorGutter.background': '#282c34',
      'scrollbarSlider.background': '#4b526380',
      'scrollbarSlider.hoverBackground': '#5a637580',
    }
  },

  // GitHub Dark theme
  'github-dark': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff7b72' },
      { token: 'string', foreground: 'a5d6ff' },
      { token: 'string.key.json', foreground: '7ee787' },
      { token: 'string.value.json', foreground: 'a5d6ff' },
      { token: 'number', foreground: '79c0ff' },
      { token: 'delimiter', foreground: 'c9d1d9' },
      { token: 'type', foreground: 'ffa657' },
    ],
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#c9d1d9',
      'editor.lineHighlightBackground': '#161b22',
      'editor.selectionBackground': '#264f78',
      'editorCursor.foreground': '#58a6ff',
      'editorLineNumber.foreground': '#484f58',
      'editorLineNumber.activeForeground': '#c9d1d9',
      'editor.inactiveSelectionBackground': '#1f2428',
      'editorIndentGuide.background': '#21262d',
      'editorIndentGuide.activeBackground': '#30363d',
      'editorGutter.background': '#0d1117',
      'scrollbarSlider.background': '#484f5880',
      'scrollbarSlider.hoverBackground': '#6e768180',
    }
  },

  // Tokyo Night theme
  'tokyo-night': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'bb9af7' },
      { token: 'string', foreground: '9ece6a' },
      { token: 'string.key.json', foreground: '7aa2f7' },
      { token: 'string.value.json', foreground: '9ece6a' },
      { token: 'number', foreground: 'ff9e64' },
      { token: 'delimiter', foreground: 'a9b1d6' },
      { token: 'type', foreground: '2ac3de' },
    ],
    colors: {
      'editor.background': '#1a1b26',
      'editor.foreground': '#a9b1d6',
      'editor.lineHighlightBackground': '#1e2030',
      'editor.selectionBackground': '#33467c',
      'editorCursor.foreground': '#c0caf5',
      'editorLineNumber.foreground': '#3b4261',
      'editorLineNumber.activeForeground': '#737aa2',
      'editor.inactiveSelectionBackground': '#292e42',
      'editorIndentGuide.background': '#292e42',
      'editorIndentGuide.activeBackground': '#3b4261',
      'editorGutter.background': '#1a1b26',
      'scrollbarSlider.background': '#3b426180',
      'scrollbarSlider.hoverBackground': '#565f8980',
    }
  },

  // GitHub Light theme
  'github-light': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'cf222e' },
      { token: 'string', foreground: '0a3069' },
      { token: 'string.key.json', foreground: '116329' },
      { token: 'string.value.json', foreground: '0a3069' },
      { token: 'number', foreground: '0550ae' },
      { token: 'delimiter', foreground: '24292f' },
      { token: 'type', foreground: '953800' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#24292f',
      'editor.lineHighlightBackground': '#f6f8fa',
      'editor.selectionBackground': '#add6ff',
      'editorCursor.foreground': '#0969da',
      'editorLineNumber.foreground': '#8c959f',
      'editorLineNumber.activeForeground': '#24292f',
      'editor.inactiveSelectionBackground': '#e8eaed',
      'editorIndentGuide.background': '#d8dee4',
      'editorIndentGuide.activeBackground': '#afb8c1',
      'editorGutter.background': '#ffffff',
      'scrollbarSlider.background': '#8c959f40',
      'scrollbarSlider.hoverBackground': '#8c959f80',
    }
  },
};

/**
 * Register all custom themes to Monaco Editor
 * @param monaco Monaco Editor instance
 */
export function registerMonacoThemes(monaco: typeof Monaco): void {
  Object.entries(monacoThemes).forEach(([themeId, themeConfig]) => {
    monaco.editor.defineTheme(themeId, themeConfig);
  });
}

/**
 * Editor theme type (based on themes defined in config)
 * Includes Monaco built-in themes and custom themes
 */
export type EditorTheme = 'vs' | 'vs-dark' | 'hc-black' | keyof typeof monacoThemes;

/**
 * Get all defined theme ID list
 */
export function getAvailableThemeIds(): string[] {
  return Object.keys(monacoThemes);
}


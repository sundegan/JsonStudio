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
  // JsonStudio Dark (Modern)
  'json-studio-dark': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6868a0', fontStyle: 'italic' },
      { token: 'keyword', foreground: '10b981' },
      { token: 'string', foreground: '34d399' },
      { token: 'string.key.json', foreground: '60a5fa' },
      { token: 'string.value.json', foreground: '34d399' },
      { token: 'number', foreground: 'fb923c' },
      { token: 'delimiter', foreground: '9898b0' },
      { token: 'type', foreground: 'a78bfa' },
    ],
    colors: {
      'editor.background': '#111118',
      'editor.foreground': '#e8e8f0',
      'editor.lineHighlightBackground': '#1a1a26',
      'editor.selectionBackground': '#2a2a3a',
      'editorCursor.foreground': '#10b981',
      'editorLineNumber.foreground': '#6868a0',
      'editorLineNumber.activeForeground': '#e8e8f0',
      'editor.inactiveSelectionBackground': '#222232',
      'editorIndentGuide.background': '#222232',
      'editorIndentGuide.activeBackground': '#3a3a4a',
      'editorGutter.background': '#111118',
      'scrollbarSlider.background': '#2a2a3a80',
      'scrollbarSlider.hoverBackground': '#3a3a4a80',
    }
  },

  // JsonStudio Light (Modern)
  'json-studio-light': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '9898b0', fontStyle: 'italic' },
      { token: 'keyword', foreground: '10b981' },
      { token: 'string', foreground: '10b981' },
      { token: 'string.key.json', foreground: '3b82f6' },
      { token: 'string.value.json', foreground: '10b981' },
      { token: 'number', foreground: 'f59e0b' },
      { token: 'delimiter', foreground: '6868a0' },
      { token: 'type', foreground: '8b5cf6' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#222232',
      'editor.lineHighlightBackground': '#f0f0f5',
      'editor.selectionBackground': '#e6e6ee',
      'editorCursor.foreground': '#10b981',
      'editorLineNumber.foreground': '#9898b0',
      'editorLineNumber.activeForeground': '#222232',
      'editor.inactiveSelectionBackground': '#f4f4f8',
      'editorIndentGuide.background': '#e0e0ea',
      'editorIndentGuide.activeBackground': '#d0d0dc',
      'editorGutter.background': '#ffffff',
      'scrollbarSlider.background': '#d0d0dc80',
      'scrollbarSlider.hoverBackground': '#9898b080',
    }
  },

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

  // Dracula theme
  'dracula': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff79c6' },
      { token: 'string', foreground: 'f1fa8c' },
      { token: 'string.key.json', foreground: '8be9fd' },
      { token: 'string.value.json', foreground: 'f1fa8c' },
      { token: 'number', foreground: 'bd93f9' },
      { token: 'delimiter', foreground: 'f8f8f2' },
      { token: 'type', foreground: 'ffb86c' },
    ],
    colors: {
      'editor.background': '#282a36',
      'editor.foreground': '#f8f8f2',
      'editor.lineHighlightBackground': '#44475a',
      'editor.selectionBackground': '#44475a',
      'editorCursor.foreground': '#f8f8f2',
      'editorLineNumber.foreground': '#6272a4',
      'editorLineNumber.activeForeground': '#f8f8f2',
      'editor.inactiveSelectionBackground': '#3a3d4b',
      'editorIndentGuide.background': '#3b3f51',
      'editorIndentGuide.activeBackground': '#545772',
      'editorGutter.background': '#282a36',
      'scrollbarSlider.background': '#6272a440',
      'scrollbarSlider.hoverBackground': '#6272a480',
    }
  },

  // Nord theme
  'nord': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '616e88', fontStyle: 'italic' },
      { token: 'keyword', foreground: '81a1c1' },
      { token: 'string', foreground: 'a3be8c' },
      { token: 'string.key.json', foreground: '88c0d0' },
      { token: 'string.value.json', foreground: 'a3be8c' },
      { token: 'number', foreground: 'b48ead' },
      { token: 'delimiter', foreground: 'd8dee9' },
      { token: 'type', foreground: 'ebcb8b' },
    ],
    colors: {
      'editor.background': '#2e3440',
      'editor.foreground': '#d8dee9',
      'editor.lineHighlightBackground': '#353b49',
      'editor.selectionBackground': '#434c5e',
      'editorCursor.foreground': '#d8dee9',
      'editorLineNumber.foreground': '#4c566a',
      'editorLineNumber.activeForeground': '#d8dee9',
      'editor.inactiveSelectionBackground': '#3b4252',
      'editorIndentGuide.background': '#3b4252',
      'editorIndentGuide.activeBackground': '#4c566a',
      'editorGutter.background': '#2e3440',
      'scrollbarSlider.background': '#4c566a40',
      'scrollbarSlider.hoverBackground': '#4c566a80',
    }
  },

  // Solarized Light theme
  'solarized-light': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
      { token: 'keyword', foreground: '859900' },
      { token: 'string', foreground: '2aa198' },
      { token: 'string.key.json', foreground: '268bd2' },
      { token: 'string.value.json', foreground: '2aa198' },
      { token: 'number', foreground: 'd33682' },
      { token: 'delimiter', foreground: '586e75' },
      { token: 'type', foreground: 'b58900' },
    ],
    colors: {
      'editor.background': '#fdf6e3',
      'editor.foreground': '#586e75',
      'editor.lineHighlightBackground': '#eee8d5',
      'editor.selectionBackground': '#d1cbaf',
      'editorCursor.foreground': '#586e75',
      'editorLineNumber.foreground': '#93a1a1',
      'editorLineNumber.activeForeground': '#586e75',
      'editor.inactiveSelectionBackground': '#e8e2cc',
      'editorIndentGuide.background': '#e6dfca',
      'editorIndentGuide.activeBackground': '#d3cbb7',
      'editorGutter.background': '#fdf6e3',
      'scrollbarSlider.background': '#93a1a140',
      'scrollbarSlider.hoverBackground': '#93a1a180',
    }
  },

  // Catppuccin Latte theme
  'catppuccin-latte': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '9ca0b0', fontStyle: 'italic' },
      { token: 'keyword', foreground: '8839ef' },
      { token: 'string', foreground: '40a02b' },
      { token: 'string.key.json', foreground: '1e66f5' },
      { token: 'string.value.json', foreground: '40a02b' },
      { token: 'number', foreground: 'fe640b' },
      { token: 'delimiter', foreground: '4c4f69' },
      { token: 'type', foreground: 'df8e1d' },
    ],
    colors: {
      'editor.background': '#eff1f5',
      'editor.foreground': '#4c4f69',
      'editor.lineHighlightBackground': '#e6e9ef',
      'editor.selectionBackground': '#bcc0cc',
      'editorCursor.foreground': '#dc8a78',
      'editorLineNumber.foreground': '#9ca0b0',
      'editorLineNumber.activeForeground': '#4c4f69',
      'editor.inactiveSelectionBackground': '#ccd0da',
      'editorIndentGuide.background': '#dce0e8',
      'editorIndentGuide.activeBackground': '#bcc0cc',
      'editorGutter.background': '#eff1f5',
      'scrollbarSlider.background': '#9ca0b040',
      'scrollbarSlider.hoverBackground': '#9ca0b080',
    }
  },

  // Rose Ivy theme (light, rose-pink keys + ivy-green values)
  'rose-ivy': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '9e9e9e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a626a4' },
      { token: 'string', foreground: 'a626a4' },
      { token: 'string.key.json', foreground: '6d0a62' },
      { token: 'string.value.json', foreground: '3abf4a' },
      { token: 'number', foreground: '4078f2' },
      { token: 'delimiter', foreground: '3b3b3b' },
      { token: 'type', foreground: 'c18401' },
    ],
    colors: {
      'editor.background': '#fafafa',
      'editor.foreground': '#3b3b3b',
      'editor.lineHighlightBackground': '#f0f0f0',
      'editor.selectionBackground': '#c8dcc9',
      'editorCursor.foreground': '#2e9e38',
      'editorLineNumber.foreground': '#b0b0b0',
      'editorLineNumber.activeForeground': '#3b3b3b',
      'editor.inactiveSelectionBackground': '#e8dfe7',
      'editorIndentGuide.background': '#e0e0e0',
      'editorIndentGuide.activeBackground': '#c8c8c8',
      'editorGutter.background': '#fafafa',
      'scrollbarSlider.background': '#b0b0b040',
      'scrollbarSlider.hoverBackground': '#b0b0b080',
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


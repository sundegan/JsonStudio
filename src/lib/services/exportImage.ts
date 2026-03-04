import { invoke } from '@tauri-apps/api/core';
import { monacoThemes, type EditorTheme } from '$lib/config/monacoThemes';

interface ExportOptions {
  content: string;
  theme: EditorTheme;
  fontSize?: number;
  lineHeight?: number;
}

interface ThemeColors {
  background: string;
  foreground: string;
  keyColor: string;
  stringColor: string;
  numberColor: string;
  booleanColor: string;
  nullColor: string;
  delimiterColor: string;
}

function getThemeColors(theme: EditorTheme): ThemeColors {
  const config = monacoThemes[theme];
  const base = config?.base ?? theme;
  const isDark = base === 'vs-dark' || base === 'hc-black';

  const normalize = (value?: string): string | undefined => {
    if (!value) return undefined;
    if (value.startsWith('#')) return value;
    if (/^[0-9a-fA-F]{6,8}$/.test(value)) return `#${value}`;
    return value;
  };

  const getTokenColor = (tokens: string[], fallback: string): string => {
    if (!config?.rules?.length) return fallback;
    for (const token of tokens) {
      const rule = config.rules.find((item) => item.token === token && item.foreground);
      const color = normalize(rule?.foreground);
      if (color) return color;
    }
    return fallback;
  };

  const defaultBackground = isDark ? '#1E1E1E' : '#FFFFFF';
  const defaultForeground = isDark ? '#D4D4D4' : '#1E1E1E';

  const background = normalize(config?.colors?.['editor.background']) ?? defaultBackground;
  const foreground = normalize(config?.colors?.['editor.foreground']) ?? defaultForeground;
  const delimiterColor = getTokenColor(['delimiter'], foreground);

  return {
    background,
    foreground,
    keyColor: getTokenColor(['string.key.json', 'string'], foreground),
    stringColor: getTokenColor(['string.value.json', 'string'], foreground),
    numberColor: getTokenColor(['number'], foreground),
    booleanColor: getTokenColor(['keyword'], foreground),
    nullColor: getTokenColor(['keyword'], foreground),
    delimiterColor,
  };
}

function getBracketHighlightColors(): string[] {
  const container = document.createElement('div');
  container.className = 'monaco-editor';
  container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;';
  const spans: HTMLSpanElement[] = [];
  for (let i = 0; i < 6; i++) {
    const span = document.createElement('span');
    span.className = `bracket-highlighting-${i}`;
    span.textContent = '{}';
    spans.push(span);
    container.appendChild(span);
  }
  document.body.appendChild(container);

  const colors: string[] = [];
  for (const span of spans) {
    const color = getComputedStyle(span).color;
    if (color && color !== 'inherit' && color !== 'transparent') {
      colors.push(color);
    }
  }

  document.body.removeChild(container);
  return colors;
}

export async function exportJsonAsImage(options: ExportOptions): Promise<string> {
  const { content, theme, fontSize = 14, lineHeight = 22 } = options;

  const colors = getThemeColors(theme);
  const bracketColors = getBracketHighlightColors();
  const isDark = theme === 'vs-dark' || theme === 'hc-black' ||
    (monacoThemes[theme]?.base === 'vs-dark');

  const pngBase64 = await invoke<string>('export_json_image', {
    request: {
      content,
      colors,
      bracketColors,
      isDark,
      fontSize,
      lineHeight,
    },
  });

  return pngBase64;
}

export async function copyImageToClipboard(pngBase64: string): Promise<void> {
  await invoke('copy_image_to_clipboard', { pngBase64 });
}

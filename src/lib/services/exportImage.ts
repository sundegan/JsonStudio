import { toBlob } from 'html-to-image';
import { invoke } from '@tauri-apps/api/core';
import { monacoThemes, type EditorTheme } from '$lib/config/monacoThemes';

interface ExportOptions {
  content: string;
  theme: EditorTheme;
  fontSize?: number;
  lineHeight?: number;
  tabSize?: number;
  fileName?: string;
}

interface ThemeColors {
  background: string;
  foreground: string;
  lineNumber: string;
  keyColor: string;
  stringColor: string;
  numberColor: string;
  booleanColor: string;
  nullColor: string;
  delimiterColor: string;
}

function getThemeColors(theme: EditorTheme): ThemeColors {
  const config = monacoThemes[theme];

  if (config) {
    const rules = config.rules;
    const findColor = (token: string) =>
      rules.find(r => r.token === token)?.foreground;

    return {
      background: config.colors['editor.background'] || '#1e1e1e',
      foreground: config.colors['editor.foreground'] || '#d4d4d4',
      lineNumber: config.colors['editorLineNumber.foreground'] || '#858585',
      keyColor: `#${findColor('string.key.json') || findColor('keyword') || 'e06c75'}`,
      stringColor: `#${findColor('string.value.json') || findColor('string') || '98c379'}`,
      numberColor: `#${findColor('number') || 'd19a66'}`,
      booleanColor: `#${findColor('keyword') || 'c678dd'}`,
      nullColor: `#${findColor('keyword') || 'c678dd'}`,
      delimiterColor: `#${findColor('delimiter') || 'abb2bf'}`,
    };
  }

  if (theme === 'vs-dark' || theme === 'hc-black') {
    return {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      lineNumber: '#858585',
      keyColor: '#9cdcfe',
      stringColor: '#ce9178',
      numberColor: '#b5cea8',
      booleanColor: '#569cd6',
      nullColor: '#569cd6',
      delimiterColor: '#d4d4d4',
    };
  }

  return {
    background: '#ffffff',
    foreground: '#24292f',
    lineNumber: '#8c959f',
    keyColor: '#0550ae',
    stringColor: '#0a3069',
    numberColor: '#0550ae',
    booleanColor: '#cf222e',
    nullColor: '#cf222e',
    delimiterColor: '#24292f',
  };
}

function tokenizeJson(content: string, colors: ThemeColors): string {
  const lines = content.split('\n');
  const htmlLines: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  for (const line of lines) {
    let html = '';
    let i = 0;
    while (i < line.length) {
      const ch = line[i];

      if (ch === ' ' || ch === '\t') {
        let ws = '';
        while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
          ws += line[i] === '\t' ? '  ' : ' ';
          i++;
        }
        html += `<span style="white-space:pre">${ws}</span>`;
        continue;
      }

      if (ch === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') {
          if (line[j] === '\\') j++;
          j++;
        }
        j++;
        const str = line.slice(i, j);
        const rest = line.slice(j).trimStart();
        const isKey = rest.startsWith(':');
        const color = isKey ? colors.keyColor : colors.stringColor;
        html += `<span style="color:${color}">${esc(str)}</span>`;
        i = j;
        continue;
      }

      if (ch === '-' || (ch >= '0' && ch <= '9')) {
        let j = i;
        if (line[j] === '-') j++;
        while (j < line.length && ((line[j] >= '0' && line[j] <= '9') || line[j] === '.' || line[j] === 'e' || line[j] === 'E' || line[j] === '+' || line[j] === '-')) {
          j++;
        }
        html += `<span style="color:${colors.numberColor}">${esc(line.slice(i, j))}</span>`;
        i = j;
        continue;
      }

      if (line.startsWith('true', i)) {
        html += `<span style="color:${colors.booleanColor}">true</span>`;
        i += 4;
        continue;
      }
      if (line.startsWith('false', i)) {
        html += `<span style="color:${colors.booleanColor}">false</span>`;
        i += 5;
        continue;
      }
      if (line.startsWith('null', i)) {
        html += `<span style="color:${colors.nullColor}">null</span>`;
        i += 4;
        continue;
      }

      if ('{}[]:,'.includes(ch)) {
        html += `<span style="color:${colors.delimiterColor}">${esc(ch)}</span>`;
        i++;
        continue;
      }

      html += esc(ch);
      i++;
    }
    htmlLines.push(html);
  }

  return htmlLines.join('\n');
}

export async function exportJsonAsImage(options: ExportOptions): Promise<Blob> {
  const {
    content,
    theme,
    fontSize = 13,
    lineHeight = 20,
    fileName,
  } = options;

  const colors = getThemeColors(theme);
  const tokenizedHtml = tokenizeJson(content, colors);
  const lines = content.split('\n');
  const lineCount = lines.length;
  const lineNumWidth = String(lineCount).length;

  const lineNumbersHtml = lines
    .map((_, i) => `<span style="display:block;text-align:right;color:${colors.lineNumber};user-select:none;padding-right:16px;min-width:${lineNumWidth + 1}ch">${i + 1}</span>`)
    .join('');

  const isDark = theme === 'vs-dark' || theme === 'hc-black' ||
    (monacoThemes[theme]?.base === 'vs-dark');

  const headerBg = isDark
    ? 'rgba(255,255,255,0.06)'
    : 'rgba(0,0,0,0.04)';
  const headerBorder = isDark
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.08)';
  const headerTextColor = isDark
    ? 'rgba(255,255,255,0.5)'
    : 'rgba(0,0,0,0.45)';
  const dotColors = ['#ff5f57', '#febc2e', '#28c840'];

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-9999px;top:-9999px;z-index:-1;`;
  container.innerHTML = `
    <div id="json-export-root" style="
      display:inline-block;
      background:${colors.background};
      border-radius:10px;
      overflow:hidden;
      font-family:'JetBrains Mono','Fira Code','SF Mono',Consolas,monospace;
      font-size:${fontSize}px;
      line-height:${lineHeight}px;
      max-width:960px;
      box-shadow:0 8px 32px rgba(0,0,0,0.2);
    ">
      <div style="
        display:flex;
        align-items:center;
        gap:8px;
        padding:10px 16px;
        background:${headerBg};
        border-bottom:1px solid ${headerBorder};
      ">
        <div style="display:flex;gap:6px;">
          ${dotColors.map(c => `<div style="width:10px;height:10px;border-radius:50%;background:${c}"></div>`).join('')}
        </div>
        ${fileName ? `<span style="flex:1;text-align:center;font-size:12px;color:${headerTextColor};font-weight:500;">${fileName}</span>` : `<span style="flex:1"></span>`}
        <div style="width:42px"></div>
      </div>
      <div style="display:flex;padding:12px 0;">
        <pre style="margin:0;font:inherit;line-height:${lineHeight}px;padding:0 0 0 12px;flex-shrink:0;">${lineNumbersHtml}</pre>
        <pre style="margin:0;font:inherit;line-height:${lineHeight}px;padding:0 16px 0 0;white-space:pre;overflow:visible;">${tokenizedHtml}</pre>
      </div>
      <div style="
        padding:6px 16px;
        background:${headerBg};
        border-top:1px solid ${headerBorder};
        font-size:11px;
        color:${headerTextColor};
        display:flex;
        justify-content:space-between;
      ">
        <span>JSON · ${lineCount} lines</span>
        <span>JsonStudio</span>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const node = container.querySelector('#json-export-root') as HTMLElement;
    const blob = await toBlob(node, {
      pixelRatio: 2,
      backgroundColor: colors.background,
      skipFonts: true,
    });
    if (!blob) throw new Error('Failed to generate image');
    return blob;
  } finally {
    document.body.removeChild(container);
  }
}

export async function copyImageToClipboard(blob: Blob): Promise<void> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const pngBase64 = btoa(binary);
  await invoke('copy_image_to_clipboard', { pngBase64 });
}

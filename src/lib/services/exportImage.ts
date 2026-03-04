import { toBlob } from 'html-to-image';
import { invoke } from '@tauri-apps/api/core';
import { monacoThemes, type EditorTheme } from '$lib/config/monacoThemes';
import { base } from '$app/paths';

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

function tokenizeJson(content: string, colors: ThemeColors, bracketColors: string[]): string {
  const lines = content.split('\n');
  const htmlLines: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bracketPalette = bracketColors.length ? bracketColors : [colors.delimiterColor];
  let depth = 0;

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

      if (ch === '{' || ch === '}') {
        if (ch === '}') depth = Math.max(depth - 1, 0);
        const color = bracketPalette[depth % bracketPalette.length];
        html += `<span style="color:${color};font-weight:700;">${esc(ch)}</span>`;
        if (ch === '{') depth++;
        i++;
        continue;
      }
      
      if (ch === '[' || ch === ']') {
        if (ch === ']') depth = Math.max(depth - 1, 0);
        const color = bracketPalette[depth % bracketPalette.length];
        html += `<span style="color:${color};font-weight:700;">${esc(ch)}</span>`;
        if (ch === '[') depth++;
        i++;
        continue;
      }

      if (ch === ':') {
        html += `<span style="color:${colors.delimiterColor};font-weight:700;">${esc(ch)}</span>`;
        i++;
        continue;
      }
      
      if (ch === ',') {
        html += `<span style="color:${colors.delimiterColor};font-weight:700;">${esc(ch)}</span>`;
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

async function loadIconBitmap(iconUrl: string): Promise<ImageBitmap> {
  const url = `${iconUrl}${iconUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load icon (${response.status})`);
  }
  const blob = await response.blob();
  return createImageBitmap(blob);
}

export async function exportJsonAsImage(options: ExportOptions): Promise<Blob> {
  const {
    content,
    theme,
    fontSize = 14,
    lineHeight = 22,
  } = options;

  const exportFontSize = Math.max(fontSize, 15);
  const exportLineHeight = Math.max(lineHeight, Math.round(exportFontSize * 1.6));

  const colors = getThemeColors(theme);
  const bracketColors = getBracketHighlightColors();
  const tokenizedHtml = tokenizeJson(content, colors, bracketColors);
  const isDark = theme === 'vs-dark' || theme === 'hc-black' ||
    (monacoThemes[theme]?.base === 'vs-dark');

  const watermarkColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';
  const iconUrl = base ? `${base}/app-icon.png` : '/app-icon.png';
  const exportPixelRatio = 3;
  const watermark = {
    text: 'JsonStudio',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
    iconSize: 28,
    gap: 0,
    paddingRight: 24,
    paddingBottom: 20,
  };

  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-9999px;top:-9999px;z-index:-1;`;
  container.innerHTML = `
    <div id="json-export-root" style="
      position:relative;
      display:inline-block;
      background:${colors.background};
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      width:fit-content;
      min-width:400px;
      max-width:1200px;
    ">
      <!-- Code Content -->
      <div style="padding:32px 32px 64px 32px;">
        <pre style="
          margin:0;
          font-family:'JetBrains Mono','Fira Code','SF Mono',Consolas,'Courier New',monospace;
          font-size:${exportFontSize}px;
          line-height:${exportLineHeight}px;
          font-weight:600;
          color:${colors.foreground};
          padding:0;
          white-space:pre-wrap;
          word-break:break-all;
          overflow:visible;
        ">${tokenizedHtml}</pre>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const node = container.querySelector('#json-export-root') as HTMLElement;
    const blob = await toBlob(node, {
      pixelRatio: exportPixelRatio,
      backgroundColor: colors.background,
      skipFonts: true,
      cacheBust: true,
    });
    if (!blob) throw new Error('Failed to generate image');
    const imageBitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imageBitmap.width;
      canvas.height = imageBitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to create canvas context');

      ctx.drawImage(imageBitmap, 0, 0);

      const iconBitmap = await loadIconBitmap(iconUrl);

      const scale = exportPixelRatio;
      const iconSizePx = Math.round(watermark.iconSize * scale);
      const gapPx = Math.round(watermark.gap * scale);
      const paddingRightPx = Math.round(watermark.paddingRight * scale);
      const paddingBottomPx = Math.round(watermark.paddingBottom * scale);
      const fontSizePx = Math.round(watermark.fontSize * scale);

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.font = `${watermark.fontWeight} ${fontSizePx}px ${watermark.fontFamily}`;
      ctx.fillStyle = watermarkColor;
      ctx.textBaseline = 'middle';

      const textWidth = ctx.measureText(watermark.text).width;
      const xRight = canvas.width - paddingRightPx;
      const yBottom = canvas.height - paddingBottomPx;
      const textX = Math.round(xRight - textWidth);
      const centerY = Math.round(yBottom - Math.max(iconSizePx, fontSizePx) / 2);
      const iconX = Math.round(textX - gapPx - iconSizePx);
      const iconY = Math.round(centerY - iconSizePx / 2);

      ctx.drawImage(iconBitmap, iconX, iconY, iconSizePx, iconSizePx);
      ctx.fillText(watermark.text, textX, centerY);

      const finalBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (!result) {
            reject(new Error('Failed to generate final image'));
            return;
          }
          resolve(result);
        }, 'image/png');
      });
      iconBitmap.close();
      return finalBlob;
    } finally {
      if ('close' in imageBitmap) {
        imageBitmap.close();
      }
    }
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

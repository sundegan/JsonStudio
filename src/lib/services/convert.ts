import { invoke } from '@tauri-apps/api/core';
import { formatMarkdownTable, formatProperties, parseMarkdownTable, parseProperties } from './convertExtraFormats.js';

export type ConvertFormat = 'yaml' | 'xml' | 'toml' | 'csv' | 'properties' | 'ini' | 'markdown';

export const CONVERT_FORMATS: { id: ConvertFormat; label: string; lang: string }[] = [
  { id: 'yaml', label: 'YAML', lang: 'yaml' },
  { id: 'xml', label: 'XML', lang: 'xml' },
  { id: 'toml', label: 'TOML', lang: 'ini' },
  { id: 'csv', label: 'CSV', lang: 'plaintext' },
  { id: 'properties', label: 'Properties', lang: 'ini' },
  { id: 'ini', label: 'INI', lang: 'ini' },
  { id: 'markdown', label: 'Markdown Table', lang: 'markdown' },
];

export async function convertJson(content: string, format: ConvertFormat): Promise<string> {
  switch (format) {
    case 'yaml':
      return await invoke<string>('json_to_yaml', { content });
    case 'xml':
      return await invoke<string>('json_to_xml', { content });
    case 'toml':
      return await invoke<string>('json_to_toml', { content });
    case 'csv':
      return await invoke<string>('json_to_csv', { content });
    case 'properties':
      return formatProperties(JSON.parse(content));
    case 'ini':
      return formatProperties(JSON.parse(content), { ini: true });
    case 'markdown':
      return formatMarkdownTable(JSON.parse(content));
  }
}

export async function convertToJson(content: string, format: ConvertFormat): Promise<string> {
  switch (format) {
    case 'yaml':
      return await invoke<string>('yaml_to_json', { content });
    case 'xml':
      return await invoke<string>('xml_to_json', { content });
    case 'toml':
      return await invoke<string>('toml_to_json', { content });
    case 'csv':
      return await invoke<string>('csv_to_json', { content });
    case 'properties':
      return JSON.stringify(parseProperties(content), null, 2);
    case 'ini':
      return JSON.stringify(parseProperties(content, { ini: true }), null, 2);
    case 'markdown':
      return JSON.stringify(parseMarkdownTable(content), null, 2);
  }
}

import { invoke } from '@tauri-apps/api/core';

export type ConvertFormat = 'yaml' | 'xml' | 'toml' | 'csv';

export const CONVERT_FORMATS: { id: ConvertFormat; label: string; lang: string }[] = [
  { id: 'yaml', label: 'YAML', lang: 'yaml' },
  { id: 'xml', label: 'XML', lang: 'xml' },
  { id: 'toml', label: 'TOML', lang: 'ini' },
  { id: 'csv', label: 'CSV', lang: 'plaintext' },
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
  }
}

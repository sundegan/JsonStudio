import { invoke } from '@tauri-apps/api/core';

export type CodegenLanguage =
  | 'typescript' | 'rust' | 'go' | 'java' | 'python' | 'kotlin' | 'swift' | 'csharp'
  | 'dart' | 'php' | 'ruby' | 'scala' | 'cpp'
  | 'sql' | 'protobuf' | 'thrift';

export const CODEGEN_LANGUAGES: { id: CodegenLanguage; label: string; monacoLang: string }[] = [
  { id: 'typescript', label: 'TypeScript', monacoLang: 'typescript' },
  { id: 'java', label: 'Java', monacoLang: 'java' },
  { id: 'kotlin', label: 'Kotlin', monacoLang: 'kotlin' },
  { id: 'go', label: 'Go', monacoLang: 'go' },
  { id: 'rust', label: 'Rust', monacoLang: 'rust' },
  { id: 'python', label: 'Python', monacoLang: 'python' },
  { id: 'swift', label: 'Swift', monacoLang: 'swift' },
  { id: 'csharp', label: 'C#', monacoLang: 'csharp' },
  { id: 'dart', label: 'Dart', monacoLang: 'dart' },
  { id: 'php', label: 'PHP', monacoLang: 'php' },
  { id: 'ruby', label: 'Ruby', monacoLang: 'ruby' },
  { id: 'scala', label: 'Scala', monacoLang: 'scala' },
  { id: 'cpp', label: 'C++', monacoLang: 'cpp' },
  { id: 'sql', label: 'SQL', monacoLang: 'sql' },
  { id: 'protobuf', label: 'Protobuf', monacoLang: 'protobuf' },
  { id: 'thrift', label: 'Thrift', monacoLang: 'plaintext' },
];

export async function generateCode(
  content: string,
  language: CodegenLanguage,
  className: string,
): Promise<string> {
  return await invoke<string>('json_to_code', { content, language, className });
}

export async function codeToJson(
  content: string,
  language: CodegenLanguage,
  className: string,
): Promise<string> {
  return await invoke<string>('code_to_json', { content, language, className });
}

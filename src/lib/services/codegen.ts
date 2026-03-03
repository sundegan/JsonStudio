import { invoke } from '@tauri-apps/api/core';
import {
  quicktype,
  InputData,
  jsonInputForTargetLanguage,
} from 'quicktype-core';

export type CodegenLanguage =
  | 'typescript' | 'rust' | 'go' | 'java' | 'python' | 'kotlin' | 'swift' | 'csharp'
  | 'dart' | 'php' | 'ruby' | 'scala' | 'cpp' | 'javascript' | 'objectivec'
  | 'elm' | 'haskell' | 'crystal' | 'elixir' | 'pike'
  | 'protobuf' | 'thrift';

interface LangConfig {
  id: CodegenLanguage;
  label: string;
  monacoLang: string;
  quicktypeName?: string;
  rendererOptions?: Record<string, string>;
}

export const CODEGEN_LANGUAGES: LangConfig[] = [
  { id: 'typescript', label: 'TypeScript', monacoLang: 'typescript', quicktypeName: 'typescript', rendererOptions: { 'just-types': 'true' } },
  { id: 'java', label: 'Java', monacoLang: 'java', quicktypeName: 'java', rendererOptions: { 'just-types': 'true' } },
  { id: 'kotlin', label: 'Kotlin', monacoLang: 'kotlin', quicktypeName: 'kotlin', rendererOptions: { 'just-types': 'true' } },
  { id: 'go', label: 'Go', monacoLang: 'go', quicktypeName: 'go', rendererOptions: { 'just-types': 'true' } },
  { id: 'rust', label: 'Rust', monacoLang: 'rust', quicktypeName: 'rust', rendererOptions: { density: 'dense', visibility: 'public' } },
  { id: 'python', label: 'Python', monacoLang: 'python', quicktypeName: 'python', rendererOptions: { 'just-types': 'true', 'python-version': '3.6' } },
  { id: 'swift', label: 'Swift', monacoLang: 'swift', quicktypeName: 'swift', rendererOptions: { 'just-types': 'true' } },
  { id: 'csharp', label: 'C#', monacoLang: 'csharp', quicktypeName: 'csharp', rendererOptions: { 'just-types': 'true' } },
  { id: 'dart', label: 'Dart', monacoLang: 'dart', quicktypeName: 'dart', rendererOptions: { 'just-types': 'true' } },
  { id: 'php', label: 'PHP', monacoLang: 'php', quicktypeName: 'php', rendererOptions: { 'just-types': 'true' } },
  { id: 'ruby', label: 'Ruby', monacoLang: 'ruby', quicktypeName: 'ruby', rendererOptions: { 'just-types': 'true' } },
  { id: 'scala', label: 'Scala', monacoLang: 'scala', quicktypeName: 'scala3', rendererOptions: { 'just-types': 'true' } },
  { id: 'cpp', label: 'C++', monacoLang: 'cpp', quicktypeName: 'cpp', rendererOptions: { 'just-types': 'true' } },
  { id: 'javascript', label: 'JavaScript', monacoLang: 'javascript', quicktypeName: 'javascript' },
  { id: 'objectivec', label: 'Objective-C', monacoLang: 'objective-c', quicktypeName: 'objc', rendererOptions: { 'just-types': 'true' } },
  { id: 'elm', label: 'Elm', monacoLang: 'plaintext', quicktypeName: 'elm', rendererOptions: { 'just-types': 'true' } },
  { id: 'haskell', label: 'Haskell', monacoLang: 'plaintext', quicktypeName: 'haskell', rendererOptions: { 'just-types': 'true' } },
  { id: 'crystal', label: 'Crystal', monacoLang: 'plaintext', quicktypeName: 'crystal' },
  { id: 'elixir', label: 'Elixir', monacoLang: 'plaintext', quicktypeName: 'elixir', rendererOptions: { 'just-types': 'true' } },
  { id: 'pike', label: 'Pike', monacoLang: 'plaintext', quicktypeName: 'pike' },
  { id: 'protobuf', label: 'Protobuf', monacoLang: 'protobuf' },
  { id: 'thrift', label: 'Thrift', monacoLang: 'plaintext' },
];

const BACKEND_ONLY_LANGUAGES = new Set<CodegenLanguage>(['protobuf', 'thrift']);

const REVERSE_SUPPORTED_LANGUAGES = new Set<CodegenLanguage>([
  'typescript', 'java', 'kotlin', 'go', 'rust', 'python', 'swift', 'csharp',
  'dart', 'php', 'ruby', 'scala', 'cpp', 'protobuf', 'thrift',
  'javascript', 'objectivec', 'elm', 'haskell', 'crystal', 'elixir', 'pike',
]);

export function supportsReverse(language: CodegenLanguage): boolean {
  return REVERSE_SUPPORTED_LANGUAGES.has(language);
}

export async function generateCode(
  content: string,
  language: CodegenLanguage,
  className: string,
): Promise<string> {
  if (BACKEND_ONLY_LANGUAGES.has(language)) {
    return await invoke<string>('json_to_code', { content, language, className });
  }

  const langConfig = CODEGEN_LANGUAGES.find(l => l.id === language);
  if (!langConfig?.quicktypeName) {
    throw new Error(`Unsupported language: ${language}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qtLang: any = langConfig.quicktypeName;
  const jsonInput = jsonInputForTargetLanguage(qtLang);
  await jsonInput.addSource({ name: className, samples: [content] });

  const inputData = new InputData();
  inputData.addInput(jsonInput);

  const result = await quicktype({
    inputData,
    lang: qtLang,
    rendererOptions: langConfig.rendererOptions || {},
  });

  return result.lines.join('\n');
}

export async function codeToJson(
  content: string,
  language: CodegenLanguage,
  className: string,
): Promise<string> {
  return await invoke<string>('code_to_json', { content, language, className });
}

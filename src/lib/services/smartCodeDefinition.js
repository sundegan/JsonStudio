/** 将 Codegen 已支持的结构体/类型定义识别为 Codegen 反向转换的预设。 */

/** @typedef {import('./codegen').CodegenLanguage} CodegenLanguage */

/** @type {[CodegenLanguage, string, RegExp][]} */
const LANGUAGE_DETECTORS = [
  ['protobuf', 'Protobuf', /\b(?:syntax\s*=|message\s+)([A-Za-z_]\w*)/],
  ['thrift', 'Thrift', /\bnamespace\s+\w+[\s\S]*?\bstruct\s+([A-Za-z_]\w*)/],
  ['objectivec', 'Objective-C', /@interface\s+([A-Za-z_]\w*)/],
  ['scala', 'Scala', /\bcase\s+class\s+([A-Z][A-Za-z0-9_]*)/],
  ['kotlin', 'Kotlin', /\bdata\s+class\s+([A-Z][A-Za-z0-9_]*)/],
  ['rust', 'Rust', /(?:#\[derive[^\]]*\]\s*)?pub\s+struct\s+([A-Z][A-Za-z0-9_]*)/],
  ['go', 'Go', /\btype\s+([A-Z][A-Za-z0-9_]*)\s+struct\s*\{/],
  ['swift', 'Swift', /\b(?:struct|class)\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^\{]+)?\{[\s\S]*\b(?:let|var)\b/],
  ['csharp', 'C#', /\b(?:namespace|using)\s+[\w.]+[\s\S]*?\b(?:class|record)\s+([A-Z][A-Za-z0-9_]*)/],
  ['dart', 'Dart', /\bclass\s+([A-Z][A-Za-z0-9_]*)\s*\{[\s\S]*\b(?:final|late)\b/],
  ['php', 'PHP', /<\?php[\s\S]*?\bclass\s+([A-Z][A-Za-z0-9_]*)/],
  ['ruby', 'Ruby', /\bclass\s+([A-Z][A-Za-z0-9_:]*)[\s\S]*?\b(?:attr_accessor|attr_reader)\b/],
  ['cpp', 'C++', /(?:#include|std::)[\s\S]*?\b(?:class|struct)\s+([A-Z][A-Za-z0-9_]*)/],
  ['java', 'Java', /\b(?:(?:public|private|protected|abstract|final)\s+(?:class|record|interface)|record)\s+([A-Z][A-Za-z0-9_]*)\b/],
  ['python', 'Python', /\bclass\s+([A-Z][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:[\s\S]*?(?:\bself\.\w+\s*=|\b\w+\s*:\s*[A-Za-z_])/],
  ['typescript', 'TypeScript', /\b(?:export\s+)?(?:interface|type)\s+([A-Z][A-Za-z0-9_]*)\s*(?:<[^>]+>)?\s*(?:=\s*)?\{/],
  ['javascript', 'JavaScript', /\b(?:export\s+)?(?:class|(?:const|let|var))\s+([A-Z][A-Za-z0-9_]*)\s*(?:(?:extends\s+\w+\s*)?\{[\s\S]*?\bconstructor\s*\(|=\s*\{)/],
];

/**
 * @param {string} content
 * @returns {{ language: CodegenLanguage, kind: string, label: string } | null}
 */
export function detectSmartCodeDefinition(content) {
  for (const [language, label, pattern] of LANGUAGE_DETECTORS) {
    const match = content.match(pattern);
    if (match) return { language, kind: `${label} Structure`, label: match[1] || label };
  }
  return null;
}

export const SMART_CODEGEN_LANGUAGES = LANGUAGE_DETECTORS.map(([language]) => language);

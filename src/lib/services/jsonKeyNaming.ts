import { camelCase, snakeCase, type PascalCaseOptions } from 'change-case';
import { parseJsonSourceDocument } from './jsonSourceModel.js';

/**
 * Independent, reusable JSON key naming convention converter.
 *
 * Converts all object keys in a JSON value between snake_case and camelCase.
 * Can be used by the Codegen view, the main editor, or any other module
 * that needs to normalize JSON key naming.
 */

export type KeyNaming = 'snake' | 'camel';

const JSON_KEY_CASE_OPTIONS: PascalCaseOptions = {
  // JSON key conversion must not depend on the host locale.
  locale: false,
  // Private-style keys and reserved suffixes are meaningful in JSON payloads.
  prefixCharacters: '_',
  suffixCharacters: '_',
  // Treat separators adjacent to numeric segments as conversion boundaries.
  mergeAmbiguousCharacters: true,
};

/**
 * Convert a single key to the target naming convention with `change-case`.
 * - `snake`: `emailTitle` -> `email_title`
 * - `camel`: `email_title` -> `emailTitle`
 */
export function convertKey(key: string, target: KeyNaming): string {
  return target === 'snake'
    ? snakeCase(key, JSON_KEY_CASE_OPTIONS)
    : camelCase(key, JSON_KEY_CASE_OPTIONS);
}

/**
 * Infer the next naming convention for a JSON value.
 * Keys that are already snake_case select camelCase, and vice versa.
 * Mixed values are normalized to snake_case.
 */
export function getOppositeKeyNaming(value: unknown): KeyNaming {
  let snakeKeyCount = 0;
  let camelKeyCount = 0;

  function visit(current: unknown) {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== 'object') return;

    for (const [key, nestedValue] of Object.entries(current)) {
      const isSnakeCase = convertKey(key, 'snake') === key;
      const isCamelCase = convertKey(key, 'camel') === key;
      if (isSnakeCase && !isCamelCase) {
        snakeKeyCount += 1;
      } else if (isCamelCase && !isSnakeCase) {
        camelKeyCount += 1;
      } else if (key.includes('_')) {
        snakeKeyCount += 1;
      } else if (/[A-Z]/.test(key)) {
        camelKeyCount += 1;
      }
      visit(nestedValue);
    }
  }

  visit(value);
  return snakeKeyCount > camelKeyCount ? 'camel' : 'snake';
}

/** Infer the next naming convention from strict JSON or JSON5/JSONC text. */
export function getOppositeKeyNamingFromString(jsonString: string): KeyNaming {
  try {
    return getOppositeKeyNaming(JSON.parse(jsonString));
  } catch {
    try {
      const parsed = parseJsonSourceDocument(jsonString, {
        dialect: 'AUTO',
        retainSourceModel: false,
      });
      return getOppositeKeyNaming(parsed.data);
    } catch {
      return 'snake';
    }
  }
}

/**
 * Recursively convert all object keys in a parsed JSON value.
 * Does not modify the input — returns a new value.
 *
 * @example
 * convertJsonKeys({ emailTitle: 1, nested: { brokerId: 2 } }, 'snake')
 * // -> { email_title: 1, nested: { broker_id: 2 } }
 */
export function convertJsonKeys<T>(value: T, target: KeyNaming): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => convertJsonKeys(item, target)) as T;
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Assignment to `__proto__` changes an ordinary object's prototype instead
      // of creating a JSON property. Define every converted key explicitly.
      Object.defineProperty(result, convertKey(k, target), {
        value: convertJsonKeys(v, target),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result as T;
  }
  return value;
}

/**
 * Convert all keys in a JSON string and return a formatted JSON string.
 * Returns null when parsing fails.
 */
export function tryConvertJsonString(
  jsonString: string,
  target: KeyNaming,
  indent: number = 2,
): string | null {
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      parsed = parseJsonSourceDocument(jsonString, {
        dialect: 'AUTO',
        retainSourceModel: false,
      }).data;
    }
    const converted = convertJsonKeys(parsed, target);
    return JSON.stringify(converted, null, indent);
  } catch {
    return null;
  }
}

type KeyReplacement = { start: number; end: number; text: string };
type SourceNode = {
  kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  entries?: Array<{
    key: string;
    keyStart: number;
    keyEnd: number;
    value: SourceNode;
  }>;
  items?: SourceNode[];
};

/**
 * Convert object keys in JSON/JSON5/JSONC source without reserializing values.
 * This preserves comments, quote style, whitespace, and trailing commas.
 */
export function tryConvertJsonStringPreservingFormat(
  jsonString: string,
  target: KeyNaming,
): string | null {
  try {
    const parsed = parseJsonSourceDocument(jsonString, {
      dialect: 'AUTO',
      retainSourceModel: true,
    });
    const sourceModel = 'sourceModel' in parsed ? parsed.sourceModel as SourceNode : null;
    if (!sourceModel) return null;
    const replacements: KeyReplacement[] = [];
    collectKeyReplacements(sourceModel, jsonString, target, replacements);

    return replacements
      .sort((left, right) => right.start - left.start)
      .reduce(
        (source, replacement) =>
          `${source.slice(0, replacement.start)}${replacement.text}${source.slice(replacement.end)}`,
        jsonString,
      );
  } catch {
    return null;
  }
}

function collectKeyReplacements(
  node: SourceNode,
  source: string,
  target: KeyNaming,
  replacements: KeyReplacement[],
) {
  if (node.kind === 'object') {
    for (const entry of node.entries ?? []) {
      const convertedKey = convertKey(entry.key, target);
      if (convertedKey !== entry.key) {
        const rawKey = source.slice(entry.keyStart, entry.keyEnd);
        replacements.push({
          start: entry.keyStart,
          end: entry.keyEnd,
          text: formatKeyToken(rawKey, convertedKey),
        });
      }
      collectKeyReplacements(entry.value, source, target, replacements);
    }
    return;
  }
  if (node.kind === 'array') {
    for (const item of node.items ?? []) {
      collectKeyReplacements(item, source, target, replacements);
    }
  }
}

function formatKeyToken(rawKey: string, convertedKey: string): string {
  const quote = rawKey[0];
  if (quote !== '"' && quote !== "'") return convertedKey;
  const escaped = convertedKey
    .replaceAll('\\', '\\\\')
    .replaceAll(quote, `\\${quote}`)
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
  return `${quote}${escaped}${quote}`;
}

/**
 * Convert all keys in a JSON string and return a formatted JSON string.
 * Returns the original string if parsing fails.
 */
export function convertJsonString(
  jsonString: string,
  target: KeyNaming,
  indent: number = 2,
): string {
  return tryConvertJsonString(jsonString, target, indent) ?? jsonString;
}

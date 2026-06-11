const SOURCE_NODE_MARKER = Symbol.for('jsonstudio.sourceNode');
const SOURCE_NODE_PROTOTYPE = Object.freeze({
  [SOURCE_NODE_MARKER]: true,
});

/**
 * @typedef {'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'} JsonSourceKind
 *
 * @typedef {{
 *   key: string;
 *   keyStart: number;
 *   keyEnd: number;
 *   value: JsonSourceNode;
 *   occurrence?: number;
 * }} JsonSourceObjectEntry
 *
 * @typedef {{
 *   [SOURCE_NODE_MARKER]: true;
 *   kind: 'object';
 *   value: Record<string, unknown>;
 *   entries: JsonSourceObjectEntry[];
 *   start: number;
 *   end: number;
 *   hasDuplicateKeys: boolean;
 * }} JsonSourceObjectNode
 *
 * @typedef {{
 *   [SOURCE_NODE_MARKER]: true;
 *   kind: 'array';
 *   value: unknown[];
 *   items: JsonSourceNode[];
 *   start: number;
 *   end: number;
 *   hasDuplicateKeys: boolean;
 * }} JsonSourceArrayNode
 *
 * @typedef {{
 *   [SOURCE_NODE_MARKER]: true;
 *   kind: 'string' | 'number' | 'boolean' | 'null';
 *   value: unknown;
 *   start: number;
 *   end: number;
 *   hasDuplicateKeys?: false;
 * }} JsonSourceScalarNode
 *
 * @typedef {JsonSourceObjectNode | JsonSourceArrayNode | JsonSourceScalarNode} JsonSourceNode
 */

/**
 * @param {string} content
 * @param {{ dialect?: 'JSON' | 'JSON5' | 'AUTO' }} [options]
 * @returns {JsonSourceNode}
 */
export function parseJsonSourceModel(content, options = {}) {
  return parseSourceModel(content, options.dialect ?? 'JSON').sourceModel;
}

/**
 * @param {string} content
 * @param {{
 *   dialect?: 'JSON' | 'JSON5' | 'AUTO';
 *   retainSourceModel?: boolean;
 * }} [options]
 */
export function parseJsonSourceDocument(content, options = {}) {
  const parsed = parseSourceModel(content, options.dialect ?? 'JSON');
  const sourceModel = parsed.sourceModel;
  const document = {
    data: sourceModel.value,
    pointers: buildJsonSourcePointers(sourceModel),
    dialect: parsed.dialect,
  };
  if (options.retainSourceModel !== false || sourceModel.hasDuplicateKeys) {
    return { ...document, sourceModel };
  }
  return document;
}

/**
 * @param {string} content
 * @param {'JSON' | 'JSON5' | 'AUTO'} dialect
 */
function parseSourceModel(content, dialect) {
  const parser = new JsonSourceParser(content, dialect);
  const sourceModel = parser.parseValue();
  parser.skipTrivia();
  if (!parser.isAtEnd()) {
    parser.fail('Unexpected trailing content');
  }
  return {
    sourceModel,
    dialect: parser.detectedDialect(),
  };
}

/**
 * @param {unknown} value
 * @returns {value is JsonSourceNode}
 */
export function isJsonSourceNode(value) {
  if (!value || typeof value !== 'object') return false;
  return /** @type {Record<symbol, unknown>} */ (value)[SOURCE_NODE_MARKER] === true;
}

/**
 * @param {unknown} value
 */
export function getJsonSourceValue(value) {
  return isJsonSourceNode(value) ? value.value : value;
}

/**
 * @param {JsonSourceNode} root
 * @returns {Record<string, any>}
 */
export function buildJsonSourcePointers(root) {
  /** @type {Record<string, any>} */
  const pointers = Object.create(null);
  collectJsonSourcePointers(root, '', pointers);
  return pointers;
}

class JsonSourceParser {
  /**
   * @param {string} content
   * @param {'JSON' | 'JSON5' | 'AUTO'} dialect
   */
  constructor(content, dialect) {
    this.content = content;
    this.index = 0;
    this.dialect = dialect;
    this.usesJson5Syntax = dialect === 'JSON5';
  }

  /** @returns {JsonSourceNode} */
  parseValue() {
    this.skipTrivia();
    const char = this.peek();
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === '"' || (this.allowsJson5() && char === "'")) return this.parseStringNode();
    if (
      char === '-' ||
      isDigit(char) ||
      (this.allowsJson5() && (char === '+' || char === '.'))
    ) {
      return this.parseNumber();
    }
    if (this.content.startsWith('true', this.index)) return this.parseLiteral('true', true, 'boolean');
    if (this.content.startsWith('false', this.index)) return this.parseLiteral('false', false, 'boolean');
    if (this.content.startsWith('null', this.index)) return this.parseLiteral('null', null, 'null');
    if (this.allowsJson5() && this.content.startsWith('Infinity', this.index)) return this.parseNumber();
    if (this.allowsJson5() && this.content.startsWith('NaN', this.index)) return this.parseNumber();
    return this.fail('Expected JSON value');
  }

  /** @returns {JsonSourceObjectNode} */
  parseObject() {
    const start = this.index;
    this.index += 1;
    /** @type {JsonSourceObjectEntry[]} */
    const entries = [];
    /** @type {Record<string, unknown>} */
    const objectValue = {};
    /** @type {Map<string, number> | null} */
    let duplicateCounts = null;
    let hasDuplicateKeys = false;

    this.skipTrivia();
    if (this.consume('}')) {
      return markSourceNode({
        kind: 'object',
        value: objectValue,
        entries,
        start,
        end: this.index,
        hasDuplicateKeys,
      });
    }

    while (true) {
      this.skipTrivia();
      const keyToken = this.parsePropertyName();
      const key = keyToken.value;
      this.skipTrivia();
      if (!this.consume(':')) this.fail('Expected ":" after object key');

      const value = this.parseValue();
      let occurrence = 0;
      if (Object.hasOwn(objectValue, key)) {
        duplicateCounts ??= new Map();
        occurrence = duplicateCounts.get(key) ?? 1;
        duplicateCounts.set(key, occurrence + 1);
      }
      hasDuplicateKeys = hasDuplicateKeys || occurrence > 0 || Boolean(value.hasDuplicateKeys);
      /** @type {JsonSourceObjectEntry} */
      const entry = {
        key,
        keyStart: keyToken.start,
        keyEnd: keyToken.end,
        value,
      };
      if (occurrence > 0) entry.occurrence = occurrence;
      entries.push(entry);
      setObjectValue(objectValue, key, value.value);

      this.skipTrivia();
      if (this.consume('}')) break;
      if (!this.consume(',')) this.fail('Expected "," or "}" after object entry');
      this.skipTrivia();
      if (this.peek() === '}') {
        if (!this.allowsJson5()) this.fail('Trailing comma is not valid JSON');
        this.markJson5();
        this.index += 1;
        break;
      }
    }

    return markSourceNode({
      kind: 'object',
      value: objectValue,
      entries,
      start,
      end: this.index,
      hasDuplicateKeys,
    });
  }

  /** @returns {JsonSourceArrayNode} */
  parseArray() {
    const start = this.index;
    this.index += 1;
    /** @type {JsonSourceNode[]} */
    const items = [];
    /** @type {unknown[]} */
    const arrayValue = [];
    let hasDuplicateKeys = false;

    this.skipTrivia();
    if (this.consume(']')) {
      return markSourceNode({
        kind: 'array',
        value: arrayValue,
        items,
        start,
        end: this.index,
        hasDuplicateKeys,
      });
    }

    while (true) {
      const item = this.parseValue();
      hasDuplicateKeys = hasDuplicateKeys || Boolean(item.hasDuplicateKeys);
      items.push(item);
      arrayValue.push(item.value);
      this.skipTrivia();
      if (this.consume(']')) break;
      if (!this.consume(',')) this.fail('Expected "," or "]" after array item');
      this.skipTrivia();
      if (this.peek() === ']') {
        if (!this.allowsJson5()) this.fail('Trailing comma is not valid JSON');
        this.markJson5();
        this.index += 1;
        break;
      }
    }

    return markSourceNode({
      kind: 'array',
      value: arrayValue,
      items,
      start,
      end: this.index,
      hasDuplicateKeys,
    });
  }

  /** @returns {JsonSourceScalarNode} */
  parseStringNode() {
    const start = this.index;
    const quote = this.peek();
    if (quote !== '"' && (!this.allowsJson5() || quote !== "'")) this.fail('Expected string');
    if (quote === "'") this.markJson5();
    this.index += 1;
    let value = '';
    let chunkStart = this.index;

    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === quote) {
        value += this.content.slice(chunkStart, this.index);
        this.index += 1;
        return markSourceNode({
          kind: 'string',
          value,
          start,
          end: this.index,
        });
      }

      if (char === '\n' || char === '\r') {
        this.fail('Unterminated string');
      }
      if (char.charCodeAt(0) < 0x20) {
        if (!this.allowsJson5()) this.fail('Invalid control character');
        this.markJson5();
      }

      if (char === '\\') {
        value += this.content.slice(chunkStart, this.index);
        this.index += 1;
        value += this.parseEscapeSequence();
        chunkStart = this.index;
        continue;
      }
      this.index += 1;
    }
    return this.fail('Unterminated string');
  }

  /** @returns {JsonSourceScalarNode} */
  parseNumber() {
    const start = this.index;
    while (!this.isAtEnd() && !isValueDelimiter(this.peek())) this.index += 1;
    const raw = this.content.slice(start, this.index);
    if (!JSON_NUMBER_PATTERN.test(raw)) {
      if (!this.allowsJson5() || !JSON5_NUMBER_PATTERN.test(raw)) this.fail('Invalid number');
      this.markJson5();
    }

    let value;
    if (/^[+-]?Infinity$/.test(raw)) {
      value = raw.startsWith('-') ? -Infinity : Infinity;
    } else if (/^[+-]?NaN$/.test(raw)) {
      value = NaN;
    } else if (/^[+-]?0[xX]/.test(raw)) {
      const sign = raw.startsWith('-') ? -1 : 1;
      value = sign * Number.parseInt(raw.replace(/^[+-]?0[xX]/, ''), 16);
    } else {
      value = Number(raw);
    }

    return markSourceNode({
      kind: 'number',
      value,
      start,
      end: this.index,
    });
  }

  /**
   * @param {string} raw
   * @param {unknown} value
   * @param {'boolean' | 'null'} kind
   * @returns {JsonSourceScalarNode}
   */
  parseLiteral(raw, value, kind) {
    const start = this.index;
    this.index += raw.length;
    return markSourceNode({
      kind,
      value,
      start,
      end: this.index,
    });
  }

  parsePropertyName() {
    const char = this.peek();
    if (char === '"' || (this.allowsJson5() && char === "'")) {
      const node = this.parseStringNode();
      return { value: String(node.value), start: node.start, end: node.end };
    }
    if (!this.allowsJson5()) this.fail('Expected string property name');

    const start = this.index;
    while (!this.isAtEnd() && !isPropertyNameDelimiter(this.peek())) this.index += 1;
    const raw = this.content.slice(start, this.index);
    const value = decodeIdentifierName(raw);
    if (!JSON5_IDENTIFIER_PATTERN.test(value)) this.fail('Invalid property name');
    this.markJson5();
    return { value, start, end: this.index };
  }

  parseEscapeSequence() {
    if (this.isAtEnd()) this.fail('Unterminated escape sequence');
    const char = this.peek();
    this.index += 1;

    if (char in SIMPLE_ESCAPES) {
      if (!this.allowsJson5() && char === "'") this.fail('Invalid escape sequence');
      if (char === "'") this.markJson5();
      return SIMPLE_ESCAPES[char];
    }

    if (char === 'u') return String.fromCharCode(this.parseHexDigits(4));
    if (!this.allowsJson5()) this.fail('Invalid escape sequence');
    this.markJson5();
    if (char === 'v') return '\v';
    if (char === '0') {
      if (isDigit(this.peek())) this.fail('Invalid zero escape');
      return '\0';
    }
    if (char === 'x') return String.fromCharCode(this.parseHexDigits(2));
    if (char === '\r') {
      if (this.peek() === '\n') this.index += 1;
      return '';
    }
    if (char === '\n' || char === '\u2028' || char === '\u2029') return '';
    if (!isDigit(char)) return char;
    return this.fail('Invalid escape sequence');
  }

  /** @param {number} length */
  parseHexDigits(length) {
    const raw = this.content.slice(this.index, this.index + length);
    if (raw.length !== length || !HEX_PATTERN.test(raw)) this.fail('Invalid hexadecimal escape');
    this.index += length;
    return Number.parseInt(raw, 16);
  }

  skipTrivia() {
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (isJsonWhitespace(char)) {
        this.index += 1;
        continue;
      }
      if (this.allowsJson5() && isJson5Whitespace(char)) {
        this.markJson5();
        this.index += 1;
        continue;
      }
      if (!this.allowsJson5() || char !== '/') return;

      const next = this.content[this.index + 1];
      if (next === '/') {
        this.markJson5();
        this.index += 2;
        while (!this.isAtEnd() && !isLineTerminator(this.peek())) this.index += 1;
        continue;
      }
      if (next === '*') {
        this.markJson5();
        const end = this.content.indexOf('*/', this.index + 2);
        if (end < 0) this.fail('Unterminated block comment');
        this.index = end + 2;
        continue;
      }
      return;
    }
  }

  /** @param {string} char */
  consume(char) {
    if (this.peek() !== char) return false;
    this.index += 1;
    return true;
  }

  peek() {
    return this.content[this.index] ?? '';
  }

  isAtEnd() {
    return this.index >= this.content.length;
  }

  allowsJson5() {
    return this.dialect !== 'JSON';
  }

  markJson5() {
    this.usesJson5Syntax = true;
  }

  detectedDialect() {
    return this.usesJson5Syntax ? 'JSON5' : 'JSON';
  }

  /**
   * @param {string} message
   * @returns {never}
   */
  fail(message) {
    throw new SyntaxError(`${message} at position ${this.index}`);
  }
}

const JSON_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const JSON5_NUMBER_PATTERN = /^[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:(?:0|[1-9]\d*)\.\d*|\.\d+|(?:0|[1-9]\d*))(?:[eE][+-]?\d+)?)$/;
const JSON5_IDENTIFIER_PATTERN = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
const HEX_PATTERN = /^[0-9a-fA-F]+$/;
/** @type {Record<string, string>} */
const SIMPLE_ESCAPES = {
  '"': '"',
  "'": "'",
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * @template {Record<string | symbol, unknown>} T
 * @param {T} node
 * @returns {T & { [SOURCE_NODE_MARKER]: true }}
 */
function markSourceNode(node) {
  Object.setPrototypeOf(node, SOURCE_NODE_PROTOTYPE);
  return /** @type {T & { [SOURCE_NODE_MARKER]: true }} */ (node);
}

/** @param {string} char */
function isDigit(char) {
  return char >= '0' && char <= '9';
}

/** @param {string} char */
function isLineTerminator(char) {
  return char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029';
}

/**
 * @param {string} char
 */
function isJsonWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/** @param {string} char */
function isJson5Whitespace(char) {
  return !isJsonWhitespace(char) && /\s/u.test(char);
}

/** @param {string} char */
function isValueDelimiter(char) {
  return (
    char === '' ||
    char === ',' ||
    char === ']' ||
    char === '}' ||
    char === '/' ||
    /\s/u.test(char)
  );
}

/** @param {string} char */
function isPropertyNameDelimiter(char) {
  return char === '' || char === ':' || char === '/' || /\s/u.test(char);
}

/** @param {string} raw */
function decodeIdentifierName(raw) {
  return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/**
 * @param {Record<string, unknown>} objectValue
 * @param {string} key
 * @param {unknown} value
 */
function setObjectValue(objectValue, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(objectValue, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return;
  }
  objectValue[key] = value;
}

/**
 * @param {JsonSourceNode} node
 * @param {string} path
 * @param {Record<string, any>} pointers
 */
function collectJsonSourcePointers(node, path, pointers) {
  pointers[path] = createPointer(node);
  if (node.kind !== 'array' && node.kind !== 'object') return;

  /** @type {{ node: JsonSourceArrayNode | JsonSourceObjectNode; path: string; index: number }[]} */
  const stack = [{ node, path, index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.node.kind === 'array') {
      if (frame.index >= frame.node.items.length) {
        stack.pop();
        continue;
      }
      const index = frame.index;
      frame.index += 1;
      const child = frame.node.items[index];
      const childSourcePath = childPath(frame.path, index);
      pointers[childSourcePath] = createPointer(child);
      if (child.kind === 'array' || child.kind === 'object') {
        stack.push({ node: child, path: childSourcePath, index: 0 });
      }
      continue;
    }

    if (frame.index >= frame.node.entries.length) {
      stack.pop();
      continue;
    }
    const entry = frame.node.entries[frame.index];
    frame.index += 1;
    const childSourcePath = childPathForSourceEntry(
      frame.path,
      entry.key,
      entry.occurrence ?? 0,
    );
    pointers[childSourcePath] = createPointer(entry.value, entry.keyStart, entry.keyEnd);
    if (entry.value.kind === 'array' || entry.value.kind === 'object') {
      stack.push({ node: entry.value, path: childSourcePath, index: 0 });
    }
  }
}

/**
 * @param {JsonSourceNode} node
 * @param {number} [keyStart]
 * @param {number} [keyEnd]
 */
function createPointer(node, keyStart, keyEnd) {
  if (keyStart !== undefined && keyEnd !== undefined) {
    return {
      valueStart: node.start,
      valueEnd: node.end,
      keyStart,
      keyEnd,
    };
  }
  return {
    valueStart: node.start,
    valueEnd: node.end,
  };
}

/**
 * @param {string} parentPath
 * @param {string | number} key
 */
function childPath(parentPath, key) {
  const segment = String(key).replaceAll('~', '~0').replaceAll('/', '~1');
  return parentPath ? `${parentPath}/${segment}` : `/${segment}`;
}

/**
 * @param {string} parentPath
 * @param {string} key
 * @param {number} occurrence
 */
function childPathForSourceEntry(parentPath, key, occurrence) {
  const basePath = childPath(parentPath, key);
  return occurrence === 0 ? basePath : `${basePath}~${occurrence + 1}`;
}

const SOURCE_NODE_MARKER = Symbol.for('jsonstudio.sourceNode');

/**
 * @typedef {'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'} JsonSourceKind
 *
 * @typedef {{
 *   key: string;
 *   keyStart: number;
 *   keyEnd: number;
 *   value: JsonSourceNode;
 *   occurrence: number;
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
 *   hasDuplicateKeys: false;
 * }} JsonSourceScalarNode
 *
 * @typedef {JsonSourceObjectNode | JsonSourceArrayNode | JsonSourceScalarNode} JsonSourceNode
 */

/**
 * @param {string} content
 * @returns {JsonSourceNode}
 */
export function parseJsonSourceModel(content) {
  const parser = new JsonSourceParser(content);
  const root = parser.parseValue();
  parser.skipWhitespace();
  if (!parser.isAtEnd()) {
    parser.fail('Unexpected trailing content');
  }
  return root;
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
  const pointers = {};
  collectJsonSourcePointers(root, '', pointers);
  return pointers;
}

class JsonSourceParser {
  /**
   * @param {string} content
   */
  constructor(content) {
    this.content = content;
    this.index = 0;
  }

  /** @returns {JsonSourceNode} */
  parseValue() {
    this.skipWhitespace();
    const char = this.peek();
    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === '"') return this.parseStringNode();
    if (char === '-' || isDigit(char)) return this.parseNumber();
    if (this.content.startsWith('true', this.index)) return this.parseLiteral('true', true, 'boolean');
    if (this.content.startsWith('false', this.index)) return this.parseLiteral('false', false, 'boolean');
    if (this.content.startsWith('null', this.index)) return this.parseLiteral('null', null, 'null');
    return this.fail('Expected JSON value');
  }

  /** @returns {JsonSourceObjectNode} */
  parseObject() {
    const start = this.index;
    this.index += 1;
    /** @type {JsonSourceObjectEntry[]} */
    const entries = [];
    /** @type {Map<string, number>} */
    const counts = new Map();
    let hasDuplicateKeys = false;

    this.skipWhitespace();
    if (this.consume('}')) {
      return markSourceNode({
        kind: 'object',
        value: {},
        entries,
        start,
        end: this.index,
        hasDuplicateKeys,
      });
    }

    while (true) {
      this.skipWhitespace();
      const keyNode = this.parseStringNode();
      const key = String(keyNode.value);
      this.skipWhitespace();
      if (!this.consume(':')) this.fail('Expected ":" after object key');

      const value = this.parseValue();
      const occurrence = counts.get(key) ?? 0;
      counts.set(key, occurrence + 1);
      hasDuplicateKeys = hasDuplicateKeys || occurrence > 0 || value.hasDuplicateKeys;
      entries.push({
        key,
        keyStart: keyNode.start,
        keyEnd: keyNode.end,
        value,
        occurrence,
      });

      this.skipWhitespace();
      if (this.consume('}')) break;
      if (!this.consume(',')) this.fail('Expected "," or "}" after object entry');
    }

    /** @type {Record<string, unknown>} */
    const objectValue = {};
    for (const entry of entries) {
      objectValue[entry.key] = entry.value.value;
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
    let hasDuplicateKeys = false;

    this.skipWhitespace();
    if (this.consume(']')) {
      return markSourceNode({
        kind: 'array',
        value: [],
        items,
        start,
        end: this.index,
        hasDuplicateKeys,
      });
    }

    while (true) {
      const item = this.parseValue();
      hasDuplicateKeys = hasDuplicateKeys || item.hasDuplicateKeys;
      items.push(item);
      this.skipWhitespace();
      if (this.consume(']')) break;
      if (!this.consume(',')) this.fail('Expected "," or "]" after array item');
    }

    return markSourceNode({
      kind: 'array',
      value: items.map((item) => item.value),
      items,
      start,
      end: this.index,
      hasDuplicateKeys,
    });
  }

  /** @returns {JsonSourceScalarNode} */
  parseStringNode() {
    const start = this.index;
    if (!this.consume('"')) this.fail('Expected string');
    while (!this.isAtEnd()) {
      const char = this.peek();
      this.index += 1;
      if (char === '"') {
        const raw = this.content.slice(start, this.index);
        return markSourceNode({
          kind: 'string',
          value: JSON.parse(raw),
          start,
          end: this.index,
          hasDuplicateKeys: false,
        });
      }
      if (char === '\\') {
        this.index += 1;
      }
    }
    return this.fail('Unterminated string');
  }

  /** @returns {JsonSourceScalarNode} */
  parseNumber() {
    const start = this.index;
    if (this.peek() === '-') this.index += 1;
    if (this.peek() === '0') {
      this.index += 1;
    } else if (isDigitOneToNine(this.peek())) {
      while (isDigit(this.peek())) this.index += 1;
    } else {
      this.fail('Invalid number');
    }
    if (this.peek() === '.') {
      this.index += 1;
      if (!isDigit(this.peek())) this.fail('Invalid number');
      while (isDigit(this.peek())) this.index += 1;
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.index += 1;
      if (this.peek() === '+' || this.peek() === '-') this.index += 1;
      if (!isDigit(this.peek())) this.fail('Invalid number');
      while (isDigit(this.peek())) this.index += 1;
    }

    return markSourceNode({
      kind: 'number',
      value: Number(this.content.slice(start, this.index)),
      start,
      end: this.index,
      hasDuplicateKeys: false,
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
      hasDuplicateKeys: false,
    });
  }

  skipWhitespace() {
    while (/\s/.test(this.peek())) this.index += 1;
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

  /**
   * @param {string} message
   * @returns {never}
   */
  fail(message) {
    throw new SyntaxError(`${message} at position ${this.index}`);
  }
}

/**
 * @template {Record<string | symbol, unknown>} T
 * @param {T} node
 * @returns {T & { [SOURCE_NODE_MARKER]: true }}
 */
function markSourceNode(node) {
  Object.defineProperty(node, SOURCE_NODE_MARKER, {
    value: true,
    enumerable: false,
  });
  return /** @type {T & { [SOURCE_NODE_MARKER]: true }} */ (node);
}

/** @param {string} char */
function isDigit(char) {
  return char >= '0' && char <= '9';
}

/** @param {string} char */
function isDigitOneToNine(char) {
  return char >= '1' && char <= '9';
}

/**
 * @param {JsonSourceNode} node
 * @param {string} path
 * @param {Record<string, any>} pointers
 */
function collectJsonSourcePointers(node, path, pointers) {
  pointers[path] = {
    value: { pos: node.start },
    valueEnd: { pos: node.end },
  };

  if (node.kind === 'array') {
    node.items.forEach((item, index) => {
      collectJsonSourcePointers(item, childPath(path, index), pointers);
    });
    return;
  }

  if (node.kind === 'object') {
    node.entries.forEach((entry) => {
      const entryPath = childPathForSourceEntry(path, entry.key, entry.occurrence);
      pointers[entryPath] = {
        key: { pos: entry.keyStart },
        keyEnd: { pos: entry.keyEnd },
        value: { pos: entry.value.start },
        valueEnd: { pos: entry.value.end },
      };
      collectJsonSourcePointers(entry.value, entryPath, pointers);
      pointers[entryPath].key = { pos: entry.keyStart };
      pointers[entryPath].keyEnd = { pos: entry.keyEnd };
    });
  }
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
  return occurrence === 0 ? basePath : `${basePath}#${occurrence + 1}`;
}

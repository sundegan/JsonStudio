/**
 * @param {{ getLineCount(): number; getLineContent(lineNumber: number): string }} model
 * @returns {{ start: number; end: number }[]}
 */
export function getJson5FoldingRanges(model) {
  const ranges = [];
  const stack = [];
  let quote = '';
  let escaped = false;
  let inBlockComment = false;
  const lineCount = model.getLineCount();

  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
    const line = model.getLineContent(lineNumber);
    let inLineComment = false;

    for (let column = 0; column < line.length; column += 1) {
      const char = line[column];
      const next = line[column + 1];

      if (inLineComment) {
        if (char === '\u2028' || char === '\u2029') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          column += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = '';
        }
        continue;
      }

      if (char === '/' && next === '/') {
        inLineComment = true;
        column += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        column += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '{' || char === '[') {
        stack.push({ char, line: lineNumber });
        continue;
      }
      if (char === '}' || char === ']') {
        const opener = stack.at(-1);
        if (opener?.char === (char === '}' ? '{' : '[')) {
          stack.pop();
          if (opener.line < lineNumber) {
            ranges.push({ start: opener.line, end: lineNumber });
          }
        }
      }
    }

    if (lineNumber < lineCount && quote) {
      if (escaped) {
        escaped = false;
      } else {
        quote = '';
      }
    }
  }

  return ranges;
}

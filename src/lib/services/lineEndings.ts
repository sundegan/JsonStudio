/**
 * Normalize line endings to LF for cross-platform string comparison.
 *
 * This fixes Windows compatibility issues where CRLF (\r\n) line endings
 * cause string comparisons to fail even when the content is semantically identical.
 *
 * @param str - String to normalize
 * @returns String with all CRLF converted to LF
 */
export function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

/**
 * Check if two strings are equal after normalizing line endings.
 *
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal after line ending normalization
 */
export function areStringsEqualNormalized(a: string, b: string): boolean {
  return normalizeLineEndings(a) === normalizeLineEndings(b);
}

import * as prettier from 'prettier/standalone';
import * as babelPlugin from 'prettier/plugins/babel';
import * as estreePlugin from 'prettier/plugins/estree';

/**
 * Format JSON5 while keeping JSON5 syntax instead of converting it to strict JSON.
 *
 * @param {string} content
 * @param {number} indent
 * @returns {Promise<string>}
 */
export async function formatJson5(content, indent = 2) {
  return await prettier.format(content, {
    parser: 'json5',
    plugins: [babelPlugin, estreePlugin],
    tabWidth: indent,
  });
}

/**
 * Format strict JSON from source text so duplicate object keys remain intact.
 *
 * @param {string} content
 * @param {number} indent
 * @returns {Promise<string>}
 */
export async function formatJsonText(content, indent = 2) {
  return await prettier.format(content, {
    parser: 'json-stringify',
    plugins: [babelPlugin, estreePlugin],
    tabWidth: indent,
  });
}

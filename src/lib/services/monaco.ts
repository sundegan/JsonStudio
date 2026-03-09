import loader from '@monaco-editor/loader';
import * as monaco from 'monaco-editor';

let monacoInitPromise: Promise<typeof monaco> | null = null;

/**
 * Initialize Monaco in a Vite-bundled way.
 *
 * This avoids runtime loading from /node_modules/monaco-editor/... which fails
 * in packaged desktop builds (e.g. Tauri on macOS).
 */
export function initMonaco(): Promise<typeof monaco> {
  if (!monacoInitPromise) {
    loader.config({ monaco });
    monacoInitPromise = loader.init() as Promise<typeof monaco>;
  }
  return monacoInitPromise;
}

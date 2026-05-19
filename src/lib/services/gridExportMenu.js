/**
 * @param {{ closest?: (selector: string) => unknown } | null | undefined} target
 */
export function shouldCloseGridExportMenu(target) {
  return !target?.closest?.('.gv-export');
}

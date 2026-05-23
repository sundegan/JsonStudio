/**
 * @param {string} payload
 * @param {{
 *   tabsStore: { addTab: (content: string) => boolean | void },
 *   normalize: (value: string) => Promise<string | null>,
 * }} options
 */
export async function openClipboardContentInNewTab(payload, { tabsStore, normalize }) {
  const nextContent = await normalize(payload).catch(() => null) || payload;
  const opened = tabsStore.addTab(nextContent) !== false;
  return {
    content: nextContent,
    opened,
  };
}

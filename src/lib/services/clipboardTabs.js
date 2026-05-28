/**
 * @param {string} payload
 * @param {{
 *   tabsStore: { addTab: (content: string) => void },
 *   normalize: (value: string) => Promise<string | null>,
 * }} options
 */
export async function openClipboardContentInNewTab(payload, { tabsStore, normalize }) {
  const nextContent = await normalize(payload).catch(() => null) || payload;
  tabsStore.addTab(nextContent);
  return {
    content: nextContent,
  };
}

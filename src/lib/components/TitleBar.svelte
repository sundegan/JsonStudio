<script lang="ts">
  import { onMount } from 'svelte';
  import type { Window as TauriWindow } from '@tauri-apps/api/window';

  type TitlebarPlatform = 'macos' | 'windows' | 'linux';

  let { platform = 'macos' } = $props<{ platform?: TitlebarPlatform }>();

  let appWindow: TauriWindow | null = null;
  let isWindowExpanded = $state(false);

  const closeWindow = () => appWindow?.close();
  const minimizeWindow = () => appWindow?.minimize();

  async function startWindowDrag(event: PointerEvent) {
    if (!appWindow || event.button !== 0) return;
    event.preventDefault();
    try {
      await appWindow.startDragging();
    } catch (error) {
      console.error('Failed to start window drag:', error);
    }
  }

  async function updateWindowState() {
    if (!appWindow) return;
    isWindowExpanded = await appWindow.isFullscreen() || await appWindow.isMaximized();
  }

  async function toggleMaximizeWindow() {
    if (!appWindow) return;
    await appWindow.toggleMaximize();
    await updateWindowState();
  }

  onMount(() => {
    void (async () => {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (!isTauri()) return;

      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      appWindow = getCurrentWindow();
      await updateWindowState();
    })();
  });
</script>

<header class={`titlebar titlebar-${platform}`}>
  <div class="titlebar-left">
    {#if platform === 'macos'}
      <div class="window-controls macos" aria-label="Window controls">
        <button class="traffic close" type="button" aria-label="Close" onclick={closeWindow}></button>
        <button class="traffic minimize" type="button" aria-label="Minimize" onclick={minimizeWindow}></button>
        <button
          class={`traffic maximize ${isWindowExpanded ? 'is-expanded' : ''}`}
          type="button"
          aria-label={isWindowExpanded ? 'Restore' : 'Maximize'}
          onclick={toggleMaximizeWindow}
        ></button>
      </div>
    {/if}
    <div class="titlebar-drag-fill" onpointerdown={startWindowDrag}></div>
  </div>

  <div class="titlebar-center" onpointerdown={startWindowDrag}></div>

  <div class="titlebar-right">
    <div class="titlebar-drag-fill" onpointerdown={startWindowDrag}></div>
    {#if platform !== 'macos'}
      <div class={`window-controls desktop ${platform}`} aria-label="Window controls">
        <button class="caption minimize" type="button" aria-label="Minimize" onclick={minimizeWindow}></button>
        <button
          class={`caption maximize ${isWindowExpanded ? 'is-expanded' : ''}`}
          type="button"
          aria-label={isWindowExpanded ? 'Restore' : 'Maximize'}
          onclick={toggleMaximizeWindow}
        ></button>
        <button class="caption close" type="button" aria-label="Close" onclick={closeWindow}></button>
      </div>
    {/if}
  </div>
</header>

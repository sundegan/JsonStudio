<script lang="ts">
  import { onMount } from 'svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import { settingsStore } from '$lib/stores/settings';
  import { shortcutsStore } from '$lib/stores/shortcuts';
  import '../app.css';

  type TitlebarPlatform = 'macos' | 'windows' | 'linux';

  let platform = $state<TitlebarPlatform>('macos');
  let isWindowInactive = $state(false);

  async function detectPlatform(): Promise<TitlebarPlatform> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const desktopPlatform = await invoke<string>('desktop_platform');
      if (desktopPlatform === 'macos') return 'macos';
      if (desktopPlatform === 'windows') return 'windows';
      if (desktopPlatform === 'linux') return 'linux';
      console.warn('Unknown desktop platform:', desktopPlatform);
    } catch (error) {
      console.warn('Failed to detect desktop platform:', error);
    }
    return 'macos';
  }

  async function applyTheme(isDarkMode: boolean) {
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.remove('light');
    } else {
      html.classList.add('light');
    }
    html.style.colorScheme = isDarkMode ? 'dark' : 'light';
    
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_window_theme', { isDark: isDarkMode });
    } catch (error) {
      console.error('Failed to update window theme:', error);
    }
  }

  onMount(() => {
    settingsStore.init();
    shortcutsStore.init();
    void detectPlatform().then((value) => {
      platform = value;
    });
    const focusUnlisteners: Array<() => void> = [];
    void (async () => {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (!isTauri()) return;

      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      isWindowInactive = !(await appWindow.isFocused());
      const unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
        isWindowInactive = !focused;
      });
      focusUnlisteners.push(unlisten);
    })();
    const unsubscribe = settingsStore.subscribe(settings => {
      applyTheme(settings.isDarkMode);
    });
    return () => {
      unsubscribe();
      for (const unlisten of focusUnlisteners) unlisten();
    };
  });
</script>

<div class={`desktop-window-frame desktop-window-frame-${platform} ${isWindowInactive ? 'is-inactive' : ''}`}>
  <div class="app-window">
    <TitleBar {platform} />
    <div class="app-content">
      <slot />
    </div>
  </div>
</div>

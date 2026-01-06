<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from '$lib/stores/settings';
  import { shortcutsStore } from '$lib/stores/shortcuts';
  import '../app.css';

  async function applyTheme(isDarkMode: boolean) {
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.remove('light');
    } else {
      html.classList.add('light');
    }
    
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
    const unsubscribe = settingsStore.subscribe(settings => {
      applyTheme(settings.isDarkMode);
    });
    return () => unsubscribe();
  });
</script>

<div class="h-full w-full bg-(--bg-base)">
  <slot />
</div>


<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from '$lib/stores/settings';
  import '../app.css';

  // 应用主题类到 html 元素
  async function applyTheme(isDarkMode: boolean) {
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.remove('light');
    } else {
      html.classList.add('light');
    }
    
    // 同步更新 macOS 窗口主题
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_window_theme', { isDark: isDarkMode });
    } catch (error) {
      console.error('Failed to update window theme:', error);
    }
  }

  // 初始化设置并应用主题
  onMount(() => {
    settingsStore.init();
    
    // 订阅设置变化，应用主题类到 html 元素
    const unsubscribe = settingsStore.subscribe(settings => {
      applyTheme(settings.isDarkMode);
    });
    
    return () => unsubscribe();
  });
</script>

<div class="h-full w-full bg-(--bg-base)">
  <slot />
</div>


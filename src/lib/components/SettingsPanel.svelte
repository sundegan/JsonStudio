<script lang="ts">
  import { settingsStore, darkThemes, lightThemes, type AppSettings } from '$lib/stores/settings';

  // 控制面板显示/隐藏
  let isOpen = $state(false);
  
  // 从 settingsStore 获取设置
  let settings = $state<AppSettings>({
    isDarkMode: false,
    darkTheme: 'one-dark',
    lightTheme: 'vs',
    fontSize: 13,
    tabSize: 2,
  });
  
  // 订阅 settingsStore 变化
  $effect(() => {
    const unsubscribe = settingsStore.subscribe(newSettings => {
      settings = newSettings;
    });
    return () => unsubscribe();
  });

  // 导出 open/close 方法供父组件调用
  export function open() {
    isOpen = true;
  }

  export function close() {
    isOpen = false;
  }

  // 处理主题切换
  function handleThemeModeToggle() {
    settingsStore.updateSetting('isDarkMode', !settings.isDarkMode);
  }

  // 处理深色主题选择
  function handleDarkThemeSelect(themeId: string) {
    settingsStore.updateSetting('darkTheme', themeId as AppSettings['darkTheme']);
  }

  // 处理亮色主题选择
  function handleLightThemeSelect(themeId: string) {
    settingsStore.updateSetting('lightTheme', themeId as AppSettings['lightTheme']);
  }

  // 处理字体大小变化
  function handleFontSizeChange(value: number) {
    settingsStore.updateSetting('fontSize', value);
  }

  // 处理 Tab 大小变化
  function handleTabSizeChange(value: number) {
    settingsStore.updateSetting('tabSize', value);
  }

  // 点击遮罩层关闭
  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  // ESC 键关闭
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- 遮罩层 -->
{#if isOpen}
  <div
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50
           flex items-center justify-center p-4
           animate-[fadeIn_0.2s_ease-out]"
    onclick={handleBackdropClick}
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
  >
    <!-- 设置面板 -->
    <div
      class="bg-(--bg-primary) border border-(--border) rounded-lg shadow-xl
             w-full max-w-2xl max-h-[90vh] overflow-hidden
             flex flex-col
             animate-[slideUp_0.2s_ease-out]"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-(--border)">
        <h2 id="settings-title" class="text-lg font-semibold text-(--text-primary)">
          设置
        </h2>
        <button
          class="w-8 h-8 flex items-center justify-center rounded-md
                 text-(--text-secondary)
                 hover:bg-(--bg-tertiary) hover:text-(--text-primary)
                 transition-colors"
          onclick={close}
          title="关闭"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- 内容区域 -->
      <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        <!-- 主题模式切换 -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <label class="text-sm font-medium text-(--text-primary)">
              主题模式
            </label>
            <button
              class="flex items-center gap-2 px-3 py-1.5 rounded-md
                     bg-(--bg-secondary) border border-(--border)
                     text-(--text-primary) text-sm
                     hover:bg-(--bg-tertiary) transition-colors"
              onclick={handleThemeModeToggle}
            >
              {#if settings.isDarkMode}
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                </svg>
                <span>深色模式</span>
              {:else}
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="5"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
                <span>亮色模式</span>
              {/if}
            </button>
          </div>
        </div>

        <!-- 深色主题选择 -->
        {#if settings.isDarkMode}
          <div>
            <label class="block text-sm font-medium text-(--text-primary) mb-3">
              深色主题
            </label>
            <div class="grid grid-cols-1 gap-2">
              {#each darkThemes as theme}
                <button
                  class="flex items-start gap-3 p-3 rounded-md border
                         transition-all
                         {settings.darkTheme === theme.id
                           ? 'border-(--accent) bg-(--accent)/10'
                           : 'border-(--border) bg-(--bg-secondary) hover:bg-(--bg-tertiary)'}"
                  onclick={() => handleDarkThemeSelect(theme.id)}
                >
                  <div class="flex-1 text-left">
                    <div class="text-sm font-medium text-(--text-primary) mb-1">
                      {theme.name}
                    </div>
                    <div class="text-xs text-(--text-muted)">
                      {theme.description}
                    </div>
                  </div>
                  {#if settings.darkTheme === theme.id}
                    <svg class="w-5 h-5 text-(--accent) flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 亮色主题选择 -->
        {#if !settings.isDarkMode}
          <div>
            <label class="block text-sm font-medium text-(--text-primary) mb-3">
              亮色主题
            </label>
            <div class="grid grid-cols-1 gap-2">
              {#each lightThemes as theme}
                <button
                  class="flex items-start gap-3 p-3 rounded-md border
                         transition-all
                         {settings.lightTheme === theme.id
                           ? 'border-(--accent) bg-(--accent)/10'
                           : 'border-(--border) bg-(--bg-secondary) hover:bg-(--bg-tertiary)'}"
                  onclick={() => handleLightThemeSelect(theme.id)}
                >
                  <div class="flex-1 text-left">
                    <div class="text-sm font-medium text-(--text-primary) mb-1">
                      {theme.name}
                    </div>
                    <div class="text-xs text-(--text-muted)">
                      {theme.description}
                    </div>
                  </div>
                  {#if settings.lightTheme === theme.id}
                    <svg class="w-5 h-5 text-(--accent) flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 编辑器设置 -->
        <div class="space-y-4 pt-4 border-t border-(--border)">
          <h3 class="text-sm font-medium text-(--text-primary) mb-4">
            编辑器设置
          </h3>

          <!-- 字体大小 -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm text-(--text-primary)">
                字体大小
              </label>
              <span class="text-sm text-(--text-secondary) font-mono">
                {settings.fontSize}px
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="24"
              value={settings.fontSize}
              oninput={(e) => handleFontSizeChange(Number(e.currentTarget.value))}
              class="w-full h-2 bg-(--bg-secondary) rounded-lg appearance-none cursor-pointer
                     accent-(--accent)"
            />
            <div class="flex justify-between text-xs text-(--text-muted) mt-1">
              <span>10px</span>
              <span>24px</span>
            </div>
          </div>

          <!-- Tab 大小 -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-sm text-(--text-primary)">
                Tab 大小
              </label>
              <span class="text-sm text-(--text-secondary) font-mono">
                {settings.tabSize} 空格
              </span>
            </div>
            <div class="flex gap-2">
              {#each [2, 4, 8] as size}
                <button
                  class="flex-1 px-3 py-2 rounded-md border text-sm font-medium
                         transition-all
                         {settings.tabSize === size
                           ? 'border-(--accent) bg-(--accent)/10 text-(--accent)'
                           : 'border-(--border) bg-(--bg-secondary) text-(--text-secondary) hover:bg-(--bg-tertiary)'}"
                  onclick={() => handleTabSizeChange(size)}
                >
                  {size}
                </button>
              {/each}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(20px) scale(0.95);
    }
    to { 
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>


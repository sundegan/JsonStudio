<script lang="ts">
  import { settingsStore, darkThemes, lightThemes, type AppSettings } from '$lib/stores/settings';

  let isOpen = $state(false);
  
  let settings = $state<AppSettings>({
    isDarkMode: false,
    darkTheme: 'one-dark',
    lightTheme: 'vs',
    fontSize: 13,
    tabSize: 2,
  });
  
  $effect(() => {
    const unsubscribe = settingsStore.subscribe(newSettings => {
      settings = newSettings;
    });
    return () => unsubscribe();
  });

  export function open() {
    isOpen = true;
  }

  function handleThemeModeToggle() {
    settingsStore.updateSetting('isDarkMode', !settings.isDarkMode);
  }

  function handleDarkThemeSelect(themeId: string) {
    settingsStore.updateSetting('darkTheme', themeId as AppSettings['darkTheme']);
  }

  function handleLightThemeSelect(themeId: string) {
    settingsStore.updateSetting('lightTheme', themeId as AppSettings['lightTheme']);
  }

  function handleFontSizeChange(value: number) {
    settingsStore.updateSetting('fontSize', value);
  }

  function handleTabSizeChange(value: number) {
    settingsStore.updateSetting('tabSize', value);
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      isOpen = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      isOpen = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div
    class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-[fadeIn_0.2s_ease-out]"
    onclick={handleBackdropClick}
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
  >
    <div
      class="bg-(--bg-primary) border border-(--border) rounded-xl shadow-2xl w-full max-w-xl h-[85vh] flex flex-col animate-[slideUp_0.2s_ease-out]"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between px-6 py-4 border-b border-(--border) shrink-0">
        <h2 id="settings-title" class="text-lg font-semibold text-(--text-primary)">设置</h2>
        <button
          class="w-8 h-8 flex items-center justify-center rounded-md text-(--text-secondary)
                 hover:bg-(--bg-tertiary) hover:text-(--text-primary) transition-all"
          onclick={() => { isOpen = false; }}
          type="button"
        >
          <svg class="w-5 h-5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-8 space-y-8">
        <div class="space-y-6 p-6 rounded-lg" style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08);">
          <h3 class="text-sm font-semibold uppercase tracking-wider pb-3" style="color: var(--text-secondary);">外观</h3>
          
          <div class="space-y-2">
            <label class="text-sm font-medium text-(--text-primary)">主题</label>
            <div class="flex gap-2">
              <button
                class="flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-all {!settings.isDarkMode ? 'bg-(--accent) text-white' : 'bg-(--bg-secondary) text-(--text-secondary) hover:bg-(--bg-tertiary) border border-(--border)'}"
                onclick={handleThemeModeToggle}
              >亮色</button>
              <button
                class="flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-all {settings.isDarkMode ? 'bg-(--accent) text-white' : 'bg-(--bg-secondary) text-(--text-secondary) hover:bg-(--bg-tertiary) border border-(--border)'}"
                onclick={handleThemeModeToggle}
              >深色</button>
            </div>
          </div>

          {#if settings.isDarkMode}
            <div class="space-y-2">
              <label class="text-sm font-medium text-(--text-primary)">深色主题</label>
              <div class="space-y-1.5">
                {#each darkThemes as theme}
                  <button
                    class="w-full flex items-center gap-3 py-2.5 px-3 rounded-md transition-all {settings.darkTheme === theme.id ? 'bg-(--accent)/10 border border-(--accent)/30' : 'hover:bg-(--bg-secondary) border border-transparent'}"
                    onclick={() => handleDarkThemeSelect(theme.id)}
                  >
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 {settings.darkTheme === theme.id ? 'border-(--accent) bg-(--accent)' : 'border-(--border)'}">
                      {#if settings.darkTheme === theme.id}
                        <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
                      {/if}
                    </div>
                    <div class="text-left flex-1">
                      <div class="text-sm font-medium text-(--text-primary)">{theme.name}</div>
                      <div class="text-xs text-(--text-secondary)">{theme.description}</div>
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          {#if !settings.isDarkMode}
            <div class="space-y-2">
              <label class="text-sm font-medium text-(--text-primary)">亮色主题</label>
              <div class="space-y-1.5">
                {#each lightThemes as theme}
                  <button
                    class="w-full flex items-center gap-3 py-2.5 px-3 rounded-md transition-all {settings.lightTheme === theme.id ? 'bg-(--accent)/10 border border-(--accent)/30' : 'hover:bg-(--bg-secondary) border border-transparent'}"
                    onclick={() => handleLightThemeSelect(theme.id)}
                  >
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 {settings.lightTheme === theme.id ? 'border-(--accent) bg-(--accent)' : 'border-(--border)'}">
                      {#if settings.lightTheme === theme.id}
                        <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
                      {/if}
                    </div>
                    <div class="text-left flex-1">
                      <div class="text-sm font-medium text-(--text-primary)">{theme.name}</div>
                      <div class="text-xs text-(--text-secondary)">{theme.description}</div>
                    </div>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="space-y-6 p-6 rounded-lg" style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08);">
          <h3 class="text-sm font-semibold uppercase tracking-wider pb-3" style="color: var(--text-secondary);">编辑器</h3>

          <div class="space-y-2">
            <label class="text-sm font-medium text-(--text-primary)">字体大小</label>
            <div class="flex items-center gap-2">
              <input
                type="number"
                min="10"
                max="24"
                value={settings.fontSize}
                oninput={(e) => {
                  const value = Number(e.currentTarget.value);
                  if (value >= 10 && value <= 24) handleFontSizeChange(value);
                }}
                class="flex-1 px-3 py-2 rounded-md border border-(--border) bg-(--bg-secondary) text-(--text-primary) font-mono text-sm focus:border-(--accent) focus:outline-none transition-colors"
              />
              <span class="text-sm text-(--text-secondary)">px</span>
            </div>
          </div>

          <div class="space-y-2">
            <label class="text-sm font-medium text-(--text-primary)">缩进大小</label>
            <div class="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="8"
                value={settings.tabSize}
                oninput={(e) => {
                  const value = Number(e.currentTarget.value);
                  if (value >= 1 && value <= 8) handleTabSizeChange(value);
                }}
                class="flex-1 px-3 py-2 rounded-md border border-(--border) bg-(--bg-secondary) text-(--text-primary) font-mono text-sm focus:border-(--accent) focus:outline-none transition-colors"
              />
              <span class="text-sm text-(--text-secondary)">空格</span>
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


<script lang="ts">
  import { settingsStore, darkThemes, lightThemes, type AppSettings } from '$lib/stores/settings';
  import { shortcutsStore, type ShortcutsSettings } from '$lib/stores/shortcuts';
  import ShortcutRecorder from './ShortcutRecorder.svelte';

  let isOpen = $state(false);
  let shortcuts = $state<ShortcutsSettings>({
    showApp: {
      id: 'show_app',
      name: 'Show App',
      description: 'Bring Json Studio to front',
      defaultKey: 'CommandOrControl+Shift+J',
      currentKey: 'CommandOrControl+Shift+J'
    },
    formatClipboard: {
      id: 'format_clipboard',
      name: 'Format Clipboard',
      description: 'Format JSON in clipboard and display',
      defaultKey: 'CommandOrControl+Shift+V',
      currentKey: 'CommandOrControl+Shift+V'
    }
  });
  
  let settings = $state<AppSettings>({
    isDarkMode: false,
    darkTheme: 'one-dark',
    lightTheme: 'vs',
    fontSize: 13,
    lineHeight: 20,
    tabSize: 2,
    showTreeView: true,
  });
  
  $effect(() => {
    const unsubscribe = settingsStore.subscribe(newSettings => {
      settings = newSettings;
    });
    return () => unsubscribe();
  });

  $effect(() => {
    const unsubscribe = shortcutsStore.subscribe(newShortcuts => {
      shortcuts = newShortcuts;
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

  function handleLineHeightChange(value: number) {
    settingsStore.updateSetting('lineHeight', value);
  }

  function handleTabSizeChange(value: number) {
    settingsStore.updateSetting('tabSize', value);
  }

  function handleTreeViewToggle(value: boolean) {
    settingsStore.updateSetting('showTreeView', value);
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
        <h2 id="settings-title" class="text-lg font-semibold text-(--text-primary)">Settings</h2>
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

      <div class="flex-1 overflow-y-auto px-6 py-8">
        <div class="space-y-6 p-6 rounded-lg" style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 8px;">
          <h3 class="text-sm settings-text font-semibold uppercase tracking-wider pb-3" style="color: var(--text-secondary);">Appearance</h3>
          
          <div class="space-y-2">
            <label class="text-sm font-medium text-(--text-primary)">Theme</label>
            <div class="flex gap-2">
              <button
                class="flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-all {!settings.isDarkMode ? 'bg-(--accent) text-white' : 'bg-(--bg-secondary) text-(--text-secondary) hover:bg-(--bg-tertiary) border border-(--border)'}"
                onclick={handleThemeModeToggle}
              >Light</button>
              <button
                class="flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-all {settings.isDarkMode ? 'bg-(--accent) text-white' : 'bg-(--bg-secondary) text-(--text-secondary) hover:bg-(--bg-tertiary) border border-(--border)'}"
                onclick={handleThemeModeToggle}
              >Dark</button>
            </div>
          </div>

          {#if settings.isDarkMode}
            <div class="space-y-2">
              <label class="text-sm font-medium text-(--text-primary)">Dark Theme</label>
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
              <label class="text-sm font-medium text-(--text-primary)">Light Theme</label>
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

        <div class="space-y-6 p-6 rounded-lg" style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 8px;">
          <h3 class="text-sm settings-text font-semibold uppercase tracking-wider pb-3" style="color: var(--text-secondary);">Editor</h3>

          <div class="space-y-1">
            <div class="flex items-center py-2 px-3 -mx-3 rounded transition-colors hover:bg-(--bg-secondary)">
              <div class="flex-1 min-w-0">
                <div class="text-sm settings-text text-(--text-primary)">Font Size</div>
              </div>
              <div class="relative w-32">
                <input
                  type="number"
                  min="10"
                  max="24"
                  value={settings.fontSize}
                  oninput={(e) => {
                    const value = Number(e.currentTarget.value);
                    if (value >= 10 && value <= 24) handleFontSizeChange(value);
                  }}
                  class="w-full px-2 py-1 pr-11 text-xs font-mono text-center rounded border transition-all"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary); outline: none;"
                />
                <div class="absolute text-xs pointer-events-none" style="color: var(--text-secondary); right: 1rem; top: calc(50% + 1px); transform: translateY(-50%); line-height: 1; font-size: 0.75rem;">px</div>
              </div>
            </div>

            <div class="flex items-center py-2 px-3 -mx-3 rounded transition-colors hover:bg-(--bg-secondary)">
              <div class="flex-1 min-w-0">
                <div class="text-sm settings-text text-(--text-primary)">Line Height</div>
              </div>
              <div class="relative w-32">
                <input
                  type="number"
                  min="14"
                  max="36"
                  value={settings.lineHeight}
                  oninput={(e) => {
                    const value = Number(e.currentTarget.value);
                    if (value >= 14 && value <= 36) handleLineHeightChange(value);
                  }}
                  class="w-full px-2 py-1 pr-11 text-xs font-mono text-center rounded border transition-all"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary); outline: none;"
                />
                <div class="absolute text-xs pointer-events-none" style="color: var(--text-secondary); right: 1rem; top: calc(50% + 1px); transform: translateY(-50%); line-height: 1; font-size: 0.75rem;">px</div>
              </div>
            </div>

            <div class="flex items-center py-2 px-3 -mx-3 rounded transition-colors hover:bg-(--bg-secondary)">
              <div class="flex-1 min-w-0">
                <div class="text-sm settings-text text-(--text-primary)">Indent Size</div>
              </div>
              <div class="relative w-32">
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={settings.tabSize}
                  oninput={(e) => {
                    const value = Number(e.currentTarget.value);
                    if (value >= 1 && value <= 8) handleTabSizeChange(value);
                  }}
                  class="w-full px-2 py-1 pr-16 text-xs font-mono text-center rounded border transition-all"
                  style="background-color: var(--bg-secondary); border-color: var(--border); color: var(--text-primary); outline: none;"
                />
                <div class="absolute text-xs pointer-events-none" style="color: var(--text-secondary); right: 1rem; top: calc(50% + 1px); transform: translateY(-50%); line-height: 1; font-size: 0.75rem;">spaces</div>
              </div>
            </div>

            <div class="flex items-center py-2 px-3 -mx-3 rounded transition-colors hover:bg-(--bg-secondary)">
              <div class="flex-1 min-w-0">
                <div class="text-sm settings-text text-(--text-primary)">Tree View Sidebar</div>
                <div class="text-xs settings-text text-(--text-secondary)">Show JSON structure panel beside editor</div>
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 {settings.showTreeView ? 'bg-(--accent)' : 'bg-(--border)'}"
                  onclick={() => handleTreeViewToggle(!settings.showTreeView)}
                  type="button"
                  aria-pressed={settings.showTreeView}
                >
                  <span
                    class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 {settings.showTreeView ? 'translate-x-4' : 'translate-x-0'}"
                  ></span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-6 p-6 rounded-lg" style="background-color: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08);">
          <h3 class="text-sm settings-text font-semibold uppercase tracking-wider pb-3" style="color: var(--text-secondary);">Shortcuts</h3>

          <div class="space-y-1">
            {#snippet shortcutRow(shortcut: typeof shortcuts.showApp)}
              {@const isModified = shortcut.currentKey !== shortcut.defaultKey}
              <div 
                class="group flex items-center py-2 px-3 -mx-3 rounded transition-colors hover:bg-(--bg-secondary)"
              >
                <div class="flex-1 min-w-0">
                  <div class="text-sm text-(--text-primary)">{shortcut.name}</div>
                </div>
                <div class="flex items-center gap-2">
                  <div class="w-7 flex items-center justify-end">
                    {#if isModified}
                      <button
                        class="opacity-0 group-hover:opacity-100 transition-all duration-200 w-5 h-5 flex items-center justify-center rounded hover:bg-(--bg-tertiary)"
                        onclick={() => shortcutsStore.resetShortcut(shortcut.id)}
                        title="Reset to default"
                        type="button"
                      >
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);">
                          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                          <path d="M21 3v5h-5"/>
                        </svg>
                      </button>
                    {/if}
                  </div>
                  <ShortcutRecorder 
                    value={shortcut.currentKey}
                    onchange={(key) => shortcutsStore.updateShortcut(shortcut.id, key)}
                  />
                </div>
              </div>
            {/snippet}

            {@render shortcutRow(shortcuts.showApp)}
            {@render shortcutRow(shortcuts.formatClipboard)}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-text {
    letter-spacing: 0.02em;
  }

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


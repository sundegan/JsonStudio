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
    class="settings-backdrop"
    onclick={handleBackdropClick}
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
  >
    <div class="settings-dialog" onclick={(e) => e.stopPropagation()}>
      <!-- Header -->
      <div class="settings-header">
        <h2 id="settings-title" class="settings-title">Settings</h2>
        <button
          class="settings-close-btn"
          onclick={() => { isOpen = false; }}
          type="button"
        >
          <svg class="w-4.5 h-4.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="settings-body">
        <!-- Appearance -->
        <section class="settings-section">
          <h3 class="settings-section-title">Appearance</h3>

          <div class="settings-list">
            <div class="settings-item">
              <div class="settings-item-label">
                <span class="settings-item-name">Theme</span>
                <span class="settings-hint">Switch between light and dark appearance</span>
              </div>
              <div class="flex gap-2">
                <button
                  class="settings-theme-btn {!settings.isDarkMode ? 'is-active' : ''}"
                  onclick={handleThemeModeToggle}
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                  Light
                </button>
                <button
                  class="settings-theme-btn {settings.isDarkMode ? 'is-active' : ''}"
                  onclick={handleThemeModeToggle}
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                  Dark
                </button>
              </div>
            </div>

            {#if settings.isDarkMode}
              <div class="settings-item">
                <div class="settings-item-label">
                  <span class="settings-item-name">Color Scheme</span>
                  <span class="settings-hint">Choose a dark color scheme for the editor</span>
                </div>
                <div class="settings-theme-list">
                  {#each darkThemes as theme}
                    <button
                      class="settings-theme-option {settings.darkTheme === theme.id ? 'is-active' : ''}"
                      onclick={() => handleDarkThemeSelect(theme.id)}
                    >
                      <div class="settings-radio {settings.darkTheme === theme.id ? 'is-checked' : ''}">
                        {#if settings.darkTheme === theme.id}<div class="settings-radio-dot"></div>{/if}
                      </div>
                      <div class="flex-1">
                        <div class="settings-theme-option-name">{theme.name}</div>
                        <div class="settings-hint">{theme.description}</div>
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if !settings.isDarkMode}
              <div class="settings-item">
                <div class="settings-item-label">
                  <span class="settings-item-name">Color Scheme</span>
                  <span class="settings-hint">Choose a light color scheme for the editor</span>
                </div>
                <div class="settings-theme-list">
                  {#each lightThemes as theme}
                    <button
                      class="settings-theme-option {settings.lightTheme === theme.id ? 'is-active' : ''}"
                      onclick={() => handleLightThemeSelect(theme.id)}
                    >
                      <div class="settings-radio {settings.lightTheme === theme.id ? 'is-checked' : ''}">
                        {#if settings.lightTheme === theme.id}<div class="settings-radio-dot"></div>{/if}
                      </div>
                      <div class="flex-1">
                        <div class="settings-theme-option-name">{theme.name}</div>
                        <div class="settings-hint">{theme.description}</div>
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </section>

        <!-- Editor -->
        <section class="settings-section">
          <h3 class="settings-section-title">Editor</h3>

          <div class="settings-list">
            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">Font Size</span>
                  <span class="settings-hint">Editor text size (10–24 px)</span>
                </div>
                <div class="settings-number-input">
                  <button class="settings-stepper-btn" onclick={() => { if (settings.fontSize > 10) handleFontSizeChange(settings.fontSize - 1); }} disabled={settings.fontSize <= 10} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
                  </button>
                  <span class="settings-stepper-value">{settings.fontSize}</span>
                  <button class="settings-stepper-btn" onclick={() => { if (settings.fontSize < 24) handleFontSizeChange(settings.fontSize + 1); }} disabled={settings.fontSize >= 24} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">Line Height</span>
                  <span class="settings-hint">Vertical spacing between lines (14–36 px)</span>
                </div>
                <div class="settings-number-input">
                  <button class="settings-stepper-btn" onclick={() => { if (settings.lineHeight > 14) handleLineHeightChange(settings.lineHeight - 1); }} disabled={settings.lineHeight <= 14} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
                  </button>
                  <span class="settings-stepper-value">{settings.lineHeight}</span>
                  <button class="settings-stepper-btn" onclick={() => { if (settings.lineHeight < 36) handleLineHeightChange(settings.lineHeight + 1); }} disabled={settings.lineHeight >= 36} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">Indent Size</span>
                  <span class="settings-hint">Spaces per indentation level (1–8 space)</span>
                </div>
                <div class="settings-number-input">
                  <button class="settings-stepper-btn" onclick={() => { if (settings.tabSize > 1) handleTabSizeChange(settings.tabSize - 1); }} disabled={settings.tabSize <= 1} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
                  </button>
                  <span class="settings-stepper-value">{settings.tabSize}</span>
                  <button class="settings-stepper-btn" onclick={() => { if (settings.tabSize < 8) handleTabSizeChange(settings.tabSize + 1); }} disabled={settings.tabSize >= 8} type="button">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">Tree View Sidebar</span>
                  <span class="settings-hint">Show JSON structure panel beside editor</span>
                </div>
                <button
                  class="settings-toggle {settings.showTreeView ? 'is-on' : ''}"
                  onclick={() => handleTreeViewToggle(!settings.showTreeView)}
                  type="button"
                  aria-pressed={settings.showTreeView}
                >
                  <span class="settings-toggle-thumb"></span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Shortcuts -->
        <section class="settings-section">
          <h3 class="settings-section-title">Shortcuts</h3>

          <div class="settings-list">
            {#snippet shortcutRow(shortcut: typeof shortcuts.showApp)}
              {@const isModified = shortcut.currentKey !== shortcut.defaultKey}
              <div class="settings-item">
                <div class="settings-item-row group">
                  <div class="settings-item-label">
                    <span class="settings-item-name">{shortcut.name}</span>
                    <span class="settings-hint">{shortcut.description}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="w-7 flex items-center justify-end">
                      {#if isModified}
                        <button
                          class="settings-reset-btn"
                          onclick={() => shortcutsStore.resetShortcut(shortcut.id)}
                          title="Reset to default"
                          type="button"
                        >
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
              </div>
            {/snippet}

            {@render shortcutRow(shortcuts.showApp)}
            {@render shortcutRow(shortcuts.formatClipboard)}
          </div>
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Backdrop & Dialog */
  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: fadeIn 0.2s ease-out;
  }

  .settings-dialog {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.35);
    width: 100%;
    max-width: 720px;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  /* Header */
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 24px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .settings-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .settings-close-btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .settings-close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  /* Body */
  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px 28px;
  }

  /* Section */
  .settings-section {
    margin-bottom: 20px;
  }

  .settings-section:last-child {
    margin-bottom: 0;
  }

  .settings-section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    padding-bottom: 10px;
    margin-bottom: 0;
  }

  /* List & Items */
  .settings-list {
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }

  .settings-item {
    padding: 14px 16px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .settings-item:last-child {
    border-bottom: none;
  }

  .settings-item-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .settings-item-label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .settings-item-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: 0.01em;
  }

  .settings-hint {
    font-size: 11px;
    line-height: 1.4;
    color: color-mix(in srgb, var(--text-secondary) 60%, transparent);
  }

  /* Theme toggle buttons (Light / Dark) */
  .settings-theme-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .settings-theme-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .settings-theme-btn.is-active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  /* Theme option list (radio style) */
  .settings-theme-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }

  .settings-theme-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    width: 100%;
  }

  .settings-theme-option:hover {
    background: var(--bg-primary);
  }

  .settings-theme-option.is-active {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-color: color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .settings-theme-option-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  /* Radio dot */
  .settings-radio {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }

  .settings-radio.is-checked {
    border-color: var(--accent);
    background: var(--accent);
  }

  .settings-radio-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: white;
  }

  /* Number stepper */
  .settings-number-input {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .settings-stepper-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }

  .settings-stepper-btn svg {
    width: 12px;
    height: 12px;
  }

  .settings-stepper-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: color-mix(in srgb, var(--border) 100%, var(--text-secondary) 20%);
  }

  .settings-stepper-btn:active:not(:disabled) {
    transform: scale(0.92);
  }

  .settings-stepper-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .settings-stepper-value {
    min-width: 28px;
    text-align: center;
    font-size: 13px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 500;
    color: var(--text-primary);
  }

  /* Toggle switch */
  .settings-toggle {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    border: none;
    background: var(--border);
    cursor: pointer;
    transition: background 0.2s ease;
    flex-shrink: 0;
    padding: 0;
  }

  .settings-toggle.is-on {
    background: var(--accent);
  }

  .settings-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: white;
    transition: transform 0.2s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }

  .settings-toggle.is-on .settings-toggle-thumb {
    transform: translateX(16px);
  }

  /* Reset button (shortcuts) */
  .settings-reset-btn {
    opacity: 0;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .group:hover .settings-reset-btn {
    opacity: 1;
  }

  .settings-reset-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  /* Animations */
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(16px) scale(0.97);
    }
    to { 
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>


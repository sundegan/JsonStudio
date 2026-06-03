<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { check } from '@tauri-apps/plugin-updater';
  import { settingsStore, darkThemes, lightThemes, type AppSettings } from '$lib/stores/settings';
  import { shortcutsStore, type ShortcutsSettings } from '$lib/stores/shortcuts';
  import {
    checkInstallAndNotifyAppUpdate,
    checkForAppUpdate,
    createInitialUpdaterState,
    installAppUpdate,
    restartAfterAppUpdate,
  } from '$lib/services/appUpdater';
  import { t, availableLocales, localeNames, type Locale } from '$lib/i18n';
  import ShortcutRecorder from './ShortcutRecorder.svelte';

  type SettingsTab = 'appearance' | 'editor' | 'shortcuts' | 'application';

  const settingsTabs: Array<{ id: SettingsTab; labelKey: string }> = [
    { id: 'appearance', labelKey: 'settings.appearance' },
    { id: 'editor', labelKey: 'settings.editor' },
    { id: 'shortcuts', labelKey: 'settings.shortcuts' },
    { id: 'application', labelKey: 'settings.application' },
  ];

  let isOpen = $state(false);
  let activeTab = $state<SettingsTab>('appearance');
  let shortcuts = $state<ShortcutsSettings | null>(null);
  let updaterState = $state(createInitialUpdaterState(''));
  
  let settings = $state<AppSettings>({
    isDarkMode: false,
    darkTheme: 'one-dark',
    lightTheme: 'vs',
    language: 'zh',
    fontSize: 13,
    lineHeight: 20,
    tabSize: 2,
    showTreeView: true,
    showFolderView: true,
    autoSave: false,
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

  onMount(() => {
    let unlistenCheckForUpdate: (() => void) | null = null;

    getVersion()
      .then(version => {
        updaterState = { ...updaterState, currentVersion: version };
      })
      .catch(error => {
        updaterState = {
          ...updaterState,
          status: 'error',
          messageKey: 'settings.updateFailed',
          error: error instanceof Error ? error.message : String(error),
        };
      });

    listen('check-for-update', () => {
      void handleMenuCheckForUpdate();
    })
      .then(unlisten => {
        unlistenCheckForUpdate = unlisten;
      })
      .catch(error => {
        updaterState = {
          ...updaterState,
          status: 'error',
          messageKey: 'settings.updateFailed',
          error: error instanceof Error ? error.message : String(error),
        };
      });

    return () => {
      unlistenCheckForUpdate?.();
    };
  });

  export function open() {
    isOpen = true;
  }

  function selectTab(tab: SettingsTab) {
    activeTab = tab;
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

  function handleLanguageChange(lang: Locale) {
    settingsStore.updateSetting('language', lang);
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

  function handleFolderViewToggle(value: boolean) {
    settingsStore.updateSetting('showFolderView', value);
  }

  function handleAutoSaveToggle(value: boolean) {
    settingsStore.updateSetting('autoSave', value);
  }

  async function handleCheckForUpdate() {
    updaterState = {
      ...updaterState,
      status: 'checking',
      messageKey: 'settings.updateChecking',
      error: null,
    };
    updaterState = await checkForAppUpdate(updaterState, { check });
  }

  async function handleMenuCheckForUpdate() {
    await checkInstallAndNotifyAppUpdate({
      check,
      message: async content => window.alert(content),
      confirm: async content => window.confirm(content),
      relaunch: () => invoke('restart_app'),
      labels: {
        latest: $t('settings.updateLatest'),
        available: version =>
          `${$t('settings.menuUpdateAvailable')}${version ? ` ${version}` : ''}\n${$t('settings.menuUpdateDownloading')}`,
        readyToRestart: $t('settings.menuUpdateReadyToRestart'),
        failed: $t('settings.updateFailed'),
      },
    });
  }

  async function handleInstallUpdate() {
    updaterState = {
      ...updaterState,
      status: 'installing',
      messageKey: 'settings.updateInstalling',
      error: null,
    };
    updaterState = await installAppUpdate(updaterState);
  }

  async function handleRestartAfterUpdate() {
    try {
      await restartAfterAppUpdate({ relaunch: () => invoke('restart_app') });
    } catch (error) {
      updaterState = {
        ...updaterState,
        status: 'error',
        messageKey: 'settings.updateFailed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function isUpdaterBusy() {
    return updaterState.status === 'checking' || updaterState.status === 'installing';
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
    role="presentation"
  >
    <div
      class="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="settings-header">
        <h2 id="settings-title" class="settings-title">{$t('settings.title')}</h2>
        <button
          class="settings-close-btn"
          onclick={() => { isOpen = false; }}
          type="button"
          aria-label={$t('settings.close')}
        >
          <svg class="w-4.5 h-4.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="settings-content">
        <nav class="settings-tabs" aria-label={$t('settings.title')}>
          {#each settingsTabs as tab}
            <button
              class="settings-tab {activeTab === tab.id ? 'is-active' : ''}"
              type="button"
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onclick={() => selectTab(tab.id)}
            >
              {$t(tab.labelKey)}
            </button>
          {/each}
        </nav>

        <!-- Content -->
        <div class="settings-body">
        {#if activeTab === 'appearance'}
        <!-- Appearance -->
        <section class="settings-section">
          <h3 class="settings-section-title">{$t('settings.appearance')}</h3>

          <div class="settings-list">
            <!-- Language -->
            <div class="settings-item">
              <div class="settings-item-label">
                <span class="settings-item-name">{$t('settings.language')}</span>
                <span class="settings-hint">{$t('settings.languageHint')}</span>
              </div>
              <div class="flex gap-2">
                {#each availableLocales as lang}
                  <button
                    class="settings-theme-btn {settings.language === lang ? 'is-active' : ''}"
                    onclick={() => handleLanguageChange(lang)}
                  >
                    {localeNames[lang]}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Theme -->
            <div class="settings-item">
              <div class="settings-item-label">
                <span class="settings-item-name">{$t('settings.theme')}</span>
                <span class="settings-hint">{$t('settings.themeHint')}</span>
              </div>
              <div class="flex gap-2">
                <button
                  class="settings-theme-btn {!settings.isDarkMode ? 'is-active' : ''}"
                  onclick={handleThemeModeToggle}
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                  {$t('settings.light')}
                </button>
                <button
                  class="settings-theme-btn {settings.isDarkMode ? 'is-active' : ''}"
                  onclick={handleThemeModeToggle}
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                  {$t('settings.dark')}
                </button>
              </div>
            </div>

            {#if settings.isDarkMode}
              <div class="settings-item">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.colorScheme')}</span>
                  <span class="settings-hint">{$t('settings.darkColorSchemeHint')}</span>
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
                  <span class="settings-item-name">{$t('settings.colorScheme')}</span>
                  <span class="settings-hint">{$t('settings.lightColorSchemeHint')}</span>
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
        {/if}

        {#if activeTab === 'editor'}
        <!-- Editor -->
        <section class="settings-section">
          <h3 class="settings-section-title">{$t('settings.editor')}</h3>

          <div class="settings-list">
            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.fontSize')}</span>
                  <span class="settings-hint">{$t('settings.fontSizeHint')}</span>
                </div>
                <div class="settings-number-input">
                  <button class="settings-stepper-btn" onclick={() => { if (settings.fontSize > 10) handleFontSizeChange(settings.fontSize - 1); }} disabled={settings.fontSize <= 10} type="button" title={$t('settings.fontSize')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
                  </button>
                  <span class="settings-stepper-value">{settings.fontSize}</span>
                  <button class="settings-stepper-btn" onclick={() => { if (settings.fontSize < 24) handleFontSizeChange(settings.fontSize + 1); }} disabled={settings.fontSize >= 24} type="button" title={$t('settings.fontSize')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.lineHeight')}</span>
                  <span class="settings-hint">{$t('settings.lineHeightHint')}</span>
                </div>
                <div class="settings-number-input">
                  <button class="settings-stepper-btn" onclick={() => { if (settings.lineHeight > 14) handleLineHeightChange(settings.lineHeight - 1); }} disabled={settings.lineHeight <= 14} type="button" title={$t('settings.lineHeight')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
                  </button>
                  <span class="settings-stepper-value">{settings.lineHeight}</span>
                  <button class="settings-stepper-btn" onclick={() => { if (settings.lineHeight < 36) handleLineHeightChange(settings.lineHeight + 1); }} disabled={settings.lineHeight >= 36} type="button" title={$t('settings.lineHeight')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.indentSize')}</span>
                  <span class="settings-hint">{$t('settings.indentSizeHint')}</span>
                </div>
                <div class="settings-number-input">
                  <button class="settings-stepper-btn" onclick={() => { if (settings.tabSize > 1) handleTabSizeChange(settings.tabSize - 1); }} disabled={settings.tabSize <= 1} type="button" title={$t('settings.indentSize')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
                  </button>
                  <span class="settings-stepper-value">{settings.tabSize}</span>
                  <button class="settings-stepper-btn" onclick={() => { if (settings.tabSize < 8) handleTabSizeChange(settings.tabSize + 1); }} disabled={settings.tabSize >= 8} type="button" title={$t('settings.indentSize')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                  </button>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.folderView')}</span>
                  <span class="settings-hint">{$t('settings.folderViewHint')}</span>
                </div>
                <button
                  class="settings-toggle {settings.showFolderView ? 'is-on' : ''}"
                  onclick={() => handleFolderViewToggle(!settings.showFolderView)}
                  type="button"
                  aria-pressed={settings.showFolderView}
                  title={$t('settings.folderView')}
                >
                  <span class="settings-toggle-thumb"></span>
                </button>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.treeView')}</span>
                  <span class="settings-hint">{$t('settings.treeViewHint')}</span>
                </div>
                <button
                  class="settings-toggle {settings.showTreeView ? 'is-on' : ''}"
                  onclick={() => handleTreeViewToggle(!settings.showTreeView)}
                  type="button"
                  aria-pressed={settings.showTreeView}
                  title={$t('settings.treeView')}
                >
                  <span class="settings-toggle-thumb"></span>
                </button>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.autoSave')}</span>
                  <span class="settings-hint">{$t('settings.autoSaveHint')}</span>
                </div>
                <button
                  class="settings-toggle {settings.autoSave ? 'is-on' : ''}"
                  onclick={() => handleAutoSaveToggle(!settings.autoSave)}
                  type="button"
                  aria-pressed={settings.autoSave}
                  title={$t('settings.autoSave')}
                >
                  <span class="settings-toggle-thumb"></span>
                </button>
              </div>
            </div>
          </div>
        </section>
        {/if}

        {#if activeTab === 'application'}
        <!-- App -->
        <section class="settings-section">
          <h3 class="settings-section-title">{$t('settings.application')}</h3>

          <div class="settings-list">
            <div class="settings-item">
              <div class="settings-item-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.currentVersion')}</span>
                  <span class="settings-hint">{updaterState.currentVersion || $t('settings.versionUnknown')}</span>
                </div>
              </div>
            </div>

            <div class="settings-item">
              <div class="settings-item-row settings-update-row">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t('settings.autoUpdate')}</span>
                  <span class="settings-hint">
                    {$t(updaterState.messageKey)}
                    {#if updaterState.update?.version}
                      <span class="settings-inline-version">{updaterState.update.version}</span>
                    {/if}
                  </span>
                  {#if updaterState.error}
                    <span class="settings-error">{updaterState.error}</span>
                  {/if}
                </div>

                <div class="settings-update-actions">
                  <button
                    class="settings-secondary-btn"
                    onclick={handleCheckForUpdate}
                    disabled={isUpdaterBusy()}
                    type="button"
                  >
                    {updaterState.status === 'checking' ? $t('settings.updateCheckingButton') : $t('settings.checkUpdate')}
                  </button>

                  {#if updaterState.status === 'available'}
                    <button
                      class="settings-primary-btn"
                      onclick={handleInstallUpdate}
                      type="button"
                    >
                      {$t('settings.installUpdate')}
                    </button>
                  {/if}

                  {#if updaterState.status === 'ready-to-restart'}
                    <button
                      class="settings-primary-btn"
                      onclick={handleRestartAfterUpdate}
                      type="button"
                    >
                      {$t('settings.restartApp')}
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        </section>
        {/if}

        {#if activeTab === 'shortcuts' && shortcuts}
        <!-- Shortcuts -->
        <section class="settings-section">
          <div class="flex items-center justify-between mb-3">
            <h3 class="settings-section-title !mb-0">{$t('settings.shortcuts')}</h3>
            <button 
              class="settings-action-link"
              onclick={() => shortcutsStore.reset()}
              type="button"
            >
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
              </svg>
              {$t('settings.resetAllShortcuts')}
            </button>
          </div>

          {#snippet shortcutRow(nameKey: string, descKey: string, shortcut: import('$lib/stores/shortcuts').ShortcutConfig)}
            {@const isModified = shortcut.currentKey !== shortcut.defaultKey}
            <div class="settings-item">
              <div class="settings-item-row group">
                <div class="settings-item-label">
                  <span class="settings-item-name">{$t(nameKey)}</span>
                  <span class="settings-hint">{$t(descKey)}</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="w-7 flex items-center justify-end">
                    {#if isModified}
                      <button
                        class="settings-reset-btn"
                        onclick={() => shortcutsStore.resetShortcut(shortcut.id)}
                        title={$t('settings.resetShortcut')}
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

          <div class="settings-shortcut-group-label">{$t('settings.shortcutsGlobal')}</div>
          <div class="settings-list">
            {@render shortcutRow('settings.showApp', 'settings.showAppDesc', shortcuts.showApp)}
            {@render shortcutRow('settings.formatClipboard', 'settings.formatClipboardDesc', shortcuts.formatClipboard)}
          </div>

          <div class="settings-shortcut-group-label">{$t('settings.shortcutsApp')}</div>
          <div class="settings-list">
            {@render shortcutRow('settings.newFile', 'settings.newFileDesc', shortcuts.newFile)}
            {@render shortcutRow('settings.openFile', 'settings.openFileDesc', shortcuts.openFile)}
            {@render shortcutRow('settings.saveFile', 'settings.saveFileDesc', shortcuts.saveFile)}
            {@render shortcutRow('settings.format', 'settings.formatDesc', shortcuts.format)}
            {@render shortcutRow('settings.minify', 'settings.minifyDesc', shortcuts.minify)}
            {@render shortcutRow('settings.escape', 'settings.escapeDesc', shortcuts.escape)}
            {@render shortcutRow('settings.unescape', 'settings.unescapeDesc', shortcuts.unescape)}
            {@render shortcutRow('settings.minifyEscape', 'settings.minifyEscapeDesc', shortcuts.minifyEscape)}
            {@render shortcutRow('settings.foldAll', 'settings.foldAllDesc', shortcuts.foldAll)}
            {@render shortcutRow('settings.unfoldAll', 'settings.unfoldAllDesc', shortcuts.unfoldAll)}
            {@render shortcutRow('settings.closeOtherTabs', 'settings.closeOtherTabsDesc', shortcuts.closeOtherTabs)}
            {@render shortcutRow('settings.quitApp', 'settings.quitAppDesc', shortcuts.quitApp)}
          </div>
        </section>
        {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Backdrop & Dialog */
  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: fadeIn 0.2s ease-out forwards;
  }

  .settings-dialog {
    background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    width: 100%;
    max-width: 860px;
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  /* Header */
  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    flex-shrink: 0;
  }

  .settings-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .settings-close-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .settings-close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .settings-content {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
  }

  .settings-tabs {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 18px 12px;
    border-right: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    background: color-mix(in srgb, var(--bg-secondary) 36%, transparent);
  }

  .settings-tab {
    min-height: 38px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    font-weight: 700;
    text-align: left;
    transition: all 0.18s ease;
  }

  .settings-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .settings-tab.is-active {
    border-color: color-mix(in srgb, var(--accent) 28%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  /* Body */
  .settings-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px 28px 32px;
  }

  /* Section */
  .settings-section {
    margin-bottom: 28px;
  }

  .settings-section:last-child {
    margin-bottom: 0;
  }

  .settings-section-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    padding-bottom: 12px;
    margin-bottom: 0;
  }

  /* List & Items */
  .settings-list {
    display: flex;
    flex-direction: column;
    background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }

  .settings-item {
    padding: 16px 20px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .settings-item:last-child {
    border-bottom: none;
  }

  .settings-item-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .settings-item-label {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .settings-item-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.01em;
  }

  .settings-hint {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-tertiary);
  }

  /* Theme toggle buttons (Light / Dark) */
  .settings-theme-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .settings-theme-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .settings-theme-btn.is-active {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 10%, transparent);
  }

  /* Theme option list (radio style) */
  .settings-theme-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
  }

  .settings-theme-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    width: 100%;
  }

  .settings-theme-option:hover {
    background: color-mix(in srgb, var(--bg-hover) 50%, transparent);
  }

  .settings-theme-option.is-active {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .settings-theme-option-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  /* Radio dot */
  .settings-radio {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 2px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.2s ease;
  }

  .settings-radio.is-checked {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .settings-radio-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 4px var(--accent-glow);
  }

  /* Number stepper */
  .settings-number-input {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .settings-stepper-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
  }

  .settings-stepper-btn svg {
    width: 14px;
    height: 14px;
  }

  .settings-stepper-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .settings-stepper-btn:active:not(:disabled) {
    transform: scale(0.92);
  }

  .settings-stepper-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .settings-stepper-value {
    min-width: 32px;
    text-align: center;
    font-size: 14px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 600;
    color: var(--text-primary);
  }

  /* Toggle switch */
  .settings-toggle {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--border) 80%, var(--bg-tertiary));
    cursor: pointer;
    transition: all 0.3s ease;
    flex-shrink: 0;
    padding: 0;
  }

  .settings-toggle.is-on {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .settings-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-tertiary);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .settings-toggle.is-on .settings-toggle-thumb {
    transform: translateX(18px);
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent-glow);
  }

  .settings-action-link {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.2s ease;
  }

  .settings-action-link:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
  }

  .settings-update-row {
    align-items: flex-start;
  }

  .settings-update-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    flex-shrink: 0;
    max-width: 280px;
  }

  .settings-primary-btn,
  .settings-secondary-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.2;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .settings-primary-btn {
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }

  .settings-primary-btn:hover {
    background: color-mix(in srgb, var(--accent) 24%, transparent);
  }

  .settings-secondary-btn {
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
  }

  .settings-secondary-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .settings-secondary-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .settings-inline-version {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    color: var(--accent);
    margin-left: 4px;
  }

  .settings-error {
    font-size: 12px;
    line-height: 1.5;
    color: #ef4444;
  }

  /* Shortcut group label */
  .settings-shortcut-group-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    padding: 16px 0 8px;
  }

  .settings-shortcut-group-label:first-of-type {
    padding-top: 0;
  }

  /* Reset button (shortcuts) */
  .settings-reset-btn {
    opacity: 0;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .group:hover .settings-reset-btn {
    opacity: 1;
  }

  .settings-reset-btn:hover {
    background: var(--bg-hover);
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
      transform: translateY(16px) scale(0.96);
    }
    to { 
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 760px) {
    .settings-dialog {
      max-height: 82vh;
    }

    .settings-content {
      grid-template-columns: 1fr;
    }

    .settings-tabs {
      flex-direction: row;
      gap: 6px;
      overflow-x: auto;
      padding: 12px 16px;
      border-right: none;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    }

    .settings-tab {
      flex: 0 0 auto;
      min-height: 34px;
      padding: 0 12px;
      white-space: nowrap;
    }

    .settings-body {
      padding: 18px 16px 24px;
    }
  }
</style>

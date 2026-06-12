<script lang="ts">
  import { onMount } from 'svelte';
  import { AlertCircle, CheckCircle2, Download, RefreshCw, RotateCcw, X } from '@lucide/svelte';
  import {
    createInitialUpdaterState,
  } from '$lib/services/appUpdater';
  import {
    appUpdateStore,
    checkAppUpdates,
    initAppUpdater,
    installAvailableAppUpdate,
    restartInstalledAppUpdate,
  } from '$lib/stores/appUpdateStore';
  import { t } from '$lib/i18n';

  const AUTO_CHECK_DELAY_MS = 5000;

  let updaterState = $state(createInitialUpdaterState(''));
  let isDismissed = $state(false);
  let shouldShowError = $state(false);

  let isBusy = $derived(updaterState.status === 'checking' || updaterState.status === 'installing');
  let hasAction = $derived(updaterState.status === 'available' || updaterState.status === 'ready-to-restart');
  let shouldShow = $derived(
    !isDismissed &&
      (updaterState.status === 'available' ||
        updaterState.status === 'installing' ||
        updaterState.status === 'ready-to-restart' ||
        (shouldShowError && updaterState.status === 'error'))
  );

  $effect(() => {
    const unsubscribe = appUpdateStore.subscribe(state => {
      updaterState = state;
      if (state.status === 'available' || state.status === 'ready-to-restart') {
        isDismissed = false;
      }
    });
    return () => unsubscribe();
  });

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      void checkForUpdates(false);
    }, AUTO_CHECK_DELAY_MS);

    void initAppUpdater();

    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  async function checkForUpdates(showErrors: boolean) {
    const nextState = await checkAppUpdates({ showErrors });
    shouldShowError = showErrors && nextState.status === 'error';
    isDismissed = nextState.status === 'idle';
  }

  async function handleInstallUpdate() {
    shouldShowError = true;
    await installAvailableAppUpdate();
  }

  async function handleRestartAfterUpdate() {
    shouldShowError = true;
    await restartInstalledAppUpdate();
  }

  function dismiss() {
    if (isBusy) return;
    isDismissed = true;
  }
</script>

{#if shouldShow}
  <section class="update-notification" aria-live="polite" aria-label={$t('updates.notificationLabel')}>
    <div
      class="update-icon"
      class:is-error={updaterState.status === 'error'}
      class:is-ready={updaterState.status === 'ready-to-restart'}
      class:is-spinning={updaterState.status === 'installing'}
    >
      {#if updaterState.status === 'installing'}
        <RefreshCw size={16} strokeWidth={2.4} />
      {:else if updaterState.status === 'ready-to-restart'}
        <CheckCircle2 size={16} strokeWidth={2.4} />
      {:else if updaterState.status === 'error'}
        <AlertCircle size={16} strokeWidth={2.4} />
      {:else}
        <Download size={16} strokeWidth={2.4} />
      {/if}
    </div>

    <div class="update-copy">
      <div class="update-title">
        {#if updaterState.status === 'available'}
          {$t('updates.availableTitle')}
        {:else if updaterState.status === 'installing'}
          {$t('updates.installingTitle')}
        {:else if updaterState.status === 'ready-to-restart'}
          {$t('updates.readyTitle')}
        {:else}
          {$t('updates.failedTitle')}
        {/if}
      </div>
      <div class="update-message">
        {#if updaterState.status === 'available'}
          {$t('updates.availablePrompt')}
        {:else}
          {$t(updaterState.messageKey)}
        {/if}
        {#if updaterState.update?.version}
          <span class="update-version">v{updaterState.update.version}</span>
        {/if}
      </div>
      {#if updaterState.status === 'ready-to-restart'}
        <div class="update-reassurance">{$t('updates.restartReassurance')}</div>
      {/if}
      {#if updaterState.error}
        <div class="update-error">{updaterState.error}</div>
      {/if}
    </div>

    <div class="update-actions">
      {#if updaterState.status === 'available'}
        <button class="update-primary-btn" type="button" onclick={handleInstallUpdate}>
          <Download size={14} strokeWidth={2.4} />
          <span>{$t('settings.installUpdate')}</span>
        </button>
      {:else if updaterState.status === 'ready-to-restart'}
        <button class="update-primary-btn" type="button" onclick={handleRestartAfterUpdate}>
          <RotateCcw size={14} strokeWidth={2.4} />
          <span>{$t('settings.restartApp')}</span>
        </button>
      {:else if updaterState.status === 'error'}
        <button class="update-secondary-btn" type="button" onclick={() => checkForUpdates(true)}>
          <RefreshCw size={14} strokeWidth={2.4} />
          <span>{$t('updates.retry')}</span>
        </button>
      {/if}
    </div>

    {#if !isBusy && hasAction}
      <button class="update-close-btn" type="button" aria-label={$t('updates.dismiss')} onclick={dismiss}>
        <X size={14} strokeWidth={2.6} />
      </button>
    {/if}
  </section>
{/if}

<style>
  .update-notification {
    position: fixed;
    right: 18px;
    bottom: 34px;
    z-index: 70;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: min(420px, calc(100vw - 28px));
    padding: 12px;
    padding-right: 36px;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--bg-primary) 92%, transparent);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.26);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    animation: update-notification-in 180ms ease-out;
  }

  .update-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 26%, transparent);
    border-radius: 8px;
  }

  .update-icon.is-ready {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
    border-color: color-mix(in srgb, var(--success) 26%, transparent);
  }

  .update-icon.is-error {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);
    border-color: color-mix(in srgb, var(--error) 24%, transparent);
  }

  .update-copy {
    min-width: 0;
  }

  .update-title {
    font-size: 13px;
    font-weight: 700;
    line-height: 18px;
    color: var(--text-primary);
  }

  .update-message,
  .update-reassurance,
  .update-error {
    margin-top: 2px;
    font-size: 12px;
    line-height: 17px;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  .update-error {
    color: var(--error);
  }

  .update-reassurance {
    color: var(--success);
  }

  .update-version {
    margin-left: 6px;
    color: var(--accent);
    font-weight: 700;
  }

  .update-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .update-primary-btn,
  .update-secondary-btn,
  .update-close-btn {
    border: 0;
    font: inherit;
    cursor: pointer;
  }

  .update-primary-btn,
  .update-secondary-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
  }

  .update-primary-btn {
    color: #07120f;
    background: var(--accent);
  }

  .update-primary-btn:hover {
    background: color-mix(in srgb, var(--accent) 86%, white);
  }

  .update-secondary-btn {
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--border);
  }

  .update-secondary-btn:hover {
    background: var(--bg-hover);
  }

  .update-close-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    color: var(--text-tertiary);
    background: transparent;
    border-radius: 6px;
    transition: background 0.16s ease, color 0.16s ease;
  }

  .update-close-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .update-icon.is-spinning :global(svg) {
    animation: update-spin 900ms linear infinite;
  }

  @keyframes update-notification-in {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes update-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 520px) {
    .update-notification {
      right: 14px;
      bottom: 32px;
      grid-template-columns: 32px minmax(0, 1fr);
      padding-right: 34px;
    }

    .update-actions {
      grid-column: 2;
      justify-content: flex-start;
      margin-top: 2px;
    }
  }
</style>

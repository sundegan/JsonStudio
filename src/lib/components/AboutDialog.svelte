<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { listen } from '@tauri-apps/api/event';
  import { t } from '$lib/i18n';
  import { formatAppVersion } from '$lib/services/appMetadata.js';
  import AppResourceLinks from './AppResourceLinks.svelte';

  let isOpen = $state(false);
  let version = $state('');

  onMount(() => {
    let unlistenShowAbout: (() => void) | null = null;

    getVersion()
      .then(appVersion => {
        version = appVersion;
      })
      .catch(() => {
        version = '';
      });

    listen('show-about', () => {
      isOpen = true;
    })
      .then(unlisten => {
        unlistenShowAbout = unlisten;
      })
      .catch(error => {
        console.error('Failed to listen for about menu event:', error);
      });

    return () => {
      unlistenShowAbout?.();
    };
  });

  function close() {
    isOpen = false;
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      close();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
  <div
    class="about-backdrop"
    onclick={handleBackdropClick}
    role="presentation"
  >
    <section class="about-dialog" aria-labelledby="about-title">
      <button class="about-close" type="button" aria-label={$t('about.close')} onclick={close}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <div class="about-hero">
        <img class="about-icon" src="/app-icon.png" alt="" />
        <div class="about-copy">
          <h2 id="about-title">Json Studio</h2>
          <p class="about-tagline">{$t('about.tagline')}</p>
        </div>
      </div>

      <div class="about-meta">
        <div class="about-row">
          <span>{$t('about.version')}</span>
          <strong>{formatAppVersion(version, $t('settings.versionUnknown'))}</strong>
        </div>
      </div>

      <div class="about-resources">
        <AppResourceLinks />
      </div>

      <p class="about-footer">Copyright © 2025 Json Studio</p>
    </section>
  </div>
{/if}

<style>
  .about-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(8, 11, 16, 0.42);
    backdrop-filter: blur(10px);
  }

  .about-dialog {
    position: relative;
    width: min(440px, 100%);
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    border-radius: 14px;
    background: var(--bg-primary);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
    color: var(--text-primary);
    padding: 28px;
  }

  .about-close {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
    transition: all 0.16s ease;
  }

  .about-close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border);
  }

  .about-close svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
  }

  .about-hero {
    display: flex;
    align-items: center;
    gap: 18px;
    padding-right: 32px;
  }

  .about-icon {
    width: 76px;
    height: 76px;
    border-radius: 18px;
    box-shadow: 0 14px 30px rgba(0, 0, 0, 0.22);
  }

  .about-copy h2 {
    margin: 0;
    font-size: 26px;
    line-height: 1.15;
    font-weight: 800;
    letter-spacing: 0;
  }

  .about-tagline {
    margin: 8px 0 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }

  .about-meta {
    display: grid;
    gap: 10px;
    margin-top: 26px;
  }

  .about-row {
    min-height: 46px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-secondary);
  }

  .about-row span {
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
  }

  .about-row strong {
    min-width: 0;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 700;
    line-height: 1.35;
  }

  .about-resources {
    margin-top: 12px;
  }

  .about-footer {
    margin: 22px 0 0;
    color: var(--text-tertiary);
    font-size: 12px;
    text-align: center;
  }

  @media (max-width: 520px) {
    .about-dialog {
      padding: 24px;
    }

    .about-hero {
      align-items: flex-start;
      flex-direction: column;
      padding-right: 30px;
    }
  }
</style>

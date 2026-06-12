<script lang="ts">
  import { ExternalLink, Github, Globe2 } from '@lucide/svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { t } from '$lib/i18n';
  import {
    APP_CHANGELOG_URL,
    APP_GITHUB_URL,
    APP_WEBSITE_URL,
  } from '$lib/services/appMetadata.js';

  const resources = [
    {
      labelKey: 'appLinks.website',
      url: APP_WEBSITE_URL,
      icon: Globe2,
    },
    {
      labelKey: 'appLinks.github',
      url: APP_GITHUB_URL,
      icon: Github,
    },
    {
      labelKey: 'appLinks.changelog',
      url: APP_CHANGELOG_URL,
      icon: ExternalLink,
    },
  ];
</script>

<div class="app-resource-links">
  {#each resources as resource}
    <button
      class="app-resource-link"
      type="button"
      title={$t(resource.labelKey)}
      onclick={() => openUrl(resource.url)}
    >
      <resource.icon aria-hidden="true" />
      <span>{$t(resource.labelKey)}</span>
    </button>
  {/each}
</div>

<style>
  .app-resource-links {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
  }

  .app-resource-link {
    min-width: 0;
    min-height: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
    transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
  }

  .app-resource-link:hover {
    border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-secondary));
    color: var(--accent);
  }

  .app-resource-link :global(svg) {
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
    stroke-width: 2;
  }

  @media (max-width: 520px) {
    .app-resource-links {
      grid-template-columns: 1fr;
    }
  }
</style>

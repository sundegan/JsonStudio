<script lang="ts">
  import { t } from '$lib/i18n';
  import { onMount } from 'svelte';

  let {
    isOpen = $bindable(false),
    title = '',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDanger = false,
    onConfirm,
    onCancel
  } = $props<{
    isOpen: boolean;
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }>();

  let dialogRef = $state<HTMLDivElement | null>(null);

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      closeDialog(false);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      closeDialog(false);
    } else if (e.key === 'Enter') {
      closeDialog(true);
    }
  }

  function closeDialog(confirmed: boolean) {
    isOpen = false;
    if (confirmed) {
      onConfirm();
    } else {
      onCancel();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

{#if isOpen}
  <div class="dialog-backdrop" onclick={handleBackdropClick} role="presentation">
    <div class="dialog-card" bind:this={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div class="dialog-icon" class:is-danger={isDanger}>
        {#if isDanger}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4"/>
            <path d="M12 16h.01"/>
          </svg>
        {/if}
      </div>
      
      <div class="dialog-content">
        {#if title}
          <h3 id="dialog-title" class="dialog-title">{title}</h3>
        {/if}
        <p class="dialog-message">{message}</p>
      </div>

      <div class="dialog-actions">
        <button class="dialog-btn dialog-cancel" onclick={() => closeDialog(false)}>
          {cancelText}
        </button>
        <button class="dialog-btn dialog-confirm" class:is-danger={isDanger} onclick={() => closeDialog(true)}>
          {confirmText}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: fadeIn 0.2s ease-out;
  }

  .dialog-card {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    width: 100%;
    max-width: 400px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .dialog-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    margin-bottom: 16px;
  }

  .dialog-icon svg {
    width: 24px;
    height: 24px;
  }

  .dialog-icon.is-danger {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    color: var(--error);
  }

  .dialog-content {
    margin-bottom: 24px;
  }

  .dialog-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    margin-bottom: 8px;
    letter-spacing: -0.01em;
  }

  .dialog-message {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .dialog-actions {
    display: flex;
    gap: 12px;
    width: 100%;
  }

  .dialog-btn {
    flex: 1;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .dialog-cancel {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-primary);
  }

  .dialog-cancel:hover {
    background: var(--bg-hover);
    border-color: var(--text-secondary);
  }

  .dialog-confirm {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
    color: var(--accent);
  }

  .dialog-confirm:hover {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .dialog-confirm.is-danger {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--error) 40%, transparent);
    color: var(--error);
  }

  .dialog-confirm.is-danger:hover {
    background: color-mix(in srgb, var(--error) 25%, transparent);
    border-color: color-mix(in srgb, var(--error) 60%, transparent);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--error) 15%, transparent);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(16px) scale(0.95);
    }
    to { 
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>

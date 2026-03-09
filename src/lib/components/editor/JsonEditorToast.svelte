<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';

  type ToastType = 'success' | 'error' | 'info';

  const { message, type = 'success', duration = 3000 } = $props<{
    message: string;
    type?: ToastType;
    duration?: number;
  }>();

  const dispatch = createEventDispatcher<{ close: void }>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (!message) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => dispatch('close'), duration);
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });
</script>

<div
  class="absolute top-6 right-6 flex items-center gap-3.5 z-50 animate-toast-in overflow-hidden"
  style="
    padding: 12px 20px;
    background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  "
>
  {#if type === 'error'}
    <div class="flex items-center justify-center w-6 h-6 rounded-lg" style="background-color: color-mix(in srgb, var(--error) 15%, transparent); color: var(--error);">
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </div>
  {:else if type === 'info'}
    <div class="flex items-center justify-center w-6 h-6 rounded-lg" style="background-color: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent);">
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
    </div>
  {:else}
    <div class="flex items-center justify-center w-6 h-6 rounded-lg" style="background-color: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success);">
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
  {/if}
  
  <div class="flex flex-col">
    <span class="text-(--text-primary) text-[13px] font-semibold leading-tight">{message}</span>
  </div>

  <button 
    class="ml-2 p-1 rounded-md hover:bg-(--bg-hover) text-(--text-tertiary) hover:text-(--text-primary) transition-colors"
    onclick={() => dispatch('close')}
  >
    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  </button>
</div>

<style>
  @keyframes toast-in {
    from { 
      opacity: 0; 
      transform: translateX(32px) scale(0.9); 
    }
    to { 
      opacity: 1; 
      transform: translateX(0) scale(1); 
    }
  }

  .animate-toast-in {
    animation: toast-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
</style>

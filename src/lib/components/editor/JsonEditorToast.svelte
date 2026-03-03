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
  class="absolute top-6 right-6 flex items-center gap-2.5 rounded-lg text-sm font-medium z-50 animate-[fadeIn_0.2s_ease-out]"
  style="padding: 10px 16px; background-color: var(--bg-primary); border: 1px solid var(--border); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);"
>
  {#if type === 'error'}
    <div class="flex items-center justify-center w-5 h-5 rounded-full" style="background-color: var(--error, #ef4444);">
      <svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </div>
  {:else if type === 'info'}
    <div class="flex items-center justify-center w-5 h-5 rounded-full" style="background-color: var(--accent);">
      <svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <path d="M12 8v4M12 16h.01"/>
      </svg>
    </div>
  {:else}
    <div class="flex items-center justify-center w-5 h-5 rounded-full" style="background-color: var(--success);">
      <svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
    </div>
  {/if}
  <span class="text-(--text-primary)">{message}</span>
</div>

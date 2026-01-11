<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';

  const { message, duration = 3000 } = $props<{
    message: string;
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
  <div class="flex items-center justify-center w-5 h-5 rounded-full" style="background-color: var(--success);">
    <svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
      <path d="M20 6L9 17l-5-5"/>
    </svg>
  </div>
  <span class="text-(--text-primary)">{message}</span>
</div>

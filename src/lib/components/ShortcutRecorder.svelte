<script lang="ts">
  import { formatShortcutKey } from '$lib/stores/shortcuts';

  interface Props {
    value: string;
    onchange: (key: string) => void;
  }

  let { value, onchange }: Props = $props();
  
  let isRecording = $state(false);
  let recordedKeys = $state<string[]>([]);

  function startRecording() {
    isRecording = true;
    recordedKeys = [];
  }

  function stopRecording() {
    isRecording = false;
    if (recordedKeys.length > 0) {
      const shortcut = recordedKeys.join('+');
      onchange(shortcut);
    }
    recordedKeys = [];
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!isRecording) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const keys: string[] = [];
    
    // Modifier keys
    if (e.metaKey || e.ctrlKey) {
      keys.push('CommandOrControl');
    }
    if (e.shiftKey) {
      keys.push('Shift');
    }
    if (e.altKey) {
      keys.push('Alt');
    }
    
    // Main key
    if (e.key && !['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) {
      const mainKey = e.key.toUpperCase();
      keys.push(mainKey);
    }
    
    if (keys.length > 1) { // At least one modifier + one main key
      recordedKeys = keys;
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (!isRecording) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Complete recording when all keys are released
    if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      stopRecording();
    }
  }

  function handleBlur() {
    if (isRecording) {
      stopRecording();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<div class="relative">
  <input
    type="text"
    readonly
    value={isRecording ? (recordedKeys.length > 0 ? formatShortcutKey(recordedKeys.join('+')) : '') : formatShortcutKey(value)}
    placeholder={isRecording ? 'Press shortcut...' : ''}
    class="w-32 px-2 py-1 text-xs font-mono text-center rounded border transition-all cursor-pointer"
    class:recording={isRecording}
    style="background-color: {isRecording ? 'var(--bg-primary)' : 'var(--bg-secondary)'}; 
           border-color: {isRecording ? 'var(--accent)' : 'var(--border)'}; 
           color: var(--text-primary);
           outline: none;"
    onclick={startRecording}
    onblur={handleBlur}
  />
  {#if isRecording}
    <div class="absolute right-2 top-1/2 -translate-y-1/2">
      <div class="w-1.5 h-1.5 rounded-full animate-pulse" style="background-color: var(--accent);"></div>
    </div>
  {/if}
</div>

<style>
  .recording {
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  input::placeholder {
    color: var(--text-secondary);
    opacity: 0.6;
  }
</style>

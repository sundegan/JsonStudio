<script lang="ts">
  // JSON 编辑器组件
  import { editorStore } from '$lib/stores/editor';
  import { formatJson, minifyJson, getJsonStats, type JsonStats } from '$lib/services/json';
  import { onMount } from 'svelte';

  let content = $state('');
  let stats: JsonStats | null = $state(null);
  let toastMsg = $state('');
  let isProcessing = $state(false);
  let isDark = $state(false);
  let validateTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    const saved = localStorage.getItem('theme');
    isDark = saved === 'dark';
  });

  function toggleTheme() {
    isDark = !isDark;
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  function showToast(msg: string) {
    toastMsg = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg = ''; }, 1500);
  }

  function handleInput() {
    if (validateTimer) clearTimeout(validateTimer);
    if (!content.trim()) { stats = null; return; }
    validateTimer = setTimeout(validateContent, 300);
  }

  async function validateContent() {
    if (!content.trim()) return;
    try {
      stats = await getJsonStats(content);
      editorStore.setValidation(stats.valid, stats.error_info?.error_message || '');
    } catch (e) { /* ignore */ }
  }

  async function handlePaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text');
    if (!text?.trim()) return;
    event.preventDefault();
    content = text;
    isProcessing = true;
    try {
      content = await formatJson(text);
      showToast('✓');
      stats = await getJsonStats(content);
      editorStore.setContent(content);
      editorStore.setValidation(true);
    } catch (e) {
      stats = await getJsonStats(text);
      editorStore.setValidation(false, stats.error_info?.error_message || '');
    } finally { isProcessing = false; }
  }

  async function handleFormat() {
    if (!content.trim()) return;
    isProcessing = true;
    try {
      content = await formatJson(content);
      showToast('✓');
      await validateContent();
    } catch (e) { await validateContent(); }
    finally { isProcessing = false; }
  }

  async function handleMinify() {
    if (!content.trim()) return;
    isProcessing = true;
    try {
      content = await minifyJson(content);
      showToast('✓');
      await validateContent();
    } catch (e) { await validateContent(); }
    finally { isProcessing = false; }
  }

  function handleEscape() {
    if (!content.trim()) return;
    content = JSON.stringify(content);
    showToast('✓');
    validateContent();
  }

  function handleUnescape() {
    if (!content.trim()) return;
    try {
      const u = JSON.parse(content);
      if (typeof u === 'string') { content = u; showToast('✓'); validateContent(); }
    } catch (e) { /* ignore */ }
  }

  async function handleMinifyEscape() {
    if (!content.trim()) return;
    isProcessing = true;
    try {
      const m = await minifyJson(content);
      content = JSON.stringify(m);
      showToast('✓');
      validateContent();
    } catch (e) { await validateContent(); }
    finally { isProcessing = false; }
  }

  function handleClear() { content = ''; stats = null; editorStore.reset(); }

  async function handleCopy() {
    if (!content) return;
    try { await navigator.clipboard.writeText(content); showToast('✓'); }
    catch (e) { /* ignore */ }
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b}B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
    return `${(b / 1048576).toFixed(1)}MB`;
  }

  // 按钮样式类
  const btnBase = 'w-8 h-8 flex items-center justify-center rounded-md cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed';
  const btnPrimary = `${btnBase} bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]`;
  const btnDefault = `${btnBase} bg-transparent text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]`;
  const btnGhost = `${btnBase} bg-transparent text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text-secondary)]`;
</script>

<div class="flex flex-col h-full overflow-hidden bg-[var(--bg-primary)] {isDark ? 'dark' : ''}">
  <!-- 工具栏 -->
  <div class="flex items-center gap-1 px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
    <!-- 格式化/压缩 -->
    <div class="flex gap-0.5">
      <button
        class={btnPrimary}
        onclick={handleFormat}
        disabled={isProcessing || !content.trim()}
        title="格式化"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h10M4 18h14"/>
        </svg>
      </button>
      <button
        class={btnDefault}
        onclick={handleMinify}
        disabled={isProcessing || !content.trim()}
        title="压缩"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>
        </svg>
      </button>
    </div>

    <div class="w-px h-5 bg-[var(--border)] mx-2"></div>

    <!-- 转义操作 -->
    <div class="flex gap-0.5">
      <button
        class={btnDefault}
        onclick={handleEscape}
        disabled={isProcessing || !content.trim()}
        title="转义"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M7 8l-4 4 4 4M17 8l4 4-4 4"/>
        </svg>
      </button>
      <button
        class={btnDefault}
        onclick={handleUnescape}
        disabled={isProcessing || !content.trim()}
        title="反转义"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 8l4 4-4 4M15 8l-4 4 4 4"/>
        </svg>
      </button>
      <button
        class={btnDefault}
        onclick={handleMinifyEscape}
        disabled={isProcessing || !content.trim()}
        title="压缩+转义"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M8 12h8"/>
        </svg>
      </button>
    </div>

    <div class="flex-1"></div>

    <!-- 复制/清空/主题 -->
    <div class="flex gap-0.5">
      <button
        class={btnGhost}
        onclick={handleCopy}
        disabled={!content}
        title="复制"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      </button>
      <button
        class={btnGhost}
        onclick={handleClear}
        disabled={!content}
        title="清空"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>

      <div class="w-px h-5 bg-[var(--border)] mx-2"></div>

      <button
        class={btnGhost}
        onclick={toggleTheme}
        title={isDark ? '切换亮色' : '切换暗色'}
      >
        {#if isDark}
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
        {:else}
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
        {/if}
      </button>
    </div>
  </div>

  <!-- 编辑器 -->
  <div class="flex-1 relative min-h-0">
    <textarea
      class="w-full h-full p-4 border-none bg-transparent text-[var(--text-primary)] font-mono text-[13px] leading-relaxed resize-none outline-none placeholder:text-[var(--text-muted)]"
      class:error-border={stats && !stats.valid}
      bind:value={content}
      oninput={handleInput}
      onpaste={handlePaste}
      placeholder="Paste JSON here..."
      spellcheck="false"
    ></textarea>

    {#if toastMsg}
      <div class="absolute top-4 right-4 px-3 py-1.5 bg-[var(--accent)] text-white rounded-md text-[13px] font-medium animate-fade-in">
        {toastMsg}
      </div>
    {/if}
  </div>

  <!-- 状态栏 -->
  <div class="flex items-center gap-3 px-3 py-1.5 bg-[var(--bg-secondary)] border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
    {#if stats}
      {#if stats.valid}
        <span class="text-[8px] text-[var(--success)]">●</span>
        <span class="text-[var(--text-muted)]">{stats.key_count} keys</span>
        <span class="text-[var(--text-muted)]">{formatBytes(stats.byte_size)}</span>
      {:else if stats.error_info}
        <span class="text-[8px] text-[var(--error)]">●</span>
        <span class="text-[var(--warning)]">Ln {stats.error_info.error_line}, Col {stats.error_info.error_column}</span>
      {/if}
    {/if}
    <span class="flex-1"></span>
    {#if content}
      <span class="text-[var(--text-muted)]">{content.split('\n').length} lines</span>
    {/if}
  </div>
</div>

<style>
  /* 错误边框 */
  .error-border {
    box-shadow: inset 3px 0 0 var(--error);
  }

  /* Toast 动画 */
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in {
    animation: fade-in 0.15s ease;
  }
</style>

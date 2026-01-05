<script lang="ts">
  // JSON 编辑器组件 - 基于 Monaco Editor
  import { onMount } from 'svelte';
  import { getJsonStats, escapeString, unescapeString, type JsonStats } from '$lib/services/json';
  import MonacoEditor from './MonacoEditor.svelte';
  import { type EditorTheme } from '$lib/config/monacoThemes';
  import { settingsStore } from '$lib/stores/settings';
  import SettingsPanel from '$lib/components/SettingsPanel.svelte';

  // 当json数据大小超过此阈值时，使用 Rust 后端处理以避免 UI 阻塞
  const LARGE_FILE_THRESHOLD = 1024 * 1024; // 1MB

  let content = $state('');
  let stats = $state<JsonStats | null>(null);
  let toastMsg = $state('');
  let isProcessing = $state(false);
  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let monacoEditor: MonacoEditor;
  let settingsPanel: SettingsPanel | null = null;
  
  // 从 settingsStore 获取设置
  // 使用 $state 存储设置值，通过 subscribe 同步更新
  let settings = $state<import('$lib/stores/settings').AppSettings>({
    isDarkMode: false,
    darkTheme: 'one-dark',
    lightTheme: 'vs',
    fontSize: 13,
    tabSize: 2,
  });
  
  // 初始化 settingsStore（如果还未初始化）
  onMount(() => {
    settingsStore.init();
  });
  
  // 订阅 settingsStore 变化以更新本地状态
  $effect(() => {
    const unsubscribe = settingsStore.subscribe(newSettings => {
      settings = newSettings;
    });
    return () => unsubscribe();
  });
  
  let isDarkMode = $derived(settings.isDarkMode);
  let fontSize = $derived(settings.fontSize);
  let tabSize = $derived(settings.tabSize);
  
  // Monaco 主题 - 根据 isDarkMode 和对应的主题设置选择
  let monacoTheme = $derived<EditorTheme>(
    isDarkMode ? settings.darkTheme : settings.lightTheme
  );

  function toggleTheme() {
    settingsStore.updateSetting('isDarkMode', !isDarkMode);
  }

  function openSettings() {
    if (settingsPanel) {
      settingsPanel.open();
    }
  }

  function showToast(msg: string) {
    toastMsg = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg = ''; }, 1500);
  }

  function handleEditorChange(newValue: string) {
    content = newValue;
    if (statsTimer) clearTimeout(statsTimer);
    if (!content.trim()) { 
      stats = null;
      return;
    }
    // 防抖：300ms 后更新统计信息
    statsTimer = setTimeout(updateStats, 300);
  }

  // 更新 JSON 统计信息
  async function updateStats() {
    if (!content.trim()) return;
    try {
      stats = await getJsonStats(content);
    } catch (e) {
      // 忽略错误
    }
  }

  // 格式化 - 根据文件大小选择最优方案
  async function handleFormat() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      // 对于大文件，使用 Rust 后端格式化JSON以避免 UI 阻塞
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { formatJson } = await import('$lib/services/json');
        const formatted = await formatJson(content);
        content = formatted;
        monacoEditor?.setValue(formatted);
      } else {
        // 小文件使用 Monaco 原生格式化，响应更快
        await monacoEditor?.format();
        content = monacoEditor?.getValue() || '';
      }
      
      await updateStats();
    } catch (e) {
      // 忽略格式化错误
    } finally {
      isProcessing = false;
    }
  }

  // 压缩 - 根据文件大小选择最优方案
  async function handleMinify() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      let minified = '';
      
      // 对于大文件，使用 Rust 后端压缩JSON以避免 UI 阻塞
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { minifyJson } = await import('$lib/services/json');
        minified = await minifyJson(content);
      } else {
        // 小文件使用 Monaco 原生压缩，响应更快
        minified = monacoEditor?.minify() || '';
      }
      
      if (minified) {
        content = minified;
        monacoEditor?.setValue(minified);        
        await updateStats();
      }
    } catch (e) {
      // 忽略压缩错误
    } finally {
      isProcessing = false;
    }
  }

  // 转义 - 根据文件大小选择最优方案
  async function handleEscape() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      let escaped = '';
      
      // 对于大文件，使用 Rust 后端处理以避免 UI 阻塞
      if (contentSize > LARGE_FILE_THRESHOLD) {
        escaped = await escapeString(content);
      } else {
        // 小文件使用前端处理，响应更快
        escaped = JSON.stringify(content);
      }
      
      content = escaped;
      monacoEditor?.setValue(escaped);
      await updateStats();
    } catch (e) {
      // 忽略转义错误
    } finally {
      isProcessing = false;
    }
  }

  // 反转义 - 根据文件大小选择最优方案
  async function handleUnescape() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      let unescaped = '';
      
      // 对于大文件，使用 Rust 后端处理以避免 UI 阻塞
      if (contentSize > LARGE_FILE_THRESHOLD) {
        unescaped = await unescapeString(content);
      } else {
        // 小文件使用前端处理，响应更快
        const u = JSON.parse(content);
        if (typeof u === 'string') {
          unescaped = u;
        } else {
          throw new Error('内容不是字符串');
        }
      }
      
      if (unescaped) {
        content = unescaped;
        monacoEditor?.setValue(unescaped);
        await updateStats();
      }
    } catch (e) {
      // 忽略反转义错误
    } finally {
      isProcessing = false;
    }
  }

  // 压缩 + 转义 - 根据文件大小选择最优方案
  async function handleMinifyEscape() {
    if (!content.trim()) return;
    isProcessing = true;
    const contentSize = content.length;
    
    try {
      let minified = '';
      
      // 对于大文件，使用 Rust 后端
      if (contentSize > LARGE_FILE_THRESHOLD) {
        const { minifyJson } = await import('$lib/services/json');
        minified = await minifyJson(content);
      } else {
        // 小文件使用 Monaco 原生压缩
        minified = monacoEditor?.minify() || '';
      }
      
      if (minified) {
        const escaped = JSON.stringify(minified);
        content = escaped;
        monacoEditor?.setValue(escaped);
        await updateStats();
      }
    } catch (e) {
      // 忽略错误
    } finally {
      isProcessing = false;
    }
  }

  function handleClear() {
    content = '';
    monacoEditor?.setValue('');
    stats = null;
  }

  async function handleCopy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      showToast('已复制');
    } catch (e) {
      // 忽略复制错误
    }
  }

  function handleFoldAll() {
    monacoEditor?.foldAll();
  }

  function handleUnfoldAll() {
    monacoEditor?.unfoldAll();
  }

  // 格式化字节大小
  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <!-- 工具栏 -->
  <div class="flex items-center gap-0.5 px-2 py-1.5 bg-(--bg-secondary) border-b border-(--border) shrink-0">
    <!-- 格式化操作组 -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--accent)
               hover:bg-(--accent)/10
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleFormat}
        disabled={isProcessing || !content.trim()}
        title="格式化"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h10M4 18h14"/>
        </svg>
      </button>
      
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleMinify}
        disabled={isProcessing || !content.trim()}
        title="压缩"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>
        </svg>
      </button>
    </div>

    <div class="w-px h-4 bg-(--border) mx-1.5"></div>

    <!-- 折叠操作组 -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleFoldAll}
        disabled={isProcessing || !content.trim()}
        title="全部折叠"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h16M4 18h16"/>
          <path d="M9 6v6l3-3-3-3"/>
        </svg>
      </button>
      
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleUnfoldAll}
        disabled={isProcessing || !content.trim()}
        title="全部展开"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 6h16M4 12h16M4 18h16"/>
          <path d="M9 6v6l3 3 3-3V6"/>
        </svg>
      </button>
    </div>

    <div class="w-px h-4 bg-(--border) mx-1.5"></div>

    <!-- 转义操作组 -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleEscape}
        disabled={isProcessing || !content.trim()}
        title="转义"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M7 8l-4 4 4 4M17 8l4 4-4 4"/>
        </svg>
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleUnescape}
        disabled={isProcessing || !content.trim()}
        title="反转义"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 8l4 4-4 4M15 8l-4 4 4 4"/>
        </svg>
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleMinifyEscape}
        disabled={isProcessing || !content.trim()}
        title="压缩+转义"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M8 12h8"/>
        </svg>
      </button>
    </div>

    <div class="flex-1"></div>

    <!-- 右侧操作组 -->
    <div class="flex items-center">
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleCopy}
        disabled={!content}
        title="复制"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      </button>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--error)/10 hover:text-(--error)
               active:scale-95
               disabled:opacity-30 disabled:cursor-not-allowed
               transition-all duration-150"
        onclick={handleClear}
        disabled={!content}
        title="清空"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
        </svg>
      </button>

      <div class="w-px h-4 bg-(--border) mx-1.5"></div>

      <!-- 主题切换按钮 -->
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--warning)/10 hover:text-(--warning)
               active:scale-95
               transition-all duration-150"
        onclick={toggleTheme}
        title={isDarkMode ? '亮色模式' : '暗色模式'}
      >
        {#if isDarkMode}
          <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
        {:else}
          <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
          </svg>
        {/if}
      </button>

      <!-- 设置按钮 -->
      <button
        class="w-8 h-8 flex items-center justify-center rounded-md
               text-(--text-secondary)
               hover:bg-(--bg-tertiary) hover:text-(--text-primary)
               active:scale-95
               transition-all duration-150"
        onclick={openSettings}
        title="设置"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- 编辑器主体区域 -->
  <div class="flex-1 relative min-h-0">
    <MonacoEditor
      bind:this={monacoEditor}
      value={content}
      theme={monacoTheme}
      language="json"
      fontSize={fontSize}
      tabSize={tabSize}
      onChange={handleEditorChange}
    />

    <!-- Toast 提示 -->
    {#if toastMsg}
      <div class="absolute top-4 right-4 px-4 py-2 
                  bg-(--bg-secondary) border border-(--border)
                  text-(--text-primary) rounded-lg text-sm font-medium
                  shadow-lg
                  animate-[fadeIn_0.2s_ease-out]
                  z-50">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-(--success)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          {toastMsg}
        </div>
      </div>
    {/if}
  </div>

  <!-- 状态栏 -->
  <div class="flex items-center gap-3 px-3 py-1.5 bg-(--bg-secondary) border-t border-(--border) text-xs">
    {#if stats && stats.valid}
      <!-- 只在 JSON 有效时显示统计信息 -->
      <span class="text-(--text-muted)">{stats.key_count} keys</span>
      <div class="w-px h-3 bg-(--border)"></div>
      <span class="text-(--text-muted)">{stats.depth} levels</span>
      <div class="w-px h-3 bg-(--border)"></div>
      <span class="text-(--text-muted)">{formatBytes(stats.byte_size)}</span>
    {:else if !content.trim()}
      <span class="text-(--text-muted)">Ready</span>
    {/if}
    
    <span class="flex-1"></span>
    
    {#if content}
      <span class="text-(--text-muted)">{content.split('\n').length} lines</span>
    {/if}
  </div>

  <!-- 设置面板 -->
  <SettingsPanel bind:this={settingsPanel} />
</div>

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>

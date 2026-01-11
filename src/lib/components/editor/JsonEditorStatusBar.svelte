<script lang="ts">
  const {
    isDiffMode,
    diffLineCount,
    diffLeftStats,
    diffRightStats,
    diffOriginal,
    diffModified,
    fileState,
    stats,
    content
  } = $props<{
    isDiffMode: boolean;
    diffLineCount: number;
    diffLeftStats: import('$lib/services/json').JsonStats;
    diffRightStats: import('$lib/services/json').JsonStats;
    diffOriginal: string;
    diffModified: string;
    fileState: import('$lib/stores/file').FileState;
    stats: import('$lib/services/json').JsonStats;
    content: string;
  }>();

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
</script>

<div class="flex items-center gap-2 bg-(--bg-secondary) border-t border-(--border) text-xs" style="padding: 2px 10px;">
  {#if isDiffMode}
    <span class="text-(--text-secondary)">
      {diffLeftStats.key_count} keys · {diffLeftStats.depth} levels · {formatBytes(diffLeftStats.byte_size)} · {diffOriginal ? diffOriginal.split('\n').length : 0} lines
    </span>
    <span class="flex-1 text-center text-(--text-secondary)">
      Diff {diffLineCount} lines
    </span>
    <span class="text-(--text-secondary)">
      {diffRightStats.key_count} keys · {diffRightStats.depth} levels · {formatBytes(diffRightStats.byte_size)} · {diffModified ? diffModified.split('\n').length : 0} lines
    </span>
  {:else}
    <!-- File info on the left -->
    {#if fileState.currentFileName}
      <span class="text-(--text-primary) font-medium">{fileState.currentFileName}</span>
      {#if fileState.isModified}
        <span class="text-(--warning)" title="Modified">●</span>
      {/if}
      <div class="w-px h-3 bg-(--border)"></div>
    {/if}

    {#if stats}
      <span class="text-(--text-secondary)">{stats.key_count} keys</span>
      <div class="w-px h-3 bg-(--border)"></div>
      <span class="text-(--text-secondary)">{stats.depth} levels</span>
      <div class="w-px h-3 bg-(--border)"></div>
      <span class="text-(--text-secondary)">{formatBytes(stats.byte_size)}</span>
    {/if}

    <div class="w-px h-3 bg-(--border)"></div>
    <span class="text-(--text-secondary)">{content ? content.split('\n').length : 0} lines</span>

    <span class="flex-1"></span>
  {/if}
</div>

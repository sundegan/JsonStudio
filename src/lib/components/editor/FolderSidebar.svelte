<script lang="ts">
  import { t } from '$lib/i18n';
  import { folderStore, type FileNode } from '$lib/stores/folder';

  let rootPath = $derived($folderStore.rootPath);
  let treeData = $derived($folderStore.treeData);
  let expandedFolders = $derived($folderStore.expandedFolders);
  let isLoading = $derived($folderStore.isLoading);
  let error = $derived($folderStore.error);

  function getFolderName(path: string): string {
    const parts = path.split(/[\/\\]/);
    return parts[parts.length - 1] || path;
  }

  function handleNodeClick(node: FileNode) {
    if (node.is_dir) {
      folderStore.toggleExpanded(node.path);
    } else {
      folderStore.openFile(node.path);
    }
  }

  function countJsonFiles(nodes: FileNode[]): number {
    let count = 0;
    for (const n of nodes) {
      if (!n.is_dir) count++;
      if (n.children) count += countJsonFiles(n.children);
    }
    return count;
  }
</script>

<!-- Recursive tree node snippet -->
{#snippet treeNode(node: FileNode, depth: number)}
  {@const isExpanded = expandedFolders.has(node.path)}

  <div class="tree-node-wrapper">
    <!-- Node Row -->
    <button
      class="tree-row"
      class:is-dir={node.is_dir}
      class:is-file={!node.is_dir}
      onclick={() => handleNodeClick(node)}
      title={node.path}
      style="padding-left: calc(20px + {depth} * 16px);"
    >
      <!-- Expand/Collapse chevron -->
      {#if node.is_dir}
        <span class="chevron-area">
          <svg
            class="chevron"
            class:expanded={isExpanded}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      {/if}

      <!-- Icon -->
      <span class="node-icon">
        {#if node.is_dir}
          {#if isExpanded}
            <!-- Open folder icon -->
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1H2V6zM2 9h16l-1.447 7.24A2 2 0 0114.58 18H5.42a2 2 0 01-1.974-1.76L2 9z"/>
            </svg>
          {:else}
            <!-- Closed folder icon -->
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
            </svg>
          {/if}
        {:else}
          <!-- JSON file icon -->
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/>
          </svg>
        {/if}
      </span>

      <!-- Label -->
      <span class="node-label">{node.name}</span>

      <!-- File count badge for dirs -->
      {#if node.is_dir && node.children}
        {@const count = countJsonFiles(node.children)}
        {#if count > 0}
          <span class="file-count">{count}</span>
        {/if}
      {/if}
    </button>

    <!-- Children -->
    {#if node.is_dir && isExpanded && node.children && node.children.length > 0}
      <div class="children-container">
        {#each node.children as child}
          {@render treeNode(child, depth + 1)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<!-- ─── Main Sidebar ─────────────────────────────────────────────────── -->
<div class="folder-sidebar">

  <!-- Header -->
  <div class="sidebar-header">
    <!-- Left: folder name (when open) or title -->
    <div class="header-left">
      {#if rootPath}
        <svg class="header-folder-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 4a2 2 0 012-2h3.172a2 2 0 011.414.586L10 4H12a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V4z"/>
        </svg>
        <span class="header-folder-name" title={rootPath}>{getFolderName(rootPath)}</span>
      {:else}
        <span class="header-title">{$t('folderView.title')}</span>
      {/if}
    </div>

    <!-- Right: hint + actions -->
    <div class="header-right">
      <div class="hint-icon-wrap">
        <button class="hint-icon-btn" tabindex="-1" type="button">
          <svg class="hint-icon-svg" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0ZM7.25 7.5a.75.75 0 0 1 .75-.75h.01a.75.75 0 0 1 .74.75v3.25h.25a.5.5 0 0 1 0 1h-1.5a.5.5 0 0 1 0-1h.25V8.25h-.01a.75.75 0 0 1-.49-.75Z"/>
          </svg>
        </button>
        <div class="hint-tooltip">
          Shows top-level JSON files only, ignoring subdirectories.
        </div>
      </div>

      {#if rootPath}
        <div class="header-actions">
          <button
            class="action-btn"
            onclick={() => folderStore.createUntitledFile()}
            title="New File"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="3.5" x2="8" y2="12.5" />
              <line x1="3.5" y1="8" x2="12.5" y2="8" />
            </svg>
          </button>
          <button
            class="action-btn"
            onclick={() => folderStore.refresh()}
            title="Refresh"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13.5 8A5.5 5.5 0 1 1 10 3.07"/>
              <polyline points="10 1 10 4 13 4"/>
            </svg>
          </button>
          <button
            class="action-btn close-btn"
            onclick={() => folderStore.closeFolder()}
            title="Close Folder"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M6 6l8 8M14 6l-8 8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Content -->
  <div class="sidebar-body">

    <!-- ── Empty State ── -->
    {#if !rootPath}
      <div class="empty-state">
        <div class="empty-icon-ring">
          <svg viewBox="0 0 48 48" fill="none">
            <rect x="6" y="14" width="36" height="28" rx="4" stroke="currentColor" stroke-width="2.5"/>
            <path d="M6 20h36" stroke="currentColor" stroke-width="2"/>
            <path d="M6 14l6-6h10l4 6" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
          </svg>
        </div>
        <p class="empty-title">{$t('folderView.noFolder')}</p>
        <p class="empty-desc">{$t('folderView.hint')}</p>
        <button
          class="open-folder-btn"
          onclick={() => folderStore.openFolder()}
        >
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
          </svg>
          {$t('folderView.openFolder')}
        </button>
      </div>

    <!-- ── Loading ── -->
    {:else if isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <span class="loading-text">Loading files…</span>
      </div>

    <!-- ── Error ── -->
    {:else if error}
      <div class="error-state">
        <svg class="error-icon" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
        </svg>
        <span>{error}</span>
      </div>

    <!-- ── Tree ── -->
    {:else}

      <!-- File tree -->
      <div class="tree-scroll">
        {#if treeData.length === 0}
          <div class="no-files">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z" clip-rule="evenodd"/>
            </svg>
            <span>No JSON files found</span>
          </div>
        {:else}
          {#each treeData as node}
            {@render treeNode(node, 0)}
          {/each}
        {/if}
      </div>
    {/if}

  </div>
</div>

<style>
  /* ── Layout ──────────────────────────────────────────────────────── */
  .folder-sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
    border-right: 1px solid var(--border);
    overflow: hidden;
  }

  /* ── Header ──────────────────────────────────────────────────────── */
  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 0 10px;
    height: 32px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 4px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }

  .header-folder-icon {
    width: 14px;
    height: 14px;
    color: #f5c542;
    flex-shrink: 0;
  }

  .header-folder-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.95;
  }

  .header-title {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }


  /* ── Hint icon + tooltip ─────────────────────────────────────────── */
  .hint-icon-wrap {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .hint-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    color: var(--text-secondary);
    opacity: 0.4;
    background: transparent;
    border: none;
    cursor: help;
    transition: all 0.15s ease;
  }

  .hint-icon-wrap:hover .hint-icon-btn {
    opacity: 0.8;
    color: var(--text-primary);
  }

  .hint-icon-svg {
    width: 14px;
    height: 14px;
  }

  .hint-tooltip {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 196px;
    padding: 7px 9px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 7px;
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    z-index: 100;
    transition: opacity 0.15s ease, visibility 0.15s ease;
    white-space: normal;
  }

  .hint-tooltip::before {
    content: '';
    position: absolute;
    top: -5px;
    right: 10px;
    left: auto;
    width: 8px;
    height: 8px;
    background: var(--bg-tertiary);
    border-left: 1px solid var(--border);
    border-top: 1px solid var(--border);
    transform: rotate(45deg);
  }

  .hint-icon-wrap:hover .hint-tooltip {
    visibility: visible;
    opacity: 1;
  }


  .header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    opacity: 0.45;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
  }

  .action-btn svg {
    width: 13px;
    height: 13px;
  }

  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    opacity: 1;
  }

  .close-btn:hover {
    background: rgba(244, 114, 182, 0.12);
    color: var(--error);
    opacity: 1;
  }

  /* ── Body ────────────────────────────────────────────────────────── */
  .sidebar-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Empty State ─────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px 16px;
    height: 100%;
    gap: 10px;
    text-align: center;
  }

  .empty-icon-ring {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }

  .empty-icon-ring svg {
    width: 32px;
    height: 32px;
  }

  .empty-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    opacity: 0.85;
    margin: 0;
  }

  .empty-desc {
    font-size: 10.5px;
    color: var(--text-tertiary);
    line-height: 1.5;
    margin: 0;
    max-width: 160px;
  }

  .open-folder-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    font-size: 11.5px;
    font-weight: 600;
    color: #fff;
    background: var(--accent);
    border: none;
    border-radius: 7px;
    cursor: pointer;
    transition: all 0.18s ease;
    box-shadow: 0 2px 8px var(--accent-glow);
    margin-top: 6px;
  }

  .open-folder-btn svg {
    width: 13px;
    height: 13px;
  }

  .open-folder-btn:hover {
    background: color-mix(in srgb, var(--accent) 85%, black);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px var(--accent-glow);
  }

  .open-folder-btn:active {
    transform: translateY(0);
    box-shadow: 0 1px 4px var(--accent-glow);
  }

  /* ── Loading ─────────────────────────────────────────────────────── */
  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    height: 100%;
    flex-direction: column;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-text {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* ── Error ───────────────────────────────────────────────────────── */
  .error-state {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 10px;
    padding: 10px 12px;
    background: rgba(244, 114, 182, 0.08);
    border: 1px solid rgba(244, 114, 182, 0.25);
    border-radius: 8px;
    font-size: 11px;
    color: var(--error);
    line-height: 1.5;
  }

  .error-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  /* ── Root Label ──────────────────────────────────────────────────── */
  .root-label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 6px;
    flex-shrink: 0;
  }

  .root-icon {
    width: 12px;
    height: 12px;
    color: var(--accent);
    flex-shrink: 0;
    opacity: 0.7;
  }

  .root-name {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--text-tertiary);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Tree Scroll ─────────────────────────────────────────────────── */
  .tree-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: 16px;
  }

  /* ── Tree Node ───────────────────────────────────────────────────── */
  .tree-node-wrapper {
    display: flex;
    flex-direction: column;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 26px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.1s ease, color 0.1s ease;
    border-radius: 0;
    position: relative;
    /* padding-left is set via inline style based on depth */
    padding-right: 10px;
    padding-top: 0;
    padding-bottom: 0;
  }

  .tree-row:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tree-row:hover .file-count {
    opacity: 0.8;
  }

  /* Active / focus ring */
  .tree-row:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }

  /* ── Chevron ─────────────────────────────────────────────────────── */
  .chevron-area {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .chevron {
    width: 11px;
    height: 11px;
    color: var(--text-tertiary);
    transition: transform 0.18s ease, color 0.15s;
  }

  .chevron.expanded {
    transform: rotate(90deg);
    color: var(--text-secondary);
  }

  .tree-row:hover .chevron {
    color: var(--text-primary);
  }

  /* ── Node icon ───────────────────────────────────────────────────── */
  .node-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .node-icon svg {
    width: 14px;
    height: 14px;
  }

  .is-dir .node-icon {
    color: #f5c542;
  }

  .is-file .node-icon {
    color: var(--accent);
    opacity: 0.75;
  }

  .is-file:hover .node-icon {
    opacity: 1;
  }

  /* ── Label ───────────────────────────────────────────────────────── */
  .node-label {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    line-height: 1;
  }

  .is-dir .node-label {
    font-weight: 500;
    color: var(--text-primary);
  }

  .is-file .node-label {
    font-weight: 400;
    color: var(--text-secondary);
  }

  .tree-row:hover .node-label {
    color: var(--text-primary) !important;
  }

  /* ── File count badge ────────────────────────────────────────────── */
  .file-count {
    font-size: 9.5px;
    font-weight: 600;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 1px 5px;
    line-height: 1.4;
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity 0.15s;
  }

  /* ── Children container ──────────────────────────────────────────── */
  .children-container {
    display: flex;
    flex-direction: column;
  }

  /* ── No files ────────────────────────────────────────────────────── */
  .no-files {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 14px 14px;
    font-size: 11.5px;
    color: var(--text-tertiary);
    font-style: italic;
  }

  .no-files svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.5;
  }

  /* ── Scrollbar ───────────────────────────────────────────────────── */
  .tree-scroll::-webkit-scrollbar {
    width: 5px;
  }

  .tree-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .tree-scroll::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
  }

  .tree-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--text-tertiary);
  }
</style>
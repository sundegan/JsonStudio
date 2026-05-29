import { writable } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { tabsStore } from './tabs';

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[] | null;
}

function createFolderStore() {
  const { subscribe, set, update } = writable<{
    rootPath: string | null;
    treeData: FileNode[];
    expandedFolders: Set<string>;
    isLoading: boolean;
    error: string | null;
  }>({
    rootPath: null,
    treeData: [],
    expandedFolders: new Set(),
    isLoading: false,
    error: null
  });

  return {
    subscribe,
    
    async openFolder() {
      try {
        const selectedPath = await invoke<string | null>('open_folder_dialog');
        if (selectedPath) {
          update(s => ({ ...s, rootPath: selectedPath, isLoading: true, error: null }));
          const data = await invoke<FileNode[]>('read_json_dir', { path: selectedPath });
          update(s => ({ ...s, treeData: data, isLoading: false }));
        }
      } catch (e: any) {
        update(s => ({ ...s, isLoading: false, error: e?.toString() || 'Failed to open folder' }));
      }
    },

    async refresh() {
      update(s => {
        if (!s.rootPath) return s;
        // Keep loading state
        invoke<FileNode[]>('read_json_dir', { path: s.rootPath })
          .then(data => update(st => ({ ...st, treeData: data })))
          .catch(e => update(st => ({ ...st, error: e?.toString() || 'Failed to refresh folder' })));
        return s;
      });
    },

    async createUntitledFile() {
      let currentRoot: string | null = null;
      subscribe(s => { currentRoot = s.rootPath; })();
      if (!currentRoot) return;

      try {
        const newFilePath = await invoke<string>('create_untitled_json', { dirPath: currentRoot });
        await this.refresh();
        await this.openFile(newFilePath);
      } catch (e) {
        console.error("Failed to create new file:", e);
      }
    },

    closeFolder() {
      set({ rootPath: null, treeData: [], expandedFolders: new Set(), isLoading: false, error: null });
    },

    toggleExpanded(path: string) {
      update(s => {
        const newSet = new Set(s.expandedFolders);
        if (newSet.has(path)) {
          newSet.delete(path);
        } else {
          newSet.add(path);
        }
        return { ...s, expandedFolders: newSet };
      });
    },

    async openFile(path: string) {
      try {
        const content = await invoke<string>('read_file', { path });
        const name = await invoke<string | null>('get_file_name', { path });
        tabsStore.openFile(content, path, name);
      } catch (e) {
        console.error("Failed to open file:", e);
      }
    }
  };
}

export const folderStore = createFolderStore();

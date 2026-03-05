import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface FileChangeEvent {
  path: string;
}

class FileWatcherService {
  private listeners: Map<string, UnlistenFn> = new Map();
  private callbacks: Map<string, ((path: string) => void)[]> = new Map();
  private globalListener: UnlistenFn | null = null;

  async init() {
    // Listen for file-changed events from Rust
    this.globalListener = await listen<string>('file-changed', (event) => {
      const path = event.payload;
      const callbacks = this.callbacks.get(path);
      if (callbacks) {
        callbacks.forEach(callback => callback(path));
      }
    });
  }

  async watchFile(path: string, callback: (path: string) => void): Promise<void> {
    // Add callback
    if (!this.callbacks.has(path)) {
      this.callbacks.set(path, []);
    }
    this.callbacks.get(path)!.push(callback);

    // Start watching if not already watching
    if (!this.listeners.has(path)) {
      try {
        await invoke('watch_file', { path });
        console.log(`Started watching file: ${path}`);
      } catch (error) {
        console.error('Failed to watch file:', error);
        throw error;
      }
    }
  }

  async unwatchFile(path: string, callback?: (path: string) => void): Promise<void> {
    if (callback) {
      // Remove specific callback
      const callbacks = this.callbacks.get(path);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
        // If no more callbacks, stop watching
        if (callbacks.length === 0) {
          this.callbacks.delete(path);
          await this.stopWatching(path);
        }
      }
    } else {
      // Remove all callbacks and stop watching
      this.callbacks.delete(path);
      await this.stopWatching(path);
    }
  }

  private async stopWatching(path: string): Promise<void> {
    try {
      await invoke('unwatch_file', { path });
      this.listeners.delete(path);
      console.log(`Stopped watching file: ${path}`);
    } catch (error) {
      console.error('Failed to unwatch file:', error);
    }
  }

  async unwatchAll(): Promise<void> {
    try {
      await invoke('unwatch_all_files');
      this.listeners.clear();
      this.callbacks.clear();
      console.log('Stopped watching all files');
    } catch (error) {
      console.error('Failed to unwatch all files:', error);
    }
  }

  destroy() {
    if (this.globalListener) {
      this.globalListener();
      this.globalListener = null;
    }
  }
}

export const fileWatcherService = new FileWatcherService();

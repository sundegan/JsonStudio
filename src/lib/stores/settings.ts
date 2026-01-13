// Settings store - manages app global settings
import { writable } from 'svelte/store';
import { getAvailableThemeIds } from '$lib/config/monacoThemes';

// Dark theme options (consistent with monacoThemes.ts config)
export const darkThemes = [
  { id: 'one-dark', name: 'One Dark Pro', description: 'Atom style, soft colors' },
  { id: 'github-dark', name: 'GitHub Dark', description: 'GitHub official dark' },
  { id: 'tokyo-night', name: 'Tokyo Night', description: 'Modern Japanese aesthetics' },
] as const;

// Light theme options (consistent with monacoThemes.ts config)
export const lightThemes = [
  { id: 'vs', name: 'Visual Studio', description: 'Classic light theme' },
  { id: 'github-light', name: 'GitHub Light', description: 'GitHub official light' },
] as const;

// Settings type definition
export interface AppSettings {
  // Theme settings
  isDarkMode: boolean;
  darkTheme: 'one-dark' | 'github-dark' | 'tokyo-night';
  lightTheme: 'vs' | 'github-light';
  
  // Editor settings
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  showTreeView: boolean;
}

// Default settings
const defaultSettings: AppSettings = {
  isDarkMode: false,
  darkTheme: 'one-dark',
  lightTheme: 'vs',
  fontSize: 13,
  lineHeight: 20,
  tabSize: 2,
  showTreeView: true,
};

// Load settings from localStorage
function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return defaultSettings;
  
  try {
    const saved = localStorage.getItem('app-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...defaultSettings, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return defaultSettings;
}

// Save settings to localStorage
function saveSettings(settings: AppSettings) {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem('app-settings', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Create settings store
function createSettingsStore() {
  const { subscribe, set, update } = writable<AppSettings>(defaultSettings);
  
  return {
    subscribe,
    
    // Initialize (load from localStorage)
    init() {
      const settings = loadSettings();
      set(settings);
    },
    
    // Update single setting
    async updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
      update(settings => {
        const newSettings = { ...settings, [key]: value };
        saveSettings(newSettings);
        return newSettings;
      });
      
      // If updating dark mode, sync macOS window theme
      if (key === 'isDarkMode') {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('set_window_theme', { isDark: value });
        } catch (error) {
          console.error('Failed to update window theme:', error);
        }
      }
    },
    
    // Update multiple settings
    updateSettings(partial: Partial<AppSettings>) {
      update(settings => {
        const newSettings = { ...settings, ...partial };
        saveSettings(newSettings);
        return newSettings;
      });
    },
    
    // Reset to default settings
    reset() {
      set(defaultSettings);
      saveSettings(defaultSettings);
    },
  };
}

export const settingsStore = createSettingsStore();

// Settings store - manages app global settings
import { writable } from 'svelte/store';
import { locale, type Locale } from '$lib/i18n';

// Dark theme options (consistent with monacoThemes.ts config)
export const darkThemes = [
  { id: 'json-studio-dark', name: 'JsonStudio Dark', description: 'Modern, perfectly integrated dark' },
  { id: 'one-dark', name: 'One Dark Pro', description: 'Atom style, soft colors' },
  { id: 'github-dark', name: 'GitHub Dark', description: 'GitHub official dark' },
  { id: 'tokyo-night', name: 'Tokyo Night', description: 'Modern Japanese aesthetics' },
  { id: 'dracula', name: 'Dracula', description: 'Vibrant and iconic purple' },
  { id: 'nord', name: 'Nord', description: 'Arctic, cool blue tones' },
] as const;

// Light theme options (consistent with monacoThemes.ts config)
export const lightThemes = [
  { id: 'json-studio-light', name: 'JsonStudio Light', description: 'Modern, perfectly integrated light' },
  { id: 'vs', name: 'Visual Studio', description: 'Classic light theme' },
  { id: 'github-light', name: 'GitHub Light', description: 'GitHub official light' },
  { id: 'solarized-light', name: 'Solarized Light', description: 'Warm, eye-friendly tones' },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', description: 'Pastel and cozy' },
  { id: 'rose-ivy', name: 'Rose Ivy', description: 'Rose-pink keys, ivy-green values' },
] as const;

// Settings type definition
export interface AppSettings {
  // Theme settings
  isDarkMode: boolean;
  darkTheme: 'json-studio-dark' | 'one-dark' | 'github-dark' | 'tokyo-night' | 'dracula' | 'nord';
  lightTheme: 'json-studio-light' | 'vs' | 'github-light' | 'solarized-light' | 'catppuccin-latte' | 'rose-ivy';
  
  // Language
  language: Locale;

  // Editor settings
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  showTreeView: boolean;
  showFolderView: boolean;
  autoSave: boolean;
}

// Default settings
const defaultSettings: AppSettings = {
  isDarkMode: false,
  darkTheme: 'json-studio-dark',
  lightTheme: 'json-studio-light',
  language: 'en',
  fontSize: 13,
  lineHeight: 20,
  tabSize: 2,
  showTreeView: true,
  showFolderView: false,
  autoSave: false,
};

function getSystemLanguage(): Locale {
  if (typeof navigator === 'undefined') return defaultSettings.language;

  const languages = [
    ...Array.from(navigator.languages || []),
    navigator.language,
  ].filter(Boolean);

  return languages.some(language => language.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

function getDefaultSettings(): AppSettings {
  return {
    ...defaultSettings,
    language: getSystemLanguage(),
  };
}

// Load settings from localStorage
function loadSettings(): AppSettings {
  const fallbackSettings = getDefaultSettings();
  if (typeof window === 'undefined') return fallbackSettings;
  
  try {
    const saved = localStorage.getItem('app-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return { ...fallbackSettings, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return fallbackSettings;
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

async function syncAppMenuLanguage(language: Locale) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_app_menu_language', { language });
  } catch (error) {
    console.error('Failed to update app menu language:', error);
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
      locale.set(settings.language);
      void syncAppMenuLanguage(settings.language);
    },
    
    // Update single setting
    updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
      update(settings => {
        const newSettings = { ...settings, [key]: value };
        saveSettings(newSettings);
        return newSettings;
      });
      
      if (key === 'language') {
        locale.set(value as Locale);
        void syncAppMenuLanguage(value as Locale);
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
      const settings = getDefaultSettings();
      set(settings);
      locale.set(settings.language);
      void syncAppMenuLanguage(settings.language);
      saveSettings(settings);
    },
  };
}

export const settingsStore = createSettingsStore();

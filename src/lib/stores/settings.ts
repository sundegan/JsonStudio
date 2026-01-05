// 设置存储 - 管理应用全局设置
import { writable } from 'svelte/store';
import { getAvailableThemeIds } from '$lib/config/monacoThemes';

// 深色主题选项（与 monacoThemes.ts 中的配置保持一致）
export const darkThemes = [
  { id: 'one-dark', name: 'One Dark Pro', description: 'Atom 风格，柔和配色' },
  { id: 'github-dark', name: 'GitHub Dark', description: 'GitHub 官方深色' },
  { id: 'tokyo-night', name: 'Tokyo Night', description: '现代日式美学' },
] as const;

// 亮色主题选项（与 monacoThemes.ts 中的配置保持一致）
export const lightThemes = [
  { id: 'vs', name: 'Visual Studio', description: '经典亮色主题' },
  { id: 'github-light', name: 'GitHub Light', description: 'GitHub 官方亮色' },
] as const;

// 设置类型定义
export interface AppSettings {
  // 主题设置
  isDarkMode: boolean;
  darkTheme: 'one-dark' | 'github-dark' | 'tokyo-night';
  lightTheme: 'vs' | 'github-light';
  
  // 编辑器设置
  fontSize: number;
  tabSize: number;
}

// 默认设置
const defaultSettings: AppSettings = {
  isDarkMode: false,
  darkTheme: 'one-dark',
  lightTheme: 'vs',
  fontSize: 13,
  tabSize: 2,
};

// 从 localStorage 加载设置
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

// 保存设置到 localStorage
function saveSettings(settings: AppSettings) {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem('app-settings', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// 创建设置 store
function createSettingsStore() {
  const { subscribe, set, update } = writable<AppSettings>(defaultSettings);
  
  return {
    subscribe,
    
    // 初始化（从 localStorage 加载）
    init() {
      const settings = loadSettings();
      set(settings);
    },
    
    // 更新单个设置项
    async updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
      update(settings => {
        const newSettings = { ...settings, [key]: value };
        saveSettings(newSettings);
        return newSettings;
      });
      
      // 如果更新的是暗色模式设置，同步更新 macOS 窗口主题
      if (key === 'isDarkMode') {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('set_window_theme', { isDark: value });
        } catch (error) {
          console.error('Failed to update window theme:', error);
        }
      }
    },
    
    // 更新多个设置项
    updateSettings(partial: Partial<AppSettings>) {
      update(settings => {
        const newSettings = { ...settings, ...partial };
        saveSettings(newSettings);
        return newSettings;
      });
    },
    
    // 重置为默认设置
    reset() {
      set(defaultSettings);
      saveSettings(defaultSettings);
    },
  };
}

export const settingsStore = createSettingsStore();

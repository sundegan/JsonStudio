<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from '$lib/stores/settings';
  import { shortcutsStore } from '$lib/stores/shortcuts';
  import '../app.css';
  import type { Window as TauriWindow } from '@tauri-apps/api/window';

  type TitlebarPlatform = 'macos' | 'windows' | 'linux';

  let platform = $state<TitlebarPlatform>('macos');
  let isWindowInactive = $state(false);
  let isWindowExpanded = $state(false);
  let themeSwitchFrame: number | null = null;
  let appliedTheme: boolean | null = null;

  async function detectPlatform(): Promise<TitlebarPlatform> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const desktopPlatform = await invoke<string>('desktop_platform');
      if (desktopPlatform === 'macos') return 'macos';
      if (desktopPlatform === 'windows') return 'windows';
      if (desktopPlatform === 'linux') return 'linux';
      console.warn('Unknown desktop platform:', desktopPlatform);
    } catch (error) {
      console.warn('Failed to detect desktop platform:', error);
    }
    return 'macos';
  }

  function applyTheme(isDarkMode: boolean) {
    const html = document.documentElement;
    if (themeSwitchFrame !== null) {
      cancelAnimationFrame(themeSwitchFrame);
    }

    html.classList.add('theme-switching');
    html.classList.toggle('light', !isDarkMode);
    html.style.colorScheme = isDarkMode ? 'dark' : 'light';

    themeSwitchFrame = requestAnimationFrame(() => {
      themeSwitchFrame = null;
      html.classList.remove('theme-switching');
    });

    void syncNativeWindowTheme(isDarkMode);
  }

  async function syncNativeWindowTheme(isDarkMode: boolean) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_window_theme', { isDark: isDarkMode });
    } catch (error) {
      console.error('Failed to update window theme:', error);
    }
  }

  async function updateWindowFrameState(appWindow: TauriWindow) {
    const fullscreen = await appWindow.isFullscreen();
    const maximized = platform === 'macos' ? false : await appWindow.isMaximized();
    isWindowExpanded = fullscreen || maximized;
  }

  onMount(() => {
    settingsStore.init();
    shortcutsStore.init();

    void detectPlatform().then((value) => {
      platform = value;
    });
    const focusUnlisteners: Array<() => void> = [];
    let disposed = false;
    let appWindow: TauriWindow | null = null;
    const addFocusUnlistener = (unlisten: () => void) => {
      if (disposed) {
        unlisten();
        return;
      }
      focusUnlisteners.push(unlisten);
    };
    const syncWindowFrameState = () => {
      if (!appWindow) return;
      void updateWindowFrameState(appWindow);
    };
    const handleDocumentVisibilityChange = () => {
      if (!document.hidden) syncWindowFrameState();
    };
    void (async () => {
      const { isTauri } = await import('@tauri-apps/api/core');
      const runningInTauri = isTauri();
      if (!runningInTauri) return;

      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      appWindow = getCurrentWindow();
      isWindowInactive = !(await appWindow.isFocused());
      await updateWindowFrameState(appWindow);

      const unlistenFocus = await appWindow.onFocusChanged(({ payload: focused }) => {
        isWindowInactive = !focused;
        if (focused) syncWindowFrameState();
      });
      addFocusUnlistener(unlistenFocus);
    })();
    const handleWindowExpandedChange = (event: Event) => {
      const { expanded } = (event as CustomEvent<{ expanded: boolean }>).detail;
      isWindowExpanded = expanded;
    };
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };
    const handleKeydown = (event: KeyboardEvent) => {
      const isZoomKey =
        event.key === '=' ||
        event.key === '-' ||
        event.key === '0' ||
        event.key === '+' ||
        event.code === 'Minus' ||
        event.code === 'Equal' ||
        event.code === 'Digit0' ||
        event.code === 'NumpadAdd' ||
        event.code === 'NumpadSubtract';

      if ((event.ctrlKey || event.metaKey) && isZoomKey) {
        event.preventDefault();
      }
    };
    const handleGesture = (event: Event) => {
      event.preventDefault();
    };
    const handleSelectStart = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const selectableTarget = target.closest([
        '.monaco-editor',
        'input',
        'textarea',
        '[contenteditable="true"]'
      ].join(','));

      if (!selectableTarget) {
        event.preventDefault();
      }
    };
    window.addEventListener('jsonstudio-window-expanded-change', handleWindowExpandedChange);
    window.addEventListener('focus', syncWindowFrameState);
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('gesturestart', handleGesture);
    document.addEventListener('gesturechange', handleGesture);
    document.addEventListener('selectstart', handleSelectStart);

    const unsubscribe = settingsStore.subscribe(settings => {
      if (appliedTheme === settings.isDarkMode) return;
      appliedTheme = settings.isDarkMode;
      applyTheme(settings.isDarkMode);
    });
    return () => {
      disposed = true;
      if (themeSwitchFrame !== null) {
        cancelAnimationFrame(themeSwitchFrame);
        themeSwitchFrame = null;
      }
      document.documentElement.classList.remove('theme-switching');
      unsubscribe();
      window.removeEventListener('jsonstudio-window-expanded-change', handleWindowExpandedChange);
      window.removeEventListener('focus', syncWindowFrameState);
      document.removeEventListener('visibilitychange', handleDocumentVisibilityChange);
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('wheel', handleWheel);
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('gesturestart', handleGesture);
      document.removeEventListener('gesturechange', handleGesture);
      document.removeEventListener('selectstart', handleSelectStart);
      for (const unlisten of focusUnlisteners) unlisten();
    };
  });
</script>

<div class={`desktop-window-frame desktop-window-frame-${platform} ${isWindowInactive ? 'is-inactive' : ''} ${isWindowExpanded ? 'is-expanded' : ''}`}>
  <div class="app-window">
    <div class="app-content">
      <slot />
    </div>
  </div>
</div>

export type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function sanitizeTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function createThemeStore() {
  let theme = $state<Theme>('system');
  let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;
  let mediaQueryList: MediaQueryList | null = null;

  function removeListener() {
    try {
      if (mediaQueryList && mediaQueryListener) {
        if (typeof mediaQueryList.removeEventListener === 'function') {
          mediaQueryList.removeEventListener('change', mediaQueryListener);
        } else if (typeof (mediaQueryList as unknown as { removeListener?: (cb: unknown) => void }).removeListener === 'function') {
          (mediaQueryList as unknown as { removeListener: (cb: unknown) => void }).removeListener(mediaQueryListener);
        }
      }
    } catch {
    } finally {
      mediaQueryListener = null;
      mediaQueryList = null;
    }
  }

  function applyTheme(targetTheme: Theme) {
    try {
      if (typeof document === 'undefined') return;
      let isDark = targetTheme === 'dark';
      if (targetTheme === 'system' && typeof window !== 'undefined') {
        if (mediaQueryList) {
          isDark = mediaQueryList.matches;
        } else if (typeof window.matchMedia === 'function') {
          isDark = window.matchMedia(DARK_MEDIA_QUERY).matches;
        }
      }
      document.documentElement.classList.toggle('dark', isDark);
    } catch {}
  }

  function init() {
    try {
      if (typeof window === 'undefined') return;
      removeListener();

      if (typeof window.matchMedia === 'function') {
        mediaQueryList = window.matchMedia(DARK_MEDIA_QUERY);
        mediaQueryListener = () => {
          if (theme === 'system') applyTheme('system');
        };
        if (typeof mediaQueryList.addEventListener === 'function') {
          mediaQueryList.addEventListener('change', mediaQueryListener);
        } else if (typeof (mediaQueryList as unknown as { addListener?: (cb: unknown) => void }).addListener === 'function') {
          (mediaQueryList as unknown as { addListener: (cb: unknown) => void }).addListener(mediaQueryListener);
        }
      }

      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {}

      theme = sanitizeTheme(stored);
      applyTheme(theme);
    } catch {}
  }

  return {
    get current() {
      return theme;
    },
    setTheme(nextTheme: Theme) {
      const validTheme = sanitizeTheme(nextTheme);
      theme = validTheme;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, validTheme);
        }
      } catch {}
      applyTheme(validTheme);
    },
    init,
    destroy() {
      removeListener();
    },
  };
}

export const themeStore = createThemeStore();

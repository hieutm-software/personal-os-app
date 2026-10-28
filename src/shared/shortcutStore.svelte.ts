const isClient = typeof window !== 'undefined';
const STORAGE_KEY = 'shortcut_config';

export type ShortcutConfig = {
  newTask: string | null;
  newNote: string | null;
  commandPalette: string | null;
  newEvent: string | null;
};

interface ParsedShortcut {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

const DEFAULT_WIN_CONFIG: ShortcutConfig = {
  newTask: 'Ctrl+Shift+T',
  newNote: 'Ctrl+Shift+N',
  commandPalette: 'Ctrl+K',
  newEvent: null,
};

const DEFAULT_MAC_CONFIG: ShortcutConfig = {
  newTask: 'Meta+Shift+T',
  newNote: 'Meta+Shift+N',
  commandPalette: 'Meta+K',
  newEvent: null,
};

const parsedShortcutCache = new Map<string, ParsedShortcut>();

function detectPlatformDefaults(): ShortcutConfig {
  if (isClient && typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac')) {
    return { ...DEFAULT_MAC_CONFIG };
  }
  return { ...DEFAULT_WIN_CONFIG };
}

function sanitizeShortcutValue(val: unknown, fallback: string | null): string | null {
  if (val === null) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 && trimmed.length <= 64 ? trimmed : null;
  }
  return fallback;
}

function sanitizeShortcutConfig(raw: Partial<ShortcutConfig>, base: ShortcutConfig): ShortcutConfig {
  return {
    newTask: raw.newTask !== undefined ? sanitizeShortcutValue(raw.newTask, base.newTask) : base.newTask,
    newNote: raw.newNote !== undefined ? sanitizeShortcutValue(raw.newNote, base.newNote) : base.newNote,
    commandPalette:
      raw.commandPalette !== undefined
        ? sanitizeShortcutValue(raw.commandPalette, base.commandPalette)
        : base.commandPalette,
    newEvent: raw.newEvent !== undefined ? sanitizeShortcutValue(raw.newEvent, base.newEvent) : base.newEvent,
  };
}

function getParsedShortcut(shortcutStr: string): ParsedShortcut | null {
  let cached = parsedShortcutCache.get(shortcutStr);
  if (cached !== undefined) return cached;

  const parts = shortcutStr.toLowerCase().split('+');
  const key = parts.pop();
  if (!key) return null;

  let ctrl = false;
  let meta = false;
  let shift = false;
  let alt = false;

  for (let i = 0, len = parts.length; i < len; i++) {
    const mod = parts[i];
    if (mod === 'ctrl') ctrl = true;
    else if (mod === 'meta' || mod === 'cmd') meta = true;
    else if (mod === 'shift') shift = true;
    else if (mod === 'alt') alt = true;
  }

  cached = { ctrl, meta, shift, alt, key };
  if (parsedShortcutCache.size >= 64) {
    parsedShortcutCache.clear();
  }
  parsedShortcutCache.set(shortcutStr, cached);
  return cached;
}

class ShortcutStore {
  config = $state<ShortcutConfig>({ ...DEFAULT_WIN_CONFIG });
  isInitialized = $state(false);

  init(force = false) {
    if (this.isInitialized && !force) return;
    try {
      const defaults = detectPlatformDefaults();
      if (isClient) {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && typeof parsed === 'object') {
            this.config = sanitizeShortcutConfig(parsed as Partial<ShortcutConfig>, defaults);
          } else {
            this.config = defaults;
          }
        } else {
          this.config = defaults;
        }
      } else {
        this.config = defaults;
      }
    } catch {
      this.config = detectPlatformDefaults();
    }
    this.isInitialized = true;
  }

  save() {
    try {
      if (isClient) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
      }
    } catch {}
  }

  updateConfig(updates: Partial<ShortcutConfig>) {
    try {
      if (!updates || typeof updates !== 'object') return;
      this.config = sanitizeShortcutConfig(updates, this.config);
      this.save();
    } catch {}
  }

  reset() {
    try {
      this.config = detectPlatformDefaults();
      this.save();
    } catch {}
  }

  matchShortcut(e: KeyboardEvent, shortcutStr: string | null): boolean {
    try {
      if (!shortcutStr || !e || typeof e.key !== 'string') return false;
      const parsed = getParsedShortcut(shortcutStr);
      if (!parsed) return false;

      if (e.ctrlKey !== parsed.ctrl) return false;
      if (e.metaKey !== parsed.meta) return false;
      if (e.shiftKey !== parsed.shift) return false;
      if (e.altKey !== parsed.alt) return false;

      return e.key.toLowerCase() === parsed.key;
    } catch {
      return false;
    }
  }
}

export const shortcutStore = new ShortcutStore();

import { uiPreferenceRepo } from './db/repo/uiPreferenceRepo';

export interface AutoCleanupConfig {
  enabled: boolean;
  cleanTasks: boolean;
  tasksRetentionDays: number;
  cleanEvents: boolean;
  eventsRetentionDays: number;
  cleanDocuments: boolean;
  documentsRetentionDays: number;
  cleanVault: boolean;
  vaultRetentionDays: number;
}

const STORAGE_KEY = 'auto_cleanup_config';
const DEFAULT_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 36500;

const defaultConfig: AutoCleanupConfig = {
  enabled: false,
  cleanTasks: false,
  tasksRetentionDays: DEFAULT_RETENTION_DAYS,
  cleanEvents: false,
  eventsRetentionDays: DEFAULT_RETENTION_DAYS,
  cleanDocuments: false,
  documentsRetentionDays: DEFAULT_RETENTION_DAYS,
  cleanVault: false,
  vaultRetentionDays: DEFAULT_RETENTION_DAYS,
};

function sanitizeDays(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1) return fallback;
  return Math.min(MAX_RETENTION_DAYS, Math.floor(num));
}

function sanitizeConfig(
  raw: Partial<AutoCleanupConfig>,
  base: AutoCleanupConfig
): AutoCleanupConfig {
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    cleanTasks: typeof raw.cleanTasks === 'boolean' ? raw.cleanTasks : base.cleanTasks,
    tasksRetentionDays:
      raw.tasksRetentionDays !== undefined
        ? sanitizeDays(raw.tasksRetentionDays, base.tasksRetentionDays)
        : base.tasksRetentionDays,
    cleanEvents: typeof raw.cleanEvents === 'boolean' ? raw.cleanEvents : base.cleanEvents,
    eventsRetentionDays:
      raw.eventsRetentionDays !== undefined
        ? sanitizeDays(raw.eventsRetentionDays, base.eventsRetentionDays)
        : base.eventsRetentionDays,
    cleanDocuments:
      typeof raw.cleanDocuments === 'boolean' ? raw.cleanDocuments : base.cleanDocuments,
    documentsRetentionDays:
      raw.documentsRetentionDays !== undefined
        ? sanitizeDays(raw.documentsRetentionDays, base.documentsRetentionDays)
        : base.documentsRetentionDays,
    cleanVault: typeof raw.cleanVault === 'boolean' ? raw.cleanVault : base.cleanVault,
    vaultRetentionDays:
      raw.vaultRetentionDays !== undefined
        ? sanitizeDays(raw.vaultRetentionDays, base.vaultRetentionDays)
        : base.vaultRetentionDays,
  };
}

function createAutoCleanupStore() {
  let config = $state<AutoCleanupConfig>({ ...defaultConfig });

  async function init() {
    try {
      if (typeof window === 'undefined') return;
      let stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        try {
          const pref = await uiPreferenceRepo.get(STORAGE_KEY);
          if (pref) stored = pref;
        } catch {}
      }
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        config = sanitizeConfig(parsed as Partial<AutoCleanupConfig>, defaultConfig);
      }
    } catch {}
  }

  function save() {
    try {
      if (typeof window === 'undefined') return;
      const serialized = JSON.stringify(config);
      localStorage.setItem(STORAGE_KEY, serialized);
      uiPreferenceRepo.set(STORAGE_KEY, serialized).catch(() => {});
      window.dispatchEvent(new CustomEvent("auto-cleanup-config-changed"));
    } catch {}
  }

  return {
    get config() {
      return config;
    },
    updateConfig(newConfig: Partial<AutoCleanupConfig>) {
      try {
        if (!newConfig || typeof newConfig !== 'object') return;
        config = sanitizeConfig(newConfig, config);
        save();
      } catch {}
    },
    init,
  };
}

export const autoCleanupStore = createAutoCleanupStore();

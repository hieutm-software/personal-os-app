import { getDbConnection } from '../client';

export interface UiPreferenceRecord {
  key: string;
  value: string;
  updated_at: number;
}

const CREATE_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS `ui_preferences` (`key` text PRIMARY KEY NOT NULL, `value` text NOT NULL, `updated_at` integer NOT NULL);';
const SELECT_VALUE_SQL = 'SELECT `value` FROM `ui_preferences` WHERE `key` = ? LIMIT 1';
const UPSERT_VALUE_SQL =
  'INSERT INTO `ui_preferences` (`key`, `value`, `updated_at`) VALUES (?, ?, ?) ON CONFLICT(`key`) DO UPDATE SET `value` = excluded.`value`, `updated_at` = excluded.`updated_at`;';
const SELECT_ALL_SQL = 'SELECT `key`, `value`, `updated_at` FROM `ui_preferences`';
const DELETE_VALUE_SQL = 'DELETE FROM `ui_preferences` WHERE `key` = ?';

let isTableInitialized = false;
let tableInitPromise: Promise<void> | null = null;

function sanitizeKey(key: string): string | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  return trimmed;
}

export const uiPreferenceRepo = {
  async ensureTable(): Promise<void> {
    if (isTableInitialized) return;
    if (tableInitPromise) return tableInitPromise;

    tableInitPromise = (async () => {
      try {
        const conn = await getDbConnection();
        await conn.execute(CREATE_TABLE_SQL);
        isTableInitialized = true;
      } catch {
        isTableInitialized = false;
      } finally {
        tableInitPromise = null;
      }
    })();

    return tableInitPromise;
  },

  async get(key: string): Promise<string | null> {
    try {
      const validKey = sanitizeKey(key);
      if (!validKey) return null;
      await this.ensureTable();
      const conn = await getDbConnection();
      const res = await conn.select<{ value: string }[]>(SELECT_VALUE_SQL, [validKey]);
      if (!Array.isArray(res) || res.length === 0) return null;
      const val = res[0]?.value;
      return typeof val === 'string' ? val : null;
    } catch {
      return null;
    }
  },

  async set(key: string, value: string, updatedAt?: number): Promise<void> {
    try {
      const validKey = sanitizeKey(key);
      if (!validKey || typeof value !== 'string') return;
      const safeUpdatedAt =
        typeof updatedAt === 'number' && Number.isFinite(updatedAt)
          ? Math.trunc(updatedAt)
          : Date.now();
      await this.ensureTable();
      const conn = await getDbConnection();
      await conn.execute(UPSERT_VALUE_SQL, [validKey, value, safeUpdatedAt]);
    } catch {}
  },

  async delete(key: string): Promise<void> {
    try {
      const validKey = sanitizeKey(key);
      if (!validKey) return;
      await this.ensureTable();
      const conn = await getDbConnection();
      await conn.execute(DELETE_VALUE_SQL, [validKey]);
    } catch {}
  },

  async getAll(): Promise<UiPreferenceRecord[]> {
    try {
      await this.ensureTable();
      const conn = await getDbConnection();
      const rows = await conn.select<UiPreferenceRecord[]>(SELECT_ALL_SQL);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
};

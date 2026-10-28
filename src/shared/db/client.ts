import Database from '@tauri-apps/plugin-sql';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from './schema';
import { toastState } from '../toast.svelte';

const DB_CONNECTION_URI = 'sqlite:personal-os-v2.db';
const EMPTY_PARAMS: unknown[] = [];
const EMPTY_ROWS_RESULT = { rows: [] as unknown[][] };
const MAX_LOCK_RETRIES = 10;

let dbInstance: Database | null = null;
let dbPromise: Promise<Database> | null = null;

function isDatabaseLockedError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('database is locked') ||
    msg.includes('code: 5') ||
    msg.includes('code: 6') ||
    msg.includes('sqlite_busy') ||
    msg.includes('sqlite_locked') ||
    msg.includes('busy')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function configureDatabasePragmas(conn: Database): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await conn.execute('PRAGMA busy_timeout = 10000;');
      await conn.execute('PRAGMA journal_mode = WAL;');
      await conn.execute('PRAGMA synchronous = NORMAL;');
      await conn.execute('PRAGMA foreign_keys = ON;');
      await conn.execute('PRAGMA temp_store = MEMORY;');
      return;
    } catch (err) {
      if (attempt === 2) {
        console.warn('Failed to configure SQLite pragmas:', err);
      } else {
        await delay(100);
      }
    }
  }
}

function normalizeSqlParams(params: unknown[]): unknown[] {
  if (!Array.isArray(params) || params.length === 0) {
    return EMPTY_PARAMS;
  }

  const len = params.length;
  let needsCopy = false;
  for (let i = 0; i < len; i++) {
    const val = params[i];
    if (val === undefined || (typeof val === 'number' && Number.isNaN(val))) {
      needsCopy = true;
      break;
    }
  }

  if (!needsCopy) {
    return params;
  }

  const sanitized = new Array<unknown>(len);
  for (let i = 0; i < len; i++) {
    const val = params[i];
    sanitized[i] = val === undefined || (typeof val === 'number' && Number.isNaN(val)) ? null : val;
  }
  return sanitized;
}

export async function getDbConnection(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (!dbPromise) {
    dbPromise = (async () => {
      const instance = await Database.load(DB_CONNECTION_URI);
      await configureDatabasePragmas(instance);
      dbInstance = instance;
      return instance;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export const db = drizzle(
  async (sql: string, params: unknown[], method: 'run' | 'all' | 'values' | 'get') => {
    if (typeof sql !== 'string' || sql.length === 0) {
      return EMPTY_ROWS_RESULT;
    }

    const sanitizedParams = normalizeSqlParams(params);
    let attempt = 0;

    while (true) {
      try {
        const connection = await getDbConnection();

        if (method === 'run') {
          await connection.execute(sql, sanitizedParams);
          return EMPTY_ROWS_RESULT;
        }

        const result = await connection.select<Record<string, unknown>[]>(sql, sanitizedParams);
        if (!Array.isArray(result) || result.length === 0) {
          if (method === 'get') {
            return { rows: undefined as unknown as unknown[][] };
          }
          return EMPTY_ROWS_RESULT;
        }

        if (method === 'get') {
          const firstRow = result[0];
          return {
            rows: (firstRow ? Object.values(firstRow) : undefined) as unknown as unknown[][]
          };
        }

        const len = result.length;
        const rows = new Array<unknown[]>(len);
        for (let i = 0; i < len; i++) {
          const row = result[i];
          rows[i] = row ? Object.values(row) : [];
        }
        return { rows };
      } catch (err: unknown) {
        if (isDatabaseLockedError(err) && attempt < MAX_LOCK_RETRIES) {
          attempt++;
          const backoff = 50 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 40);
          console.warn(
            `[db] SQLite busy/locked (attempt ${attempt}/${MAX_LOCK_RETRIES}), retrying in ${backoff}ms...`
          );
          await delay(backoff);
          continue;
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('Database operation failed:', err, 'SQL was:', sql);
        toastState.add('error', `Database operation failed: ${errorMsg}`);
        throw err;
      }
    }
  },
  { schema }
);

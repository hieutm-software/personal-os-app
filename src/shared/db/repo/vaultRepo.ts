import { eq, inArray, isNull } from 'drizzle-orm';
import { db, getDbConnection } from '../client';
import { vault, vaultGroups, type VaultItem, type VaultGroup } from '../schema';

let isVaultGroupSchemaEnsured = false;
async function ensureVaultGroupSchema(): Promise<void> {
  if (isVaultGroupSchemaEnsured) return;
  try {
    const connection = await getDbConnection();
    const cols = await connection.select<Array<{ name: string }>>(
      "PRAGMA table_info('vault_groups');"
    );
    const hasParentId = Array.isArray(cols) && cols.some((c) => c.name === 'parent_id');
    if (!hasParentId) {
      await connection.execute('ALTER TABLE vault_groups ADD COLUMN parent_id TEXT;');
    }
  } catch {}
  isVaultGroupSchemaEnsured = true;
}

const BATCH_CHUNK_SIZE = 500;

function extractUniqueIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id === 'string' && id.length > 0) {
      seen.add(id);
    }
  }
  return Array.from(seen);
}

function sanitizePartial<T extends Record<string, unknown>>(data: Partial<T>): Partial<T> | null {
  if (!data || typeof data !== 'object') return null;
  const cleaned: Partial<T> = {};
  let hasKeys = false;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined) {
      cleaned[key] = data[key];
      hasKeys = true;
    }
  }
  return hasKeys ? cleaned : null;
}

export const vaultRepo = {
  async getAll(): Promise<VaultItem[]> {
    try {
      return await db.select().from(vault);
    } catch {
      return [];
    }
  },

  async create(item: VaultItem): Promise<void> {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) {
      throw new Error('Invalid vault item payload');
    }
    await db.insert(vault).values(item);
  },

  async update(id: string, data: Partial<VaultItem>): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    const cleaned = sanitizePartial<VaultItem>(data);
    if (!cleaned) return;
    await db.update(vault).set(cleaned).where(eq(vault.id, id));
  },

  async delete(id: string): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    await db.delete(vault).where(eq(vault.id, id));
  },

  async deleteMany(ids: string[]): Promise<void> {
    const uniqueIds = extractUniqueIds(ids);
    if (uniqueIds.length === 0) return;
    if (uniqueIds.length === 1) {
      await db.delete(vault).where(eq(vault.id, uniqueIds[0]));
      return;
    }
    for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + BATCH_CHUNK_SIZE);
      await db.delete(vault).where(inArray(vault.id, chunk));
    }
  },

  async updateMany(ids: string[], data: Partial<VaultItem>): Promise<void> {
    const uniqueIds = extractUniqueIds(ids);
    if (uniqueIds.length === 0) return;
    const cleaned = sanitizePartial<VaultItem>(data);
    if (!cleaned) return;
    if (uniqueIds.length === 1) {
      await db.update(vault).set(cleaned).where(eq(vault.id, uniqueIds[0]));
      return;
    }
    for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + BATCH_CHUNK_SIZE);
      await db.update(vault).set(cleaned).where(inArray(vault.id, chunk));
    }
  }
};

export const vaultGroupRepo = {
  async getAll(): Promise<VaultGroup[]> {
    try {
      await ensureVaultGroupSchema();
      return await db.select().from(vaultGroups).where(isNull(vaultGroups.deletedAt));
    } catch {
      return [];
    }
  },

  async create(group: VaultGroup): Promise<void> {
    if (!group || typeof group.id !== 'string' || group.id.length === 0) {
      throw new Error('Invalid vault group payload');
    }
    await ensureVaultGroupSchema();
    await db.insert(vaultGroups).values(group);
  },

  async update(id: string, data: Partial<VaultGroup>): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    const cleaned = sanitizePartial<VaultGroup>(data);
    if (!cleaned) return;
    await ensureVaultGroupSchema();
    await db.update(vaultGroups).set(cleaned).where(eq(vaultGroups.id, id));
  },

  async delete(id: string): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    await ensureVaultGroupSchema();

    const allGroups = await db.select().from(vaultGroups);
    const deletedGroupIds = new Set<string>([id]);
    let foundMore = true;
    while (foundMore) {
      foundMore = false;
      for (const g of allGroups) {
        if (g.parentId && deletedGroupIds.has(g.parentId) && !deletedGroupIds.has(g.id)) {
          deletedGroupIds.add(g.id);
          foundMore = true;
        }
      }
    }

    for (const gid of deletedGroupIds) {
      await db.update(vault).set({ groupId: null }).where(eq(vault.groupId, gid));
      await db.delete(vaultGroups).where(eq(vaultGroups.id, gid));
    }
  },

  async sanitizeOrphans(): Promise<void> {
    try {
      await ensureVaultGroupSchema();

      const allGroups = await db.select().from(vaultGroups).where(isNull(vaultGroups.deletedAt));
      const groupIds = new Set(allGroups.map((g) => g.id));
      for (const g of allGroups) {
        if (g.parentId && !groupIds.has(g.parentId)) {
          await db.update(vaultGroups).set({ parentId: null }).where(eq(vaultGroups.id, g.id));
        }
      }

      const allExistingGroups = await db.select().from(vaultGroups);
      const existingGroupIds = new Set(allExistingGroups.map((g) => g.id));
      const allItems = await db.select().from(vault);
      for (const item of allItems) {
        if (item.groupId && !existingGroupIds.has(item.groupId)) {
          await db.update(vault).set({ groupId: null }).where(eq(vault.id, item.id));
        }
      }
    } catch {}
  }
};

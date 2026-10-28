import { eq, inArray, sql, and, lt, or, isNotNull } from 'drizzle-orm';
import { db, getDbConnection } from '../client';
import { tasks, taskGroups, type Task, type TaskGroup } from '../schema';

let isTaskGroupSchemaEnsured = false;
async function ensureTaskGroupSchema(): Promise<void> {
  if (isTaskGroupSchemaEnsured) return;
  try {
    const connection = await getDbConnection();
    const cols = await connection.select<Array<{ name: string }>>(
      "PRAGMA table_info('task_groups');"
    );
    const hasParentId = Array.isArray(cols) && cols.some((c) => c.name === 'parent_id');
    if (!hasParentId) {
      await connection.execute('ALTER TABLE task_groups ADD COLUMN parent_id TEXT;');
    }
  } catch {}
  isTaskGroupSchemaEnsured = true;
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

export const taskGroupRepo = {
  async getAll(): Promise<TaskGroup[]> {
    try {
      await ensureTaskGroupSchema();
      return await db.select().from(taskGroups);
    } catch {
      return [];
    }
  },

  async create(group: TaskGroup): Promise<void> {
    if (!group || typeof group.id !== 'string' || group.id.length === 0) {
      throw new Error('Invalid task group payload');
    }
    await ensureTaskGroupSchema();
    await db.insert(taskGroups).values(group);
  },

  async update(id: string, data: Partial<TaskGroup>): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    const cleaned = sanitizePartial<TaskGroup>(data);
    if (!cleaned) return;
    await ensureTaskGroupSchema();
    await db.update(taskGroups).set(cleaned).where(eq(taskGroups.id, id));
  },

  async delete(id: string): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    await ensureTaskGroupSchema();

    const allGroups = await db.select().from(taskGroups);
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
      await db.update(tasks).set({ groupId: null }).where(eq(tasks.groupId, gid));
      await db.delete(taskGroups).where(eq(taskGroups.id, gid));
    }
  },

  async sanitizeOrphans(): Promise<void> {
    try {
      await ensureTaskGroupSchema();
      const allGroups = await db.select().from(taskGroups);
      const groupIds = new Set(allGroups.map((g) => g.id));
      for (const g of allGroups) {
        if (g.parentId && !groupIds.has(g.parentId)) {
          await db.update(taskGroups).set({ parentId: null }).where(eq(taskGroups.id, g.id));
        }
      }

      const allTasks = await db.select().from(tasks);
      for (const t of allTasks) {
        if (t.groupId && !groupIds.has(t.groupId)) {
          await db.update(tasks).set({ groupId: null }).where(eq(tasks.id, t.id));
        }
      }
    } catch {}
  }
};

export const taskRepo = {
  async getAll(): Promise<Task[]> {
    try {
      return await db.select().from(tasks);
    } catch {
      return [];
    }
  },

  async getCountByStatus(status: 'PENDING' | 'COMPLETED'): Promise<number> {
    try {
      if (status !== 'PENDING' && status !== 'COMPLETED') return 0;
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(eq(tasks.status, status));
      const count = Number(result[0]?.count);
      return Number.isFinite(count) && count >= 0 ? count : 0;
    } catch {
      return 0;
    }
  },

  async create(task: Task): Promise<void> {
    if (!task || typeof task.id !== 'string' || task.id.length === 0) {
      throw new Error('Invalid task payload');
    }
    await db.insert(tasks).values(task);
  },

  async update(id: string, data: Partial<Task>): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    const cleaned = sanitizePartial<Task>(data);
    if (!cleaned) return;
    await db.update(tasks).set(cleaned).where(eq(tasks.id, id));
  },

  async delete(id: string): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    await db.delete(tasks).where(eq(tasks.id, id));
  },

  async deleteMany(ids: string[]): Promise<void> {
    const uniqueIds = extractUniqueIds(ids);
    if (uniqueIds.length === 0) return;
    if (uniqueIds.length === 1) {
      await db.delete(tasks).where(eq(tasks.id, uniqueIds[0]));
      return;
    }
    for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + BATCH_CHUNK_SIZE);
      await db.delete(tasks).where(inArray(tasks.id, chunk));
    }
  },

  async cleanupAuto(retentionMs: number): Promise<void> {
    const safeRetentionMs = Number(retentionMs);
    if (!Number.isFinite(safeRetentionMs) || safeRetentionMs <= 0) return;
    const threshold = Date.now() - safeRetentionMs;
    await db.delete(tasks).where(
      or(
        and(isNotNull(tasks.deletedAt), lt(tasks.deletedAt, threshold)),
        and(eq(tasks.status, 'COMPLETED'), lt(tasks.updatedAt, threshold))
      )
    );
  }
};

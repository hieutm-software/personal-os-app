import { eq, inArray } from 'drizzle-orm';
import { db } from '../client';
import { events, eventGroups, type Event, type EventGroup } from '../schema';

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

export const eventGroupRepo = {
  async getAll(): Promise<EventGroup[]> {
    try {
      return await db.select().from(eventGroups);
    } catch {
      return [];
    }
  },

  async create(group: EventGroup): Promise<void> {
    if (!group || typeof group.id !== 'string' || group.id.length === 0) {
      throw new Error('Invalid event group payload');
    }
    await db.insert(eventGroups).values(group);
  },

  async update(id: string, data: Partial<EventGroup>): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    const cleaned = sanitizePartial<EventGroup>(data);
    if (!cleaned) return;
    await db.update(eventGroups).set(cleaned).where(eq(eventGroups.id, id));
  },

  async delete(id: string): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    await db.update(events).set({ groupId: null }).where(eq(events.groupId, id));
    await db.delete(eventGroups).where(eq(eventGroups.id, id));
  },

  async sanitizeOrphans(): Promise<void> {
    try {
      const activeGroups = await db.select().from(eventGroups);
      const groupIds = new Set(activeGroups.map((g) => g.id));
      const allEvents = await db.select().from(events);
      for (const e of allEvents) {
        if (e.groupId && e.groupId !== 'GOOGLE_CALENDAR' && !groupIds.has(e.groupId)) {
          await db.update(events).set({ groupId: null }).where(eq(events.id, e.id));
        }
      }
    } catch {}
  }
};

export const eventRepo = {
  async getAll(): Promise<Event[]> {
    try {
      return await db.select().from(events);
    } catch {
      return [];
    }
  },

  async create(event: Event): Promise<void> {
    if (!event || typeof event.id !== 'string' || event.id.length === 0) {
      throw new Error('Invalid event payload');
    }
    await db.insert(events).values(event);
  },

  async update(id: string, data: Partial<Event>): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    const cleaned = sanitizePartial<Event>(data);
    if (!cleaned) return;
    await db.update(events).set(cleaned).where(eq(events.id, id));
  },

  async delete(id: string): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    await db.delete(events).where(eq(events.id, id));
  },

  async deleteMany(ids: string[]): Promise<void> {
    const uniqueIds = extractUniqueIds(ids);
    if (uniqueIds.length === 0) return;
    if (uniqueIds.length === 1) {
      await db.delete(events).where(eq(events.id, uniqueIds[0]));
      return;
    }
    for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + BATCH_CHUNK_SIZE);
      await db.delete(events).where(inArray(events.id, chunk));
    }
  }
};

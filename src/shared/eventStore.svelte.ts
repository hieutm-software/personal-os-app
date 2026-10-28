import { eventRepo, eventGroupRepo } from './db/repo/eventRepo';
import { uiPreferenceRepo } from './db/repo/uiPreferenceRepo';
import type { Event, EventGroup } from './db/schema';
import { toastState } from './toast.svelte';
import { parseLocalDate } from './utils/format';

function pruneGroupOrder(storageKey: string, deletedId: string) {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const next = parsed.filter((id) => id !== deletedId);
          const nextJson = JSON.stringify(next);
          localStorage.setItem(storageKey, nextJson);
          uiPreferenceRepo.set(storageKey, nextJson).catch(() => {});
        }
      }
    }
  } catch {}
}

const DAY_MS = 86400000;

function createEventStore() {
  let events = $state<Event[]>([]);
  let eventGroups = $state<EventGroup[]>([]);
  let initialized = $state(false);
  let targetEventId = $state<string | null>(null);
  let fetchPromise: Promise<void> | null = null;

  return {
    get eventGroups() {
      return eventGroups;
    },
    get events() {
      return events;
    },
    get isInitialized() {
      return initialized;
    },
    get targetEventId() {
      return targetEventId;
    },
    set targetEventId(val: string | null) {
      targetEventId = val ? String(val) : null;
    },

    selectEventFromNotification(eventId: string) {
      try {
        targetEventId = eventId ? String(eventId) : null;
      } catch {}
    },

    notifyMissingEvent() {
      try {
        toastState.add('info', 'Event no longer exists');
      } catch {}
    },

    async fetchAll() {
      if (fetchPromise) return fetchPromise;
      fetchPromise = (async () => {
        try {
          const [fetchedEvents, fetchedGroups] = await Promise.all([
            eventRepo.getAll(),
            eventGroupRepo.getAll(),
          ]);
          const groupMap = new Map<string, EventGroup>();
          const seenNames = new Set<string>();
          for (let i = 0; i < fetchedGroups.length; i++) {
            const g = fetchedGroups[i];
            if (g && g.id) {
              const nameKey = g.name.trim().toLowerCase();
              if (!groupMap.has(g.id) && !seenNames.has(nameKey)) {
                groupMap.set(g.id, g);
                seenNames.add(nameKey);
              }
            }
          }
          const uniqueGroups = Array.from(groupMap.values());
          eventGroups = uniqueGroups;
          const groupIds = new Set(uniqueGroups.map((g) => g.id));
          events = fetchedEvents.map((e) =>
            e.groupId && e.groupId !== 'GOOGLE_CALENDAR' && !groupIds.has(e.groupId)
              ? { ...e, groupId: null }
              : e
          );
          initialized = true;
          eventGroupRepo.sanitizeOrphans().catch(() => {});
        } catch {
          initialized = true;
          toastState.add('error', 'Failed to fetch events');
        } finally {
          fetchPromise = null;
        }
      })();
      return fetchPromise;
    },

    async addGroup(group: EventGroup) {
      if (!group || !group.id) return;
      const cleanName = group.name?.trim().toLowerCase();
      if (cleanName && eventGroups.some((g) => g.id !== group.id && g.name.trim().toLowerCase() === cleanName)) {
        toastState.add('error', 'Group name already exists. Please choose a different name.');
        return;
      }
      const prev = [...eventGroups];
      try {
        eventGroups = [...eventGroups, group];
        await eventGroupRepo.create(group);
        toastState.add('success', 'Group created');
      } catch {
        eventGroups = prev;
        toastState.add('error', 'Failed to create group');
      }
    },

    async updateGroup(id: string, data: Partial<EventGroup>) {
      if (!id || !data) return;
      if (data.name) {
        const cleanName = data.name.trim().toLowerCase();
        if (eventGroups.some((g) => g.id !== id && g.name.trim().toLowerCase() === cleanName)) {
          toastState.add('error', 'Group name already exists. Please choose a different name.');
          return;
        }
      }
      const idx = eventGroups.findIndex((g) => g.id === id);
      if (idx === -1) return;
      const original = eventGroups[idx];
      const payload: Partial<EventGroup> = { ...data, updatedAt: Date.now() };
      eventGroups[idx] = { ...original, ...payload };
      try {
        await eventGroupRepo.update(id, payload);
        toastState.add('success', 'Group updated');
      } catch {
        const currentIdx = eventGroups.findIndex((g) => g.id === id);
        if (currentIdx !== -1) eventGroups[currentIdx] = original;
        toastState.add('error', 'Failed to update group');
      }
    },

    async deleteGroup(id: string) {
      if (!id) return;
      const prevGroups = [...eventGroups];
      const prevEvents = [...events];
      const filteredGroups = eventGroups.filter((g) => g.id !== id);
      if (filteredGroups.length === prevGroups.length) return;

      eventGroups = filteredGroups;
      events = events.map((e) => (e.groupId === id ? { ...e, groupId: null } : e));

      try {
        await eventGroupRepo.delete(id);
        pruneGroupOrder('personal_os_event_group_order', id);
        toastState.add('success', 'Group deleted');
      } catch {
        eventGroups = prevGroups;
        events = prevEvents;
        toastState.add('error', 'Failed to delete group');
      }
    },

    async addEvent(event: Event) {
      try {
        if (!event || !event.id) return;
        if (event.title && event.title.length > 255) {
          toastState.add('error', 'Event title exceeds 255 characters limit');
          return;
        }
        if (event.description && event.description.length > 5000) {
          toastState.add('error', 'Event description exceeds 5,000 characters limit');
          return;
        }
        const prev = [...events];
        events = [...events, event];
        try {
          await eventRepo.create(event);
          toastState.add('success', 'Event created');
        } catch {
          events = prev;
          toastState.add('error', 'Failed to create event');
        }
      } catch {
        toastState.add('error', 'Failed to create event');
      }
    },

    async updateEvent(id: string, data: Partial<Event>, silent: boolean = false) {
      try {
        if (!id || !data) return;
        if (data.title && data.title.length > 255) {
          toastState.add('error', 'Event title exceeds 255 characters limit');
          return;
        }
        if (data.description && data.description.length > 5000) {
          toastState.add('error', 'Event description exceeds 5,000 characters limit');
          return;
        }
        const payload: Partial<Event> = { ...data, updatedAt: Date.now() };
        const idx = events.findIndex((e) => e.id === id);
        const originalItem = idx !== -1 ? events[idx] : null;
        if (idx !== -1 && originalItem) {
          events[idx] = { ...originalItem, ...payload };
        }
        try {
          await eventRepo.update(id, payload);
          if (!silent) toastState.add('success', 'Event updated');
        } catch {
          if (originalItem) {
            const currentIdx = events.findIndex((e) => e.id === id);
            if (currentIdx !== -1) events[currentIdx] = originalItem;
          }
          toastState.add('error', 'Failed to update event');
        }
      } catch {
        toastState.add('error', 'Failed to update event');
      }
    },

    async deleteEvent(id: string) {
      try {
        if (!id) return;
        const prev = [...events];
        events = events.filter((e) => e.id !== id);
        try {
          await eventRepo.delete(id);
          toastState.add('success', 'Event deleted');
        } catch {
          events = prev;
          toastState.add('error', 'Failed to delete event');
        }
      } catch {
        toastState.add('error', 'Failed to delete event');
      }
    },

    async deleteMany(ids: string[]) {
      try {
        if (!ids || ids.length === 0) return;
        const targetIdsSet = new Set(ids);
        const prev = [...events];
        events = events.filter((e) => !targetIdsSet.has(e.id));
        try {
          await eventRepo.deleteMany(ids);
          toastState.add('success', `${ids.length} event(s) deleted`);
        } catch {
          events = prev;
          toastState.add('error', 'Failed to delete events');
        }
      } catch {
        toastState.add('error', 'Failed to delete events');
      }
    },

    async cleanupAuto(retentionDays: number) {
      try {
        const days = Number(retentionDays);
        if (!Number.isFinite(days) || days <= 0) return;
        const retentionMs = days * DAY_MS;
        const now = Date.now();

        const idsToDelete: string[] = [];
        for (let i = 0, len = events.length; i < len; i++) {
          const e = events[i];
          if (e.recurrence && e.recurrence !== 'NONE') continue;

          let endMs = e.createdAt;
          if (e.endTime) {
            const d = parseLocalDate(e.endTime);
            if (!e.endTime.includes('T')) d.setHours(23, 59, 59, 999);
            endMs = d.getTime();
          } else if (e.startTime) {
            const d = parseLocalDate(e.startTime);
            if (!e.startTime.includes('T')) d.setHours(23, 59, 59, 999);
            endMs = d.getTime();
          }

          if (now - endMs > retentionMs) {
            idsToDelete.push(e.id);
          }
        }

        if (idsToDelete.length > 0) {
          const idSet = new Set(idsToDelete);
          try {
            await eventRepo.deleteMany(idsToDelete);
            events = events.filter((e) => !idSet.has(e.id));
          } catch {}
        }
      } catch {}
    },

    async syncExternalEvents(source: string, externalEvents: Event[]) {
      try {
        if (!source || !Array.isArray(externalEvents)) return;

        const existingByExternalId = new Map<string, Event>();
        const existingSourceEvents: Event[] = [];

        for (let i = 0, len = events.length; i < len; i++) {
          const ev = events[i];
          if (ev.source === source) {
            existingSourceEvents.push(ev);
            if (ev.externalId) {
              existingByExternalId.set(ev.externalId, ev);
            }
          }
        }

        const toAdd: Event[] = [];
        const toUpdate: Event[] = [];
        const updatedById = new Map<string, Event>();
        const externalIdsSeen = new Set<string>();

        for (let i = 0, len = externalEvents.length; i < len; i++) {
          const extEvent = externalEvents[i];
          if (!extEvent || !extEvent.externalId) continue;
          if (externalIdsSeen.has(extEvent.externalId)) continue;
          externalIdsSeen.add(extEvent.externalId);

          const existing = existingByExternalId.get(extEvent.externalId);
          if (existing) {
            const merged: Event = {
              ...extEvent,
              id: existing.id,
              createdAt: existing.createdAt,
            };
            toUpdate.push(merged);
            updatedById.set(existing.id, merged);
          } else {
            toAdd.push(extEvent);
          }
        }

        const toDeleteIds: string[] = [];
        const toDeleteSet = new Set<string>();
        for (let i = 0, len = existingSourceEvents.length; i < len; i++) {
          const existing = existingSourceEvents[i];
          if (existing.externalId && !externalIdsSeen.has(existing.externalId)) {
            toDeleteIds.push(existing.id);
            toDeleteSet.add(existing.id);
          }
        }

        if (toDeleteIds.length > 0) {
          await eventRepo.deleteMany(toDeleteIds);
        }

        if (toUpdate.length > 0) {
          await Promise.all(toUpdate.map((update) => eventRepo.update(update.id, update)));
        }

        if (toAdd.length > 0) {
          await Promise.all(toAdd.map((add) => eventRepo.create(add)));
        }

        const nextEvents: Event[] = [];
        for (let i = 0, len = events.length; i < len; i++) {
          const ev = events[i];
          if (toDeleteSet.has(ev.id)) continue;
          const updated = updatedById.get(ev.id);
          nextEvents.push(updated !== undefined ? updated : ev);
        }
        for (let i = 0, len = toAdd.length; i < len; i++) {
          nextEvents.push(toAdd[i]);
        }

        events = nextEvents;
      } catch (err) {
        toastState.add('error', 'Failed to sync external events');
        throw err;
      }
    },
  };
}

export const eventStore = createEventStore();

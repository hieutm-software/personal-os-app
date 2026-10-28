import { eventStore } from './eventStore.svelte';
import { taskStore } from './taskStore.svelte';

export interface NotificationItem {
  id: string;
  type: 'calendar' | 'task' | 'system';
  title: string;
  message: string;
  time: string;
  isRead: boolean;
  linkModule: 'calendar' | 'tasks' | 'dashboard';
  targetId?: string;
  taskFilter?: 'ALL' | 'PENDING' | 'OVERDUE' | 'COMPLETED';
  severity?: 'info' | 'warning' | 'error';
}

const ONE_HOUR_MS = 3600000;
const ONE_DAY_MS = 86400000;

const EVENT_TIME_FORMATTER = new Intl.DateTimeFormat([], {
  hour: '2-digit',
  minute: '2-digit',
});

const TASK_DATE_FORMATTER = new Intl.DateTimeFormat([], {
  month: 'short',
  day: 'numeric',
});

class NotificationCenterStore {
  notifications = $state<NotificationItem[]>([]);
  readIds = $state<Set<string>>(new Set());

  unreadCount = $derived.by(() => {
    let count = 0;
    const list = this.notifications;
    for (let i = 0, len = list.length; i < len; i++) {
      if (!list[i].isRead) count++;
    }
    return count;
  });

  markAsRead(id: string) {
    if (!id || this.readIds.has(id)) return;
    const nextReadIds = new Set(this.readIds);
    nextReadIds.add(id);
    this.readIds = nextReadIds;

    const idx = this.notifications.findIndex((n) => n.id === id);
    if (idx !== -1 && !this.notifications[idx].isRead) {
      this.notifications[idx] = { ...this.notifications[idx], isRead: true };
    }
  }

  markAllAsRead() {
    if (this.notifications.length === 0) return;
    const nextReadIds = new Set(this.readIds);
    let changed = false;
    const nextList = this.notifications.map((n) => {
      nextReadIds.add(n.id);
      if (!n.isRead) {
        changed = true;
        return { ...n, isRead: true };
      }
      return n;
    });
    this.readIds = nextReadIds;
    if (changed) {
      this.notifications = nextList;
    }
  }

  refresh() {
    try {
      const unreadList: NotificationItem[] = [];
      const readList: NotificationItem[] = [];
      const activeIds = new Set<string>();
      const now = Date.now();

      if (!eventStore.isInitialized) {
        eventStore.fetchAll();
      }

      const events = eventStore.events;
      for (let i = 0, len = events.length; i < len; i++) {
        const event = events[i];
        if (!event || event.recurrence === 'DAILY' || !event.startTime) continue;

        const startTimeMs = Date.parse(event.startTime);
        if (Number.isNaN(startTimeMs)) continue;

        const endTimeMs = event.endTime ? Date.parse(event.endTime) : startTimeMs + ONE_HOUR_MS;
        if (!Number.isNaN(endTimeMs)) {
          if (now >= endTimeMs) continue;
        } else if (now >= startTimeMs + ONE_DAY_MS) {
          continue;
        }

        const oneDayBefore = startTimeMs - ONE_DAY_MS;
        if (now < oneDayBefore) continue;

        const oneHourBefore = startTimeMs - ONE_HOUR_MS;
        let id = '';
        let title = '';
        let severity: 'info' | 'warning' | 'error' = 'info';

        if (now >= startTimeMs) {
          id = `event-${event.id}-happening`;
          title = 'Happening Now';
          severity = 'warning';
        } else if (now >= oneHourBefore) {
          id = `event-${event.id}-urgent`;
          title = 'Starting Soon';
          severity = 'warning';
        } else {
          id = `event-${event.id}-upcoming`;
          title = 'Upcoming Event';
          severity = 'info';
        }

        activeIds.add(id);
        const isRead = this.readIds.has(id);
        const item: NotificationItem = {
          id,
          targetId: event.id,
          type: 'calendar',
          title,
          message: event.title,
          severity,
          time: EVENT_TIME_FORMATTER.format(new Date(startTimeMs)),
          isRead,
          linkModule: 'calendar',
        };

        if (isRead) readList.push(item);
        else unreadList.push(item);
      }

      if (!taskStore.isInitialized) {
        taskStore.fetchAll();
      }

      const tasks = taskStore.tasks;
      for (let i = 0, len = tasks.length; i < len; i++) {
        const task = tasks[i];
        if (!task || task.status !== 'PENDING' || task.dueDate == null) continue;

        const dueDateMs = task.dueDate;
        const oneDayBefore = dueDateMs - ONE_DAY_MS;
        if (now < oneDayBefore) continue;

        const oneHourBefore = dueDateMs - ONE_HOUR_MS;
        let id = '';
        let title = '';
        let severity: 'info' | 'warning' | 'error' = 'info';
        let taskFilter: 'OVERDUE' | 'PENDING' = 'PENDING';

        if (now >= dueDateMs) {
          id = `task-${task.id}-overdue`;
          title = 'Task Overdue';
          severity = 'error';
          taskFilter = 'OVERDUE';
        } else if (now >= oneHourBefore) {
          id = `task-${task.id}-urgent`;
          title = 'Deadline Soon';
          severity = 'warning';
        } else {
          id = `task-${task.id}-upcoming`;
          title = 'Deadline Approaching';
          severity = 'info';
        }

        activeIds.add(id);
        const isRead = this.readIds.has(id);
        const item: NotificationItem = {
          id,
          targetId: task.id,
          taskFilter,
          type: 'task',
          title,
          message: task.title,
          severity,
          time: TASK_DATE_FORMATTER.format(new Date(dueDateMs)),
          isRead,
          linkModule: 'tasks',
        };

        if (isRead) readList.push(item);
        else unreadList.push(item);
      }

      if (this.readIds.size > 0 && eventStore.isInitialized && taskStore.isInitialized) {
        let pruned = false;
        for (const readId of this.readIds) {
          if (!activeIds.has(readId)) {
            pruned = true;
            break;
          }
        }
        if (pruned) {
          const nextReadIds = new Set<string>();
          for (const readId of this.readIds) {
            if (activeIds.has(readId)) nextReadIds.add(readId);
          }
          this.readIds = nextReadIds;
        }
      }

      this.notifications = unreadList.concat(readList);
    } catch {}
  }
}

export const notificationCenterStore = new NotificationCenterStore();

import { taskRepo, taskGroupRepo } from './db/repo/taskRepo';
import { uiPreferenceRepo } from './db/repo/uiPreferenceRepo';
import type { Task, TaskGroup } from './db/schema';
import { toastState } from './toast.svelte';

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
const DEBOUNCE_MS = 300;

function createTaskStore() {
  let tasks = $state<Task[]>([]);
  let taskGroups = $state<TaskGroup[]>([]);
  let stats = $state({ pending: 0, completed: 0, total: 0 });
  let initialized = $state(false);
  let fetchPromise: Promise<void> | null = null;

  let targetFilter = $state<string | null>(null);
  let targetTaskId = $state<string | null>(null);

  const updateDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingUpdates = new Map<string, Partial<Task>>();
  const initialTaskStates = new Map<string, Task>();
  const initialStatsStates = new Map<string, { pending: number; completed: number; total: number }>();

  function cancelPendingUpdate(id: string) {
    const timer = updateDebounceTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      updateDebounceTimers.delete(id);
    }
    pendingUpdates.delete(id);
    initialTaskStates.delete(id);
    initialStatsStates.delete(id);
  }

  function cancelAllPendingUpdates() {
    for (const [, timer] of updateDebounceTimers) {
      clearTimeout(timer);
    }
    updateDebounceTimers.clear();
    pendingUpdates.clear();
    initialTaskStates.clear();
    initialStatsStates.clear();
  }

  return {
    get tasks() {
      return tasks;
    },
    get taskGroups() {
      return taskGroups;
    },
    get stats() {
      return stats;
    },
    get isInitialized() {
      return initialized;
    },
    get targetFilter() {
      return targetFilter;
    },
    set targetFilter(val: string | null) {
      targetFilter = val ? String(val) : null;
    },
    get targetTaskId() {
      return targetTaskId;
    },
    set targetTaskId(val: string | null) {
      targetTaskId = val ? String(val) : null;
    },

    selectTaskFromNotification(filter: string, taskId: string) {
      targetFilter = filter ? String(filter) : null;
      targetTaskId = taskId ? String(taskId) : null;
    },

    notifyMissingTask() {
      try {
        toastState.add('info', 'Task no longer exists');
      } catch {}
    },

    async fetchAll() {
      if (fetchPromise) return fetchPromise;
      fetchPromise = (async () => {
        try {
          const [allTasks, allGroups, pendingCount, completedCount] = await Promise.all([
            taskRepo.getAll(),
            taskGroupRepo.getAll(),
            taskRepo.getCountByStatus('PENDING'),
            taskRepo.getCountByStatus('COMPLETED'),
          ]);
          const groupMap = new Map<string, TaskGroup>();
          const seenKeys = new Set<string>();
          for (let i = 0; i < allGroups.length; i++) {
            const g = allGroups[i];
            if (g && g.id) {
              const key = `${g.parentId || 'root'}:::${g.name.trim().toLowerCase()}`;
              if (!groupMap.has(g.id) && !seenKeys.has(key)) {
                groupMap.set(g.id, g);
                seenKeys.add(key);
              }
            }
          }
          const uniqueGroups = Array.from(groupMap.values());
          taskGroups = uniqueGroups;
          const groupIds = new Set(uniqueGroups.map((g) => g.id));
          tasks = allTasks.map((t) => (t.groupId && !groupIds.has(t.groupId) ? { ...t, groupId: null } : t));
          stats.pending = pendingCount;
          stats.completed = completedCount;
          stats.total = pendingCount + completedCount;
          initialized = true;
          taskGroupRepo.sanitizeOrphans().catch(() => {});
        } catch {
          initialized = true;
          toastState.add('error', 'Failed to fetch tasks');
        } finally {
          fetchPromise = null;
        }
      })();
      return fetchPromise;
    },

    async addGroup(group: TaskGroup) {
      if (!group || !group.id) return;
      const cleanName = group.name?.trim().toLowerCase();
      if (cleanName && taskGroups.some((g) => g.id !== group.id && g.name.trim().toLowerCase() === cleanName)) {
        toastState.add('error', 'Group name already exists. Please choose a different name.');
        return;
      }
      try {
        await taskGroupRepo.create(group);
        taskGroups = [...taskGroups, group];
        toastState.add('success', 'Group created');
      } catch (err) {
        toastState.add('error', 'Failed to create group');
        throw err;
      }
    },

    async updateGroup(id: string, data: Partial<TaskGroup>) {
      if (!id || !data) return;
      if (data.name) {
        const cleanName = data.name.trim().toLowerCase();
        if (taskGroups.some((g) => g.id !== id && g.name.trim().toLowerCase() === cleanName)) {
          toastState.add('error', 'Group name already exists. Please choose a different name.');
          return;
        }
      }
      const idx = taskGroups.findIndex((g) => g.id === id);
      if (idx === -1) return;
      const original = taskGroups[idx];
      const payload: Partial<TaskGroup> = { ...data, updatedAt: Date.now() };
      taskGroups[idx] = { ...original, ...payload };
      try {
        await taskGroupRepo.update(id, payload);
        toastState.add('success', 'Group updated');
      } catch {
        const curIdx = taskGroups.findIndex((g) => g.id === id);
        if (curIdx !== -1) taskGroups[curIdx] = original;
        toastState.add('error', 'Failed to update group');
      }
    },

    async deleteGroup(id: string) {
      if (!id) return;
      const prevGroups = [...taskGroups];
      const prevTasks = [...tasks];

      const deletedGroupIds = new Set<string>([id]);
      let foundMore = true;
      while (foundMore) {
        foundMore = false;
        for (const g of taskGroups) {
          if (g.parentId && deletedGroupIds.has(g.parentId) && !deletedGroupIds.has(g.id)) {
            deletedGroupIds.add(g.id);
            foundMore = true;
          }
        }
      }

      for (const t of tasks) {
        if (t.groupId && deletedGroupIds.has(t.groupId)) {
          cancelPendingUpdate(t.id);
        }
      }

      taskGroups = taskGroups.filter((g) => !deletedGroupIds.has(g.id));
      tasks = tasks.map((t) => (t.groupId && deletedGroupIds.has(t.groupId) ? { ...t, groupId: null } : t));

      try {
        await taskGroupRepo.delete(id);
        for (const gid of deletedGroupIds) {
          pruneGroupOrder('personal_os_task_group_order', gid);
          pruneGroupOrder('dashboard_task_group_order', gid);
          pruneGroupOrder('dashboard_task_expanded_groups', gid);
          pruneGroupOrder('personal_os_task_expanded_parents', gid);
        }
        toastState.add('success', 'Group and dependent subgroups deleted');
      } catch {
        taskGroups = prevGroups;
        tasks = prevTasks;
        toastState.add('error', 'Failed to delete group');
      }
    },

    async addTask(task: Task) {
      try {
        if (!task || !task.id) return;
        if (task.dueDate == null || Number.isNaN(task.dueDate)) {
          toastState.add('error', 'Deadline is required for all tasks');
          return;
        }
        if (task.title && task.title.length > 255) {
          toastState.add('error', 'Task title exceeds 255 characters limit');
          return;
        }
        if (task.description && task.description.length > 5000) {
          toastState.add('error', 'Task description exceeds 5,000 characters limit');
          return;
        }
        const prev = [...tasks];
        const prevStats = { ...stats };

        tasks = [...tasks, task];
        if (task.status === 'COMPLETED') {
          stats.completed += 1;
        } else {
          stats.pending += 1;
        }
        stats.total += 1;

        try {
          await taskRepo.create(task);
          toastState.add('success', 'Task created');
        } catch {
          tasks = prev;
          stats = prevStats;
          toastState.add('error', 'Failed to create task');
        }
      } catch {
        toastState.add('error', 'Failed to create task');
      }
    },

    async updateTask(id: string, data: Partial<Task>, silent: boolean = false) {
      try {
        if (!id || !data) return;
        if (data.dueDate !== undefined && (data.dueDate == null || Number.isNaN(data.dueDate))) {
          toastState.add('error', 'Deadline is required and cannot be removed');
          return;
        }
        if (data.title && data.title.length > 255) {
          toastState.add('error', 'Task title exceeds 255 characters limit');
          return;
        }
        if (data.description && data.description.length > 5000) {
          toastState.add('error', 'Task description exceeds 5,000 characters limit');
          return;
        }

        const index = tasks.findIndex((t) => t.id === id);
        if (index === -1) return;

        const payload: Partial<Task> = { ...data, updatedAt: Date.now() };

        if (!initialTaskStates.has(id)) {
          initialTaskStates.set(id, { ...tasks[index] });
          initialStatsStates.set(id, { ...stats });
        }

        const oldStatus = tasks[index].status;
        tasks[index] = { ...tasks[index], ...payload };

        if (payload.status && oldStatus !== payload.status) {
          if (oldStatus === 'COMPLETED') stats.completed -= 1;
          else stats.pending -= 1;

          if (payload.status === 'COMPLETED') stats.completed += 1;
          else stats.pending += 1;
        }

        if (!silent) {
          toastState.add('success', 'Task updated');
        }

        const existingPending = pendingUpdates.get(id);
        pendingUpdates.set(id, existingPending ? { ...existingPending, ...payload } : payload);

        const existingTimer = updateDebounceTimers.get(id);
        if (existingTimer !== undefined) {
          clearTimeout(existingTimer);
        }

        updateDebounceTimers.set(
          id,
          setTimeout(async () => {
            updateDebounceTimers.delete(id);
            const dataToSave = pendingUpdates.get(id);
            const prevTaskState = initialTaskStates.get(id);
            const prevStats = initialStatsStates.get(id);
            pendingUpdates.delete(id);
            initialTaskStates.delete(id);
            initialStatsStates.delete(id);

            if (dataToSave) {
              try {
                await taskRepo.update(id, dataToSave);
              } catch {
                if (prevTaskState) {
                  const curIdx = tasks.findIndex((t) => t.id === id);
                  if (curIdx !== -1) tasks[curIdx] = prevTaskState;
                }
                if (prevStats) {
                  stats.pending = prevStats.pending;
                  stats.completed = prevStats.completed;
                  stats.total = prevStats.total;
                }
                toastState.add('error', 'Failed to update task');
              }
            }
          }, DEBOUNCE_MS)
        );
      } catch {
        toastState.add('error', 'Failed to update task');
      }
    },

    async deleteTask(id: string) {
      if (!id) return;
      cancelPendingUpdate(id);
      const prev = [...tasks];
      const prevStats = { ...stats };

      const remaining: Task[] = [];
      for (let i = 0, len = tasks.length; i < len; i++) {
        const t = tasks[i];
        if (t.id === id) {
          if (t.status === 'COMPLETED') stats.completed -= 1;
          else stats.pending -= 1;
          stats.total -= 1;
        } else {
          remaining.push(t);
        }
      }

      tasks = remaining;
      try {
        await taskRepo.delete(id);
        toastState.add('success', 'Task deleted');
      } catch {
        tasks = prev;
        stats = prevStats;
        toastState.add('error', 'Failed to delete task');
      }
    },

    async deleteMany(ids: string[]) {
      if (!ids || ids.length === 0) return;
      const targetIdsSet = new Set(ids);
      const prev = [...tasks];
      const prevStats = { ...stats };

      const remaining: Task[] = [];
      let deletedPending = 0;
      let deletedCompleted = 0;

      for (let i = 0, len = tasks.length; i < len; i++) {
        const t = tasks[i];
        if (targetIdsSet.has(t.id)) {
          cancelPendingUpdate(t.id);
          if (t.status === 'COMPLETED') deletedCompleted++;
          else deletedPending++;
        } else {
          remaining.push(t);
        }
      }

      const deletedTotal = deletedPending + deletedCompleted;
      if (deletedTotal === 0) return;

      tasks = remaining;
      stats.pending -= deletedPending;
      stats.completed -= deletedCompleted;
      stats.total -= deletedTotal;

      try {
        await taskRepo.deleteMany(ids);
        toastState.add('success', `${ids.length} task(s) deleted`);
      } catch {
        tasks = prev;
        stats = prevStats;
        toastState.add('error', 'Failed to delete tasks');
      }
    },

    async cleanupAuto(retentionDays: number) {
      const days = Number(retentionDays);
      if (!Number.isFinite(days) || days <= 0) return;
      const retentionMs = days * DAY_MS;
      const threshold = Date.now() - retentionMs;

      const remaining: Task[] = [];
      const deletedIds: string[] = [];
      let recomputePending = 0;
      let recomputeCompleted = 0;

      for (let i = 0, len = tasks.length; i < len; i++) {
        const t = tasks[i];
        if (
          (t.deletedAt != null && t.deletedAt < threshold) ||
          (t.status === 'COMPLETED' && t.updatedAt < threshold)
        ) {
          deletedIds.push(t.id);
        } else {
          remaining.push(t);
          if (t.status === 'COMPLETED') recomputeCompleted++;
          else recomputePending++;
        }
      }

      if (deletedIds.length > 0) {
        for (let i = 0, len = deletedIds.length; i < len; i++) {
          cancelPendingUpdate(deletedIds[i]);
        }
        try {
          await taskRepo.cleanupAuto(retentionMs);
          tasks = remaining;
          stats.pending = recomputePending;
          stats.completed = recomputeCompleted;
          stats.total = remaining.length;
        } catch {}
      }
    },
    cancelAllPendingUpdates,
  };
}

export const taskStore = createTaskStore();

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import {
    Bell,
    Calendar,
    CheckSquare,
    Circle,
    CheckCircle,
    Download,
    HardDrive,
    Repeat,
    Upload,
    Zap,
    ChevronDown,
    ChevronUp,
    Cloud,
    GripVertical,
    FileText,
    Folder,
    FolderOpen,
    CornerDownRight,
    Layers,
    WifiOff,
    Check,
    SkipForward
  } from "lucide-svelte";
  import type { Task, Event as CalendarEventItem } from "../../shared/db/schema";
  import { taskStore } from "../../shared/taskStore.svelte";
  import { eventStore } from "../../shared/eventStore.svelte";
  import { uiPreferenceRepo } from "../../shared/db/repo/uiPreferenceRepo";
  import { getDbConnection } from "../../shared/db/client";
  import { toastState } from "../../shared/toast.svelte";
  import { playNotificationSound } from "../../shared/utils/sound";
  import {
    computeEventOccurrence,
    loadEventCompletions,
    STORAGE_KEY_EVENT_COMPLETIONS,
    type EventOccurrence,
    type EventCompletionsMap,
  } from "../calendar/eventOccurrence";
  import Button from "../../shared/ui/Button.svelte";
  import Modal from "../../shared/ui/Modal.svelte";
  import EmptyState from "../../shared/ui/EmptyState.svelte";
  import NotificationCenter from "../../shared/ui/NotificationCenter.svelte";
  import { notificationCenterStore } from "../../shared/notificationCenterStore.svelte";
  import WeatherWidget from "./WeatherWidget.svelte";
  import TaskCountdown from "./TaskCountdown.svelte";
  import EventCountdown from "./EventCountdown.svelte";
  import TaskNoteModal from "../tasks/TaskNoteModal.svelte";

  const STORAGE_KEY_EXPANDED = "dashboard_task_expanded_groups";
  const STORAGE_KEY_COLLAPSED_SUBS = "dashboard_task_collapsed_sub_groups";
  const STORAGE_KEY_ORDER = "dashboard_task_group_order";
  const FALLBACK_KEY_ORDER = "personal_os_task_group_order";
  const STORAGE_KEY_EVENT_TAB = "dashboard_event_tab";

  const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const BADGE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });

  interface SystemMetricsPayload {
    storage_percent: number;
    storage_used_bytes: number;
    storage_total_bytes: number;
    download_bytes_per_sec: number;
    upload_bytes_per_sec: number;
    is_network_connected: boolean;
  }

  let isNotificationOpen = $state(false);

  let storagePercent = $state(0);
  let storageUsedBytes = $state(0);
  let storageTotalBytes = $state(0);
  let dbPingMs = $state(1);
  let dbStatus = $state<"ok" | "error">("ok");
  let downloadSpeed = $state(0);
  let uploadSpeed = $state(0);
  let isBrowserOnline = $state(typeof navigator !== "undefined" ? navigator.onLine : true);
  let isNetworkActive = $state(true);
  let isOnline = $derived(isBrowserOnline && isNetworkActive);
  let isComponentMounted = true;

  function formatNetworkSpeed(bytesPerSec: number): string {
    if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "0 B/s";
    if (bytesPerSec >= 1048576) {
      return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`;
    }
    if (bytesPerSec >= 1024) {
      return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
    }
    return `${Math.round(bytesPerSec)} B/s`;
  }

  function formatBytesToGb(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }

  let storageTooltip = $derived.by(() => {
    if (storageTotalBytes > 0) {
      return `Disk Storage: ${storagePercent}% used (${formatBytesToGb(storageUsedBytes)} / ${formatBytesToGb(storageTotalBytes)})`;
    }
    return `Disk Storage: ${storagePercent}%`;
  });

  let downloadText = $derived(formatNetworkSpeed(downloadSpeed));
  let uploadText = $derived(formatNetworkSpeed(uploadSpeed));

  async function measureDbPing(): Promise<void> {
    try {
      const db = await getDbConnection();
      const startTime = performance.now();
      await db.select("SELECT 1;");
      if (!isComponentMounted) return;
      dbPingMs = Math.max(1, Math.round(performance.now() - startTime));
      dbStatus = "ok";
    } catch {
      if (isComponentMounted) {
        dbStatus = "error";
      }
    }
  }

  async function fetchSystemMetrics(): Promise<void> {
    try {
      const metrics = await invoke<SystemMetricsPayload>("get_system_metrics");
      if (!isComponentMounted) return;
      storagePercent = metrics.storage_percent;
      storageUsedBytes = metrics.storage_used_bytes;
      storageTotalBytes = metrics.storage_total_bytes;
      downloadSpeed = metrics.download_bytes_per_sec;
      uploadSpeed = metrics.upload_bytes_per_sec;
      isNetworkActive = metrics.is_network_connected;
    } catch {}
  }

  onMount(() => {
    isComponentMounted = true;

    measureDbPing();
    fetchSystemMetrics();

    uiPreferenceRepo.get(STORAGE_KEY_EVENT_COMPLETIONS).then((val) => {
      if (val && isComponentMounted) {
        try {
          const parsed = JSON.parse(val);
          if (parsed && typeof parsed === "object") {
            eventCompletions = parsed;
          }
        } catch {}
      }
    }).catch(() => {});

    const metricsInterval = setInterval(() => {
      if (!isComponentMounted) return;
      fetchSystemMetrics();
      measureDbPing();
    }, 2500);

    const handleOnline = () => {
      isBrowserOnline = true;
      fetchSystemMetrics();
    };

    const handleOffline = () => {
      isBrowserOnline = false;
      downloadSpeed = 0;
      uploadSpeed = 0;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      isComponentMounted = false;
      clearInterval(metricsInterval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  });

  let selectedEvent = $state<CalendarEventItem | null>(null);
  let isEventModalOpen = $state(false);

  let selectedNoteTaskId = $state<string | null>(null);
  let selectedNoteTask = $derived(
    selectedNoteTaskId ? taskStore.tasks.find((t) => t.id === selectedNoteTaskId) ?? null : null
  );
  let isNoteModalOpen = $state(false);

  function openTaskNote(event: MouseEvent, task: Task) {
    event.stopPropagation();
    selectedNoteTaskId = task.id;
    isNoteModalOpen = true;
  }

  let activeDragCleanup: (() => void) | null = null;
  let pointerDragResetTimer: ReturnType<typeof setTimeout> | null = null;

  onDestroy(() => {
    isComponentMounted = false;
    try {
      if (activeDragCleanup) {
        activeDragCleanup();
        activeDragCleanup = null;
      }
      if (pointerDragResetTimer !== null) {
        clearTimeout(pointerDragResetTimer);
        pointerDragResetTimer = null;
      }
    } catch {}
  });

  function openEventDetails(event: CalendarEventItem) {
    try {
      selectedEvent = event;
      isEventModalOpen = true;
    } catch {}
  }

  $effect(() => {
    try {
      if (!taskStore.isInitialized) taskStore.fetchAll().catch(() => {});
      if (!eventStore.isInitialized) eventStore.fetchAll().catch(() => {});
    } catch {}
  });

  let eventCompletions = $state<EventCompletionsMap>(loadEventCompletions());

  function saveEventCompletions(next: EventCompletionsMap) {
    eventCompletions = next;
    try {
      const raw = JSON.stringify(next);
      localStorage.setItem(STORAGE_KEY_EVENT_COMPLETIONS, raw);
      uiPreferenceRepo.set(STORAGE_KEY_EVENT_COMPLETIONS, raw).catch(() => {});
    } catch {}
  }

  function markEventAttended(event: CalendarEventItem, occurrenceKey: string) {
    try {
      const next: EventCompletionsMap = { ...eventCompletions };
      if (!next[event.id]) next[event.id] = {};
      next[event.id] = { ...next[event.id], [occurrenceKey]: "attended" };
      saveEventCompletions(next);
      playNotificationSound();

      const occ = computeEventOccurrence(event, next);
      if (occ.isRecurring) {
        const nextDateStr = BADGE_DATE_FORMATTER.format(occ.start);
        toastState.add("success", `Attended! Advanced to next occurrence (${nextDateStr}).`);
      } else {
        toastState.add("success", "Event marked as attended!");
      }
    } catch {}
  }

  function markEventSkipped(event: CalendarEventItem, occurrenceKey: string) {
    try {
      const next: EventCompletionsMap = { ...eventCompletions };
      if (!next[event.id]) next[event.id] = {};
      next[event.id] = { ...next[event.id], [occurrenceKey]: "skipped" };
      saveEventCompletions(next);
      playNotificationSound();

      const occ = computeEventOccurrence(event, next);
      if (occ.isRecurring) {
        const nextDateStr = BADGE_DATE_FORMATTER.format(occ.start);
        toastState.add("info", `Skipped! Advanced to next occurrence (${nextDateStr}).`);
      } else {
        toastState.add("info", "Event skipped.");
      }
    } catch {}
  }

  function toggleEventAttendance(event: CalendarEventItem, occurrenceKey: string) {
    try {
      const next: EventCompletionsMap = { ...eventCompletions };
      if (!next[event.id]) next[event.id] = {};
      const current = next[event.id][occurrenceKey];
      if (current === "attended") {
        const subMap = { ...next[event.id] };
        delete subMap[occurrenceKey];
        next[event.id] = subMap;
        toastState.add("info", "Event attendance unmarked.");
      } else {
        next[event.id] = { ...next[event.id], [occurrenceKey]: "attended" };
        toastState.add("success", "Event marked as attended!");
      }
      saveEventCompletions(next);
      playNotificationSound();
    } catch {}
  }

  function formatTimeBadge(isoStr: string | null | undefined, isAllDay: boolean): string | null {
    try {
      if (!isoStr || isAllDay || !isoStr.includes("T")) return null;
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return null;
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    } catch {
      return null;
    }
  }

  function getTaskDueBadges(dueDate: number | null | undefined): { dateStr: string | null; timeStr: string | null } {
    try {
      if (!dueDate) return { dateStr: null, timeStr: null };
      const d = new Date(dueDate);
      if (Number.isNaN(d.getTime())) return { dateStr: null, timeStr: null };
      const dateStr = BADGE_DATE_FORMATTER.format(d);
      const isDateOnly = d.getHours() === 23 && d.getMinutes() === 59 && d.getSeconds() === 59;
      if (isDateOnly) {
        return { dateStr, timeStr: null };
      }
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      return { dateStr, timeStr: `${hours}:${minutes}` };
    } catch {
      return { dateStr: null, timeStr: null };
    }
  }

  let partitionedTasks = $derived.by(() => {
    try {
      const pending: Task[] = [];
      const completed: Task[] = [];
      const allTasks = taskStore.tasks;
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        if (t.status === "PENDING") {
          pending.push(t);
        } else if (t.status === "COMPLETED") {
          completed.push(t);
        }
      }

      pending.sort((a, b) => {
        const hasDueA = a.dueDate !== null && a.dueDate !== undefined;
        const hasDueB = b.dueDate !== null && b.dueDate !== undefined;

        if (hasDueA && hasDueB) {
          if (a.dueDate! !== b.dueDate!) {
            return a.dueDate! - b.dueDate!;
          }
          return a.createdAt - b.createdAt;
        }
        if (hasDueA) return -1;
        if (hasDueB) return 1;
        return a.createdAt - b.createdAt;
      });

      completed.sort((a, b) => b.createdAt - a.createdAt);

      return { pending, completed };
    } catch {
      return { pending: [] as Task[], completed: [] as Task[] };
    }
  });

  let taskTab = $state<"pending" | "completed">("pending");
  let displayedTasks = $derived(taskTab === "pending" ? partitionedTasks.pending : partitionedTasks.completed);

  function getInitialExpandedGroups(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_EXPANDED);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((item): item is string => typeof item === "string"));
        }
      }
    } catch {}
    return new Set();
  }

  function getInitialGroupOrder(): string[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ORDER) || localStorage.getItem(FALLBACK_KEY_ORDER);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === "string");
        }
      }
    } catch {}
    return [];
  }

  let expandedGroups = $state<Set<string>>(getInitialExpandedGroups());
  let groupOrder = $state<string[]>(getInitialGroupOrder());

  $effect(() => {
    let active = true;
    const loadDashboardPrefs = async () => {
      try {
        const [dbExpanded, dbOrder] = await Promise.all([
          uiPreferenceRepo.get(STORAGE_KEY_EXPANDED),
          uiPreferenceRepo.get(STORAGE_KEY_ORDER)
        ]);
        if (!active) return;
        if (dbExpanded) {
          try {
            const parsed = JSON.parse(dbExpanded);
            if (Array.isArray(parsed)) {
              expandedGroups = new Set(parsed.filter((item): item is string => typeof item === "string"));
              localStorage.setItem(STORAGE_KEY_EXPANDED, dbExpanded);
            }
          } catch {}
        } else {
          expandedGroups = getInitialExpandedGroups();
        }
        if (dbOrder) {
          try {
            const parsed = JSON.parse(dbOrder);
            if (Array.isArray(parsed)) {
              groupOrder = parsed.filter((item): item is string => typeof item === "string");
              localStorage.setItem(STORAGE_KEY_ORDER, dbOrder);
            }
          } catch {}
        } else {
          try {
            const fallbackOrder = await uiPreferenceRepo.get(FALLBACK_KEY_ORDER);
            if (!active) return;
            if (fallbackOrder) {
              const parsed = JSON.parse(fallbackOrder);
              if (Array.isArray(parsed)) {
                groupOrder = parsed.filter((item): item is string => typeof item === "string");
                return;
              }
            }
          } catch {}
          groupOrder = getInitialGroupOrder();
        }
      } catch {}
    };
    loadDashboardPrefs();
    const onRestored = () => {
      loadDashboardPrefs();
    };
    window.addEventListener("backup-restored", onRestored);
    return () => {
      active = false;
      window.removeEventListener("backup-restored", onRestored);
    };
  });

  function saveExpandedGroups(list: string[]) {
    try {
      const json = JSON.stringify(list);
      localStorage.setItem(STORAGE_KEY_EXPANDED, json);
      uiPreferenceRepo.set(STORAGE_KEY_EXPANDED, json).catch(() => {});
    } catch {}
  }

  function saveGroupOrder(order: string[]) {
    groupOrder = order;
    try {
      const json = JSON.stringify(order);
      localStorage.setItem(STORAGE_KEY_ORDER, json);
      uiPreferenceRepo.set(STORAGE_KEY_ORDER, json).catch(() => {});
    } catch {}
  }

  function getInitialCollapsedSubGroups(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COLLAPSED_SUBS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((item): item is string => typeof item === "string"));
        }
      }
    } catch {}
    return new Set();
  }

  let collapsedSubGroups = $state<Set<string>>(getInitialCollapsedSubGroups());

  function toggleSubGroupCollapse(e: Event, subId: string) {
    e.stopPropagation();
    const next = new Set(collapsedSubGroups);
    if (next.has(subId)) {
      next.delete(subId);
    } else {
      next.add(subId);
    }
    collapsedSubGroups = next;
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED_SUBS, JSON.stringify([...next]));
    } catch {}
  }

  function toggleGroupCollapse(groupId: string | null) {
    if (isPointerDragging) return;
    const id = groupId ?? "ungrouped";
    const next = new Set(expandedGroups);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expandedGroups = next;
    saveExpandedGroups([...expandedGroups]);
  }

  function toggleAllGroupCollapse() {
    if (expandedGroups.size > 0) {
      expandedGroups = new Set();
    } else {
      const allIds = groupedDisplayedTasks.map((g) => g.rootId ?? "ungrouped");
      expandedGroups = new Set(allIds);
      collapsedSubGroups = new Set();
      try {
        localStorage.removeItem(STORAGE_KEY_COLLAPSED_SUBS);
      } catch {}
    }
    saveExpandedGroups([...expandedGroups]);
  }

  let isPointerDragging = $state(false);
  let draggedGroupId = $state<string | null>(null);
  let dragOverGroupId = $state<string | null>(null);
  let dropPosition = $state<"above" | "below" | null>(null);

  const trayElements = new Map<string, HTMLElement>();

  function trayAction(node: HTMLElement, id: string) {
    let currentKey = id;
    trayElements.set(currentKey, node);
    return {
      update(newId: string) {
        trayElements.delete(currentKey);
        currentKey = newId;
        trayElements.set(currentKey, node);
      },
      destroy() {
        trayElements.delete(currentKey);
      }
    };
  }

  function handleGripPointerDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (activeDragCleanup) {
      activeDragCleanup();
      activeDragCleanup = null;
    }
    if (pointerDragResetTimer !== null) {
      clearTimeout(pointerDragResetTimer);
      pointerDragResetTimer = null;
    }

    const gripEl = e.currentTarget as HTMLElement | null;
    const pointerId = e.pointerId;
    try {
      gripEl?.setPointerCapture?.(pointerId);
    } catch {}

    isPointerDragging = true;
    draggedGroupId = id;
    dragOverGroupId = null;
    dropPosition = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const clientY = moveEvent.clientY;
      const clientX = moveEvent.clientX;

      let foundId: string | null = null;
      let foundPos: "above" | "below" | null = null;

      for (const [trayId, el] of trayElements.entries()) {
        if (trayId === id) continue;
        const rect = el.getBoundingClientRect();
        if (
          clientY >= rect.top - 16 &&
          clientY <= rect.bottom + 16 &&
          clientX >= rect.left - 60 &&
          clientX <= rect.right + 60
        ) {
          foundId = trayId;
          const midY = rect.top + rect.height / 2;
          foundPos = clientY < midY ? "above" : "below";
          break;
        }
      }

      dragOverGroupId = foundId;
      dropPosition = foundPos;
    };

    const cleanupListeners = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      try {
        gripEl?.releasePointerCapture?.(pointerId);
      } catch {}
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    const onPointerUp = () => {
      cleanupListeners();
      activeDragCleanup = null;

      const sourceId = draggedGroupId;
      const targetId = dragOverGroupId;
      const pos = dropPosition;

      draggedGroupId = null;
      dragOverGroupId = null;
      dropPosition = null;

      pointerDragResetTimer = setTimeout(() => {
        isPointerDragging = false;
        pointerDragResetTimer = null;
      }, 60);

      if (!sourceId || !targetId || sourceId === targetId) return;

      const currentIds = groupedDisplayedTasks.map((g) => g.rootId ?? "ungrouped");
      const fromIndex = currentIds.indexOf(sourceId);
      if (fromIndex === -1) return;

      const newOrder = [...currentIds];
      const [moved] = newOrder.splice(fromIndex, 1);

      let toIndex = newOrder.indexOf(targetId);
      if (toIndex === -1) return;

      if (pos === "below") {
        toIndex += 1;
      }
      newOrder.splice(toIndex, 0, moved);
      saveGroupOrder(newOrder);
    };

    activeDragCleanup = () => {
      cleanupListeners();
      draggedGroupId = null;
      dragOverGroupId = null;
      dropPosition = null;
      isPointerDragging = false;
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  interface DashboardSubGroup {
    subId: string;
    subName: string;
    tasks: Task[];
    earliestDue: number;
    orderIndex: number;
  }

  interface DashboardRootGroup {
    rootId: string | null;
    rootName: string;
    hasSubGroups: boolean;
    subGroups: DashboardSubGroup[];
    directTasks: Task[];
    totalTasksCount: number;
    orderIndex: number;
    earliestDue: number;
  }

  let groupOrderIndexMap = $derived.by(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < groupOrder.length; i++) {
      map.set(groupOrder[i], i);
    }
    return map;
  });

  let groupedDisplayedTasks = $derived.by(() => {
    try {
      const allGroups = taskStore.taskGroups;
      const groupById = new Map<string, (typeof allGroups)[number]>();
      for (let i = 0; i < allGroups.length; i++) {
        groupById.set(allGroups[i].id, allGroups[i]);
      }

      const rootGroupsWithChildrenSet = new Set<string>();
      for (let i = 0; i < allGroups.length; i++) {
        if (allGroups[i].parentId) {
          rootGroupsWithChildrenSet.add(allGroups[i].parentId!);
        }
      }

      const tasks = displayedTasks;
      const rootBuckets = new Map<
        string | null,
        {
          rootId: string | null;
          rootName: string;
          hasSubGroups: boolean;
          subMap: Map<string, DashboardSubGroup>;
          directTasks: Task[];
          earliestDue: number;
          orderIndex: number;
        }
      >();

      const orderMap = groupOrderIndexMap;

      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const gId = t.groupId ?? null;
        let rootId: string | null = null;
        let rootName = "Ungrouped Tasks";
        let subId: string | null = null;
        let subName = "";

        if (gId) {
          const g = groupById.get(gId);
          if (g) {
            if (g.parentId) {
              const parent = groupById.get(g.parentId);
              if (parent) {
                rootId = parent.id;
                rootName = parent.name;
                subId = g.id;
                subName = g.name;
              } else {
                rootId = g.id;
                rootName = g.name;
                subId = null;
                subName = "";
              }
            } else {
              rootId = g.id;
              rootName = g.name;
            }
          }
        }

        let rBucket = rootBuckets.get(rootId);
        if (!rBucket) {
          const sortId = rootId ?? "ungrouped";
          const hasChildren = rootId !== null && rootGroupsWithChildrenSet.has(rootId);
          rBucket = {
            rootId,
            rootName,
            hasSubGroups: hasChildren,
            subMap: new Map(),
            directTasks: [],
            earliestDue: Infinity,
            orderIndex: orderMap.get(sortId) ?? -1,
          };
          rootBuckets.set(rootId, rBucket);
        }

        if (t.dueDate !== null && t.dueDate !== undefined && t.dueDate < rBucket.earliestDue) {
          rBucket.earliestDue = t.dueDate;
        }

        if (subId) {
          let sBucket = rBucket.subMap.get(subId);
          if (!sBucket) {
            sBucket = {
              subId,
              subName,
              tasks: [],
              earliestDue: Infinity,
              orderIndex: orderMap.get(subId) ?? -1,
            };
            rBucket.subMap.set(subId, sBucket);
          }
          sBucket.tasks.push(t);
          if (t.dueDate !== null && t.dueDate !== undefined && t.dueDate < sBucket.earliestDue) {
            sBucket.earliestDue = t.dueDate;
          }
        } else {
          rBucket.directTasks.push(t);
        }
      }

      const result: DashboardRootGroup[] = [];

      for (const rBucket of rootBuckets.values()) {
        const subGroups = Array.from(rBucket.subMap.values());
        subGroups.sort((a, b) => {
          if (a.orderIndex !== -1 && b.orderIndex !== -1) {
            return a.orderIndex - b.orderIndex;
          }
          if (a.orderIndex !== -1) return -1;
          if (b.orderIndex !== -1) return 1;
          if (a.earliestDue !== b.earliestDue) {
            return a.earliestDue - b.earliestDue;
          }
          return COLLATOR.compare(a.subName, b.subName);
        });

        const totalTasksCount =
          rBucket.directTasks.length +
          subGroups.reduce((acc, s) => acc + s.tasks.length, 0);

        result.push({
          rootId: rBucket.rootId,
          rootName: rBucket.rootName,
          hasSubGroups: rBucket.hasSubGroups || subGroups.length > 0,
          subGroups,
          directTasks: rBucket.directTasks,
          totalTasksCount,
          orderIndex: rBucket.orderIndex,
          earliestDue: rBucket.earliestDue,
        });
      }

      result.sort((a, b) => {
        if (a.rootId === null && b.rootId !== null) return 1;
        if (a.rootId !== null && b.rootId === null) return -1;

        if (a.orderIndex !== -1 && b.orderIndex !== -1) {
          return a.orderIndex - b.orderIndex;
        }
        if (a.orderIndex !== -1) return -1;
        if (b.orderIndex !== -1) return 1;

        if (a.earliestDue !== b.earliestDue) {
          return a.earliestDue - b.earliestDue;
        }

        return COLLATOR.compare(a.rootName, b.rootName);
      });

      return result;
    } catch {
      return [];
    }
  });

  let openTasksCount = $derived(taskStore.stats.pending);
  let completedTasksCount = $derived(taskStore.stats.completed);
  let totalTasksCount = $derived(taskStore.stats.total);
  let taskCompletionRate = $derived(
    totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0
  );

  interface DashboardEventDisplayItem {
    event: CalendarEventItem;
    occ: EventOccurrence;
  }

  let categorizedEvents = $derived.by(() => {
    const events: DashboardEventDisplayItem[] = [];
    const google: DashboardEventDisplayItem[] = [];

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      const allEvents = eventStore.events;
      const upcomingWithOcc: DashboardEventDisplayItem[] = [];

      for (let i = 0; i < allEvents.length; i++) {
        const e = allEvents[i];
        const occ = computeEventOccurrence(e, eventCompletions);

        if (occ.isRecurring || occ.endMs >= todayMs || (occ.isOverdue && todayMs - occ.endMs < 7 * 86400000)) {
          upcomingWithOcc.push({ event: e, occ });
        }
      }

      upcomingWithOcc.sort((a, b) => a.occ.startMs - b.occ.startMs);

      for (let i = 0; i < upcomingWithOcc.length; i++) {
        const item = upcomingWithOcc[i];
        if (item.event.source?.startsWith("GOOGLE")) {
          google.push(item);
        } else {
          events.push(item);
        }
      }
    } catch {}

    return { events, google };
  });

  let eventsList = $derived(categorizedEvents.events);
  let googleEventsList = $derived(categorizedEvents.google);

  function getInitialEventTab(): "events" | "google" {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_EVENT_TAB);
      if (saved === "events" || saved === "google") {
        return saved;
      }
      if (saved === "normal" || saved === "recurring") {
        return "events";
      }
    } catch {}
    return "events";
  }

  let eventTab = $state<"events" | "google">(getInitialEventTab());

  $effect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_EVENT_TAB);
      if (!saved && eventsList.length === 0 && googleEventsList.length > 0) {
        eventTab = "google";
      }
    } catch {}
  });

  function selectEventTab(tab: "events" | "google") {
    eventTab = tab;
    try {
      localStorage.setItem(STORAGE_KEY_EVENT_TAB, tab);
    } catch {}
  }

  let displayedEvents = $derived(
    eventTab === "events" ? eventsList : googleEventsList
  );

  async function toggleTask(task: Task) {
    try {
      const newStatus = task.status === "COMPLETED" ? "PENDING" : "COMPLETED";
      await taskStore.updateTask(task.id, { status: newStatus });
    } catch {}
  }

  function getBadgeOffset(count: number): string {
    if (count === 1) return "-translate-x-[1px]";
    if (count === 9) return "translate-x-[1px]";
    return "";
  }

  function getGroupBadgeOffset(count: number): string {
    if (count === 9) return "translate-x-[1px]";
    return "";
  }
</script>

<div class="flex flex-col gap-4 w-full h-full overflow-hidden p-4 md:p-6 text-foreground">
  <header class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 w-full shrink-0">
    <div class="flex items-center gap-4 text-xs text-muted-foreground font-mono bg-black/5 dark:bg-white/5 px-3 py-1.5 rounded-full border border-premium-border select-none">
      <div class="flex items-center gap-1.5" title="Local SQLite Latency">
        <span class="inline-flex rounded-full h-1.5 w-1.5 {dbStatus === 'ok' ? 'bg-cyan-500 animate-pulse' : 'bg-rose-500'}"></span>
        Local DB ({dbPingMs}ms)
      </div>
      <div class="w-px h-3 bg-border"></div>
      <div class="flex items-center gap-1.5 cursor-help" title={storageTooltip}>
        <HardDrive class="w-3 h-3 text-emerald-400" />
        Storage: {storagePercent}%
      </div>
      <div class="w-px h-3 bg-border"></div>
      {#if isOnline}
        <div class="flex items-center gap-3" title="Real-time Network Throughput">
          <div class="flex items-center gap-1">
            <Download class="w-3 h-3 text-blue-400" />
            {downloadText}
          </div>
          <div class="flex items-center gap-1">
            <Upload class="w-3 h-3 text-purple-400" />
            {uploadText}
          </div>
        </div>
      {:else}
        <div class="flex items-center gap-1.5 text-amber-500/90" title="No Internet Connection (App running in Local-Only mode)">
          <WifiOff class="w-3 h-3" />
          <span>Offline</span>
        </div>
      {/if}
    </div>
    <div class="relative flex items-center gap-3 w-full md:w-auto">
      <Button
        variant="ghost"
        size="icon"
        aria-label="View notifications"
        onclick={() => (isNotificationOpen = !isNotificationOpen)}
        class="relative w-8 h-8 rounded-full bg-black/5 dark:bg-white/5 border border-premium-border text-muted-foreground hover:text-foreground shrink-0"
      >
        <Bell class="w-4 h-4" />
        {#if notificationCenterStore.unreadCount > 0}
          <span class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-background"></span>
        {/if}
      </Button>
      <NotificationCenter bind:isOpen={isNotificationOpen} />
    </div>
  </header>

  <div class="card-aura-responsive p-4 md:px-6 md:py-4 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-6 md:gap-8">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <div class="w-6 h-6 rounded-md bg-indigo-500/10 flex items-center justify-center">
          <Zap class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <span class="text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-full">{completedTasksCount}/{totalTasksCount} tasks</span>
      </div>
    </div>

    <div class="flex-1 flex flex-col justify-center">
      <div class="w-full h-3 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden relative border border-black/10 dark:border-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
        <div
          class="absolute top-0 left-0 h-full bg-linear-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-1000 shadow-[0_0_8px_rgba(99,102,241,0.6)]"
          style="width: {taskCompletionRate}%"
        ></div>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
    <div class="card-aura-responsive flex flex-col h-full overflow-hidden relative border-premium-border shadow-2xl">
      <div class="p-4 flex items-center justify-between border-b border-premium-border shrink-0 relative z-overlay bg-transparent">
        <div class="flex items-center gap-2" role="tablist" aria-label="Task Filter">
          <button
            role="tab"
            aria-selected={taskTab === "pending"}
            class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 outline-none {taskTab === 'pending' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'}"
            onclick={() => (taskTab = "pending")}
          >
            <Circle class="w-4 h-4" />
            <span class="hidden sm:inline">Pending</span>
            <span class="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 text-xs font-semibold leading-none rounded-full pt-[1px] {taskTab === 'pending' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-muted text-muted-foreground'}">
              <span class="inline-block translate-y-[1px] {getBadgeOffset(openTasksCount)}">{openTasksCount}</span>
            </span>
          </button>
          <button
            role="tab"
            aria-selected={taskTab === "completed"}
            class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 outline-none {taskTab === 'completed' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'}"
            onclick={() => (taskTab = "completed")}
          >
            <CheckCircle class="w-4 h-4" />
            <span class="hidden sm:inline">Completed</span>
            <span class="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 text-xs font-semibold leading-none rounded-full pt-[1px] {taskTab === 'completed' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-muted text-muted-foreground'}">
              <span class="inline-block translate-y-[1px] {getBadgeOffset(completedTasksCount)}">{completedTasksCount}</span>
            </span>
          </button>
        </div>
        <div class="flex items-center gap-2">
          {#if groupedDisplayedTasks.length > 0}
            <button
              type="button"
              class="text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-premium-border"
              onclick={toggleAllGroupCollapse}
              title={expandedGroups.size > 0 ? "Collapse all" : "Expand all"}
            >
              {expandedGroups.size > 0 ? "Collapse all" : "Expand all"}
            </button>
          {/if}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-2">
        {#if displayedTasks.length === 0}
          <div class="flex flex-col items-center justify-center h-full">
            <EmptyState
              icon={CheckSquare}
              title={taskTab === "pending" ? "All caught up!" : "No completed tasks"}
              class="p-0 scale-90"
            />
          </div>
        {:else}
          {#snippet renderTaskRow(task: Task)}
            {@const isCompleted = task.status === "COMPLETED"}
            {@const badges = getTaskDueBadges(task.dueDate)}
            {@const hasDeadline = task.dueDate != null || badges.dateStr != null}
            {@const dateBadgeStyle = isCompleted ? "text-muted-foreground/50 bg-muted/20 border-border/40" : "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20"}
            {@const timeBadgeStyle = isCompleted ? "text-muted-foreground/50 bg-muted/20 border-border/40" : "text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20"}
            <div
              role="button"
              tabindex="0"
              class="flex items-start text-left gap-3 w-full p-2.5 rounded-lg hover:bg-background/80 group border border-transparent hover:border-premium-border transition-all cursor-pointer select-none"
              onclick={() => toggleTask(task)}
              ondblclick={(e) => openTaskNote(e, task)}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleTask(task);
                }
              }}
            >
              <div class="shrink-0 h-6.5 flex items-center justify-center {isCompleted ? 'text-indigo-500' : 'text-muted-foreground group-hover:text-indigo-400'}">
                {#if isCompleted}
                  <CheckCircle class="w-4 h-4" />
                {:else}
                  <Circle class="w-4 h-4" />
                {/if}
              </div>
              <div class="flex-1 min-w-0 flex flex-col gap-1.5">
                <div class="flex items-center justify-between gap-3 min-h-6.5">
                  <p class="text-sm font-medium line-clamp-1 break-all [word-break:break-all] leading-snug {isCompleted ? 'text-muted-foreground/70 line-through' : 'text-foreground'}">
                    {task.title}
                  </p>

                  <div class="flex items-center gap-1.5 shrink-0">
                    {#if task.description}
                      <button
                        type="button"
                        class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20 hover:bg-indigo-500/25 hover:border-indigo-500/40 transition-colors cursor-pointer"
                        onclick={(e) => openTaskNote(e, task)}
                        title="View and edit note"
                      >
                        <FileText class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span>Note</span>
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-transparent hover:border-border text-muted-foreground/60 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer"
                        onclick={(e) => openTaskNote(e, task)}
                        title="Add note"
                      >
                        <FileText class="w-3.5 h-3.5 shrink-0" />
                        <span class="hidden sm:inline">Note</span>
                      </button>
                    {/if}
                  </div>
                </div>

                {#if hasDeadline}
                  <div class="flex items-center gap-1.5 flex-wrap">
                    {#if task.dueDate && !isCompleted}
                      <TaskCountdown dueDate={task.dueDate} />
                    {/if}

                    {#if badges.dateStr}
                      <span class="text-xs px-1.5 py-0.5 rounded border font-medium {dateBadgeStyle}">
                        {badges.dateStr}
                      </span>
                    {/if}
                    {#if badges.timeStr}
                      <span class="text-xs px-1.5 py-0.5 rounded border font-medium {timeBadgeStyle}">
                        {badges.timeStr}
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/snippet}

          <div class="flex flex-col gap-3 pb-2">
            {#each groupedDisplayedTasks as root (root.rootId ?? "ungrouped")}
              {@const currentId = root.rootId ?? "ungrouped"}
              {@const isExpanded = expandedGroups.has(currentId)}
              {@const isDraggingThis = draggedGroupId === currentId}
              {@const isDragOverThis = dragOverGroupId === currentId}
              <div
                use:trayAction={currentId}
                class="group/tray relative flex flex-col rounded-xl border bg-black/5 dark:bg-white/5 overflow-hidden transition-all duration-150 {isDraggingThis ? 'opacity-30 scale-[0.98] border-dashed border-indigo-400/40' : isDragOverThis ? 'border-indigo-400/40 ring-1 ring-indigo-400/30 bg-indigo-500/15' : 'border-premium-border'}"
                role="region"
                aria-label={root.rootName}
              >
                {#if isDragOverThis && dropPosition === "above"}
                  <div class="absolute top-0 left-0 right-0 h-0.5 bg-indigo-400/80 rounded-full z-30 shadow-[0_0_6px_rgba(129,140,248,0.4)]"></div>
                {/if}
                {#if isDragOverThis && dropPosition === "below"}
                  <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-400/80 rounded-full z-30 shadow-[0_0_6px_rgba(129,140,248,0.4)]"></div>
                {/if}

                <div
                  class="px-4 py-3 sticky top-0 z-10 flex items-center justify-between w-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer select-none {isExpanded ? 'border-b border-premium-border/50 bg-card/50 backdrop-blur-md' : 'bg-transparent'}"
                  role="button"
                  tabindex="0"
                  onclick={() => {
                    if (!isPointerDragging) toggleGroupCollapse(root.rootId);
                  }}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleGroupCollapse(root.rootId);
                    }
                  }}
                >
                  <div class="flex items-center gap-2 min-w-0 flex-1 mr-2">
                    <div
                      class="cursor-grab active:cursor-grabbing p-1.5 -ml-1 text-muted-foreground/60 hover:text-indigo-400 hover:bg-indigo-500/15 rounded-md transition-all select-none touch-none shrink-0"
                      title="Drag and drop to reorder group"
                      role="button"
                      tabindex="0"
                      aria-label="Drag and drop to reorder group"
                      onpointerdown={(e) => handleGripPointerDown(e, currentId)}
                      onclick={(e) => e.stopPropagation()}
                      onkeydown={(e) => {
                        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                      }}
                    >
                      <GripVertical class="w-4 h-4" />
                    </div>

                    {#if root.rootId === null}
                      <Layers class="w-4 h-4 text-muted-foreground shrink-0" />
                    {:else if isExpanded}
                      <FolderOpen class="w-4 h-4 text-indigo-400 shrink-0" />
                    {:else}
                      <Folder class="w-4 h-4 text-indigo-400 shrink-0" />
                    {/if}

                    <span class="text-xs font-semibold text-foreground uppercase tracking-wider truncate" title={root.rootName}>
                      {root.rootName}
                    </span>
                    {#if root.totalTasksCount > 0}
                      <span class="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 text-xs font-semibold text-muted-foreground bg-muted rounded-full leading-none pt-[1px] shrink-0">
                        <span class="inline-block translate-y-[1px] {getGroupBadgeOffset(root.totalTasksCount)}">{root.totalTasksCount}</span>
                      </span>
                    {/if}
                  </div>

                  <div>
                    {#if !isExpanded}
                      <ChevronDown class="w-4 h-4 text-muted-foreground transition-transform duration-200" />
                    {:else}
                      <ChevronUp class="w-4 h-4 text-muted-foreground transition-transform duration-200" />
                    {/if}
                  </div>
                </div>

                {#if isExpanded}
                  {#if root.hasSubGroups}
                    <div class="flex flex-col p-2 gap-2 max-h-96 overflow-y-auto">
                      {#each root.subGroups as sub (sub.subId)}
                        {@const isSubExpanded = !collapsedSubGroups.has(sub.subId)}
                        <div class="flex flex-col rounded-xl border border-border/60 bg-card/60 dark:bg-card/40 overflow-hidden shadow-xs">
                          <div
                            class="px-3 py-2 flex items-center justify-between w-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer select-none {isSubExpanded ? 'border-b border-border/40 bg-muted/20' : ''}"
                            role="button"
                            tabindex="0"
                            onclick={(e) => toggleSubGroupCollapse(e, sub.subId)}
                            onkeydown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleSubGroupCollapse(e, sub.subId);
                              }
                            }}
                          >
                            <div class="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                              {#if sub.tasks.length > 0}
                                <CornerDownRight class="w-3.5 h-3.5 text-indigo-400/80 shrink-0" />
                                {#if isSubExpanded}
                                  <FolderOpen class="w-3.5 h-3.5 text-indigo-400/90 shrink-0" />
                                {:else}
                                  <Folder class="w-3.5 h-3.5 text-indigo-400/90 shrink-0" />
                                {/if}
                              {:else}
                                <CornerDownRight class="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                                {#if isSubExpanded}
                                  <FolderOpen class="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
                                {:else}
                                  <Folder class="w-3.5 h-3.5 text-muted-foreground/70 shrink-0" />
                                {/if}
                              {/if}
                              <span class="text-xs font-semibold text-foreground/90 truncate" title={sub.subName}>{sub.subName}</span>
                              {#if sub.tasks.length > 0}
                                <span class="inline-flex items-center justify-center min-w-4 h-4 px-1 text-xs font-semibold text-muted-foreground bg-muted rounded-full leading-none shrink-0">
                                  {sub.tasks.length}
                                </span>
                              {/if}
                            </div>
                            <div>
                              {#if !isSubExpanded}
                                <ChevronDown class="w-3.5 h-3.5 text-muted-foreground" />
                              {:else}
                                <ChevronUp class="w-3.5 h-3.5 text-muted-foreground" />
                              {/if}
                            </div>
                          </div>

                          {#if isSubExpanded}
                            <div class="flex flex-col p-1 divide-y divide-border/20">
                              {#each sub.tasks as task (task.id)}
                                {@render renderTaskRow(task)}
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/each}

                      {#if root.directTasks.length > 0}
                        {@const isDirectExpanded = !collapsedSubGroups.has(`${root.rootId}-direct`)}
                        <div class="flex flex-col rounded-xl border border-border/60 bg-card/60 dark:bg-card/40 overflow-hidden shadow-xs">
                          <div
                            class="px-3 py-2 flex items-center justify-between w-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer select-none {isDirectExpanded ? 'border-b border-border/40 bg-muted/20' : ''}"
                            role="button"
                            tabindex="0"
                            onclick={(e) => toggleSubGroupCollapse(e, `${root.rootId}-direct`)}
                            onkeydown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleSubGroupCollapse(e, `${root.rootId}-direct`);
                              }
                            }}
                          >
                            <div class="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                              <Layers class="w-3.5 h-3.5 text-indigo-400/80 shrink-0" />
                              <span class="text-xs font-semibold text-foreground/80 truncate">General Tasks</span>
                              <span class="inline-flex items-center justify-center min-w-4 h-4 px-1 text-xs font-semibold text-muted-foreground bg-muted rounded-full leading-none shrink-0">
                                {root.directTasks.length}
                              </span>
                            </div>
                            <div>
                              {#if !isDirectExpanded}
                                <ChevronDown class="w-3.5 h-3.5 text-muted-foreground" />
                              {:else}
                                <ChevronUp class="w-3.5 h-3.5 text-muted-foreground" />
                              {/if}
                            </div>
                          </div>

                          {#if isDirectExpanded}
                            <div class="flex flex-col p-1 divide-y divide-border/20">
                              {#each root.directTasks as task (task.id)}
                                {@render renderTaskRow(task)}
                              {/each}
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {:else}
                    <div class="flex flex-col p-1.5 max-h-80 overflow-y-auto">
                      {#each root.directTasks as task (task.id)}
                        {@render renderTaskRow(task)}
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="flex flex-col gap-4 h-full min-h-0">
      <WeatherWidget />

      <div class="card-aura-responsive flex flex-col flex-1 overflow-hidden relative border-premium-border shadow-2xl">
        <div class="p-4 flex items-center justify-between border-b border-premium-border shrink-0 relative z-overlay bg-transparent">
          <div class="flex items-center gap-2" role="tablist" aria-label="Event Filter">
            <button
              role="tab"
              aria-selected={eventTab === "events"}
              class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 outline-none {eventTab === 'events' ? 'bg-red-500/15 text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'}"
              onclick={() => selectEventTab("events")}
            >
              <Calendar class="w-4 h-4" />
              <span class="hidden sm:inline">Events</span>
              <span class="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 text-xs font-semibold leading-none rounded-full pt-[1px] {eventTab === 'events' ? 'bg-red-500/20 text-red-600 dark:text-red-400' : 'bg-muted text-muted-foreground'}">
                <span class="inline-block translate-y-[1px] {getBadgeOffset(eventsList.length)}">{eventsList.length}</span>
              </span>
            </button>
            <button
              role="tab"
              aria-selected={eventTab === "google"}
              class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 outline-none {eventTab === 'google' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'}"
              onclick={() => selectEventTab("google")}
            >
              <Cloud class="w-4 h-4" />
              <span class="hidden sm:inline">Google</span>
              <span class="inline-flex items-center justify-center min-w-4.5 h-4.5 px-1 text-xs font-semibold leading-none rounded-full pt-[1px] {eventTab === 'google' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-muted text-muted-foreground'}">
                <span class="inline-block translate-y-[1px] {getBadgeOffset(googleEventsList.length)}">{googleEventsList.length}</span>
              </span>
            </button>
          </div>
        </div>
        <div class="p-2 flex-1 flex flex-col overflow-y-auto">
          {#if displayedEvents.length === 0}
            <div class="h-full flex items-center justify-center">
              <EmptyState
                icon={Calendar}
                title="No upcoming events"
                class="p-0 scale-90"
              />
            </div>
          {:else}
            <div class="flex flex-col gap-1">
              {#each displayedEvents.slice(0, 10) as item (item.event.id)}
                {@const event = item.event}
                {@const occ = item.occ}
                {@const startDate = BADGE_DATE_FORMATTER.format(occ.start)}
                {@const startTime = formatTimeBadge(event.startTime, event.isAllDay)}
                {@const endDate = BADGE_DATE_FORMATTER.format(occ.end)}
                {@const endTime = formatTimeBadge(event.endTime, event.isAllDay)}
                {@const isSameDate = endDate === startDate}
                {@const isAttended = occ.status === "attended"}
                {@const isOverdue = occ.isOverdue}
                <div
                  role="button"
                  tabindex="0"
                  onclick={() => openEventDetails(event)}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEventDetails(event);
                    }
                  }}
                  class="flex items-start text-left gap-3 w-full p-3 rounded-xl hover:bg-accent group border border-transparent hover:border-premium-border transition-colors cursor-pointer {isAttended ? 'opacity-70 bg-black/2 dark:bg-white/2' : ''}"
                >
                  <div class="mt-0.5 {isAttended ? 'text-emerald-500' : 'text-red-500/70 group-hover:text-red-500'}">
                    {#if isAttended}
                      <CheckCircle class="w-4 h-4 text-emerald-500" />
                    {:else}
                      <Calendar class="w-4 h-4" />
                    {/if}
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium line-clamp-2 break-all [word-break:break-all] leading-snug {isAttended ? 'line-through text-muted-foreground' : 'text-foreground'}">
                      {event.title}
                    </p>

                    <div class="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                      <div class="flex items-center gap-1.5 flex-wrap">
                        {#if startDate}
                          <span class="text-xs px-2 py-0.5 rounded-full border font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20">
                            {startDate}
                          </span>
                        {/if}
                        {#if startTime}
                          <span class="text-xs px-2 py-0.5 rounded-full border font-medium text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
                            {startTime}
                          </span>
                        {/if}
                        {#if event.endTime && (!isSameDate || endTime)}
                          <span class="text-xs text-muted-foreground/60 font-mono">→</span>
                          {#if endDate && !isSameDate}
                            <span class="text-xs px-2 py-0.5 rounded-full border font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20">
                              {endDate}
                            </span>
                          {/if}
                          {#if endTime}
                            <span class="text-xs px-2 py-0.5 rounded-full border font-medium text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
                              {endTime}
                            </span>
                          {/if}
                        {/if}
                        {#if event.isAllDay && !startTime}
                          <span class="text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            All day
                          </span>
                        {/if}
                        {#if event.recurrence && event.recurrence !== "NONE"}
                          <span class="text-xs font-medium bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded-full whitespace-nowrap capitalize">
                            {event.recurrence.toLowerCase()}
                          </span>
                        {/if}
                      </div>

                      <div role="none" class="flex items-center gap-1.5 shrink-0 ml-auto">
                        {#if isAttended}
                          <button
                            type="button"
                            class="text-xs font-semibold px-2.5 py-0.5 rounded-full border bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 flex items-center gap-1 cursor-pointer transition-colors"
                            title="Attended (Click to unmark)"
                            onclick={(e) => {
                              e.stopPropagation();
                              toggleEventAttendance(event, occ.occurrenceKey);
                            }}
                          >
                            <Check class="w-3 h-3 stroke-[2.5]" />
                            <span>Attended</span>
                          </button>
                        {:else}
                          {#if isOverdue}
                            <button
                              type="button"
                              class="h-6 px-2 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white border border-emerald-500/30 transition-all flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                              title="Mark event as attended"
                              onclick={(e) => {
                                e.stopPropagation();
                                markEventAttended(event, occ.occurrenceKey);
                              }}
                            >
                              <Check class="w-3.5 h-3.5 stroke-[2.5]" />
                              <span>Attended</span>
                            </button>

                            {#if occ.isRecurring}
                              <button
                                type="button"
                                class="h-6 px-2 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground border border-border transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                                title="Skip this occurrence and advance to next"
                                onclick={(e) => {
                                  e.stopPropagation();
                                  markEventSkipped(event, occ.occurrenceKey);
                                }}
                              >
                                <SkipForward class="w-3 h-3" />
                                <span>Skip</span>
                              </button>
                            {/if}
                          {:else}
                            <button
                              type="button"
                              class="opacity-0 group-hover:opacity-100 h-6 px-1.5 rounded-lg text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 border border-transparent hover:border-emerald-500/30 transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                              title="Mark as attended"
                              onclick={(e) => {
                                e.stopPropagation();
                                markEventAttended(event, occ.occurrenceKey);
                              }}
                            >
                              <Check class="w-3.5 h-3.5 stroke-[2.5]" />
                              <span class="hidden md:inline">Attended</span>
                            </button>
                          {/if}

                          <EventCountdown startMs={occ.startMs} endMs={occ.endMs} />
                        {/if}
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

{#if selectedEvent}
  {@const currentEvent = selectedEvent}
  {@const modalOcc = computeEventOccurrence(currentEvent, eventCompletions)}
  {@const modalStartDate = BADGE_DATE_FORMATTER.format(modalOcc.start)}
  {@const modalStartTime = formatTimeBadge(currentEvent.startTime, currentEvent.isAllDay)}
  {@const modalEndDate = BADGE_DATE_FORMATTER.format(modalOcc.end)}
  {@const modalEndTime = formatTimeBadge(currentEvent.endTime, currentEvent.isAllDay)}
  {@const modalIsSameDate = modalEndDate === modalStartDate}
  {@const modalIsAttended = modalOcc.status === "attended"}
  <Modal
    bind:isOpen={isEventModalOpen}
    title="Event Details"
    titleIcon={Calendar}
    titleClass="justify-center text-center w-full"
    className="max-w-md"
  >
    <div class="flex flex-col gap-4 py-2">
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title</span>
          <div class="flex gap-2 items-center">
            {#if modalIsAttended}
              <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 flex items-center gap-1">
                <Check class="w-3 h-3 stroke-[2.5]" />
                <span>Attended</span>
              </span>
            {:else}
              <EventCountdown startMs={modalOcc.startMs} endMs={modalOcc.endMs} />
            {/if}
            {#if currentEvent.recurrence && currentEvent.recurrence !== "NONE"}
              <span class="text-xs font-medium bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full capitalize flex items-center gap-1">
                <Repeat class="w-3 h-3" />
                {currentEvent.recurrence.toLowerCase()}
              </span>
            {/if}
          </div>
        </div>
        <div class="text-sm font-semibold text-foreground bg-black/5 dark:bg-white/5 p-3 rounded-xl border border-premium-border break-all">
          {currentEvent.title}
        </div>
      </div>

      <div class="flex items-center flex-wrap gap-2">
        {#if modalStartDate}
          <span class="text-xs px-2.5 py-1 rounded-full border font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20">
            {modalStartDate}
          </span>
        {/if}
        {#if modalStartTime}
          <span class="text-xs px-2.5 py-1 rounded-full border font-medium text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
            {modalStartTime}
          </span>
        {/if}
        {#if currentEvent.endTime && (!modalIsSameDate || modalEndTime)}
          <span class="text-xs text-muted-foreground/60 font-mono">→</span>
          {#if modalEndDate && !modalIsSameDate}
            <span class="text-xs px-2.5 py-1 rounded-full border font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20">
              {modalEndDate}
            </span>
          {/if}
          {#if modalEndTime}
            <span class="text-xs px-2.5 py-1 rounded-full border font-medium text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
              {modalEndTime}
            </span>
          {/if}
        {/if}
        {#if currentEvent.isAllDay && !modalStartTime}
          <span class="text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-1 rounded-full whitespace-nowrap">
            All day
          </span>
        {/if}
      </div>

      {#if currentEvent.description}
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</span>
          <div class="text-sm text-foreground/90 bg-black/5 dark:bg-white/5 p-3 rounded-xl border border-premium-border whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {currentEvent.description}
          </div>
        </div>
      {/if}

      <div class="flex items-center justify-end gap-2 pt-3 border-t border-premium-border mt-1">
        {#if modalIsAttended}
          <Button
            variant="outline"
            size="sm"
            class="text-xs text-muted-foreground"
            onclick={() => {
              toggleEventAttendance(currentEvent, modalOcc.occurrenceKey);
            }}
          >
            Unmark Attendance
          </Button>
          <span class="text-xs font-semibold px-3 py-1.5 rounded-xl border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 flex items-center gap-1.5">
            <Check class="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Attended</span>
          </span>
        {:else}
          {#if modalOcc.isRecurring}
            <Button
              variant="outline"
              size="sm"
              class="text-xs flex items-center gap-1.5"
              onclick={() => {
                markEventSkipped(currentEvent, modalOcc.occurrenceKey);
                isEventModalOpen = false;
              }}
            >
              <SkipForward class="w-3.5 h-3.5 text-muted-foreground" />
              <span>Skip this occurrence</span>
            </Button>
          {/if}
          <Button
            variant="default"
            size="sm"
            class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 font-medium shadow-xs"
            onclick={() => {
              markEventAttended(currentEvent, modalOcc.occurrenceKey);
              if (!modalOcc.isRecurring) isEventModalOpen = false;
            }}
          >
            <Check class="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Attended</span>
          </Button>
        {/if}
      </div>
    </div>
  </Modal>
{/if}

<TaskNoteModal
  bind:isOpen={isNoteModalOpen}
  task={selectedNoteTask}
  group={selectedNoteTask?.groupId ? taskStore.taskGroups.find((g) => g.id === selectedNoteTask.groupId) : undefined}
/>


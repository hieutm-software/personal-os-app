<script lang="ts">
  import { onMount, type Component } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import Calendar from "../features/calendar/Calendar.svelte";
  import Dashboard from "../features/dashboard/Dashboard.svelte";
  import Documents from "../features/documents/Documents.svelte";
  import { cleanupDocumentsTrash } from "../features/documents/api";
  import EyeCareModal from "../features/health/EyeCareModal.svelte";
  import SedentaryModal from "../features/health/SedentaryModal.svelte";
  import WaterModal from "../features/health/WaterModal.svelte";
  import Settings from "../features/settings/Settings.svelte";
  import Tasks from "../features/tasks/Tasks.svelte";
  import Vault from "../features/vault/Vault.svelte";
  import { autoCleanupStore } from "../shared/autoCleanupStore.svelte";
  import { documentRepo } from "../shared/db/repo/documentRepo";
  import type { Event } from "../shared/db/schema";
  import { eventStore } from "../shared/eventStore.svelte";
  import { healthStore } from "../shared/healthStore.svelte";
  import { shortcutStore } from "../shared/shortcutStore.svelte";
  import { globalState } from "../shared/store.svelte";
  import { taskStore } from "../shared/taskStore.svelte";
  import { vaultStore } from "../shared/vaultStore.svelte";
  import { themeStore } from "../shared/theme.svelte";
  import { toastState } from "../shared/toast.svelte";
  import CommandPalette from "../shared/ui/CommandPalette.svelte";
  import EventDetailsModal from "../shared/ui/EventDetailsModal.svelte";
  import Sidebar from "../shared/ui/Sidebar.svelte";
  import ToastContainer from "../shared/ui/toast/ToastContainer.svelte";
  import {
    playNotificationSound,
    startContinuousAlarm,
    stopContinuousAlarm,
  } from "../shared/utils/sound";
  import "./app.css";

  const ONE_MINUTE_MS = 60_000;
  const THIRTY_MINUTES_MS = 1_800_000;
  const ONE_HOUR_MS = 3_600_000;
  const ONE_DAY_MS = 86_400_000;
  const POLLER_INTERVAL_MS = 5_000;
  const AUTO_CLEANUP_DELAY_MS = 10_000;
  const SHORTCUT_DISPATCH_DELAY_MS = 50;
  const NOTIFICATION_POLL_CYCLE_TICKS = 12;
  const MAX_NOTIFICATION_TITLE_LENGTH = 120;

  const MODULE_COMPONENTS: Record<string, Component> = {
    dashboard: Dashboard,
    tasks: Tasks,
    calendar: Calendar,
    documents: Documents,
    vault: Vault,
    settings: Settings,
  };

  let showWaterReminder = $state(false);
  let showSedentaryReminder = $state(false);
  let showEyeCareOverlay = $state(false);

  let ActiveModuleComponent = $derived(
    MODULE_COMPONENTS[globalState.currentModule] ?? null
  );

  const notifiedEventTimestamps = new Map<string, number>();
  const notifiedTaskDueTimestamps = new Map<string, number>();
  const eventStartTimestampCache = new WeakMap<
    Event,
    { rawStartTime: string; timestampMs: number }
  >();

  let isPollingNotifications = false;
  let isComponentMounted = false;

  function sanitizeNotificationTitle(rawTitle: unknown): string {
    if (typeof rawTitle !== "string") return "Untitled";
    const cleaned = rawTitle.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
    if (!cleaned) return "Untitled";
    return cleaned.length > MAX_NOTIFICATION_TITLE_LENGTH
      ? `${cleaned.slice(0, MAX_NOTIFICATION_TITLE_LENGTH)}...`
      : cleaned;
  }

  function getValidRetentionDays(daysValue: unknown): number | null {
    const numericDays = Number(daysValue);
    if (!Number.isFinite(numericDays) || numericDays <= 0) return null;
    return numericDays;
  }

  function getSafeIntervalMs(intervalMinutes: unknown, fallbackMinutes: number): number {
    const numericMinutes = Number(intervalMinutes);
    const validMinutes =
      Number.isFinite(numericMinutes) && numericMinutes > 0
        ? numericMinutes
        : fallbackMinutes;
    return validMinutes * ONE_MINUTE_MS;
  }

  function getEventStartTimeMs(eventItem: Event): number {
    const rawStartTime = eventItem.startTime;
    if (!rawStartTime || typeof rawStartTime !== "string") return Number.NaN;

    const cachedEntry = eventStartTimestampCache.get(eventItem);
    if (cachedEntry && cachedEntry.rawStartTime === rawStartTime) {
      return cachedEntry.timestampMs;
    }

    const parsedMs = new Date(rawStartTime).getTime();
    eventStartTimestampCache.set(eventItem, {
      rawStartTime,
      timestampMs: parsedMs,
    });
    return parsedMs;
  }

  function pruneExpiredNotificationMap(
    notificationMap: Map<string, number>,
    currentTimestampMs: number
  ): void {
    for (const [itemId, targetTimestampMs] of notificationMap) {
      if (targetTimestampMs < currentTimestampMs) {
        notificationMap.delete(itemId);
      }
    }
  }

  async function bringAppToForeground(): Promise<void> {
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.show();
      await currentWindow.setFocus();
      await currentWindow.requestUserAttention(1);
    } catch {}
  }

  async function checkBackgroundNotifications(): Promise<void> {
    if (isPollingNotifications || !isComponentMounted) return;
    isPollingNotifications = true;

    try {
      const initPromises: Promise<void>[] = [];
      if (!eventStore.isInitialized) {
        initPromises.push(eventStore.fetchAll());
      }
      if (!taskStore.isInitialized) {
        initPromises.push(taskStore.fetchAll());
      }
      if (initPromises.length > 0) {
        await Promise.all(initPromises);
      }
      if (!isComponentMounted) return;

      const currentTimestampMs = Date.now();
      let shouldPlaySound = false;

      const eventsList = eventStore.events;
      for (let i = 0, len = eventsList.length; i < len; i++) {
        const eventItem = eventsList[i];
        if (!eventItem || !eventItem.id || !eventItem.startTime) continue;

        const startTimeMs = getEventStartTimeMs(eventItem);
        if (Number.isNaN(startTimeMs)) continue;

        if (startTimeMs < currentTimestampMs) {
          notifiedEventTimestamps.delete(eventItem.id);
          continue;
        }

        if (notifiedEventTimestamps.get(eventItem.id) === startTimeMs) {
          continue;
        }

        if (startTimeMs - currentTimestampMs <= THIRTY_MINUTES_MS) {
          notifiedEventTimestamps.set(eventItem.id, startTimeMs);
          const safeTitle = sanitizeNotificationTitle(eventItem.title);
          toastState.add("info", `Event "${safeTitle}" is starting in 30 minutes!`);
          shouldPlaySound = true;
        }
      }

      if (notifiedEventTimestamps.size > 0) {
        pruneExpiredNotificationMap(notifiedEventTimestamps, currentTimestampMs);
      }

      const tasksList = taskStore.tasks;
      for (let i = 0, len = tasksList.length; i < len; i++) {
        const taskItem = tasksList[i];
        if (
          !taskItem ||
          !taskItem.id ||
          taskItem.status !== "PENDING" ||
          !taskItem.dueDate
        ) {
          if (taskItem?.id) {
            notifiedTaskDueTimestamps.delete(taskItem.id);
          }
          continue;
        }

        const dueTimeMs = Number(taskItem.dueDate);
        if (!Number.isFinite(dueTimeMs) || dueTimeMs < currentTimestampMs) {
          notifiedTaskDueTimestamps.delete(taskItem.id);
          continue;
        }

        if (notifiedTaskDueTimestamps.get(taskItem.id) === dueTimeMs) {
          continue;
        }

        if (dueTimeMs - currentTimestampMs <= ONE_HOUR_MS) {
          notifiedTaskDueTimestamps.set(taskItem.id, dueTimeMs);
          const safeTitle = sanitizeNotificationTitle(taskItem.title);
          toastState.add("info", `Task "${safeTitle}" is due in 1 hour!`);
          shouldPlaySound = true;
        }
      }

      if (notifiedTaskDueTimestamps.size > 0) {
        pruneExpiredNotificationMap(notifiedTaskDueTimestamps, currentTimestampMs);
      }

      if (shouldPlaySound) {
        playNotificationSound();
      }
    } catch {
    } finally {
      isPollingNotifications = false;
    }
  }

  function checkWaterReminder(currentTimestampMs: number = Date.now()): void {
    try {
      if (!healthStore.waterEnabled || showWaterReminder) return;

      if (healthStore.nextWaterTime === 0) {
        healthStore.nextWaterTime =
          currentTimestampMs + getSafeIntervalMs(healthStore.waterInterval, 60);
        return;
      }

      if (
        currentTimestampMs >= healthStore.nextWaterTime &&
        healthStore.nextWaterTime !== Number.MAX_SAFE_INTEGER
      ) {
        showWaterReminder = true;
        healthStore.nextWaterTime = Number.MAX_SAFE_INTEGER;
      }
    } catch {}
  }

  function dismissWaterReminder(): void {
    try {
      showWaterReminder = false;
      healthStore.nextWaterTime =
        Date.now() + getSafeIntervalMs(healthStore.waterInterval, 60);
    } catch {}
  }

  function dismissSedentaryReminder(): void {
    try {
      showSedentaryReminder = false;
      healthStore.nextSedentaryTime =
        Date.now() + getSafeIntervalMs(healthStore.sedentaryInterval, 45);
    } catch {}
  }

  function dismissEyeCareReminder(): void {
    try {
      showEyeCareOverlay = false;
      healthStore.nextEyeCareTime =
        Date.now() + getSafeIntervalMs(healthStore.eyeCareInterval, 20);
    } catch {}
  }

  function checkHealthReminders(currentTimestampMs: number = Date.now()): void {
    try {
      if (healthStore.sedentaryEnabled && !showSedentaryReminder) {
        if (healthStore.nextSedentaryTime === 0) {
          healthStore.nextSedentaryTime =
            currentTimestampMs + getSafeIntervalMs(healthStore.sedentaryInterval, 45);
        } else if (
          currentTimestampMs >= healthStore.nextSedentaryTime &&
          healthStore.nextSedentaryTime !== Number.MAX_SAFE_INTEGER
        ) {
          showSedentaryReminder = true;
          healthStore.nextSedentaryTime = Number.MAX_SAFE_INTEGER;
        }
      }

      if (healthStore.eyeCareEnabled && !showEyeCareOverlay) {
        if (healthStore.nextEyeCareTime === 0) {
          healthStore.nextEyeCareTime =
            currentTimestampMs + getSafeIntervalMs(healthStore.eyeCareInterval, 20);
        } else if (
          currentTimestampMs >= healthStore.nextEyeCareTime &&
          healthStore.nextEyeCareTime !== Number.MAX_SAFE_INTEGER
        ) {
          showEyeCareOverlay = true;
          healthStore.nextEyeCareTime = Number.MAX_SAFE_INTEGER;
        }
      }
    } catch {}
  }

  async function executeAutoCleanup(): Promise<void> {
    try {
      if (!isComponentMounted) return;
      autoCleanupStore.init();
      const cleanupConfig = autoCleanupStore.config;

      const initPromises: Promise<void>[] = [];
      if (!taskStore.isInitialized) initPromises.push(taskStore.fetchAll());
      if (!eventStore.isInitialized) initPromises.push(eventStore.fetchAll());
      if (!vaultStore.isInitialized) initPromises.push(vaultStore.fetchAll());
      if (initPromises.length > 0) {
        await Promise.all(initPromises);
      }
      if (!isComponentMounted || !cleanupConfig.enabled) return;

      if (cleanupConfig.cleanTasks) {
        const retentionDays = getValidRetentionDays(cleanupConfig.tasksRetentionDays);
        if (retentionDays !== null) {
          await taskStore.cleanupAuto(retentionDays);
        }
      }

      if (cleanupConfig.cleanEvents) {
        const retentionDays = getValidRetentionDays(cleanupConfig.eventsRetentionDays);
        if (retentionDays !== null) {
          await eventStore.cleanupAuto(retentionDays);
        }
      }

      if (cleanupConfig.cleanDocuments) {
        const retentionDays = getValidRetentionDays(cleanupConfig.documentsRetentionDays);
        if (retentionDays !== null) {
          const retentionMs = retentionDays * ONE_DAY_MS;
          await documentRepo.cleanupAuto(retentionMs);
          await cleanupDocumentsTrash(retentionMs);
        }
      }

      if (cleanupConfig.cleanVault) {
        const retentionDays = getValidRetentionDays(cleanupConfig.vaultRetentionDays);
        if (retentionDays !== null) {
          await vaultStore.cleanupAuto(retentionDays);
        }
      }
    } catch {}
  }

  onMount(() => {
    isComponentMounted = true;
    let pollerIntervalId: ReturnType<typeof setInterval> | null = null;
    let autoCleanupTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let pollTickCounter = 0;

    const handleWaterReminderChange = (): void => {
      try {
        healthStore.nextWaterTime = 0;
        checkWaterReminder();
      } catch {}
    };

    const executePollerTick = (): void => {
      try {
        const currentTimestampMs = Date.now();
        checkWaterReminder(currentTimestampMs);
        checkHealthReminders(currentTimestampMs);

        pollTickCounter = (pollTickCounter + 1) % NOTIFICATION_POLL_CYCLE_TICKS;
        if (pollTickCounter === 0) {
          checkBackgroundNotifications().catch(() => {});
        }
      } catch {}
    };

    const handleAutoCleanupRequest = () => {
      executeAutoCleanup().catch(() => {});
    };

    try {
      themeStore.init();
      shortcutStore.init();

      pollerIntervalId = setInterval(executePollerTick, POLLER_INTERVAL_MS);
      checkBackgroundNotifications().catch(() => {});

      autoCleanupTimeoutId = setTimeout(() => {
        executeAutoCleanup().catch(() => {});
      }, AUTO_CLEANUP_DELAY_MS);

      window.addEventListener("water-reminder-changed", handleWaterReminderChange);
      window.addEventListener("execute-auto-cleanup", handleAutoCleanupRequest);
    } catch {}

    return () => {
      isComponentMounted = false;
      if (pollerIntervalId !== null) {
        clearInterval(pollerIntervalId);
        pollerIntervalId = null;
      }
      if (autoCleanupTimeoutId !== null) {
        clearTimeout(autoCleanupTimeoutId);
        autoCleanupTimeoutId = null;
      }
      window.removeEventListener("water-reminder-changed", handleWaterReminderChange);
      window.removeEventListener("execute-auto-cleanup", handleAutoCleanupRequest);
      notifiedEventTimestamps.clear();
      notifiedTaskDueTimestamps.clear();
    };
  });

  $effect(() => {
    try {
      const currentTimestampMs = Date.now();
      if (
        !showEyeCareOverlay &&
        healthStore.nextEyeCareTime === Number.MAX_SAFE_INTEGER
      ) {
        healthStore.nextEyeCareTime =
          currentTimestampMs + getSafeIntervalMs(healthStore.eyeCareInterval, 20);
      }
      if (
        !showSedentaryReminder &&
        healthStore.nextSedentaryTime === Number.MAX_SAFE_INTEGER
      ) {
        healthStore.nextSedentaryTime =
          currentTimestampMs + getSafeIntervalMs(healthStore.sedentaryInterval, 45);
      }
      if (
        !showWaterReminder &&
        healthStore.nextWaterTime === Number.MAX_SAFE_INTEGER
      ) {
        healthStore.nextWaterTime =
          currentTimestampMs + getSafeIntervalMs(healthStore.waterInterval, 60);
      }
    } catch {}
  });

  $effect(() => {
    let shortcutDispatchTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const clearPendingShortcutDispatch = (): void => {
      if (shortcutDispatchTimeoutId !== null) {
        clearTimeout(shortcutDispatchTimeoutId);
        shortcutDispatchTimeoutId = null;
      }
    };

    const scheduleModuleShortcutEvent = (
      targetModule: string,
      customEventName: string
    ): void => {
      globalState.currentModule = targetModule;
      clearPendingShortcutDispatch();
      shortcutDispatchTimeoutId = setTimeout(() => {
        shortcutDispatchTimeoutId = null;
        try {
          window.dispatchEvent(new CustomEvent(customEventName));
        } catch {}
      }, SHORTCUT_DISPATCH_DELAY_MS);
    };

    const handleGlobalKeydown = (keyboardEvent: KeyboardEvent): void => {
      try {
        if (keyboardEvent.repeat || !shortcutStore.isInitialized) return;

        const activeConfig = shortcutStore.config;
        if (shortcutStore.matchShortcut(keyboardEvent, activeConfig.newTask)) {
          keyboardEvent.preventDefault();
          scheduleModuleShortcutEvent("tasks", "shortcut-new-task");
        } else if (shortcutStore.matchShortcut(keyboardEvent, activeConfig.newNote)) {
          keyboardEvent.preventDefault();
          scheduleModuleShortcutEvent("documents", "shortcut-new-note");
        } else if (shortcutStore.matchShortcut(keyboardEvent, activeConfig.newEvent)) {
          keyboardEvent.preventDefault();
          scheduleModuleShortcutEvent("calendar", "shortcut-new-event");
        }
      } catch {}
    };

    window.addEventListener("keydown", handleGlobalKeydown);
    return () => {
      clearPendingShortcutDispatch();
      window.removeEventListener("keydown", handleGlobalKeydown);
    };
  });

  $effect(() => {
    const isAnyHealthModalActive =
      showWaterReminder || showSedentaryReminder || showEyeCareOverlay;

    try {
      if (isAnyHealthModalActive) {
        bringAppToForeground().catch(() => {});
        startContinuousAlarm();
      } else {
        stopContinuousAlarm();
        try {
          getCurrentWindow().requestUserAttention(null);
        } catch {}
      }
    } catch {}

    return () => {
      try {
        stopContinuousAlarm();
      } catch {}
    };
  });
</script>

<div class="h-screen w-full overflow-hidden bg-background flex">
  <Sidebar />
  <ToastContainer />
  <CommandPalette />

  <EyeCareModal
    bind:isOpen={showEyeCareOverlay}
    onDismiss={dismissEyeCareReminder}
  />

  <SedentaryModal
    bind:isOpen={showSedentaryReminder}
    onDismiss={dismissSedentaryReminder}
  />

  <main class="flex-1 overflow-hidden relative">
    {#if ActiveModuleComponent}
      <ActiveModuleComponent />
    {:else}
      <div class="h-full flex items-center justify-center text-slate-500"></div>
    {/if}
  </main>

  <WaterModal
    bind:isOpen={showWaterReminder}
    onDismiss={dismissWaterReminder}
  />
  <EventDetailsModal />
</div>

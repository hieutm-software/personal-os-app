<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import {
    CheckCircle2,
    ChevronDown,
    DatabaseBackup,
    Download,
    Droplet,
    HardDrive,
    Monitor,
    Moon,
    Palette,
    Sun,
    Upload,
    Plus,
    RotateCcw,
    Eye,
    Footprints,
    UploadCloud,
    Loader2,
    Trash2,
    BookOpen,
    HelpCircle,
    Keyboard,
    BrushCleaning,
    RefreshCw,
    Settings as SettingsIcon,
    Calendar as CalendarIcon,
    HeartPulse,
  } from "lucide-svelte";
  import UserGuide from "../guide/UserGuide.svelte";
  import ShortcutModal from "./ShortcutModal.svelte";
  import BackupConflictModal from "./BackupConflictModal.svelte";
  import BackupExportModal from "./BackupExportModal.svelte";
  import BackupPasswordPromptModal from "./BackupPasswordPromptModal.svelte";
  import {
    analyzeBackup,
    executeRestoreWithResolutions,
    type BackupDiffResult,
  } from "./backupRestore";
  import { themeStore } from "../../shared/theme.svelte";
  import {
    autoCleanupStore,
    type AutoCleanupConfig,
  } from "../../shared/autoCleanupStore.svelte";
  import { healthStore } from "../../shared/healthStore.svelte";
  import { eventStore } from "../../shared/eventStore.svelte";
  import { uiPreferenceRepo } from "../../shared/db/repo/uiPreferenceRepo";
  import ConfirmModal from "../../shared/ui/ConfirmModal.svelte";
  import { toastState } from "../../shared/toast.svelte";
  import { playNotificationSound } from "../../shared/utils/sound";
  import {
    exportBackupData,
    runManualCleanup,
    pickDocumentsFolderApi,
    getDefaultDocumentDir,
    resetDocumentsFolderApi,
    isPlatformPathValid,
    formatErrorMessage,
  } from "./api";
  import { fetchICalAndSync } from "../calendar/icalSync";
  import Button from "../../shared/ui/Button.svelte";
  import DropdownMenu from "../../shared/ui/dropdown/DropdownMenu.svelte";
  import DropdownMenuTrigger from "../../shared/ui/dropdown/DropdownMenuTrigger.svelte";
  import DropdownMenuContent from "../../shared/ui/dropdown/DropdownMenuContent.svelte";
  import DropdownMenuItem from "../../shared/ui/dropdown/DropdownMenuItem.svelte";
  import Input from "../../shared/ui/Input.svelte";
  import Switch from "../../shared/ui/Switch.svelte";
  import Modal from "../../shared/ui/Modal.svelte";

  const DEFAULT_ICAL_URL =
    "https://calendar.google.com/calendar/ical/en.vietnamese%23holiday%40group.v.calendar.google.com/public/basic.ics";

  const THEME_OPTIONS = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ] as const;

  const SEDENTARY_INTERVAL_OPTIONS: readonly number[] = [30, 45, 60, 90];
  const EYECARE_INTERVAL_OPTIONS: readonly number[] = [20, 30];

  const RETENTION_DAY_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
    { days: 3, label: "3 Days" },
    { days: 7, label: "1 Week" },
    { days: 14, label: "2 Weeks" },
    { days: 30, label: "1 Month" },
  ];

  const RETENTION_LABELS: Readonly<Record<number, string>> = {
    3: "3 Days",
    7: "1 Week",
    14: "2 Weeks",
    30: "1 Month",
  };

  let isExporting = $state(false);
  let isImporting = $state(false);
  let isMounted = true;

  let isGuideModalOpen = $state(false);
  let isShortcutModalOpen = $state(false);

  let isProgressModalOpen = $state(false);
  let progressIcon = $state<"download" | "upload">("download");
  let progressTitle = $state("Processing...");
  let progressPercent = $state(0);
  let progressStatusText = $state("");

  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let progressCompleteTimeout: ReturnType<typeof setTimeout> | null = null;
  let icalPersistDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let uiTimer: ReturnType<typeof setInterval> | null = null;

  let icalUrls = $state<string[]>([]);
  let syncedUrls = $state<string[]>([]);
  let syncedUrlSet = $derived(new Set(syncedUrls));
  let syncingIndex = $state<number | null>(null);

  let confirmICalDelete = $state({
    isOpen: false,
    index: -1,
  });

  let currentTimerNow = $state(Date.now());

  let documentsPath = $state("");
  let isPickingFolder = $state(false);

  function safeGetStorageItem(key: string): string | null {
    try {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSetStorageItem(key: string, value: string): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(key, value);
    } catch {}
  }

  function setTheme(theme: "system" | "light" | "dark") {
    try {
      themeStore.setTheme(theme);
    } catch {}
  }

  function clearProgressTimers() {
    if (progressTimer !== null) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    if (progressCompleteTimeout !== null) {
      clearTimeout(progressCompleteTimeout);
      progressCompleteTimeout = null;
    }
  }

  function clearIcalPersistTimer() {
    if (icalPersistDebounceTimer !== null) {
      clearTimeout(icalPersistDebounceTimer);
      icalPersistDebounceTimer = null;
    }
  }

  function clearUiTimer() {
    if (uiTimer !== null) {
      clearInterval(uiTimer);
      uiTimer = null;
    }
  }

  function startFakeProgress(title: string, icon: "download" | "upload", status: string) {
    clearProgressTimers();
    isProgressModalOpen = true;
    progressTitle = title;
    progressIcon = icon;
    progressStatusText = status;
    progressPercent = 0;

    progressTimer = setInterval(() => {
      if (progressPercent < 90) {
        progressPercent += (90 - progressPercent) * 0.1;
      }
    }, 500);
  }

  function completeProgress() {
    clearProgressTimers();
    progressPercent = 100;
    progressCompleteTimeout = setTimeout(() => {
      progressCompleteTimeout = null;
      if (isMounted) {
        isProgressModalOpen = false;
      }
    }, 500);
  }

  function hideProgress() {
    clearProgressTimers();
    isProgressModalOpen = false;
  }

  function persistICalUrls(urls: string[], immediateDbSync = true) {
    try {
      const serialized = JSON.stringify(urls);
      safeSetStorageItem("google_ical_urls", serialized);
      clearIcalPersistTimer();
      if (immediateDbSync) {
        uiPreferenceRepo.set("google_ical_urls", serialized).catch(() => {});
      } else {
        icalPersistDebounceTimer = setTimeout(() => {
          icalPersistDebounceTimer = null;
          uiPreferenceRepo.set("google_ical_urls", serialized).catch(() => {});
        }, 300);
      }
    } catch {}
  }

  function parseStringArrayJson(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const valid: string[] = [];
      for (let i = 0; i < parsed.length; i++) {
        if (typeof parsed[i] === "string") {
          valid.push(parsed[i]);
        }
      }
      return valid;
    } catch {
      return [];
    }
  }

  function loadICalConfig() {
    try {
      const stored = safeGetStorageItem("google_ical_urls");
      if (stored) {
        icalUrls = parseStringArrayJson(stored);
      } else {
        const legacy = safeGetStorageItem("google_ical_url");
        icalUrls = legacy ? [legacy] : [DEFAULT_ICAL_URL];
      }
      if (
        !Array.isArray(icalUrls) ||
        icalUrls.length === 0 ||
        (icalUrls.length === 1 && icalUrls[0] === "")
      ) {
        icalUrls = [DEFAULT_ICAL_URL];
      }
      persistICalUrls(icalUrls, true);
      syncedUrls = parseStringArrayJson(safeGetStorageItem("synced_ical_urls"));
    } catch {
      icalUrls = [DEFAULT_ICAL_URL];
      persistICalUrls(icalUrls, true);
    }

    uiPreferenceRepo
      .get("google_ical_urls")
      .then((prefVal) => {
        if (!isMounted || !prefVal) return;
        try {
          const parsed = parseStringArrayJson(prefVal);
          if (parsed.length > 0) {
            const currentStored = safeGetStorageItem("google_ical_urls");
            if (
              !currentStored ||
              (icalUrls.length === 1 &&
                icalUrls[0] === DEFAULT_ICAL_URL &&
                parsed.some((u) => u && u !== DEFAULT_ICAL_URL))
            ) {
              icalUrls = parsed;
              safeSetStorageItem("google_ical_urls", JSON.stringify(parsed));
            }
          }
        } catch {}
      })
      .catch(() => {});
  }

  let isExportModalOpen = $state(false);
  let isRestorePasswordModalOpen = $state(false);
  let pendingImportFilePath = $state<string | null>(null);
  let restorePasswordError = $state<string | null>(null);
  let isAnalyzingEncrypted = $state(false);

  function openExportModal() {
    isExportModalOpen = true;
  }

  async function handleConfirmExport(password?: string) {
    isExportModalOpen = false;
    try {
      const isEncrypted = Boolean(password && password.trim());
      const dateStr = new Date().toISOString().split("T")[0];
      const defaultFileName = isEncrypted
        ? `personal_os_backup_${dateStr}.posbackup`
        : `personal_os_full_backup_${dateStr}.zip`;

      const selected = await save({
        defaultPath: defaultFileName,
        filters: isEncrypted
          ? [
              {
                name: "Encrypted Backup Archive (*.posbackup)",
                extensions: ["posbackup"],
              },
              {
                name: "All Files (*.*)",
                extensions: ["*"],
              },
            ]
          : [
              {
                name: "ZIP Archive (*.zip)",
                extensions: ["zip"],
              },
            ],
      });
      if (!selected) return;

      isExporting = true;
      startFakeProgress(
        isEncrypted ? "Exporting Encrypted Backup..." : "Exporting Backup...",
        "download",
        isEncrypted
          ? "Encrypting and packaging database and files..."
          : "Packaging database and files..."
      );
      await exportBackupData(selected, password);
      if (!isMounted) return;
      completeProgress();
    } catch {
      if (!isMounted) return;
      hideProgress();
    } finally {
      if (isMounted) isExporting = false;
    }
  }

  let isConflictModalOpen = $state(false);
  let pendingDiffResult = $state<BackupDiffResult | null>(null);
  let isCleaningNow = $state(false);

  async function handleManualCleanup() {
    if (isCleaningNow) return;
    try {
      isCleaningNow = true;
      const res = await runManualCleanup();
      if (res.totalCleaned > 0) {
        toastState.add(
          "success",
          `Successfully cleaned up ${res.totalCleaned} items (${res.tasksCleaned} tasks, ${res.eventsCleaned} events, ${res.vaultCleaned} vault items)!`
        );
        playNotificationSound();
      } else {
        toastState.add("info", "System is clean, no items exceeded retention limits.");
      }
    } catch (err) {
      toastState.add("error", `Error during cleanup: ${formatErrorMessage(err)}`);
    } finally {
      isCleaningNow = false;
    }
  }

  async function handleImport() {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Backup",
            extensions: ["posbackup", "zip", "json"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      await processBackupFile(selected);
    } catch (err) {
      if (!isMounted) return;
      hideProgress();
      isImporting = false;
      toastState.add("error", `Failed to select backup file: ${formatErrorMessage(err)}`);
    }
  }

  async function processBackupFile(filePath: string, password?: string) {
    try {
      if (!password) {
        isImporting = true;
        startFakeProgress("Analyzing backup file...", "upload", "Checking structure and conflicts...");
      } else {
        isAnalyzingEncrypted = true;
      }

      const diffResult = await analyzeBackup(filePath, password);

      isRestorePasswordModalOpen = false;
      pendingImportFilePath = null;
      restorePasswordError = null;

      if (diffResult.conflicts.length > 0) {
        hideProgress();
        isImporting = false;
        pendingDiffResult = diffResult;
        isConflictModalOpen = true;
      } else {
        await applyRestore(diffResult, new Map());
      }
    } catch (err: unknown) {
      if (!isMounted) return;
      hideProgress();
      isImporting = false;
      const errMsg = formatErrorMessage(err);

      if (errMsg.includes("PASSWORD_REQUIRED")) {
        pendingImportFilePath = filePath;
        restorePasswordError = null;
        isRestorePasswordModalOpen = true;
      } else if (errMsg.includes("INVALID_BACKUP_PASSWORD")) {
        pendingImportFilePath = filePath;
        restorePasswordError = "Incorrect password. Please verify and try again.";
        isRestorePasswordModalOpen = true;
      } else {
        isRestorePasswordModalOpen = false;
        pendingImportFilePath = null;
        toastState.add("error", `Failed to read backup file: ${errMsg}`);
      }
    } finally {
      isAnalyzingEncrypted = false;
    }
  }

  async function applyRestore(
    diffResult: BackupDiffResult,
    resolutions: Map<string, "overwrite" | "keep_local">
  ) {
    try {
      isImporting = true;
      startFakeProgress("Restoring data...", "upload", "Intelligently merging data...");
      const result = await executeRestoreWithResolutions(diffResult, resolutions, (stage) => {
        progressStatusText = stage;
      });

      if (!isMounted) return;
      const docsDir = safeGetStorageItem("documents_path");
      if (docsDir && isPlatformPathValid(docsDir)) documentsPath = docsDir;
      loadICalConfig();
      completeProgress();

      const identicalPart = result.identical > 0 ? `, ${result.identical} items unchanged` : "";
      toastState.add(
        "success",
        `Successfully restored ${result.total} backup items! (Added: ${result.added}, updated: ${result.overwritten}${identicalPart}).`
      );
      playNotificationSound();
    } catch (err) {
      if (!isMounted) return;
      hideProgress();
      toastState.add("error", `Failed to restore data: ${formatErrorMessage(err)}`);
    } finally {
      if (isMounted) isImporting = false;
      isConflictModalOpen = false;
      pendingDiffResult = null;
    }
  }

  async function handleICalSync(index: number) {
    try {
      const url = icalUrls[index];
      if (!url) return;
      syncingIndex = index;
      persistICalUrls(icalUrls, true);
      await fetchICalAndSync(url);
      if (!isMounted) return;
      syncedUrls = parseStringArrayJson(safeGetStorageItem("synced_ical_urls"));
    } finally {
      if (isMounted) syncingIndex = null;
    }
  }

  function addICalRow() {
    try {
      if (icalUrls.length > 0 && icalUrls[icalUrls.length - 1].trim() === "") return;
      icalUrls = [...icalUrls, ""];
      persistICalUrls(icalUrls, true);
    } catch {}
  }

  function removeICalRow(index: number) {
    try {
      const url = icalUrls[index];
      if (url && syncedUrlSet.has(url)) {
        confirmICalDelete = { isOpen: true, index };
      } else {
        executeRemoveICalRow(index);
      }
    } catch {}
  }

  async function executeRemoveICalRow(index: number) {
    try {
      const url = icalUrls[index];
      const nextUrls = icalUrls.filter((_, i) => i !== index);
      icalUrls = nextUrls.length === 0 ? [""] : nextUrls;
      persistICalUrls(icalUrls, true);

      if (url && syncedUrlSet.has(url)) {
        syncedUrls = syncedUrls.filter((u) => u !== url);
        const serializedSynced = JSON.stringify(syncedUrls);
        safeSetStorageItem("synced_ical_urls", serializedSynced);
        uiPreferenceRepo.set("synced_ical_urls", serializedSynced).catch(() => {});
        window.dispatchEvent(new StorageEvent("storage", { key: "synced_ical_urls" }));

        const targetSource = `GOOGLE::${url}`;
        const syncedEventIds: string[] = [];
        const allEvents = eventStore.events;
        for (let i = 0; i < allEvents.length; i++) {
          if (allEvents[i].source === targetSource) {
            syncedEventIds.push(allEvents[i].id);
          }
        }
        if (syncedEventIds.length > 0) {
          await eventStore.deleteMany(syncedEventIds);
        }
      }
    } catch {}
  }

  function formatHealthCountdown(enabled: boolean, nextTargetTime: number, nowMs: number): string {
    try {
      if (!enabled) return "Disabled";
      if (nextTargetTime === 0) return "Calculating...";
      const diff = nextTargetTime - nowMs;
      if (diff <= 0 || nextTargetTime === Number.MAX_SAFE_INTEGER) {
        return "Active - Paused until confirmed";
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      return `${mins}m ${secs}s`;
    } catch {
      return "Error";
    }
  }

  let timeRemainingStr = $derived(
    formatHealthCountdown(healthStore.waterEnabled, healthStore.nextWaterTime, currentTimerNow)
  );
  let sedentaryTimeRemainingStr = $derived(
    formatHealthCountdown(
      healthStore.sedentaryEnabled,
      healthStore.nextSedentaryTime,
      currentTimerNow
    )
  );
  let eyeCareTimeRemainingStr = $derived(
    formatHealthCountdown(healthStore.eyeCareEnabled, healthStore.nextEyeCareTime, currentTimerNow)
  );

  onMount(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "synced_ical_urls") {
        syncedUrls = parseStringArrayJson(safeGetStorageItem("synced_ical_urls"));
      }
    };

    const handleBackupRestored = () => {
      loadICalConfig();
    };

    const handlePathChanged = () => {
      const docsDir = safeGetStorageItem("documents_path");
      if (docsDir && isPlatformPathValid(docsDir)) documentsPath = docsDir;
    };

    try {
      loadICalConfig();

      uiTimer = setInterval(() => {
        try {
          if (
            healthStore.waterEnabled ||
            healthStore.sedentaryEnabled ||
            healthStore.eyeCareEnabled
          ) {
            currentTimerNow = Date.now();
          }
        } catch {}
      }, 1000);

      const savedDocsPath = safeGetStorageItem("documents_path");
      if (savedDocsPath && isPlatformPathValid(savedDocsPath)) {
        documentsPath = savedDocsPath;
      } else {
        getDefaultDocumentDir()
          .then((dir) => {
            if (isMounted) documentsPath = dir;
          })
          .catch(() => {});
      }

      window.addEventListener("storage", handleStorage);
      window.addEventListener("backup-restored", handleBackupRestored);
      window.addEventListener("documents-path-changed", handlePathChanged);
    } catch {}

    return () => {
      try {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener("backup-restored", handleBackupRestored);
        window.removeEventListener("documents-path-changed", handlePathChanged);
      } catch {}
    };
  });

  async function pickDocumentsFolder() {
    try {
      isPickingFolder = true;
      const selected = await pickDocumentsFolderApi(documentsPath);
      if (!isMounted) return;
      if (selected) {
        documentsPath = selected;
      }
    } catch {} finally {
      if (isMounted) isPickingFolder = false;
    }
  }

  async function resetDocumentsFolder() {
    try {
      const path = await resetDocumentsFolderApi();
      if (!isMounted) return;
      documentsPath = path;
    } catch {}
  }

  onDestroy(() => {
    try {
      isMounted = false;
      clearUiTimer();
      clearProgressTimers();
      clearIcalPersistTimer();
    } catch {}
  });
</script>

{#snippet cleanupRuleRow(
  label: string,
  enabledKey: "cleanTasks" | "cleanEvents" | "cleanDocuments" | "cleanVault",
  retentionKey:
    | "tasksRetentionDays"
    | "eventsRetentionDays"
    | "documentsRetentionDays"
    | "vaultRetentionDays"
)}
  {@const isRuleEnabled = autoCleanupStore.config[enabledKey]}
  {@const currentRetentionDays = autoCleanupStore.config[retentionKey]}
  <div class="flex items-center justify-between p-2.5 rounded-xl bg-muted/20 border border-border/40 hover:bg-muted/30 transition-colors">
    <div
      class="flex items-center gap-2.5 text-sm cursor-pointer hover:text-foreground text-foreground/90 transition-colors select-none"
      role="button"
      tabindex="0"
      onclick={(event) => {
        event.preventDefault();
        autoCleanupStore.updateConfig({
          [enabledKey]: !isRuleEnabled,
        } as Partial<AutoCleanupConfig>);
      }}
      onkeydown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          autoCleanupStore.updateConfig({
            [enabledKey]: !isRuleEnabled,
          } as Partial<AutoCleanupConfig>);
        }
      }}
    >
      <Switch checked={isRuleEnabled} />
      <span class="text-xs sm:text-sm font-medium">{label}</span>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button
          disabled={!isRuleEnabled}
          class="flex items-center gap-1.5 bg-background border border-input rounded-md px-2.5 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed text-foreground hover:bg-accent transition-colors shadow-xs"
        >
          {RETENTION_LABELS[currentRetentionDays] || `${currentRetentionDays} Days`}
          <ChevronDown class="w-3.5 h-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {#each RETENTION_DAY_OPTIONS as option (option.days)}
          <DropdownMenuItem
            onclick={() =>
              autoCleanupStore.updateConfig({
                [retentionKey]: option.days,
              } as Partial<AutoCleanupConfig>)}
          >
            {option.label}
          </DropdownMenuItem>
        {/each}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
{/snippet}

{#snippet sectionHeader(icon: any, title: string, colorClass: string = "text-primary")}
  {@const IconComp = icon}
  <div class="flex items-center gap-2 px-0.5 pt-2">
    <div class="p-1 rounded-md bg-muted/60 border border-border/40">
      <IconComp class="w-3.5 h-3.5 {colorClass}" />
    </div>
    <h2 class="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
    <div class="flex-1 border-t border-border/40 ml-2"></div>
  </div>
{/snippet}

<ConfirmModal
  bind:isOpen={confirmICalDelete.isOpen}
  title="Remove Synced Calendar?"
  message="This URL is currently actively syncing. Removing it will delete all its synced events from your calendar. Are you sure you want to remove it?"
  confirmText="Remove"
  onConfirm={() => executeRemoveICalRow(confirmICalDelete.index)}
/>

<Modal
  bind:isOpen={isProgressModalOpen}
  title={progressTitle}
  hideCloseButton={true}
  closeOnBackdropClick={false}
  closeOnEscape={false}
  className="max-w-md"
>
  <div class="flex flex-col items-center justify-center gap-4 py-4 text-center">
    <div
      class="relative w-16 h-16 flex items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-inner"
    >
      {#if progressIcon === "download"}
        <Download class="w-8 h-8 animate-bounce" />
      {:else}
        <UploadCloud class="w-8 h-8 animate-bounce" />
      {/if}
    </div>

    <div class="w-full space-y-2">
      <div class="flex justify-between text-xs font-semibold text-muted-foreground px-1">
        <span class="truncate max-w-60 text-left">{progressStatusText}</span>
        <span class="font-mono text-primary font-bold">{Math.round(progressPercent)}%</span>
      </div>

      <div class="w-full h-2.5 bg-muted rounded-full overflow-hidden border border-border/50">
        <div
          class="h-full bg-gradient-to-r from-primary to-blue-500 transition-all duration-200 ease-out rounded-full"
          style="width: {progressPercent}%;"
        ></div>
      </div>
    </div>
  </div>
</Modal>

<Modal bind:isOpen={isGuideModalOpen} title="User Guide & Help" className="max-w-5xl">
  <UserGuide />
</Modal>

<ShortcutModal bind:isOpen={isShortcutModalOpen} />

<div
  class="relative p-4 md:p-6 lg:p-8 min-h-full h-[calc(100vh-3.5rem)] md:h-screen overflow-auto"
>
  <div class="relative z-10 max-w-5xl mx-auto w-full space-y-8 pb-16">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border/40">
      <div>
        <h1 class="text-xl md:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <SettingsIcon class="w-6 h-6 text-primary" />
          Settings
        </h1>
        <p class="text-xs md:text-sm text-muted-foreground mt-0.5">
          Configure workspace preferences, storage directories, health reminders, and data sync.
        </p>
      </div>
    </div>

    <!-- Category 1: General & Data -->
    <div class="space-y-3.5">
      {@render sectionHeader(Palette, "General & Data", "text-indigo-400")}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <!-- Theme -->
        <div
          class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
        >
          <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
            <div class="flex items-center gap-2.5">
              <div class="p-1.5 rounded-md bg-indigo-500/10">
                <Palette class="w-4 h-4 text-indigo-400" />
              </div>
              <h3 class="font-semibold leading-none tracking-tight text-sm">Theme</h3>
            </div>
            <p class="text-xs text-muted-foreground pl-8">Customize your workspace appearance.</p>
          </div>

          <div
            class="p-5 flex-1 flex flex-col justify-center shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl"
          >
            <div class="grid grid-cols-3 gap-2.5">
              {#each THEME_OPTIONS as opt (opt.value)}
                {@const Icon = opt.icon}
                {@const isSelected = themeStore.current === opt.value}
                <button
                  onclick={() => setTheme(opt.value)}
                  class="flex flex-col sm:flex-row items-center justify-center gap-2 p-3 rounded-xl border transition-all {isSelected
                    ? 'border-primary/50 bg-primary/10 text-primary font-medium shadow-xs'
                    : 'border-border/60 hover:border-border hover:bg-accent text-muted-foreground hover:text-foreground'}"
                >
                  <Icon class="w-4 h-4 shrink-0" />
                  <span class="text-xs sm:text-sm">{opt.label}</span>
                  {#if isSelected}<CheckCircle2 class="w-3.5 h-3.5 hidden sm:block ml-auto text-primary" />{/if}
                </button>
              {/each}
            </div>
          </div>
        </div>

        <!-- Data Backup -->
        <div
          class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
        >
          <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
            <div class="flex items-center gap-2.5">
              <div class="p-1.5 rounded-md bg-green-500/10">
                <DatabaseBackup class="w-4 h-4 text-green-500" />
              </div>
              <h3 class="font-semibold leading-none tracking-tight text-sm">Data Backup</h3>
            </div>
            <p class="text-xs text-muted-foreground pl-8">
              Export or import your complete local database.
            </p>
          </div>

          <div
            class="p-5 flex-1 flex flex-col justify-center shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl"
          >
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button
                variant="outline"
                class="w-full h-11 text-xs sm:text-sm font-medium"
                onclick={openExportModal}
                disabled={isExporting}
              >
                <Download class="w-4 h-4 mr-2 text-green-500" />
                {isExporting ? "Exporting..." : "Export Backup"}
              </Button>

              <Button
                variant="outline"
                class="w-full h-11 text-xs sm:text-sm font-medium"
                onclick={handleImport}
                disabled={isImporting}
              >
                <Upload class="w-4 h-4 mr-2 text-blue-500" />
                {isImporting ? "Restoring..." : "Import Backup"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Category 2: Storage & File Locations -->
    <div class="space-y-3.5">
      {@render sectionHeader(HardDrive, "Storage & File Locations", "text-purple-500")}
      <!-- Documents Storage Path -->
      <div
        class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
      >
        <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
          <div class="flex items-center gap-2.5">
            <div class="p-1.5 rounded-md bg-purple-500/10">
              <HardDrive class="w-4 h-4 text-purple-500" />
            </div>
            <h3 class="font-semibold leading-none tracking-tight text-sm">
              Documents Storage Path
            </h3>
          </div>
          <p class="text-xs text-muted-foreground pl-8">
            Default location for local documents and files.
          </p>
        </div>
        <div
          class="p-5 flex-1 flex flex-col justify-center shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl"
        >
          <div class="flex items-center gap-2 w-full">
            <div class="flex-1 min-w-0">
              <Input
                bind:value={documentsPath}
                readonly
                class="bg-muted/50 text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 cursor-text select-all text-xs"
                placeholder="Loading default path..."
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              class="shrink-0 h-9 text-xs font-medium"
              onclick={pickDocumentsFolder}
              disabled={isPickingFolder}
            >
              {isPickingFolder ? "..." : "Browse..."}
            </Button>

            <Button
              variant="outline"
              size="icon"
              class="shrink-0 h-9 w-9"
              onclick={resetDocumentsFolder}
              title="Reset to Default"
            >
              <RotateCcw class="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>

    <!-- Category 3: Health & Ergonomics -->
    <div class="space-y-3.5">
      {@render sectionHeader(HeartPulse, "Health & Wellness Alerts", "text-emerald-500")}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        <!-- Water Reminder -->
        <div
          class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
        >
          <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
            <div class="flex items-center gap-2.5">
              <div class="p-1.5 rounded-md bg-blue-500/10">
                <Droplet class="w-4 h-4 text-blue-500" />
              </div>
              <h3 class="font-semibold leading-none tracking-tight text-sm">Water Reminder</h3>
            </div>
            <p class="text-xs text-muted-foreground pl-8">Configure automatic water reminder.</p>
          </div>

          <div
            class="p-5 flex-1 space-y-4 shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl flex flex-col justify-between"
          >
            <div class="space-y-4">
              <label class="flex items-center gap-3 cursor-pointer w-fit">
                <Switch
                  checked={healthStore.waterEnabled}
                  onclick={(event) => {
                    healthStore.waterEnabled = !healthStore.waterEnabled;
                    event.preventDefault();
                  }}
                />
                <span class="text-sm font-medium text-foreground">Enable Reminder</span>
              </label>

              <div class="space-y-2 pt-2 border-t border-border/50">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Interval:</span>
                  <span class="text-xs font-semibold text-blue-400"
                    >{healthStore.waterInterval} mins</span
                  >
                </div>
                <div class="grid grid-cols-5 gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    class="px-1 text-xs"
                    onclick={() => {
                      healthStore.waterInterval = Math.max(5, healthStore.waterInterval - 10);
                    }}
                    disabled={!healthStore.waterEnabled || healthStore.waterInterval <= 5}
                  >
                    -10
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="px-1 text-xs"
                    onclick={() => {
                      healthStore.waterInterval = Math.max(5, healthStore.waterInterval - 5);
                    }}
                    disabled={!healthStore.waterEnabled || healthStore.waterInterval <= 5}
                  >
                    -5
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="px-1 text-xs"
                    onclick={() => {
                      healthStore.waterInterval = Math.min(180, healthStore.waterInterval + 5);
                    }}
                    disabled={!healthStore.waterEnabled || healthStore.waterInterval >= 180}
                  >
                    +5
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    class="px-1 text-xs"
                    onclick={() => {
                      healthStore.waterInterval = Math.min(180, healthStore.waterInterval + 10);
                    }}
                    disabled={!healthStore.waterEnabled || healthStore.waterInterval >= 180}
                  >
                    +10
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="px-1 text-xs text-muted-foreground hover:text-foreground flex items-center justify-center"
                    title="Reset to 60 mins"
                    onclick={() => {
                      healthStore.waterInterval = 60;
                    }}
                    disabled={!healthStore.waterEnabled}
                  >
                    <RotateCcw class="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <div
              class="flex items-center justify-between bg-muted/30 px-3 py-2 rounded-lg border border-border w-full"
            >
              <span class="text-xs font-medium text-muted-foreground">Next reminder in:</span>
              <span class="text-sm font-semibold font-mono text-blue-500">
                {timeRemainingStr}
              </span>
            </div>
          </div>
        </div>

        <!-- Sedentary Reminder -->
        <div
          class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
        >
          <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
            <div class="flex items-center gap-2.5">
              <div class="p-1.5 rounded-md bg-emerald-500/10">
                <Footprints class="w-4 h-4 text-emerald-500" />
              </div>
              <h3 class="font-semibold leading-none tracking-tight text-sm">Sedentary Reminder</h3>
            </div>
            <p class="text-xs text-muted-foreground pl-8">
              Reminds you to stand up &amp; walk around.
            </p>
          </div>

          <div
            class="p-5 flex-1 space-y-4 shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl flex flex-col justify-between"
          >
            <div class="space-y-4">
              <label class="flex items-center gap-3 cursor-pointer w-fit">
                <Switch
                  checked={healthStore.sedentaryEnabled}
                  onclick={(event) => {
                    healthStore.sedentaryEnabled = !healthStore.sedentaryEnabled;
                    event.preventDefault();
                  }}
                />
                <span class="text-sm font-medium text-foreground">Enable Stand Up Alert</span>
              </label>

              <div class="space-y-2 pt-2 border-t border-border/50">
                <span class="text-xs text-muted-foreground">Interval:</span>
                <div class="grid grid-cols-4 gap-2">
                  {#each SEDENTARY_INTERVAL_OPTIONS as mins (mins)}
                    <Button
                      variant={healthStore.sedentaryInterval === mins ? "premium" : "outline"}
                      size="sm"
                      onclick={() => (healthStore.sedentaryInterval = mins)}
                      disabled={!healthStore.sedentaryEnabled}
                    >
                      {mins}m
                    </Button>
                  {/each}
                </div>
              </div>
            </div>

            <div
              class="flex items-center justify-between bg-muted/30 px-3 py-2 rounded-lg border border-border w-full"
            >
              <span class="text-xs font-medium text-muted-foreground">Next reminder in:</span>
              <span class="text-sm font-semibold font-mono text-emerald-500">
                {sedentaryTimeRemainingStr}
              </span>
            </div>
          </div>
        </div>

        <!-- Eye Care -->
        <div
          class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
        >
          <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
            <div class="flex items-center gap-2.5">
              <div class="p-1.5 rounded-md bg-cyan-500/10">
                <Eye class="w-4 h-4 text-cyan-500" />
              </div>
              <h3 class="font-semibold leading-none tracking-tight text-sm">Eye Care (20-20-20)</h3>
            </div>
            <p class="text-xs text-muted-foreground pl-8">
              20-second break every 20 mins to rest your eyes.
            </p>
          </div>

          <div
            class="p-5 flex-1 space-y-4 shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl flex flex-col justify-between"
          >
            <div class="space-y-4">
              <label class="flex items-center gap-3 cursor-pointer w-fit">
                <Switch
                  checked={healthStore.eyeCareEnabled}
                  onclick={(event) => {
                    healthStore.eyeCareEnabled = !healthStore.eyeCareEnabled;
                    event.preventDefault();
                  }}
                />
                <span class="text-sm font-medium text-foreground">Enable Eye Strain Protection</span>
              </label>

              <div class="space-y-2 pt-2 border-t border-border/50">
                <span class="text-xs text-muted-foreground">Interval:</span>
                <div class="grid grid-cols-2 gap-2">
                  {#each EYECARE_INTERVAL_OPTIONS as mins (mins)}
                    <Button
                      variant={healthStore.eyeCareInterval === mins ? "premium" : "outline"}
                      size="sm"
                      onclick={() => (healthStore.eyeCareInterval = mins)}
                      disabled={!healthStore.eyeCareEnabled}
                    >
                      {mins} mins
                    </Button>
                  {/each}
                </div>
              </div>
            </div>

            <div
              class="flex items-center justify-between bg-muted/30 px-3 py-2 rounded-lg border border-border w-full"
            >
              <span class="text-xs font-medium text-muted-foreground">Next reminder in:</span>
              <span class="text-sm font-semibold font-mono text-cyan-500">
                {eyeCareTimeRemainingStr}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Category 4: Maintenance & Automation -->
    <div class="space-y-3.5">
      {@render sectionHeader(Trash2, "Maintenance & Automation", "text-amber-500")}
      <div
        class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-visible relative z-20"
      >
        <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
          <div class="flex items-center gap-2.5">
            <div class="p-1.5 rounded-md bg-amber-500/10">
              <Trash2 class="w-4 h-4 text-amber-500" />
            </div>
            <h3 class="font-semibold leading-none tracking-tight text-sm">Auto Cleanup</h3>
          </div>
          <p class="text-xs text-muted-foreground pl-8">
            Automatically purge old tasks, past events, and trashed items.
          </p>
        </div>

        <div
          class="p-5 flex-1 shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl"
        >
          <div class="space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <span class="text-sm font-medium text-foreground">Enable Auto Cleanup</span>
                <p class="text-xs text-muted-foreground">Run automatic cleanup of expired items on startup and scheduled timers.</p>
              </div>
              <Switch
                checked={autoCleanupStore.config.enabled}
                onclick={(event) => {
                  event.preventDefault();
                  autoCleanupStore.updateConfig({ enabled: !autoCleanupStore.config.enabled });
                }}
              />
            </div>
            {#if autoCleanupStore.config.enabled}
              <div class="space-y-4 pt-4 border-t border-border/50">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {@render cleanupRuleRow("Tasks (Completed)", "cleanTasks", "tasksRetentionDays")}
                  {@render cleanupRuleRow(
                    "Calendar (Past Events)",
                    "cleanEvents",
                    "eventsRetentionDays"
                  )}
                  {@render cleanupRuleRow(
                    "Documents (Trashed)",
                    "cleanDocuments",
                    "documentsRetentionDays"
                  )}
                  {@render cleanupRuleRow("Vault (Trashed)", "cleanVault", "vaultRetentionDays")}
                </div>

                <div class="pt-4 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p class="text-xs font-medium text-foreground">Manual Cleanup</p>
                    <p class="text-xs text-muted-foreground">Trigger immediate cleanup of expired items according to the rules above.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={handleManualCleanup}
                    disabled={isCleaningNow}
                    class="h-8 gap-1.5 text-xs font-medium border-border hover:bg-muted shrink-0"
                  >
                    {#if isCleaningNow}
                      <RefreshCw class="w-3.5 h-3.5 animate-spin" />
                      <span>Cleaning...</span>
                    {:else}
                      <BrushCleaning class="w-3.5 h-3.5 text-amber-500" />
                      <span>Clean Up Now</span>
                    {/if}
                  </Button>
                </div>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Category 5: Calendar Integrations -->
    <div class="space-y-3.5">
      {@render sectionHeader(CalendarIcon, "Calendar Integrations", "text-blue-500")}
      <div
        class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
      >
        <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
          <div class="flex items-center gap-2.5">
            <div class="p-1.5 rounded-md bg-blue-500/10">
              <CalendarIcon class="w-4 h-4 text-blue-500" />
            </div>
            <h3 class="font-semibold leading-none tracking-tight text-sm">
              Google Calendar Sync (iCal)
            </h3>
          </div>
          <p class="text-xs text-muted-foreground pl-8">
            Sync events from a public Google Calendar iCal link (Read-only).
          </p>
        </div>

        <div
          class="p-5 flex-1 shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl space-y-4"
        >
          <div
            class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3 border-b border-border/50"
          >
            <div class="space-y-0.5">
              <p class="text-sm font-medium text-foreground">Configured Calendars</p>
              <p class="text-xs text-muted-foreground">
                Add multiple public Google Calendar links to sync them locally.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onclick={addICalRow}
              disabled={icalUrls.length > 0 && !icalUrls[icalUrls.length - 1].trim()}
              class="w-full sm:w-auto shrink-0"
            >
              <Plus class="w-4 h-4 mr-1.5" />
              Add iCal Link
            </Button>
          </div>

          <div class="space-y-3">
            {#each icalUrls as url, index (index)}
              {@const isUrlSynced = Boolean(url) && syncedUrlSet.has(url)}
              <div class="flex flex-col md:flex-row gap-2.5 items-stretch md:items-center p-3 rounded-xl bg-muted/20 border border-border/40">
                <div class="flex-1 min-w-0">
                  <Input
                    type="text"
                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                    bind:value={icalUrls[index]}
                    oninput={() => persistICalUrls(icalUrls, false)}
                    onchange={() => persistICalUrls(icalUrls, true)}
                    readonly={isUrlSynced}
                    class={isUrlSynced
                      ? "bg-muted/50 text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0 cursor-text select-all text-xs"
                      : "text-xs"}
                  />
                </div>
                <div class="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-9 min-w-24 text-xs font-medium"
                    onclick={() => handleICalSync(index)}
                    disabled={syncingIndex !== null || !icalUrls[index]}
                  >
                    {#if syncingIndex === index}
                      <Loader2 class="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Syncing...
                    {:else}
                      <RotateCcw class="w-3.5 h-3.5 mr-1.5" />
                      Sync Now
                    {/if}
                  </Button>
                  {#if icalUrls.length > 1}
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-9 px-2.5 text-red-500 hover:text-red-600 hover:bg-red-500/10 border-red-500/20"
                      onclick={() => removeICalRow(index)}
                      title="Remove iCal"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </Button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          <p class="text-xs text-muted-foreground pt-1">
            To get this link, go to Google Calendar Settings &gt; Settings for my calendars &gt;
            Integrate calendar &gt; Secret address in iCal format.
          </p>
        </div>
      </div>
    </div>

    <!-- Category 6: Shortcuts & Resources -->
    <div class="space-y-3.5">
      {@render sectionHeader(HelpCircle, "Shortcuts & Resources", "text-pink-500")}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <!-- Keyboard Shortcuts -->
        <div
          class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
        >
          <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
            <div class="flex items-center gap-2.5">
              <div class="p-1.5 rounded-md bg-pink-500/10">
                <Keyboard class="w-4 h-4 text-pink-500" />
              </div>
              <h3 class="font-semibold leading-none tracking-tight text-sm">Keyboard Shortcuts</h3>
            </div>
            <p class="text-xs text-muted-foreground pl-8">
              Customize keybindings for common actions.
            </p>
          </div>
          <div
            class="p-5 flex-1 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl"
          >
            <div class="space-y-0.5">
              <p class="text-sm font-medium text-foreground">Custom Keybindings</p>
              <p class="text-xs text-muted-foreground">
                Speed up your workflow with personalized hotkeys.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onclick={() => (isShortcutModalOpen = true)}
              class="w-full sm:w-auto shrink-0 font-medium"
            >
              <Keyboard class="w-4 h-4 mr-2" />
              Configure
            </Button>
          </div>
        </div>

        <!-- User Guide -->
        <div
          class="flex flex-col rounded-2xl card-aura-responsive border-premium-border shadow-2xl overflow-hidden"
        >
          <div class="flex flex-col space-y-1 p-5 border-b border-premium-border bg-transparent">
            <div class="flex items-center gap-2.5">
              <div class="p-1.5 rounded-md bg-purple-500/10">
                <BookOpen class="w-4 h-4 text-purple-500" />
              </div>
              <h3 class="font-semibold leading-none tracking-tight text-sm">User Guide &amp; Help</h3>
            </div>
            <p class="text-xs text-muted-foreground pl-8">
              Learn how to use Personal OS features and shortcuts.
            </p>
          </div>
          <div
            class="p-5 flex-1 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-[inset_0_0.25rem_1.25rem_rgba(0,0,0,0.02)] dark:shadow-none rounded-b-2xl"
          >
            <div class="space-y-0.5">
              <p class="text-sm font-medium text-foreground">Documentation & Tips</p>
              <p class="text-xs text-muted-foreground">
                Explore feature tutorials, usage guides, and FAQs.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onclick={() => (isGuideModalOpen = true)}
              class="w-full sm:w-auto shrink-0 font-medium"
            >
              <HelpCircle class="w-4 h-4 mr-2" />
              Open Guide
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <BackupConflictModal
    isOpen={isConflictModalOpen}
    diffResult={pendingDiffResult}
    onConfirm={(resolutions) => {
      if (pendingDiffResult) {
        applyRestore(pendingDiffResult, resolutions);
      }
    }}
    onCancel={() => {
      isConflictModalOpen = false;
      pendingDiffResult = null;
    }}
  />

  <BackupExportModal
    isOpen={isExportModalOpen}
    onConfirm={handleConfirmExport}
    onCancel={() => (isExportModalOpen = false)}
  />

  <BackupPasswordPromptModal
    isOpen={isRestorePasswordModalOpen}
    filePath={pendingImportFilePath || ""}
    error={restorePasswordError}
    isSubmitting={isAnalyzingEncrypted}
    onSubmit={(pwd) => {
      if (pendingImportFilePath) {
        processBackupFile(pendingImportFilePath, pwd);
      }
    }}
    onCancel={() => {
      isRestorePasswordModalOpen = false;
      pendingImportFilePath = null;
      restorePasswordError = null;
    }}
  />
</div>

import { invoke } from "@tauri-apps/api/core";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db/client";
import {
  tasks,
  events,
  documents,
  documentFolders,
  vault,
  taskGroups,
  eventGroups,
  vaultGroups,
} from "../../shared/db/schema";
import { toastState } from "../../shared/toast.svelte";
import { playNotificationSound } from "../../shared/utils/sound";
import { taskStore } from "../../shared/taskStore.svelte";
import { documentRepo } from "../../shared/db/repo/documentRepo";
import { eventStore } from "../../shared/eventStore.svelte";
import { vaultStore } from "../../shared/vaultStore.svelte";
import { autoCleanupStore } from "../../shared/autoCleanupStore.svelte";
import { uiPreferenceRepo } from "../../shared/db/repo/uiPreferenceRepo";
import { VaultCrypto } from "../vault/crypto";

const BACKUP_SETTINGS_KEYS: readonly string[] = [
  "theme",
  "water_reminder_enabled",
  "water_reminder_interval",
  "sedentary_enabled",
  "sedentary_interval",
  "eyecare_enabled",
  "eyecare_interval",
  "auto_cleanup_config",
  "shortcut_config",
  "documents_path",
  "google_ical_urls",
  "google_ical_url",
  "synced_ical_urls",
  "personal-os-ical-name",
  "weather_city",
  "weather_auto_coords",
  "personal_os_guide_lang",
  "dashboard_task_expanded_groups",
  "dashboard_task_group_order",
  "dashboard_task_collapsed_subs",
  "dashboard_event_tab",
  "personal_os_event_completions",
  "personal_os_task_view",
  "personal_os_task_expanded_parents",
  "personal_os_collapsed_subgroups_with_tasks",
  "personal_os_note_expanded_parents",
  "personal_os_vault_expanded_parents",
  "personal_os_task_group_order",
  "personal_os_event_group_order",
  "personal_os_vault_group_order",
  "personal_os_note_group_order",
];

const WINDOWS_DRIVE_PREFIX_REGEX = /^[a-zA-Z]:[\\/]/;
const TRAILING_SLASHES_REGEX = /[\\/]+$/;
const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/g;
const PATH_TRAVERSAL_SEGMENT_REGEX = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
const GOOGLE_SOURCE_PREFIX = "GOOGLE::";

const IS_WINDOWS_PLATFORM =
  typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("windows");

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

function collectICalUrlsFromSources(
  rawSources: ReadonlyArray<string | ReadonlyArray<string> | null | undefined>
): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  const addCandidateUrl = (candidate: unknown) => {
    if (typeof candidate !== "string") return;
    const trimmed = candidate.replace(CONTROL_CHARS_REGEX, "").trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      urls.push(trimmed);
    }
  };

  for (let i = 0; i < rawSources.length; i++) {
    const src = rawSources[i];
    if (!src) continue;
    if (Array.isArray(src)) {
      for (let j = 0; j < src.length; j++) {
        addCandidateUrl(src[j]);
      }
      continue;
    }
    if (typeof src !== "string") continue;
    const trimmed = src.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (let j = 0; j < parsed.length; j++) {
            addCandidateUrl(parsed[j]);
          }
        }
      } catch {}
    } else {
      addCandidateUrl(trimmed);
    }
  }

  return urls;
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof (error as any).message === "string") {
      return (error as any).message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function isPlatformPathValid(path: string | null | undefined): boolean {
  if (!path || typeof path !== "string") return false;
  const trimmed = path.trim();
  if (!trimmed || CONTROL_CHARS_REGEX.test(trimmed) || PATH_TRAVERSAL_SEGMENT_REGEX.test(trimmed)) {
    return false;
  }

  if (IS_WINDOWS_PLATFORM) {
    if (trimmed.startsWith("/") || trimmed.startsWith("\\home")) {
      return false;
    }
    return WINDOWS_DRIVE_PREFIX_REGEX.test(trimmed) || trimmed.startsWith("\\\\");
  }

  if (WINDOWS_DRIVE_PREFIX_REGEX.test(trimmed)) {
    return false;
  }
  return trimmed.startsWith("/");
}

export async function exportBackupData(customDestZipPath?: string, password?: string): Promise<void> {
  let vaultKey: string | null = null;

  try {
    const isEncrypted = Boolean(password && password.trim());
    toastState.add(
      "info",
      isEncrypted ? "Packaging Encrypted Full System Backup..." : "Packaging Full System ZIP Archive..."
    );

    const rawBasePath = safeGetStorageItem("documents_path");
    const customBasePath = isPlatformPathValid(rawBasePath) ? rawBasePath : null;

    const [
      allRawTasks,
      allRawEvents,
      allRawDocs,
      allRawFolders,
      allRawVault,
      allTaskGroups,
      allEventGroups,
      allRawVaultGroups,
      diskTreeEntries,
    ] = await Promise.all([
      db.select().from(tasks),
      db.select().from(events),
      db.select().from(documents),
      db.select().from(documentFolders),
      db.select().from(vault),
      db.select().from(taskGroups),
      db.select().from(eventGroups),
      db.select().from(vaultGroups),
      invoke<
        Array<{
          name: string;
          path: string;
          parent_path: string | null;
          is_dir: boolean;
          size: number;
          updated_at: number;
        }>
      >("scan_document_tree", { basePath: customBasePath, scope: null }).catch(() => []),
    ]);

    const trashedFolderIds = new Set<string>();
    for (const f of allRawFolders) {
      if (f.deletedAt != null) trashedFolderIds.add(f.id);
    }
    let folderAdded = true;
    while (folderAdded) {
      folderAdded = false;
      for (const f of allRawFolders) {
        if (!trashedFolderIds.has(f.id) && f.parentId && trashedFolderIds.has(f.parentId)) {
          trashedFolderIds.add(f.id);
          folderAdded = true;
        }
      }
    }

    const folderByIdMap = new Map<string, (typeof allRawFolders)[number]>();
    for (const f of allRawFolders) {
      if (!trashedFolderIds.has(f.id)) {
        const normalizedId = f.id.replace(/\\/g, "/");
        folderByIdMap.set(normalizedId, { ...f, id: normalizedId });
      }
    }

    const docByIdMap = new Map<string, (typeof allRawDocs)[number]>();
    for (const d of allRawDocs) {
      if (d.deletedAt == null && (!d.folderId || !trashedFolderIds.has(d.folderId))) {
        const normalizedId = d.id.replace(/\\/g, "/");
        docByIdMap.set(normalizedId, { ...d, id: normalizedId });
      }
    }

    if (Array.isArray(diskTreeEntries)) {
      const nowMs = Date.now();
      for (let i = 0; i < diskTreeEntries.length; i++) {
        const entry = diskTreeEntries[i];
        if (!entry || !entry.path) continue;
        const relPath = entry.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        if (!relPath) continue;
        const fullId = relPath.startsWith("docs/") ? relPath : `docs/${relPath}`;
        const parentRel = entry.parent_path
          ? entry.parent_path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
          : null;
        const parentId = parentRel
          ? parentRel.startsWith("docs/")
            ? parentRel
            : `docs/${parentRel}`
          : null;

        if (entry.is_dir) {
          const existingFolder = folderByIdMap.get(fullId);
          folderByIdMap.set(fullId, {
            id: fullId,
            name: entry.name,
            parentId,
            createdAt: existingFolder?.createdAt || entry.updated_at || nowMs,
            updatedAt: entry.updated_at || existingFolder?.updatedAt || nowMs,
            deletedAt: null,
          });
        } else {
          const existingDoc = docByIdMap.get(fullId);
          docByIdMap.set(fullId, {
            id: fullId,
            name: entry.name,
            folderId: parentId,
            size: entry.size || 0,
            mimeType: existingDoc?.mimeType || "application/octet-stream",
            storageProvider: "LOCAL",
            remotePath: null,
            localPath: fullId,
            createdAt: existingDoc?.createdAt || entry.updated_at || nowMs,
            updatedAt: entry.updated_at || existingDoc?.updatedAt || nowMs,
            deletedAt: null,
          });
        }
      }
    }

    const allFolders = Array.from(folderByIdMap.values());
    const allDocs = Array.from(docByIdMap.values());

    // Exclude trashed vault groups and cascade exclude child groups & vault items
    const trashedVaultGroupIds = new Set<string>();
    for (const g of allRawVaultGroups) {
      if (g.deletedAt != null) trashedVaultGroupIds.add(g.id);
    }
    let vaultGroupAdded = true;
    while (vaultGroupAdded) {
      vaultGroupAdded = false;
      for (const g of allRawVaultGroups) {
        if (!trashedVaultGroupIds.has(g.id) && g.parentId && trashedVaultGroupIds.has(g.parentId)) {
          trashedVaultGroupIds.add(g.id);
          vaultGroupAdded = true;
        }
      }
    }
    const allVaultGroups = allRawVaultGroups.filter((g) => !trashedVaultGroupIds.has(g.id));
    const allVault = allRawVault.filter(
      (v) => v.deletedAt == null && (!v.groupId || !trashedVaultGroupIds.has(v.groupId))
    );

    const allTasks = allRawTasks.filter((t) => t.deletedAt == null);

    const allEvents = [];
    const eventExtractedUrls: string[] = [];
    for (let i = 0; i < allRawEvents.length; i++) {
      const ev = allRawEvents[i];
      const source = ev.source;
      if (source?.startsWith(GOOGLE_SOURCE_PREFIX)) {
        const extractedUrl = source.slice(GOOGLE_SOURCE_PREFIX.length);
        if (extractedUrl) eventExtractedUrls.push(extractedUrl);
      }
      if (!source?.startsWith("GOOGLE") && ev.groupId !== "GOOGLE_CALENDAR") {
        allEvents.push(ev);
      }
    }

    try {
      vaultKey = await invoke<string>("get_vault_key");
    } catch {}
    if (!vaultKey && vaultStore.masterKey) {
      vaultKey = vaultStore.masterKey;
      try {
        await invoke("save_vault_key", { key: vaultKey });
      } catch {}
    }
    if (!vaultKey && allVault.length > 0) {
      try {
        await VaultCrypto.decrypt(allVault[0].encryptedData, "default");
        vaultKey = "default";
      } catch {}
    }

    if (vaultKey && allVault.length > 0) {
      const activeVaultKey = vaultKey;
      const fallbackKeys = Array.from(
        new Set(
          [vaultStore.masterKey, "default"].filter(
            (k): k is string => Boolean(k) && k !== activeVaultKey
          )
        )
      );

      // Only check decryption if there are actual fallback keys to migrate from
      if (fallbackKeys.length > 0) {
        // Fast test on the first item: if it decrypts with activeVaultKey, all items are already consistent
        let primaryKeyWorks = false;
        try {
          await VaultCrypto.decrypt(allVault[0].encryptedData, activeVaultKey);
          primaryKeyWorks = true;
        } catch {}

        if (!primaryKeyWorks) {
          for (let i = 0; i < allVault.length; i++) {
            const vItem = allVault[i];
            let canDecryptWithPrimary = false;
            try {
              await VaultCrypto.decrypt(vItem.encryptedData, activeVaultKey);
              canDecryptWithPrimary = true;
            } catch {}

            if (!canDecryptWithPrimary) {
              for (let j = 0; j < fallbackKeys.length; j++) {
                try {
                  const plain = await VaultCrypto.decrypt(vItem.encryptedData, fallbackKeys[j]);
                  const reEncrypted = await VaultCrypto.encrypt(plain, activeVaultKey);
                  vItem.encryptedData = reEncrypted;
                  await db.update(vault).set({ encryptedData: reEncrypted }).where(eq(vault.id, vItem.id));
                  break;
                } catch {}
              }
            }
          }
        }
      }
    }

    const prefIcalUrls = await uiPreferenceRepo.get("google_ical_urls");
    const mergedIcalUrls = collectICalUrlsFromSources([
      safeGetStorageItem("google_ical_urls"),
      prefIcalUrls,
      safeGetStorageItem("google_ical_url"),
      safeGetStorageItem("synced_ical_urls"),
      eventExtractedUrls,
    ]);

    let serializedMergedUrls: string | null = null;
    if (mergedIcalUrls.length > 0) {
      serializedMergedUrls = JSON.stringify(mergedIcalUrls);
      safeSetStorageItem("google_ical_urls", serializedMergedUrls);
      await uiPreferenceRepo.set("google_ical_urls", serializedMergedUrls);
    }

    const systemSettings: Record<string, string | null> = {};
    for (let i = 0; i < BACKUP_SETTINGS_KEYS.length; i++) {
      const key = BACKUP_SETTINGS_KEYS[i];
      systemSettings[key] = safeGetStorageItem(key);
    }
    if (serializedMergedUrls) {
      systemSettings["google_ical_urls"] = serializedMergedUrls;
    }
    systemSettings["synced_ical_urls"] = "[]";

    const rawUiPrefs = await uiPreferenceRepo.getAll();
    const allUiPrefs = new Array(rawUiPrefs.length);
    for (let i = 0; i < rawUiPrefs.length; i++) {
      const pref = rawUiPrefs[i];
      allUiPrefs[i] = pref.key === "synced_ical_urls" ? { ...pref, value: "[]" } : pref;
    }

    const manifestPayload = {
      version: 3,
      exportedAt: new Date().toISOString(),
      tasks: allTasks,
      taskGroups: allTaskGroups,
      events: allEvents,
      eventGroups: allEventGroups,
      documents: allDocs,
      documentFolders: allFolders,
      vault: allVault,
      vaultGroups: allVaultGroups,
      uiPreferences: allUiPrefs,
      vaultKey,
      settings: systemSettings,
    };

    const manifestJson = JSON.stringify(manifestPayload, null, 2);

    let destZipPath = customDestZipPath;
    if (!destZipPath) {
      let docsPath = safeGetStorageItem("documents_path");
      if (!docsPath || !isPlatformPathValid(docsPath)) {
        docsPath = await getDefaultDocumentDir();
      }
      if (!docsPath) {
        throw new Error("Could not determine backup destination path");
      }

      const ext = isEncrypted ? "posbackup" : "zip";
      const fileName = `personal_os_full_backup_${new Date().toISOString().split("T")[0]}.${ext}`;
      const cleanDocsPath = docsPath.replace(TRAILING_SLASHES_REGEX, "");
      destZipPath = `${cleanDocsPath}/${fileName}`;
    }

    await invoke("create_backup_zip", {
      manifestJson,
      docsBasePath: customBasePath,
      destZipPath,
      password: password && password.trim() ? password.trim() : null,
    });

    toastState.add(
      "success",
      isEncrypted
        ? "Encrypted Full System Backup (.posbackup) exported successfully!"
        : "Full System ZIP Backup exported successfully!"
    );
    playNotificationSound();
  } catch (error: unknown) {
    const errMsg = formatErrorMessage(error);
    toastState.add("error", `Export failed: ${errMsg}`);
    throw error;
  } finally {
    vaultKey = null;
  }
}

export async function pickDocumentsFolderApi(currentPath: string): Promise<string | null> {
  try {
    const selected = await invoke<string | null>("pick_folder", {
      defaultPath: currentPath && isPlatformPathValid(currentPath) ? currentPath : null,
    });
    if (selected && isPlatformPathValid(selected)) {
      safeSetStorageItem("documents_path", selected);
      toastState.add("success", "Documents path saved successfully");
      return selected;
    }
    return null;
  } catch (error) {
    toastState.add("error", "Failed to select folder");
    throw error;
  }
}

export async function resetDocumentsFolderApi(): Promise<string> {
  try {
    const defaultDir = await getDefaultDocumentDir();
    if (defaultDir) {
      safeSetStorageItem("documents_path", defaultDir);
    }
    toastState.add("success", "Documents path reset to default");
    return defaultDir;
  } catch (error) {
    toastState.add("error", "Failed to reset Documents path");
    throw error;
  }
}

export async function getDefaultDocumentDir(): Promise<string> {
  try {
    const dir = await invoke<string>("get_default_document_dir");
    return typeof dir === "string" ? dir : "";
  } catch {
    return "";
  }
}

export async function runManualCleanup(): Promise<{
  tasksCleaned: number;
  eventsCleaned: number;
  docsCleaned: number;
  vaultCleaned: number;
  totalCleaned: number;
}> {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  autoCleanupStore.init();
  const cfg = autoCleanupStore.config;

  const initPromises: Promise<void>[] = [];
  if (!taskStore.isInitialized) initPromises.push(taskStore.fetchAll());
  if (!eventStore.isInitialized) initPromises.push(eventStore.fetchAll());
  if (!vaultStore.isInitialized) initPromises.push(vaultStore.fetchAll());
  if (initPromises.length > 0) {
    await Promise.all(initPromises);
  }

  let tasksCleaned = 0;
  let eventsCleaned = 0;
  let docsCleaned = 0;
  let vaultCleaned = 0;

  if (cfg.cleanTasks) {
    const before = taskStore.tasks.length;
    await taskStore.cleanupAuto(cfg.tasksRetentionDays);
    tasksCleaned = Math.max(0, before - taskStore.tasks.length);
  }

  if (cfg.cleanEvents) {
    const before = eventStore.events.length;
    await eventStore.cleanupAuto(cfg.eventsRetentionDays);
    eventsCleaned = Math.max(0, before - eventStore.events.length);
  }

  if (cfg.cleanDocuments) {
    const retentionMs = cfg.documentsRetentionDays * ONE_DAY_MS;
    await documentRepo.cleanupAuto(retentionMs);
    try {
      await invoke("cleanup_documents_trash", { retentionMs });
    } catch {}
  }

  if (cfg.cleanVault) {
    const before = vaultStore.items.length;
    await vaultStore.cleanupAuto(cfg.vaultRetentionDays);
    vaultCleaned = Math.max(0, before - vaultStore.items.length);
  }

  const totalCleaned = tasksCleaned + eventsCleaned + docsCleaned + vaultCleaned;
  return { tasksCleaned, eventsCleaned, docsCleaned, vaultCleaned, totalCleaned };
}

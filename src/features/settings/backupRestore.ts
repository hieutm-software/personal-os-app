import { invoke } from "@tauri-apps/api/core";
import { eq, isNull } from "drizzle-orm";
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
  type Task,
  type DocumentItem,
  type VaultItem,
  type Event,
} from "../../shared/db/schema";
import { uiPreferenceRepo } from "../../shared/db/repo/uiPreferenceRepo";
import { taskStore } from "../../shared/taskStore.svelte";
import { eventStore } from "../../shared/eventStore.svelte";
import { vaultStore } from "../../shared/vaultStore.svelte";
import { themeStore } from "../../shared/theme.svelte";
import { healthStore } from "../../shared/healthStore.svelte";
import { autoCleanupStore } from "../../shared/autoCleanupStore.svelte";
import { shortcutStore } from "../../shared/shortcutStore.svelte";
import { pauseICalSync, resumeICalSync } from "../calendar/icalSync";
import { VaultCrypto } from "../vault/crypto";
import {
  getDefaultDocumentDir,
  isPlatformPathValid,
} from "./api";

export interface BackupConflictItem {
  id: string;
  category: "tasks" | "documents" | "vault" | "events";
  categoryLabel: string;
  title: string;
  path?: string;
  localItem: any;
  backupItem: any;
  localUpdatedAt?: number;
  backupUpdatedAt?: number;
  localPreview?: string;
  backupPreview?: string;
  resolution: "overwrite" | "keep_local";
}

export interface BackupDiffResult {
  filePath: string;
  manifest: Record<string, any>;
  conflicts: BackupConflictItem[];
  newItemsCount: number;
  identicalCount: number;
  totalBackupItems: number;
  password?: string | null;
}

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

export async function analyzeBackup(filePath: string, password?: string): Promise<BackupDiffResult> {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("Invalid backup file path");
  }

  const cleanPath = filePath.trim();
  const manifestText = await invoke<string>("inspect_backup_manifest", {
    absolutePath: cleanPath,
    password: password && password.trim() ? password.trim() : null,
  });

  if (!manifestText || !manifestText.trim()) {
    throw new Error("Backup file contains no readable manifest");
  }

  const manifest = JSON.parse(manifestText);
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Corrupted backup manifest structure");
  }

  const rawLocalBasePath = safeGetStorageItem("documents_path");
  const customLocalBasePath = isPlatformPathValid(rawLocalBasePath) ? rawLocalBasePath : null;

  const [
    localTasks,
    localDocs,
    localVault,
    localEvents,
    localDiskTree,
  ] = await Promise.all([
    db.select().from(tasks),
    db.select().from(documents),
    db.select().from(vault),
    db.select().from(events),
    invoke<
      Array<{
        name: string;
        path: string;
        parent_path: string | null;
        is_dir: boolean;
        size: number;
        updated_at: number;
      }>
    >("scan_document_tree", { basePath: customLocalBasePath, scope: null }).catch(() => []),
  ]);

  const conflicts: BackupConflictItem[] = [];
  let newItemsCount = 0;
  let identicalCount = 0;
  let totalBackupItems = 0;

  if (Array.isArray(manifest.notes)) {
    for (const bNote of manifest.notes) {
      if (!bNote || !bNote.title || bNote.deletedAt != null) continue;
      totalBackupItems++;
      newItemsCount++;
    }
  }

  if (Array.isArray(manifest.tasks)) {
    const localTaskById = new Map<string, Task>();
    const localTaskMap = new Map<string, Task>();
    for (const t of localTasks) {
      if (t.deletedAt == null) {
        localTaskById.set(t.id, t);
        localTaskMap.set(t.title.trim().toLowerCase(), t);
      }
    }

    for (const bTask of manifest.tasks) {
      if (!bTask || !bTask.title || bTask.deletedAt != null) continue;
      totalBackupItems++;
      const key = bTask.title.trim().toLowerCase();
      const local = (bTask.id ? localTaskById.get(bTask.id) : null) || localTaskMap.get(key);

      if (local) {
        const backupStatus = bTask.status || (bTask.completed ? "COMPLETED" : "PENDING");
        const isIdentical =
          local.status === backupStatus &&
          (local.description || "").trim() === (bTask.description || "").trim() &&
          (local.dueDate || null) === (bTask.dueDate || null) &&
          local.title.trim().toLowerCase() === key;
        if (isIdentical) {
          identicalCount++;
        } else {
          const defaultRes: "overwrite" | "keep_local" =
            (bTask.updatedAt || 0) > (local.updatedAt || 0) ? "overwrite" : "keep_local";
          conflicts.push({
            id: `task:${local.id}`,
            category: "tasks",
            categoryLabel: "Tasks",
            title: bTask.title,
            localItem: local,
            backupItem: bTask,
            localUpdatedAt: local.updatedAt,
            backupUpdatedAt: bTask.updatedAt,
            localPreview: `Status: ${local.status === "COMPLETED" ? "Completed" : "Pending"}${local.dueDate ? " | Due: " + new Date(local.dueDate).toLocaleDateString() : ""}`,
            backupPreview: `Status: ${backupStatus === "COMPLETED" ? "Completed" : "Pending"}${bTask.dueDate ? " | Due: " + new Date(bTask.dueDate).toLocaleDateString() : ""}`,
            resolution: defaultRes,
          });
        }
      } else {
        newItemsCount++;
      }
    }
  }

  if (Array.isArray(manifest.documents)) {
    const localDocById = new Map<string, DocumentItem>();
    const localDocMap = new Map<string, DocumentItem>();
    for (const d of localDocs) {
      if (d.deletedAt == null) {
        const normId = d.id.replace(/\\/g, "/");
        const normFolder = d.folderId ? d.folderId.replace(/\\/g, "/") : "";
        localDocById.set(normId, { ...d, id: normId, folderId: normFolder || null });
        localDocMap.set(`${normFolder.toLowerCase()}:::${d.name.trim().toLowerCase()}`, {
          ...d,
          id: normId,
          folderId: normFolder || null,
        });
      }
    }

    if (Array.isArray(localDiskTree)) {
      const nowMs = Date.now();
      for (let i = 0; i < localDiskTree.length; i++) {
        const entry = localDiskTree[i];
        if (!entry || entry.is_dir || !entry.path) continue;
        const relPath = entry.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
        if (!relPath) continue;
        const fullId = relPath.startsWith("docs/") ? relPath : `docs/${relPath}`;
        const parentRel = entry.parent_path
          ? entry.parent_path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
          : "";
        const folderId = parentRel
          ? parentRel.startsWith("docs/")
            ? parentRel
            : `docs/${parentRel}`
          : null;
        const existing = localDocById.get(fullId);
        const docItem: DocumentItem = {
          id: fullId,
          name: entry.name,
          folderId,
          size: entry.size || 0,
          mimeType: existing?.mimeType || "application/octet-stream",
          storageProvider: "LOCAL",
          remotePath: null,
          localPath: fullId,
          createdAt: existing?.createdAt || entry.updated_at || nowMs,
          updatedAt: entry.updated_at || existing?.updatedAt || nowMs,
          deletedAt: null,
        };
        localDocById.set(fullId, docItem);
        localDocMap.set(`${(folderId || "").toLowerCase()}:::${entry.name.trim().toLowerCase()}`, docItem);
      }
    }

    for (const bDoc of manifest.documents) {
      if (!bDoc || !bDoc.name || bDoc.deletedAt != null) continue;
      totalBackupItems++;
      const normBackupId = typeof bDoc.id === "string" ? bDoc.id.replace(/\\/g, "/") : "";
      const normBackupFolder =
        typeof bDoc.folderId === "string" ? bDoc.folderId.replace(/\\/g, "/") : "";
      const compositeKey = `${normBackupFolder.toLowerCase()}:::${bDoc.name.trim().toLowerCase()}`;
      const local =
        (normBackupId ? localDocById.get(normBackupId) : null) || localDocMap.get(compositeKey);

      if (local) {
        const isIdentical =
          local.size === bDoc.size &&
          local.name.trim().toLowerCase() === bDoc.name.trim().toLowerCase();
        if (isIdentical) {
          identicalCount++;
        } else {
          const defaultRes: "overwrite" | "keep_local" =
            (bDoc.updatedAt || 0) > (local.updatedAt || 0) ? "overwrite" : "keep_local";
          conflicts.push({
            id: `doc:${local.id}`,
            category: "documents",
            categoryLabel: "Documents",
            title: bDoc.name,
            path: normBackupFolder ? normBackupFolder.replace(/^docs\//, "") : "Root folder",
            localItem: local,
            backupItem: bDoc,
            localUpdatedAt: local.updatedAt,
            backupUpdatedAt: bDoc.updatedAt,
            localPreview: `Size: ${(local.size / 1024).toFixed(1)} KB | Type: ${local.mimeType || "File"}`,
            backupPreview: `Size: ${(bDoc.size / 1024).toFixed(1)} KB | Type: ${bDoc.mimeType || bDoc.fileType || "File"}`,
            resolution: defaultRes,
          });
        }
      } else {
        newItemsCount++;
      }
    }
  }

  if (Array.isArray(manifest.vault)) {
    const localVaultById = new Map<string, VaultItem>();
    const localVaultMap = new Map<string, VaultItem>();
    for (const v of localVault) {
      if (v.deletedAt == null) {
        localVaultById.set(v.id, v);
        localVaultMap.set(v.name.trim().toLowerCase(), v);
      }
    }

    for (const bVault of manifest.vault) {
      if (!bVault || !bVault.name || bVault.deletedAt != null) continue;
      totalBackupItems++;
      const key = bVault.name.trim().toLowerCase();
      const local = (bVault.id ? localVaultById.get(bVault.id) : null) || localVaultMap.get(key);

      if (local) {
        if (local.encryptedData === bVault.encryptedData && local.name.trim().toLowerCase() === key) {
          identicalCount++;
        } else {
          const defaultRes: "overwrite" | "keep_local" =
            (bVault.updatedAt || 0) > (local.updatedAt || 0) ? "overwrite" : "keep_local";
          conflicts.push({
            id: `vault:${local.id}`,
            category: "vault",
            categoryLabel: "Vault",
            title: bVault.name,
            localItem: local,
            backupItem: bVault,
            localUpdatedAt: local.updatedAt,
            backupUpdatedAt: bVault.updatedAt,
            localPreview: `Current local version (${new Date(local.updatedAt).toLocaleDateString()})`,
            backupPreview: `Backup file version (${new Date(bVault.updatedAt || Date.now()).toLocaleDateString()})`,
            resolution: defaultRes,
          });
        }
      } else {
        newItemsCount++;
      }
    }
  }

  if (Array.isArray(manifest.events)) {
    const localEventById = new Map<string, Event>();
    const localEventMap = new Map<string, Event>();
    for (const e of localEvents) {
      if (e.source?.startsWith("GOOGLE") || e.groupId === "GOOGLE_CALENDAR") continue;
      localEventById.set(e.id, e);
      const key = `${e.title.trim().toLowerCase()}:::${e.startTime}`;
      localEventMap.set(key, e);
    }

    for (const bEvent of manifest.events) {
      if (
        !bEvent ||
        !bEvent.title ||
        bEvent.source?.startsWith("GOOGLE") ||
        bEvent.groupId === "GOOGLE_CALENDAR"
      )
        continue;
      totalBackupItems++;
      const key = `${bEvent.title.trim().toLowerCase()}:::${bEvent.startTime}`;
      const local = (bEvent.id ? localEventById.get(bEvent.id) : null) || localEventMap.get(key);

      if (local) {
        const isIdentical =
          local.endTime === bEvent.endTime &&
          (local.description || "").trim() === (bEvent.description || "").trim() &&
          local.title.trim().toLowerCase() === bEvent.title.trim().toLowerCase();
        if (isIdentical) {
          identicalCount++;
        } else {
          const defaultRes: "overwrite" | "keep_local" =
            (bEvent.updatedAt || 0) > (local.updatedAt || 0) ? "overwrite" : "keep_local";
          conflicts.push({
            id: `event:${local.id}`,
            category: "events",
            categoryLabel: "Calendar",
            title: bEvent.title,
            localItem: local,
            backupItem: bEvent,
            localUpdatedAt: local.updatedAt,
            backupUpdatedAt: bEvent.updatedAt,
            localPreview: `Time: ${local.startTime || ""} -> ${local.endTime || ""}`,
            backupPreview: `Time: ${bEvent.startTime || ""} -> ${bEvent.endTime || ""}`,
            resolution: defaultRes,
          });
        }
      } else {
        newItemsCount++;
      }
    }
  }

  return {
    filePath: cleanPath,
    manifest,
    conflicts,
    newItemsCount,
    identicalCount,
    totalBackupItems,
    password: password && password.trim() ? password.trim() : null,
  };
}

function sortTopologically<T extends { id: string; parentId?: string | null }>(items: T[]): T[] {
  const result: T[] = [];
  const placed = new Set<string>();
  const remaining = [...items];

  for (let i = remaining.length - 1; i >= 0; i--) {
    if (!remaining[i].parentId) {
      result.push(remaining[i]);
      placed.add(remaining[i].id);
      remaining.splice(i, 1);
    }
  }

  let progress = true;
  while (remaining.length > 0 && progress) {
    progress = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (remaining[i].parentId && placed.has(remaining[i].parentId!)) {
        result.push(remaining[i]);
        placed.add(remaining[i].id);
        remaining.splice(i, 1);
        progress = true;
      }
    }
  }

  if (remaining.length > 0) {
    result.push(...remaining);
  }

  return result;
}

export async function executeRestoreWithResolutions(
  diffResult: BackupDiffResult,
  resolutions: Map<string, "overwrite" | "keep_local">,
  onProgress?: (stage: string) => void,
  password?: string | null
): Promise<{ added: number; overwritten: number; kept: number; identical: number; total: number }> {
  pauseICalSync();
  try {
    taskStore.cancelAllPendingUpdates();
  } catch {}

  const { manifest, filePath, conflicts } = diffResult;
  let added = 0;
  let overwritten = 0;
  let kept = 0;

  onProgress?.("Preparing data restoration...");

  const skipFiles: string[] = [];
  for (const c of conflicts) {
    const res = resolutions.get(c.id) || c.resolution;
    if (res === "keep_local") {
      kept++;
      if (c.category === "documents") {
        const rawBackupId =
          typeof c.backupItem?.id === "string"
            ? c.backupItem.id.replace(/\\/g, "/").replace(/^\/+/, "")
            : "";
        const rawLocalId =
          typeof c.localItem?.id === "string"
            ? c.localItem.id.replace(/\\/g, "/").replace(/^\/+/, "")
            : "";
        if (rawBackupId) {
          skipFiles.push(rawBackupId);
          if (!rawBackupId.startsWith("docs/")) skipFiles.push(`docs/${rawBackupId}`);
          else skipFiles.push(rawBackupId.slice(5));
        }
        if (rawLocalId && rawLocalId !== rawBackupId) {
          skipFiles.push(rawLocalId);
          if (!rawLocalId.startsWith("docs/")) skipFiles.push(`docs/${rawLocalId}`);
          else skipFiles.push(rawLocalId.slice(5));
        }
        if (!rawBackupId && !rawLocalId) {
          skipFiles.push(c.title);
          skipFiles.push(`docs/${c.title}`);
        }
      }
    } else {
      overwritten++;
    }
  }

  const [defaultDocsDir] = await Promise.all([getDefaultDocumentDir()]);
  const rawBasePath = safeGetStorageItem("documents_path");
  const activeDocsBasePath = isPlatformPathValid(rawBasePath) ? rawBasePath! : defaultDocsDir;

  const isZip = filePath.toLowerCase().endsWith(".zip") || filePath.toLowerCase().endsWith(".posbackup");
  const effectivePassword = password || diffResult.password || null;

  if (isZip) {
    onProgress?.("Extracting backup archive...");
    try {
      await invoke("extract_backup_zip_absolute", {
        absolutePath: filePath,
        docsBasePath: activeDocsBasePath || null,
        skipFiles: skipFiles.length > 0 ? skipFiles : null,
        skipDbImport: true,
        password: effectivePassword,
      });
    } catch {}
  }

  try {
    onProgress?.("Syncing settings and preferences...");

    if (Array.isArray(manifest.uiPreferences)) {
      for (const pref of manifest.uiPreferences) {
        if (pref && typeof pref.key === "string" && typeof pref.value === "string") {
          if (pref.key === "documents_path" && !isPlatformPathValid(pref.value)) {
            continue;
          }
          const valToSave = pref.key === "synced_ical_urls" ? "[]" : pref.value;
          await uiPreferenceRepo.set(pref.key, valToSave, pref.updated_at || Date.now());
          safeSetStorageItem(pref.key, valToSave);
        }
      }
    }

    if (manifest.settings && typeof manifest.settings === "object") {
      for (const [k, v] of Object.entries(manifest.settings)) {
        if (v != null) {
          const valStr = String(v);
          if (k !== "documents_path" && k !== "synced_ical_urls") {
            safeSetStorageItem(k, valStr);
          }
        }
      }
    }

    onProgress?.("Syncing data groups...");

    const [
      existingTaskGroups,
      existingVaultGroups,
      existingEventGroups,
      existingTasks,
      existingDocs,
      existingVault,
      existingEvents,
    ] = await Promise.all([
      db.select().from(taskGroups),
      db.select().from(vaultGroups).where(isNull(vaultGroups.deletedAt)),
      db.select().from(eventGroups),
      db.select().from(tasks),
      db.select().from(documents),
      db.select().from(vault),
      db.select().from(events),
    ]);

  const taskGroupIdMap = new Map<string, string>();
  for (const g of existingTaskGroups) {
    taskGroupIdMap.set(g.name.trim().toLowerCase(), g.id);
  }
  if (Array.isArray(manifest.taskGroups)) {
    const activeTaskGroups = sortTopologically(
      manifest.taskGroups.filter((g) => g && g.name && g.deletedAt == null)
    );
    for (const g of activeTaskGroups) {
      const key = g.name.trim().toLowerCase();
      const mappedParentId = g.parentId ? (taskGroupIdMap.get(g.parentId) || g.parentId) : null;
      if (taskGroupIdMap.has(key)) {
        const existingId = taskGroupIdMap.get(key)!;
        await db.update(taskGroups).set({
          name: g.name,
          parentId: mappedParentId,
          updatedAt: g.updatedAt || Date.now(),
        }).where(eq(taskGroups.id, existingId));
        taskGroupIdMap.set(g.id, existingId);
      } else {
        await db.insert(taskGroups).values({
          id: g.id,
          name: g.name,
          parentId: mappedParentId,
          createdAt: g.createdAt || Date.now(),
          updatedAt: g.updatedAt || Date.now(),
        }).onConflictDoUpdate({
          target: taskGroups.id,
          set: {
            name: g.name,
            parentId: mappedParentId,
            updatedAt: g.updatedAt || Date.now(),
          },
        });
        taskGroupIdMap.set(g.id, g.id);
        taskGroupIdMap.set(key, g.id);
      }
    }
  }

  const vaultGroupIdMap = new Map<string, string>();
  for (const g of existingVaultGroups) {
    vaultGroupIdMap.set(g.name.trim().toLowerCase(), g.id);
  }
  if (Array.isArray(manifest.vaultGroups)) {
    const activeVaultGroups = sortTopologically(
      manifest.vaultGroups.filter((g) => g && g.name && g.deletedAt == null)
    );
    for (const g of activeVaultGroups) {
      const key = g.name.trim().toLowerCase();
      const mappedParentId = g.parentId ? (vaultGroupIdMap.get(g.parentId) || g.parentId) : null;
      if (vaultGroupIdMap.has(key)) {
        const existingId = vaultGroupIdMap.get(key)!;
        await db.update(vaultGroups).set({
          name: g.name,
          parentId: mappedParentId,
          updatedAt: g.updatedAt || Date.now(),
          deletedAt: null,
        }).where(eq(vaultGroups.id, existingId));
        vaultGroupIdMap.set(g.id, existingId);
      } else {
        await db.insert(vaultGroups).values({
          id: g.id,
          name: g.name,
          parentId: mappedParentId,
          createdAt: g.createdAt || Date.now(),
          updatedAt: g.updatedAt || Date.now(),
          deletedAt: null,
        }).onConflictDoUpdate({
          target: vaultGroups.id,
          set: {
            name: g.name,
            parentId: mappedParentId,
            updatedAt: g.updatedAt || Date.now(),
            deletedAt: null,
          },
        });
        vaultGroupIdMap.set(g.id, g.id);
        vaultGroupIdMap.set(key, g.id);
      }
    }
  }

  const eventGroupIdMap = new Map<string, string>();
  for (const g of existingEventGroups) {
    eventGroupIdMap.set(g.name.trim().toLowerCase(), g.id);
  }
  if (Array.isArray(manifest.eventGroups)) {
    for (const g of manifest.eventGroups) {
      if (!g || !g.name || g.deletedAt != null) continue;
      const key = g.name.trim().toLowerCase();
      if (eventGroupIdMap.has(key)) {
        const existingId = eventGroupIdMap.get(key)!;
        await db.update(eventGroups).set({
          name: g.name,
          color: g.color || null,
          updatedAt: g.updatedAt || Date.now(),
        }).where(eq(eventGroups.id, existingId));
        eventGroupIdMap.set(g.id, existingId);
      } else {
        await db.insert(eventGroups).values({
          id: g.id,
          name: g.name,
          color: g.color || null,
          createdAt: g.createdAt || Date.now(),
          updatedAt: g.updatedAt || Date.now(),
        }).onConflictDoUpdate({
          target: eventGroups.id,
          set: {
            name: g.name,
            color: g.color || null,
            updatedAt: g.updatedAt || Date.now(),
          },
        });
        eventGroupIdMap.set(g.id, g.id);
        eventGroupIdMap.set(key, g.id);
      }
    }
  }

  if (Array.isArray(manifest.documentFolders)) {
    const activeDocFolders = sortTopologically(
      manifest.documentFolders.filter((f) => f && f.id && f.deletedAt == null)
    );
    for (const f of activeDocFolders) {
      const normId = String(f.id).replace(/\\/g, "/");
      const normParentId = f.parentId ? String(f.parentId).replace(/\\/g, "/") : null;
      await db
        .insert(documentFolders)
        .values({
          id: normId,
          name: f.name,
          parentId: normParentId,
          createdAt: f.createdAt || Date.now(),
          updatedAt: f.updatedAt || Date.now(),
          deletedAt: null,
        })
        .onConflictDoUpdate({
          target: documentFolders.id,
          set: {
            name: f.name,
            parentId: normParentId,
            updatedAt: f.updatedAt || Date.now(),
            deletedAt: null,
          },
        });

      try {
        const folderRel = normId.startsWith("docs/") ? normId : `docs/${normId}`;
        await invoke("create_folder", {
          targetPath: `${folderRel}/.keep`,
          basePath: activeDocsBasePath || null,
        });
      } catch {}
    }
  }

  onProgress?.("Merging item records...");

  if (Array.isArray(manifest.notes)) {
    for (const bNote of manifest.notes) {
      if (!bNote || !bNote.title || bNote.deletedAt != null) continue;
      added++;
      const safeTitle = bNote.title.replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled Note";
      const fileName = safeTitle.endsWith(".md") ? safeTitle : `${safeTitle}.md`;
      const targetRelPath = `docs/${fileName}`;
      await invoke("write_file", {
        path: targetRelPath,
        content: bNote.content || "",
        basePath: activeDocsBasePath || null,
      }).catch(() => {});
    }
  }

  if (Array.isArray(manifest.tasks)) {
    const existingById = new Map<string, Task>();
    const existingByTitle = new Map<string, Task>();
    for (const t of existingTasks) {
      existingById.set(t.id, t);
      existingByTitle.set(t.title.trim().toLowerCase(), t);
    }

    for (const bTask of manifest.tasks) {
      if (!bTask || !bTask.title || bTask.deletedAt != null) continue;
      const key = bTask.title.trim().toLowerCase();
      const local = (bTask.id ? existingById.get(bTask.id) : null) || existingByTitle.get(key);
      const mappedGroupId = bTask.groupId ? (taskGroupIdMap.get(bTask.groupId) || null) : null;

      if (local) {
        const conflictId = `task:${local.id}`;
        const res = resolutions.get(conflictId);
        if (res === "keep_local" && local.deletedAt == null) continue;
        const statusToSet = bTask.status || (bTask.completed ? "COMPLETED" : "PENDING");
        await db.update(tasks).set({
          title: bTask.title,
          status: statusToSet,
          description: bTask.description,
          dueDate: bTask.dueDate,
          groupId: mappedGroupId,
          updatedAt: bTask.updatedAt || Date.now(),
          deletedAt: null,
        }).where(eq(tasks.id, local.id));
      } else {
        added++;
        const statusToSet = bTask.status || (bTask.completed ? "COMPLETED" : "PENDING");
        await db.insert(tasks).values({
          id: bTask.id,
          title: bTask.title,
          description: bTask.description,
          status: statusToSet,
          dueDate: bTask.dueDate,
          groupId: mappedGroupId,
          createdAt: bTask.createdAt || Date.now(),
          updatedAt: bTask.updatedAt || Date.now(),
          deletedAt: null,
        }).onConflictDoUpdate({
          target: tasks.id,
          set: {
            title: bTask.title,
            description: bTask.description,
            status: statusToSet,
            dueDate: bTask.dueDate,
            groupId: mappedGroupId,
            updatedAt: bTask.updatedAt || Date.now(),
            deletedAt: null,
          },
        });
      }
    }
  }

  if (Array.isArray(manifest.documents)) {
    const existingById = new Map<string, DocumentItem>();
    const existingByComposite = new Map<string, DocumentItem>();
    for (const d of existingDocs) {
      const normId = d.id.replace(/\\/g, "/");
      const normFolder = d.folderId ? d.folderId.replace(/\\/g, "/") : "";
      existingById.set(normId, d);
      existingByComposite.set(`${normFolder.toLowerCase()}:::${d.name.trim().toLowerCase()}`, d);
    }

    for (const bDoc of manifest.documents) {
      if (!bDoc || !bDoc.name || bDoc.deletedAt != null) continue;
      const normId =
        typeof bDoc.id === "string"
          ? bDoc.id.replace(/\\/g, "/")
          : `docs/${bDoc.name}`;
      const normFolder =
        typeof bDoc.folderId === "string" ? bDoc.folderId.replace(/\\/g, "/") : null;
      const compositeKey = `${(normFolder || "").toLowerCase()}:::${bDoc.name.trim().toLowerCase()}`;
      const local = existingById.get(normId) || existingByComposite.get(compositeKey);

      if (local) {
        const conflictId = `doc:${local.id.replace(/\\/g, "/")}`;
        const res = resolutions.get(conflictId) || resolutions.get(`doc:${local.id}`);
        if (res === "keep_local" && local.deletedAt == null) continue;
        await db.update(documents).set({
          name: bDoc.name,
          folderId: normFolder,
          size: bDoc.size,
          mimeType: bDoc.mimeType || bDoc.fileType || "application/octet-stream",
          storageProvider: bDoc.storageProvider || "LOCAL",
          remotePath: bDoc.remotePath || null,
          localPath: bDoc.localPath ? String(bDoc.localPath).replace(/\\/g, "/") : normId,
          updatedAt: bDoc.updatedAt || Date.now(),
          deletedAt: null,
        }).where(eq(documents.id, local.id));
      } else {
        added++;
        await db.insert(documents).values({
          id: normId,
          name: bDoc.name,
          folderId: normFolder,
          size: bDoc.size || 0,
          mimeType: bDoc.mimeType || bDoc.fileType || "application/octet-stream",
          storageProvider: bDoc.storageProvider || "LOCAL",
          remotePath: bDoc.remotePath || null,
          localPath: bDoc.localPath ? String(bDoc.localPath).replace(/\\/g, "/") : normId,
          createdAt: bDoc.createdAt || Date.now(),
          updatedAt: bDoc.updatedAt || Date.now(),
          deletedAt: null,
        }).onConflictDoUpdate({
          target: documents.id,
          set: {
            name: bDoc.name,
            folderId: normFolder,
            size: bDoc.size || 0,
            mimeType: bDoc.mimeType || bDoc.fileType || "application/octet-stream",
            storageProvider: bDoc.storageProvider || "LOCAL",
            remotePath: bDoc.remotePath || null,
            localPath: bDoc.localPath ? String(bDoc.localPath).replace(/\\/g, "/") : normId,
            updatedAt: bDoc.updatedAt || Date.now(),
            deletedAt: null,
          },
        });
      }
    }
  }

  if (Array.isArray(manifest.vault)) {
    const existingById = new Map<string, VaultItem>();
    const existingByName = new Map<string, VaultItem>();
    for (const v of existingVault) {
      existingById.set(v.id, v);
      existingByName.set(v.name.trim().toLowerCase(), v);
    }

    for (const bVault of manifest.vault) {
      if (!bVault || !bVault.name || bVault.deletedAt != null) continue;
      const key = bVault.name.trim().toLowerCase();
      const local = (bVault.id ? existingById.get(bVault.id) : null) || existingByName.get(key);
      const mappedGroupId = bVault.groupId ? (vaultGroupIdMap.get(bVault.groupId) || null) : null;

      if (local) {
        const conflictId = `vault:${local.id}`;
        const res = resolutions.get(conflictId);
        if (res === "keep_local" && local.deletedAt == null) continue;
        await db.update(vault).set({
          name: bVault.name,
          encryptedData: bVault.encryptedData,
          groupId: mappedGroupId,
          updatedAt: bVault.updatedAt || Date.now(),
          deletedAt: null,
        }).where(eq(vault.id, local.id));
      } else {
        added++;
        await db.insert(vault).values({
          id: bVault.id,
          name: bVault.name,
          encryptedData: bVault.encryptedData,
          groupId: mappedGroupId,
          createdAt: bVault.createdAt || Date.now(),
          updatedAt: bVault.updatedAt || Date.now(),
          deletedAt: null,
        }).onConflictDoUpdate({
          target: vault.id,
          set: {
            name: bVault.name,
            encryptedData: bVault.encryptedData,
            groupId: mappedGroupId,
            updatedAt: bVault.updatedAt || Date.now(),
            deletedAt: null,
          },
        });
      }
    }
  }

  if (Array.isArray(manifest.events)) {
    const existingById = new Map<string, Event>();
    const existingByKey = new Map<string, Event>();
    for (const e of existingEvents) {
      existingById.set(e.id, e);
      existingByKey.set(`${e.title.trim().toLowerCase()}:::${e.startTime}`, e);
    }

    for (const bEvent of manifest.events) {
      if (!bEvent || !bEvent.title || bEvent.source?.startsWith("GOOGLE") || bEvent.groupId === "GOOGLE_CALENDAR")
        continue;
      const key = `${bEvent.title.trim().toLowerCase()}:::${bEvent.startTime}`;
      const local = (bEvent.id ? existingById.get(bEvent.id) : null) || existingByKey.get(key);
      const mappedGroupId = bEvent.groupId ? (eventGroupIdMap.get(bEvent.groupId) || null) : null;

      if (local) {
        const conflictId = `event:${local.id}`;
        const res = resolutions.get(conflictId);
        if (res === "keep_local") continue;
        await db.update(events).set({
          title: bEvent.title,
          description: bEvent.description,
          startTime: bEvent.startTime,
          endTime: bEvent.endTime,
          isAllDay: bEvent.isAllDay,
          recurrence: bEvent.recurrence,
          source: bEvent.source || "LOCAL",
          externalId: bEvent.externalId || null,
          groupId: mappedGroupId,
          updatedAt: bEvent.updatedAt || Date.now(),
        }).where(eq(events.id, local.id));
      } else {
        added++;
        await db.insert(events).values({
          ...bEvent,
          groupId: mappedGroupId,
        }).onConflictDoUpdate({
          target: events.id,
          set: {
            title: bEvent.title,
            description: bEvent.description,
            startTime: bEvent.startTime,
            endTime: bEvent.endTime,
            isAllDay: bEvent.isAllDay,
            recurrence: bEvent.recurrence,
            source: bEvent.source || "LOCAL",
            externalId: bEvent.externalId || null,
            groupId: mappedGroupId,
            updatedAt: bEvent.updatedAt || Date.now(),
          },
        });
      }
    }
  }

  let previousVaultKey: string | null = null;
  try {
    previousVaultKey = await invoke<string>("get_vault_key");
  } catch {}
  const inMemoryMasterKey = vaultStore.masterKey || null;

  let activeVaultKey: string | null = null;
  if (typeof manifest.vaultKey === "string" && manifest.vaultKey.trim()) {
    activeVaultKey = manifest.vaultKey.trim();
    try {
      await invoke("save_vault_key", { key: activeVaultKey });
    } catch {}
  } else if (previousVaultKey) {
    activeVaultKey = previousVaultKey;
  } else if (inMemoryMasterKey) {
    activeVaultKey = inMemoryMasterKey;
  }

  if (activeVaultKey) {
    const candidateKeys = Array.from(
      new Set(
        [
          typeof manifest.vaultKey === "string" ? manifest.vaultKey.trim() : null,
          previousVaultKey?.trim(),
          inMemoryMasterKey?.trim(),
          "default",
        ].filter((k): k is string => Boolean(k) && k !== activeVaultKey)
      )
    );

    const activeVaultItems = await db.select().from(vault).where(isNull(vault.deletedAt));
    if (candidateKeys.length > 0 && activeVaultItems.length > 0) {
      let primaryKeyWorks = false;
      try {
        await VaultCrypto.decrypt(activeVaultItems[0].encryptedData, activeVaultKey);
        primaryKeyWorks = true;
      } catch {}

      if (!primaryKeyWorks) {
        for (let i = 0; i < activeVaultItems.length; i++) {
          const vItem = activeVaultItems[i];
          let canDecrypt = false;
          try {
            await VaultCrypto.decrypt(vItem.encryptedData, activeVaultKey);
            canDecrypt = true;
          } catch {}

          if (!canDecrypt) {
            for (let j = 0; j < candidateKeys.length; j++) {
              try {
                const plain = await VaultCrypto.decrypt(vItem.encryptedData, candidateKeys[j]);
                const reEncrypted = await VaultCrypto.encrypt(plain, activeVaultKey);
                await db.update(vault).set({ encryptedData: reEncrypted }).where(eq(vault.id, vItem.id));
                break;
              } catch {}
            }
          }
        }
      }
    }

    vaultStore.masterKey = activeVaultKey;
    vaultStore.decryptedDataCache = {};
  }
} finally {
  resumeICalSync();
}

  onProgress?.("Refreshing application state...");

  await Promise.all([
    taskStore.fetchAll(),
    eventStore.fetchAll(),
    vaultStore.fetchAll(),
  ]);

  try {
    themeStore.init();
    healthStore.init();
    autoCleanupStore.init();
    shortcutStore.init(true);
    window.dispatchEvent(new Event("fs-changed"));
    window.dispatchEvent(new CustomEvent("documents-path-changed"));
    window.dispatchEvent(new CustomEvent("backup-restored"));
  } catch {}

  return {
    added,
    overwritten,
    kept,
    identical: diffResult.identicalCount,
    total: diffResult.totalBackupItems,
  };
}

import { invoke } from "@tauri-apps/api/core";
import { documentRepo } from "../../shared/db/repo/documentRepo";
import { toastState } from "../../shared/toast.svelte";

export interface DirectoryFile {
  name: string;
  size: number;
  is_dir: boolean;
  updated_at: number;
  original_path?: string;
}

export interface FlatFileItem {
  source_path: string;
  target_rel_path: string;
}

const MAX_PATH_LENGTH = 4096;
const PATH_TRAVERSAL_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;

function validateRelativeStoragePath(rawPath: unknown): string {
  if (typeof rawPath !== "string") {
    throw new Error("Invalid storage path");
  }
  const normalized = rawPath.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
  if (
    !normalized ||
    normalized.length > MAX_PATH_LENGTH ||
    CONTROL_CHARS_PATTERN.test(normalized) ||
    PATH_TRAVERSAL_PATTERN.test(normalized)
  ) {
    throw new Error("Unsafe or invalid storage path");
  }
  return normalized;
}

function validateFileSystemPath(rawPath: unknown): string {
  if (typeof rawPath !== "string") {
    throw new Error("Invalid file system path");
  }
  const trimmed = rawPath.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_PATH_LENGTH ||
    CONTROL_CHARS_PATTERN.test(trimmed) ||
    PATH_TRAVERSAL_PATTERN.test(trimmed)
  ) {
    throw new Error("Unsafe or invalid file system path");
  }
  return trimmed;
}

function sanitizeOptionalBasePath(basePath?: string | null): string | null {
  if (!basePath || typeof basePath !== "string") return null;
  const trimmed = basePath.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_PATH_LENGTH ||
    CONTROL_CHARS_PATTERN.test(trimmed) ||
    PATH_TRAVERSAL_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

export async function uploadFileFromPath(
  targetPath: string,
  sourcePath: string,
  basePath?: string | null,
  silent: boolean = false
): Promise<void> {
  try {
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    const safeSourcePath = validateFileSystemPath(sourcePath);
    await invoke<void>("upload_file_from_path", {
      targetPath: safeTargetPath,
      sourcePath: safeSourcePath,
      basePath: sanitizeOptionalBasePath(basePath),
    });
  } catch (err) {
    if (!silent) toastState.add("error", "Upload failed");
    throw err;
  }
}

export async function moveFile(
  sourcePath: string,
  targetPath: string,
  basePath?: string | null,
  silent: boolean = false
): Promise<void> {
  try {
    const safeSourcePath = validateRelativeStoragePath(sourcePath);
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    await invoke<void>("move_file", {
      sourcePath: safeSourcePath,
      targetPath: safeTargetPath,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    if (!silent) toastState.add("success", "Moved successfully");
  } catch (err) {
    if (!silent) toastState.add("error", "Failed to move item");
    throw err;
  }
}

export async function uploadFile(
  targetPath: string,
  fileData: Uint8Array | ArrayBuffer | number[],
  basePath?: string | null,
  silent: boolean = false
): Promise<void> {
  try {
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    await invoke<void>("upload_file", {
      targetPath: safeTargetPath,
      fileData,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    if (!silent) toastState.add("success", "Upload complete");
  } catch (err) {
    if (!silent) toastState.add("error", "Upload failed");
    throw err;
  }
}

export async function readFile(
  targetPath: string,
  basePath?: string | null
): Promise<Uint8Array> {
  const safeTargetPath = validateRelativeStoragePath(targetPath);
  const data = await invoke<Uint8Array | number[]>("read_file", {
    targetPath: safeTargetPath,
    basePath: sanitizeOptionalBasePath(basePath),
  });
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

export async function readTextFile(
  targetPath: string,
  basePath?: string | null
): Promise<string> {
  const bytes = await readFile(targetPath, basePath);
  return new TextDecoder().decode(bytes);
}

export async function writeTextFile(
  targetPath: string,
  content: string,
  basePath?: string | null,
  silent: boolean = false
): Promise<void> {
  const bytes = new TextEncoder().encode(content);
  await uploadFile(targetPath, bytes, basePath, silent);
}

export async function deleteFile(
  targetPath: string,
  basePath?: string | null,
  silent: boolean = false,
  isDir: boolean = false
): Promise<void> {
  try {
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    if (isDir) {
      await documentRepo.deleteFolder(safeTargetPath);
    } else {
      await documentRepo.deleteDoc(safeTargetPath);
    }
    await invoke<void>("delete_file", {
      targetPath: safeTargetPath,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    if (!silent) toastState.add("success", "Item moved to Windows Recycle Bin");
  } catch (err) {
    if (!silent) toastState.add("error", "Failed to delete item");
    throw err;
  }
}

export async function listDirectoryFiles(
  targetPath: string,
  basePath?: string | null
): Promise<DirectoryFile[]> {
  try {
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    const files = await invoke<DirectoryFile[]>("list_directory_files", {
      targetPath: safeTargetPath,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    return Array.isArray(files) ? files : [];
  } catch {
    return [];
  }
}

export async function watchDirectory(
  targetPath: string,
  basePath?: string | null
): Promise<void> {
  const safeTargetPath = validateRelativeStoragePath(targetPath);
  await invoke<void>("watch_directory", {
    targetPath: safeTargetPath,
    basePath: sanitizeOptionalBasePath(basePath),
  });
}

export async function softDeleteFile(
  targetPath: string,
  basePath?: string | null,
  silent: boolean = false
): Promise<void> {
  try {
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    await invoke<void>("soft_delete_file", {
      targetPath: safeTargetPath,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    if (!silent) toastState.add("success", "Document moved to trash");
  } catch (err) {
    if (!silent) toastState.add("error", "Failed to move document to trash");
    throw err;
  }
}

export async function restoreFile(
  trashPath: string,
  basePath?: string | null,
  silent: boolean = false
): Promise<void> {
  try {
    const safeTrashPath = validateRelativeStoragePath(trashPath);
    await invoke<void>("restore_file", {
      trashPath: safeTrashPath,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    if (!silent) toastState.add("success", "Document restored");
  } catch (err) {
    if (!silent) toastState.add("error", "Failed to restore document");
    throw err;
  }
}

export async function bulkSoftDeleteFilesApi(
  paths: string[],
  basePath?: string | null
): Promise<void> {
  try {
    if (!Array.isArray(paths) || paths.length === 0) return;
    const safeBasePath = sanitizeOptionalBasePath(basePath);
    const uniqueSafePaths = Array.from(
      new Set(paths.map((path) => validateRelativeStoragePath(path)))
    );

    const sorted = uniqueSafePaths.sort((a, b) => a.length - b.length);
    const topLevelPaths: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      if (!topLevelPaths.some((parent) => p.startsWith(`${parent}/`))) {
        topLevelPaths.push(p);
      }
    }

    for (const targetPath of topLevelPaths) {
      await invoke<void>("soft_delete_file", {
        targetPath,
        basePath: safeBasePath,
      });
    }

    toastState.add(
      "success",
      `${topLevelPaths.length} document(s) moved to trash`
    );
  } catch (err) {
    toastState.add("error", "Failed to move documents to trash");
    throw err;
  }
}

export async function bulkRestoreFilesApi(
  paths: string[],
  basePath?: string | null
): Promise<void> {
  try {
    if (!Array.isArray(paths) || paths.length === 0) return;
    const safeBasePath = sanitizeOptionalBasePath(basePath);
    const uniqueSafePaths = Array.from(
      new Set(paths.map((path) => validateRelativeStoragePath(path)))
    );

    const sorted = uniqueSafePaths.sort((a, b) => a.length - b.length);
    const topLevelPaths: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      if (!topLevelPaths.some((parent) => p.startsWith(`${parent}/`))) {
        topLevelPaths.push(p);
      }
    }

    for (const trashPath of topLevelPaths) {
      await invoke<void>("restore_file", {
        trashPath,
        basePath: safeBasePath,
      });
    }

    toastState.add("success", `${topLevelPaths.length} document(s) restored`);
  } catch (err) {
    toastState.add("error", "Failed to restore documents");
    throw err;
  }
}

export async function bulkDeleteFilesApi(
  items: { id: string; isDir?: boolean }[],
  basePath?: string | null
): Promise<void> {
  try {
    if (!Array.isArray(items) || items.length === 0) return;
    const safeBasePath = sanitizeOptionalBasePath(basePath);

    const seenIds = new Set<string>();
    const uniqueItems: { id: string; isDir: boolean }[] = [];
    for (let i = 0, len = items.length; i < len; i++) {
      const rawItem = items[i];
      if (!rawItem?.id) continue;
      const safeId = validateRelativeStoragePath(rawItem.id);
      if (!seenIds.has(safeId)) {
        seenIds.add(safeId);
        uniqueItems.push({ id: safeId, isDir: Boolean(rawItem.isDir) });
      }
    }

    if (uniqueItems.length === 0) return;

    const deletedFolderIds: string[] = [];
    const deletedDocIds: string[] = [];

    const sorted = uniqueItems.sort((a, b) => a.id.length - b.id.length);
    const topLevelItems: { id: string; isDir: boolean }[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const it = sorted[i];
      if (!topLevelItems.some((parent) => it.id.startsWith(`${parent.id}/`))) {
        topLevelItems.push(it);
      }
    }

    for (const item of topLevelItems) {
      if (item.isDir) {
        deletedFolderIds.push(item.id);
      } else {
        deletedDocIds.push(item.id);
      }
    }

    const dbCleanupPromises: Promise<void>[] = [];
    if (deletedFolderIds.length > 0) {
      dbCleanupPromises.push(documentRepo.deleteManyFolders(deletedFolderIds));
    }
    if (deletedDocIds.length > 0) {
      dbCleanupPromises.push(documentRepo.deleteManyDocs(deletedDocIds));
    }
    if (dbCleanupPromises.length > 0) {
      await Promise.all(dbCleanupPromises);
    }

    for (const item of topLevelItems) {
      await invoke<void>("delete_file", {
        targetPath: item.id,
        basePath: safeBasePath,
      });
    }

    toastState.add("success", `${topLevelItems.length} item(s) moved to Windows Recycle Bin`);
  } catch (err) {
    toastState.add("error", "Failed to delete items");
    throw err;
  }
}

export async function emptyDocumentsTrashApi(
  basePath?: string | null
): Promise<void> {
  try {
    await invoke<void>("empty_documents_trash", {
      basePath: sanitizeOptionalBasePath(basePath),
    });
    toastState.add("success", "Moved all trash items to Windows Recycle Bin");
  } catch (err) {
    toastState.add("error", "Failed to empty trash");
    throw err;
  }
}

export async function createFolderApi(
  targetPath: string,
  basePath?: string | null
): Promise<void> {
  try {
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    await invoke<void>("create_folder", {
      targetPath: safeTargetPath,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    toastState.add("success", "Folder created");
  } catch (err) {
    toastState.add("error", "Failed to create folder");
    throw err;
  }
}

export async function createNewFileApi(
  targetPath: string,
  content: string = "",
  basePath?: string | null
): Promise<void> {
  try {
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    await invoke<void>("create_new_file", {
      targetPath: safeTargetPath,
      content,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    toastState.add("success", "File created");
  } catch (err) {
    toastState.add("error", "Failed to create file");
    throw err;
  }
}

export async function openFolderInOs(
  targetPath: string,
  basePath?: string | null
): Promise<void> {
  try {
    const safeTargetPath = validateRelativeStoragePath(targetPath);
    await invoke<void>("open_in_os", {
      targetPath: safeTargetPath,
      basePath: sanitizeOptionalBasePath(basePath),
    });
  } catch (err) {
    toastState.add("error", "Failed to open folder in File Explorer");
    throw err;
  }
}

export function notifyUploadResult(
  isCancelled: boolean,
  successCount: number,
  failCount: number
): void {
  try {
    if (!isCancelled) {
      if (successCount > 0) {
        toastState.add(
          "success",
          successCount === 1
            ? "Upload complete"
            : `Uploaded ${successCount} files successfully`
        );
      }
      if (failCount > 0) {
        toastState.add("error", `Failed to upload ${failCount} file(s)`);
      }
    } else {
      toastState.add("info", "Upload cancelled");
    }
  } catch {}
}

export async function getDraggedItemsContents(
  paths: string[]
): Promise<FlatFileItem[]> {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  const validPaths: string[] = [];
  for (let i = 0, len = paths.length; i < len; i++) {
    try {
      validPaths.push(validateFileSystemPath(paths[i]));
    } catch {}
  }
  if (validPaths.length === 0) return [];
  const items = await invoke<FlatFileItem[]>("get_dragged_items_contents", {
    paths: validPaths,
  });
  return Array.isArray(items) ? items : [];
}

export async function cleanupDocumentsTrash(retentionMs: number): Promise<void> {
  try {
    const numericRetention = Number(retentionMs);
    if (!Number.isFinite(numericRetention) || numericRetention <= 0) return;
    await invoke<void>("cleanup_documents_trash", {
      retentionMs: numericRetention,
    });
  } catch {}
}

export interface DocumentTreeEntry {
  name: string;
  path: string;
  parent_path: string | null;
  is_dir: boolean;
  size: number;
  updated_at: number;
}

export async function scanDocumentTree(
  basePath?: string | null,
  scope?: string | null
): Promise<DocumentTreeEntry[]> {
  try {
    const results = await invoke<DocumentTreeEntry[]>("scan_document_tree", {
      basePath: sanitizeOptionalBasePath(basePath),
      scope: scope || null,
    });
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

export async function getAbsolutePaths(
  targetPaths: string[],
  basePath?: string | null
): Promise<string[]> {
  try {
    const validPaths = targetPaths
      .map((p) => {
        try {
          return validateRelativeStoragePath(p);
        } catch {
          return null;
        }
      })
      .filter((p): p is string => Boolean(p));

    if (validPaths.length === 0) return [];

    const results = await invoke<string[]>("get_absolute_paths", {
      targetPaths: validPaths,
      basePath: sanitizeOptionalBasePath(basePath),
    });
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

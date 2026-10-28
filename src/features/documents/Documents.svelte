<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import {
    ChevronDown,
    ChevronRight,
    CornerDownRight,
    ExternalLink,
    FileArchive,
    FileAudio,
    FileCode,
    FileImage,
    FileSpreadsheet,
    FileText,
    FileVideo,
    Folder as FolderIcon,
    FolderOpen,
    FolderTree,
    Pencil,
    Plus,
    PlusCircle,
    RefreshCcw,
    Search,
    Trash2,
    UploadCloud,
    X,
  } from "lucide-svelte";
  import ActionButton from "../../shared/ui/ActionButton.svelte";
  import { createResizableSidebar } from "../../shared/utils/resizableSidebar.svelte";
  import Button from "../../shared/ui/Button.svelte";
  import ConfirmModal from "../../shared/ui/ConfirmModal.svelte";
  import EmptyState from "../../shared/ui/EmptyState.svelte";
  import FormField from "../../shared/ui/FormField.svelte";
  import FormModal from "../../shared/ui/FormModal.svelte";
  import Input from "../../shared/ui/Input.svelte";
  import Modal from "../../shared/ui/Modal.svelte";
  import DocumentEditorModal from "./DocumentEditorModal.svelte";
  import PageLayout from "../../shared/ui/PageLayout.svelte";
  import SearchBar from "../../shared/ui/SearchBar.svelte";
  import SortIcon from "../../shared/ui/SortIcon.svelte";
  import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableHeader,
    TableRow,
    ColumnResizer,
  } from "../../shared/ui/table";
  import { createResizableColumns } from "../../shared/utils/resizableColumns.svelte";
  import TabSwitcher from "../../shared/ui/TabSwitcher.svelte";
  import Toolbar from "../../shared/ui/Toolbar.svelte";
  import { toastState } from "../../shared/toast.svelte";
  import { formatBytes, formatDate } from "../../shared/utils/format";
  import { getNextSelection, getNextSort } from "../../shared/utils/table";
  import { isPlatformPathValid } from "../settings/api";
  import {
    bulkDeleteFilesApi,
    bulkRestoreFilesApi,
    bulkSoftDeleteFilesApi,
    createFolderApi,
    createNewFileApi,
    deleteFile,
    emptyDocumentsTrashApi,
    getDraggedItemsContents,
    listDirectoryFiles,
    moveFile,
    notifyUploadResult,
    openFolderInOs,
    restoreFile,
    scanDocumentTree,
    softDeleteFile,
    uploadFile,
    uploadFileFromPath,
    watchDirectory,
    type DirectoryFile,
    type DocumentTreeEntry,
  } from "./api";

  interface MixedItem {
    type: "folder" | "document";
    id: string;
    name: string;
    lowerName: string;
    size: number;
    updatedAt: number;
    formattedDate: string;
    formattedSize: string;
    item: DirectoryFile;
  }

  interface BreadcrumbItem {
    id: string;
    name: string;
  }

  interface FolderTreeNode {
    name: string;
    path: string;
    parentPath: string | null;
    children: FolderTreeNode[];
    files: DocumentTreeEntry[];
    fileCount: number;
  }

  const MAX_RENDER_ITEMS = 500;
  const MAX_FOLDER_NAME_LENGTH = 255;
  const INVALID_FILENAME_CHARS_PATTERN = /[<>:"/\\|?*\u0000-\u001F\u007F]/;
  const RESERVED_WINDOWS_NAMES_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const PATH_TRAVERSAL_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
  const COLLATOR = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  let rawTreeEntries = $state<DocumentTreeEntry[]>([]);
  let treeSearchQuery = $state("");
  let isFolderSidebarOpen = $state(true);
  const folderSidebar = createResizableSidebar();
  const colResizer = createResizableColumns({
    storageKey: "personal_os_documents_col_widths_v2",
    columns: {
      name: { defaultWidth: 340, minWidth: 180 },
      updatedAt: { defaultWidth: 180, minWidth: 140 },
      size: { defaultWidth: 120, minWidth: 90 },
      actions: { defaultWidth: 104, minWidth: 104, maxWidth: 104 },
    },
  });
  let expandedFolderPaths = $state<Set<string>>(new Set());
  let dragOverTreePath = $state<string | null>(null);
  let createFolderParentPath = $state<string | null>(null);

  let fsItems = $state<MixedItem[]>([]);
  let currentPath = $state("root");
  let activeTab = $state<"active" | "trash">("active");
  let searchQuery = $state("");

  let sortKey = $state<"name" | "size" | "updatedAt">("updatedAt");
  let sortDirection = $state<"asc" | "desc">("desc");

  let selectedIds = $state<Set<string>>(new Set());
  let lastSelectedId: string | null = null;
  let selectedTreeFilePath = $state<string | null>(null);
  let pendingSelectedId: string | null = null;

  let isDragging = $state(false);

  let createFolderOpen = $state(false);
  let newFolderName = $state("");

  let renameFolderOpen = $state(false);
  let folderToRename = $state<{ id: string; name: string } | null>(null);
  let renameFolderName = $state("");

  let isEditorOpen = $state(false);
  let editorFilePath = $state("");
  let editorFileName = $state("");

  function isTextOrMarkdownFile(name: string): boolean {
    const lower = name.toLowerCase();
    return lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".markdown");
  }

  function openDocumentEditor(item: MixedItem) {
    editorFilePath = item.id;
    editorFileName = item.name;
    isEditorOpen = true;
  }

  interface FileVisual {
    icon: typeof FileText;
    colorClass: string;
    fillClass: string;
  }

  function getFileVisual(name: string, isFolder: boolean): FileVisual {
    if (isFolder) {
      return {
        icon: FolderIcon,
        colorClass: "text-amber-500 dark:text-amber-400",
        fillClass: "fill-amber-500/20",
      };
    }

    const ext = name.split(".").pop()?.toLowerCase() || "";

    switch (ext) {
      case "md":
      case "markdown":
        return {
          icon: FileText,
          colorClass: "text-indigo-500 dark:text-indigo-400",
          fillClass: "fill-indigo-500/15",
        };
      case "pdf":
        return {
          icon: FileText,
          colorClass: "text-rose-500 dark:text-rose-400",
          fillClass: "fill-rose-500/15",
        };
      case "doc":
      case "docx":
      case "odt":
      case "rtf":
        return {
          icon: FileText,
          colorClass: "text-blue-500 dark:text-blue-400",
          fillClass: "fill-blue-500/15",
        };
      case "txt":
      case "log":
      case "ini":
      case "cfg":
        return {
          icon: FileText,
          colorClass: "text-slate-500 dark:text-slate-400",
          fillClass: "fill-slate-500/15",
        };
      case "xls":
      case "xlsx":
      case "csv":
      case "tsv":
      case "ods":
        return {
          icon: FileSpreadsheet,
          colorClass: "text-emerald-500 dark:text-emerald-400",
          fillClass: "fill-emerald-500/15",
        };
      case "png":
      case "jpg":
      case "jpeg":
      case "gif":
      case "svg":
      case "webp":
      case "bmp":
      case "ico":
      case "tiff":
        return {
          icon: FileImage,
          colorClass: "text-purple-500 dark:text-purple-400",
          fillClass: "fill-purple-500/15",
        };
      case "js":
      case "ts":
      case "jsx":
      case "tsx":
      case "json":
      case "html":
      case "css":
      case "scss":
      case "py":
      case "rs":
      case "c":
      case "cpp":
      case "cs":
      case "go":
      case "java":
      case "sql":
      case "sh":
      case "bash":
      case "yaml":
      case "yml":
      case "toml":
      case "xml":
        return {
          icon: FileCode,
          colorClass: "text-cyan-500 dark:text-cyan-400",
          fillClass: "fill-cyan-500/15",
        };
      case "mp3":
      case "wav":
      case "ogg":
      case "flac":
      case "m4a":
      case "aac":
        return {
          icon: FileAudio,
          colorClass: "text-pink-500 dark:text-pink-400",
          fillClass: "fill-pink-500/15",
        };
      case "mp4":
      case "mkv":
      case "webm":
      case "mov":
      case "avi":
      case "wmv":
        return {
          icon: FileVideo,
          colorClass: "text-violet-500 dark:text-violet-400",
          fillClass: "fill-violet-500/15",
        };
      case "zip":
      case "rar":
      case "7z":
      case "tar":
      case "gz":
      case "bz2":
        return {
          icon: FileArchive,
          colorClass: "text-amber-600 dark:text-amber-500",
          fillClass: "fill-amber-500/15",
        };
      default:
        return {
          icon: FileText,
          colorClass: "text-muted-foreground",
          fillClass: "fill-muted/20",
        };
    }
  }

  let isMounted = true;
  let latestFetchRequestId = 0;

  let confirmDialog = $state({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: async () => {},
  });

  let customBasePath = $state<string | null>(null);
  let dragHoverId = $state<string | null>(null);
  let dragBreadcrumbId = $state<string | null>(null);
  let isProgressModalOpen = $state(false);
  let progressTitle = $state("Uploading...");
  let progressPercent = $state(0);
  let progressStatusText = $state("");
  let isCancelled = $state(false);
  let isCancelling = $state(false);

  let breadcrumbContainerWidth = $state(0);

  let itemByIdMap = $derived.by(() => {
    const map = new Map<string, MixedItem>();
    for (let i = 0, len = fsItems.length; i < len; i++) {
      const entry = fsItems[i];
      map.set(entry.id, entry);
    }
    return map;
  });

  function isValidFolderName(rawName: string): boolean {
    const trimmed = rawName.trim();
    if (
      !trimmed ||
      trimmed.length > MAX_FOLDER_NAME_LENGTH ||
      trimmed === "." ||
      trimmed === ".." ||
      trimmed.toLowerCase() === ".trash" ||
      INVALID_FILENAME_CHARS_PATTERN.test(trimmed) ||
      RESERVED_WINDOWS_NAMES_PATTERN.test(trimmed)
    ) {
      return false;
    }
    return true;
  }

  function extractBaseFileName(rawRelPath: string): string {
    if (!rawRelPath) return "";
    const lastSlash = Math.max(
      rawRelPath.lastIndexOf("/"),
      rawRelPath.lastIndexOf("\\")
    );
    return lastSlash === -1 ? rawRelPath : rawRelPath.slice(lastSlash + 1);
  }

  const yieldThread = (ms = 10): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchConfig(): Promise<void> {
    try {
      const docPath = localStorage.getItem("documents_path");
      if (
        docPath &&
        !PATH_TRAVERSAL_PATTERN.test(docPath) &&
        isPlatformPathValid(docPath)
      ) {
        customBasePath = docPath;
      } else {
        const defaultDocDir = await invoke<string>("get_default_document_dir");
        if (!isMounted) return;
        customBasePath = defaultDocDir;
      }
    } catch {}
  }

  async function fetchData(): Promise<void> {
    const requestId = ++latestFetchRequestId;
    try {
      const targetPath =
        activeTab === "active"
          ? currentPath === "root"
            ? "docs"
            : `docs/${currentPath}`
          : currentPath === "root"
            ? "docs/.trash"
            : `docs/.trash/${currentPath}`;

      const rawFiles = await listDirectoryFiles(
        targetPath,
        customBasePath
      );
      if (!isMounted || requestId !== latestFetchRequestId) return;

      const filterTrashRoot = activeTab === "active" && currentPath === "root";
      const mappedItems: MixedItem[] = [];

      for (let i = 0, len = rawFiles.length; i < len; i++) {
        const fileEntry = rawFiles[i];
        if (!fileEntry || !fileEntry.name) continue;
        if (filterTrashRoot && fileEntry.name === ".trash") continue;

        const size = fileEntry.size || 0;
        const updatedAt = fileEntry.updated_at || 0;
        mappedItems.push({
          type: fileEntry.is_dir ? "folder" : "document",
          id: `${targetPath}/${fileEntry.name}`,
          name: fileEntry.name,
          lowerName: fileEntry.name.toLowerCase(),
          size,
          updatedAt,
          formattedDate: formatDate(updatedAt),
          formattedSize: formatBytes(size),
          item: fileEntry,
        });
      }

      fsItems = mappedItems;

      if (pendingSelectedId) {
        const targetId = pendingSelectedId;
        pendingSelectedId = null;
        selectedIds = new Set([targetId]);
        lastSelectedId = targetId;
        setTimeout(() => {
          if (isMounted) {
            scrollRowIntoView(targetId);
          }
        }, 30);
      }
    } catch {
      if (isMounted && requestId === latestFetchRequestId) {
        fsItems = [];
        if (currentPath !== "root") {
          currentPath = "root";
          fetchData().catch(() => {});
        }
      }
    }
  }

  onMount(() => {
    isMounted = true;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let unlistenFsChangedPromise: Promise<UnlistenFn> | null = null;
    let unlistenDragDropPromise: Promise<UnlistenFn> | null = null;

    const handlePathChanged = (): void => {
      (async () => {
        try {
          await fetchConfig();
          if (!isMounted) return;
          watchDirectory("docs", customBasePath).catch(() => {});
          await Promise.all([fetchData(), fetchFolderTree()]);
        } catch {}
      })();
    };

    window.addEventListener("documents-path-changed", handlePathChanged);

    const handleShortcutNewNote = (): void => {
      try {
        if (!isMounted) return;
        handleCreateNewNote();
      } catch {}
    };
    window.addEventListener("shortcut-new-note", handleShortcutNewNote);

    const handleWindowFocus = (): void => {
      try {
        if (!isMounted) return;
        fetchData().catch(() => {});
        fetchFolderTree().catch(() => {});
      } catch {}
    };

    window.addEventListener("focus", handleWindowFocus);
    const handleVisibilityChange = (): void => {
      try {
        if (document.visibilityState === "visible" && isMounted) {
          handleWindowFocus();
        }
      } catch {}
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    (async () => {
      try {
        await fetchConfig();
        if (!isMounted) return;
        watchDirectory("docs", customBasePath).catch(() => {});
        await Promise.all([fetchData(), fetchFolderTree()]);
      } catch {}
    })();

    try {
      const webview = getCurrentWebview();
      unlistenDragDropPromise = webview.onDragDropEvent(async (event) => {
        try {
          if (!isMounted) return;
          const payloadType = event.payload.type;
          if (payloadType === "enter" || payloadType === "over") {
            if (activeTab === "active") {
              isDragging = true;
            }
          } else if (payloadType === "drop") {
            isDragging = false;
            if (activeTab !== "active") return;
            const paths = event.payload.paths;
            if (!paths || paths.length === 0) return;
            await uploadPathsList(paths);
          } else {
            isDragging = false;
          }
        } catch {}
      });
    } catch {}

    try {
      unlistenFsChangedPromise = listen("fs-changed", () => {
        try {
          if (!isMounted) return;
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            if (isMounted) {
              fetchData().catch(() => {});
              fetchFolderTree().catch(() => {});
            }
          }, 200);
        } catch {}
      });
    } catch {}

    const handleGlobalDragEnd = (): void => {
      dragOverTreePath = null;
      dragHoverId = null;
      dragBreadcrumbId = null;
      isDragging = false;
    };
    window.addEventListener("dragend", handleGlobalDragEnd);

    return () => {
      isMounted = false;
      window.removeEventListener("pointermove", onGlobalPointerMove);
      window.removeEventListener("pointerup", onGlobalPointerUp);
      window.removeEventListener("pointercancel", onGlobalPointerUp);
      document.body.style.userSelect = "";
      window.removeEventListener("dragend", handleGlobalDragEnd);
      window.removeEventListener("documents-path-changed", handlePathChanged);
      window.removeEventListener("shortcut-new-note", handleShortcutNewNote);
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (unlistenFsChangedPromise) {
        unlistenFsChangedPromise
          .then((unlistenFn) => {
            if (typeof unlistenFn === "function") unlistenFn();
          })
          .catch(() => {});
        unlistenFsChangedPromise = null;
      }
      if (unlistenDragDropPromise) {
        unlistenDragDropPromise
          .then((unlistenFn) => {
            if (typeof unlistenFn === "function") unlistenFn();
          })
          .catch(() => {});
        unlistenDragDropPromise = null;
      }
    };
  });

  $effect(() => {
    currentPath;
    activeTab;
    customBasePath;

    if (!pendingSelectedId) {
      selectedIds = new Set();
      lastSelectedId = null;
      selectedTreeFilePath = null;
    }

    const timerId = setTimeout(() => {
      if (isMounted) {
        fetchData().catch(() => {});
      }
    }, 10);

    return () => {
      clearTimeout(timerId);
    };
  });

  $effect(() => {
    customBasePath;
    if (isMounted) {
      untrack(() => {
        fetchFolderTree().catch(() => {});
      });
    }
  });

  let lastAutoExpandedPath = "";
  $effect(() => {
    const path = currentPath;
    if (path && path !== "root" && path !== lastAutoExpandedPath) {
      lastAutoExpandedPath = path;
      untrack(() => {
        autoExpandAncestors(path);
      });
    }
  });

  onDestroy(() => {
    isMounted = false;
    fsItems = [];
    selectedIds.clear();
    folderToRename = null;
  });

  function estimateBreadcrumbWidth(crumb: BreadcrumbItem): number {
    if (crumb.id === "root" || crumb.id === "ellipsis") return 40;
    return Math.min(174, crumb.name.length * 8 + 24);
  }

  let breadcrumbs = $derived.by((): BreadcrumbItem[] => {
    try {
      const crumbs: BreadcrumbItem[] = [
        { id: "root", name: activeTab === "trash" ? "Trash" : "Home" },
      ];
      if (currentPath !== "root") {
        const parts = currentPath.split("/");
        let currentBuild = "";
        for (let i = 0, len = parts.length; i < len; i++) {
          const segment = parts[i];
          if (segment) {
            currentBuild = currentBuild
              ? `${currentBuild}/${segment}`
              : segment;
            crumbs.push({ id: currentBuild, name: segment });
          }
        }
      }

      const crumbCount = crumbs.length;
      if (!breadcrumbContainerWidth || crumbCount <= 2) {
        return crumbs;
      }

      const maxAllowedWidth = breadcrumbContainerWidth - 50;
      const widths = new Array<number>(crumbCount);
      let totalWidth = 0;

      for (let i = 0; i < crumbCount; i++) {
        const w = estimateBreadcrumbWidth(crumbs[i]);
        widths[i] = w;
        totalWidth += w + (i > 0 ? 20 : 0);
      }

      if (totalWidth <= maxAllowedWidth) {
        return crumbs;
      }

      let removedCount = 0;
      let currentTotal = totalWidth + 60;
      const maxRemovable = crumbCount - 2;

      while (currentTotal > maxAllowedWidth && removedCount < maxRemovable) {
        const removeIdx = 1 + removedCount;
        currentTotal -= widths[removeIdx] + 20;
        removedCount++;
      }

      if (removedCount === 0) {
        return crumbs;
      }

      return [
        crumbs[0],
        { id: "ellipsis", name: "..." },
        ...crumbs.slice(1 + removedCount),
      ];
    } catch {
      return [];
    }
  });

  let itemsToShow = $derived.by((): MixedItem[] => {
    try {
      const trimmedQuery = searchQuery.trim().toLowerCase();
      const sourceItems = fsItems;
      let filtered: MixedItem[];

      if (trimmedQuery) {
        filtered = [];
        for (let i = 0, len = sourceItems.length; i < len; i++) {
          const item = sourceItems[i];
          if (item.lowerName.includes(trimmedQuery)) {
            filtered.push(item);
          }
        }
      } else {
        filtered = [...sourceItems];
      }

      const activeSortKey = sortKey;
      const directionMultiplier = sortDirection === "asc" ? 1 : -1;

      filtered.sort((itemA, itemB) => {
        if (itemA.type !== itemB.type) {
          return itemA.type === "folder" ? -1 : 1;
        }

        let comp = 0;
        if (activeSortKey === "name") {
          comp = itemA.name.localeCompare(itemB.name);
        } else if (activeSortKey === "size") {
          comp = itemA.size - itemB.size;
        } else {
          comp = itemA.updatedAt - itemB.updatedAt;
        }

        return comp * directionMultiplier;
      });

      return filtered.length > MAX_RENDER_ITEMS
        ? filtered.slice(0, MAX_RENDER_ITEMS)
        : filtered;
    } catch {
      return [];
    }
  });

  let orderedVisibleIds = $derived(itemsToShow.map((item) => item.id));

  function handleRowClick(e: MouseEvent, id: string): void {
    try {
      e.stopPropagation();
      const result = getNextSelection(
        e,
        id,
        selectedIds,
        orderedVisibleIds,
        lastSelectedId
      );
      selectedIds = result.selection;
      lastSelectedId = result.lastSelectedId;
      if (selectedIds.size === 1) {
        const singleId = Array.from(selectedIds)[0];
        const relPath = singleId.startsWith("docs/") ? singleId.slice(5) : singleId;
        selectedTreeFilePath = relPath;
      } else {
        selectedTreeFilePath = null;
      }
    } catch {}
  }

  function handleSort(key: typeof sortKey): void {
    try {
      const next = getNextSort(key, sortKey, sortDirection);
      sortKey = next.key;
      sortDirection = next.direction;
    } catch {}
  }

  let folderTreeData = $derived.by(
    (): { nodes: FolderTreeNode[]; rootFiles: DocumentTreeEntry[] } => {
      const nodeMap = new Map<string, FolderTreeNode>();
      const rootNodes: FolderTreeNode[] = [];
      const rootFiles: DocumentTreeEntry[] = [];

      for (let i = 0, len = rawTreeEntries.length; i < len; i++) {
        const entry = rawTreeEntries[i];
        if (entry.is_dir) {
          nodeMap.set(entry.path, {
            name: entry.name,
            path: entry.path,
            parentPath: entry.parent_path,
            children: [],
            files: [],
            fileCount: 0,
          });
        }
      }

      for (let i = 0, len = rawTreeEntries.length; i < len; i++) {
        const entry = rawTreeEntries[i];
        if (!entry.is_dir) {
          if (entry.parent_path && nodeMap.has(entry.parent_path)) {
            const parent = nodeMap.get(entry.parent_path)!;
            parent.fileCount++;
            parent.files.push(entry);
          } else if (!entry.parent_path) {
            rootFiles.push(entry);
          }
        } else {
          const node = nodeMap.get(entry.path)!;
          if (entry.parent_path && nodeMap.has(entry.parent_path)) {
            nodeMap.get(entry.parent_path)!.children.push(node);
          } else {
            rootNodes.push(node);
          }
        }
      }

      function sortNodes(nodes: FolderTreeNode[]): void {
        nodes.sort((a, b) => COLLATOR.compare(a.name, b.name));
        for (let i = 0, len = nodes.length; i < len; i++) {
          sortNodes(nodes[i].children);
          nodes[i].files.sort((a, b) => COLLATOR.compare(a.name, b.name));
        }
      }
      sortNodes(rootNodes);
      rootFiles.sort((a, b) => COLLATOR.compare(a.name, b.name));

      return { nodes: rootNodes, rootFiles };
    }
  );

  let displayTreeData = $derived.by(
    (): { nodes: FolderTreeNode[]; rootFiles: DocumentTreeEntry[] } => {
      const q = treeSearchQuery.trim().toLowerCase();
      if (!q) return folderTreeData;

      function filterNodes(nodes: FolderTreeNode[]): FolderTreeNode[] {
        const matched: FolderTreeNode[] = [];
        for (let i = 0, len = nodes.length; i < len; i++) {
          const node = nodes[i];
          const selfMatch = node.name.toLowerCase().includes(q);
          const filteredChildren = filterNodes(node.children);
          const filteredFiles = node.files.filter((f) =>
            f.name.toLowerCase().includes(q)
          );
          if (
            selfMatch ||
            filteredChildren.length > 0 ||
            filteredFiles.length > 0
          ) {
            matched.push({
              ...node,
              children: filteredChildren,
              files: selfMatch ? node.files : filteredFiles,
            });
          }
        }
        return matched;
      }

      return {
        nodes: filterNodes(folderTreeData.nodes),
        rootFiles: folderTreeData.rootFiles.filter((f) =>
          f.name.toLowerCase().includes(q)
        ),
      };
    }
  );

  let displayTreeNodes = $derived(displayTreeData.nodes);
  let displayRootFiles = $derived(displayTreeData.rootFiles);

  let isFetchingTree = false;
  let hasPendingTreeFetch = false;

  async function fetchFolderTree(): Promise<void> {
    if (isFetchingTree) {
      hasPendingTreeFetch = true;
      return;
    }
    isFetchingTree = true;

    try {
      const entries = await scanDocumentTree(customBasePath);
      if (!isMounted) return;
      rawTreeEntries = entries;

      if (activeTab === "active" && currentPath !== "root") {
        const folderExists = entries.some(
          (e) => e.is_dir && e.path === currentPath
        );
        if (!folderExists) {
          const parts = currentPath.split("/");
          let fallback = "root";
          while (parts.length > 1) {
            parts.pop();
            const parentCandidate = parts.join("/");
            if (entries.some((e) => e.is_dir && e.path === parentCandidate)) {
              fallback = parentCandidate;
              break;
            }
          }
          currentPath = fallback;
          fetchData().catch(() => {});
        }
      }

      if (expandedFolderPaths.size > 0) {
        const validFolderPaths = new Set(
          entries.filter((e) => e.is_dir).map((e) => e.path)
        );
        const nextExpanded = new Set<string>();
        for (const p of expandedFolderPaths) {
          if (validFolderPaths.has(p)) {
            nextExpanded.add(p);
          }
        }
        expandedFolderPaths = nextExpanded;
      }
    } catch {
      if (isMounted) rawTreeEntries = [];
    } finally {
      isFetchingTree = false;
      if (hasPendingTreeFetch) {
        hasPendingTreeFetch = false;
        fetchFolderTree().catch(() => {});
      }
    }
  }

  function autoExpandAncestors(path: string): void {
    if (!path || path === "root") return;
    const parts = path.split("/");
    let current = "";
    let updated = false;
    const next = new Set(expandedFolderPaths);
    for (let i = 0; i < parts.length; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      if (!next.has(current)) {
        next.add(current);
        updated = true;
      }
    }
    if (updated) {
      expandedFolderPaths = next;
    }
  }

  function toggleExpandFolder(e: MouseEvent, folderPath: string): void {
    e.stopPropagation();
    const next = new Set(expandedFolderPaths);
    if (next.has(folderPath)) {
      next.delete(folderPath);
    } else {
      next.add(folderPath);
    }
    expandedFolderPaths = next;
  }

  function navigateToTreeFolder(folderPath: string): void {
    if (activeTab === "trash") {
      activeTab = "active";
    }
    pendingSelectedId = null;
    selectedTreeFilePath = null;
    currentPath = folderPath;
    selectedIds = new Set();
    autoExpandAncestors(folderPath);
    if (!expandedFolderPaths.has(folderPath)) {
      const next = new Set(expandedFolderPaths);
      next.add(folderPath);
      expandedFolderPaths = next;
    }
  }

  function navigateToRoot(): void {
    pendingSelectedId = null;
    selectedTreeFilePath = null;
    currentPath = "root";
    selectedIds = new Set();
  }

  function scrollRowIntoView(itemId: string): void {
    try {
      const escapedId =
        typeof CSS !== "undefined" && CSS.escape
          ? CSS.escape(itemId)
          : itemId.replace(/["\\]/g, "\\$&");
      const row = document.querySelector(`tr[data-item-id="${escapedId}"]`);
      if (row && typeof row.scrollIntoView === "function") {
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    } catch {}
  }

  function getTreeFileTarget(file: DocumentTreeEntry): { targetFolder: string; targetFileId: string } {
    const targetFolder = file.parent_path ?? "root";
    const targetPath =
      activeTab === "active"
        ? targetFolder === "root"
          ? "docs"
          : `docs/${targetFolder}`
        : targetFolder === "root"
          ? "docs/.trash"
          : `docs/.trash/${targetFolder}`;
    return {
      targetFolder,
      targetFileId: `${targetPath}/${file.name}`,
    };
  }

  function selectFileFromTree(file: DocumentTreeEntry): void {
    if (activeTab === "trash") {
      activeTab = "active";
    }
    const { targetFolder, targetFileId } = getTreeFileTarget(file);

    searchQuery = "";
    selectedTreeFilePath = file.path;
    selectedIds = new Set([targetFileId]);
    lastSelectedId = targetFileId;

    if (targetFolder !== "root") {
      autoExpandAncestors(targetFolder);
      if (!expandedFolderPaths.has(targetFolder)) {
        const next = new Set(expandedFolderPaths);
        next.add(targetFolder);
        expandedFolderPaths = next;
      }
    }

    if (currentPath !== targetFolder) {
      pendingSelectedId = targetFileId;
      currentPath = targetFolder;
    } else {
      pendingSelectedId = null;
      setTimeout(() => {
        if (isMounted) {
          scrollRowIntoView(targetFileId);
        }
      }, 30);
    }
  }

  function openCreateSubfolderModal(e: MouseEvent, parentPath: string): void {
    e.stopPropagation();
    createFolderParentPath = parentPath;
    newFolderName = "";
    createFolderOpen = true;
  }

  function openCreateRootFolderModal(): void {
    createFolderParentPath = null;
    newFolderName = "";
    createFolderOpen = true;
  }

  async function confirmDeleteTreeFolder(e: MouseEvent, node: FolderTreeNode): Promise<void> {
    e.stopPropagation();
    try {
      await softDeleteFile(
        `docs/${node.path}`,
        customBasePath,
        false
      );
      if (
        currentPath === node.path ||
        currentPath.startsWith(`${node.path}/`)
      ) {
        currentPath = node.parentPath ?? "root";
      }
      if (isMounted) {
        await Promise.all([fetchData(), fetchFolderTree()]);
      }
    } catch {}
  }

  function openRenameTreeFolder(e: MouseEvent, node: FolderTreeNode): void {
    e.stopPropagation();
    folderToRename = {
      id: `docs/${node.path}`,
      name: node.name,
    };
    renameFolderName = node.name;
    renameFolderOpen = true;
  }

  function handleTreeDragOver(e: DragEvent, targetPath: string): void {
    try {
      if (activeTab !== "active") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
      dragOverTreePath = targetPath;
    } catch {}
  }

  function handleTreeDragLeave(e: DragEvent, targetPath: string): void {
    try {
      const currentTarget = e.currentTarget as HTMLElement | null;
      if (currentTarget) {
        const rect = currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return;
        }
      }
      if (dragOverTreePath === targetPath) {
        dragOverTreePath = null;
      }
    } catch {}
  }

  async function handleTreeDrop(
    e: DragEvent,
    targetRelPath: string
  ): Promise<void> {
    try {
      if (activeTab !== "active") return;
      e.preventDefault();
      e.stopPropagation();
      dragOverTreePath = null;

      const targetFolderId =
        targetRelPath === "root" ? "docs" : `docs/${targetRelPath}`;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        await uploadFilesList(files, targetFolderId);
        await Promise.all([fetchData(), fetchFolderTree()]);
      }
    } catch {}
  }

  async function handleCreateNewNote(): Promise<void> {
    try {
      if (activeTab === "trash") return;
      const target = currentPath === "root" ? "docs" : `docs/${currentPath}`;
      let candidate = "Untitled.md";
      let counter = 1;
      const existingNames = new Set(fsItems.map((f) => f.name.toLowerCase()));
      while (existingNames.has(candidate.toLowerCase())) {
        candidate = `Untitled (${counter}).md`;
        counter++;
      }

      const fullRelPath = `${target}/${candidate}`;
      await createNewFileApi(fullRelPath, "# Untitled Note\n\n", customBasePath);
      if (isMounted) {
        await Promise.all([fetchData(), fetchFolderTree()]);
      }
      editorFilePath = fullRelPath;
      editorFileName = candidate;
      isEditorOpen = true;
    } catch {}
  }

  async function handleCreateFolder(): Promise<void> {
    try {
      if (activeTab === "trash") return;
      const folderName = newFolderName.trim();
      if (!isValidFolderName(folderName)) return;

      const parent = createFolderParentPath;
      const target = parent
        ? `docs/${parent}`
        : currentPath === "root"
          ? "docs"
          : `docs/${currentPath}`;

      createFolderOpen = false;
      newFolderName = "";
      createFolderParentPath = null;

      await createFolderApi(
        `${target}/${folderName}/.keep`,
        customBasePath
      );

      const createdRelPath = parent
        ? `${parent}/${folderName}`
        : currentPath === "root"
          ? folderName
          : `${currentPath}/${folderName}`;
      const nextExpanded = new Set(expandedFolderPaths);
      if (parent) nextExpanded.add(parent);
      nextExpanded.add(createdRelPath);
      expandedFolderPaths = nextExpanded;

      if (!isMounted) return;
      await Promise.all([fetchData(), fetchFolderTree()]);
    } catch {}
  }

  async function handleRenameFolder(): Promise<void> {
    try {
      if (activeTab === "trash" || !folderToRename) {
        renameFolderOpen = false;
        return;
      }

      const trimmedName = renameFolderName.trim();
      if (!isValidFolderName(trimmedName)) {
        renameFolderOpen = false;
        return;
      }

      if (trimmedName === folderToRename.name) {
        renameFolderOpen = false;
        return;
      }

      const lastSlashIndex = folderToRename.id.lastIndexOf("/");
      const parentDir =
        lastSlashIndex !== -1
          ? folderToRename.id.substring(0, lastSlashIndex)
          : "docs";
      const newPath = `${parentDir}/${trimmedName}`;

      const oldDocPath = folderToRename.id;
      await moveFile(
        oldDocPath,
        newPath,
        customBasePath
      );
      const oldRelPath = oldDocPath.startsWith("docs/")
        ? oldDocPath.slice(5)
        : oldDocPath;
      const newRelPath = newPath.startsWith("docs/")
        ? newPath.slice(5)
        : newPath;
      if (currentPath === oldRelPath) {
        currentPath = newRelPath;
      } else if (currentPath.startsWith(`${oldRelPath}/`)) {
        currentPath = `${newRelPath}${currentPath.substring(oldRelPath.length)}`;
      }
      if (expandedFolderPaths.has(oldRelPath)) {
        const nextExpanded = new Set(expandedFolderPaths);
        nextExpanded.delete(oldRelPath);
        nextExpanded.add(newRelPath);
        expandedFolderPaths = nextExpanded;
      }
      if (!isMounted) return;
      await Promise.all([fetchData(), fetchFolderTree()]);
    } catch {
    } finally {
      renameFolderOpen = false;
      folderToRename = null;
    }
  }

  async function uploadFilesList(
    files: FileList | File[],
    overrideTargetPath?: string
  ): Promise<void> {
    try {
      if (activeTab === "trash") return;
      if (!files || files.length === 0) return;

      const targetPath =
        overrideTargetPath ??
        (currentPath === "root" ? "docs" : `docs/${currentPath}`);
      const total = files.length;

      isCancelled = false;
      progressTitle =
        total === 1 ? `Uploading "${files[0].name}"` : `Uploading ${total} Files`;
      progressPercent = 0;
      progressStatusText = `Preparing ${total} file(s)...`;
      isProgressModalOpen = true;

      let successCount = 0;
      let failCount = 0;

      try {
        for (let i = 0; i < total; i++) {
          if (isCancelled || !isMounted) break;
          const file = files[i];
          const name = file.name;
          progressPercent = Math.round(((i + 1) / total) * 100);
          progressStatusText = `Uploading (${i + 1}/${total}): ${name}`;

          await yieldThread(10);
          if (isCancelled || !isMounted) break;

          const buffer = await file.arrayBuffer();
          const uint8Data = new Uint8Array(buffer);

          if (isCancelled || !isMounted) break;
          try {
            await uploadFile(
              `${targetPath}/${name}`,
              uint8Data,
              customBasePath,
              true
            );
            successCount++;
          } catch {
            failCount++;
          }
        }
      } finally {
        if (isCancelled) {
          progressStatusText = "Cancelling operation and cleaning up...";
          await yieldThread(250);
        }

        isProgressModalOpen = false;
        isCancelling = false;

        if (!isCancelled) {
          notifyUploadResult(false, successCount, failCount);
          await yieldThread(100);
          if (isMounted) await Promise.all([fetchData(), fetchFolderTree()]);
        } else {
          notifyUploadResult(true, successCount, failCount);
          if (successCount > 0) {
            await yieldThread(100);
            if (isMounted) await Promise.all([fetchData(), fetchFolderTree()]);
          }
        }
      }
    } catch {}
  }

  async function uploadPathsList(paths: string[]): Promise<void> {
    try {
      if (activeTab !== "active") return;
      if (!paths || paths.length === 0) return;

      const baseTargetPath =
        currentPath === "root" ? "docs" : `docs/${currentPath}`;

      progressTitle = "Scanning files...";
      progressPercent = 0;
      progressStatusText = "Analyzing dropped items...";
      isProgressModalOpen = true;

      const flatItems = await getDraggedItemsContents(paths);
      if (!isMounted) return;

      const total = flatItems.length;
      if (total === 0) {
        isProgressModalOpen = false;
        return;
      }

      isCancelled = false;
      progressTitle =
        total === 1
          ? `Uploading "${extractBaseFileName(flatItems[0].target_rel_path)}"`
          : `Uploading ${total} Files`;

      let successCount = 0;
      let failCount = 0;

      try {
        for (let i = 0; i < total; i++) {
          if (isCancelled || !isMounted) break;
          const item = flatItems[i];
          const name = extractBaseFileName(item.target_rel_path);

          progressPercent = Math.round(((i + 1) / total) * 100);
          progressStatusText = `Uploading (${i + 1}/${total}): ${name}`;

          await yieldThread(10);
          if (isCancelled || !isMounted) break;

          try {
            const finalTargetPath = `${baseTargetPath}/${item.target_rel_path}`;
            await uploadFileFromPath(
              finalTargetPath,
              item.source_path,
              customBasePath,
              true
            );
            successCount++;
          } catch {
            failCount++;
          }
        }
      } finally {
        if (isCancelled) {
          progressStatusText = "Cancelling operation and cleaning up...";
          await yieldThread(250);
        }

        isProgressModalOpen = false;
        isCancelling = false;

        notifyUploadResult(isCancelled, successCount, failCount);
        if (successCount > 0 || !isCancelled) {
          await yieldThread(100);
          if (isMounted) await Promise.all([fetchData(), fetchFolderTree()]);
        }
      }
    } catch {
      toastState.add("error", "Upload failed unexpectedly");
    }
  }

  function handleDragOver(e: DragEvent): void {
    try {
      if (activeTab !== "active") return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
      isDragging = true;
    } catch {}
  }

  function handleDragLeave(e: DragEvent): void {
    try {
      if (!isDragging) return;
      e.preventDefault();
      const currentTarget = e.currentTarget as HTMLElement | null;
      if (currentTarget) {
        const rect = currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return;
        }
      }
      isDragging = false;
    } catch {}
  }

  async function handleDrop(e: DragEvent): Promise<void> {
    try {
      if (activeTab !== "active") return;
      e.preventDefault();
      isDragging = false;

      const targetFolderId =
        currentPath === "root" ? "docs" : `docs/${currentPath}`;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        await uploadFilesList(files, targetFolderId);
        await Promise.all([fetchData(), fetchFolderTree()]);
      }
    } catch {}
  }

  async function handleOpenFolderInOs(
    e?: MouseEvent,
    folderPath?: string
  ): Promise<void> {
    if (e) e.stopPropagation();
    try {
      const cleanPath =
        !folderPath || folderPath === "root"
          ? "docs"
          : folderPath.startsWith("docs/")
            ? folderPath
            : `docs/${folderPath}`;
      await openFolderInOs(cleanPath, customBasePath);
    } catch {}
  }

  async function openInSystem(item: MixedItem): Promise<void> {
    try {
      await openFolderInOs(item.id, customBasePath);
    } catch {}
  }

  async function softDelete(
    item: MixedItem,
    suppressToast = false
  ): Promise<void> {
    try {
      const prev = fsItems;
      fsItems = fsItems.filter((entry) => entry.id !== item.id);
      try {
        await softDeleteFile(
          item.id,
          customBasePath,
          suppressToast
        );
      } catch (err) {
        if (isMounted) fsItems = prev;
        throw err;
      } finally {
        if (isMounted) {
          await Promise.all([fetchData(), fetchFolderTree()]);
        }
      }
    } catch {}
  }

  async function restore(
    item: MixedItem,
    suppressToast = false
  ): Promise<void> {
    try {
      const prev = fsItems;
      fsItems = fsItems.filter((entry) => entry.id !== item.id);
      try {
        await restoreFile(
          item.id,
          customBasePath,
          suppressToast
        );
      } catch (err) {
        if (isMounted) fsItems = prev;
        throw err;
      } finally {
        if (isMounted) {
          await Promise.all([fetchData(), fetchFolderTree()]);
        }
      }
    } catch {}
  }

  async function executePermDelete(
    item: MixedItem,
    suppressToast = false
  ): Promise<void> {
    try {
      const prev = fsItems;
      fsItems = fsItems.filter((entry) => entry.id !== item.id);
      try {
        await deleteFile(
          item.id,
          customBasePath,
          suppressToast,
          item.type === "folder" || item.item?.is_dir
        );
      } catch (err) {
        if (isMounted) fsItems = prev;
        throw err;
      } finally {
        if (isMounted) {
          await Promise.all([fetchData(), fetchFolderTree()]);
        }
      }
    } catch {}
  }

  function permDelete(item: MixedItem): void {
    try {
      confirmDialog = {
        isOpen: true,
        title: `Move “${item.name}” to Windows Recycle Bin?`,
        message:
          "This will move the item to your Windows Recycle Bin. You can restore it from the Recycle Bin or empty it there to delete permanently.",
        onConfirm: async () => {
          await executePermDelete(item);
        },
      };
    } catch {}
  }

  async function bulkAction(
    action: "softDelete" | "restore" | "permDelete"
  ): Promise<void> {
    try {
      const itemsToProcess =
        selectedIds.size > 0
          ? itemsToShow.filter((item) => selectedIds.has(item.id))
          : [...itemsToShow];

      if (itemsToProcess.length === 0) return;
      const targetIdsList = itemsToProcess.map((item) => item.id);
      const targetIdsSet = new Set(targetIdsList);
      const prev = fsItems;

      if (action === "softDelete") {
        fsItems = fsItems.filter((item) => !targetIdsSet.has(item.id));
        selectedIds = new Set();
        try {
          await bulkSoftDeleteFilesApi(
            targetIdsList,
            customBasePath
          );
        } catch {
          if (isMounted) fsItems = prev;
        }
        if (isMounted) await Promise.all([fetchData(), fetchFolderTree()]);
        return;
      }

      if (action === "restore") {
        fsItems = fsItems.filter((item) => !targetIdsSet.has(item.id));
        selectedIds = new Set();
        try {
          await bulkRestoreFilesApi(
            targetIdsList,
            customBasePath
          );
          if (!isMounted) return;
        } catch {
          if (isMounted) fsItems = prev;
        }
        if (isMounted) await Promise.all([fetchData(), fetchFolderTree()]);
        return;
      }

      if (selectedIds.size === 0) {
        confirmDialog = {
          isOpen: true,
          title: "Empty Trash?",
          message:
            "All items in Trash will be moved to your Windows Recycle Bin. You can restore them from the Recycle Bin or empty it there to delete permanently.",
          onConfirm: async () => {
            try {
              fsItems = [];
              selectedIds = new Set();
              await emptyDocumentsTrashApi(customBasePath);
              if (isMounted) await Promise.all([fetchData(), fetchFolderTree()]);
            } catch {
              if (isMounted) await Promise.all([fetchData(), fetchFolderTree()]);
            }
          },
        };
        return;
      }

      confirmDialog = {
        isOpen: true,
        title: `Move ${itemsToProcess.length} item(s) to Windows Recycle Bin?`,
        message:
          "The selected items will be moved to your Windows Recycle Bin. You can restore them from the Recycle Bin or empty it there to delete permanently.",
        onConfirm: async () => {
          try {
            fsItems = fsItems.filter((item) => !targetIdsSet.has(item.id));
            selectedIds = new Set();
            try {
              await bulkDeleteFilesApi(
                itemsToProcess.map((item) => ({
                  id: item.id,
                  isDir: item.type === "folder" || Boolean(item.item?.is_dir),
                })),
                customBasePath
              );
              if (!isMounted) return;
            } catch {
              if (isMounted) fsItems = prev;
            }
            if (isMounted) await Promise.all([fetchData(), fetchFolderTree()]);
          } catch {}
        },
      };
    } catch {}
  }

  async function handleBatchInternalMove(
    items: Array<{ id: string; name: string }>,
    targetFolderId: string
  ): Promise<void> {
    try {
      if (!Array.isArray(items) || items.length === 0 || !targetFolderId) return;
      let movedCount = 0;
      for (let i = 0, len = items.length; i < len; i++) {
        const item = items[i];
        if (
          !item ||
          !item.id ||
          !item.name ||
          item.id === targetFolderId ||
          targetFolderId.startsWith(`${item.id}/`) ||
          item.id === `${targetFolderId}/${item.name}` ||
          PATH_TRAVERSAL_PATTERN.test(item.id) ||
          PATH_TRAVERSAL_PATTERN.test(targetFolderId) ||
          INVALID_FILENAME_CHARS_PATTERN.test(item.name)
        ) {
          continue;
        }
        try {
          await moveFile(
            item.id,
            `${targetFolderId}/${item.name}`,
            customBasePath,
            items.length > 1
          );
          movedCount++;
        } catch {}
      }
      if (items.length > 1 && movedCount > 0) {
        toastState.add("success", `Moved ${movedCount} items successfully`);
      }
      if (isMounted) {
        selectedIds = new Set();
        selectedTreeFilePath = null;
        await Promise.all([fetchData(), fetchFolderTree()]);
      }
    } catch {}
  }

  function buildDragStartPayload(
    currentItem: MixedItem
  ): Array<{ id: string; name: string }> {
    if (!selectedIds.has(currentItem.id)) {
      return [{ id: currentItem.id, name: currentItem.name }];
    }
    const payload: Array<{ id: string; name: string }> = [];
    const lookup = itemByIdMap;
    for (const id of selectedIds) {
      const matched = lookup.get(id);
      if (matched) {
        payload.push({ id, name: matched.name });
      }
    }
    return payload.length > 0
      ? payload
      : [{ id: currentItem.id, name: currentItem.name }];
  }

  interface DragItemPayload {
    id: string;
    name: string;
    type?: "document" | "folder";
  }

  let pointerDragState = $state<{
    isDragging: boolean;
    items: DragItemPayload[];
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    targetFolderId: string | null;
    targetFolderName: string | null;
    targetFolderType: "tree" | "table" | "breadcrumb" | null;
  } | null>(null);

  let draggedItemIdSet = $derived.by(() => {
    if (!pointerDragState?.isDragging || !pointerDragState.items) return new Set<string>();
    return new Set(pointerDragState.items.map((it) => it.id));
  });

  let activePointerId: number | null = null;
  let pointerThresholdPassed = false;
  let pendingDragItems: DragItemPayload[] = [];
  let dragStartCoords = { x: 0, y: 0 };

  const blockNativeDrag = (ev: Event): void => {
    ev.preventDefault();
  };

  function onGlobalPointerMove(e: PointerEvent): void {
    if (activePointerId === null || pendingDragItems.length === 0) return;

    const dx = e.clientX - dragStartCoords.x;
    const dy = e.clientY - dragStartCoords.y;
    const dist = Math.hypot(dx, dy);

    if (!pointerThresholdPassed) {
      if (dist < 4) return;
      pointerThresholdPassed = true;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "grabbing";
    }

    let foundFolderId: string | null = null;
    let foundFolderName: string | null = null;
    let foundType: "tree" | "table" | "breadcrumb" | null = null;

    const elem = document.elementFromPoint(e.clientX, e.clientY);
    if (elem) {
      const dropTarget = elem.closest<HTMLElement>("[data-drop-folder]");
      if (dropTarget) {
        const folderId = dropTarget.dataset.dropFolder;
        if (folderId) {
          const isDraggingThisFolder = pendingDragItems.some(
            (it) => it.id === folderId || folderId.startsWith(it.id + "/")
          );
          if (!isDraggingThisFolder) {
            foundFolderId = folderId;
            foundFolderName =
              dropTarget.dataset.dropName ||
              (folderId === "docs"
                ? "Documents"
                : folderId.split("/").pop() || folderId);
            if (dropTarget.closest("[data-tree-sidebar]")) {
              foundType = "tree";
            } else if (dropTarget.closest("[data-breadcrumbs]")) {
              foundType = "breadcrumb";
            } else {
              foundType = "table";
            }
          }
        }
      }
    }

    pointerDragState = {
      isDragging: true,
      items: pendingDragItems,
      startX: dragStartCoords.x,
      startY: dragStartCoords.y,
      currentX: e.clientX,
      currentY: e.clientY,
      targetFolderId: foundFolderId,
      targetFolderName: foundFolderName,
      targetFolderType: foundType,
    };

    dragOverTreePath =
      foundType === "tree" && foundFolderId
        ? foundFolderId === "docs"
          ? "root"
          : foundFolderId.replace(/^docs\//, "")
        : null;
    dragHoverId = foundType === "table" ? foundFolderId : null;
    dragBreadcrumbId =
      foundType === "breadcrumb" && foundFolderId
        ? foundFolderId === "docs"
          ? "root"
          : foundFolderId.replace(/^docs\//, "")
        : null;
  }

  async function onGlobalPointerUp(_e?: PointerEvent): Promise<void> {
    window.removeEventListener("pointermove", onGlobalPointerMove);
    window.removeEventListener("pointerup", onGlobalPointerUp);
    window.removeEventListener("pointercancel", onGlobalPointerUp);
    window.removeEventListener("dragstart", blockNativeDrag, true);
    window.removeEventListener("selectstart", blockNativeDrag, true);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";

    const wasDragging = pointerThresholdPassed && pointerDragState?.isDragging;
    const targetFolderId = pointerDragState?.targetFolderId;
    const itemsToMove = pointerDragState?.items ? [...pointerDragState.items] : [];

    activePointerId = null;
    pointerThresholdPassed = false;
    pendingDragItems = [];
    pointerDragState = null;
    dragOverTreePath = null;
    dragHoverId = null;
    dragBreadcrumbId = null;

    if (wasDragging) {
      const suppressClick = (clickEv: MouseEvent) => {
        clickEv.stopPropagation();
        clickEv.preventDefault();
        window.removeEventListener("click", suppressClick, true);
      };
      window.addEventListener("click", suppressClick, true);
      setTimeout(() => {
        window.removeEventListener("click", suppressClick, true);
      }, 100);
    }

    if (wasDragging && targetFolderId && itemsToMove.length > 0) {
      await handleBatchInternalMove(itemsToMove, targetFolderId);
    }
  }

  function handleRowPointerDown(e: PointerEvent, item: MixedItem): void {
    if (e.button !== 0 || activeTab !== "active") return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, select, textarea, [data-no-drag]")) {
      return;
    }

    activePointerId = e.pointerId;
    pointerThresholdPassed = false;
    dragStartCoords = { x: e.clientX, y: e.clientY };

    const payload = buildDragStartPayload(item);
    pendingDragItems = payload.map((p) => ({
      id: p.id,
      name: p.name,
      type: itemByIdMap.get(p.id)?.type || item.type,
    }));

    window.addEventListener("dragstart", blockNativeDrag, true);
    window.addEventListener("selectstart", blockNativeDrag, true);
    window.addEventListener("pointermove", onGlobalPointerMove, { passive: false });
    window.addEventListener("pointerup", onGlobalPointerUp);
    window.addEventListener("pointercancel", onGlobalPointerUp);
  }

  function handleTreeFilePointerDown(e: PointerEvent, file: DocumentTreeEntry): void {
    if (e.button !== 0 || activeTab !== "active") return;
    const target = getTreeFileTarget(file);
    activePointerId = e.pointerId;
    pointerThresholdPassed = false;
    dragStartCoords = { x: e.clientX, y: e.clientY };

    let itemsToMove: DragItemPayload[] = [
      { id: target.targetFileId, name: file.name, type: "document" },
    ];
    if (selectedIds.has(target.targetFileId) && selectedIds.size > 1) {
      const lookup = itemByIdMap;
      const batch: DragItemPayload[] = [];
      for (const id of selectedIds) {
        const matched = lookup.get(id);
        if (matched) {
          batch.push({ id, name: matched.name, type: matched.type });
        }
      }
      if (batch.length > 0) itemsToMove = batch;
    }
    pendingDragItems = itemsToMove;

    window.addEventListener("dragstart", blockNativeDrag, true);
    window.addEventListener("selectstart", blockNativeDrag, true);
    window.addEventListener("pointermove", onGlobalPointerMove, { passive: false });
    window.addEventListener("pointerup", onGlobalPointerUp);
    window.addEventListener("pointercancel", onGlobalPointerUp);
  }

  function handleTreeFolderPointerDown(e: PointerEvent, node: FolderTreeNode): void {
    if (e.button !== 0 || activeTab !== "active") return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button:not(.flex-1), [role='toolbar'], a, input")) {
      return;
    }

    const folderId = `docs/${node.path}`;
    activePointerId = e.pointerId;
    pointerThresholdPassed = false;
    dragStartCoords = { x: e.clientX, y: e.clientY };

    let itemsToMove: DragItemPayload[] = [
      { id: folderId, name: node.name, type: "folder" },
    ];
    if (selectedIds.has(folderId) && selectedIds.size > 1) {
      const lookup = itemByIdMap;
      const batch: DragItemPayload[] = [];
      for (const id of selectedIds) {
        const matched = lookup.get(id);
        if (matched) {
          batch.push({ id, name: matched.name, type: matched.type });
        }
      }
      if (batch.length > 0) itemsToMove = batch;
    }
    pendingDragItems = itemsToMove;

    window.addEventListener("dragstart", blockNativeDrag, true);
    window.addEventListener("selectstart", blockNativeDrag, true);
    window.addEventListener("pointermove", onGlobalPointerMove, { passive: false });
    window.addEventListener("pointerup", onGlobalPointerUp);
    window.addEventListener("pointercancel", onGlobalPointerUp);
  }
</script>

<div
  class="flex h-full gap-4"
  role="region"
  aria-label="Documents workspace"
>
  {@render directoryTreeSidebar()}
  <div
    class="relative h-full flex-1 min-w-0"
    role="region"
    aria-label="Documents drop zone"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    {#if isDragging}
      <div
        class="absolute inset-0 z-command bg-primary/10 border-2 border-dashed border-primary rounded-xl flex items-center justify-center backdrop-blur-sm pointer-events-none transition-all duration-200"
      >
        <div
          class="flex flex-col items-center gap-4 text-primary bg-background/80 p-8 rounded-2xl shadow-xl"
        >
          <UploadCloud class="w-16 h-16 animate-bounce" />
          <span class="text-xl font-bold">Drop files to upload</span>
        </div>
      </div>
    {/if}
    <PageLayout
      class="relative z-overlay h-full border-0 overflow-hidden flex flex-col"
    >
      <Toolbar>
        {#snippet search()}
          <div class="flex items-center gap-3 sm:gap-4 min-w-0">
            <TabSwitcher
              tabs={[
                { value: "active", label: "Active", icon: FolderIcon },
                { value: "trash", label: "Trash", icon: Trash2 },
              ]}
              value={activeTab}
              onValueChange={(val) => {
                activeTab = val as "active" | "trash";
                selectedIds = new Set();
                currentPath = "root";
              }}
            />
            <SearchBar
              bind:value={searchQuery}
              placeholder="Search files..."
              containerClass="flex-1 min-w-0 sm:max-w-xs"
            />
          </div>
        {/snippet}

        {#snippet actions()}
          {#if activeTab === "active"}
            <Button
              variant="destructive-outline"
              size="sm"
              onclick={() => bulkAction("softDelete")}
              disabled={itemsToShow.length === 0}
            >
              <Trash2 class="w-4 h-4" />
              <span class="hidden sm:inline">
                {selectedIds.size > 0
                  ? `Delete (${selectedIds.size})`
                  : "Delete All"}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onclick={(e) => handleOpenFolderInOs(e, currentPath)}
              title="Open current folder in File Explorer"
            >
              <FolderOpen class="w-4 h-4" />
              <span class="hidden sm:inline">Open in Explorer</span>
            </Button>
            <Button
              variant="default"
              size="sm"
              onclick={handleCreateNewNote}
              title="New Note (Ctrl+N)"
            >
              <PlusCircle class="w-4 h-4" />
              <span class="hidden sm:inline">New Note</span>
            </Button>
          {/if}
          {#if activeTab === "trash"}
            <Button
              variant="outline"
              size="sm"
              onclick={(e) => handleOpenFolderInOs(e, ".trash")}
              title="Open Trash folder in File Explorer"
            >
              <FolderOpen class="w-4 h-4" />
              <span class="hidden sm:inline">Open in Explorer</span>
            </Button>
            <Button
              variant="success-outline"
              size="sm"
              onclick={() => bulkAction("restore")}
              disabled={itemsToShow.length === 0}
            >
              <RefreshCcw class="w-4 h-4" />
              <span class="hidden sm:inline">
                {selectedIds.size > 0
                  ? `Restore (${selectedIds.size})`
                  : "Restore All"}
              </span>
            </Button>
            <Button
              variant="destructive-outline"
              size="sm"
              onclick={() => bulkAction("permDelete")}
              disabled={itemsToShow.length === 0}
            >
              <Trash2 class="w-4 h-4" />
              <span class="hidden sm:inline">
                {selectedIds.size > 0
                  ? `Delete (${selectedIds.size})`
                  : "Delete All"}
              </span>
            </Button>
          {/if}
        {/snippet}
      </Toolbar>

      <TableContainer onclick={() => { selectedIds = new Set(); selectedTreeFilePath = null; }} class="px-2! sm:px-2!">
        <Table style="min-width: {colResizer.totalWidth}px;">
          <TableHeader onclick={(e: MouseEvent) => e.stopPropagation()}>
            <TableRow>
              <TableHead
                style={colResizer.getStyle("name")}
                class="cursor-pointer select-none group relative px-2!"
                onclick={() => handleSort("name")}
                aria-sort={sortKey === "name"
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"}
              >
                <div class="flex items-center gap-2 min-w-0 pr-2">
                  <span class="truncate">Name</span>
                  <SortIcon
                    active={sortKey === "name"}
                    direction={sortDirection}
                  />
                </div>
                <ColumnResizer
                  isResizing={colResizer.resizingPair === "name-updatedAt"}
                  onResize={(d) => colResizer.resizePair("name", "updatedAt", d)}
                  onFinish={() => colResizer.finishResize()}
                  onReset={() => colResizer.resetPair("name", "updatedAt")}
                />
              </TableHead>
              <TableHead
                style={colResizer.getStyle("updatedAt")}
                class="hidden lg:table-cell cursor-pointer select-none group relative px-2!"
                onclick={() => handleSort("updatedAt")}
                aria-sort={sortKey === "updatedAt"
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"}
              >
                <div class="flex items-center gap-2 min-w-0 pr-2">
                  <span class="truncate">Modified</span>
                  <SortIcon
                    active={sortKey === "updatedAt"}
                    direction={sortDirection}
                  />
                </div>
                <ColumnResizer
                  isResizing={colResizer.resizingPair === "updatedAt-size"}
                  onResize={(d) => colResizer.resizePair("updatedAt", "size", d)}
                  onFinish={() => colResizer.finishResize()}
                  onReset={() => colResizer.resetPair("updatedAt", "size")}
                />
              </TableHead>
              <TableHead
                style={colResizer.getStyle("size")}
                class="hidden md:table-cell cursor-pointer select-none group relative px-2!"
                onclick={() => handleSort("size")}
                aria-sort={sortKey === "size"
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"}
              >
                <div class="flex items-center gap-2 min-w-0 pr-2">
                  <span class="truncate">Size</span>
                  <SortIcon
                    active={sortKey === "size"}
                    direction={sortDirection}
                  />
                </div>
                <ColumnResizer disabled />
              </TableHead>
              <TableHead
                style={colResizer.getStyle("actions")}
                class="text-left pl-3! pr-4! select-none whitespace-nowrap"
              >
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#if itemsToShow.length === 0}
              <TableRow class="hover:bg-transparent! cursor-default!">
                <TableCell class="p-0 align-middle" colspan={4}>
                  <div
                    class="flex items-center justify-center w-full h-[calc(100vh-16rem)]"
                  >
                    <EmptyState
                      icon={activeTab === "trash" ? Trash2 : FolderIcon}
                      title={activeTab === "trash"
                        ? "Trash is empty"
                        : "No files yet"}
                      description={activeTab === "trash"
                        ? "Deleted files will appear here"
                        : "Upload files or create folders"}
                    />
                  </div>
                </TableCell>
              </TableRow>
            {:else}
              {#each itemsToShow as item (item.id)}
                {@const isBeingDragged = draggedItemIdSet.has(item.id)}
                <TableRow
                  class="border-transparent {isBeingDragged
                    ? 'opacity-40 ring-1 ring-primary/40'
                    : dragHoverId === item.id
                      ? 'border-primary ring-2 ring-primary/40 bg-primary/20 text-primary'
                      : ''}"
                  selected={selectedIds.has(item.id)}
                  data-item-id={item.id}
                  data-drop-folder={item.type === "folder" ? item.id : undefined}
                  data-drop-name={item.type === "folder" ? item.name : undefined}
                  role="row"
                  onpointerdown={(e: PointerEvent) => handleRowPointerDown(e, item)}
                  draggable={false}
                  ondragstart={(e) => e.preventDefault()}
                  ondragover={(e: DragEvent) => {
                    try {
                      if (item.type !== "folder" || activeTab !== "active") return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = "move";
                      }
                      dragHoverId = item.id;
                    } catch {}
                  }}
                  ondragleave={(e: DragEvent) => {
                    try {
                      const currentTarget = e.currentTarget as HTMLElement | null;
                      if (currentTarget) {
                        const rect = currentTarget.getBoundingClientRect();
                        const x = e.clientX;
                        const y = e.clientY;
                        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                          return;
                        }
                      }
                      if (dragHoverId === item.id) {
                        dragHoverId = null;
                      }
                    } catch {}
                  }}
                  ondrop={async (e: DragEvent) => {
                    try {
                      if (item.type !== "folder") return;
                      e.preventDefault();
                      e.stopPropagation();
                      dragHoverId = null;

                      const files = e.dataTransfer?.files;
                      if (files && files.length > 0) {
                        await uploadFilesList(files, item.id);
                        await Promise.all([fetchData(), fetchFolderTree()]);
                      }
                    } catch {}
                  }}
                  onclick={(e: MouseEvent) => handleRowClick(e, item.id)}
                  ondblclick={(e: MouseEvent) => {
                    try {
                      e.stopPropagation();
                      if (item.type === "folder") {
                        let newPath = item.id;
                        if (newPath.startsWith("docs/.trash/")) {
                          newPath = newPath.substring(12);
                        } else if (newPath.startsWith("docs/")) {
                          newPath = newPath.substring(5);
                        }
                        currentPath = newPath || "root";
                        searchQuery = "";
                        selectedIds = new Set();
                      } else if (item.type === "document") {
                        if (isTextOrMarkdownFile(item.name)) {
                          openDocumentEditor(item);
                        } else {
                          openInSystem(item);
                        }
                      }
                    } catch {}
                  }}
                >
                  <TableCell
                    style={colResizer.getStyle("name")}
                    class="font-medium text-foreground align-middle px-2! overflow-hidden"
                  >
                    {@const visual = getFileVisual(item.name, item.type === "folder")}
                    {@const VisualIcon = visual.icon}
                    <div class="flex items-center gap-3 min-w-0">
                      <VisualIcon class="w-5 h-5 shrink-0 {visual.colorClass} {visual.fillClass}" />
                      <span class="truncate">{item.name}</span>
                    </div>
                  </TableCell>
                  <TableCell
                    style={colResizer.getStyle("updatedAt")}
                    class="hidden lg:table-cell text-muted-foreground text-xs whitespace-nowrap px-2! overflow-hidden"
                  >
                    <span class="truncate block">{item.formattedDate}</span>
                  </TableCell>
                  <TableCell
                    style={colResizer.getStyle("size")}
                    class="hidden md:table-cell text-muted-foreground text-xs whitespace-nowrap px-2! overflow-hidden"
                  >
                    <span class="truncate block">{item.formattedSize}</span>
                  </TableCell>
                  <TableCell
                    style={colResizer.getStyle("actions")}
                    class="text-left pl-3! pr-4! whitespace-nowrap overflow-hidden"
                  >
                    <div
                      class="flex items-center justify-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100 min-h-8 min-w-8"
                    >
                      <span class="sr-only">&nbsp;</span>
                      {#if activeTab === "active"}
                        <ActionButton
                          variant="edit"
                          icon={Pencil}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation();
                            folderToRename = item;
                            renameFolderName = item.name;
                            renameFolderOpen = true;
                          }}
                          title="Rename"
                        />
                        <ActionButton
                          variant="delete"
                          icon={Trash2}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation();
                            softDelete(item);
                          }}
                          title="Delete"
                        />
                      {:else if activeTab === "trash"}
                        <ActionButton
                          variant="restore"
                          icon={RefreshCcw}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation();
                            restore(item);
                          }}
                          title="Restore"
                        />
                        <ActionButton
                          variant="delete"
                          icon={Trash2}
                          onClick={(e: MouseEvent) => {
                            e.stopPropagation();
                            permDelete(item);
                          }}
                          title="Move to Windows Recycle Bin"
                        />
                      {/if}
                    </div>
                  </TableCell>
                </TableRow>
              {/each}
            {/if}
          </TableBody>
        </Table>
      </TableContainer>

      <div
        class="flex items-center justify-between min-h-10 p-3 border-t border-border text-sm shrink-0 overflow-x-auto whitespace-nowrap w-full mt-auto"
      >
        <div
          class="flex-1 overflow-x-auto whitespace-nowrap min-w-0"
          bind:clientWidth={breadcrumbContainerWidth}
        >
          <div
            data-breadcrumbs="true"
            class="flex items-center gap-2 text-muted-foreground font-medium flex-nowrap whitespace-nowrap h-8 w-full"
          >
            {#each breadcrumbs as crumb, idx (crumb.id)}
              <div class="flex items-center gap-1 min-w-0 shrink">
                {#if idx > 0}
                  <ChevronRight
                    class="w-3.5 h-3.5 text-muted-foreground/60 shrink-0"
                  />
                {/if}
                {#if crumb.id === "ellipsis"}
                  <span
                    class="px-2 text-muted-foreground/50 font-bold tracking-widest shrink-0"
                    >...</span
                  >
                {:else}
                  <button
                    data-drop-folder={crumb.id === "root" ? "docs" : `docs/${crumb.id}`}
                    data-drop-name={crumb.name}
                    class="transition-colors flex items-center gap-1.5 shrink min-w-0 px-1.5 py-0.5 rounded-sm {dragBreadcrumbId ===
                    crumb.id
                      ? 'bg-primary/20 text-primary ring-1 ring-primary'
                      : 'hover:text-foreground'}"
                    onclick={() => {
                      currentPath = crumb.id;
                      searchQuery = "";
                      selectedIds = new Set();
                    }}
                    ondragover={(e: DragEvent) => {
                      try {
                        if (activeTab !== "active") return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.dataTransfer) {
                          e.dataTransfer.dropEffect = "move";
                        }
                        dragBreadcrumbId = crumb.id;
                      } catch {}
                    }}
                    ondragleave={(e: DragEvent) => {
                      try {
                        const currentTarget = e.currentTarget as HTMLElement | null;
                        if (currentTarget) {
                          const rect = currentTarget.getBoundingClientRect();
                          const x = e.clientX;
                          const y = e.clientY;
                          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                            return;
                          }
                        }
                        if (dragBreadcrumbId === crumb.id) {
                          dragBreadcrumbId = null;
                        }
                      } catch {}
                    }}
                    ondrop={async (e: DragEvent) => {
                      try {
                        if (activeTab !== "active") return;
                        e.preventDefault();
                        e.stopPropagation();
                        dragBreadcrumbId = null;

                        const targetFolderId =
                          crumb.id === "root"
                            ? "docs"
                            : `docs/${crumb.id}`;

                        const files = e.dataTransfer?.files;
                        if (files && files.length > 0) {
                          await uploadFilesList(files, targetFolderId);
                          await Promise.all([fetchData(), fetchFolderTree()]);
                        }
                      } catch {}
                    }}
                  >
                    {#if crumb.id === "root"}
                      {#if activeTab === "trash"}
                        <Trash2 class="w-4 h-4 shrink-0" />
                      {:else}
                        <FolderIcon class="w-4 h-4 shrink-0 text-amber-500 dark:text-amber-400 fill-amber-500/20" />
                      {/if}
                    {:else}
                      <span
                        class="max-w-[150px] truncate block"
                        title={crumb.name}>{crumb.name}</span
                      >
                    {/if}
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>
    </PageLayout>
  </div>
</div>

  {#snippet renderFileTreeNode(file: DocumentTreeEntry)}
    {@const visual = getFileVisual(file.name, false)}
    {@const VisualIcon = visual.icon}
    {@const target = getTreeFileTarget(file)}
    {@const isFileSelected = selectedTreeFilePath === file.path || selectedIds.has(target.targetFileId)}
    {@const isFileBeingDragged = draggedItemIdSet.has(target.targetFileId)}

    <button
      type="button"
      onpointerdown={(e) => handleTreeFilePointerDown(e, file)}
      draggable={false}
      ondragstart={(e) => e.preventDefault()}
      class="group/file relative flex items-center w-full rounded-lg py-1.5 px-1 transition-all duration-150 select-none cursor-pointer text-left {isFileBeingDragged
        ? 'opacity-40 ring-1 ring-primary/40'
        : isFileSelected
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
      onclick={() => selectFileFromTree(file)}
      title={file.name}
    >
      <div class="w-5 shrink-0 pointer-events-none"></div>

      <div
        class="w-5 h-5 flex items-center justify-center shrink-0 pointer-events-none transition-[margin] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isFolderSidebarOpen
          ? 'ml-0'
          : 'ml-[5px]'}"
      >
        <VisualIcon class="w-3.5 h-3.5 shrink-0 {visual.colorClass} {visual.fillClass}" />
      </div>

      <div
        class="text-left text-xs whitespace-nowrap overflow-hidden truncate pointer-events-none transition-[opacity,margin,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isFolderSidebarOpen
          ? 'opacity-100 ml-1.5 flex-1 min-w-0 mr-1'
          : 'opacity-0 ml-0 w-0'}"
      >
        {file.name}
      </div>
    </button>
  {/snippet}

  {#snippet renderFolderTreeNode(node: FolderTreeNode, depth: number)}
    {@const hasChildren = node.children.length > 0}
    {@const hasFiles = node.files.length > 0}
    {@const hasExpandableItems = hasChildren || hasFiles}
    {@const isExpanded = treeSearchQuery.trim()
      ? true
      : expandedFolderPaths.has(node.path)}
    {@const isSelected = currentPath === node.path && !selectedTreeFilePath}
    {@const isDragOver = dragOverTreePath === node.path}
    {@const folderId = `docs/${node.path}`}
    {@const isFolderBeingDragged = draggedItemIdSet.has(folderId)}

    <div class="flex flex-col w-full">
      <div
        class="group/item relative flex items-center w-full rounded-lg transition-all duration-150 {isFolderBeingDragged
          ? 'opacity-40 ring-1 ring-primary/40'
          : isDragOver
            ? 'border border-primary/40 ring-2 ring-primary bg-primary/20 text-primary'
            : isSelected
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
        role="region"
        aria-label="{node.name} drop target"
        data-drop-folder={folderId}
        data-drop-name={node.name}
        onpointerdown={(e) => handleTreeFolderPointerDown(e, node)}
        draggable={false}
        ondragstart={(e) => e.preventDefault()}
        ondragover={(e) => handleTreeDragOver(e, node.path)}
        ondragleave={(e) => handleTreeDragLeave(e, node.path)}
        ondrop={(e) => handleTreeDrop(e, node.path)}
      >
        {#if isFolderSidebarOpen}
          {#if hasExpandableItems}
            <button
              type="button"
              draggable={false}
              ondragstart={(e) => e.stopPropagation()}
              class="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground shrink-0 ml-0.5 transition-colors cursor-pointer"
              onclick={(e) => toggleExpandFolder(e, node.path)}
              title={isExpanded ? "Collapse subfolders" : "Expand subfolders"}
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {#if isExpanded}
                <ChevronDown class="w-3.5 h-3.5" />
              {:else}
                <ChevronRight class="w-3.5 h-3.5" />
              {/if}
            </button>
          {:else if depth > 0}
            <button
              type="button"
              draggable={false}
              ondragstart={(e) => e.stopPropagation()}
              class="w-5 h-5 flex items-center justify-center shrink-0 ml-0.5 text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
              onclick={() => navigateToTreeFolder(node.path)}
              tabindex="-1"
              title="{node.name} (Subfolder)"
              aria-label="{node.name} branch"
            >
              <CornerDownRight class="w-3 h-3 shrink-0 opacity-50" />
            </button>
          {:else}
            <div class="w-5 shrink-0"></div>
          {/if}
        {/if}

        <button
          class="flex-1 flex items-center {isFolderSidebarOpen
            ? 'px-1'
            : 'px-3'} py-1.5 rounded-lg text-sm transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] text-left min-w-0"
          onclick={() => navigateToTreeFolder(node.path)}
          title={node.name}
        >
          <div
            class="w-5 h-5 flex items-center justify-center shrink-0 pointer-events-none transition-[margin] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isFolderSidebarOpen
              ? 'ml-0'
              : 'ml-[5px]'}"
          >
            {#if isSelected || isExpanded}
              <FolderOpen class="w-4 h-4 text-amber-500 dark:text-amber-400 fill-amber-500/20" />
            {:else}
              <FolderIcon class="w-4 h-4 text-amber-500/80 dark:text-amber-400/80 fill-amber-500/15" />
            {/if}
          </div>
          <div
            class="text-left whitespace-nowrap overflow-hidden truncate pointer-events-none transition-[opacity,margin,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isFolderSidebarOpen
              ? 'opacity-100 ml-1.5 flex-1 min-w-0 mr-1'
              : 'opacity-0 ml-0 w-0'}"
          >
            {node.name}
          </div>
        </button>

        {#if isFolderSidebarOpen}
          <div
            role="toolbar"
            aria-label="Folder actions"
            class="absolute right-1.5 flex items-center gap-0.5 transition-[opacity,transform] duration-200 {isFolderSidebarOpen
              ? 'opacity-0 group-hover/item:opacity-100 scale-100'
              : 'opacity-0 scale-75 pointer-events-none'} bg-card/95 backdrop-blur-xs pl-1 pr-0.5 py-0.5 rounded-md shadow-xs z-20"
          >
            <button
              class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              onclick={(e) => handleOpenFolderInOs(e, node.path)}
              title="Open in File Explorer"
              aria-label="Open in File Explorer"
            >
              <ExternalLink class="w-3.5 h-3.5" />
            </button>
            <button
              class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              onclick={(e) => openCreateSubfolderModal(e, node.path)}
              title="Add subfolder"
              aria-label="Add subfolder"
            >
              <Plus class="w-3.5 h-3.5" />
            </button>
            <button
              class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-foreground transition-colors cursor-pointer"
              onclick={(e) => openRenameTreeFolder(e, node)}
              title="Edit folder"
              aria-label="Edit folder"
            >
              <Pencil class="w-3.5 h-3.5" />
            </button>
            <button
              class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-rose-500 transition-colors cursor-pointer"
              onclick={(e) => confirmDeleteTreeFolder(e, node)}
              title="Delete folder"
              aria-label="Delete folder"
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          </div>
        {/if}
      </div>

      {#if isFolderSidebarOpen && hasExpandableItems && isExpanded}
        <div
          class="ml-3 pl-2 border-l border-border/40 space-y-0.5 my-0.5 flex flex-col"
        >
          {#each node.children as child (child.path)}
            {@render renderFolderTreeNode(child, depth + 1)}
          {/each}
          {#each node.files as file (file.path)}
            {@render renderFileTreeNode(file)}
          {/each}
        </div>
      {/if}
    </div>
  {/snippet}

{#snippet directoryTreeSidebar()}
  <!-- Directory Tree Sidebar -->
  <div
    data-tree-sidebar="true"
    style="width: {folderSidebar.width}px;"
    class="shrink-0 relative flex flex-col gap-2 rounded-l-none rounded-r-2xl bg-card border border-l-0 shadow-xs overflow-hidden pb-4 will-change-[width] {folderSidebar.isResizing
      ? 'select-none'
      : 'transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'}"
  >
    <div
      class="group/resizer absolute top-0 right-0 w-2.5 h-full cursor-col-resize z-30 flex items-center justify-center select-none"
      onpointerdown={folderSidebar.handleResizePointerDown}
      ondblclick={folderSidebar.resetWidth}
      role="separator"
      aria-orientation="vertical"
      tabindex="-1"
      title="Drag to resize (Double-click to reset)"
    >
      <div
        class="w-[2px] h-full transition-colors {folderSidebar.isResizing
          ? 'bg-primary'
          : 'group-hover/resizer:bg-primary/50'}"
      ></div>
    </div>

    <div
      class="relative px-3 py-3 border-b bg-muted/20 flex items-center min-h-[3.25rem]"
    >
      <div
        class="text-left whitespace-nowrap overflow-hidden flex-1 min-w-0"
      >
        <div class="flex items-center gap-1.5">
          <FolderTree class="w-4 h-4 text-primary shrink-0" />
          <h3 class="font-semibold text-sm truncate">Directory Tree</h3>
        </div>
      </div>
    </div>

    {#if isFolderSidebarOpen}
      <div class="px-2 pt-1 pb-1">
        <div class="relative flex items-center">
          <Search
            class="absolute left-2.5 w-3.5 h-3.5 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            bind:value={treeSearchQuery}
            placeholder="Filter tree..."
            class="w-full h-8 pl-8 pr-7 text-xs rounded-md bg-muted/40 border border-input focus:bg-background focus:outline-hidden focus:ring-1 focus:ring-ring transition-colors"
          />
          {#if treeSearchQuery}
            <button
              type="button"
              onclick={() => (treeSearchQuery = "")}
              class="absolute right-2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
              title="Clear search"
            >
              <X class="w-3 h-3" />
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <div
      class="flex-1 overflow-y-auto px-2 py-1 space-y-1 mt-1 flex flex-col"
      role="region"
      aria-label="Directory tree view"
    >
      <div
        class="group/root relative flex items-center w-full rounded-lg transition-all duration-150 {dragOverTreePath ===
        'root'
          ? 'bg-primary/20 ring-2 ring-primary text-primary'
          : currentPath === 'root' && !selectedTreeFilePath
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
        role="region"
        aria-label="Root documents drop target"
        data-drop-folder="docs"
        data-drop-name="Documents"
        ondragover={(e) => handleTreeDragOver(e, 'root')}
        ondragleave={(e) => handleTreeDragLeave(e, 'root')}
        ondrop={(e) => handleTreeDrop(e, 'root')}
      >
        <button
          class="flex-1 flex items-center {isFolderSidebarOpen
            ? 'px-2'
            : 'px-3'} py-2 rounded-lg text-sm transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] text-left min-w-0 cursor-pointer"
          onclick={navigateToRoot}
          title={isFolderSidebarOpen ? undefined : "Documents"}
        >
          <div
            class="w-6 h-6 flex items-center justify-center shrink-0 pointer-events-none transition-[margin] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isFolderSidebarOpen
              ? 'ml-0'
              : 'ml-[3px]'}"
          >
            {#if currentPath === "root"}
              <FolderOpen class="w-4 h-4 text-amber-500 dark:text-amber-400 fill-amber-500/20" />
            {:else}
              <FolderIcon class="w-4 h-4 text-amber-500/80 dark:text-amber-400/80 fill-amber-500/15" />
            {/if}
          </div>
          <div
            class="text-left whitespace-nowrap overflow-hidden truncate pointer-events-none transition-[opacity,margin,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isFolderSidebarOpen
              ? 'opacity-100 ml-1.5 flex-1 min-w-0 mr-1'
              : 'opacity-0 ml-0 w-0'}"
          >
            Documents
          </div>
        </button>

        {#if isFolderSidebarOpen}
          <button
            type="button"
            class="p-1.5 mr-1 rounded-md text-muted-foreground hover:text-primary hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer opacity-80 group-hover/root:opacity-100"
            onclick={(e) => {
              e.stopPropagation();
              openCreateRootFolderModal();
            }}
            title="New Folder"
            aria-label="New Folder"
          >
            <Plus class="w-4 h-4" />
          </button>
        {/if}
      </div>

      {#each displayTreeNodes as rootFolder (rootFolder.path)}
        {@render renderFolderTreeNode(rootFolder, 0)}
      {/each}

      {#if displayRootFiles.length > 0}
        <div class="space-y-0.5 mt-0.5">
          {#each displayRootFiles as rootFile (rootFile.path)}
            {@render renderFileTreeNode(rootFile)}
          {/each}
        </div>
      {/if}

      {#if isFolderSidebarOpen && displayTreeNodes.length === 0 && displayRootFiles.length === 0 && treeSearchQuery}
        <div class="px-3 py-4 text-center text-xs text-muted-foreground">
          No folders or files match "{treeSearchQuery}"
        </div>
      {/if}
    </div>
  </div>
{/snippet}

<FormModal
  bind:isOpen={createFolderOpen}
  title={createFolderParentPath
    ? `New Subfolder in "${extractBaseFileName(createFolderParentPath)}"`
    : "New Folder"}
  submitText="Create"
  submitDisabled={!isValidFolderName(newFolderName)}
  onSubmit={handleCreateFolder}
>
  <FormField>
    <Input
      bind:value={newFolderName}
      placeholder="Folder Name"
      maxlength={MAX_FOLDER_NAME_LENGTH}
      required
    />
  </FormField>
</FormModal>

<FormModal
  bind:isOpen={renameFolderOpen}
  title="Rename Folder"
  submitText="Rename Folder"
  submitDisabled={!isValidFolderName(renameFolderName)}
  onSubmit={handleRenameFolder}
>
  <FormField>
    <Input
      bind:value={renameFolderName}
      placeholder="e.g. Invoices"
      maxlength={MAX_FOLDER_NAME_LENGTH}
      required
    />
  </FormField>
</FormModal>

<ConfirmModal
  bind:isOpen={confirmDialog.isOpen}
  title={confirmDialog.title}
  message={confirmDialog.message}
  onConfirm={confirmDialog.onConfirm}
  confirmText="Delete"
  cancelText="Cancel"
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
      <UploadCloud class="w-8 h-8 animate-bounce" />
    </div>

    <div class="w-full space-y-2">
      <div
        class="flex justify-between text-xs font-semibold text-muted-foreground px-1"
      >
        <span class="truncate max-w-[240px] text-left"
          >{progressStatusText}</span
        >
        <span class="font-mono text-primary font-bold"
          >{Math.round(progressPercent)}%</span
        >
      </div>

      <div
        class="w-full h-2.5 bg-muted rounded-full overflow-hidden border border-border/50"
      >
        <div
          class="h-full bg-gradient-to-r from-primary to-blue-500 transition-all duration-200 ease-out rounded-full"
          style="width: {progressPercent}%;"
        ></div>
      </div>
    </div>

    <div class="pt-2 w-full flex justify-center">
      <Button
        variant="outline"
        size="sm"
        disabled={isCancelling}
        class="gap-2 text-destructive hover:bg-destructive/10 border-destructive/30 disabled:opacity-60"
        onclick={() => {
          isCancelled = true;
          isCancelling = true;
          progressStatusText = "Cancelling operation and cleaning up...";
        }}
      >
        <X class="w-4 h-4 {isCancelling ? 'animate-spin' : ''}" />
        {isCancelling ? "Cancelling..." : "Cancel Process"}
      </Button>
    </div>
  </div>
</Modal>

<DocumentEditorModal
  bind:isOpen={isEditorOpen}
  filePath={editorFilePath}
  fileName={editorFileName}
  basePath={customBasePath}
  onSaved={async () => {
    if (isMounted) {
      await Promise.all([fetchData(), fetchFolderTree()]);
    }
  }}
/>

{#if pointerDragState?.isDragging}
  {@const count = pointerDragState.items.length}
  {@const firstItem = pointerDragState.items[0]}
  <div
    class="fixed left-0 top-0 z-[99999] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full bg-card/95 backdrop-blur-md border border-primary/50 shadow-2xl text-xs font-medium text-foreground will-change-transform"
    style="transform: translate3d({pointerDragState.currentX + 14}px, {pointerDragState.currentY + 14}px, 0);"
  >
    <span
      class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold leading-none shrink-0"
    >
      {count}
    </span>
    <span class="truncate max-w-48 text-xs font-medium text-foreground">
      {count > 1 ? `${count} items selected` : (firstItem?.name || "item")}
    </span>
    {#if pointerDragState.targetFolderId && pointerDragState.targetFolderName}
      <span class="text-primary font-semibold text-xs truncate max-w-36 shrink-0 flex items-center gap-1">
        <span>&rarr;</span>
        <span>{pointerDragState.targetFolderName}</span>
      </span>
    {/if}
  </div>
{/if}

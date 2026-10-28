<script lang="ts">
  import { onDestroy } from "svelte";
  import type { VaultItem, VaultGroup } from "../../shared/db/schema";
  import { getNextSelection, getNextSort } from "../../shared/utils/table";
  import { formatDate } from "../../shared/utils/format";
  import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  } from "../../shared/ui/dropdown";
  import {
    ShieldCheck,
    Key,
    Lock,
    Plus,
    PlusCircle,
    Trash2,
    Pencil,
    Copy,
    Eye,
    EyeOff,
    CheckCircle2,
    RefreshCcw,
    ChevronDown,
    ChevronRight,
    CornerDownRight,
    Folder,
    FolderOpen,
    FolderTree,
    GripVertical,
    Dices,
  } from "lucide-svelte";
  import { createPointerReorder } from "../../shared/utils/pointerReorder.svelte";
  import { createResizableSidebar } from "../../shared/utils/resizableSidebar.svelte";
  import Button from "../../shared/ui/Button.svelte";
  import ActionButton from "../../shared/ui/ActionButton.svelte";
  import Input from "../../shared/ui/Input.svelte";
  import FormField from "../../shared/ui/FormField.svelte";
  import FormModal from "../../shared/ui/FormModal.svelte";
  import PageLayout from "../../shared/ui/PageLayout.svelte";
  import Toolbar from "../../shared/ui/Toolbar.svelte";
  import SearchBar from "../../shared/ui/SearchBar.svelte";
  import EmptyState from "../../shared/ui/EmptyState.svelte";
  import SortIcon from "../../shared/ui/SortIcon.svelte";
  import TabSwitcher from "../../shared/ui/TabSwitcher.svelte";
  import ConfirmModal from "../../shared/ui/ConfirmModal.svelte";
  import CountBadge from "../../shared/ui/CountBadge.svelte";
  import { globalState } from "../../shared/store.svelte";
  import {
    TableContainer,
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    ColumnResizer,
  } from "../../shared/ui/table";
  import { createResizableColumns } from "../../shared/utils/resizableColumns.svelte";
  import { authenticateOS, getVaultKey } from "./api";
  import { VaultCrypto } from "./crypto";
  import { toastState } from "../../shared/toast.svelte";
  import { vaultStore } from "../../shared/vaultStore.svelte";

  interface DecryptedCredential {
    username: string;
    password: string;
    note: string;
  }

  const ZERO_WIDTH_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;
  const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/g;

  const MAX_RENDER_ITEMS = 500;
  const MAX_CREDENTIAL_NAME_LENGTH = 255;
  const MAX_GROUP_NAME_LENGTH = 255;
  const MAX_USERNAME_LENGTH = 1000;
  const MAX_PASSWORD_LENGTH = 1000;
  const MAX_NOTE_LENGTH = 4000;
  const DECRYPT_BATCH_SIZE = 15;
  const DECRYPT_YIELD_MS = 8;

  const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  const VAULT_TABS = [
    { value: "active", label: "Active", icon: ShieldCheck },
    { value: "trash", label: "Trash", icon: Trash2 },
  ];

  const DECRYPTING_PLACEHOLDER: Readonly<DecryptedCredential> = Object.freeze({
    username: "Decrypting...",
    password: "",
    note: "",
  });

  const DECRYPTION_ERROR_PLACEHOLDER: Readonly<DecryptedCredential> = Object.freeze({
    username: "Decryption Error",
    password: "",
    note: "",
  });

  let activeTab = $state<"active" | "trash">("active");
  let searchQuery = $state("");

  let confirmDialog = $state<{
    isOpen: boolean;
    title?: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    message: "",
    onConfirm: () => {},
  });

  let sortKey = $state<"name" | "updatedAt" | "groupId">("updatedAt");
  let sortDirection = $state<"asc" | "desc">("desc");

  let selectedIds = $state<Set<string>>(new Set());
  let lastSelectedId: string | null = null;

  let selectedGroupId = $state<string | null>(null);
  let isGroupSidebarOpen = $state(true);
  const groupSidebar = createResizableSidebar();

  const STORAGE_KEY_VAULT_EXPANDED_PARENTS = "personal_os_vault_expanded_parents";
  function getInitialExpandedParents(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_VAULT_EXPANDED_PARENTS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((item): item is string => typeof item === "string"));
        }
      }
    } catch {}
    return new Set();
  }

  let expandedParentGroupIds = $state<Set<string>>(getInitialExpandedParents());
  let hasInitializedExpandedParents = false;

  $effect(() => {
    if (!hasInitializedExpandedParents && vaultStore.vaultGroups.length > 0) {
      const parentIds = vaultStore.vaultGroups
        .filter((g) => !g.parentId && vaultStore.vaultGroups.some((c) => c.parentId === g.id))
        .map((g) => g.id);
      if (expandedParentGroupIds.size === 0 && parentIds.length > 0) {
        expandedParentGroupIds = new Set(parentIds);
      }
      hasInitializedExpandedParents = true;
    }
  });

  function toggleParentExpand(event: MouseEvent, parentId: string) {
    event.stopPropagation();
    const next = new Set(expandedParentGroupIds);
    if (next.has(parentId)) {
      next.delete(parentId);
    } else {
      next.add(parentId);
    }
    expandedParentGroupIds = next;
    try {
      localStorage.setItem(STORAGE_KEY_VAULT_EXPANDED_PARENTS, JSON.stringify([...next]));
    } catch {}
  }

  const vaultGroupReorder = createPointerReorder("personal_os_vault_group_order");
  let rootVaultGroups = $derived.by(() => {
    const raw = vaultStore.vaultGroups.filter(
      (g) => !g.parentId || !vaultGroupByIdMap.has(g.parentId)
    );
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const unique: VaultGroup[] = [];
    for (let i = 0; i < raw.length; i++) {
      const g = raw[i];
      const lower = g.name.trim().toLowerCase();
      if (!seenIds.has(g.id) && !seenNames.has(lower)) {
        seenIds.add(g.id);
        seenNames.add(lower);
        unique.push(g);
      }
    }
    return vaultGroupReorder.sortItems(unique);
  });
  let sortedRootGroupIds = $derived(rootVaultGroups.map((group) => group.id));

  let childGroupsByParentIdMap = $derived.by(() => {
    const map = new Map<string, VaultGroup[]>();
    const all = vaultStore.vaultGroups;
    for (let i = 0; i < all.length; i++) {
      const g = all[i];
      if (g.parentId && vaultGroupByIdMap.has(g.parentId)) {
        let list = map.get(g.parentId);
        if (!list) {
          list = [];
          map.set(g.parentId, list);
        }
        if (!list.some((existing) => existing.name.trim().toLowerCase() === g.name.trim().toLowerCase())) {
          list.push(g);
        }
      }
    }
    for (const [parentId, children] of map.entries()) {
      map.set(parentId, vaultGroupReorder.sortItems(children));
    }
    return map;
  });

  let draggedItemIdSet = $derived(new Set(vaultGroupReorder.draggedItemIds));

  let vaultItemByIdMap = $derived.by(() => {
    const map = new Map<string, VaultItem>();
    const list = vaultStore.items;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      map.set(item.id, item);
    }
    return map;
  });

  let vaultGroupByIdMap = $derived.by(() => {
    const map = new Map<string, VaultGroup>();
    const list = vaultStore.vaultGroups;
    for (let i = 0; i < list.length; i++) {
      const group = list[i];
      map.set(group.id, group);
    }
    return map;
  });

  let matchingGroupIds = $derived.by(() => {
    if (!selectedGroupId) return null;
    const childIds = vaultStore.vaultGroups
      .filter((g) => g.parentId === selectedGroupId)
      .map((g) => g.id);
    return new Set<string>([selectedGroupId, ...childIds]);
  });

  let vaultCountByGroupId = $derived.by(() => {
    const counts = new Map<string, number>();
    const activeItems = vaultStore.items.filter((item) => !item.deletedAt);
    for (let i = 0; i < activeItems.length; i++) {
      const gid = activeItems[i].groupId;
      if (gid) {
        counts.set(gid, (counts.get(gid) || 0) + 1);
      }
    }
    return counts;
  });

  const colResizer = createResizableColumns({
    storageKey: "personal_os_vault_col_widths_v6",
    columns: {
      name: { defaultWidth: 175, minWidth: 130, maxWidth: 600 },
      groupId: { defaultWidth: 165, minWidth: 140, maxWidth: 350 },
      username: { defaultWidth: 145, minWidth: 120, maxWidth: 450 },
      password: { defaultWidth: 145, minWidth: 120, maxWidth: 500 },
      updatedAt: { defaultWidth: 96, minWidth: 88, maxWidth: 250 },
      actions: { defaultWidth: 104, minWidth: 104, maxWidth: 104 },
    },
  });

  let isEditorOpen = $state(false);
  let editingItem = $state<VaultItem | null>(null);
  let formName = $state("");
  let formUsername = $state("");
  let formPassword = $state("");
  let formNote = $state("");
  let formGroupId = $state<string | null>(null);
  let isFormPasswordVisible = $state(false);

  function generateStrongPassword(length = 16): string {
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const digits = "0123456789";
    const symbols = "!@#$%^&*()-_=+[]{}";
    const allChars = lowercase + uppercase + digits + symbols;

    const array = new Uint32Array(length);
    crypto.getRandomValues(array);

    const chars = [
      lowercase[array[0] % lowercase.length],
      uppercase[array[1] % uppercase.length],
      digits[array[2] % digits.length],
      symbols[array[3] % symbols.length],
    ];

    for (let i = 4; i < length; i++) {
      chars.push(allChars[array[i] % allChars.length]);
    }

    for (let i = chars.length - 1; i > 0; i--) {
      const j = array[i] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join("");
  }

  function handleGeneratePassword() {
    formPassword = generateStrongPassword(16);
    isFormPasswordVisible = true;
  }

  let formPasswordStrength = $derived.by(() => {
    const pwd = formPassword;
    if (!pwd) return { score: 0, label: "", color: "bg-transparent", width: "0%" };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 14) score++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;

    if (score <= 2) {
      return { score, label: "Weak", color: "bg-rose-500", width: "25%" };
    } else if (score === 3) {
      return { score, label: "Fair", color: "bg-amber-500", width: "50%" };
    } else if (score === 4) {
      return { score, label: "Good", color: "bg-blue-500", width: "75%" };
    } else {
      return { score, label: "Strong", color: "bg-emerald-500", width: "100%" };
    }
  });

  const passwordMaskTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  function clearAllPasswordMaskTimers() {
    for (const timer of passwordMaskTimeouts.values()) {
      clearTimeout(timer);
    }
    passwordMaskTimeouts.clear();
  }

  let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null;
  function clearClipboardTimer() {
    if (clipboardClearTimer !== null) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = null;
    }
  }

  let formGroupNameLabel = $derived.by(() => {
    if (!formGroupId) return "No Group";
    const group = vaultGroupByIdMap.get(formGroupId);
    if (!group) return "No Group";
    if (group.parentId) {
      const parent = vaultGroupByIdMap.get(group.parentId);
      return parent ? `${parent.name} / ${group.name}` : group.name;
    }
    return group.name;
  });

  let isGroupModalOpen = $state(false);
  let formGroupTitle = $state("");
  let formGroupRole = $state<"ROOT" | "REGULAR">("ROOT");
  let formGroupParentId = $state<string | null>(null);
  let editingGroup = $state<{ id: string; name: string; parentId: string | null } | null>(null);

  let isEditingGroupParent = $derived.by(() => {
    const curId = editingGroup?.id;
    if (!curId) return false;
    return vaultStore.vaultGroups.some((g) => g.parentId === curId);
  });

  let eligibleParentGroups = $derived(
    vaultStore.vaultGroups.filter((g) => !g.parentId && g.id !== editingGroup?.id)
  );

  let copiedId = $state<string | null>(null);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;
  let decryptYieldTimer: ReturnType<typeof setTimeout> | null = null;
  let showPasswords = $state<Set<string>>(new Set());

  let decryptQueue: VaultItem[] = [];
  const queuedItemIdSet = new Set<string>();
  const inFlightDecryptionPromises = new Map<string, Promise<DecryptedCredential>>();
  let isDecrypting = false;
  let isMounted = true;

  function generateUniqueId(): string {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch {}
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  function sanitizeSingleLine(raw: string, maxLength: number): string {
    if (typeof raw !== "string") return "";
    return raw
      .replace(ZERO_WIDTH_CHARS_REGEX, "")
      .replace(CONTROL_CHARS_REGEX, "")
      .trim()
      .slice(0, maxLength);
  }

  function clearCopyTimer() {
    if (copyTimeout !== null) {
      clearTimeout(copyTimeout);
      copyTimeout = null;
    }
  }

  function clearDecryptYieldTimer() {
    if (decryptYieldTimer !== null) {
      clearTimeout(decryptYieldTimer);
      decryptYieldTimer = null;
    }
  }

  function clearDecryptionPipeline() {
    clearDecryptYieldTimer();
    decryptQueue = [];
    queuedItemIdSet.clear();
    inFlightDecryptionPromises.clear();
    isDecrypting = false;
  }

  function parseDecryptedJson(rawJson: string): DecryptedCredential {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid credential structure");
    }
    return {
      username: typeof parsed.username === "string" ? parsed.username : "",
      password: typeof parsed.password === "string" ? parsed.password : "",
      note: typeof parsed.note === "string" ? parsed.note : "",
    };
  }

  function resetVaultPlaintextState() {
    try {
      clearCopyTimer();
      clearClipboardTimer();
      clearAllPasswordMaskTimers();
      clearDecryptionPipeline();
      vaultStore.lock();
      formName = "";
      formUsername = "";
      formPassword = "";
      formNote = "";
      formGroupId = null;
      editingItem = null;
      isEditorOpen = false;
      copiedId = null;
      if (showPasswords.size > 0) showPasswords = new Set();
      if (selectedIds.size > 0) selectedIds = new Set();
      lastSelectedId = null;
    } catch {}
  }

  onDestroy(() => {
    try {
      isMounted = false;
      clearCopyTimer();
      clearClipboardTimer();
      clearAllPasswordMaskTimers();
      clearDecryptionPipeline();
      formName = "";
      formUsername = "";
      formPassword = "";
      formNote = "";
      formGroupId = null;
      editingItem = null;
      editingGroup = null;
      copiedId = null;
      showPasswords.clear();
      selectedIds.clear();
      lastSelectedId = null;
      confirmDialog = { isOpen: false, message: "", onConfirm: () => {} };
    } catch {}
  });

  async function ensureMasterKey(): Promise<string> {
    if (vaultStore.masterKey) return vaultStore.masterKey;
    try {
      const key = await getVaultKey();
      if (key) {
        vaultStore.masterKey = key;
        return key;
      }
    } catch {}
    return "default";
  }

  $effect(() => {
    try {
      if (!globalState.vaultUnlocked) {
        resetVaultPlaintextState();
      } else if (!vaultStore.masterKey) {
        ensureMasterKey().catch(() => {});
      } else if (vaultStore.items.length > 0) {
        let hasNew = false;
        const all = vaultStore.items;
        for (let i = 0; i < all.length; i++) {
          const it = all[i];
          if (!vaultStore.decryptedDataCache[it.id] && !queuedItemIdSet.has(it.id)) {
            queuedItemIdSet.add(it.id);
            decryptQueue.push(it);
            hasNew = true;
          }
        }
        if (hasNew) {
          processDecryptQueue();
        }
      }
    } catch {}
  });

  $effect(() => {
    try {
      if (!vaultStore.isInitialized) {
        vaultStore.fetchAll().catch(() => {});
      }
    } catch {}
  });

  $effect(() => {
    try {
      activeTab;
      selectedIds = new Set();
      lastSelectedId = null;
    } catch {}
  });

  async function decryptAndMigrateIfNeeded(item: VaultItem): Promise<DecryptedCredential> {
    const existingPromise = inFlightDecryptionPromises.get(item.id);
    if (existingPromise) return existingPromise;

    const decryptionPromise = (async (): Promise<DecryptedCredential> => {
      const activeKey = await ensureMasterKey();
      try {
        const decryptedStr = await VaultCrypto.decrypt(item.encryptedData, activeKey);
        return parseDecryptedJson(decryptedStr);
      } catch {
        if (activeKey !== "default") {
          try {
            const fallbackStr = await VaultCrypto.decrypt(item.encryptedData, "default");
            const parsed = parseDecryptedJson(fallbackStr);
            const reEncrypted = await VaultCrypto.encrypt(fallbackStr, activeKey);
            await vaultStore.updateItem(item.id, { encryptedData: reEncrypted }, true);
            return parsed;
          } catch {}
        }
        return { ...DECRYPTION_ERROR_PLACEHOLDER };
      } finally {
        inFlightDecryptionPromises.delete(item.id);
        queuedItemIdSet.delete(item.id);
      }
    })();

    inFlightDecryptionPromises.set(item.id, decryptionPromise);
    return decryptionPromise;
  }

  async function processDecryptQueue() {
    if (isDecrypting || !isMounted || !globalState.vaultUnlocked) return;
    isDecrypting = true;
    try {
      while (decryptQueue.length > 0 && isMounted && globalState.vaultUnlocked) {
        const batch = decryptQueue.splice(0, DECRYPT_BATCH_SIZE);
        await Promise.all(
          batch.map(async (item) => {
            if (!isMounted || !globalState.vaultUnlocked) return;
            if (vaultStore.decryptedDataCache[item.id]) {
              queuedItemIdSet.delete(item.id);
              return;
            }
            const decrypted = await decryptAndMigrateIfNeeded(item);
            if (isMounted && globalState.vaultUnlocked) {
              vaultStore.decryptedDataCache[item.id] = decrypted;
            }
          })
        );
        if (isMounted && globalState.vaultUnlocked) {
          vaultStore.decryptedDataCache = { ...vaultStore.decryptedDataCache };
        }
        if (decryptQueue.length > 0 && isMounted && globalState.vaultUnlocked) {
          await new Promise<void>((resolve) => {
            decryptYieldTimer = setTimeout(() => {
              decryptYieldTimer = null;
              resolve();
            }, DECRYPT_YIELD_MS);
          });
        }
      }
    } catch {} finally {
      isDecrypting = false;
    }
  }

  async function decryptItem(item: VaultItem): Promise<DecryptedCredential> {
    try {
      const cached = vaultStore.decryptedDataCache[item.id];
      if (cached) {
        return {
          username: cached.username || "",
          password: cached.password || "",
          note: cached.note || "",
        };
      }
      const decrypted = await decryptAndMigrateIfNeeded(item);
      if (isMounted && globalState.vaultUnlocked) {
        vaultStore.decryptedDataCache[item.id] = decrypted;
      }
      return decrypted;
    } catch {
      return { ...DECRYPTION_ERROR_PLACEHOLDER };
    }
  }

  let sortedAndFilteredItems = $derived.by(() => {
    try {
      const normalizedQuery = searchQuery.trim().toLowerCase();
      const isTrashTab = activeTab === "trash";
      const allItems = vaultStore.items;
      const cache = vaultStore.decryptedDataCache;
      const filtered: VaultItem[] = [];
      let needsEnqueue = false;

      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        const isDeleted = Boolean(item.deletedAt);
        if (isTrashTab !== isDeleted) continue;
        if (matchingGroupIds && (!item.groupId || !matchingGroupIds.has(item.groupId))) continue;
        if (normalizedQuery) {
          const nameMatch = (item.name || "").toLowerCase().includes(normalizedQuery);
          const cached = cache[item.id];
          const usernameMatch = Boolean(
            cached?.username && cached.username.toLowerCase().includes(normalizedQuery)
          );
          const noteMatch = Boolean(
            cached?.note && cached.note.toLowerCase().includes(normalizedQuery)
          );
          if (!cached && !nameMatch && !queuedItemIdSet.has(item.id)) {
            queuedItemIdSet.add(item.id);
            decryptQueue.push(item);
            needsEnqueue = true;
          }
          if (!nameMatch && !usernameMatch && !noteMatch) continue;
        }
        filtered.push(item);
      }

      if (needsEnqueue && isMounted && globalState.vaultUnlocked) {
        processDecryptQueue();
      }

      const currentSortKey = sortKey;
      const directionMultiplier = sortDirection === "asc" ? 1 : -1;
      const groupLookup = vaultGroupByIdMap;

      filtered.sort((a, b) => {
        let comparison = 0;
        if (currentSortKey === "name") {
          comparison = COLLATOR.compare(a.name || "", b.name || "");
        } else if (currentSortKey === "updatedAt") {
          comparison = a.updatedAt - b.updatedAt;
        } else if (currentSortKey === "groupId") {
          const groupA = (a.groupId && groupLookup.get(a.groupId)?.name) || "";
          const groupB = (b.groupId && groupLookup.get(b.groupId)?.name) || "";
          comparison = COLLATOR.compare(groupA, groupB);
        }
        return comparison * directionMultiplier;
      });

      if (filtered.length > MAX_RENDER_ITEMS) {
        return filtered.slice(0, MAX_RENDER_ITEMS);
      }
      return filtered;
    } catch {
      return [];
    }
  });

  let orderedItemIds = $derived(sortedAndFilteredItems.map((item) => item.id));

  async function handleUnlock(event?: Event) {
    try {
      event?.preventDefault();
      const authenticated = await authenticateOS("Unlock Vault");
      if (!isMounted) return;
      if (authenticated) {
        vaultStore.masterKey = await getVaultKey();
        if (!isMounted) return;
        globalState.vaultUnlocked = true;
      }
    } catch {}
  }

  function lockVault() {
    try {
      globalState.vaultUnlocked = false;
      resetVaultPlaintextState();
    } catch {}
  }

  function handleRowClick(event: MouseEvent, id: string) {
    try {
      event.stopPropagation();
      const result = getNextSelection(
        event,
        id,
        selectedIds,
        orderedItemIds,
        lastSelectedId
      );
      selectedIds = result.selection;
      lastSelectedId = result.lastSelectedId;
    } catch {}
  }

  function clearSelection() {
    try {
      if (selectedIds.size > 0) {
        selectedIds = new Set();
      }
      lastSelectedId = null;
    } catch {}
  }

  function handleSort(key: typeof sortKey) {
    try {
      const next = getNextSort(key, sortKey, sortDirection);
      sortKey = next.key as typeof sortKey;
      sortDirection = next.direction;
    } catch {}
  }

  function openGroupModal(group: VaultGroup | null = null, defaultParentId: string | null = null) {
    try {
      editingGroup = group ? { id: group.id, name: group.name, parentId: group.parentId ?? null } : null;
      formGroupTitle = group ? group.name : "";
      const pId = group?.parentId ?? defaultParentId ?? null;
      formGroupParentId = pId;
      formGroupRole = pId ? "REGULAR" : "ROOT";
      isGroupModalOpen = true;
    } catch {}
  }

  async function onGroupSubmit() {
    try {
      const cleanName = sanitizeSingleLine(formGroupTitle, MAX_GROUP_NAME_LENGTH);
      if (!cleanName) return;

      const targetParentId =
        formGroupRole === "REGULAR" && !isEditingGroupParent ? formGroupParentId : null;

      const isDuplicate = vaultStore.vaultGroups.some(
        (g) =>
          g.name.trim().toLowerCase() === cleanName.toLowerCase() &&
          g.id !== editingGroup?.id
      );
      if (isDuplicate) {
        toastState.add("error", "Group name already exists. Please choose a different name.");
        return;
      }

      const now = Date.now();
      if (editingGroup) {
        await vaultStore.updateGroup(editingGroup.id, {
          name: cleanName,
          parentId: targetParentId,
          updatedAt: now,
        });
      } else {
        const newId = generateUniqueId();
        await vaultStore.addGroup({
          id: newId,
          name: cleanName,
          parentId: targetParentId,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        if (!isMounted) return;
        selectedGroupId = newId;
        if (targetParentId) {
          const next = new Set(expandedParentGroupIds);
          next.add(targetParentId);
          expandedParentGroupIds = next;
        }
      }
      if (!isMounted) return;
      isGroupModalOpen = false;
    } catch {}
  }

  function deleteGroup(event: MouseEvent, id: string) {
    try {
      event.stopPropagation();
      const group = vaultGroupByIdMap.get(id);
      const hasChildren = vaultStore.vaultGroups.some((g) => g.parentId === id);
      const message = hasChildren
        ? `Delete root group "${group?.name || 'this'}"? All dependent sub-groups will also be deleted, and credentials inside will be ungrouped.`
        : `Delete group "${group?.name || 'this'}"? Credentials inside will be ungrouped.`;

      confirmDialog = {
        isOpen: true,
        message,
        onConfirm: async () => {
          try {
            if (selectedGroupId === id) selectedGroupId = null;
            await vaultStore.deleteGroup(id);
          } catch {}
        },
      };
    } catch {}
  }

  async function handleNestGroup(sourceId: string, targetId: string) {
    try {
      if (!sourceId || !targetId || sourceId === targetId) return;
      const sourceGroup = vaultGroupByIdMap.get(sourceId);
      const targetGroup = vaultGroupByIdMap.get(targetId);
      if (!sourceGroup || !targetGroup) return;

      const sourceHasChildren = vaultStore.vaultGroups.some((g) => g.parentId === sourceId);
      if (sourceHasChildren) {
        toastState.add(
          "error",
          "A root group containing sub-groups cannot become a sub-group (maximum 2 levels)."
        );
        return;
      }

      const finalParentId = targetGroup.parentId || targetGroup.id;
      const parentName = targetGroup.parentId
        ? vaultGroupByIdMap.get(targetGroup.parentId)?.name || targetGroup.name
        : targetGroup.name;

      if (sourceGroup.parentId === finalParentId) {
        return;
      }

      await vaultStore.updateGroup(sourceId, { parentId: finalParentId });

      const next = new Set(expandedParentGroupIds);
      next.add(finalParentId);
      expandedParentGroupIds = next;

      toastState.add("success", `Nested "${sourceGroup.name}" into "${parentName}"`);
    } catch {}
  }

  async function handleUnnestGroup(sourceId: string) {
    try {
      const sourceGroup = vaultGroupByIdMap.get(sourceId);
      if (!sourceGroup) return;
      if (!sourceGroup.parentId) return;

      await vaultStore.updateGroup(sourceId, { parentId: null });
      toastState.add("success", `"${sourceGroup.name}" promoted to Root Group`);
    } catch {}
  }

  async function moveVaultItemsToGroup(itemIds: string[], targetGroupId: string | null) {
    try {
      if (!Array.isArray(itemIds) || itemIds.length === 0) return;
      const lookup = vaultItemByIdMap;
      const updatePromises: Promise<void>[] = [];

      for (let i = 0; i < itemIds.length; i++) {
        const item = lookup.get(itemIds[i]);
        if (item && (item.groupId ?? null) !== targetGroupId) {
          updatePromises.push(vaultStore.updateItem(item.id, { groupId: targetGroupId }, true));
        }
      }

      const movedCount = updatePromises.length;
      if (movedCount > 0) {
        await Promise.all(updatePromises);
        toastState.add(
          "success",
          movedCount > 1 ? `Moved ${movedCount} credentials` : "Credential group updated"
        );
      }
    } catch {}
  }

  function getGroupNameById(groupId: string | null): string {
    if (!groupId) return "All Items (Ungroup)";
    return vaultGroupByIdMap.get(groupId)?.name || "Group";
  }

  function openCreate() {
    try {
      if (activeTab === "trash") return;
      editingItem = null;
      formName = "";
      formUsername = "";
      formPassword = "";
      formNote = "";
      formGroupId = selectedGroupId;
      isFormPasswordVisible = false;
      isEditorOpen = true;
    } catch {}
  }

  async function openEdit(item: VaultItem) {
    try {
      if (item.deletedAt || activeTab === "trash") return;
      editingItem = item;
      formName = item.name;

      let data = vaultStore.decryptedDataCache[item.id];
      if (!data) {
        data = await decryptItem(item);
      }
      if (!isMounted || !globalState.vaultUnlocked) return;

      formUsername = data.username || "";
      formPassword = "";
      formNote = data.note || "";
      formGroupId = item.groupId || null;
      isFormPasswordVisible = false;
      isEditorOpen = true;
    } catch {}
  }

  async function handleSaveEditor() {
    try {
      if (editingItem?.deletedAt || activeTab === "trash" || !globalState.vaultUnlocked) return;
      const cleanName = sanitizeSingleLine(formName, MAX_CREDENTIAL_NAME_LENGTH);
      const cleanUsername = sanitizeSingleLine(formUsername, MAX_USERNAME_LENGTH);
      const cleanPassword = formPassword
        .replace(ZERO_WIDTH_CHARS_REGEX, "")
        .trim()
        .slice(0, MAX_PASSWORD_LENGTH);
      const cleanNote = formNote
        .replace(ZERO_WIDTH_CHARS_REGEX, "")
        .trim()
        .slice(0, MAX_NOTE_LENGTH);

      let passwordToSave = cleanPassword;
      if (editingItem && !cleanPassword) {
        const existing = vaultStore.decryptedDataCache[editingItem.id];
        passwordToSave = existing?.password || "";
      }

      if (!cleanName || !cleanUsername || !passwordToSave) return;

      const payload = JSON.stringify({
        username: cleanUsername,
        password: passwordToSave,
        note: cleanNote,
      });

      const activeKey = await ensureMasterKey();
      const encryptedData = await VaultCrypto.encrypt(payload, activeKey);
      if (!isMounted || !globalState.vaultUnlocked) return;

      const now = Date.now();
      if (editingItem) {
        const id = editingItem.id;
        vaultStore.decryptedDataCache[id] = {
          username: cleanUsername,
          password: passwordToSave,
          note: cleanNote,
        };
        await vaultStore.updateItem(id, {
          name: cleanName,
          encryptedData,
          groupId: formGroupId,
          updatedAt: now,
        });
      } else {
        const newId = generateUniqueId();
        const newItem: VaultItem = {
          id: newId,
          name: cleanName,
          encryptedData,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          groupId: formGroupId,
        };
        vaultStore.decryptedDataCache[newItem.id] = {
          username: cleanUsername,
          password: passwordToSave,
          note: cleanNote,
        };
        await vaultStore.addItem(newItem);
        if (!isMounted) return;
        selectedIds = new Set([newId]);
        lastSelectedId = newId;
      }
      if (!isMounted) return;
      isEditorOpen = false;
      formName = "";
      formUsername = "";
      formPassword = "";
      formNote = "";
    } catch {}
  }

  async function deleteItem(id: string) {
    try {
      if (selectedIds.has(id)) {
        const nextSelection = new Set(selectedIds);
        nextSelection.delete(id);
        selectedIds = nextSelection;
      }
      if (activeTab === "active") {
        await vaultStore.moveToTrash(id);
      } else {
        delete vaultStore.decryptedDataCache[id];
        await vaultStore.deleteItem(id);
      }
    } catch {}
  }

  async function bulkDelete() {
    try {
      const ids =
        selectedIds.size > 0 ? Array.from(selectedIds) : [...orderedItemIds];
      if (ids.length === 0) return;

      selectedIds = new Set();
      lastSelectedId = null;
      if (activeTab === "active") {
        await vaultStore.bulkMoveToTrash(ids);
      } else {
        for (let i = 0; i < ids.length; i++) {
          delete vaultStore.decryptedDataCache[ids[i]];
        }
        await vaultStore.deleteMany(ids);
      }
    } catch {}
  }

  function handleDeleteItem(item: VaultItem) {
    try {
      if (activeTab === "active") {
        deleteItem(item.id);
      } else {
        confirmDialog = {
          isOpen: true,
          title: "Delete Credential",
          message: "Permanently deleted items can not be restored",
          onConfirm: () => deleteItem(item.id),
        };
      }
    } catch {}
  }

  function handleDeleteAll() {
    try {
      confirmDialog = {
        isOpen: true,
        title:
          selectedIds.size > 0
            ? `Delete ${selectedIds.size} selected`
            : "Delete All Credentials",
        message: "Permanently deleted items can not be restored",
        onConfirm: bulkDelete,
      };
    } catch {}
  }

  async function restoreItem(id: string) {
    try {
      if (selectedIds.has(id)) {
        const nextSelection = new Set(selectedIds);
        nextSelection.delete(id);
        selectedIds = nextSelection;
      }
      await vaultStore.restoreFromTrash(id);
    } catch {}
  }

  async function bulkRestore() {
    try {
      const ids =
        selectedIds.size > 0 ? Array.from(selectedIds) : [...orderedItemIds];
      if (ids.length === 0) return;

      selectedIds = new Set();
      lastSelectedId = null;
      await vaultStore.bulkRestoreFromTrash(ids);
    } catch {}
  }

  function getDecrypted(item: VaultItem): Readonly<DecryptedCredential> {
    try {
      const cached = vaultStore.decryptedDataCache[item.id];
      if (cached) {
        return {
          username: cached.username || "",
          password: cached.password || "",
          note: cached.note || "",
        };
      }
      if (!queuedItemIdSet.has(item.id)) {
        queuedItemIdSet.add(item.id);
        decryptQueue.push(item);
        processDecryptQueue();
      }
      return DECRYPTING_PLACEHOLDER;
    } catch {
      return DECRYPTION_ERROR_PLACEHOLDER;
    }
  }

  function togglePassword(event: MouseEvent, id: string) {
    try {
      event.stopPropagation();
      const next = new Set(showPasswords);
      if (next.has(id)) {
        next.delete(id);
        const existing = passwordMaskTimeouts.get(id);
        if (existing) {
          clearTimeout(existing);
          passwordMaskTimeouts.delete(id);
        }
      } else {
        next.add(id);
        const existing = passwordMaskTimeouts.get(id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          passwordMaskTimeouts.delete(id);
          if (isMounted) {
            const updated = new Set(showPasswords);
            updated.delete(id);
            showPasswords = updated;
          }
        }, 15000);
        passwordMaskTimeouts.set(id, timer);
      }
      showPasswords = next;
    } catch {}
  }

  async function copyText(event: MouseEvent, text: string, id: string) {
    try {
      event.stopPropagation();
      if (!text) return;
      await navigator.clipboard.writeText(text);
      if (!isMounted) return;
      copiedId = id;
      clearCopyTimer();
      copyTimeout = setTimeout(() => {
        copyTimeout = null;
        if (isMounted) copiedId = null;
      }, 2000);

      if (id.endsWith("-pwd")) {
        clearClipboardTimer();
        clipboardClearTimer = setTimeout(async () => {
          clipboardClearTimer = null;
          try {
            const current = await navigator.clipboard.readText();
            if (current === text) {
              await navigator.clipboard.writeText("");
            }
          } catch {
            try {
              await navigator.clipboard.writeText("");
            } catch {}
          }
        }, 30000);
      }
    } catch {}
  }


</script>

<div class="flex h-full gap-4">
  {@render groupsSidebar()}
  <PageLayout class="relative h-full select-none border-0 overflow-hidden flex-1 min-w-0">
    <div class="relative z-overlay h-full flex flex-col">
      {#if !globalState.vaultUnlocked}
        <div
          class="flex flex-col items-center justify-center w-full h-full text-center px-4 animate-in fade-in zoom-in duration-500"
        >
          <div class="bg-primary/10 p-6 rounded-full mb-6">
            <ShieldCheck class="w-16 h-16 text-primary" />
          </div>
          <h2 class="text-2xl font-semibold tracking-tight text-foreground mb-3">
            Vault is Locked
          </h2>
          <p class="text-muted-foreground max-w-md mx-auto mb-8 leading-relaxed">
            Your credentials are encrypted. You must unlock the vault with your system password to
            access them.
          </p>
          <Button variant="premium" onclick={handleUnlock}>
            <Key class="w-4 h-4 mr-2" /> Unlock Vault
          </Button>
        </div>
      {:else}
        <Toolbar>
          {#snippet search()}
            <div class="flex items-center gap-2 sm:gap-4 w-full">
              <div class="shrink-0">
                <Button variant="outline" size="sm" onclick={lockVault} title="Lock Vault">
                  <Lock class="w-4 h-4 text-muted-foreground" />
                  <span class="hidden sm:inline">Lock</span>
                </Button>
              </div>
              <div class="shrink-0">
                <TabSwitcher
                  tabs={VAULT_TABS}
                  value={activeTab}
                  onValueChange={(val) => {
                    activeTab = val as "active" | "trash";
                    selectedIds = new Set();
                    lastSelectedId = null;
                  }}
                />
              </div>
              <div class="flex-1 min-w-32 max-w-xs">
                <SearchBar bind:value={searchQuery} placeholder="Search..." containerClass="w-full" />
              </div>
            </div>
          {/snippet}

          {#snippet actions()}
            {#if activeTab === "active"}
              <Button
                variant="destructive-outline"
                size="sm"
                onclick={bulkDelete}
                disabled={sortedAndFilteredItems.length === 0}
              >
                <Trash2 class="w-4 h-4" />
                <span class="hidden sm:inline"
                  >{selectedIds.size > 0 ? `Delete (${selectedIds.size})` : "Delete All"}</span
                >
              </Button>
              <Button size="sm" onclick={openCreate}>
                <PlusCircle class="w-4 h-4" />
                <span class="hidden sm:inline">New Credential</span>
              </Button>
            {:else}
              <Button
                variant="success-outline"
                size="sm"
                onclick={bulkRestore}
                disabled={sortedAndFilteredItems.length === 0}
              >
                <RefreshCcw class="w-4 h-4" />
                <span class="hidden sm:inline"
                  >{selectedIds.size > 0 ? `Restore (${selectedIds.size})` : "Restore All"}</span
                >
              </Button>
              <Button
                variant="destructive-outline"
                size="sm"
                onclick={handleDeleteAll}
                disabled={sortedAndFilteredItems.length === 0}
              >
                <Trash2 class="w-4 h-4" />
                <span class="hidden sm:inline"
                  >{selectedIds.size > 0 ? `Delete (${selectedIds.size})` : "Delete All"}</span
                >
              </Button>
            {/if}
          {/snippet}
        </Toolbar>

        <TableContainer onclick={clearSelection} class="px-2! sm:px-2!">
          <Table style="min-width: {colResizer.totalWidth}px;">
            <TableHeader onclick={(event: MouseEvent) => event.stopPropagation()}>
              <TableRow>
                <TableHead
                  style={colResizer.getStyle("name")}
                  class="cursor-pointer group relative select-none px-2!"
                  onclick={() => handleSort("name")}
                >
                  <div class="flex items-center gap-2 min-w-0 pr-2">
                    <span class="truncate">Platform</span>
                    <SortIcon active={sortKey === "name"} direction={sortDirection} />
                  </div>
                  <ColumnResizer
                    isResizing={colResizer.resizingPair === "name-groupId"}
                    onResize={(delta) => colResizer.resizePair("name", "groupId", delta)}
                    onFinish={() => colResizer.finishResize()}
                    onReset={() => colResizer.resetPair("name", "groupId")}
                  />
                </TableHead>
                <TableHead
                  style={colResizer.getStyle("groupId")}
                  class="hidden md:table-cell cursor-pointer group relative select-none px-2!"
                  onclick={() => handleSort("groupId")}
                >
                  <div class="flex items-center gap-2 min-w-0 pr-2">
                    <span class="truncate">Group</span>
                    <SortIcon active={sortKey === "groupId"} direction={sortDirection} />
                  </div>
                  <ColumnResizer
                    isResizing={colResizer.resizingPair === "groupId-username"}
                    onResize={(delta) => colResizer.resizePair("groupId", "username", delta)}
                    onFinish={() => colResizer.finishResize()}
                    onReset={() => colResizer.resetPair("groupId", "username")}
                  />
                </TableHead>
                <TableHead
                  style={colResizer.getStyle("username")}
                  class="hidden sm:table-cell relative select-none px-2!"
                >
                  <div class="truncate pr-2">Username</div>
                  <ColumnResizer
                    isResizing={colResizer.resizingPair === "username-password"}
                    onResize={(delta) => colResizer.resizePair("username", "password", delta)}
                    onFinish={() => colResizer.finishResize()}
                    onReset={() => colResizer.resetPair("username", "password")}
                  />
                </TableHead>
                <TableHead
                  style={colResizer.getStyle("password")}
                  class="hidden sm:table-cell relative select-none px-2!"
                >
                  <div class="truncate pr-2">Password</div>
                  <ColumnResizer
                    isResizing={colResizer.resizingPair === "password-updatedAt"}
                    onResize={(delta) => colResizer.resizePair("password", "updatedAt", delta)}
                    onFinish={() => colResizer.finishResize()}
                    onReset={() => colResizer.resetPair("password", "updatedAt")}
                  />
                </TableHead>
                <TableHead
                  style={colResizer.getStyle("updatedAt")}
                  class="hidden sm:table-cell cursor-pointer select-none group relative px-2!"
                  onclick={() => handleSort("updatedAt")}
                >
                  <div class="flex items-center gap-1 min-w-0 pr-2">
                    <span class="truncate">Modified</span>
                    <SortIcon active={sortKey === "updatedAt"} direction={sortDirection} />
                  </div>
                  <ColumnResizer disabled />
                </TableHead>
                <TableHead
                  style={colResizer.getStyle("actions")}
                  class="text-left pl-3! pr-4! whitespace-nowrap select-none"
                >
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#if sortedAndFilteredItems.length === 0}
                <TableRow class="hover:bg-transparent! cursor-default!">
                  <TableCell class="p-0 align-middle" colspan={6}>
                    <div class="flex items-center justify-center w-full h-[calc(100vh-16rem)]">
                      <EmptyState icon={ShieldCheck} title="Vault is Empty" />
                    </div>
                  </TableCell>
                </TableRow>
              {:else}
                {#each sortedAndFilteredItems as item (item.id)}
                  {@const data = getDecrypted(item)}
                  {@const isSelected = selectedIds.has(item.id)}
                  {@const isBeingDragged =
                    vaultGroupReorder.isItemDragging && draggedItemIdSet.has(item.id)}
                  {@const isPasswordVisible = showPasswords.has(item.id)}
                  {@const group = item.groupId ? vaultGroupByIdMap.get(item.groupId) : undefined}

                  <TableRow
                    class={isBeingDragged ? "opacity-40 ring-1 ring-primary/40" : ""}
                    selected={isSelected}
                    onpointerdown={(event: PointerEvent) =>
                      vaultGroupReorder.handleItemPointerDown(
                        event,
                        item.id,
                        selectedIds,
                        moveVaultItemsToGroup,
                        {
                          disabled: activeTab !== "active",
                          itemLabel: item.name,
                          getGroupName: getGroupNameById,
                        }
                      )}
                    onclick={(event) => handleRowClick(event, item.id)}
                    ondblclick={(event: MouseEvent) => {
                      event.stopPropagation();
                      openEdit(item);
                    }}
                  >
                    <TableCell style={colResizer.getStyle("name")} class="font-medium text-foreground truncate px-2!">
                      <div class="truncate">{item.name}</div>
                    </TableCell>
                    <TableCell
                      style={colResizer.getStyle("groupId")}
                      class="hidden md:table-cell text-muted-foreground whitespace-nowrap text-xs px-2! overflow-hidden"
                    >
                      {#if group}
                        {@const parentGroup = group.parentId ? vaultGroupByIdMap.get(group.parentId) : undefined}
                        {#if parentGroup}
                          <span
                            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-muted-foreground truncate max-w-full"
                            title="{parentGroup.name} / {group.name}"
                          >
                            <span class="opacity-60 shrink-0">{parentGroup.name}</span>
                            <span class="opacity-40 text-xs shrink-0">/</span>
                            <span class="truncate text-foreground font-medium">{group.name}</span>
                          </span>
                        {:else}
                          <span
                            class="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-muted-foreground truncate max-w-full"
                            title={group.name}
                          >
                            {group.name}
                          </span>
                        {/if}
                      {:else}
                        <span class="text-xs text-muted-foreground/50">Ungrouped</span>
                      {/if}
                    </TableCell>
                    <TableCell style={colResizer.getStyle("username")} class="hidden sm:table-cell text-muted-foreground truncate px-2!">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="truncate">{data.username}</span>
                        <button
                          class="shrink-0 text-muted-foreground hover:text-primary transition-colors {copiedId === item.id + '-usr' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100'}"
                          onclick={(event) => copyText(event, data.username || "", item.id + "-usr")}
                          title="Copy Username"
                        >
                          {#if copiedId === item.id + "-usr"}
                            <CheckCircle2 class="w-3.5 h-3.5 text-primary" />
                          {:else}
                            <Copy class="w-3.5 h-3.5" />
                          {/if}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell style={colResizer.getStyle("password")} class="hidden sm:table-cell text-muted-foreground truncate px-2!">
                      <div class="flex items-center gap-2 min-w-0">
                        <span
                          class="truncate min-w-0 {!isPasswordVisible
                            ? 'tracking-widest text-base leading-none select-none'
                            : 'font-mono'}"
                        >
                          {isPasswordVisible ? data.password : "••••••••"}
                        </span>
                        <div
                          class="shrink-0 flex items-center gap-1 {copiedId === item.id + '-pwd' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100'} transition-opacity"
                        >
                          <button
                            class="text-muted-foreground hover:text-primary transition-colors p-1 focus:opacity-100"
                            onclick={(event) => togglePassword(event, item.id)}
                            title={isPasswordVisible ? "Hide password" : "Show password"}
                          >
                            {#if isPasswordVisible}
                              <EyeOff class="w-4 h-4" />
                            {:else}
                              <Eye class="w-4 h-4" />
                            {/if}
                          </button>
                          <button
                            class="flex items-center transition-colors p-1 rounded-sm text-muted-foreground hover:text-primary focus:opacity-100"
                            onclick={(event) =>
                              copyText(event, data.password || "", item.id + "-pwd")}
                            title="Copy password"
                          >
                            {#if copiedId === item.id + "-pwd"}
                              <CheckCircle2 class="w-4 h-4 text-primary" />
                            {:else}
                              <Copy class="w-4 h-4" />
                            {/if}
                          </button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell
                      style={colResizer.getStyle("updatedAt")}
                      class="whitespace-nowrap text-muted-foreground text-xs px-2! overflow-hidden hidden sm:table-cell"
                    >
                      <span class="truncate block">{formatDate(item.updatedAt)}</span>
                    </TableCell>
                    <TableCell style={colResizer.getStyle("actions")} class="text-left pl-3! pr-4! whitespace-nowrap overflow-hidden">
                      <div
                        class="flex items-center justify-start gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100"
                        ondblclick={(event: MouseEvent) => event.stopPropagation()}
                        role="presentation"
                      >
                        {#if activeTab === "active"}
                          <ActionButton
                            variant="edit"
                            icon={Pencil}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation();
                              openEdit(item);
                            }}
                            title="Edit"
                          />
                          <ActionButton
                            variant="delete"
                            icon={Trash2}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation();
                              deleteItem(item.id);
                            }}
                            title="Delete"
                          />
                        {:else}
                          <ActionButton
                            variant="restore"
                            icon={RefreshCcw}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation();
                              restoreItem(item.id);
                            }}
                            title="Restore"
                          />
                          <ActionButton
                            variant="delete"
                            icon={Trash2}
                            onClick={(event: MouseEvent) => {
                              event.stopPropagation();
                              handleDeleteItem(item);
                            }}
                            title="Permanently Delete"
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
      {/if}
    </div>
  </PageLayout>
</div>

{#snippet groupsSidebar()}
  {#if globalState.vaultUnlocked}
    <div
      style="width: {groupSidebar.width}px;"
      class="shrink-0 relative flex flex-col gap-2 rounded-l-none rounded-r-2xl bg-card border border-l-0 shadow-xs overflow-hidden pb-4 will-change-[width] {groupSidebar.isResizing
        ? 'select-none'
        : 'transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'}"
    >
      <div
        class="group/resizer absolute top-0 right-0 w-2.5 h-full cursor-col-resize z-30 flex items-center justify-center select-none"
        onpointerdown={groupSidebar.handleResizePointerDown}
        ondblclick={groupSidebar.resetWidth}
        role="separator"
        aria-orientation="vertical"
        tabindex="-1"
        title="Drag to resize (Double-click to reset)"
      >
        <div
          class="w-[2px] h-full transition-colors {groupSidebar.isResizing
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
            <h3 class="font-semibold text-sm truncate">Groups</h3>
          </div>
        </div>
      </div>


      <div class="flex-1 overflow-y-auto px-2 py-1 space-y-1 mt-1 flex flex-col">
        <div
          use:vaultGroupReorder.allTargetAction
          class="group/all relative flex items-center w-full rounded-lg text-sm transition-colors {!selectedGroupId
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'} {vaultGroupReorder.itemDropGroupId ===
          '__ALL__' || (vaultGroupReorder.dragOverGroupId === '__ALL__' && vaultGroupReorder.dropPosition === 'inside')
            ? 'bg-primary/20 ring-2 ring-primary text-primary'
            : ''}"
        >
          <button
            type="button"
            class="flex-1 flex items-center {isGroupSidebarOpen
              ? 'px-2'
              : 'px-3'} py-2 rounded-lg text-sm transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] text-left min-w-0 cursor-pointer"
            onclick={() => (selectedGroupId = null)}
            title={isGroupSidebarOpen ? undefined : "Vault"}
          >
            <div
              class="w-6 h-6 flex items-center justify-center shrink-0 transition-[margin] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                ? 'ml-0'
                : 'ml-0.75'}"
            >
              {#if !selectedGroupId}
                <FolderOpen class="w-4 h-4 text-primary" />
              {:else}
                <Folder class="w-4 h-4" />
              {/if}
            </div>
            <div
              class="text-left whitespace-nowrap overflow-hidden truncate transition-[opacity,margin,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                ? 'opacity-100 ml-1.5 flex-1 min-w-0 mr-1'
                : 'opacity-0 ml-0 w-0'}"
            >
              Vault
            </div>
          </button>

          {#if isGroupSidebarOpen}
            <button
              type="button"
              class="p-1.5 mr-1 rounded-md text-muted-foreground hover:text-primary hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer opacity-80 group-hover/all:opacity-100"
              onclick={(event) => {
                event.stopPropagation();
                openGroupModal(null);
              }}
              title="New Group"
              aria-label="New Group"
            >
              <Plus class="w-4 h-4" />
            </button>
          {/if}
        </div>

        {#each rootVaultGroups as group (group.id)}
          {@const isPointerDragging = vaultGroupReorder.draggedGroupId === group.id}
          {@const isPointerDragOver = vaultGroupReorder.dragOverGroupId === group.id}
          {@const isItemDropTarget = vaultGroupReorder.itemDropGroupId === group.id}
          {@const isSelected = selectedGroupId === group.id}
          {@const children = childGroupsByParentIdMap.get(group.id) ?? []}
          {@const hasChildren = children.length > 0}
          {@const isExpanded = expandedParentGroupIds.has(group.id)}
          {@const rootDirectCount = vaultCountByGroupId.get(group.id) || 0}
          {@const totalGroupCount = rootDirectCount + children.reduce((sum, c) => sum + (vaultCountByGroupId.get(c.id) || 0), 0)}
          <div class="flex flex-col w-full">
            <div
              use:vaultGroupReorder.elementAction={group.id}
              class="group/item relative flex items-center w-full rounded-lg transition-all duration-150 {isPointerDragging
                ? 'opacity-30 scale-[0.98] border border-dashed border-primary/40'
                : isPointerDragOver
                  ? 'border border-primary/40 ring-1 ring-primary/30 bg-primary/15'
                  : ''} {isItemDropTarget ? 'bg-primary/20 ring-2 ring-primary' : ''} {isSelected && !isItemDropTarget
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
              role="region"
              aria-label="Vault group drop zone"
            >
              {#if isPointerDragOver && vaultGroupReorder.dropPosition === "above"}
                <div
                  class="absolute top-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
                ></div>
              {/if}
              {#if isPointerDragOver && vaultGroupReorder.dropPosition === "below"}
                <div
                  class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
                ></div>
              {/if}
              {#if isPointerDragOver && vaultGroupReorder.dropPosition === "inside"}
                <div
                  class="absolute inset-0 rounded-lg ring-2 ring-primary bg-primary/25 pointer-events-none z-30 flex items-center justify-end pr-2"
                >
                  <span class="text-xs font-bold text-primary bg-background/95 px-1.5 py-0.5 rounded shadow-sm border border-primary/30">
                    ↳ Nest here
                  </span>
                </div>
              {/if}

              <div
                class="flex items-center shrink-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                  ? 'w-5 opacity-100 ml-1 -mr-1 scale-100'
                  : 'w-0 opacity-0 ml-0 mr-0 pointer-events-none scale-75'}"
              >
                <div
                  class="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground/40 hover:text-primary hover:bg-primary/10 rounded transition-colors select-none touch-none shrink-0"
                  title="Drag to reorder or nest group"
                  role="button"
                  tabindex={isGroupSidebarOpen ? 0 : -1}
                  aria-label="Drag to reorder or nest group"
                  onpointerdown={(event) =>
                    vaultGroupReorder.handleGripPointerDown(
                      event,
                      group.id,
                      sortedRootGroupIds,
                      {
                        allowNest: true,
                        itemLabel: group.name,
                        getGroupName: (gId) => (gId ? vaultGroupByIdMap.get(gId)?.name || 'Group' : 'Vault'),
                        onNest: handleNestGroup,
                        onUnnest: handleUnnestGroup,
                      }
                    )}
                  onclick={(event) => event.stopPropagation()}
                  onkeydown={(event) => {
                    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                  }}
                >
                  <GripVertical class="w-3.5 h-3.5" />
                </div>
              </div>

              {#if isGroupSidebarOpen}
                {#if hasChildren}
                  <button
                    type="button"
                    class="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground shrink-0 ml-0.5 transition-colors cursor-pointer"
                    onclick={(e) => toggleParentExpand(e, group.id)}
                    title={isExpanded ? "Collapse sub-groups" : "Expand sub-groups"}
                  >
                    {#if isExpanded}
                      <ChevronDown class="w-3.5 h-3.5" />
                    {:else}
                      <ChevronRight class="w-3.5 h-3.5" />
                    {/if}
                  </button>
                {:else}
                  <div class="w-4 shrink-0"></div>
                {/if}
              {/if}

              <button
                class="flex-1 flex items-center {isGroupSidebarOpen
                  ? 'px-1.5'
                  : 'px-3'} py-2 rounded-lg text-sm transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] text-left min-w-0"
                onclick={() => {
                  if (!vaultGroupReorder.isPointerDragging) selectedGroupId = group.id;
                }}
                title={isGroupSidebarOpen ? (hasChildren ? `${group.name} (${children.length} sub-groups)` : group.name) : group.name}
              >
                <div
                  class="w-6 h-6 flex items-center justify-center shrink-0 transition-[margin] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                    ? 'ml-0'
                    : 'ml-0.75'}"
                >
                  {#if isSelected || isExpanded}
                    <FolderOpen class="w-4 h-4" />
                  {:else}
                    <Folder class="w-4 h-4" />
                  {/if}
                </div>
                <div
                  class="text-left whitespace-nowrap overflow-hidden truncate transition-[opacity,margin,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                    ? 'opacity-100 ml-1.5 flex-1 min-w-0 mr-1'
                    : 'opacity-0 ml-0 w-0'}"
                >
                  {group.name}
                </div>
                {#if isGroupSidebarOpen}
                  <CountBadge
                    count={totalGroupCount}
                    class="ml-auto mr-1 bg-muted/70 text-muted-foreground group-hover/item:opacity-0 transition-opacity pointer-events-none"
                    title="{totalGroupCount} items"
                  />
                {/if}
              </button>

              <div
                class="absolute right-1.5 flex items-center gap-0.5 transition-[opacity,transform] duration-200 {isGroupSidebarOpen
                  ? 'opacity-0 group-hover/item:opacity-100 scale-100'
                  : 'opacity-0 scale-75 pointer-events-none'} bg-card/95 backdrop-blur-xs pl-1 pr-0.5 py-0.5 rounded-md shadow-xs z-20"
              >
                <button
                  class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                  onclick={(event) => {
                    event.stopPropagation();
                    openGroupModal(null, group.id);
                  }}
                  title="Add sub-group"
                >
                  <Plus class="w-3.5 h-3.5" />
                </button>
                <button
                  class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-foreground transition-colors cursor-pointer"
                  onclick={(event) => {
                    event.stopPropagation();
                    openGroupModal(group);
                  }}
                  title="Edit group"
                >
                  <Pencil class="w-3.5 h-3.5" />
                </button>
                <button
                  class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-rose-500 transition-colors cursor-pointer"
                  onclick={(event) => deleteGroup(event, group.id)}
                  title="Delete group"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {#if isGroupSidebarOpen && hasChildren && isExpanded}
              <div class="ml-4 pl-2 border-l border-border/40 space-y-0.5 my-0.5 flex flex-col">
                {#each children as child (child.id)}
                  {@const childCount = vaultCountByGroupId.get(child.id) || 0}
                  {@const isChildDragging = vaultGroupReorder.draggedGroupId === child.id}
                  {@const isChildDragOver = vaultGroupReorder.dragOverGroupId === child.id}
                  {@const isChildItemDropTarget = vaultGroupReorder.itemDropGroupId === child.id}
                  {@const isChildSelected = selectedGroupId === child.id}

                  <div
                    use:vaultGroupReorder.elementAction={child.id}
                    class="group/child relative flex items-center w-full rounded-md transition-all duration-150 {isChildDragging
                      ? 'opacity-30 scale-[0.98] border border-dashed border-primary/40'
                      : isChildDragOver
                        ? 'border border-primary/40 ring-1 ring-primary/30 bg-primary/15'
                        : ''} {isChildItemDropTarget ? 'bg-primary/20 ring-2 ring-primary' : ''} {isChildSelected && !isChildItemDropTarget
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
                    role="region"
                    aria-label="Child vault group drop zone"
                  >
                    {#if isChildDragOver && vaultGroupReorder.dropPosition === "above"}
                      <div
                        class="absolute top-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
                      ></div>
                    {/if}
                    {#if isChildDragOver && vaultGroupReorder.dropPosition === "below"}
                      <div
                        class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
                      ></div>
                    {/if}
                    {#if isChildDragOver && vaultGroupReorder.dropPosition === "inside"}
                      <div
                        class="absolute inset-0 rounded-md ring-2 ring-primary bg-primary/25 pointer-events-none z-30 flex items-center justify-end pr-2"
                      >
                        <span class="text-xs font-bold text-primary bg-background/95 px-1.5 py-0.5 rounded shadow-sm border border-primary/30">
                          ↳ Nest here
                        </span>
                      </div>
                    {/if}

                    <div
                      class="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground/40 hover:text-primary hover:bg-primary/10 rounded transition-colors select-none touch-none shrink-0 ml-1"
                      title="Drag to reorder or move group"
                      role="button"
                      tabindex={isGroupSidebarOpen ? 0 : -1}
                      aria-label="Drag to reorder or move group"
                      onpointerdown={(event) =>
                        vaultGroupReorder.handleGripPointerDown(
                          event,
                          child.id,
                          children.map((c) => c.id),
                          {
                            allowNest: true,
                            itemLabel: child.name,
                            getGroupName: (gId) => (gId ? vaultGroupByIdMap.get(gId)?.name || 'Group' : 'Vault'),
                            onNest: handleNestGroup,
                            onUnnest: handleUnnestGroup,
                          }
                        )}
                      onclick={(event) => event.stopPropagation()}
                      onkeydown={(event) => {
                        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
                      }}
                    >
                      <GripVertical class="w-3 h-3" />
                    </div>

                    <button
                      class="flex-1 flex items-center px-1.5 py-1.5 rounded-md text-xs transition-colors text-left min-w-0"
                      onclick={() => {
                        if (!vaultGroupReorder.isPointerDragging) selectedGroupId = child.id;
                      }}
                      title="{group.name} / {child.name}"
                    >
                      <CornerDownRight class="w-3 h-3 shrink-0 opacity-40 mr-1" />
                      <Folder class="w-3 h-3 shrink-0 opacity-70 mr-1" />
                      <span class="truncate block flex-1 min-w-0 mr-1">{child.name}</span>
                      {#if isGroupSidebarOpen}
                        <CountBadge
                          count={childCount}
                          class="ml-auto mr-1 bg-muted/70 text-muted-foreground group-hover/child:opacity-0 transition-opacity pointer-events-none"
                          title="{childCount} items"
                        />
                      {/if}
                    </button>

                    <div
                      class="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover/child:opacity-100 transition-opacity bg-card/95 backdrop-blur-xs pl-1 pr-0.5 py-0.5 rounded-md shadow-xs z-20"
                    >
                      <button
                        class="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-foreground transition-colors cursor-pointer"
                        onclick={(event) => {
                          event.stopPropagation();
                          openGroupModal(child);
                        }}
                        title="Edit sub-group"
                      >
                        <Pencil class="w-3 h-3" />
                      </button>
                      <button
                        class="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 text-rose-500 transition-colors cursor-pointer"
                        onclick={(event) => deleteGroup(event, child.id)}
                        title="Delete sub-group"
                      >
                        <Trash2 class="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

<FormModal
  bind:isOpen={isGroupModalOpen}
  title={editingGroup ? "Edit Group" : "New Group"}
  submitText={editingGroup ? "Save" : "Create"}
  submitDisabled={!formGroupTitle.trim()}
  onSubmit={onGroupSubmit}
>
  <div class="space-y-4">
    <FormField label="Group Name">
      <Input
        bind:value={formGroupTitle}
        placeholder="Enter group name..."
        maxlength={MAX_GROUP_NAME_LENGTH}
        required
      />
    </FormField>

    <FormField label="Group Role / Level">
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer {formGroupRole === 'ROOT'
            ? 'border-primary bg-primary/10 ring-1 ring-primary text-primary'
            : 'border-border/60 hover:border-border hover:bg-muted/30 text-muted-foreground'}"
          onclick={() => {
            formGroupRole = 'ROOT';
            formGroupParentId = null;
          }}
        >
          <div class="flex items-center gap-1.5 font-semibold text-xs text-foreground">
            <Folder class="w-4 h-4 text-primary" />
            <span>Root Group</span>
          </div>
          <span class="text-xs text-muted-foreground mt-1">
            Top-level container. Can hold credentials and sub-groups.
          </span>
        </button>

        <button
          type="button"
          disabled={isEditingGroupParent}
          class="flex flex-col items-start p-3 rounded-xl border text-left transition-all {isEditingGroupParent
            ? 'opacity-50 cursor-not-allowed border-dashed bg-muted/10'
            : 'cursor-pointer'} {formGroupRole === 'REGULAR'
            ? 'border-primary bg-primary/10 ring-1 ring-primary text-primary'
            : 'border-border/60 hover:border-border hover:bg-muted/30 text-muted-foreground'}"
          onclick={() => {
            if (isEditingGroupParent) return;
            formGroupRole = 'REGULAR';
            if (!formGroupParentId && eligibleParentGroups.length > 0) {
              formGroupParentId = eligibleParentGroups[0].id;
            }
          }}
        >
          <div class="flex items-center gap-1.5 font-semibold text-xs text-foreground">
            <CornerDownRight class="w-4 h-4 text-primary" />
            <span>Regular Group</span>
          </div>
          <span class="text-xs text-muted-foreground mt-1">
            Sub-group nested under a Root Group.
          </span>
        </button>
      </div>
    </FormField>

    {#if formGroupRole === 'REGULAR'}
      <FormField label="Parent Root Group">
        {#if eligibleParentGroups.length === 0}
          <div class="p-3 rounded-xl border border-border/60 bg-muted/20 text-xs text-muted-foreground">
            No other Root Groups available. Please create a Root Group first or keep this as Root Group.
          </div>
        {:else}
          <DropdownMenu class="w-full block max-w-full">
            <DropdownMenuTrigger class="w-full">
              <button
                type="button"
                class="w-full max-w-full min-w-0 h-10 px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm ring-offset-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors flex items-center justify-between gap-2 cursor-pointer"
              >
                <span class="truncate block min-w-0">
                  {eligibleParentGroups.find((g) => g.id === formGroupParentId)?.name ?? eligibleParentGroups[0]?.name ?? 'Select Root Group'}
                </span>
                <ChevronDown class="w-4 h-4 opacity-50 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              class="w-full max-w-full min-w-48 max-h-40 overflow-y-auto overflow-x-hidden"
            >
              {#each eligibleParentGroups as pGroup (pGroup.id)}
                <DropdownMenuItem
                  onclick={() => {
                    formGroupParentId = pGroup.id;
                  }}
                  class={formGroupParentId === pGroup.id ? "bg-accent font-medium text-primary" : ""}
                >
                  <span class="truncate block w-full text-left">{pGroup.name}</span>
                </DropdownMenuItem>
              {/each}
            </DropdownMenuContent>
          </DropdownMenu>
        {/if}
      </FormField>
    {/if}
  </div>
</FormModal>

<FormModal
  bind:isOpen={isEditorOpen}
  title={editingItem ? "Edit Credential" : "New Credential"}
  submitText={editingItem ? "Save" : "Create"}
  submitDisabled={!formName.trim() ||
    !formUsername.trim() ||
    (!editingItem && !formPassword.trim())}
  onSubmit={handleSaveEditor}
>
  <FormField>
    <Input
      bind:value={formName}
      placeholder="Platform name"
      maxlength={MAX_CREDENTIAL_NAME_LENGTH}
      required
    />
  </FormField>
  <FormField>
    <Input
      bind:value={formUsername}
      placeholder="Username / Email"
      maxlength={MAX_USERNAME_LENGTH}
      required
    />
  </FormField>
  <FormField>
    <div class="relative flex items-center">
      <Input
        type={isFormPasswordVisible ? "text" : "password"}
        bind:value={formPassword}
        placeholder={editingItem ? "New password (leave blank to keep)" : "Password"}
        maxlength={MAX_PASSWORD_LENGTH}
        required={!editingItem}
        class="pr-20 font-mono"
      />
      <div class="absolute right-1 flex items-center gap-1">
        <button
          type="button"
          class="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onclick={() => (isFormPasswordVisible = !isFormPasswordVisible)}
          title={isFormPasswordVisible ? "Hide password" : "Show password"}
        >
          {#if isFormPasswordVisible}
            <EyeOff class="w-4 h-4" />
          {:else}
            <Eye class="w-4 h-4" />
          {/if}
        </button>
        <button
          type="button"
          class="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-colors cursor-pointer"
          onclick={handleGeneratePassword}
          title="Generate strong password"
        >
          <Dices class="w-4 h-4" />
        </button>
      </div>
    </div>
    {#if formPassword}
      <div class="mt-2 space-y-1">
        <div class="flex items-center justify-between text-xs">
          <span class="text-muted-foreground">Strength:</span>
          <span class="font-medium text-foreground">{formPasswordStrength.label}</span>
        </div>
        <div class="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            class="h-full {formPasswordStrength.color} transition-all duration-300 rounded-full"
            style="width: {formPasswordStrength.width};"
          ></div>
        </div>
      </div>
    {/if}
  </FormField>
  <FormField>
    <Input bind:value={formNote} placeholder="Note (optional)" maxlength={MAX_NOTE_LENGTH} />
  </FormField>
  <FormField label="Group (Optional)">
    <DropdownMenu class="w-full block max-w-full">
      <DropdownMenuTrigger class="w-full">
        <button
          type="button"
          class="w-full max-w-full min-w-0 h-10 px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm ring-offset-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors flex items-center justify-between gap-2"
        >
          <span class="truncate block min-w-0">{formGroupNameLabel}</span>
          <ChevronDown class="w-4 h-4 opacity-50 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        class="w-full max-w-full min-w-48 max-h-40 overflow-y-auto overflow-x-hidden"
      >
        <DropdownMenuItem
          onclick={(event) => {
            event.preventDefault();
            formGroupId = null;
          }}
        >
          <span class="truncate block w-full text-left">No Group</span>
        </DropdownMenuItem>
        {#each rootVaultGroups as rootGroup (rootGroup.id)}
          {@const children = childGroupsByParentIdMap.get(rootGroup.id) ?? []}
          <DropdownMenuItem
            onclick={(event) => {
              event.preventDefault();
              formGroupId = rootGroup.id;
            }}
            class={formGroupId === rootGroup.id ? "bg-accent font-medium text-primary" : ""}
          >
            <span class="truncate block w-full text-left font-medium" title={rootGroup.name}>
              {rootGroup.name} {children.length > 0 ? "(General)" : ""}
            </span>
          </DropdownMenuItem>
          {#each children as child (child.id)}
            <DropdownMenuItem
              onclick={(event) => {
                event.preventDefault();
                formGroupId = child.id;
              }}
              class="pl-6 {formGroupId === child.id ? 'bg-accent font-medium text-primary' : ''}"
            >
              <span class="truncate block w-full text-left text-muted-foreground flex items-center gap-1.5" title="{rootGroup.name} / {child.name}">
                <span class="text-xs opacity-50">↳</span>
                <span class="truncate">{child.name}</span>
              </span>
            </DropdownMenuItem>
          {/each}
        {/each}
      </DropdownMenuContent>
    </DropdownMenu>
  </FormField>
</FormModal>

<ConfirmModal
  bind:isOpen={confirmDialog.isOpen}
  title={confirmDialog.title}
  message={confirmDialog.message}
  onConfirm={confirmDialog.onConfirm}
/>

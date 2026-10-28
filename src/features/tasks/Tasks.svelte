<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Task, TaskGroup } from "../../shared/db/schema";
  import { getNextSelection, getNextSort } from "../../shared/utils/table";
  import { formatDate } from "../../shared/utils/format";
  import {
    PlusCircle,
    Trash2,
    Pencil,
    CheckSquare,
    Folder,
    FolderOpen,
    FolderTree,
    ChevronDown,
    ChevronRight,
    Plus,
    CornerDownRight,
    GripVertical,
    FileText,
    X,
    Kanban,
    LayoutList,
    Circle,
    CheckCircle,
    ChevronUp,
    Layers,
  } from "lucide-svelte";
  import TaskCountdown from "../dashboard/TaskCountdown.svelte";
  import { createPointerReorder } from "../../shared/utils/pointerReorder.svelte";
  import { createResizableSidebar } from "../../shared/utils/resizableSidebar.svelte";
  import Button from "../../shared/ui/Button.svelte";
  import ActionButton from "../../shared/ui/ActionButton.svelte";
  import Input from "../../shared/ui/Input.svelte";
  import FormField from "../../shared/ui/FormField.svelte";
  import TabSwitcher from "../../shared/ui/TabSwitcher.svelte";
  import PageLayout from "../../shared/ui/PageLayout.svelte";
  import Toolbar from "../../shared/ui/Toolbar.svelte";
  import SearchBar from "../../shared/ui/SearchBar.svelte";
  import EmptyState from "../../shared/ui/EmptyState.svelte";
  import SortIcon from "../../shared/ui/SortIcon.svelte";
  import ConfirmModal from "../../shared/ui/ConfirmModal.svelte";
  import FormModal from "../../shared/ui/FormModal.svelte";
  import CountBadge from "../../shared/ui/CountBadge.svelte";
  import DatePicker from "../../shared/ui/DatePicker.svelte";
  import TimePicker from "../../shared/ui/TimePicker.svelte";
  import TaskNoteModal from "./TaskNoteModal.svelte";
  import { renderSanitizedMarkdown, mountMarkdown } from "../../shared/utils/markdown";
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
  import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
  } from "../../shared/ui/dropdown";
  import { taskStore } from "../../shared/taskStore.svelte";
  import { toastState } from "../../shared/toast.svelte";

  interface DeadlineBadge {
    dateText: string;
    timeText: string | null;
    colorClass: string;
    timeColorClass: string;
  }

  const ZERO_WIDTH_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;
  const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/g;
  const UNDERSCORE_REGEX = /_/g;

  const MAX_TASK_TITLE_LENGTH = 255;
  const MAX_GROUP_NAME_LENGTH = 100;

  const STATUS_FILTER_TABS = [
    { value: "ALL", label: "All" },
    { value: "PENDING", label: "Pending" },
    { value: "COMPLETED", label: "Completed" },
  ];

  const NEXT_STATUS_MAP: Record<string, string> = {
    PENDING: "COMPLETED",
    COMPLETED: "PENDING",
  };

  const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  const TASK_BADGE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  let statusFilter = $state("ALL");
  let isMounted = true;
  let searchQuery = $state("");

  const STORAGE_KEY_TASK_VIEW = "personal_os_task_view";
  function getInitialTaskView(): "table" | "kanban" {
    try {
      const v = localStorage.getItem(STORAGE_KEY_TASK_VIEW);
      if (v === "kanban" || v === "table") return v;
    } catch {}
    return "kanban";
  }

  let currentView = $state<"table" | "kanban">(getInitialTaskView());

  function setTaskView(view: "table" | "kanban") {
    currentView = view;
    try {
      localStorage.setItem(STORAGE_KEY_TASK_VIEW, view);
    } catch {}
  }

  let isModalOpen = $state(false);
  let editingTask = $state<Task | null>(null);
  let formTitle = $state("");
  let formStatus = $state("PENDING");
  let formDueDate = $state("");
  let formDueTime = $state("");
  let formGroupId = $state<string | null>(null);
  let formDescription = $state("");
  let scopedRootGroupId = $state<string | null>(null);
  let initialNewTaskGroupId = $state<string | null>(null);

  let formNoteTask = $state<Task | null>(null);
  let isFormNoteModalOpen = $state(false);

  let isTaskFormDirty = $derived.by(() => {
    if (!isModalOpen) return false;
    if (editingTask) {
      const origTitle = editingTask.title ?? "";
      const origDesc = editingTask.description ?? "";
      const origGroupId = editingTask.groupId ?? null;
      let origDueDateStr = "";
      let origDueTimeStr = "";
      if (editingTask.dueDate != null && !Number.isNaN(editingTask.dueDate)) {
        const d = new Date(editingTask.dueDate);
        origDueDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const h = d.getHours();
        const m = d.getMinutes();
        if (!(h === 23 && m === 59)) {
          origDueTimeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        }
      }
      return (
        formTitle !== origTitle ||
        formDescription !== origDesc ||
        formGroupId !== origGroupId ||
        formDueDate !== origDueDateStr ||
        formDueTime !== origDueTimeStr ||
        formStatus !== (editingTask.status ?? "PENDING")
      );
    } else {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      return (
        formTitle.trim().length > 0 ||
        formDescription.trim().length > 0 ||
        (formDueDate.trim().length > 0 && formDueDate !== todayStr) ||
        formDueTime.trim().length > 0 ||
        formGroupId !== initialNewTaskGroupId
      );
    }
  });

  let isTaskDeadlineValid = $derived.by(() => {
    if (!formDueDate.trim()) return false;
    const parsed = parseDeadlineTimestamp(formDueDate, formDueTime);
    return parsed !== null;
  });

  let isTaskFormValid = $derived(
    formTitle.trim().length > 0 && isTaskDeadlineValid
  );

  function setQuickDeadline(daysOffset: number) {
    const target = new Date();
    target.setDate(target.getDate() + daysOffset);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    formDueDate = `${y}-${m}-${day}`;
  }

  function openNoteFromForm() {
    formNoteTask = {
      id: editingTask?.id ?? "temp-new-task",
      title: formTitle.trim() || (editingTask ? editingTask.title : "New Task"),
      status: formStatus,
      dueDate: parseDeadlineTimestamp(formDueDate, formDueTime),
      groupId: formGroupId,
      createdAt: editingTask?.createdAt ?? Date.now(),
      updatedAt: editingTask?.updatedAt ?? Date.now(),
      description: formDescription || null,
      deletedAt: null,
    };
    isFormNoteModalOpen = true;
  }

  let noteModalTaskId = $state<string | null>(null);
  let noteModalTask = $derived(
    noteModalTaskId ? taskStore.tasks.find((t) => t.id === noteModalTaskId) ?? null : null
  );
  let isNoteModalOpen = $state(false);

  function openTaskNoteModal(event: Event, task: Task) {
    event.stopPropagation();
    noteModalTaskId = task.id;
    isNoteModalOpen = true;
  }

  let isGroupSidebarOpen = $state(true);
  const groupSidebar = createResizableSidebar();
  const colResizer = createResizableColumns({
    storageKey: "personal_os_tasks_col_widths_v11",
    columns: {
      title: { defaultWidth: 158, minWidth: 135 },
      groupId: { defaultWidth: 176, minWidth: 155 },
      dueDate: { defaultWidth: 182, minWidth: 172 },
      createdAt: { defaultWidth: 98, minWidth: 92 },
      status: { defaultWidth: 112, minWidth: 108 },
      actions: { defaultWidth: 104, minWidth: 104, maxWidth: 104 },
    },
  });
  let selectedGroupId = $state<string | null>(null);

  const STORAGE_KEY_TASK_EXPANDED_PARENTS = "personal_os_task_expanded_parents";
  function getInitialExpandedParents(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TASK_EXPANDED_PARENTS);
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
    if (!hasInitializedExpandedParents && taskStore.taskGroups.length > 0) {
      const parentIds = taskStore.taskGroups
        .filter((g) => !g.parentId && taskStore.taskGroups.some((c) => c.parentId === g.id))
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
      localStorage.setItem(STORAGE_KEY_TASK_EXPANDED_PARENTS, JSON.stringify([...next]));
    } catch {}
  }

  const taskGroupReorder = createPointerReorder("personal_os_task_group_order");
  let rootTaskGroups = $derived.by(() => {
    const raw = taskStore.taskGroups.filter(
      (g) => !g.parentId || !taskGroupByIdMap.has(g.parentId)
    );
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const unique: TaskGroup[] = [];
    for (let i = 0; i < raw.length; i++) {
      const g = raw[i];
      const lower = g.name.trim().toLowerCase();
      if (!seenIds.has(g.id) && !seenNames.has(lower)) {
        seenIds.add(g.id);
        seenNames.add(lower);
        unique.push(g);
      }
    }
    return taskGroupReorder.sortItems(unique);
  });
  let sortedRootGroupIds = $derived(rootTaskGroups.map((group) => group.id));

  let childGroupsByParentIdMap = $derived.by(() => {
    const map = new Map<string, TaskGroup[]>();
    const all = taskStore.taskGroups;
    for (let i = 0; i < all.length; i++) {
      const g = all[i];
      if (g.parentId && taskGroupByIdMap.has(g.parentId)) {
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
      map.set(parentId, taskGroupReorder.sortItems(children));
    }
    return map;
  });

  let draggedItemIdSet = $derived(new Set(taskGroupReorder.draggedItemIds));

  let taskByIdMap = $derived.by(() => {
    const map = new Map<string, Task>();
    const list = taskStore.tasks;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      map.set(item.id, item);
    }
    return map;
  });

  let taskGroupByIdMap = $derived.by(() => {
    const map = new Map<string, TaskGroup>();
    const list = taskStore.taskGroups;
    for (let i = 0; i < list.length; i++) {
      const group = list[i];
      map.set(group.id, group);
    }
    return map;
  });

  let formGroupNameLabel = $derived.by(() => {
    if (!formGroupId) return "No Group";
    const group = taskGroupByIdMap.get(formGroupId);
    if (!group) return "No Group";
    if (group.parentId) {
      const parent = taskGroupByIdMap.get(group.parentId);
      return parent ? `${parent.name} / ${group.name}` : group.name;
    }
    return group.name;
  });

  let isGroupModalOpen = $state(false);
  let formGroupName = $state("");
  let formGroupRole = $state<"ROOT" | "REGULAR">("ROOT");
  let formGroupParentId = $state<string | null>(null);
  let editingGroup = $state<{ id: string; name: string; parentId: string | null } | null>(null);

  let isEditingGroupParent = $derived.by(() => {
    const curId = editingGroup?.id;
    if (!curId) return false;
    return taskStore.taskGroups.some((g) => g.parentId === curId);
  });

  let isGroupFormDirty = $derived.by(() => {
    if (!isGroupModalOpen) return false;
    if (editingGroup) {
      return (
        formGroupName !== (editingGroup.name ?? "") ||
        formGroupParentId !== (editingGroup.parentId ?? null)
      );
    } else {
      return formGroupName.trim().length > 0;
    }
  });

  let eligibleParentGroups = $derived(
    taskStore.taskGroups.filter((g) => !g.parentId && g.id !== editingGroup?.id)
  );

  let matchingGroupIds = $derived.by(() => {
    if (!selectedGroupId) return null;
    const childIds = taskStore.taskGroups
      .filter((g) => g.parentId === selectedGroupId)
      .map((g) => g.id);
    return new Set<string>([selectedGroupId, ...childIds]);
  });

  let taskCountByGroupId = $derived.by(() => {
    const counts = new Map<string, number>();
    const allTasks = taskStore.tasks.filter((t) => !t.deletedAt);
    for (let i = 0; i < allTasks.length; i++) {
      const gid = allTasks[i].groupId;
      if (gid) {
        counts.set(gid, (counts.get(gid) || 0) + 1);
      }
    }
    return counts;
  });

  let selectedTaskIds = $state<Set<string>>(new Set());
  let lastSelectedId: string | null = null;

  let confirmDialog = $state<{ isOpen: boolean; message: string; onConfirm: () => void }>({
    isOpen: false,
    message: "",
    onConfirm: () => {},
  });

  let expandedTasks = $state<Set<string>>(new Set());
  let sortKey = $state<"title" | "createdAt" | "dueDate" | "status" | "groupId">("createdAt");
  let sortDirection = $state<"desc" | "asc">("desc");

  function generateUniqueId(): string {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch {}
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  function sanitizeTextInput(raw: string, maxLength: number): string {
    if (typeof raw !== "string") return "";
    return raw
      .replace(ZERO_WIDTH_CHARS_REGEX, "")
      .replace(CONTROL_CHARS_REGEX, "")
      .trim()
      .slice(0, maxLength);
  }

  $effect(() => {
    try {
      if (!taskStore.isInitialized) {
        taskStore.fetchAll().catch(() => {});
      }
      if (taskStore.targetFilter) {
        statusFilter = taskStore.targetFilter;
        taskStore.targetFilter = null;
      }
      if (taskStore.targetTaskId) {
        selectedTaskIds = new Set([taskStore.targetTaskId]);
        lastSelectedId = taskStore.targetTaskId;
        taskStore.targetTaskId = null;
      }
    } catch {}
  });

  onMount(() => {
    const handleShortcut = () => {
      try {
        openModal(null);
      } catch {}
    };
    try {
      window.addEventListener("shortcut-new-task", handleShortcut);
    } catch {}
    return () => {
      try {
        window.removeEventListener("shortcut-new-task", handleShortcut);
      } catch {}
    };
  });

  onDestroy(() => {
    try {
      clearSpringExpand();
      isMounted = false;
      selectedTaskIds.clear();
      expandedTasks.clear();
      editingTask = null;
      editingGroup = null;
      confirmDialog = { isOpen: false, message: "", onConfirm: () => {} };
    } catch {}
  });

  let sortedAndFilteredTasks = $derived.by(() => {
    try {
      const allTasks = taskStore.tasks;
      const activeStatusFilter = statusFilter;
      const currentMatchingGroupIds = matchingGroupIds;
      const filtered: Task[] = [];

      const cleanSearch = searchQuery.trim().toLowerCase();
      for (let i = 0; i < allTasks.length; i++) {
        const task = allTasks[i];
        if (task.deletedAt) continue;
        if (activeStatusFilter === "PENDING" && task.status !== "PENDING") continue;
        if (activeStatusFilter === "COMPLETED" && task.status !== "COMPLETED") continue;
        if (currentMatchingGroupIds && (!task.groupId || !currentMatchingGroupIds.has(task.groupId))) continue;
        if (cleanSearch) {
          const matchTitle = (task.title || "").toLowerCase().includes(cleanSearch);
          const matchDesc = (task.description || "").toLowerCase().includes(cleanSearch);
          if (!matchTitle && !matchDesc) continue;
        }
        filtered.push(task);
      }

      const currentSortKey = sortKey;
      const directionMultiplier = sortDirection === "asc" ? 1 : -1;
      const groupLookup = taskGroupByIdMap;

      filtered.sort((a, b) => {
        let comparison = 0;
        if (currentSortKey === "title") {
          comparison = COLLATOR.compare(a.title || "", b.title || "");
        } else if (currentSortKey === "createdAt") {
          comparison = a.createdAt - b.createdAt;
        } else if (currentSortKey === "dueDate") {
          const dueA = a.dueDate != null && !Number.isNaN(a.dueDate) ? a.dueDate : Infinity;
          const dueB = b.dueDate != null && !Number.isNaN(b.dueDate) ? b.dueDate : Infinity;
          comparison = dueA - dueB;
        } else if (currentSortKey === "status") {
          comparison = COLLATOR.compare(a.status || "", b.status || "");
        } else if (currentSortKey === "groupId") {
          const getFullGroupName = (gId: string | null | undefined): string => {
            if (!gId) return "";
            const g = groupLookup.get(gId);
            if (!g) return "";
            if (g.parentId) {
              const p = groupLookup.get(g.parentId);
              return p ? `${p.name} / ${g.name}` : g.name;
            }
            return g.name;
          };
          const groupA = getFullGroupName(a.groupId);
          const groupB = getFullGroupName(b.groupId);
          comparison = COLLATOR.compare(groupA, groupB);
        }
        return comparison * directionMultiplier;
      });

      return filtered;
    } catch {
      return [];
    }
  });

  let orderedTaskIds = $derived(sortedAndFilteredTasks.map((task) => task.id));

  interface TrelloSubGroup {
    id: string;
    name: string;
    tasks: Task[];
  }

  interface TrelloColumn {
    id: string | null;
    name: string;
    hasSubGroups: boolean;
    subGroups: TrelloSubGroup[];
    directTasks: Task[];
    totalTasksCount: number;
  }

  const STORAGE_KEY_COLLAPSED_SUBGROUPS_WITH_TASKS = "personal-os-collapsed-subgroups-with-tasks";

  function getInitialCollapsedWithTasks(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_COLLAPSED_SUBGROUPS_WITH_TASKS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((id): id is string => typeof id === "string"));
        }
      }
    } catch {}
    return new Set();
  }

  let userCollapsedSubGroupsWithTasks = $state<Set<string>>(getInitialCollapsedWithTasks());
  let userOpenedEmptySubGroups = $state<Set<string>>(new Set());

  let prevView: string | null = null;
  let prevSelectedGroup: string | null = null;
  $effect(() => {
    const curV = currentView;
    const curG = selectedGroupId;
    if (prevView === null && prevSelectedGroup === null) {
      prevView = curV;
      prevSelectedGroup = curG;
      return;
    }
    if (curV !== prevView || curG !== prevSelectedGroup) {
      prevView = curV;
      prevSelectedGroup = curG;
      userOpenedEmptySubGroups = new Set();
    }
  });

  function isSubGroupExpanded(subId: string, taskCount: number): boolean {
    if (taskCount === 0) {
      return userOpenedEmptySubGroups.has(subId);
    }
    return !userCollapsedSubGroupsWithTasks.has(subId);
  }

  function toggleSubGroupCollapse(subId: string, taskCount: number) {
    if (taskCount === 0) {
      const next = new Set(userOpenedEmptySubGroups);
      if (next.has(subId)) {
        next.delete(subId);
      } else {
        next.add(subId);
      }
      userOpenedEmptySubGroups = next;
    } else {
      const next = new Set(userCollapsedSubGroupsWithTasks);
      if (next.has(subId)) {
        next.delete(subId);
      } else {
        next.add(subId);
      }
      userCollapsedSubGroupsWithTasks = next;
      try {
        localStorage.setItem(STORAGE_KEY_COLLAPSED_SUBGROUPS_WITH_TASKS, JSON.stringify([...next]));
      } catch {}
    }
  }

  function ensureSubGroupExpanded(subId: string) {
    if (userCollapsedSubGroupsWithTasks.has(subId)) {
      const next = new Set(userCollapsedSubGroupsWithTasks);
      next.delete(subId);
      userCollapsedSubGroupsWithTasks = next;
      try {
        localStorage.setItem(STORAGE_KEY_COLLAPSED_SUBGROUPS_WITH_TASKS, JSON.stringify([...next]));
      } catch {}
    }
    const count = getSubGroupTaskCount(subId);
    if (count === 0) {
      if (!userOpenedEmptySubGroups.has(subId)) {
        const nextOpened = new Set(userOpenedEmptySubGroups);
        nextOpened.add(subId);
        userOpenedEmptySubGroups = nextOpened;
      }
    }
  }

  function getSubGroupTaskCount(subId: string): number {
    if (subId.endsWith('-direct')) {
      const rootId = subId.replace('-direct', '');
      return sortedAndFilteredTasks.filter((t) => t.groupId === rootId).length;
    }
    return sortedAndFilteredTasks.filter((t) => t.groupId === subId).length;
  }

  function isSubGroupCurrentlyOpen(subId: string): boolean {
    const count = getSubGroupTaskCount(subId);
    return isSubGroupExpanded(subId, count);
  }

  function collapseSubGroup(subId: string) {
    if (userOpenedEmptySubGroups.has(subId)) {
      const nextOpened = new Set(userOpenedEmptySubGroups);
      nextOpened.delete(subId);
      userOpenedEmptySubGroups = nextOpened;
    }
    if (!userCollapsedSubGroupsWithTasks.has(subId)) {
      const nextCollapsed = new Set(userCollapsedSubGroupsWithTasks);
      nextCollapsed.add(subId);
      userCollapsedSubGroupsWithTasks = nextCollapsed;
      try {
        localStorage.setItem(STORAGE_KEY_COLLAPSED_SUBGROUPS_WITH_TASKS, JSON.stringify([...nextCollapsed]));
      } catch {}
    }
  }

  let springExpandTimer: ReturnType<typeof setTimeout> | null = null;
  let springExpandSubId: string | null = null;
  let springLeaveTimer: ReturnType<typeof setTimeout> | null = null;
  let springExpandedSubIds = new Set<string>();

  function handleSubGroupDragHover(subId: string) {
    if (springLeaveTimer) {
      clearTimeout(springLeaveTimer);
      springLeaveTimer = null;
    }

    // If another subgroup was previously spring-expanded, collapse it immediately
    for (const prevId of springExpandedSubIds) {
      if (prevId !== subId) {
        collapseSubGroup(prevId);
        springExpandedSubIds.delete(prevId);
      }
    }

    if (springExpandSubId === subId) return;

    if (springExpandTimer) {
      clearTimeout(springExpandTimer);
      springExpandTimer = null;
    }

    // If subId is already open, no need to schedule spring-expand
    if (isSubGroupCurrentlyOpen(subId)) {
      springExpandSubId = subId;
      return;
    }

    springExpandSubId = subId;
    springExpandTimer = setTimeout(() => {
      springExpandedSubIds.add(subId);
      ensureSubGroupExpanded(subId);
      springExpandTimer = null;
    }, 450);
  }

  function handleSubGroupDragLeave() {
    if (springExpandTimer) {
      clearTimeout(springExpandTimer);
      springExpandTimer = null;
    }
    springExpandSubId = null;

    if (springExpandedSubIds.size > 0 && !springLeaveTimer) {
      springLeaveTimer = setTimeout(() => {
        springLeaveTimer = null;
        for (const id of springExpandedSubIds) {
          collapseSubGroup(id);
        }
        springExpandedSubIds.clear();
      }, 250);
    }
  }

  function clearSpringExpand() {
    if (springExpandTimer) {
      clearTimeout(springExpandTimer);
      springExpandTimer = null;
    }
    if (springLeaveTimer) {
      clearTimeout(springLeaveTimer);
      springLeaveTimer = null;
    }
    springExpandSubId = null;
  }

  function sortBoardTasks(list: Task[]): Task[] {
    return [...list].sort((a, b) => {
      const hasA = a.dueDate != null && !Number.isNaN(a.dueDate) && a.dueDate > 0;
      const hasB = b.dueDate != null && !Number.isNaN(b.dueDate) && b.dueDate > 0;

      if (hasA && hasB) {
        if (a.dueDate! !== b.dueDate!) {
          return a.dueDate! - b.dueDate!;
        }
        return a.createdAt - b.createdAt;
      }

      if (hasA && !hasB) return -1;
      if (!hasA && hasB) return 1;

      return a.createdAt - b.createdAt;
    });
  }

  let dragOverColumnId = $state<string | null>(null);
  let draggedColumnId = $state<string | null>(null);
  let draggedCardId = $state<string | null>(null);
  let activeDraggedTaskId = $state<string | null>(null);

  // Board Pointer Drag State (bypasses Tauri WebView2 native DnD restrictions)
  let isBoardPointerDragging = $state(false);
  let boardPointerDragTask = $state<Task | null>(null);
  let boardPointerPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let boardPointerTarget = $state<{
    type: 'subgroup' | 'direct' | 'column';
    targetId: string;
    groupId: string | null;
  } | null>(null);

  // Column reordering pointer state
  let isColPointerDragging = $state(false);
  let colPointerSourceId = $state<string | null>(null);
  let colPointerTargetId = $state<string | null>(null);
  let colPointerPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

  function findKanbanTargetAt(x: number, y: number): {
    type: 'subgroup' | 'direct' | 'column';
    targetId: string;
    groupId: string | null;
  } | null {
    if (typeof document === 'undefined') return null;
    const elements = document.elementsFromPoint(x, y);
    if (!elements || elements.length === 0) return null;

    // 1. Check for specific sub-group under pointer (highest priority)
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLElement;
      const targetEl = el.closest?.('[data-kanban-target-type="subgroup"]') as HTMLElement | null;
      if (targetEl && targetEl.dataset.kanbanTargetId) {
        const subId = targetEl.dataset.kanbanTargetId;
        return { type: 'subgroup', targetId: subId, groupId: subId };
      }
    }

    // 2. Direct tasks section
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLElement;
      const targetEl = el.closest?.('[data-kanban-target-type="direct"]') as HTMLElement | null;
      if (targetEl && targetEl.dataset.kanbanTargetId) {
        const targetId = targetEl.dataset.kanbanTargetId;
        const rawGroupId = targetEl.dataset.kanbanGroupId;
        const groupId = rawGroupId && rawGroupId.length > 0 ? rawGroupId : null;
        return { type: 'direct', targetId, groupId };
      }
    }

    // 3. Fallback: column container / header
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as HTMLElement;
      const targetEl = el.closest?.('[data-kanban-target-type="column"]') as HTMLElement | null;
      if (targetEl && targetEl.dataset.kanbanTargetId) {
        const targetId = targetEl.dataset.kanbanTargetId;
        const rawGroupId = targetEl.dataset.kanbanGroupId;
        const groupId = rawGroupId && rawGroupId.length > 0 ? rawGroupId : null;
        return { type: 'column', targetId, groupId };
      }
    }

    return null;
  }

  function handleCardPointerDown(e: PointerEvent, task: Task) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, a, [data-no-drag]')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;

    const onPointerMove = (moveEv: PointerEvent) => {
      const curX = moveEv.clientX;
      const curY = moveEv.clientY;

      if (!hasMoved) {
        if (Math.hypot(curX - startX, curY - startY) < 5) return;
        hasMoved = true;
        isBoardPointerDragging = true;
        boardPointerDragTask = task;
        draggedCardId = task.id;
        activeDraggedTaskId = task.id;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        try {
          window.getSelection()?.removeAllRanges();
        } catch {}
      }

      boardPointerPos = { x: curX, y: curY };

      const hit = findKanbanTargetAt(curX, curY);
      boardPointerTarget = hit;
      if (hit) {
        dragOverColumnId = hit.targetId;
        if (hit.type === 'subgroup' || hit.type === 'direct') {
          const targetSubId = hit.type === 'direct' ? hit.targetId : hit.groupId!;
          handleSubGroupDragHover(targetSubId);
        } else {
          handleSubGroupDragLeave();
        }
      } else {
        dragOverColumnId = null;
        handleSubGroupDragLeave();
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      clearSpringExpand();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      let destGroupId: string | null = null;
      if (hasMoved) {
        const suppressClick = (clickEv: MouseEvent) => {
          clickEv.stopPropagation();
          clickEv.preventDefault();
        };
        window.addEventListener('click', suppressClick, { capture: true, once: true });
        setTimeout(() => {
          window.removeEventListener('click', suppressClick, { capture: true });
        }, 50);

        if (boardPointerTarget) {
          destGroupId = boardPointerTarget.groupId;
          const sourceGroupId = task.groupId;
          moveTasksToGroup([task.id], destGroupId);
          if (destGroupId) {
            ensureSubGroupExpanded(destGroupId);
          }
          if (sourceGroupId && sourceGroupId !== destGroupId) {
            const remainingCount = sortedAndFilteredTasks.filter(
              (t) => t.id !== task.id && t.groupId === sourceGroupId
            ).length;
            if (remainingCount === 0) {
              collapseSubGroup(sourceGroupId);
              collapseSubGroup(`${sourceGroupId}-direct`);
            }
          }
        }
      }

      // Revert ANY spring-expanded sub-groups that were NOT the drop destination
      for (const autoOpenedId of springExpandedSubIds) {
        const isDest = (destGroupId && autoOpenedId === destGroupId) ||
                       (autoOpenedId.endsWith('-direct') && autoOpenedId.replace('-direct', '') === destGroupId);
        if (!isDest) {
          collapseSubGroup(autoOpenedId);
        }
      }
      springExpandedSubIds.clear();

      isBoardPointerDragging = false;
      boardPointerDragTask = null;
      boardPointerTarget = null;
      draggedCardId = null;
      activeDraggedTaskId = null;
      dragOverColumnId = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function handleColumnPointerDown(e: PointerEvent, colId: string | null) {
    if (!colId || e.button !== 0 || isBoardPointerDragging) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, a, [data-no-drag]')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;

    const onPointerMove = (moveEv: PointerEvent) => {
      const curX = moveEv.clientX;
      const curY = moveEv.clientY;

      if (!hasMoved) {
        if (Math.hypot(curX - startX, curY - startY) < 8) return;
        hasMoved = true;
        isColPointerDragging = true;
        colPointerSourceId = colId;
        draggedColumnId = colId;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }

      colPointerPos = { x: curX, y: curY };

      const hit = findKanbanTargetAt(curX, curY);
      if (hit && hit.type === 'column') {
        colPointerTargetId = hit.groupId;
        dragOverColumnId = hit.targetId;
      } else {
        colPointerTargetId = null;
        dragOverColumnId = null;
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      if (hasMoved && colPointerSourceId && colPointerTargetId && colPointerSourceId !== colPointerTargetId) {
        reorderColumns(colPointerSourceId, colPointerTargetId);
      }

      isColPointerDragging = false;
      colPointerSourceId = null;
      colPointerTargetId = null;
      draggedColumnId = null;
      dragOverColumnId = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  let pendingTasksCount = $derived(
    taskStore.tasks.filter((t) => !t.deletedAt && t.status === "PENDING").length
  );
  let completedTasksCount = $derived(
    taskStore.tasks.filter((t) => !t.deletedAt && t.status === "COMPLETED").length
  );
  let allTasksCount = $derived(
    taskStore.tasks.filter((t) => !t.deletedAt).length
  );

  function getTaskDueBadges(dueDate: number | null | undefined): {
    dateStr: string | null;
    timeStr: string | null;
  } {
    try {
      if (!dueDate) return { dateStr: null, timeStr: null };
      const d = new Date(dueDate);
      if (Number.isNaN(d.getTime())) return { dateStr: null, timeStr: null };
      const dateStr = TASK_BADGE_DATE_FORMATTER.format(d);
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

  let trelloColumns = $derived.by(() => {
    try {
      const activeTasks = sortedAndFilteredTasks;

      const sortedRoots = rootTaskGroups;
      const childrenMap = childGroupsByParentIdMap;

      const columns: TrelloColumn[] = [];

      const targetRootGroups = selectedGroupId
        ? sortedRoots.filter((r) => {
            if (r.id === selectedGroupId) return true;
            const children = childrenMap.get(r.id) || [];
            return children.some((c) => c.id === selectedGroupId);
          })
        : sortedRoots;

      for (let i = 0; i < targetRootGroups.length; i++) {
        const root = targetRootGroups[i];
        const children = childrenMap.get(root.id) || [];
        const hasSubGroups = children.length > 0;

        const subGroups: TrelloSubGroup[] = [];
        let totalCount = 0;

        for (let j = 0; j < children.length; j++) {
          const child = children[j];
          if (selectedGroupId && selectedGroupId !== child.id && selectedGroupId !== root.id) {
            continue;
          }
          const childTasks = sortBoardTasks(activeTasks.filter((t) => t.groupId === child.id));
          subGroups.push({
            id: child.id,
            name: child.name,
            tasks: childTasks,
          });
          totalCount += childTasks.length;
        }

        const directTasks = sortBoardTasks(activeTasks.filter((t) => t.groupId === root.id));
        totalCount += directTasks.length;

        columns.push({
          id: root.id,
          name: root.name,
          hasSubGroups,
          subGroups,
          directTasks,
          totalTasksCount: totalCount,
        });
      }

      if (!selectedGroupId) {
        const ungroupedTasks = sortBoardTasks(activeTasks.filter((t) => !t.groupId));
        if (ungroupedTasks.length > 0 || columns.length === 0) {
          columns.push({
            id: null,
            name: "General Tasks",
            hasSubGroups: false,
            subGroups: [],
            directTasks: ungroupedTasks,
            totalTasksCount: ungroupedTasks.length,
          });
        }
      }

      return columns;
    } catch {
      return [];
    }
  });

  let hasAnyCollapsed = $derived.by(() => {
    for (let i = 0; i < trelloColumns.length; i++) {
      const col = trelloColumns[i];
      for (let j = 0; j < col.subGroups.length; j++) {
        if (!isSubGroupExpanded(col.subGroups[j].id, col.subGroups[j].tasks.length)) return true;
      }
      if (col.hasSubGroups && col.directTasks.length > 0 && col.id) {
        if (!isSubGroupExpanded(`${col.id}-direct`, col.directTasks.length)) return true;
      }
    }
    return false;
  });

  function handleCollapseAll() {
    const allWithTasks = new Set<string>();
    for (let i = 0; i < trelloColumns.length; i++) {
      const col = trelloColumns[i];
      for (let j = 0; j < col.subGroups.length; j++) {
        if (col.subGroups[j].tasks.length > 0) {
          allWithTasks.add(col.subGroups[j].id);
        }
      }
      if (col.hasSubGroups && col.directTasks.length > 0 && col.id) {
        allWithTasks.add(`${col.id}-direct`);
      }
    }
    userCollapsedSubGroupsWithTasks = allWithTasks;
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED_SUBGROUPS_WITH_TASKS, JSON.stringify([...allWithTasks]));
    } catch {}
    userOpenedEmptySubGroups = new Set();
  }

  function handleExpandAll() {
    userCollapsedSubGroupsWithTasks = new Set();
    try {
      localStorage.setItem(STORAGE_KEY_COLLAPSED_SUBGROUPS_WITH_TASKS, JSON.stringify([]));
    } catch {}
    const allEmpty = new Set<string>();
    for (let i = 0; i < trelloColumns.length; i++) {
      const col = trelloColumns[i];
      for (let j = 0; j < col.subGroups.length; j++) {
        if (col.subGroups[j].tasks.length === 0) {
          allEmpty.add(col.subGroups[j].id);
        }
      }
      if (col.hasSubGroups && col.directTasks.length === 0 && col.id) {
        allEmpty.add(`${col.id}-direct`);
      }
    }
    userOpenedEmptySubGroups = allEmpty;
  }

  function openModalWithGroup(groupId: string | null) {
    openModal(null);
    formGroupId = groupId;
    initialNewTaskGroupId = groupId;
    if (groupId) {
      const grp = taskGroupByIdMap.get(groupId);
      scopedRootGroupId = grp?.parentId ? grp.parentId : grp?.id ?? null;
    } else {
      scopedRootGroupId = "ungrouped";
    }
  }

  function reorderColumns(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    if (sourceId === "ungrouped" || targetId === "ungrouped") return;
    const allRootIds = rootTaskGroups.map((g) => g.id);
    const fromIdx = allRootIds.indexOf(sourceId);
    const toIdx = allRootIds.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const nextOrder = [...allRootIds];
    nextOrder.splice(fromIdx, 1);
    nextOrder.splice(toIdx, 0, sourceId);
    taskGroupReorder.saveOrder(nextOrder);
    toastState.add("success", "Columns reordered");
  }

  function handleSort(key: typeof sortKey) {
    try {
      const next = getNextSort(key, sortKey, sortDirection);
      sortKey = next.key as typeof sortKey;
      sortDirection = next.direction;
    } catch {}
  }

  function handleRowClick(event: MouseEvent, id: string) {
    try {
      event.stopPropagation();
      const result = getNextSelection(
        event,
        id,
        selectedTaskIds,
        orderedTaskIds,
        lastSelectedId
      );
      selectedTaskIds = result.selection;
      lastSelectedId = result.lastSelectedId;
    } catch {}
  }

  function clearSelection() {
    try {
      if (selectedTaskIds.size > 0) {
        selectedTaskIds = new Set();
      }
      lastSelectedId = null;
    } catch {}
  }

  function toggleExpand(event: MouseEvent | KeyboardEvent, id: string) {
    try {
      if ("ctrlKey" in event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
        return;
      }
      const next = new Set(expandedTasks);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      expandedTasks = next;
    } catch {}
  }

  function openModal(task: Task | null) {
    try {
      editingTask = task;
      formTitle = task?.title ?? "";
      formStatus = task?.status ?? "PENDING";
      formGroupId = task?.groupId ?? selectedGroupId ?? null;
      formDescription = task?.description ?? "";
      if (!task && selectedGroupId) {
        const grp = taskGroupByIdMap.get(selectedGroupId);
        scopedRootGroupId = grp?.parentId ? grp.parentId : grp?.id ?? null;
      } else {
        scopedRootGroupId = null;
      }
      initialNewTaskGroupId = task ? null : formGroupId;
      if (task?.dueDate != null && !Number.isNaN(task.dueDate)) {
        const dateObj = new Date(task.dueDate);
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, "0");
        const day = String(dateObj.getDate()).padStart(2, "0");
        formDueDate = `${year}-${month}-${day}`;

        const hours = dateObj.getHours();
        const minutes = dateObj.getMinutes();
        if (!(hours === 23 && minutes === 59)) {
          formDueTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        } else {
          formDueTime = "";
        }
      } else {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, "0");
        const day = String(today.getDate()).padStart(2, "0");
        formDueDate = `${year}-${month}-${day}`;
        formDueTime = "";
      }
      isModalOpen = true;
    } catch {}
  }

  function parseDeadlineTimestamp(dateStr: string, timeStr: string): number | null {
    const trimmedDate = dateStr.trim();
    if (!trimmedDate) return null;
    const dateParts = trimmedDate.split("-");
    if (dateParts.length !== 3) return null;

    const year = Number(dateParts[0]);
    const month = Number(dateParts[1]);
    const day = Number(dateParts[2]);
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }

    let hours = 23;
    let minutes = 59;
    const trimmedTime = timeStr.trim();
    if (trimmedTime) {
      const timeParts = trimmedTime.split(":");
      if (timeParts.length === 2) {
        const parsedHours = Number(timeParts[0]);
        const parsedMinutes = Number(timeParts[1]);
        if (
          Number.isInteger(parsedHours) &&
          Number.isInteger(parsedMinutes) &&
          parsedHours >= 0 &&
          parsedHours <= 23 &&
          parsedMinutes >= 0 &&
          parsedMinutes <= 59
        ) {
          hours = parsedHours;
          minutes = parsedMinutes;
        }
      }
    }

    const parsedTime = new Date(year, month - 1, day, hours, minutes, 59).getTime();
    return Number.isNaN(parsedTime) ? null : parsedTime;
  }

  async function onSubmit() {
    try {
      const cleanTitle = sanitizeTextInput(formTitle, MAX_TASK_TITLE_LENGTH);
      if (!cleanTitle) {
        toastState.add("error", "Task title is required");
        return;
      }

      const dueDateParsed = parseDeadlineTimestamp(formDueDate, formDueTime);
      if (dueDateParsed === null) {
        toastState.add("error", "Deadline is required for every task");
        return;
      }
      const safeStatus = formStatus === "COMPLETED" ? "COMPLETED" : "PENDING";
      const cleanDescription = formDescription.trim() ? formDescription.slice(0, 5000) : null;

      if (editingTask) {
        await taskStore.updateTask(editingTask.id, {
          title: cleanTitle,
          status: safeStatus,
          dueDate: dueDateParsed,
          groupId: formGroupId,
          description: cleanDescription,
        });
      } else {
        const newId = generateUniqueId();
        const now = Date.now();
        const newTask: Task = {
          id: newId,
          title: cleanTitle,
          status: safeStatus,
          dueDate: dueDateParsed,
          groupId: formGroupId,
          createdAt: now,
          updatedAt: now,
          description: cleanDescription,
          deletedAt: null,
        };
        await taskStore.addTask(newTask);
        if (!isMounted) return;
        selectedTaskIds = new Set([newId]);
        lastSelectedId = newId;
      }
      if (!isMounted) return;
      isModalOpen = false;
    } catch {}
  }

  async function toggleTaskCompletion(event: Event | null | undefined, task: Task) {
    try {
      event?.stopPropagation();
      event?.preventDefault();
      const nextStatus = NEXT_STATUS_MAP[task.status] || "PENDING";
      await taskStore.updateTask(task.id, { status: nextStatus }, true);
      toastState.add(
        "success",
        nextStatus === "COMPLETED" ? "Task marked as completed" : "Task marked as pending"
      );
    } catch {}
  }

  function deleteTask(event: Event, id: string) {
    try {
      event?.stopPropagation();
      confirmDialog = {
        isOpen: true,
        message: "Are you sure you want to delete this task?",
        onConfirm: async () => {
          try {
            if (selectedTaskIds.has(id)) {
              const nextIds = new Set(selectedTaskIds);
              nextIds.delete(id);
              if (isMounted) selectedTaskIds = nextIds;
            }
            await taskStore.deleteTask(id);
          } catch {}
        },
      };
    } catch {}
  }

  function handleDeleteAll() {
    try {
      if (selectedTaskIds.size > 0) {
        const selectedCount = selectedTaskIds.size;
        confirmDialog = {
          isOpen: true,
          message: `Are you sure you want to delete ${selectedCount} selected task(s)?`,
          onConfirm: async () => {
            try {
              const ids = Array.from(selectedTaskIds);
              await taskStore.deleteMany(ids);
              if (isMounted) {
                selectedTaskIds = new Set();
                lastSelectedId = null;
              }
            } catch {}
          },
        };
      } else if (orderedTaskIds.length > 0) {
        confirmDialog = {
          isOpen: true,
          message: "Are you sure you want to permanently delete ALL tasks shown?",
          onConfirm: async () => {
            try {
              const ids = [...orderedTaskIds];
              await taskStore.deleteMany(ids);
              if (isMounted) {
                selectedTaskIds = new Set();
                lastSelectedId = null;
              }
            } catch {}
          },
        };
      }
    } catch {}
  }

  function getDeadlineBadge(
    dueDate: number | null,
    status: string,
    todayStartMs: number,
    todayEndMs: number,
    now: number
  ): DeadlineBadge | null {
    try {
      if (dueDate == null || Number.isNaN(dueDate)) return null;
      const isCompleted = status === "COMPLETED";
      const dateObj = new Date(dueDate);
      const dateStr = TASK_BADGE_DATE_FORMATTER.format(dateObj);

      const hours = dateObj.getHours();
      const minutes = dateObj.getMinutes();
      const seconds = dateObj.getSeconds();
      const isDateOnly = hours === 23 && minutes === 59 && seconds === 59;
      const timeStr = isDateOnly
        ? null
        : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

      let statusPrefix = "";
      let colorClass = "text-indigo-400 bg-indigo-500/10 border-indigo-500/20";
      let timeColorClass = "text-cyan-400 bg-cyan-500/10 border-cyan-500/20 font-medium";

      if (isCompleted) {
        colorClass = "text-muted-foreground bg-muted/40 border-border/50";
        timeColorClass = "text-muted-foreground bg-muted/40 border-border/50";
      } else if (dueDate < now) {
        statusPrefix = "Overdue";
        colorClass = "text-rose-500 bg-rose-500/10 border-rose-500/20 font-semibold";
      } else if (dueDate >= todayStartMs && dueDate <= todayEndMs) {
        statusPrefix = "Due Today";
        colorClass = "text-amber-500 bg-amber-500/10 border-amber-500/20 font-semibold";
      }

      return {
        dateText: statusPrefix ? `${statusPrefix} (${dateStr})` : dateStr,
        timeText: timeStr,
        colorClass,
        timeColorClass,
      };
    } catch {
      return null;
    }
  }

  function openGroupModal(
    group: { id: string; name: string; parentId?: string | null } | null = null,
    defaultParentId: string | null = null
  ) {
    try {
      editingGroup = group ? { id: group.id, name: group.name, parentId: group.parentId ?? null } : null;
      formGroupName = group?.name ?? "";
      const pId = group?.parentId ?? defaultParentId ?? null;
      formGroupParentId = pId;
      formGroupRole = pId ? "REGULAR" : "ROOT";
      isGroupModalOpen = true;
    } catch {}
  }

  async function onGroupSubmit() {
    try {
      const cleanName = sanitizeTextInput(formGroupName, MAX_GROUP_NAME_LENGTH);
      if (!cleanName) return;

      const targetParentId =
        formGroupRole === "REGULAR" && !isEditingGroupParent ? formGroupParentId : null;

      const isDuplicate = taskStore.taskGroups.some(
        (g) =>
          g.name.trim().toLowerCase() === cleanName.toLowerCase() &&
          g.id !== editingGroup?.id
      );
      if (isDuplicate) {
        toastState.add("error", "Group name already exists. Please choose a different name.");
        return;
      }

      if (editingGroup) {
        await taskStore.updateGroup(editingGroup.id, {
          name: cleanName,
          parentId: targetParentId,
        });
      } else {
        const newId = generateUniqueId();
        const now = Date.now();
        await taskStore.addGroup({
          id: newId,
          name: cleanName,
          color: "gray",
          parentId: targetParentId,
          createdAt: now,
          updatedAt: now,
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
      const group = taskGroupByIdMap.get(id);
      const hasChildren = taskStore.taskGroups.some((g) => g.parentId === id);
      const message = hasChildren
        ? `Delete root group "${group?.name || 'this'}"? All dependent sub-groups will also be deleted, and tasks inside will be ungrouped.`
        : `Delete group "${group?.name || 'this'}"? Tasks inside will be ungrouped.`;

      confirmDialog = {
        isOpen: true,
        message,
        onConfirm: async () => {
          try {
            if (selectedGroupId === id) selectedGroupId = null;
            await taskStore.deleteGroup(id);
          } catch {}
        },
      };
    } catch {}
  }

  async function handleNestGroup(sourceId: string, targetId: string) {
    try {
      if (!sourceId || !targetId || sourceId === targetId) return;
      const sourceGroup = taskGroupByIdMap.get(sourceId);
      const targetGroup = taskGroupByIdMap.get(targetId);
      if (!sourceGroup || !targetGroup) return;

      const sourceHasChildren = taskStore.taskGroups.some((g) => g.parentId === sourceId);
      if (sourceHasChildren) {
        toastState.add(
          "error",
          "A root group containing sub-groups cannot become a sub-group (maximum 2 levels)."
        );
        return;
      }

      const finalParentId = targetGroup.parentId || targetGroup.id;
      const parentName = targetGroup.parentId
        ? taskGroupByIdMap.get(targetGroup.parentId)?.name || targetGroup.name
        : targetGroup.name;

      if (sourceGroup.parentId === finalParentId) {
        return;
      }

      await taskStore.updateGroup(sourceId, { parentId: finalParentId });

      const next = new Set(expandedParentGroupIds);
      next.add(finalParentId);
      expandedParentGroupIds = next;

      toastState.add("success", `Nested "${sourceGroup.name}" into "${parentName}"`);
    } catch {}
  }

  async function handleUnnestGroup(sourceId: string) {
    try {
      const sourceGroup = taskGroupByIdMap.get(sourceId);
      if (!sourceGroup) return;
      if (!sourceGroup.parentId) return;

      await taskStore.updateGroup(sourceId, { parentId: null });
      toastState.add("success", `"${sourceGroup.name}" promoted to Root Group`);
    } catch {}
  }

  async function moveTasksToGroup(taskIds: string[], targetGroupId: string | null) {
    try {
      if (!Array.isArray(taskIds) || taskIds.length === 0) return;
      const lookup = taskByIdMap;
      const updatePromises: Promise<void>[] = [];
      const affectedSourceGroupIds = new Set<string>();

      for (let i = 0; i < taskIds.length; i++) {
        const task = lookup.get(taskIds[i]);
        if (task && (task.groupId ?? null) !== targetGroupId) {
          if (task.groupId) {
            affectedSourceGroupIds.add(task.groupId);
          }
          updatePromises.push(taskStore.updateTask(task.id, { groupId: targetGroupId }, true));
        }
      }

      const movedCount = updatePromises.length;
      if (movedCount > 0) {
        await Promise.all(updatePromises);

        // Auto-collapse any source subgroup that now has 0 remaining tasks
        const movedIdsSet = new Set(taskIds);
        for (const sourceId of affectedSourceGroupIds) {
          const remainingCount = sortedAndFilteredTasks.filter(
            (t) => !movedIdsSet.has(t.id) && t.groupId === sourceId
          ).length;
          if (remainingCount === 0) {
            collapseSubGroup(sourceId);
            collapseSubGroup(`${sourceId}-direct`);
          }
        }

        toastState.add(
          "success",
          movedCount > 1 ? `Moved ${movedCount} tasks` : "Task group updated"
        );
      }
    } catch {}
  }

  function getGroupNameById(groupId: string | null): string {
    if (!groupId) return "All Tasks (Ungroup)";
    const group = taskGroupByIdMap.get(groupId);
    if (!group) return "Group";
    if (group.parentId) {
      const parent = taskGroupByIdMap.get(group.parentId);
      return parent ? `${parent.name} / ${group.name}` : group.name;
    }
    return group.name;
  }
</script>

<div class="flex h-full gap-4">
  {@render groupsSidebar()}
  <PageLayout class="relative select-none border-0 overflow-hidden flex-1 min-w-0">
    <div class="relative z-overlay h-full flex flex-col">
      <Toolbar>
        {#snippet search()}
          <div class="flex items-center gap-3 sm:gap-4 min-w-0">
            {#if currentView === "table"}
              <TabSwitcher
                tabs={STATUS_FILTER_TABS}
                value={statusFilter}
                onValueChange={(val) => {
                  statusFilter = val;
                  selectedTaskIds = new Set();
                  lastSelectedId = null;
                }}
              />
            {/if}
            <SearchBar
              bind:value={searchQuery}
              placeholder="Search tasks..."
              containerClass="flex-1 min-w-0 sm:max-w-xs"
            />
          </div>
        {/snippet}

        {#snippet actions()}
          <div class="inline-flex items-center p-0.5 rounded-lg border border-border/60 bg-muted/40 shrink-0">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer {currentView === 'kanban' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => setTaskView("kanban")}
              title="Board View (Default)"
            >
              <Kanban class="w-3.5 h-3.5" />
              <span class="hidden md:inline">Board</span>
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer {currentView === 'table' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => setTaskView("table")}
              title="Table View (Batch Actions & Sorting)"
            >
              <LayoutList class="w-3.5 h-3.5" />
              <span class="hidden md:inline">Table</span>
            </button>
          </div>

          {#if currentView === "table"}
            <Button
              variant="destructive-outline"
              size="sm"
              onclick={handleDeleteAll}
              disabled={sortedAndFilteredTasks.length === 0}
              title={selectedTaskIds.size > 0
                ? `Delete ${selectedTaskIds.size} selected`
                : "Delete All Tasks"}
            >
              <Trash2 class="w-4 h-4" />
              <span class="hidden sm:inline">
                {selectedTaskIds.size > 0 ? `Delete (${selectedTaskIds.size})` : "Delete All"}
              </span>
            </Button>
          {/if}
          <Button size="sm" onclick={() => openModal(null)}>
            <PlusCircle class="w-4 h-4" />
            <span class="hidden sm:inline">New Task</span>
          </Button>
        {/snippet}
      </Toolbar>

      {#if currentView === "kanban"}
        <div class="px-6 py-2 border-b border-border/40 bg-muted/10 flex items-center justify-between gap-4 shrink-0">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer {statusFilter === 'ALL' ? 'bg-primary/20 text-primary border border-primary/40 shadow-xs' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent'}"
              onclick={() => (statusFilter = 'ALL')}
            >
              <span>All</span>
              <CountBadge count={allTasksCount} class={statusFilter === 'ALL' ? 'bg-primary/30 text-primary' : 'bg-muted text-muted-foreground'} />
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer {statusFilter === 'PENDING' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 shadow-xs' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent'}"
              onclick={() => (statusFilter = 'PENDING')}
            >
              <Circle class="w-3.5 h-3.5" />
              <span>Pending</span>
              <CountBadge count={pendingTasksCount} class={statusFilter === 'PENDING' ? 'bg-indigo-500/30 text-indigo-300' : 'bg-muted text-muted-foreground'} />
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer {statusFilter === 'COMPLETED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-xs' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent'}"
              onclick={() => (statusFilter = 'COMPLETED')}
            >
              <CheckCircle class="w-3.5 h-3.5" />
              <span>Completed</span>
              <CountBadge count={completedTasksCount} class={statusFilter === 'COMPLETED' ? 'bg-emerald-500/30 text-emerald-300' : 'bg-muted text-muted-foreground'} />
            </button>
          </div>

          <div class="flex items-center gap-2">
            {#if hasAnyCollapsed}
              <button
                type="button"
                onclick={handleExpandAll}
                class="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Expand all
              </button>
            {:else}
              <button
                type="button"
                onclick={handleCollapseAll}
                class="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Collapse all
              </button>
            {/if}
          </div>
        </div>
      {/if}

      {#if currentView === "table"}
        <TableContainer onclick={clearSelection} class="px-2! sm:px-2!">
        <Table style="min-width: {colResizer.totalWidth}px;">
          <TableHeader onclick={(event: Event) => event.stopPropagation()}>
            <TableRow>
              <TableHead
                style={colResizer.getStyle("title")}
                class="cursor-pointer select-none group relative px-2!"
                onclick={() => handleSort("title")}
                aria-sort={sortKey === "title"
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"}
              >
                <div class="flex items-center gap-2 min-w-0 pr-2">
                  <span class="truncate">Task Name</span>
                  <SortIcon active={sortKey === "title"} direction={sortDirection} />
                </div>
                <ColumnResizer
                  isResizing={colResizer.resizingPair === "title-groupId"}
                  onResize={(d) => colResizer.resizePair("title", "groupId", d)}
                  onFinish={() => colResizer.finishResize()}
                  onReset={() => colResizer.resetPair("title", "groupId")}
                />
              </TableHead>
              <TableHead
                style={colResizer.getStyle("groupId")}
                class="hidden sm:table-cell cursor-pointer select-none group relative px-2!"
                onclick={() => handleSort("groupId")}
                aria-sort={sortKey === "groupId"
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"}
              >
                <div class="flex items-center gap-2 min-w-0 pr-2">
                  <span class="truncate">Group</span>
                  <SortIcon active={sortKey === "groupId"} direction={sortDirection} />
                </div>
                <ColumnResizer
                  isResizing={colResizer.resizingPair === "groupId-dueDate"}
                  onResize={(d) => colResizer.resizePair("groupId", "dueDate", d)}
                  onFinish={() => colResizer.finishResize()}
                  onReset={() => colResizer.resetPair("groupId", "dueDate")}
                />
              </TableHead>
              <TableHead
                style={colResizer.getStyle("dueDate")}
                class="hidden sm:table-cell cursor-pointer select-none group relative px-2!"
                onclick={() => handleSort("dueDate")}
                aria-sort={sortKey === "dueDate"
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"}
              >
                <div class="flex items-center gap-2 min-w-0 pr-2">
                  <span class="truncate">Deadline</span>
                  <SortIcon active={sortKey === "dueDate"} direction={sortDirection} />
                </div>
                <ColumnResizer
                  isResizing={colResizer.resizingPair === "dueDate-createdAt"}
                  onResize={(d) => colResizer.resizePair("dueDate", "createdAt", d)}
                  onFinish={() => colResizer.finishResize()}
                  onReset={() => colResizer.resetPair("dueDate", "createdAt")}
                />
              </TableHead>
              <TableHead
                style={colResizer.getStyle("createdAt")}
                class="hidden md:table-cell cursor-pointer select-none group relative px-2!"
                onclick={() => handleSort("createdAt")}
                aria-sort={sortKey === "createdAt"
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"}
              >
                <div class="flex items-center gap-2 min-w-0 pr-2">
                  <span class="truncate">Created</span>
                  <SortIcon active={sortKey === "createdAt"} direction={sortDirection} />
                </div>
                <ColumnResizer
                  isResizing={colResizer.resizingPair === "createdAt-status"}
                  onResize={(d) => colResizer.resizePair("createdAt", "status", d)}
                  onFinish={() => colResizer.finishResize()}
                  onReset={() => colResizer.resetPair("createdAt", "status")}
                />
              </TableHead>
              <TableHead
                style={colResizer.getStyle("status")}
                class="cursor-pointer select-none group relative px-2!"
                onclick={() => handleSort("status")}
                aria-sort={sortKey === "status"
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"}
              >
                <div class="flex items-center gap-2 min-w-0 pr-2">
                  <span class="truncate">Status</span>
                  <SortIcon active={sortKey === "status"} direction={sortDirection} />
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
            {#if sortedAndFilteredTasks.length === 0}
              <TableRow class="hover:bg-transparent! cursor-default!">
                <TableCell class="p-0 align-middle" colspan={6}>
                  <div class="flex items-center justify-center w-full h-[calc(100vh-16rem)]">
                    <EmptyState icon={CheckSquare} title="No Tasks Found" />
                  </div>
                </TableCell>
              </TableRow>
            {:else}
              {@const now = Date.now()}
              {@const todayStartObj = new Date(now)}
              {@const todayStartMs = new Date(
                todayStartObj.getFullYear(),
                todayStartObj.getMonth(),
                todayStartObj.getDate(),
                0,
                0,
                0,
                0
              ).getTime()}
              {@const todayEndMs = todayStartMs + 86399999}
              {#each sortedAndFilteredTasks as task (task.id)}
                {@const isCompleted = task.status === "COMPLETED"}
                {@const isSelected = selectedTaskIds.has(task.id)}
                {@const isBeingDragged =
                  taskGroupReorder.isItemDragging && draggedItemIdSet.has(task.id)}
                {@const group = task.groupId ? taskGroupByIdMap.get(task.groupId) : undefined}
                {@const deadlineBadge = getDeadlineBadge(
                  task.dueDate,
                  task.status,
                  todayStartMs,
                  todayEndMs,
                  now
                )}

                <TableRow
                  class="border-transparent {isBeingDragged
                    ? 'opacity-40 ring-1 ring-primary/40'
                    : ''}"
                  selected={isSelected}
                  onpointerdown={(event: PointerEvent) =>
                    taskGroupReorder.handleItemPointerDown(
                      event,
                      task.id,
                      selectedTaskIds,
                      moveTasksToGroup,
                      {
                        itemLabel: task.title,
                        getGroupName: getGroupNameById,
                      }
                    )}
                  onclick={(event: MouseEvent) => handleRowClick(event, task.id)}
                  ondblclick={(event: MouseEvent) => {
                    event.stopPropagation();
                    openModal(task);
                  }}
                >
                  <TableCell style={colResizer.getStyle("title")} class="font-medium text-foreground align-middle px-2!">
                    <div class="w-full">
                      <div class="flex flex-col gap-1 min-w-0">
                        <div class="flex items-center gap-1.5 min-w-0 max-w-full flex-nowrap">
                          <div
                            class="min-w-0 shrink cursor-pointer select-none {!expandedTasks.has(task.id)
                              ? 'truncate'
                              : 'whitespace-normal break-words'}"
                            onclick={(event) => toggleExpand(event, task.id)}
                            role="button"
                            tabindex="0"
                            onkeydown={(event) => event.key === "Enter" && toggleExpand(event, task.id)}
                            title="Click to expand / collapse task details"
                          >
                            <span class={isCompleted ? "line-through text-muted-foreground" : ""}>
                              {task.title}
                            </span>
                          </div>
                          {#if task.description}
                            <button
                              type="button"
                              class="inline-flex items-center justify-center p-1 rounded-md border border-indigo-500/30 text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-500/40 shrink-0 transition-colors cursor-pointer"
                              onclick={(e) => openTaskNoteModal(e, task)}
                              title="View and edit note"
                              aria-label="View and edit note"
                            >
                              <FileText class="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            </button>
                          {/if}
                        </div>

                        {#if expandedTasks.has(task.id)}
                          {#if task.description}
                            <div class="mt-2 p-3.5 rounded-xl bg-black/5 dark:bg-white/5 border border-premium-border/60 text-xs">
                              <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-border/40 text-muted-foreground">
                                <span class="font-semibold flex items-center gap-1.5 text-xs uppercase tracking-wider text-indigo-400">
                                  <FileText class="w-3.5 h-3.5 shrink-0" />
                                  Task Notes & Details
                                </span>
                                <button
                                  type="button"
                                  class="text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 cursor-pointer"
                                  onclick={(e) => openTaskNoteModal(e, task)}
                                >
                                  <Pencil class="w-3 h-3" /> Open Editor ↗
                                </button>
                              </div>
                              <div
                                class="prose dark:prose-invert max-w-none text-xs leading-relaxed select-text"
                                use:mountMarkdown={renderSanitizedMarkdown(task.description)}
                              ></div>
                            </div>
                          {:else}
                            <div class="mt-1">
                              <button
                                type="button"
                                class="text-xs text-muted-foreground/60 hover:text-indigo-400 flex items-center gap-1.5 transition-colors cursor-pointer"
                                onclick={(e) => openTaskNoteModal(e, task)}
                              >
                                <FileText class="w-3 h-3 shrink-0" />
                                Add note for this task
                              </button>
                            </div>
                          {/if}
                        {/if}
                        {#if deadlineBadge}
                          <div class="lg:hidden flex items-center gap-1.5 mt-1">
                            <span
                              class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap {deadlineBadge.colorClass}"
                            >
                              {deadlineBadge.dateText}
                            </span>
                            {#if deadlineBadge.timeText}
                              <span
                                class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap {deadlineBadge.timeColorClass}"
                              >
                                {deadlineBadge.timeText}
                              </span>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell
                    style={colResizer.getStyle("groupId")}
                    class="hidden sm:table-cell text-muted-foreground whitespace-nowrap text-xs px-2! overflow-hidden"
                  >
                    {#if group}
                      {@const parentGroup = group.parentId ? taskGroupByIdMap.get(group.parentId) : undefined}
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

                  <TableCell style={colResizer.getStyle("dueDate")} class="hidden sm:table-cell px-2! overflow-hidden">
                    {#if deadlineBadge}
                      <div
                        class="flex items-center gap-1.5 min-w-0"
                        title="{deadlineBadge.dateText}{deadlineBadge.timeText ? ` ${deadlineBadge.timeText}` : ''}"
                      >
                        <span
                          class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap {deadlineBadge.colorClass}"
                        >
                          <span>{deadlineBadge.dateText}</span>
                        </span>
                        {#if deadlineBadge.timeText}
                          <span
                            class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border shrink-0 whitespace-nowrap {deadlineBadge.timeColorClass}"
                          >
                            {deadlineBadge.timeText}
                          </span>
                        {/if}
                      </div>
                    {:else}
                      <span class="text-xs text-muted-foreground/30">-</span>
                    {/if}
                  </TableCell>

                  <TableCell
                    style={colResizer.getStyle("createdAt")}
                    class="hidden md:table-cell text-muted-foreground whitespace-nowrap text-xs px-2! overflow-hidden"
                  >
                    <span class="truncate block">{formatDate(task.createdAt)}</span>
                  </TableCell>

                  <TableCell style={colResizer.getStyle("status")} class="whitespace-nowrap px-2! overflow-hidden">
                    <Button
                      variant={isCompleted ? "success-soft" : "warning-soft"}
                      size="sm"
                      class="w-24 rounded-full! transition-none h-6 text-xs uppercase tracking-wider shrink-0"
                      onclick={(event: MouseEvent) => toggleTaskCompletion(event, task)}
                      ondblclick={(event: MouseEvent) => event.stopPropagation()}
                    >
                      {task.status.replace(UNDERSCORE_REGEX, " ")}
                    </Button>
                  </TableCell>

                  <TableCell style={colResizer.getStyle("actions")} class="text-left pl-3! pr-4! whitespace-nowrap overflow-hidden">
                    <div
                      class="flex items-center justify-start gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100"
                      ondblclick={(event: MouseEvent) => event.stopPropagation()}
                      role="presentation"
                    >
                      <ActionButton
                        variant="edit"
                        icon={Pencil}
                        onClick={(event) => {
                          event.stopPropagation();
                          openModal(task);
                        }}
                        title="Edit task"
                      />

                      <ActionButton
                        variant="delete"
                        icon={Trash2}
                        onClick={(event) => deleteTask(event, task.id)}
                        title="Delete task"
                      />
                    </div>
                  </TableCell>
                </TableRow>
              {/each}
            {/if}
          </TableBody>
        </Table>
      </TableContainer>
    {:else}
      {@render kanbanBoard()}
    {/if}
    </div>
  </PageLayout>

  <ConfirmModal
    bind:isOpen={confirmDialog.isOpen}
    message={confirmDialog.message}
    onConfirm={confirmDialog.onConfirm}
  />
</div>

{#snippet groupsSidebar()}
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
        use:taskGroupReorder.allTargetAction
        class="group/all relative flex items-center w-full rounded-lg text-sm transition-colors {!selectedGroupId
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'} {taskGroupReorder.itemDropGroupId ===
        '__ALL__' || (taskGroupReorder.dragOverGroupId === '__ALL__' && taskGroupReorder.dropPosition === 'inside')
          ? 'bg-primary/20 ring-2 ring-primary text-primary'
          : ''}"
      >
        <button
          type="button"
          class="flex-1 flex items-center {isGroupSidebarOpen
            ? 'px-2'
            : 'px-3'} py-2 rounded-lg text-sm transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] text-left min-w-0 cursor-pointer"
          onclick={() => {
            selectedGroupId = null;
          }}
          title={isGroupSidebarOpen ? undefined : "Tasks"}
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
            Tasks
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
      {#each rootTaskGroups as group (group.id)}
        {@const children = childGroupsByParentIdMap.get(group.id) ?? []}
        {@const hasChildren = children.length > 0}
        {@const isExpanded = expandedParentGroupIds.has(group.id)}
        {@const isDragging = taskGroupReorder.draggedGroupId === group.id}
        {@const isDragOver = taskGroupReorder.dragOverGroupId === group.id}
        {@const isItemDropTarget = taskGroupReorder.itemDropGroupId === group.id}
        {@const isSelected = selectedGroupId === group.id}
        {@const rootDirectCount = taskCountByGroupId.get(group.id) || 0}
        {@const totalGroupCount = rootDirectCount + children.reduce((sum, c) => sum + (taskCountByGroupId.get(c.id) || 0), 0)}

        <div class="flex flex-col w-full">
          <div
            use:taskGroupReorder.elementAction={group.id}
            class="group/item relative flex items-center w-full rounded-lg transition-all duration-150 {isDragging
              ? 'opacity-30 scale-[0.98] border border-dashed border-primary/40'
              : isDragOver
                ? 'border border-primary/40 ring-1 ring-primary/30 bg-primary/15'
                : ''} {isItemDropTarget ? 'bg-primary/20 ring-2 ring-primary' : ''} {isSelected && !isItemDropTarget
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
            role="region"
            aria-label="Task group drop zone"
          >
            {#if isDragOver && taskGroupReorder.dropPosition === "above"}
              <div
                class="absolute top-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
              ></div>
            {/if}
            {#if isDragOver && taskGroupReorder.dropPosition === "below"}
              <div
                class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
              ></div>
            {/if}
            {#if isDragOver && taskGroupReorder.dropPosition === "inside"}
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
                  taskGroupReorder.handleGripPointerDown(
                    event,
                    group.id,
                    sortedRootGroupIds,
                    {
                      allowNest: true,
                      itemLabel: group.name,
                      getGroupName: (gId) => (gId ? taskGroupByIdMap.get(gId)?.name || 'Group' : 'Tasks'),
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
                if (!taskGroupReorder.isPointerDragging) selectedGroupId = group.id;
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
                  title="{totalGroupCount} tasks"
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
                {@const childCount = taskCountByGroupId.get(child.id) || 0}
                {@const isChildDragging = taskGroupReorder.draggedGroupId === child.id}
                {@const isChildDragOver = taskGroupReorder.dragOverGroupId === child.id}
                {@const isChildItemDropTarget = taskGroupReorder.itemDropGroupId === child.id}
                {@const isChildSelected = selectedGroupId === child.id}

                <div
                  use:taskGroupReorder.elementAction={child.id}
                  class="group/child relative flex items-center w-full rounded-md transition-all duration-150 {isChildDragging
                    ? 'opacity-30 scale-[0.98] border border-dashed border-primary/40'
                    : isChildDragOver
                      ? 'border border-primary/40 ring-1 ring-primary/30 bg-primary/15'
                      : ''} {isChildItemDropTarget ? 'bg-primary/20 ring-2 ring-primary' : ''} {isChildSelected && !isChildItemDropTarget
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
                  role="region"
                  aria-label="Child task group drop zone"
                >
                  {#if isChildDragOver && taskGroupReorder.dropPosition === "above"}
                    <div
                      class="absolute top-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
                    ></div>
                  {/if}
                  {#if isChildDragOver && taskGroupReorder.dropPosition === "below"}
                    <div
                      class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
                    ></div>
                  {/if}
                  {#if isChildDragOver && taskGroupReorder.dropPosition === "inside"}
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
                      taskGroupReorder.handleGripPointerDown(
                        event,
                        child.id,
                        children.map((c) => c.id),
                        {
                          allowNest: true,
                          itemLabel: child.name,
                          getGroupName: (gId) => (gId ? taskGroupByIdMap.get(gId)?.name || 'Group' : 'Tasks'),
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
                      if (!taskGroupReorder.isPointerDragging) selectedGroupId = child.id;
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
                        title="{childCount} tasks"
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
{/snippet}

{#snippet kanbanBoard()}
  <div
    class="board-scroll-container flex-1 overflow-x-auto overflow-y-hidden p-4 md:p-5 pb-3 bg-background/50"
    role="region"
    aria-label="Kanban Board"
    ondragover={(e) => {
      if (draggedCardId || draggedColumnId || activeDraggedTaskId) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (e.target === e.currentTarget) {
          dragOverColumnId = null;
        }
      }
    }}
    ondrop={(e) => {
      if (draggedCardId || draggedColumnId || activeDraggedTaskId) {
        e.preventDefault();
      }
      clearSpringExpand();
      for (const autoOpenedId of springExpandedSubIds) {
        collapseSubGroup(autoOpenedId);
      }
      springExpandedSubIds.clear();
      dragOverColumnId = null;
      draggedCardId = null;
      draggedColumnId = null;
      activeDraggedTaskId = null;
    }}
  >
    <div class="flex items-start gap-4 h-full min-w-max pb-2">
      {#if trelloColumns.length === 0}
        <div class="flex flex-col items-center justify-center w-80 h-56 m-auto text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-xl p-6">
          <FolderTree class="w-10 h-10 mb-2 opacity-30 text-indigo-400" />
          <p class="font-semibold text-sm text-foreground/80">No task groups found</p>
          <p class="text-xs text-muted-foreground/70 mt-1">Create a group or add tasks to get started</p>
        </div>
      {:else}
        {#each trelloColumns as col (col.id ?? 'ungrouped')}
          {@const isColDirectDropTarget = dragOverColumnId === (col.id ?? 'ungrouped')}
          <div
            class="w-80 min-w-80 max-w-sm shrink-0 self-start max-h-full flex flex-col rounded-2xl border border-border/70 bg-card/75 dark:bg-card/50 backdrop-blur-sm shadow-xs overflow-hidden transition-all duration-150 {draggedColumnId === col.id ? 'opacity-40 scale-[0.98] border-dashed border-indigo-400' : ''} {isColDirectDropTarget && (draggedCardId || activeDraggedTaskId) ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-500/10 shadow-lg shadow-indigo-500/10' : (isColDirectDropTarget && draggedColumnId !== col.id ? 'ring-2 ring-indigo-500/50 border-indigo-500/40 bg-indigo-500/5' : '')}"
            role="region"
            aria-label="{col.name} Column"
            data-kanban-target-type="column"
            data-kanban-target-id={col.id ?? 'ungrouped'}
            data-kanban-group-id={col.id ?? ''}
          >
            <!-- Column Header (Trello style, clean without top +) -->
            <div
              role="group"
              aria-label={col.name}
              class="px-3 py-2 flex items-center justify-between border-b border-border/40 bg-muted/20 shrink-0 select-none {col.id !== null ? 'cursor-grab active:cursor-grabbing hover:bg-muted/30 transition-colors' : ''}"
              onpointerdown={(e) => handleColumnPointerDown(e, col.id)}
            >
              <div class="flex items-center gap-1.5 min-w-0 flex-1 pointer-events-none">
                {#if col.id === null}
                  <Layers class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                {:else}
                  <FolderOpen class="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                {/if}
                <span class="text-xs font-semibold text-foreground uppercase tracking-wider truncate" title={col.name}>
                  {col.name}
                </span>
              </div>
            </div>

            <!-- Column Body -->
            <div
              class="flex-1 overflow-y-auto p-2.5 space-y-2.5 min-h-0"
              role="region"
              aria-label="Tasks in {col.name}"
              data-kanban-target-type="column"
              data-kanban-target-id={col.id ?? 'ungrouped'}
              data-kanban-group-id={col.id ?? ''}
            >
              {#if col.hasSubGroups}
                <!-- Sub-groups (matching Image 2) -->
                {#each col.subGroups as sub (sub.id)}
                  {@const isSubExpanded = isSubGroupExpanded(sub.id, sub.tasks.length)}
                  {@const isSubDropTarget = dragOverColumnId === sub.id}
                  <div
                    class="flex flex-col rounded-xl border border-border/60 bg-card/60 dark:bg-card/40 overflow-hidden shadow-2xs transition-colors {isSubDropTarget && (draggedCardId || activeDraggedTaskId) ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-500/20 shadow-md shadow-indigo-500/10' : (isSubDropTarget ? 'ring-2 ring-indigo-500/50 border-indigo-500/40 bg-indigo-500/10' : '')}"
                    role="region"
                    aria-label="Sub-group {sub.name}"
                    data-kanban-target-type="subgroup"
                    data-kanban-target-id={sub.id}
                    data-kanban-group-id={sub.id}
                  >
                    <div
                      class="px-3 py-2 flex items-center justify-between w-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer select-none {isSubExpanded ? 'border-b border-border/40 bg-muted/20' : ''} {isSubDropTarget && (draggedCardId || activeDraggedTaskId) ? 'bg-indigo-500/25' : ''}"
                      role="button"
                      tabindex="0"
                      data-kanban-target-type="subgroup"
                      data-kanban-target-id={sub.id}
                      data-kanban-group-id={sub.id}
                      onclick={() => {
                        toggleSubGroupCollapse(sub.id, sub.tasks.length);
                      }}
                      onkeydown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleSubGroupCollapse(sub.id, sub.tasks.length);
                        }
                      }}
                    >
                      <div class="flex items-center gap-1.5 min-w-0 flex-1 mr-2 pointer-events-none">
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
                        <span class="text-xs font-semibold text-foreground/90 truncate" title={sub.name}>{sub.name}</span>
                        <CountBadge count={sub.tasks.length} class="bg-muted text-muted-foreground" />
                      </div>
                      <div class="pointer-events-none flex items-center gap-1.5">
                        {#if !isSubExpanded && isSubDropTarget && (draggedCardId || activeDraggedTaskId)}
                          <span class="text-xs font-bold px-1.5 py-0.5 rounded bg-indigo-500 text-white leading-none animate-pulse">
                            Drop here
                          </span>
                        {/if}
                        {#if !isSubExpanded}
                          <ChevronDown class="w-3.5 h-3.5 text-muted-foreground" />
                        {:else}
                          <ChevronUp class="w-3.5 h-3.5 text-muted-foreground" />
                        {/if}
                      </div>
                    </div>

                    {#if isSubExpanded}
                      <div
                        class="flex flex-col p-2 gap-2 min-h-6.5"
                        role="region"
                        aria-label="Tasks in {sub.name}"
                        data-kanban-target-type="subgroup"
                        data-kanban-target-id={sub.id}
                        data-kanban-group-id={sub.id}
                      >
                        {#if (draggedCardId || activeDraggedTaskId) && isSubDropTarget}
                          <div
                            class="p-2.5 rounded-lg border-2 border-dashed border-indigo-500 bg-indigo-500/15 flex items-center justify-center text-xs font-semibold text-indigo-400 gap-1.5 animate-pulse select-none"
                            role="region"
                            aria-label="Drop to move to {sub.name}"
                          >
                            <Plus class="w-3.5 h-3.5 text-indigo-400 pointer-events-none" />
                            <span class="pointer-events-none">Drop to move to {sub.name}</span>
                          </div>
                        {/if}
                        {#if sub.tasks.length === 0 && !draggedCardId && !activeDraggedTaskId}
                          <p class="text-center py-2 text-xs text-muted-foreground/60 italic">No tasks</p>
                        {:else}
                          {#each sub.tasks as task (task.id)}
                            {@render trelloTaskCard(task)}
                          {/each}
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}

                <!-- Direct tasks in root group if any -->
                {#if col.directTasks.length > 0}
                  {@const isDirectExpanded = isSubGroupExpanded(`${col.id}-direct`, col.directTasks.length)}
                  {@const isDirectDropTarget = dragOverColumnId === `${col.id}-direct`}
                  <div
                    class="flex flex-col rounded-xl border border-border/60 bg-card/60 dark:bg-card/40 overflow-hidden shadow-2xs transition-colors {isDirectDropTarget && (draggedCardId || activeDraggedTaskId) ? 'ring-2 ring-indigo-500 border-indigo-500 bg-indigo-500/20 shadow-md shadow-indigo-500/10' : (isDirectDropTarget ? 'ring-2 ring-indigo-500/50 border-indigo-500/40 bg-indigo-500/10' : '')}"
                    role="region"
                    aria-label="General Tasks in {col.name}"
                    data-kanban-target-type="direct"
                    data-kanban-target-id="{col.id}-direct"
                    data-kanban-group-id={col.id ?? ''}
                  >
                    <div
                      class="px-3 py-2 flex items-center justify-between w-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer select-none {isDirectExpanded ? 'border-b border-border/40 bg-muted/20' : ''} {isDirectDropTarget && (draggedCardId || activeDraggedTaskId) ? 'bg-indigo-500/25' : ''}"
                      role="button"
                      tabindex="0"
                      data-kanban-target-type="direct"
                      data-kanban-target-id="{col.id}-direct"
                      data-kanban-group-id={col.id ?? ''}
                      onclick={() => {
                        toggleSubGroupCollapse(`${col.id}-direct`, col.directTasks.length);
                      }}
                      onkeydown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleSubGroupCollapse(`${col.id}-direct`, col.directTasks.length);
                        }
                      }}
                    >
                      <div class="flex items-center gap-1.5 min-w-0 flex-1 mr-2 pointer-events-none">
                        <Layers class="w-3.5 h-3.5 text-indigo-400/80 shrink-0" />
                        <span class="text-xs font-semibold text-foreground/80 truncate">General Tasks</span>
                        <CountBadge count={col.directTasks.length} class="bg-muted text-muted-foreground" />
                      </div>
                      <div class="pointer-events-none flex items-center gap-1.5">
                        {#if !isDirectExpanded && isDirectDropTarget && (draggedCardId || activeDraggedTaskId)}
                          <span class="text-xs font-bold px-1.5 py-0.5 rounded bg-indigo-500 text-white leading-none animate-pulse">
                            Drop here
                          </span>
                        {/if}
                        {#if !isDirectExpanded}
                          <ChevronDown class="w-3.5 h-3.5 text-muted-foreground" />
                        {:else}
                          <ChevronUp class="w-3.5 h-3.5 text-muted-foreground" />
                        {/if}
                      </div>
                    </div>

                    {#if isDirectExpanded}
                      <div
                        class="flex flex-col p-2 gap-2 min-h-6.5"
                        role="region"
                        aria-label="Direct tasks in {col.name}"
                        data-kanban-target-type="direct"
                        data-kanban-target-id="{col.id}-direct"
                        data-kanban-group-id={col.id ?? ''}
                      >
                        {#if (draggedCardId || activeDraggedTaskId) && isDirectDropTarget}
                          <div
                            class="p-2.5 rounded-lg border-2 border-dashed border-indigo-500 bg-indigo-500/15 flex items-center justify-center text-xs font-semibold text-indigo-400 gap-1.5 animate-pulse select-none"
                            role="region"
                            aria-label="Drop to move to General Tasks in {col.name}"
                          >
                            <Plus class="w-3.5 h-3.5 text-indigo-400 pointer-events-none" />
                            <span class="pointer-events-none">Drop to move to General Tasks</span>
                          </div>
                        {/if}
                        {#each col.directTasks as task (task.id)}
                          {@render trelloTaskCard(task)}
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              {:else}
                <!-- Flat Root Group Tasks (matching Image 2) -->
                {#if (draggedCardId || activeDraggedTaskId) && isColDirectDropTarget}
                  <div
                    class="p-3 rounded-xl border-2 border-dashed border-indigo-500 bg-indigo-500/15 flex items-center justify-center text-xs font-semibold text-indigo-400 gap-2 animate-pulse transition-all select-none"
                    role="region"
                    aria-label="Drop to move to {col.name}"
                  >
                    <Plus class="w-4 h-4 text-indigo-400 pointer-events-none" />
                    <span class="pointer-events-none">Drop to move to {col.name}</span>
                  </div>
                {/if}
                {#if col.directTasks.length === 0 && !draggedCardId && !activeDraggedTaskId}
                  <div class="flex flex-col items-center justify-center py-4 text-center text-xs text-muted-foreground border border-dashed border-border/40 rounded-xl">
                    <p class="text-xs text-muted-foreground/50">No tasks</p>
                  </div>
                {:else}
                  {#each col.directTasks as task (task.id)}
                    {@render trelloTaskCard(task)}
                  {/each}
                {/if}
              {/if}
            </div>

            <!-- Column Footer (+ Add card - standard Trello position) -->
            <div
              class="p-2 border-t border-border/20 bg-muted/10 shrink-0"
              role="region"
              aria-label="Add card to {col.name}"
              data-kanban-target-type="column"
              data-kanban-target-id={col.id ?? 'ungrouped'}
              data-kanban-group-id={col.id ?? ''}
            >
              <button
                type="button"
                class="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer text-left"
                onclick={() => openModalWithGroup(col.id)}
              >
                <Plus class="w-3.5 h-3.5" />
                <span>Add card</span>
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Floating Card Drag Preview -->
    {#if isBoardPointerDragging && boardPointerDragTask}
      <div
        class="fixed pointer-events-none z-[99999] px-3.5 py-2.5 rounded-xl bg-card/95 backdrop-blur-md border border-indigo-500/80 shadow-2xl flex items-center gap-2.5 max-w-xs text-xs font-semibold text-foreground will-change-transform ring-2 ring-indigo-500/30"
        style="left: {boardPointerPos.x + 12}px; top: {boardPointerPos.y + 12}px;"
      >
        <GripVertical class="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <span class="truncate">{boardPointerDragTask.title}</span>
        {#if boardPointerTarget}
          <span class="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 font-medium leading-none shrink-0">
            Move
          </span>
        {/if}
      </div>
    {/if}

    <!-- Floating Column Reorder Preview -->
    {#if isColPointerDragging && colPointerSourceId}
      {@const colName = rootTaskGroups.find(g => g.id === colPointerSourceId)?.name || 'Column'}
      <div
        class="fixed pointer-events-none z-[99999] px-3.5 py-2 rounded-xl bg-card/95 backdrop-blur-md border border-indigo-500/80 shadow-2xl flex items-center gap-2 text-xs font-semibold text-foreground will-change-transform ring-2 ring-indigo-500/30"
        style="left: {colPointerPos.x + 12}px; top: {colPointerPos.y + 12}px;"
      >
        <FolderOpen class="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <span class="truncate">{colName}</span>
        <span class="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 font-medium leading-none shrink-0">
          Reorder
        </span>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet trelloTaskCard(task: Task)}
  {@const isCompleted = task.status === "COMPLETED"}
  {@const badges = getTaskDueBadges(task.dueDate)}
  {@const isBeingDragged = (draggedCardId === task.id || activeDraggedTaskId === task.id)}

  <div
    role="button"
    tabindex="0"
    onpointerdown={(e) => handleCardPointerDown(e, task)}
    class="group/card relative flex items-start text-left gap-2 w-full p-2.5 rounded-xl bg-card border border-border/60 hover:border-indigo-500/50 hover:shadow-xs transition-all duration-150 cursor-grab active:cursor-grabbing select-none {isBeingDragged ? 'opacity-40 scale-[0.98] border-dashed border-indigo-400 ring-2 ring-indigo-500/20' : ''}"
    onclick={(e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, [data-no-modal], input, textarea, a')) return;
      toggleTaskCompletion(e, task);
    }}
    ondblclick={(e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, [data-no-modal], input, textarea, a')) return;
      openModal(task);
    }}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleTaskCompletion(e, task);
      }
    }}
  >
    <!-- Circle Checkbox -->
    <button
      type="button"
      class="shrink-0 mt-0.5 p-1 rounded-full hover:bg-muted/80 transition-all cursor-pointer {isCompleted ? 'text-indigo-500 hover:text-indigo-600' : 'text-muted-foreground hover:text-indigo-400'}"
      draggable={false}
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleTaskCompletion(e, task);
      }}
      title={isCompleted ? "Mark incomplete" : "Mark complete"}
      aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
    >
      {#if isCompleted}
        <CheckCircle class="w-4 h-4 pointer-events-none" />
      {:else}
        <Circle class="w-4 h-4 pointer-events-none" />
      {/if}
    </button>

    <!-- Task Content -->
    <div class="flex-1 min-w-0 flex flex-col gap-1.5 pointer-events-none">
      <div class="flex items-start justify-between gap-2 min-h-5.5">
        <p class="text-xs sm:text-sm font-medium leading-normal break-words flex-1 {isCompleted ? 'text-muted-foreground/70 line-through' : 'text-foreground'}">
          {task.title}
        </p>

        <div class="flex items-center gap-1 shrink-0 pointer-events-auto">
          {#if task.description}
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border font-medium text-indigo-400 bg-indigo-500/10 border-indigo-500/20 hover:bg-indigo-500/25 hover:border-indigo-500/40 transition-colors cursor-pointer"
              draggable={false}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                openTaskNoteModal(e, task);
              }}
              title="View and edit note"
            >
              <FileText class="w-3 h-3 text-indigo-400 shrink-0 pointer-events-none" />
              <span>Note</span>
            </button>
          {/if}

          <!-- Edit button -->
          <button
            type="button"
            class="p-1 rounded-md text-muted-foreground/60 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors cursor-pointer"
            draggable={false}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              openModal(task);
            }}
            title="Edit task"
            aria-label="Edit task"
          >
            <Pencil class="w-3.5 h-3.5 pointer-events-none" />
          </button>

          <!-- Delete button -->
          <button
            type="button"
            class="p-1 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            draggable={false}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              deleteTask(e, task.id);
            }}
            title="Delete task"
            aria-label="Delete task"
          >
            <Trash2 class="w-3.5 h-3.5 pointer-events-none" />
          </button>
        </div>
      </div>

      <!-- Badges Row: Only countdown timer (e.g. 41m left), full date & time on hover tooltip -->
      {#if task.dueDate && !isCompleted}
        <div
          class="flex items-center gap-1.5 flex-wrap pointer-events-auto"
          title="{badges.dateStr || ''}{badges.timeStr ? ` ${badges.timeStr}` : ''}"
        >
          <TaskCountdown dueDate={task.dueDate} />
        </div>
      {:else if isCompleted && task.dueDate}
        <div
          class="flex items-center gap-1.5 pointer-events-auto"
          title="{badges.dateStr || ''}{badges.timeStr ? ` ${badges.timeStr}` : ''}"
        >
          <button
            type="button"
            class="text-xs px-2 py-0.5 rounded-full border font-medium text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 transition-colors cursor-pointer"
            title="Click to mark incomplete"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              toggleTaskCompletion(e, task);
            }}
          >
            Completed
          </button>
        </div>
      {/if}
    </div>
  </div>
{/snippet}

<FormModal
  bind:isOpen={isModalOpen}
  isDirty={isTaskFormDirty}
  title={editingTask ? "Edit Task" : "New Task"}
  submitText={editingTask ? "Save" : "Create"}
  submitDisabled={!isTaskFormValid}
  onSubmit={onSubmit}
>
  <div class="space-y-4">
    <FormField label="Task Name">
      <Input
        bind:value={formTitle}
        placeholder="Enter task title..."
        maxlength={MAX_TASK_TITLE_LENGTH}
        required
      />
    </FormField>

    <FormField label="Deadline">
      <div class="space-y-2 w-full">
        <div class="flex items-center gap-2 w-full">
          <div class="flex-1 min-w-0">
            <DatePicker bind:value={formDueDate} placeholder="Select date..." />
          </div>
          <div class="flex-1 min-w-0">
            <TimePicker
              bind:value={formDueTime}
              placeholder="Select time..."
              disabled={!formDueDate}
            />
          </div>
        </div>

        <!-- Quick Deadline Presets -->
        <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span class="text-xs font-medium text-muted-foreground mr-1">Quick:</span>
          <button
            type="button"
            class="px-2 py-0.5 rounded text-xs border border-border/60 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-400 transition-colors cursor-pointer"
            onclick={() => setQuickDeadline(0)}
          >
            Today
          </button>
          <button
            type="button"
            class="px-2 py-0.5 rounded text-xs border border-border/60 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-400 transition-colors cursor-pointer"
            onclick={() => setQuickDeadline(1)}
          >
            Tomorrow
          </button>
          <button
            type="button"
            class="px-2 py-0.5 rounded text-xs border border-border/60 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-400 transition-colors cursor-pointer"
            onclick={() => setQuickDeadline(3)}
          >
            +3 Days
          </button>
          <button
            type="button"
            class="px-2 py-0.5 rounded text-xs border border-border/60 hover:border-indigo-500/50 hover:bg-indigo-500/10 text-muted-foreground hover:text-indigo-400 transition-colors cursor-pointer"
            onclick={() => setQuickDeadline(7)}
          >
            +1 Week
          </button>
        </div>
      </div>
    </FormField>

    <FormField label="Group / Project">
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
          class="w-full max-w-full min-w-48 max-h-56 overflow-y-auto overflow-x-hidden"
        >
          {#if scopedRootGroupId === "ungrouped"}
            <DropdownMenuItem
              onclick={(event) => {
                event.preventDefault();
                formGroupId = null;
              }}
              class="bg-accent font-medium text-primary"
            >
              <span class="truncate block w-full text-left">No Group</span>
            </DropdownMenuItem>
          {:else}
            {@const activeRoots = scopedRootGroupId
              ? rootTaskGroups.filter((g) => g.id === scopedRootGroupId)
              : rootTaskGroups}

            {#if !scopedRootGroupId}
              <DropdownMenuItem
                onclick={(event) => {
                  event.preventDefault();
                  formGroupId = null;
                }}
                class={formGroupId === null ? "bg-accent font-medium text-primary" : ""}
              >
                <span class="truncate block w-full text-left">No Group</span>
              </DropdownMenuItem>
            {/if}

            {#each activeRoots as rootGroup (rootGroup.id)}
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
          {/if}
        </DropdownMenuContent>
      </DropdownMenu>
    </FormField>

    <FormField label="Task Note">
      {#if formDescription.trim()}
        <div class="flex items-center justify-between p-3 rounded-xl border border-input bg-muted/20 gap-3">
          <div class="flex items-center gap-2 min-w-0 flex-1 text-xs">
            <span class="truncate text-foreground font-medium">{formDescription.trim().split('\n')[0]}</span>
            <span class="text-xs px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shrink-0">
              {formDescription.length} chars
            </span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="h-7 px-2.5 text-xs gap-1"
              onclick={openNoteFromForm}
            >
              <Pencil class="w-3 h-3" />
              Edit Note
            </Button>
            <button
              type="button"
              class="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              onclick={() => (formDescription = "")}
              title="Delete note"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      {:else}
        <button
          type="button"
          class="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-dashed border-input hover:border-indigo-500/50 bg-black/5 dark:bg-white/5 hover:bg-indigo-500/5 text-muted-foreground hover:text-foreground text-xs font-medium transition-all cursor-pointer group"
          onclick={openNoteFromForm}
        >
          <div class="flex items-center gap-2">
            <span>Add detailed note (Markdown)</span>
          </div>
          <span class="text-xs text-muted-foreground/60 group-hover:text-indigo-400 transition-colors">
            Open Editor ↗
          </span>
        </button>
      {/if}
    </FormField>
  </div>
</FormModal>

<FormModal
  bind:isOpen={isGroupModalOpen}
  isDirty={isGroupFormDirty}
  title={editingGroup ? "Edit Group" : "New Group"}
  submitText={editingGroup ? "Save" : "Create"}
  submitDisabled={!formGroupName.trim()}
  onSubmit={onGroupSubmit}
>
  <div class="space-y-4">
    <FormField label="Group Name">
      <Input
        bind:value={formGroupName}
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
            Top-level container. Can hold tasks and sub-groups.
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
              {#each eligibleParentGroups as parentOption (parentOption.id)}
                <DropdownMenuItem
                  onclick={() => {
                    formGroupParentId = parentOption.id;
                  }}
                  class={formGroupParentId === parentOption.id ? "bg-accent font-medium text-primary" : ""}
                >
                  <span class="truncate block w-full text-left">{parentOption.name}</span>
                </DropdownMenuItem>
              {/each}
            </DropdownMenuContent>
          </DropdownMenu>
          <span class="text-xs text-muted-foreground mt-1 block">
            Select the parent Root Group to nest under.
          </span>
        {/if}
      </FormField>
    {/if}

    {#if isEditingGroupParent}
      <div class="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-500 flex flex-col gap-1">
        <span class="font-medium">Active Root Group</span>
        <span class="text-muted-foreground text-xs">
          This group already contains sub-groups. Under the 2-level hierarchy limit, it cannot become a sub-group.
        </span>
      </div>
    {/if}
  </div>
</FormModal>

<TaskNoteModal
  bind:isOpen={isNoteModalOpen}
  task={noteModalTask}
  group={noteModalTask?.groupId ? taskGroupByIdMap.get(noteModalTask.groupId) : undefined}
/>

<TaskNoteModal
  bind:isOpen={isFormNoteModalOpen}
  task={formNoteTask}
  group={formGroupId ? taskGroupByIdMap.get(formGroupId) : undefined}
  onSave={async (newContent) => {
    formDescription = newContent ?? "";
    if (editingTask) {
      await taskStore.updateTask(editingTask.id, { description: newContent });
    }
  }}
/>

<style>
  :global(.board-scroll-container) {
    scrollbar-width: thin;
    scrollbar-color: rgba(140, 140, 160, 0.4) transparent;
  }
  :global(.board-scroll-container::-webkit-scrollbar) {
    display: block !important;
    height: 0.5625rem !important;
  }
  :global(.board-scroll-container::-webkit-scrollbar-track) {
    background: rgba(0, 0, 0, 0.08);
    border-radius: 9999px;
    margin: 0 1rem 2px 1rem;
  }
  :global(.dark .board-scroll-container::-webkit-scrollbar-track) {
    background: rgba(255, 255, 255, 0.04);
  }
  :global(.board-scroll-container::-webkit-scrollbar-thumb) {
    background: rgba(140, 140, 160, 0.45);
    border-radius: 9999px;
    transition: background-color 0.2s ease;
  }
  :global(.board-scroll-container::-webkit-scrollbar-thumb:hover) {
    background: rgba(99, 102, 241, 0.7);
  }
</style>

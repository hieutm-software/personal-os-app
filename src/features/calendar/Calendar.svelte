<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { slide } from "svelte/transition";
  import {
    Calendar,
    CalendarDays,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Eye,
    FolderTree,
    GripVertical,
    LayoutList,
    Lock,
    Pencil,
    Plus,
    PlusCircle,
    Repeat,
    Trash2,
    X,
  } from "lucide-svelte";
  import type { Event, EventGroup } from "../../shared/db/schema";
  import { eventStore } from "../../shared/eventStore.svelte";
  import { toastState } from "../../shared/toast.svelte";
  import ActionButton from "../../shared/ui/ActionButton.svelte";
  import { createResizableSidebar } from "../../shared/utils/resizableSidebar.svelte";
  import Button from "../../shared/ui/Button.svelte";
  import CountBadge from "../../shared/ui/CountBadge.svelte";
  import ConfirmModal from "../../shared/ui/ConfirmModal.svelte";
  import DatePicker from "../../shared/ui/DatePicker.svelte";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from "../../shared/ui/dropdown";
  import EmptyState from "../../shared/ui/EmptyState.svelte";
  import FormField from "../../shared/ui/FormField.svelte";
  import FormModal from "../../shared/ui/FormModal.svelte";
  import Input from "../../shared/ui/Input.svelte";
  import PageLayout from "../../shared/ui/PageLayout.svelte";
  import SearchBar from "../../shared/ui/SearchBar.svelte";
  import SortIcon from "../../shared/ui/SortIcon.svelte";
  import Switch from "../../shared/ui/Switch.svelte";
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
  import Textarea from "../../shared/ui/Textarea.svelte";
  import TimePicker from "../../shared/ui/TimePicker.svelte";
  import Toolbar from "../../shared/ui/Toolbar.svelte";
  import { formatDate, parseLocalDate } from "../../shared/utils/format";
  import { createPointerReorder } from "../../shared/utils/pointerReorder.svelte";
  import { getNextSelection, getNextSort } from "../../shared/utils/table";
  import { fetchICalAndSync } from "./icalSync";
  import { formatDateKey } from "./eventOccurrence";
  import { uiPreferenceRepo } from "../../shared/db/repo/uiPreferenceRepo";

  type SortField =
    | "title"
    | "createdAt"
    | "date"
    | "endDate"
    | "recurrence"
    | "groupId";

  interface GridDayCell {
    date: Date;
    key: string;
    dayTimeMs: number;
    year: number;
    month: number;
    dayOfMonth: number;
    dayOfWeek: number;
    daysInMonth: number;
    isLeapYear: boolean;
    dayLabelPadded: string;
    isCurrentMonth: boolean;
  }

  interface CachedEventMetadata {
    event: Event;
    rawStartTime: string | null;
    rawEndTime: string | null;
    rawIsAllDay: boolean;
    rawTitle: string;
    rawDescription: string | null;
    rawCreatedAt: number;
    hasValidStart: boolean;
    startDayTimeMs: number;
    endDayTimeMs: number;
    sortStartMs: number;
    sortEndMs: number;
    startMonth: number;
    startDayOfMonth: number;
    startDayOfWeek: number;
    startDateBadge: string | null;
    startTimeBadge: string | null;
    endDateBadge: string | null;
    endTimeBadge: string | null;
    lowerTitle: string;
    lowerDescription: string;
    isGoogleSource: boolean;
  }

  interface DayEventsSummary {
    dayEvents: Event[];
    normalEvents: Event[];
    hasNormal: boolean;
    hasRecurring: boolean;
    eventsCount: number;
  }

  const EMPTY_DAY_SUMMARY: DayEventsSummary = {
    dayEvents: [],
    normalEvents: [],
    hasNormal: false,
    hasRecurring: false,
    eventsCount: 0,
  };

  const RECURRENCE_LABELS: Record<string, string> = {
    NONE: "No repeat",
    DAILY: "Daily",
    WEEKLY: "Weekly",
    MONTHLY: "Monthly",
    YEARLY: "Yearly",
  };

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ] as const;

  const MAX_TITLE_LENGTH = 255;
  const MAX_DESCRIPTION_LENGTH = 5000;
  const MAX_GROUP_NAME_LENGTH = 100;

  const badgeDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const eventMetadataCache = new WeakMap<Event, CachedEventMetadata>();

  let isMounted = true;

  let viewMode = $state<"grid" | "list">("grid");
  let currentMonth = $state(new Date());
  let selectedDate = $state<Date | null>(null);

  let isModalOpen = $state(false);
  let editingEvent = $state<Event | null>(null);
  let formTitle = $state("");
  let formDesc = $state("");
  let formStartTime = $state("");
  let formEndTime = $state("");
  let formIsMultiDay = $state(false);
  let formStartDate = $state("");
  let formEndDate = $state("");
  let formRecurrence = $state("NONE");

  let searchQuery = $state("");
  let sortKey = $state<SortField>("createdAt");
  let sortDirection = $state<"asc" | "desc">("desc");
  let selectedEventIds = $state<Set<string>>(new Set());
  let lastSelectedEventId: string | null = null;

  let icalName = $state("Google Calendar");
  let hasICalUrl = $state(false);

  let isGroupSidebarOpen = $state(true);
  const groupSidebar = createResizableSidebar();
  const colResizer = createResizableColumns({
    storageKey: "personal_os_calendar_col_widths_v5",
    columns: {
      title: { defaultWidth: 185, minWidth: 140 },
      groupId: { defaultWidth: 125, minWidth: 90 },
      date: { defaultWidth: 160, minWidth: 145 },
      endDate: { defaultWidth: 160, minWidth: 145 },
      createdAt: { defaultWidth: 96, minWidth: 88 },
      actions: { defaultWidth: 104, minWidth: 104, maxWidth: 104 },
    },
  });
  let selectedGroupId = $state<string | null>(null);

  const eventGroupReorder = createPointerReorder("personal_os_event_group_order");
  let sortedEventGroups = $derived.by(() => {
    const all = eventStore.eventGroups;
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const unique: EventGroup[] = [];
    for (let i = 0; i < all.length; i++) {
      const g = all[i];
      const lower = g.name.trim().toLowerCase();
      if (!seenIds.has(g.id) && !seenNames.has(lower)) {
        seenIds.add(g.id);
        seenNames.add(lower);
        unique.push(g);
      }
    }
    return eventGroupReorder.sortItems(unique);
  });
  let sortedEventGroupIds = $derived(sortedEventGroups.map((group) => group.id));

  let eventGroupById = $derived.by(() => {
    const map = new Map<string, EventGroup>();
    const groups = eventStore.eventGroups;
    for (let i = 0, len = groups.length; i < len; i++) {
      const group = groups[i];
      if (group?.id) {
        map.set(group.id, group);
      }
    }
    return map;
  });

  let editableEventGroups = $derived.by(() =>
    eventStore.eventGroups.filter((group) => group.id !== "GOOGLE_CALENDAR")
  );

  let eventById = $derived.by(() => {
    const map = new Map<string, Event>();
    const events = eventStore.events;
    for (let i = 0, len = events.length; i < len; i++) {
      const ev = events[i];
      if (ev?.id) {
        map.set(ev.id, ev);
      }
    }
    return map;
  });

  let draggedEventIdSet = $derived(new Set(eventGroupReorder.draggedItemIds));

  let hasGoogleEvents = $derived.by(() => {
    const events = eventStore.events;
    for (let i = 0, len = events.length; i < len; i++) {
      if (events[i]?.source?.startsWith("GOOGLE")) return true;
    }
    return false;
  });

  let eventCountByGroupId = $derived.by(() => {
    const counts = new Map<string, number>();
    const all = eventStore.events;
    for (let i = 0; i < all.length; i++) {
      const gid = all[i].groupId;
      if (gid) {
        counts.set(gid, (counts.get(gid) || 0) + 1);
      }
    }
    return counts;
  });

  let googleEventsCount = $derived(
    eventStore.events.filter((e) => e.source?.startsWith("GOOGLE") || e.groupId === "GOOGLE_CALENDAR").length
  );

  let isGroupModalOpen = $state(false);
  let formGroupName = $state("");
  let editingGroup = $state<{ id: string; name: string } | null>(null);
  let formGroupId = $state<string | null>(null);

  let confirmDialog = $state({
    isOpen: false,
    message: "",
    onConfirm: async () => {},
  });

  let endDateInputRef: HTMLInputElement | null = $state(null);
  let endTimeInputRef: HTMLInputElement | null = $state(null);

  let focusedGridIndex = $state(0);
  let gridCellRefs = $state<(HTMLButtonElement | null)[]>([]);

  function sanitizeInputText(rawValue: string, maxLength: number): string {
    if (typeof rawValue !== "string") return "";
    return rawValue
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim()
      .slice(0, maxLength);
  }

  function isLeapYearNumber(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  function getDaysInYearMonth(year: number, monthIndex: number): number {
    if (monthIndex === 1) {
      return isLeapYearNumber(year) ? 29 : 28;
    }
    if (
      monthIndex === 3 ||
      monthIndex === 5 ||
      monthIndex === 8 ||
      monthIndex === 10
    ) {
      return 30;
    }
    return 31;
  }

  function safeParseDate(val: string | number | null | undefined): Date | null {
    if (!val) return null;
    if (typeof val === "string" && !val.includes("T")) {
      const localDate = parseLocalDate(val);
      return Number.isNaN(localDate.getTime()) ? null : localDate;
    }
    const parsed = new Date(val);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatTimeStringFromDate(
    rawIsoStr: string | null | undefined,
    parsedDate: Date | null,
    isAllDay: boolean
  ): string | null {
    if (!rawIsoStr || isAllDay || !rawIsoStr.includes("T") || !parsedDate) {
      return null;
    }
    const hours = String(parsedDate.getHours()).padStart(2, "0");
    const minutes = String(parsedDate.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  function getEventMetadata(ev: Event): CachedEventMetadata {
    const rawStartTime = ev.startTime ?? null;
    const rawEndTime = ev.endTime ?? null;
    const rawIsAllDay = Boolean(ev.isAllDay);
    const rawTitle = ev.title ?? "";
    const rawDescription = ev.description ?? null;
    const rawCreatedAt = ev.createdAt ?? 0;

    const cached = eventMetadataCache.get(ev);
    if (
      cached &&
      cached.rawStartTime === rawStartTime &&
      cached.rawEndTime === rawEndTime &&
      cached.rawIsAllDay === rawIsAllDay &&
      cached.rawTitle === rawTitle &&
      cached.rawDescription === rawDescription &&
      cached.rawCreatedAt === rawCreatedAt
    ) {
      return cached;
    }

    const startD = safeParseDate(rawStartTime);
    const endD = safeParseDate(rawEndTime);
    const fallbackStart =
      startD || (rawCreatedAt ? safeParseDate(rawCreatedAt) : null);
    const effectiveEnd = endD || fallbackStart;

    let hasValidStart = false;
    let startDayTimeMs = 0;
    let endDayTimeMs = 0;
    let startMonth = 0;
    let startDayOfMonth = 1;
    let startDayOfWeek = 0;

    if (fallbackStart) {
      hasValidStart = true;
      startMonth = fallbackStart.getMonth();
      startDayOfMonth = fallbackStart.getDate();
      startDayOfWeek = fallbackStart.getDay();
      startDayTimeMs = new Date(
        fallbackStart.getFullYear(),
        startMonth,
        startDayOfMonth
      ).getTime();
    }

    if (effectiveEnd) {
      endDayTimeMs = new Date(
        effectiveEnd.getFullYear(),
        effectiveEnd.getMonth(),
        effectiveEnd.getDate()
      ).getTime();
    } else {
      endDayTimeMs = startDayTimeMs;
    }

    const sortStartMs = startD ? startD.getTime() : rawCreatedAt;
    const sortEndMs = endD
      ? endD.getTime()
      : startD
        ? startD.getTime()
        : Number.MAX_SAFE_INTEGER;

    const startDateBadge = startD ? badgeDateFormatter.format(startD) : null;
    const startTimeBadge = formatTimeStringFromDate(
      rawStartTime,
      startD,
      rawIsAllDay
    );

    const badgeEndDateObj = endD || startD;
    const endDateBadge = badgeEndDateObj
      ? badgeDateFormatter.format(badgeEndDateObj)
      : null;
    const endTimeBadge = formatTimeStringFromDate(rawEndTime, endD, rawIsAllDay);

    const metadata: CachedEventMetadata = {
      event: ev,
      rawStartTime,
      rawEndTime,
      rawIsAllDay,
      rawTitle,
      rawDescription,
      rawCreatedAt,
      hasValidStart,
      startDayTimeMs,
      endDayTimeMs,
      sortStartMs,
      sortEndMs,
      startMonth,
      startDayOfMonth,
      startDayOfWeek,
      startDateBadge,
      startTimeBadge,
      endDateBadge,
      endTimeBadge,
      lowerTitle: rawTitle.toLowerCase(),
      lowerDescription: rawDescription ? rawDescription.toLowerCase() : "",
      isGoogleSource: Boolean(ev.source?.startsWith("GOOGLE")),
    };

    eventMetadataCache.set(ev, metadata);
    return metadata;
  }

  function doesEventMetadataOccurOnDay(
    meta: CachedEventMetadata,
    dayTimeMs: number,
    dayYear: number,
    dayMonth: number,
    dayOfMonth: number,
    dayOfWeek: number,
    daysInTargetMonth: number
  ): boolean {
    if (!meta.hasValidStart) return false;
    const recurrence = meta.event.recurrence;

    if (!recurrence || recurrence === "NONE") {
      return dayTimeMs >= meta.startDayTimeMs && dayTimeMs <= meta.endDayTimeMs;
    }

    if (dayTimeMs < meta.startDayTimeMs) return false;

    if (recurrence === "DAILY") return true;
    if (recurrence === "WEEKLY") return meta.startDayOfWeek === dayOfWeek;
    if (recurrence === "MONTHLY") {
      const targetDay = Math.min(meta.startDayOfMonth, daysInTargetMonth);
      return dayOfMonth === targetDay;
    }
    if (recurrence === "YEARLY") {
      if (meta.startMonth !== dayMonth) return false;
      if (
        meta.startMonth === 1 &&
        meta.startDayOfMonth === 29 &&
        !isLeapYearNumber(dayYear)
      ) {
        return dayOfMonth === 28;
      }
      return meta.startDayOfMonth === dayOfMonth;
    }
    return false;
  }

  $effect(() => {
    formStartDate;
    formEndDate;
    formIsMultiDay;
    formStartTime;
    formEndTime;
    try {
      if (endDateInputRef) {
        endDateInputRef.setCustomValidity("");
      }
      if (endTimeInputRef) {
        endTimeInputRef.setCustomValidity("");
      }
    } catch {}
  });

  let isViewOnlyEvent = $derived(
    Boolean(
      editingEvent?.source?.startsWith("GOOGLE") ||
        editingEvent?.groupId === "GOOGLE_CALENDAR"
    )
  );

  function setFormRecurrence(val: string): void {
    try {
      if (isViewOnlyEvent) return;
      formRecurrence = val;
      if (val !== "NONE") {
        formIsMultiDay = false;
        formEndDate = formStartDate;
      }
    } catch {}
  }

  $effect(() => {
    try {
      if (selectedEventIds.size === 0) return;
      const validIds = eventById;
      let needsPrune = false;
      for (const id of selectedEventIds) {
        if (!validIds.has(id)) {
          needsPrune = true;
          break;
        }
      }
      if (needsPrune) {
        const next = new Set<string>();
        for (const id of selectedEventIds) {
          if (validIds.has(id)) next.add(id);
        }
        selectedEventIds = next;
      }
    } catch {}
  });

  $effect(() => {
    try {
      if (!isModalOpen) resetForm();
    } catch {}
  });

  function readSyncedICalUrls(): string[] {
    try {
      const raw = localStorage.getItem("synced_ical_urls");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      );
    } catch {
      return [];
    }
  }

  onMount(() => {
    const handleShortcut = (): void => {
      openModal(null);
    };

    const handleStorage = (storageEvent: StorageEvent): void => {
      try {
        if (
          storageEvent.key === "synced_ical_urls" ||
          storageEvent.key === "google_ical_url"
        ) {
          const urls = readSyncedICalUrls();
          const legacy = localStorage.getItem("google_ical_url");
          hasICalUrl = urls.length > 0 || Boolean(legacy);
        }
      } catch {}
    };

    window.addEventListener("shortcut-new-event", handleShortcut);
    window.addEventListener("storage", handleStorage);

    try {
      if (!eventStore.isInitialized) {
        eventStore.fetchAll().catch(() => {});
      }
      const storedName = localStorage.getItem("personal-os-ical-name");
      if (storedName) {
        icalName = storedName;
      }

      const syncedUrls = readSyncedICalUrls();
      for (let i = 0, len = syncedUrls.length; i < len; i++) {
        fetchICalAndSync(syncedUrls[i], true).catch(() => {});
      }

      const legacy = localStorage.getItem("google_ical_url");
      hasICalUrl = syncedUrls.length > 0 || Boolean(legacy);
    } catch {}

    return () => {
      window.removeEventListener("shortcut-new-event", handleShortcut);
      window.removeEventListener("storage", handleStorage);
    };
  });

  onDestroy(() => {
    isMounted = false;
    selectedEventIds.clear();
    gridCellRefs = [];
    endDateInputRef = null;
    endTimeInputRef = null;
  });

  function addMonths(date: Date, monthOffset: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
  }

  let todayDateKey = $derived.by(() => {
    currentMonth;
    viewMode;
    return formatDateKey(new Date());
  });

  let selectedDateKey = $derived(
    selectedDate ? formatDateKey(selectedDate) : null
  );

  let daysInGrid = $derived.by((): GridDayCell[] => {
    try {
      const targetYear = currentMonth.getFullYear();
      const targetMonth = currentMonth.getMonth();

      const monthStart = new Date(targetYear, targetMonth, 1);
      const monthEnd = new Date(targetYear, targetMonth + 1, 0);

      const startDate = new Date(monthStart);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(monthEnd);
      endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));
      endDate.setHours(23, 59, 59, 999);

      const cells: GridDayCell[] = [];
      const cursor = new Date(startDate);

      let cachedMonth = -1;
      let cachedYear = -1;
      let cachedDaysInMonth = 31;
      let cachedLeap = false;

      while (cursor <= endDate) {
        const cellDate = new Date(cursor);
        const year = cellDate.getFullYear();
        const month = cellDate.getMonth();
        const dayOfMonth = cellDate.getDate();
        const dayOfWeek = cellDate.getDay();

        if (year !== cachedYear || month !== cachedMonth) {
          cachedYear = year;
          cachedMonth = month;
          cachedDaysInMonth = getDaysInYearMonth(year, month);
          cachedLeap = isLeapYearNumber(year);
        }

        const monthStr = String(month + 1).padStart(2, "0");
        const dayStr = String(dayOfMonth).padStart(2, "0");

        cells.push({
          date: cellDate,
          key: `${year}-${monthStr}-${dayStr}`,
          dayTimeMs: cellDate.getTime(),
          year,
          month,
          dayOfMonth,
          dayOfWeek,
          daysInMonth: cachedDaysInMonth,
          isLeapYear: cachedLeap,
          dayLabelPadded: dayStr,
          isCurrentMonth: year === targetYear && month === targetMonth,
        });

        cursor.setDate(cursor.getDate() + 1);
      }

      return cells;
    } catch {
      return [];
    }
  });

  function handlePrevMonth(): void {
    currentMonth = addMonths(currentMonth, -1);
  }

  function handleNextMonth(): void {
    currentMonth = addMonths(currentMonth, 1);
  }

  function handleToday(): void {
    const now = new Date();
    currentMonth = now;
    selectedDate = now;
  }

  function resetForm(): void {
    try {
      editingEvent = null;
      formTitle = "";
      formDesc = "";
      formStartTime = "";
      formEndTime = "";
      formIsMultiDay = false;
      formStartDate = "";
      formEndDate = "";
      formRecurrence = "NONE";
      if (endDateInputRef) endDateInputRef.setCustomValidity("");
      if (endTimeInputRef) endTimeInputRef.setCustomValidity("");
    } catch {}
  }

  function openModal(ev: Event | null): void {
    try {
      resetForm();
      if (ev) {
        editingEvent = ev;
        formTitle = ev.title ?? "";
        formDesc = ev.description ?? "";

        const startMeta = getEventMetadata(ev);
        formStartTime = startMeta.startTimeBadge ?? "";
        formEndTime = startMeta.endTimeBadge ?? "";
        formRecurrence = ev.recurrence ?? "NONE";
        formGroupId = ev.groupId ?? selectedGroupId ?? null;

        const defaultDateStr = formatDateKey(selectedDate || new Date());
        const parsedStart = safeParseDate(ev.startTime);
        const parsedEnd = safeParseDate(ev.endTime);

        formStartDate = parsedStart ? formatDateKey(parsedStart) : defaultDateStr;
        formEndDate = parsedEnd ? formatDateKey(parsedEnd) : formStartDate;
        formIsMultiDay = formStartDate !== formEndDate;
      } else {
        const defaultDateStr = formatDateKey(selectedDate || new Date());
        formStartDate = defaultDateStr;
        formEndDate = defaultDateStr;
        formGroupId =
          selectedGroupId === "GOOGLE_CALENDAR" ? null : selectedGroupId || null;
      }
      isModalOpen = true;
    } catch {
      toastState.add("error", "Failed to open event modal");
    }
  }

  function buildIso(
    timeStr: string,
    dateStr: string | null,
    targetDate: Date
  ): string | null {
    try {
      let baseDate: Date;
      if (dateStr) {
        baseDate = parseLocalDate(dateStr);
      } else if (targetDate && !Number.isNaN(targetDate.getTime())) {
        baseDate = new Date(
          targetDate.getFullYear(),
          targetDate.getMonth(),
          targetDate.getDate()
        );
      } else {
        baseDate = new Date();
      }

      if (Number.isNaN(baseDate.getTime())) return null;

      if (timeStr) {
        const parts = timeStr.split(":");
        if (parts.length < 2) return null;
        const hours = Number(parts[0]);
        const minutes = Number(parts[1]);
        if (
          !Number.isInteger(hours) ||
          !Number.isInteger(minutes) ||
          hours < 0 ||
          hours > 23 ||
          minutes < 0 ||
          minutes > 59
        ) {
          return null;
        }
        baseDate.setHours(hours, minutes, 0, 0);
      }

      if (Number.isNaN(baseDate.getTime())) return null;
      return baseDate.toISOString();
    } catch {
      return null;
    }
  }

  async function onSubmit(): Promise<void> {
    try {
      if (isViewOnlyEvent) return;
      const sanitizedTitle = sanitizeInputText(formTitle, MAX_TITLE_LENGTH);
      if (!sanitizedTitle) return;
      const sanitizedDesc = sanitizeInputText(formDesc, MAX_DESCRIPTION_LENGTH);

      const targetDate = selectedDate || new Date();
      const finalIsAllDay = !formStartTime && !formEndTime;

      const effectiveStartDateStr = formIsMultiDay
        ? formStartDate
        : formStartDate || null;

      const startIso = buildIso(
        formStartTime,
        effectiveStartDateStr,
        targetDate
      );
      if (!startIso) {
        toastState.add("error", "Invalid start date or time format");
        return;
      }

      let endIso: string | null = null;
      if (formEndTime || formIsMultiDay) {
        const effectiveEndDateStr = formIsMultiDay
          ? formEndDate
          : formStartDate || null;
        endIso = buildIso(formEndTime, effectiveEndDateStr, targetDate);
        if (!endIso) {
          toastState.add("error", "Invalid end date or time format");
          return;
        }

        if (formIsMultiDay && !formEndTime) {
          const endDateObj = new Date(endIso);
          endDateObj.setHours(23, 59, 59, 999);
          endIso = endDateObj.toISOString();
        }
      }

      if (formIsMultiDay && formStartDate && formEndDate) {
        const sDate = parseLocalDate(formStartDate);
        const eDate = parseLocalDate(formEndDate);
        sDate.setHours(0, 0, 0, 0);
        eDate.setHours(0, 0, 0, 0);

        if (eDate.getTime() < sDate.getTime()) {
          if (endDateInputRef) {
            endDateInputRef.setCustomValidity("End date must be after start date");
            endDateInputRef.reportValidity();
          }
          return;
        }
      }

      if (startIso && endIso && formStartTime && formEndTime) {
        const sTime = new Date(startIso).getTime();
        const eTime = new Date(endIso).getTime();

        if (eTime <= sTime) {
          if (endTimeInputRef) {
            endTimeInputRef.setCustomValidity("End time must be after start time");
            endTimeInputRef.reportValidity();
          }
          return;
        }
      }

      if (editingEvent) {
        await eventStore.updateEvent(editingEvent.id, {
          title: sanitizedTitle,
          description: sanitizedDesc,
          startTime: startIso,
          endTime: endIso,
          isAllDay: finalIsAllDay,
          recurrence: formRecurrence,
          groupId: formGroupId,
        });
      } else {
        const now = Date.now();
        await eventStore.addEvent({
          id: crypto.randomUUID(),
          title: sanitizedTitle,
          description: sanitizedDesc,
          startTime: startIso,
          endTime: endIso,
          isAllDay: finalIsAllDay,
          recurrence: formRecurrence,
          source: "LOCAL",
          externalId: null,
          groupId: formGroupId,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (isMounted) {
        isModalOpen = false;
      }
    } catch {
      toastState.add("error", "Failed to save event");
    }
  }

  async function onGroupSubmit(): Promise<void> {
    const cleanName = sanitizeInputText(formGroupName, MAX_GROUP_NAME_LENGTH);
    if (!cleanName) return;

    const isDuplicate = eventStore.eventGroups.some(
      (g) => g.name.trim().toLowerCase() === cleanName.toLowerCase() && g.id !== editingGroup?.id
    );
    if (isDuplicate) {
      toastState.add("error", "Group name already exists. Please choose a different name.");
      return;
    }

    try {
      if (editingGroup) {
        await eventStore.updateGroup(editingGroup.id, { name: cleanName });
      } else {
        const newId = crypto.randomUUID();
        const now = Date.now();
        await eventStore.addGroup({
          id: newId,
          name: cleanName,
          color: "gray",
          createdAt: now,
          updatedAt: now,
        });
        if (isMounted) {
          selectedGroupId = newId;
        }
      }
      if (isMounted) {
        isGroupModalOpen = false;
      }
    } catch {
      toastState.add("error", "Failed to save group");
    }
  }

  function deleteEvent(e: MouseEvent, id: string): void {
    try {
      if (e) e.stopPropagation();
      confirmDialog = {
        isOpen: true,
        message: "Are you sure you want to delete this event?",
        onConfirm: async () => {
          try {
            if (selectedEventIds.has(id)) {
              const nextIds = new Set(selectedEventIds);
              nextIds.delete(id);
              selectedEventIds = nextIds;
            }
            await eventStore.deleteEvent(id);
          } catch {
            toastState.add("error", "Failed to delete event");
          }
        },
      };
    } catch {
      toastState.add("error", "Failed to prompt delete");
    }
  }

  function handleDeleteAll(): void {
    try {
      if (selectedEventIds.size > 0) {
        const selectedCount = selectedEventIds.size;
        confirmDialog = {
          isOpen: true,
          message: `Are you sure you want to delete ${selectedCount} selected event(s)?`,
          onConfirm: async () => {
            try {
              const ids = Array.from(selectedEventIds);
              selectedEventIds = new Set();
              await eventStore.deleteMany(ids);
            } catch {
              toastState.add("error", "Failed to delete events");
            }
          },
        };
      } else if (eventsToShow.length > 0) {
        confirmDialog = {
          isOpen: true,
          message:
            "Are you sure you want to permanently delete ALL events shown?",
          onConfirm: async () => {
            try {
              const ids = eventsToShow.map((item) => item.id);
              await eventStore.deleteMany(ids);
            } catch {
              toastState.add("error", "Failed to delete all events");
            }
          },
        };
      }
    } catch {
      toastState.add("error", "Failed to prompt bulk delete");
    }
  }

  function handleDayClick(day: Date): void {
    try {
      selectedDate = day;
      viewMode = "list";
    } catch {}
  }

  function handleSort(key: SortField): void {
    try {
      const next = getNextSort(key, sortKey, sortDirection);
      sortKey = next.key;
      sortDirection = next.direction;
    } catch {}
  }

  let eventsToShow = $derived.by((): Event[] => {
    try {
      if (viewMode !== "list") return [];

      const allEvents = eventStore.events;
      const groupFilter = selectedGroupId;
      const activeSelectedDate = selectedDate;

      let selectedDayTimeMs = 0;
      let selectedDayYear = 0;
      let selectedDayMonth = 0;
      let selectedDayOfMonth = 0;
      let selectedDayOfWeek = 0;
      let selectedDaysInMonth = 31;

      if (activeSelectedDate) {
        selectedDayYear = activeSelectedDate.getFullYear();
        selectedDayMonth = activeSelectedDate.getMonth();
        selectedDayOfMonth = activeSelectedDate.getDate();
        selectedDayOfWeek = activeSelectedDate.getDay();
        selectedDaysInMonth = getDaysInYearMonth(
          selectedDayYear,
          selectedDayMonth
        );
        selectedDayTimeMs = new Date(
          selectedDayYear,
          selectedDayMonth,
          selectedDayOfMonth
        ).getTime();
      }

      const normalizedQuery = searchQuery.trim().toLowerCase();
      const hasQuery = normalizedQuery.length > 0;

      const matchedMetaList: CachedEventMetadata[] = [];

      for (let i = 0, len = allEvents.length; i < len; i++) {
        const ev = allEvents[i];
        if (!ev) continue;

        const meta = getEventMetadata(ev);

        if (groupFilter === "GOOGLE_CALENDAR") {
          if (!meta.isGoogleSource) continue;
        } else if (groupFilter) {
          if (ev.groupId !== groupFilter) continue;
        } else if (!activeSelectedDate) {
          if (meta.isGoogleSource) continue;
        }

        if (activeSelectedDate) {
          if (
            !doesEventMetadataOccurOnDay(
              meta,
              selectedDayTimeMs,
              selectedDayYear,
              selectedDayMonth,
              selectedDayOfMonth,
              selectedDayOfWeek,
              selectedDaysInMonth
            )
          ) {
            continue;
          }
        }

        if (hasQuery) {
          if (
            !meta.lowerTitle.includes(normalizedQuery) &&
            !meta.lowerDescription.includes(normalizedQuery)
          ) {
            continue;
          }
        }

        matchedMetaList.push(meta);
      }

      const activeSortKey = sortKey;
      const directionMultiplier = sortDirection === "asc" ? 1 : -1;

      matchedMetaList.sort((metaA, metaB) => {
        const eventA = metaA.event;
        const eventB = metaB.event;
        let comparison = 0;

        if (activeSortKey === "title") {
          comparison = (eventA.title || "").localeCompare(eventB.title || "");
        } else if (activeSortKey === "createdAt") {
          comparison = eventA.createdAt - eventB.createdAt;
        } else if (activeSortKey === "groupId") {
          comparison = (eventA.groupId || "").localeCompare(eventB.groupId || "");
        } else if (activeSortKey === "recurrence") {
          comparison = (eventA.recurrence || "NONE").localeCompare(
            eventB.recurrence || "NONE"
          );
        } else if (activeSortKey === "endDate") {
          comparison = metaA.sortEndMs - metaB.sortEndMs;
        } else {
          comparison = metaA.sortStartMs - metaB.sortStartMs;
        }

        return comparison * directionMultiplier;
      });

      const sortedEvents = new Array<Event>(matchedMetaList.length);
      for (let i = 0, len = matchedMetaList.length; i < len; i++) {
        sortedEvents[i] = matchedMetaList[i].event;
      }
      return sortedEvents;
    } catch {
      return [];
    }
  });

  let orderedVisibleEventIds = $derived(eventsToShow.map((ev) => ev.id));

  function handleRowClick(e: MouseEvent, id: string): void {
    try {
      e.stopPropagation();
      const result = getNextSelection(
        e,
        id,
        selectedEventIds,
        orderedVisibleEventIds,
        lastSelectedEventId
      );
      selectedEventIds = result.selection;
      lastSelectedEventId = result.lastSelectedId;
    } catch {}
  }

  function focusGridCell(index: number): void {
    try {
      if (index >= 0 && index < daysInGrid.length) {
        focusedGridIndex = index;
        gridCellRefs[index]?.focus();
      }
    } catch {}
  }

  function handleGridKeyDown(e: KeyboardEvent, index: number): void {
    try {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          focusGridCell(Math.max(0, index - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          focusGridCell(Math.min(daysInGrid.length - 1, index + 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          focusGridCell(Math.max(0, index - 7));
          break;
        case "ArrowDown":
          e.preventDefault();
          focusGridCell(Math.min(daysInGrid.length - 1, index + 7));
          break;
        case "Home":
          e.preventDefault();
          focusGridCell(0);
          break;
        case "End":
          e.preventDefault();
          focusGridCell(daysInGrid.length - 1);
          break;
        case "PageUp":
          e.preventDefault();
          handlePrevMonth();
          break;
        case "PageDown":
          e.preventDefault();
          handleNextMonth();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          handleDayClick(daysInGrid[index].date);
          break;
      }
    } catch {}
  }

  let eventsByDayKey = $derived.by((): Map<string, DayEventsSummary> => {
    try {
      const map = new Map<string, DayEventsSummary>();
      const days = daysInGrid;
      const gridLength = days.length;
      if (gridLength === 0) return map;

      const gridStartMs = days[0].dayTimeMs;
      const gridEndMs = days[gridLength - 1].dayTimeMs;

      const normalEventsMap = new Map<string, Event[]>();
      const dailyRecurring: CachedEventMetadata[] = [];
      const weeklyRecurringByDay: CachedEventMetadata[][] = [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
      ];
      const monthlyRecurring: CachedEventMetadata[] = [];
      const yearlyRecurringByMonth: CachedEventMetadata[][] = [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
      ];

      const allEvents = eventStore.events;
      const groupFilter = selectedGroupId;

      for (let i = 0, len = allEvents.length; i < len; i++) {
        const ev = allEvents[i];
        if (!ev) continue;

        const meta = getEventMetadata(ev);
        if (!meta.hasValidStart) continue;

        if (groupFilter === "GOOGLE_CALENDAR") {
          if (!meta.isGoogleSource) continue;
        } else if (groupFilter) {
          if (ev.groupId !== groupFilter) continue;
        }

        const recurrence = ev.recurrence;
        if (!recurrence || recurrence === "NONE") {
          if (
            meta.endDayTimeMs < gridStartMs ||
            meta.startDayTimeMs > gridEndMs
          ) {
            continue;
          }
          const clampedStartMs =
            meta.startDayTimeMs > gridStartMs ? meta.startDayTimeMs : gridStartMs;
          const clampedEndMs =
            meta.endDayTimeMs < gridEndMs ? meta.endDayTimeMs : gridEndMs;

          const cursor = new Date(clampedStartMs);
          while (cursor.getTime() <= clampedEndMs) {
            const key = formatDateKey(cursor);
            let bucket = normalEventsMap.get(key);
            if (!bucket) {
              bucket = [];
              normalEventsMap.set(key, bucket);
            }
            bucket.push(ev);
            cursor.setDate(cursor.getDate() + 1);
          }
        } else if (meta.startDayTimeMs <= gridEndMs) {
          if (recurrence === "DAILY") {
            dailyRecurring.push(meta);
          } else if (recurrence === "WEEKLY") {
            weeklyRecurringByDay[meta.startDayOfWeek].push(meta);
          } else if (recurrence === "MONTHLY") {
            monthlyRecurring.push(meta);
          } else if (recurrence === "YEARLY") {
            yearlyRecurringByMonth[meta.startMonth].push(meta);
          }
        }
      }

      for (let i = 0; i < gridLength; i++) {
        const dayCell = days[i];
        const key = dayCell.key;
        const dayTimeMs = dayCell.dayTimeMs;
        const normalEvents = normalEventsMap.get(key) || [];
        const recurringEvents: Event[] = [];

        for (let j = 0, len = dailyRecurring.length; j < len; j++) {
          const meta = dailyRecurring[j];
          if (dayTimeMs >= meta.startDayTimeMs) {
            recurringEvents.push(meta.event);
          }
        }

        const weeklyBucket = weeklyRecurringByDay[dayCell.dayOfWeek];
        for (let j = 0, len = weeklyBucket.length; j < len; j++) {
          const meta = weeklyBucket[j];
          if (dayTimeMs >= meta.startDayTimeMs) {
            recurringEvents.push(meta.event);
          }
        }

        for (let j = 0, len = monthlyRecurring.length; j < len; j++) {
          const meta = monthlyRecurring[j];
          if (dayTimeMs >= meta.startDayTimeMs) {
            const targetDay =
              meta.startDayOfMonth < dayCell.daysInMonth
                ? meta.startDayOfMonth
                : dayCell.daysInMonth;
            if (dayCell.dayOfMonth === targetDay) {
              recurringEvents.push(meta.event);
            }
          }
        }

        const yearlyBucket = yearlyRecurringByMonth[dayCell.month];
        for (let j = 0, len = yearlyBucket.length; j < len; j++) {
          const meta = yearlyBucket[j];
          if (dayTimeMs >= meta.startDayTimeMs) {
            const expectedDay =
              meta.startMonth === 1 &&
              meta.startDayOfMonth === 29 &&
              !dayCell.isLeapYear
                ? 28
                : meta.startDayOfMonth;
            if (dayCell.dayOfMonth === expectedDay) {
              recurringEvents.push(meta.event);
            }
          }
        }

        const hasNormal = normalEvents.length > 0;
        const hasRecurring = recurringEvents.length > 0;
        const dayEvents =
          hasNormal && hasRecurring
            ? [...normalEvents, ...recurringEvents]
            : hasNormal
              ? normalEvents
              : recurringEvents;

        map.set(key, {
          dayEvents,
          normalEvents,
          hasNormal,
          hasRecurring,
          eventsCount: normalEvents.length,
        });
      }

      return map;
    } catch {
      return new Map();
    }
  });

  async function moveEventsToGroup(
    eventIds: string[],
    targetGroupId: string | null
  ): Promise<void> {
    try {
      let movedCount = 0;
      const lookupMap = eventById;
      for (let i = 0, len = eventIds.length; i < len; i++) {
        const eventId = eventIds[i];
        const eventItem = lookupMap.get(eventId);
        if (
          eventItem &&
          !eventItem.source?.startsWith("GOOGLE") &&
          (eventItem.groupId ?? null) !== targetGroupId
        ) {
          await eventStore.updateEvent(
            eventId,
            { groupId: targetGroupId },
            true
          );
          movedCount++;
        }
      }
      if (movedCount > 0) {
        toastState.add(
          "success",
          movedCount > 1 ? `Moved ${movedCount} events` : "Event group updated"
        );
      }
    } catch {}
  }

  function resolveGroupName(groupId: string | null): string {
    if (!groupId) return "My Events (Ungroup)";
    return eventGroupById.get(groupId)?.name || "Group";
  }
</script>

<div class="flex h-full gap-4">
  {@render groupsSidebar()}
  <PageLayout class="relative flex-1 min-w-0 border-0 overflow-hidden">
    <div class="relative z-overlay h-full flex flex-col">
      <Toolbar>
        {#snippet search()}
          <div class="flex items-center gap-3 sm:gap-4 min-w-0">
            <TabSwitcher
              tabs={[
                { value: "grid", label: "Calendar", icon: CalendarDays },
                { value: "list", label: "Events", icon: LayoutList },
              ]}
              value={viewMode}
              onValueChange={(val: string) => {
                viewMode = val as "grid" | "list";
                if (val === "grid" || val === "list") {
                  selectedDate = null;
                }
                selectedEventIds = new Set();
              }}
            />

            {#if viewMode === "grid"}
              <div class="flex items-center sm:max-w-xs">
                <h2
                  class="text-sm sm:text-base font-semibold tracking-tight capitalize shrink-0 text-foreground"
                >
                  {MONTH_NAMES[currentMonth.getMonth()]}
                  {currentMonth.getFullYear()}
                </h2>
              </div>
            {:else}
              <div class="flex items-center gap-4">
                {#if selectedDate}
                  <h2
                    class="text-sm sm:text-base font-semibold tracking-tight capitalize shrink-0 text-foreground"
                  >
                    {MONTH_NAMES[selectedDate.getMonth()]}
                    {selectedDate.getDate()}, {selectedDate.getFullYear()}
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    onclick={() => (selectedDate = null)}
                  >
                    <X class="w-4 h-4" />
                  </Button>
                {/if}
                <SearchBar
                  bind:value={searchQuery}
                  placeholder="Search events..."
                  containerClass="flex-1 min-w-0 sm:max-w-xs"
                />
              </div>
            {/if}
          </div>
        {/snippet}

        {#snippet actions()}
          {#if viewMode === "grid"}
            <div class="flex items-center gap-2 mr-2">
              <Button
                variant="outline"
                size="sm"
                class="px-3"
                onclick={handleToday}>Today</Button
              >
              <div
                class="flex items-center gap-1 bg-background border border-input rounded-md p-0.5 shadow-sm shrink-0"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  class="p-1 h-7 w-7"
                  onclick={handlePrevMonth}
                  aria-label="Previous month"
                >
                  <ChevronLeft class="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="p-1 h-7 w-7"
                  onclick={handleNextMonth}
                  aria-label="Next month"
                >
                  <ChevronRight class="w-4 h-4" />
                </Button>
              </div>
            </div>
          {:else}
            <Button
              variant="destructive-outline"
              size="sm"
              onclick={handleDeleteAll}
              disabled={eventsToShow.length === 0}
              title={selectedEventIds.size > 0
                ? `Delete ${selectedEventIds.size} selected`
                : "Delete All Events"}
            >
              <Trash2 class="w-4 h-4" />
              <span class="hidden sm:inline">
                {selectedEventIds.size > 0
                  ? `Delete (${selectedEventIds.size})`
                  : "Delete All"}
              </span>
            </Button>
          {/if}
          <Button size="sm" onclick={() => openModal(null)}>
            <PlusCircle class="w-4 h-4" />
            <span class="hidden sm:inline">New Event</span>
          </Button>
        {/snippet}
      </Toolbar>

      <div
        class="flex-1 {viewMode === 'grid'
          ? 'overflow-auto bg-background'
          : 'flex flex-col min-h-0'}"
        role="presentation"
        onclick={() => (selectedEventIds = new Set())}
        onkeydown={(e) => {
          if (e.key === "Escape") selectedEventIds = new Set();
        }}
      >
        {#if viewMode === "grid"}
          <div
            class="p-2 sm:p-4 h-full select-none flex flex-col"
            role="grid"
            aria-label="Calendar grid"
          >
            <div
              class="grid grid-cols-7 gap-1 mb-1 sm:mb-2 shrink-0"
              role="row"
            >
              {#each WEEKDAYS as day (day)}
                <div
                  class="text-center text-xs font-semibold text-muted-foreground uppercase py-1 sm:py-2"
                  role="columnheader"
                >
                  <span class="hidden sm:inline">{day}</span>
                  <span class="sm:hidden">{day.charAt(0)}</span>
                </div>
              {/each}
            </div>
            <div
              class="grid grid-cols-7 gap-1 auto-rows-[minmax(3rem,auto)] md:auto-rows-[minmax(5rem,auto)]"
              role="row"
            >
              {#each daysInGrid as dayItem, idx (dayItem.key)}
                {@const day = dayItem.date}
                {@const dayKey = dayItem.key}
                {@const dayData =
                  eventsByDayKey.get(dayKey) || EMPTY_DAY_SUMMARY}
                {@const isSelected = selectedDateKey === dayKey}
                {@const isCurMonth = dayItem.isCurrentMonth}
                {@const isToday = dayKey === todayDateKey}
                {@const hasNormal = dayData.hasNormal}
                {@const hasRecurring = dayData.hasRecurring}
                {@const eventsCount = dayData.eventsCount}
                {@const dayEvents = dayData.dayEvents}

                <button
                  bind:this={gridCellRefs[idx]}
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={`${MONTH_NAMES[dayItem.month]} ${dayItem.dayOfMonth}, ${dayItem.year}${hasNormal ? `, ${eventsCount} events` : ""}${hasRecurring ? ", has recurring events" : ""}`}
                  tabindex={focusedGridIndex === idx ? 0 : -1}
                  onclick={() => handleDayClick(day)}
                  onkeydown={(e) => handleGridKeyDown(e, idx)}
                  class="relative flex flex-col p-2 sm:p-3 rounded-xl transition-colors text-left focus:outline-none focus:ring-2 focus:ring-ring
                    {!isCurMonth
                    ? 'text-muted-foreground/50 bg-transparent opacity-40 hover:opacity-70'
                    : 'bg-card hover:bg-white/5 shadow-sm border border-black/8 dark:border-white/5'}
                    {isSelected ? 'ring-1 ring-primary' : ''} overflow-hidden"
                >
                  {#if hasRecurring}
                    <div
                      class="absolute top-0 right-0 w-3 h-3 sm:w-4 sm:h-4 {isCurMonth
                        ? 'bg-primary/80'
                        : 'bg-primary/30'}"
                      style="clip-path: polygon(100% 0, 0 0, 100% 100%);"
                    ></div>
                  {/if}
                  <span
                    class="text-xs sm:text-sm font-medium flex items-center justify-center w-7 h-7 rounded-full {isToday
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : isCurMonth
                        ? 'text-foreground/90'
                        : 'text-muted-foreground/50'}"
                  >
                    {dayItem.dayLabelPadded}
                  </span>
                  {#if dayEvents.length > 0}
                    <div
                      class="mt-auto flex flex-col gap-0.5 sm:gap-1 pt-1 w-full overflow-hidden"
                    >
                      {#each dayEvents.slice(0, 2) as ev (ev.id)}
                        {@const isGoogle = ev.groupId === "GOOGLE_CALENDAR"}
                        <div
                          class="w-full text-xs leading-tight truncate px-1 sm:px-1.5 py-0.5 rounded-sm font-medium text-left flex items-center gap-1 {isGoogle
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                            : 'bg-primary/90 text-primary-foreground'}"
                          title={isGoogle ? `[Google Calendar] ${ev.title}` : ev.title}
                        >
                          {#if isGoogle}
                            <span class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                          {/if}
                          <span class="truncate">{ev.title}</span>
                        </div>
                      {/each}
                      {#if dayEvents.length > 2}
                        <div
                          class="w-full text-xs text-muted-foreground truncate px-1 font-medium text-left"
                        >
                          + {dayEvents.length - 2} more
                        </div>
                      {/if}
                    </div>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <TableContainer onclick={() => (selectedEventIds = new Set())} class="px-2! sm:px-2!">
            <Table style="min-width: {colResizer.totalWidth}px;">
              <TableHeader onclick={(e: MouseEvent) => e.stopPropagation()}>
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
                      <span class="truncate">Event Name</span>
                      <SortIcon
                        active={sortKey === "title"}
                        direction={sortDirection}
                      />
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
                    class="hidden md:table-cell cursor-pointer select-none group relative px-2!"
                    onclick={() => handleSort("groupId")}
                    aria-sort={sortKey === "groupId"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"}
                  >
                    <div class="flex items-center gap-2 min-w-0 pr-2">
                      <span class="truncate">Group</span>
                      <SortIcon
                        active={sortKey === "groupId"}
                        direction={sortDirection}
                      />
                    </div>
                    <ColumnResizer
                      isResizing={colResizer.resizingPair === "groupId-date"}
                      onResize={(d) => colResizer.resizePair("groupId", "date", d)}
                      onFinish={() => colResizer.finishResize()}
                      onReset={() => colResizer.resetPair("groupId", "date")}
                    />
                  </TableHead>
                  <TableHead
                    style={colResizer.getStyle("date")}
                    class="cursor-pointer select-none group relative px-2!"
                    onclick={() => handleSort("date")}
                    aria-sort={sortKey === "date"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"}
                  >
                    <div class="flex items-center gap-2 min-w-0 pr-2">
                      <span class="truncate">Start</span>
                      <SortIcon
                        active={sortKey === "date"}
                        direction={sortDirection}
                      />
                    </div>
                    <ColumnResizer
                      isResizing={colResizer.resizingPair === "date-endDate"}
                      onResize={(d) => colResizer.resizePair("date", "endDate", d)}
                      onFinish={() => colResizer.finishResize()}
                      onReset={() => colResizer.resetPair("date", "endDate")}
                    />
                  </TableHead>
                  <TableHead
                    style={colResizer.getStyle("endDate")}
                    class="hidden md:table-cell cursor-pointer select-none group relative px-2!"
                    onclick={() => handleSort("endDate")}
                    aria-sort={sortKey === "endDate"
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"}
                  >
                    <div class="flex items-center gap-2 min-w-0 pr-2">
                      <span class="truncate">End</span>
                      <SortIcon
                        active={sortKey === "endDate"}
                        direction={sortDirection}
                      />
                    </div>
                    <ColumnResizer
                      isResizing={colResizer.resizingPair === "endDate-createdAt"}
                      onResize={(d) => colResizer.resizePair("endDate", "createdAt", d)}
                      onFinish={() => colResizer.finishResize()}
                      onReset={() => colResizer.resetPair("endDate", "createdAt")}
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
                      <SortIcon
                        active={sortKey === "createdAt"}
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
                {#if eventsToShow.length === 0}
                  <TableRow class="hover:bg-transparent! cursor-default!">
                    <TableCell class="p-0 align-middle" colspan={6}>
                      <div
                        class="flex items-center justify-center w-full h-[calc(100vh-16rem)]"
                      >
                        <EmptyState
                          icon={CalendarDays}
                          title="Calendar is Empty"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                {:else}
                  {#each eventsToShow as event (event.id)}
                    {@const isSelected = selectedEventIds.has(event.id)}
                    {@const isBeingDragged = draggedEventIdSet.has(event.id)}
                    {@const meta = getEventMetadata(event)}
                    {@const groupObj = event.groupId
                      ? eventGroupById.get(event.groupId)
                      : undefined}
                    <TableRow
                      class="border-transparent {isBeingDragged
                        ? 'opacity-40 ring-1 ring-primary/40'
                        : ''}"
                      selected={isSelected}
                      role="row"
                      aria-selected={isSelected}
                      tabindex={0}
                      onpointerdown={(e: PointerEvent) =>
                        eventGroupReorder.handleItemPointerDown(
                          e,
                          event.id,
                          selectedEventIds,
                          moveEventsToGroup,
                          {
                            disabled: meta.isGoogleSource,
                            itemLabel: event.title,
                            getGroupName: resolveGroupName,
                          }
                        )}
                      onclick={(e: MouseEvent) => handleRowClick(e, event.id)}
                      ondblclick={(e: MouseEvent) => {
                        e.stopPropagation();
                        openModal(event);
                      }}
                      onkeydown={(e: KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleRowClick(e as unknown as MouseEvent, event.id);
                        }
                      }}
                    >
                      <TableCell
                        style={colResizer.getStyle("title")}
                        class="font-medium text-foreground px-2!"
                      >
                        <div class="flex flex-col">
                          <div class="flex items-center gap-1.5 w-full flex-wrap sm:flex-nowrap min-w-0">
                            <span class="truncate">{event.title}</span>
                            {#if event.recurrence && event.recurrence !== "NONE"}
                              <span
                                class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border bg-violet-500/10 text-violet-400 border-violet-500/25 font-medium shrink-0"
                                title="Recurrence: {RECURRENCE_LABELS[event.recurrence] || event.recurrence}"
                              >
                                <Repeat class="w-3 h-3 shrink-0" />
                                <span>{RECURRENCE_LABELS[event.recurrence] || event.recurrence}</span>
                              </span>
                            {/if}
                            {#if meta.isGoogleSource}
                              <Lock
                                class="w-3.5 h-3.5 text-muted-foreground shrink-0"
                              />
                            {/if}
                          </div>
                          {#if event.description}
                            <span
                              class="text-xs text-muted-foreground font-normal truncate w-full mt-1"
                              >{event.description}</span
                            >
                          {/if}
                        </div>
                      </TableCell>
                      <TableCell
                        style={colResizer.getStyle("groupId")}
                        class="whitespace-nowrap px-2! overflow-hidden hidden md:table-cell"
                      >
                        {#if event.groupId === "GOOGLE_CALENDAR"}
                          <span
                            class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border text-emerald-600 bg-emerald-500/10 border-emerald-500/20 font-medium shrink-0"
                          >
                            {icalName}
                          </span>
                        {:else if groupObj}
                          <span
                            class="inline-flex items-center px-2 py-0.5 rounded-md bg-muted text-xs font-medium text-muted-foreground truncate max-w-full"
                          >
                            {groupObj.name}
                          </span>
                        {:else}
                          <span class="text-xs text-muted-foreground/50"
                            >No Group</span
                          >
                        {/if}
                      </TableCell>
                      <TableCell
                        style={colResizer.getStyle("date")}
                        class="whitespace-nowrap px-2! overflow-hidden"
                      >
                        {#if meta.startDateBadge}
                          <div class="flex items-center gap-1.5 min-w-0">
                            <span
                              class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20 font-medium shrink-0 whitespace-nowrap"
                            >
                              {meta.startDateBadge}
                            </span>
                            {#if meta.startTimeBadge}
                              <span
                                class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20 font-medium shrink-0 whitespace-nowrap"
                              >
                                {meta.startTimeBadge}
                              </span>
                            {/if}
                          </div>
                        {:else}
                          <span class="text-xs text-muted-foreground/50"
                            >N/A</span
                          >
                        {/if}
                      </TableCell>
                      <TableCell
                        style={colResizer.getStyle("endDate")}
                        class="whitespace-nowrap px-2! overflow-hidden hidden md:table-cell"
                      >
                        {#if meta.endDateBadge || meta.endTimeBadge}
                          <div class="flex items-center gap-1.5 min-w-0">
                            {#if meta.endDateBadge}
                              <span
                                class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20 font-medium shrink-0 whitespace-nowrap"
                              >
                                {meta.endDateBadge}
                              </span>
                            {/if}
                            {#if meta.endTimeBadge}
                              <span
                                class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border text-cyan-700 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/20 font-medium shrink-0 whitespace-nowrap"
                              >
                                {meta.endTimeBadge}
                              </span>
                            {/if}
                          </div>
                        {:else}
                          <span class="text-xs text-muted-foreground/50"
                            >N/A</span
                          >
                        {/if}
                      </TableCell>
                      <TableCell
                        style={colResizer.getStyle("createdAt")}
                        class="whitespace-nowrap text-muted-foreground text-xs px-2! overflow-hidden hidden md:table-cell"
                      >
                        <span class="truncate block">{formatDate(event.createdAt)}</span>
                      </TableCell>
                      <TableCell
                        style={colResizer.getStyle("actions")}
                        class="text-left pl-3! pr-4! whitespace-nowrap overflow-hidden"
                      >
                        <div
                          class="flex items-center justify-start gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100"
                        >
                          <ActionButton
                            variant="edit"
                            icon={meta.isGoogleSource ? Eye : Pencil}
                            onClick={(e: MouseEvent) => {
                              e.stopPropagation();
                              openModal(event);
                            }}
                            title={meta.isGoogleSource ? "View Event" : "Edit"}
                          />
                          <ActionButton
                            variant="delete"
                            icon={Trash2}
                            onClick={(e: MouseEvent) =>
                              deleteEvent(e, event.id)}
                            title="Delete"
                          />
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
    </div>
  </PageLayout>
</div>

{#snippet groupsSidebar()}
  {#if viewMode === "list"}
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
          use:eventGroupReorder.allTargetAction
          class="group/all relative flex items-center w-full rounded-lg text-sm transition-colors {!selectedGroupId
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'} {eventGroupReorder.itemDropGroupId ===
          '__ALL__'
            ? 'bg-primary/20 ring-2 ring-primary text-primary'
            : ''}"
        >
          <button
            type="button"
            class="flex-1 flex items-center {isGroupSidebarOpen
              ? 'px-2'
              : 'px-3'} py-2 rounded-lg text-sm transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] text-left min-w-0 cursor-pointer"
            onclick={() => (selectedGroupId = null)}
            title={isGroupSidebarOpen ? undefined : "My Events"}
          >
            <div
              class="w-6 h-6 flex items-center justify-center shrink-0 transition-[margin] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                ? 'ml-0'
                : 'ml-0.75'}"
            >
              <Calendar class="w-4 h-4 {!selectedGroupId ? 'text-primary' : ''}" />
            </div>
            <div
              class="text-left truncate whitespace-nowrap overflow-hidden transition-[opacity,margin,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                ? 'opacity-100 ml-1.5 flex-1 min-w-0 mr-1'
                : 'opacity-0 ml-0 w-0'}"
            >
              My Events
            </div>
          </button>

          {#if isGroupSidebarOpen}
            <button
              type="button"
              class="p-1.5 mr-1 rounded-md text-muted-foreground hover:text-primary hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer opacity-80 group-hover/all:opacity-100"
              onclick={(event) => {
                event.stopPropagation();
                editingGroup = null;
                formGroupName = "";
                isGroupModalOpen = true;
              }}
              title="New Group"
              aria-label="New Group"
            >
              <Plus class="w-4 h-4" />
            </button>
          {/if}
        </div>

        {#each sortedEventGroups as group (group.id)}
          {@const isDragging = eventGroupReorder.draggedGroupId === group.id}
          {@const isDragOver = eventGroupReorder.dragOverGroupId === group.id}
          {@const isItemDropTarget =
            eventGroupReorder.itemDropGroupId === group.id}
          <div
            use:eventGroupReorder.elementAction={group.id}
            class="group/item relative flex items-center w-full rounded-lg transition-all duration-150 {isDragging
              ? 'opacity-30 scale-[0.98] border border-dashed border-primary/40'
              : isDragOver
                ? 'border border-primary/40 ring-1 ring-primary/30 bg-primary/15'
                : ''} {isItemDropTarget ? 'bg-primary/20 ring-2 ring-primary' : ''}"
            role="region"
            aria-label="Event group drop zone"
          >
            {#if isDragOver && eventGroupReorder.dropPosition === "above"}
              <div
                class="absolute top-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
              ></div>
            {/if}
            {#if isDragOver && eventGroupReorder.dropPosition === "below"}
              <div
                class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/80 rounded-full z-30 shadow-[0_0_6px_rgba(99,102,241,0.4)]"
              ></div>
            {/if}

            <div
              class="flex items-center shrink-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                ? 'w-5 opacity-100 ml-1 -mr-1 scale-100'
                : 'w-0 opacity-0 ml-0 mr-0 pointer-events-none scale-75'}"
            >
              <div
                class="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground/40 hover:text-primary hover:bg-primary/10 rounded transition-colors select-none touch-none shrink-0"
                title="Drag to reorder groups"
                role="button"
                tabindex={isGroupSidebarOpen ? 0 : -1}
                aria-label="Drag to reorder groups"
                onpointerdown={(e) =>
                  eventGroupReorder.handleGripPointerDown(
                    e,
                    group.id,
                    sortedEventGroupIds
                  )}
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
                }}
              >
                <GripVertical class="w-3.5 h-3.5" />
              </div>
            </div>

            <button
              class="flex-1 flex items-center {isGroupSidebarOpen
                ? 'px-2'
                : 'px-3'} py-2 rounded-lg text-sm transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] text-left {selectedGroupId ===
              group.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
              onclick={() => {
                if (!eventGroupReorder.isPointerDragging) {
                  selectedGroupId = group.id;
                }
              }}
              title={isGroupSidebarOpen ? undefined : group.name}
            >
              <div
                class="w-6 h-6 flex items-center justify-center shrink-0 transition-[margin] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                  ? 'ml-0'
                  : 'ml-0.75'}"
              >
                <CalendarDays class="w-4 h-4" />
              </div>
              <div
                class="text-left truncate whitespace-nowrap overflow-hidden transition-[opacity,margin,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                  ? 'opacity-100 ml-2 flex-1 min-w-0 mr-1'
                  : 'opacity-0 ml-0 w-0'}"
              >
                {group.name}
              </div>
              {#if isGroupSidebarOpen}
                <CountBadge
                  count={eventCountByGroupId.get(group.id) || 0}
                  class="ml-auto mr-1 bg-muted/70 text-muted-foreground group-hover/item:opacity-0 transition-opacity pointer-events-none"
                  title="{(eventCountByGroupId.get(group.id) || 0)} events"
                />
              {/if}
            </button>

            <div
              class="absolute right-2 flex items-center transition-[opacity,transform] duration-200 {isGroupSidebarOpen
                ? 'opacity-0 group-hover/item:opacity-100 scale-100'
                : 'opacity-0 scale-75 pointer-events-none'}"
            >
              <button
                class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-foreground"
                onclick={(e) => {
                  e.stopPropagation();
                  editingGroup = { id: group.id, name: group.name };
                  formGroupName = group.name;
                  isGroupModalOpen = true;
                }}
                title="Edit Group"
              >
                <Pencil class="w-3.5 h-3.5" />
              </button>
              <button
                class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-rose-500"
                onclick={(e) => {
                  e.stopPropagation();
                  confirmDialog = {
                    isOpen: true,
                    message:
                      "Delete this group? Events inside will be ungrouped.",
                    onConfirm: async () => {
                      if (selectedGroupId === group.id) selectedGroupId = null;
                      await eventStore.deleteGroup(group.id);
                    },
                  };
                }}
                title="Delete Group"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        {/each}

        {#if hasICalUrl || hasGoogleEvents}
          <div class="group relative flex items-center w-full">
            <button
              class="flex-1 flex items-center px-3 py-2 rounded-lg text-sm transition-colors text-left {selectedGroupId ===
              'GOOGLE_CALENDAR'
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'}"
              onclick={() => (selectedGroupId = "GOOGLE_CALENDAR")}
              title={isGroupSidebarOpen ? undefined : icalName}
            >
              <div
                class="w-6 h-6 flex items-center justify-center shrink-0 transition-[margin] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                  ? 'ml-0'
                  : 'ml-0.75'}"
              >
                <CalendarDays class="w-4 h-4" />
              </div>
              <div
                class="text-left flex items-center gap-1.5 truncate whitespace-nowrap overflow-hidden transition-[opacity,margin,width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {isGroupSidebarOpen
                  ? 'opacity-100 ml-2 flex-1 min-w-0 mr-1'
                  : 'opacity-0 ml-0 w-0'}"
              >
                <span class="truncate">{icalName}</span>
                <Lock class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </div>
              {#if isGroupSidebarOpen}
                <CountBadge
                  count={googleEventsCount}
                  class="ml-auto mr-1 bg-muted/70 text-muted-foreground group-hover:opacity-0 transition-opacity pointer-events-none"
                  title="{googleEventsCount} events"
                />
              {/if}
            </button>

            <div
              class="absolute right-2 flex items-center transition-[opacity,transform] duration-200 {isGroupSidebarOpen
                ? 'opacity-0 group-hover:opacity-100 scale-100'
                : 'opacity-0 scale-75 pointer-events-none'}"
            >
              <button
                class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-rose-500"
                onclick={(e) => {
                  e.stopPropagation();
                  confirmDialog = {
                    isOpen: true,
                    message:
                      "Delete this synced calendar? All synced events will be permanently removed.",
                    onConfirm: async () => {
                      if (selectedGroupId === "GOOGLE_CALENDAR") {
                        selectedGroupId = null;
                      }
                      hasICalUrl = false;
                      const syncedEvents = eventStore.events.filter((ev) =>
                        ev.source?.startsWith("GOOGLE")
                      );
                      if (syncedEvents.length > 0) {
                        await eventStore.deleteMany(
                          syncedEvents.map((ev) => ev.id)
                        );
                      }
                      localStorage.setItem("synced_ical_urls", "[]");
                      localStorage.removeItem("google_ical_url");
                      localStorage.removeItem("personal-os-ical-name");
                      uiPreferenceRepo.set("synced_ical_urls", "[]").catch(() => {});
                      uiPreferenceRepo.delete("google_ical_urls").catch(() => {});
                      uiPreferenceRepo.delete("google_ical_url").catch(() => {});
                      window.dispatchEvent(
                        new StorageEvent("storage", {
                          key: "synced_ical_urls",
                        })
                      );
                    },
                  };
                }}
                title="Delete Synced Calendar"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

<FormModal
  bind:isOpen={isModalOpen}
  title={editingEvent
    ? isViewOnlyEvent
      ? "View Event"
      : "Edit Event"
    : "New Event"}
  submitText={editingEvent ? (isViewOnlyEvent ? "" : "Save") : "Create"}
  submitDisabled={!formTitle.trim() || isViewOnlyEvent}
  onSubmit={onSubmit}
>
  <div class="flex flex-col">
    <FormField>
      <Input
        bind:value={formTitle}
        placeholder="E.g., Team Meeting"
        required
        readonly={isViewOnlyEvent}
        class={isViewOnlyEvent
          ? "focus-visible:ring-0 focus:ring-0! focus:border-black/8! dark:focus:border-premium-border! cursor-default"
          : ""}
      />
    </FormField>

    <div class="pt-4">
      <FormField>
        <Textarea
          bind:value={formDesc}
          placeholder="Add details..."
          rows={3}
          readonly={isViewOnlyEvent}
          class={isViewOnlyEvent
            ? "focus-visible:ring-0 focus:ring-0! focus:border-black/8! dark:focus:border-premium-border! cursor-default resize-none!"
            : ""}
        />
      </FormField>
    </div>

    <div class="grid grid-cols-2 gap-4 pt-4">
      <div class="flex flex-col justify-center">
        <div class="flex items-center gap-3 overflow-hidden">
          <span
            class="text-sm text-muted-foreground w-16 {formRecurrence !==
              'NONE' && !isViewOnlyEvent
              ? 'opacity-50'
              : ''}">Multi-day</span
          >
          <Switch
            bind:checked={formIsMultiDay}
            disabled={formRecurrence !== "NONE" || isViewOnlyEvent}
            class={isViewOnlyEvent ? "disabled:opacity-100!" : ""}
          />
        </div>
      </div>

      <FormField class="flex justify-end">
        <DropdownMenu class="w-36">
          <DropdownMenuTrigger class="w-full" disabled={isViewOnlyEvent}>
            <Button
              variant="outline"
              class="w-full justify-between! font-normal text-foreground {isViewOnlyEvent
                ? 'disabled:opacity-100!'
                : ''}"
              disabled={isViewOnlyEvent}
            >
              {RECURRENCE_LABELS[formRecurrence]}
              {#if !isViewOnlyEvent}
                <ChevronDown class="w-4 h-4 opacity-50" />
              {/if}
            </Button>
          </DropdownMenuTrigger>
          {#if !isViewOnlyEvent}
            <DropdownMenuContent align="end" class="w-full min-w-35">
              <DropdownMenuItem onclick={() => setFormRecurrence("NONE")}
                >No repeat</DropdownMenuItem
              >
              <DropdownMenuItem onclick={() => setFormRecurrence("DAILY")}
                >Daily</DropdownMenuItem
              >
              <DropdownMenuItem onclick={() => setFormRecurrence("WEEKLY")}
                >Weekly</DropdownMenuItem
              >
              <DropdownMenuItem onclick={() => setFormRecurrence("MONTHLY")}
                >Monthly</DropdownMenuItem
              >
              <DropdownMenuItem onclick={() => setFormRecurrence("YEARLY")}
                >Yearly</DropdownMenuItem
              >
            </DropdownMenuContent>
          {/if}
        </DropdownMenu>
      </FormField>
    </div>

    {#if formIsMultiDay}
      <div transition:slide={{ duration: 200 }}>
        <div class="grid grid-cols-2 gap-4 pt-4">
          <DatePicker
            bind:value={formStartDate}
            placeholder="Start Date"
            disabled={isViewOnlyEvent}
            class={isViewOnlyEvent ? "opacity-100!" : ""}
          />
          <div class="relative [&>div]:w-full">
            <DatePicker
              bind:value={formEndDate}
              placeholder="End Date"
              disabled={isViewOnlyEvent}
              class={isViewOnlyEvent ? "opacity-100!" : ""}
            />
            <input
              type="text"
              bind:this={endDateInputRef}
              class="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
              tabindex="-1"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    {/if}

    <div>
      <div class="grid grid-cols-2 gap-4 pt-4">
        <TimePicker
          bind:value={formStartTime}
          placeholder="Start Time"
          disabled={isViewOnlyEvent}
          class={isViewOnlyEvent ? "opacity-100!" : ""}
        />
        <div class="relative [&>div]:w-full">
          <TimePicker
            bind:value={formEndTime}
            placeholder="End Time"
            disabled={isViewOnlyEvent}
            class={isViewOnlyEvent ? "opacity-100!" : ""}
          />
          <input
            type="text"
            bind:this={endTimeInputRef}
            class="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
            tabindex="-1"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>

    <div class="pt-4">
      <FormField label="Group (Optional)">
        <DropdownMenu class="w-full block max-w-full">
          <DropdownMenuTrigger class="w-full" disabled={isViewOnlyEvent}>
            <button
              type="button"
              class="w-full max-w-full min-w-0 h-10 px-3 py-2 rounded-md border border-input bg-background text-foreground text-sm ring-offset-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors flex items-center justify-between gap-2 {isViewOnlyEvent
                ? 'disabled:opacity-100!'
                : ''}"
              disabled={isViewOnlyEvent}
            >
              <span class="truncate block min-w-0">
                {isViewOnlyEvent
                  ? icalName
                  : (formGroupId && eventGroupById.get(formGroupId)?.name) ||
                    "No Group"}
              </span>
              {#if !isViewOnlyEvent}
                <ChevronDown class="w-4 h-4 opacity-50 shrink-0" />
              {/if}
            </button>
          </DropdownMenuTrigger>
          {#if !isViewOnlyEvent}
            <DropdownMenuContent
              align="start"
              class="w-full max-w-full min-w-48 max-h-40 overflow-y-auto overflow-x-hidden"
            >
              <DropdownMenuItem
                onclick={(e) => {
                  e.preventDefault();
                  formGroupId = null;
                }}
              >
                <span class="truncate block w-full text-left">No Group</span>
              </DropdownMenuItem>
              {#each editableEventGroups as group (group.id)}
                <DropdownMenuItem
                  onclick={(e) => {
                    e.preventDefault();
                    formGroupId = group.id;
                  }}
                >
                  <span
                    class="truncate block w-full text-left"
                    title={group.name}>{group.name}</span
                  >
                </DropdownMenuItem>
              {/each}
            </DropdownMenuContent>
          {/if}
        </DropdownMenu>
      </FormField>
    </div>
  </div>
</FormModal>

<FormModal
  bind:isOpen={isGroupModalOpen}
  title={editingGroup ? "Edit Group" : "New Group"}
  submitText={editingGroup ? "Save" : "Create"}
  submitDisabled={!formGroupName.trim()}
  onSubmit={onGroupSubmit}
>
  <FormField label="Group Name">
    <Input
      bind:value={formGroupName}
      placeholder="E.g., Work, Personal..."
      required
    />
  </FormField>
</FormModal>

<ConfirmModal
  bind:isOpen={confirmDialog.isOpen}
  message={confirmDialog.message}
  onConfirm={confirmDialog.onConfirm}
/>

import type { Event as CalendarEventItem } from "../../shared/db/schema";
import { parseLocalDate } from "../../shared/utils/format";

export interface EventOccurrence {
  start: Date;
  end: Date;
  startMs: number;
  endMs: number;
  occurrenceKey: string;
  isRecurring: boolean;
  recurrenceType: string | null;
  status: "attended" | "skipped" | null;
  isOverdue: boolean;
  isHappeningNow: boolean;
}

export type EventCompletionsMap = Record<string, Record<string, "attended" | "skipped">>;

export const STORAGE_KEY_EVENT_COMPLETIONS = "personal_os_event_completions";

export function loadEventCompletions(): EventCompletionsMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY_EVENT_COMPLETIONS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as EventCompletionsMap;
    }
  } catch {}
  return {};
}

export function formatDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function computeEventOccurrence(
  event: CalendarEventItem,
  completions: EventCompletionsMap = {},
  now: Date = new Date()
): EventOccurrence {
  const rawStart = event.startTime ? parseLocalDate(event.startTime) : new Date(event.createdAt);
  let rawEnd: Date;
  if (event.endTime) {
    rawEnd = parseLocalDate(event.endTime);
    if (event.isAllDay || !event.endTime.includes("T")) {
      rawEnd.setHours(23, 59, 59, 999);
    }
  } else if (event.startTime) {
    rawEnd = new Date(rawStart.getTime());
    if (event.isAllDay || !event.startTime.includes("T")) {
      rawEnd.setHours(23, 59, 59, 999);
    } else {
      rawEnd = new Date(rawStart.getTime() + 60 * 60 * 1000);
    }
  } else {
    rawEnd = new Date(rawStart.getTime() + 60 * 60 * 1000);
  }

  const durationMs = Math.max(0, rawEnd.getTime() - rawStart.getTime());
  const recurrence = event.recurrence && event.recurrence !== "NONE" ? event.recurrence.toUpperCase() : null;
  const eventStatusMap = completions[event.id] || {};

  const nowMs = now.getTime();

  // 1. Non-recurring Event
  if (!recurrence) {
    const occurrenceKey = "single";
    const status = eventStatusMap[occurrenceKey] || null;
    const startMs = rawStart.getTime();
    const endMs = rawEnd.getTime();
    const isOverdue = nowMs > endMs && status !== "attended" && status !== "skipped";
    const isHappeningNow = nowMs >= startMs && nowMs <= endMs;

    return {
      start: rawStart,
      end: rawEnd,
      startMs,
      endMs,
      occurrenceKey,
      isRecurring: false,
      recurrenceType: null,
      status,
      isOverdue,
      isHappeningNow,
    };
  }

  // 2. Recurring Events (DAILY, WEEKLY, MONTHLY, YEARLY)
  let activeStart = new Date(rawStart);
  let occurrenceKey = formatDateKey(activeStart);

  if (recurrence === "DAILY") {
    // Current day's candidate
    const todayCandidate = new Date(now);
    todayCandidate.setHours(rawStart.getHours(), rawStart.getMinutes(), rawStart.getSeconds(), 0);

    if (todayCandidate.getTime() < rawStart.getTime()) {
      activeStart = new Date(rawStart);
    } else {
      const todayKey = formatDateKey(todayCandidate);
      const todayStatus = eventStatusMap[todayKey] || null;

      if (todayStatus === "attended" || todayStatus === "skipped") {
        // Today is resolved, advance to tomorrow
        todayCandidate.setDate(todayCandidate.getDate() + 1);
        activeStart = todayCandidate;
      } else {
        // Not resolved yet
        activeStart = todayCandidate;
      }
    }
  } else if (recurrence === "WEEKLY") {
    const targetDay = rawStart.getDay(); // 0-6
    const curDay = now.getDay();
    const diff = targetDay - curDay;

    // Nearest occurrence in the current week (might be past, today, or future)
    const thisWeekCandidate = new Date(now);
    thisWeekCandidate.setDate(now.getDate() + diff);
    thisWeekCandidate.setHours(rawStart.getHours(), rawStart.getMinutes(), rawStart.getSeconds(), 0);

    if (diff <= 0) {
      // Occurrence was earlier this week or today
      if (thisWeekCandidate.getTime() < rawStart.getTime()) {
        activeStart = new Date(rawStart);
      } else {
        const candidateEndMs = thisWeekCandidate.getTime() + durationMs;
        const candidateKey = formatDateKey(thisWeekCandidate);
        const candidateStatus = eventStatusMap[candidateKey] || null;

        if (candidateStatus === "attended" || candidateStatus === "skipped") {
          // Already resolved this week -> advance to next week
          thisWeekCandidate.setDate(thisWeekCandidate.getDate() + 7);
          activeStart = thisWeekCandidate;
        } else if (nowMs > candidateEndMs) {
          // Ended and not resolved -> Overdue this week!
          // If ended within 7 days, keep it so user can check-in or skip
          activeStart = thisWeekCandidate;
        } else {
          // Happening now or later today
          activeStart = thisWeekCandidate;
        }
      }
    } else {
      // Target day is later this week (e.g. today is Tue, event is Thu)
      // Check if last week's occurrence was missed and still needs check-in (within 7 days)
      const lastWeekCandidate = new Date(thisWeekCandidate);
      lastWeekCandidate.setDate(thisWeekCandidate.getDate() - 7);

      if (lastWeekCandidate.getTime() >= rawStart.getTime()) {
        const lastWeekEndMs = lastWeekCandidate.getTime() + durationMs;
        const lastWeekKey = formatDateKey(lastWeekCandidate);
        const lastWeekStatus = eventStatusMap[lastWeekKey] || null;

        if (!lastWeekStatus && nowMs > lastWeekEndMs && nowMs - lastWeekEndMs < 7 * 86400000) {
          // Last week ended recently and hasn't been checked in yet!
          activeStart = lastWeekCandidate;
        } else {
          activeStart = thisWeekCandidate;
        }
      } else {
        activeStart = thisWeekCandidate;
      }
    }
  } else if (recurrence === "MONTHLY") {
    const targetDateNum = rawStart.getDate();
    const thisMonthCandidate = new Date(now);
    const maxDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    thisMonthCandidate.setDate(Math.min(targetDateNum, maxDays));
    thisMonthCandidate.setHours(rawStart.getHours(), rawStart.getMinutes(), rawStart.getSeconds(), 0);

    if (thisMonthCandidate.getTime() < rawStart.getTime()) {
      activeStart = new Date(rawStart);
    } else {
      const candidateEndMs = thisMonthCandidate.getTime() + durationMs;
      const candidateKey = formatDateKey(thisMonthCandidate);
      const candidateStatus = eventStatusMap[candidateKey] || null;

      if (candidateStatus === "attended" || candidateStatus === "skipped") {
        thisMonthCandidate.setMonth(thisMonthCandidate.getMonth() + 1);
        activeStart = thisMonthCandidate;
      } else if (nowMs > candidateEndMs && nowMs - candidateEndMs > 30 * 86400000) {
        // Too old, advance
        thisMonthCandidate.setMonth(thisMonthCandidate.getMonth() + 1);
        activeStart = thisMonthCandidate;
      } else {
        activeStart = thisMonthCandidate;
      }
    }
  } else if (recurrence === "YEARLY") {
    const thisYearCandidate = new Date(now);
    thisYearCandidate.setMonth(rawStart.getMonth(), rawStart.getDate());
    thisYearCandidate.setHours(rawStart.getHours(), rawStart.getMinutes(), rawStart.getSeconds(), 0);

    if (thisYearCandidate.getTime() < rawStart.getTime()) {
      activeStart = new Date(rawStart);
    } else {
      const candidateEndMs = thisYearCandidate.getTime() + durationMs;
      const candidateKey = formatDateKey(thisYearCandidate);
      const candidateStatus = eventStatusMap[candidateKey] || null;

      if (candidateStatus === "attended" || candidateStatus === "skipped") {
        thisYearCandidate.setFullYear(thisYearCandidate.getFullYear() + 1);
        activeStart = thisYearCandidate;
      } else if (nowMs > candidateEndMs && nowMs - candidateEndMs > 60 * 86400000) {
        thisYearCandidate.setFullYear(thisYearCandidate.getFullYear() + 1);
        activeStart = thisYearCandidate;
      } else {
        activeStart = thisYearCandidate;
      }
    }
  }

  occurrenceKey = formatDateKey(activeStart);
  const activeEnd = new Date(activeStart.getTime() + durationMs);
  const startMs = activeStart.getTime();
  const endMs = activeEnd.getTime();
  const status = eventStatusMap[occurrenceKey] || null;
  const isOverdue = nowMs > endMs && status !== "attended" && status !== "skipped";
  const isHappeningNow = nowMs >= startMs && nowMs <= endMs;

  return {
    start: activeStart,
    end: activeEnd,
    startMs,
    endMs,
    occurrenceKey,
    isRecurring: true,
    recurrenceType: recurrence,
    status,
    isOverdue,
    isHappeningNow,
  };
}

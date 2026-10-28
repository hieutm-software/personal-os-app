import ICAL from "ical.js";
import { fetch } from "@tauri-apps/plugin-http";
import { eventStore } from "../../shared/eventStore.svelte";
import { toastState } from "../../shared/toast.svelte";
import type { Event } from "../../shared/db/schema";

const MAX_URL_LENGTH = 2048;
const MAX_ICAL_PAYLOAD_BYTES = 10 * 1024 * 1024;
const MAX_CALENDAR_NAME_LENGTH = 120;
const MAX_EVENT_TITLE_LENGTH = 255;
const MAX_EVENT_DESCRIPTION_LENGTH = 5000;
const MAX_EXTERNAL_ID_LENGTH = 512;

const VALID_RECURRENCE_FREQUENCIES = new Set([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
]);

const activeSyncRequests = new Map<string, Promise<void>>();
let isSyncPaused = false;

export function pauseICalSync(): void {
  isSyncPaused = true;
  activeSyncRequests.clear();
}

export function resumeICalSync(): void {
  isSyncPaused = false;
}

function validateAndNormalizeUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH || trimmed.includes("\0")) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function sanitizeText(rawText: unknown, maxLength: number, fallback = ""): string {
  if (typeof rawText !== "string") return fallback;
  const cleaned = rawText.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!cleaned) return fallback;
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

function readSyncedUrlsFromStorage(): string[] {
  try {
    const raw = localStorage.getItem("synced_ical_urls");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: string[] = [];
    const seen = new Set<string>();
    for (let i = 0, len = parsed.length; i < len; i++) {
      const item = parsed[i];
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          result.push(trimmed);
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

function persistSyncedUrl(normalizedUrl: string): void {
  try {
    const currentUrls = readSyncedUrlsFromStorage();
    if (!currentUrls.includes(normalizedUrl)) {
      currentUrls.push(normalizedUrl);
      localStorage.setItem("synced_ical_urls", JSON.stringify(currentUrls));
    }
  } catch {}
}

export async function fetchICalAndSync(url: string, silent = false): Promise<void> {
  if (isSyncPaused) return;
  const normalizedUrl = validateAndNormalizeUrl(url);
  if (!normalizedUrl) {
    if (!silent && url) {
      toastState.add("error", "Invalid calendar URL");
    }
    return;
  }

  const existingRequest = activeSyncRequests.get(normalizedUrl);
  if (existingRequest) {
    return existingRequest;
  }

  const syncTask = (async () => {
    try {
      if (!silent) toastState.add("info", "Syncing calendar...");

      const response = await fetch(normalizedUrl, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status}`);
      }

      const icalData = await response.text();
      if (!icalData || icalData.length > MAX_ICAL_PAYLOAD_BYTES) {
        throw new Error("Invalid or oversized calendar payload");
      }

      const jcalData = ICAL.parse(icalData);
      const rootComponent = new ICAL.Component(jcalData);
      const vevents = rootComponent.getAllSubcomponents("vevent");

      const rawCalName = rootComponent.getFirstPropertyValue("x-wr-calname");
      const calName = sanitizeText(rawCalName, MAX_CALENDAR_NAME_LENGTH, "Google Calendar");
      try {
        localStorage.setItem("personal-os-ical-name", calName);
      } catch {}

      const extractedEvents: Event[] = [];
      const currentTimestampMs = Date.now();
      const sourceKey = `GOOGLE::${normalizedUrl}`;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const minEndTimeMs = todayStart.getTime();

      for (let i = 0, len = vevents.length; i < len; i++) {
        try {
          const vevent = vevents[i];
          const parsedEvent = new ICAL.Event(vevent);
          const startDateObj = parsedEvent.startDate;
          if (!startDateObj) continue;

          const endDateObj = parsedEvent.endDate || startDateObj;
          const startJsDate = startDateObj.toJSDate();
          const endJsDate = endDateObj.toJSDate();

          const startMs = startJsDate.getTime();
          const endMs = endJsDate.getTime();
          if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

          const isRecurring = parsedEvent.isRecurring();
          if (!isRecurring && endMs < minEndTimeMs) continue;

          const externalId = sanitizeText(parsedEvent.uid, MAX_EXTERNAL_ID_LENGTH, "");
          if (!externalId) continue;

          const title = sanitizeText(
            parsedEvent.summary,
            MAX_EVENT_TITLE_LENGTH,
            "Untitled Event"
          );
          const description = sanitizeText(
            parsedEvent.description,
            MAX_EVENT_DESCRIPTION_LENGTH,
            ""
          );
          const isAllDay = Boolean(startDateObj.isDate);

          const startIso = startJsDate.toISOString();
          const endIso = endJsDate.toISOString();
          const startTime = isAllDay ? startIso.slice(0, 10) : startIso;
          const endTime = isAllDay ? endIso.slice(0, 10) : endIso;

          let recurrence = "NONE";
          if (isRecurring) {
            const rrule = vevent.getFirstPropertyValue("rrule") as { freq?: string } | null;
            const freq = typeof rrule?.freq === "string" ? rrule.freq.toUpperCase() : "";
            if (VALID_RECURRENCE_FREQUENCIES.has(freq)) {
              recurrence = freq;
            }
          }

          if (recurrence === "NONE" && endMs < minEndTimeMs) continue;

          extractedEvents.push({
            id: crypto.randomUUID(),
            title,
            description,
            startTime,
            endTime,
            isAllDay,
            recurrence,
            source: sourceKey,
            externalId,
            groupId: "GOOGLE_CALENDAR",
            createdAt: currentTimestampMs,
            updatedAt: currentTimestampMs,
          });
        } catch {}
      }

      extractedEvents.sort((eventA, eventB) => {
        const startA = eventA.startTime || "";
        const startB = eventB.startTime || "";
        return startA < startB ? -1 : startA > startB ? 1 : 0;
      });

      const mergedEvents: Event[] = [];
      const lastAllDayBySignature = new Map<string, Event>();

      for (let i = 0, len = extractedEvents.length; i < len; i++) {
        const currentEvent = extractedEvents[i];
        if (currentEvent.isAllDay) {
          const signature = `${currentEvent.title}\0${currentEvent.recurrence}`;
          const previousSegment = lastAllDayBySignature.get(signature);
          if (previousSegment && previousSegment.endTime === currentEvent.startTime) {
            previousSegment.endTime = currentEvent.endTime;
            continue;
          }
          lastAllDayBySignature.set(signature, currentEvent);
        }
        mergedEvents.push(currentEvent);
      }

      await eventStore.syncExternalEvents(sourceKey, mergedEvents);
      persistSyncedUrl(normalizedUrl);

      if (!silent) toastState.add("success", "Calendar synced successfully");
    } catch {
      if (!silent) toastState.add("error", "Failed to sync calendar");
    } finally {
      activeSyncRequests.delete(normalizedUrl);
    }
  })();

  activeSyncRequests.set(normalizedUrl, syncTask);
  return syncTask;
}

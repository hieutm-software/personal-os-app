<script module lang="ts">
  import type { Event } from '../db/schema';

  const BADGE_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  function getNextOccurrenceDate(event: Event): Date | null {
    try {
      if (!event.startTime) return null;
      const originalDate = new Date(event.startTime);
      if (Number.isNaN(originalDate.getTime())) return null;

      if (!event.recurrence || event.recurrence === 'NONE') return originalDate;

      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const next = new Date(originalDate);

      if (event.recurrence === 'DAILY') {
        next.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
        if (next < now) {
          next.setDate(next.getDate() + 1);
        }
        return next;
      }

      if (event.recurrence === 'WEEKLY') {
        const targetDay = originalDate.getDay();
        next.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
        const currentDay = next.getDay();
        let diff = targetDay - currentDay;
        if (diff < 0) diff += 7;
        next.setDate(next.getDate() + diff);
        return next;
      }

      if (event.recurrence === 'MONTHLY') {
        const targetDateNum = originalDate.getDate();
        next.setFullYear(now.getFullYear(), now.getMonth(), targetDateNum);
        if (next < now) {
          next.setMonth(next.getMonth() + 1);
        }
        return next;
      }

      if (event.recurrence === 'YEARLY') {
        next.setFullYear(now.getFullYear(), originalDate.getMonth(), originalDate.getDate());
        if (next < now) {
          next.setFullYear(next.getFullYear() + 1);
        }
        return next;
      }

      return originalDate;
    } catch {
      return null;
    }
  }

  function getEventDisplayDate(event: Event): string | null {
    try {
      const d = getNextOccurrenceDate(event);
      return d ? BADGE_DATE_FORMATTER.format(d) : null;
    } catch {
      return null;
    }
  }

  function formatDateBadge(isoStr: string | number | null | undefined): string | null {
    try {
      if (!isoStr) return null;
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return null;
      return BADGE_DATE_FORMATTER.format(d);
    } catch {
      return null;
    }
  }

  function formatTimeBadge(isoStr: string | null | undefined, isAllDay?: boolean | null): string | null {
    try {
      if (!isoStr || isAllDay || !isoStr.includes('T')) return null;
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return null;
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    } catch {
      return null;
    }
  }
</script>

<script lang="ts">
  import { Calendar, Repeat } from 'lucide-svelte';
  import Modal from './Modal.svelte';
  import { eventStore } from '../eventStore.svelte';

  let selectedEvent = $derived.by(() => {
    try {
      const targetId = eventStore.targetEventId;
      if (!targetId) return null;
      const allEvents = eventStore.events;
      for (let i = 0; i < allEvents.length; i++) {
        if (allEvents[i].id === targetId) return allEvents[i];
      }
      return null;
    } catch {
      return null;
    }
  });

  let isModalOpen = $state(true);

  $effect(() => {
    if (selectedEvent) {
      isModalOpen = true;
    }
  });

  $effect(() => {
    if (!isModalOpen) {
      try {
        eventStore.targetEventId = null;
      } catch {}
    }
  });
</script>

{#if selectedEvent}
  {@const modalStartDate = getEventDisplayDate(selectedEvent)}
  {@const modalStartTime = formatTimeBadge(selectedEvent.startTime, selectedEvent.isAllDay)}
  {@const modalEndDate = formatDateBadge(selectedEvent.endTime)}
  {@const modalEndTime = formatTimeBadge(selectedEvent.endTime, selectedEvent.isAllDay)}
  {@const modalIsSameDate = modalEndDate === modalStartDate}

  <Modal
    bind:isOpen={isModalOpen}
    title="Event Details"
    titleIcon={Calendar}
    titleClass="justify-center text-center w-full"
    className="max-w-md"
  >
    <div class="flex flex-col gap-4 py-2">
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title</span>
          {#if selectedEvent.recurrence && selectedEvent.recurrence !== 'NONE'}
            <span class="text-xs font-medium bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full capitalize flex items-center gap-1">
              <Repeat class="w-3 h-3" />
              {selectedEvent.recurrence.toLowerCase()}
            </span>
          {/if}
        </div>
        <div class="text-sm font-semibold text-foreground bg-black/5 dark:bg-white/5 p-3 rounded-xl border border-premium-border break-all">
          {selectedEvent.title}
        </div>
      </div>

      <div class="flex items-center flex-wrap gap-2">
        {#if modalStartDate}
          <span class="text-xs px-2.5 py-1 rounded-full border font-medium text-indigo-400 bg-indigo-500/10 border-indigo-500/20">
            {modalStartDate}
          </span>
        {/if}
        {#if modalStartTime}
          <span class="text-xs px-2.5 py-1 rounded-full border font-medium text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
            {modalStartTime}
          </span>
        {/if}
        {#if selectedEvent.endTime && (!modalIsSameDate || modalEndTime)}
          <span class="text-xs text-muted-foreground/60 font-mono">→</span>
          {#if modalEndDate && !modalIsSameDate}
            <span class="text-xs px-2.5 py-1 rounded-full border font-medium text-indigo-400 bg-indigo-500/10 border-indigo-500/20">
              {modalEndDate}
            </span>
          {/if}
          {#if modalEndTime}
            <span class="text-xs px-2.5 py-1 rounded-full border font-medium text-cyan-400 bg-cyan-500/10 border-cyan-500/20">
              {modalEndTime}
            </span>
          {/if}
        {/if}
        {#if selectedEvent.isAllDay && !modalStartTime}
          <span class="text-xs font-medium bg-indigo-500/10 text-indigo-400 px-2 py-1 rounded-full whitespace-nowrap">
            All day
          </span>
        {/if}
      </div>

      {#if selectedEvent.description}
        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</span>
          <div class="text-sm text-foreground/90 bg-black/5 dark:bg-white/5 p-3 rounded-xl border border-premium-border whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
            {selectedEvent.description}
          </div>
        </div>
      {/if}
    </div>
  </Modal>
{/if}

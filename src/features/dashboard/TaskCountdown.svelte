<script module lang="ts">
  const subscribers = new Set<(tickMs: number) => void>();
  let globalTimer: ReturnType<typeof setInterval> | null = null;

  const OVERDUE_STATE = Object.freeze({
    label: "Overdue",
    colorClass: "text-rose-500 bg-rose-500/10 border-rose-500/20 font-semibold",
    isOverdue: true
  });

  const DAYS_COLOR_CLASS = "text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20 font-medium";
  const HOURS_COLOR_CLASS = "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20 font-semibold";

  function subscribe(fn: (tickMs: number) => void): () => void {
    try {
      subscribers.add(fn);
      if (!globalTimer) {
        globalTimer = setInterval(() => {
          try {
            const tickMs = Date.now();
            for (const sub of subscribers) {
              sub(tickMs);
            }
          } catch {}
        }, 1000);
      }
      return () => {
        try {
          subscribers.delete(fn);
          if (subscribers.size === 0 && globalTimer !== null) {
            clearInterval(globalTimer);
            globalTimer = null;
          }
        } catch {}
      };
    } catch {
      return () => {};
    }
  }
</script>

<script lang="ts">
  import { Timer } from "lucide-svelte";
  import { onDestroy } from "svelte";

  let isMounted = true;
  onDestroy(() => {
    isMounted = false;
  });

  let { dueDate }: { dueDate: number } = $props();

  let now = $state(Date.now());

  $effect(() => {
    try {
      const currentNow = Date.now();
      now = currentNow;
      const safeDueDate = Number(dueDate);
      if (Number.isFinite(safeDueDate) && safeDueDate > currentNow) {
        const unsubscribe = subscribe((tickMs) => {
          if (!isMounted) return;
          now = tickMs;
          if (tickMs >= safeDueDate) {
            unsubscribe();
          }
        });
        return unsubscribe;
      }
    } catch {}
  });

  function getTaskTimeRemaining(targetMs: number, currentMs: number) {
    try {
      const tMs = Number(targetMs);
      const cMs = Number(currentMs);
      if (!Number.isFinite(tMs) || !Number.isFinite(cMs)) {
        return null;
      }

      const diff = tMs - cMs;
      if (diff <= 0) {
        return OVERDUE_STATE;
      }

      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);
      const secs = Math.floor((diff % 60000) / 1000);

      if (days >= 1) {
        return {
          label: `${days}d ${hours % 24}h left`,
          colorClass: DAYS_COLOR_CLASS,
          isOverdue: false
        };
      }

      const timeStr = hours > 0 ? `${hours}h ${mins % 60}m ${secs}s left` : `${mins % 60}m ${secs}s left`;
      return {
        label: timeStr,
        colorClass: HOURS_COLOR_CLASS,
        isOverdue: false
      };
    } catch {
      return null;
    }
  }

  let countdown = $derived(getTaskTimeRemaining(dueDate, now));
</script>

{#if countdown}
  <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium {countdown.colorClass}">
    <Timer class="w-3 h-3" />
    {countdown.label}
  </span>
{/if}

<script module lang="ts">
  const subscribers = new Set<(tickMs: number) => void>();
  let globalTimer: ReturnType<typeof setInterval> | null = null;

  const HAPPENING_NOW_STATE = Object.freeze({
    label: "Happening now",
    colorClass: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20 font-semibold",
    isOverdue: false
  });

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
        }, 60000);
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

  let { startMs, endMs }: { startMs: number; endMs: number } = $props();

  let now = $state(Date.now());

  $effect(() => {
    try {
      const currentNow = Date.now();
      now = currentNow;
      const safeEndMs = Number(endMs);
      if (Number.isFinite(safeEndMs) && safeEndMs > currentNow) {
        const unsubscribe = subscribe((tickMs) => {
          if (!isMounted) return;
          now = tickMs;
          if (tickMs >= safeEndMs) {
            unsubscribe();
          }
        });
        return unsubscribe;
      }
    } catch {}
  });

  function getEventTimeRemaining(targetStartMs: number, targetEndMs: number, currentMs: number) {
    try {
      const sMs = Number(targetStartMs);
      const eMs = Number(targetEndMs);
      const cMs = Number(currentMs);

      if (!Number.isFinite(sMs) || !Number.isFinite(eMs) || !Number.isFinite(cMs)) {
        return null;
      }

      if (cMs >= sMs && cMs <= eMs) {
        return HAPPENING_NOW_STATE;
      }
      if (cMs > eMs) {
        return OVERDUE_STATE;
      }

      const diff = sMs - cMs;
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(mins / 60);
      const days = Math.floor(hours / 24);

      if (days >= 1) {
        return {
          label: `In ${days}d ${hours % 24}h`,
          colorClass: DAYS_COLOR_CLASS,
          isOverdue: false
        };
      }

      const timeStr = hours > 0 ? `In ${hours}h ${mins % 60}m` : `In ${mins % 60}m`;
      return {
        label: timeStr,
        colorClass: HOURS_COLOR_CLASS,
        isOverdue: false
      };
    } catch {
      return null;
    }
  }

  let countdown = $derived(getEventTimeRemaining(startMs, endMs, now));
</script>

{#if countdown}
  <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium {countdown.colorClass}">
    <Timer class="w-3 h-3" />
    {countdown.label}
  </span>
{/if}

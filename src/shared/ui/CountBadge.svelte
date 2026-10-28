<script lang="ts">
  let {
    count,
    class: className = 'bg-muted/70 text-muted-foreground',
    title,
    max = 999,
    showZero = false,
  }: {
    count: number | string;
    class?: string;
    title?: string;
    max?: number;
    showZero?: boolean;
  } = $props();

  let numericCount = $derived.by(() => {
    if (typeof count === 'number') return count;
    if (typeof count === 'string') {
      const parsed = Number(count.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  });

  let isVisible = $derived.by(() => {
    if (showZero) return true;
    if (numericCount !== null) {
      return numericCount > 0;
    }
    return Boolean(count && count !== '0' && count !== '');
  });

  let displayCount = $derived.by(() => {
    if (typeof count === 'number') {
      if (max && count > max) return `${max}+`;
      return count.toString();
    }
    return count ?? '0';
  });

  let isSingleChar = $derived(displayCount.length === 1);
</script>

{#if isVisible}
  <span
    class="inline-flex items-center justify-center shrink-0 {isSingleChar ? 'w-4.5' : 'min-w-4.5 px-1'} h-4.5 text-xs font-semibold leading-none rounded-full tabular-nums text-center select-none {className}"
    {title}
  >
    <span class="inline-block" style="transform: translate(0.5px, 1px);">
      {displayCount}
    </span>
  </span>
{/if}

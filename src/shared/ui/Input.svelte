<script module lang="ts">
  export type Variant = 'default' | 'form' | 'search';

  const BASE_CLASSES =
    'flex w-full border transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

  const VARIANT_CLASSES: Readonly<Record<Variant, string>> = Object.freeze({
    default:
      'h-9 rounded-md border-input bg-white/80 dark:bg-black/40 px-3 py-1 text-base shadow-sm focus-visible:ring-1 focus-visible:ring-ring md:text-sm',
    form:
      'rounded-xl border-black/8 dark:border-premium-border bg-white/90 dark:bg-black/20 px-4 py-3 text-sm font-medium text-premium-text shadow-sm focus:border-indigo-500/50 focus:bg-white dark:focus:bg-premium-dark focus:outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder:text-zinc-400',
    search:
      'h-9 rounded-full border-black/8 dark:border-premium-border bg-black/5 dark:bg-card px-3 py-1 text-base shadow-sm focus-visible:ring-1 focus-visible:ring-ring md:text-sm'
  });
</script>

<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    value = $bindable(''),
    variant = 'default',
    class: className = '',
    ...rest
  }: HTMLInputAttributes & {
    value?: string | number | undefined;
    variant?: Variant;
    class?: string;
  } = $props();
</script>

<input
  bind:value
  spellcheck={false}
  autocorrect="off"
  autocapitalize="off"
  style="accent-color: var(--primary);"
  class="{BASE_CLASSES} {VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.default} {className}"
  {...rest}
/>

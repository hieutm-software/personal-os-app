<script module lang="ts">
  export type Variant = 'default' | 'form';

  const BASE_CLASSES =
    'flex w-full border transition-colors placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 min-h-20 max-h-72 resize-y';

  const VARIANT_CLASSES: Readonly<Record<Variant, string>> = Object.freeze({
    default:
      'rounded-md border-input bg-white/80 dark:bg-black/40 px-3 py-2 text-base shadow-sm focus-visible:ring-1 focus-visible:ring-ring md:text-sm',
    form:
      'rounded-xl border-black/8 dark:border-premium-border bg-white/90 dark:bg-black/20 px-4 py-3 text-sm font-medium text-premium-text shadow-sm focus:border-indigo-500/50 focus:bg-white dark:focus:bg-premium-dark focus:outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder:text-zinc-400'
  });
</script>

<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';

  let {
    value = $bindable(''),
    variant = 'default',
    class: className = '',
    ...rest
  }: HTMLTextareaAttributes & {
    value?: string | number | undefined;
    variant?: Variant;
    class?: string;
  } = $props();
</script>

<textarea
  bind:value
  spellcheck={false}
  autocapitalize="off"
  style="accent-color: var(--primary);"
  class="{BASE_CLASSES} {VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.default} {className}"
  {...rest}
></textarea>

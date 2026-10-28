<script module lang="ts">
  export type Variant =
    | 'default'
    | 'destructive'
    | 'destructive-outline'
    | 'success-outline'
    | 'warning-outline'
    | 'success-soft'
    | 'warning-soft'
    | 'outline'
    | 'secondary'
    | 'ghost'
    | 'link'
    | 'premium'
    | 'premium-outline';

  export type Size = 'default' | 'sm' | 'lg' | 'icon';

  const BASE_CLASSES =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0';

  const VARIANT_CLASSES: Readonly<Record<Variant, string>> = Object.freeze({
    default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm',
    'destructive-outline':
      'border border-input bg-background text-destructive hover:bg-destructive/10 hover:border-destructive/30 shadow-sm',
    'success-outline':
      'border border-emerald-500/50 bg-transparent text-emerald-500 hover:bg-emerald-500/10 shadow-sm',
    'warning-outline':
      'border border-amber-500/50 bg-transparent text-amber-500 hover:bg-amber-500/10 shadow-sm',
    'success-soft':
      'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25',
    'warning-soft':
      'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25',
    outline:
      'border border-input bg-background hover:bg-accent hover:text-accent-foreground shadow-sm',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm',
    ghost: 'hover:bg-accent hover:text-accent-foreground',
    link: 'text-primary underline-offset-4 hover:underline',
    premium: 'rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm transition-all',
    'premium-outline':
      'rounded-lg border border-black/8 dark:border-premium-border bg-white/90 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 shadow-sm hover:bg-white dark:hover:bg-white/10 hover:text-indigo-500 dark:hover:text-indigo-400 transition-all'
  });

  const SIZE_CLASSES: Readonly<Record<Size, string>> = Object.freeze({
    default: 'h-9 px-4 py-2',
    sm: 'h-8 rounded-md px-3 text-sm',
    lg: 'h-10 rounded-md px-8',
    icon: 'h-9 w-9'
  });
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    onclick,
    ondblclick,
    variant = 'default',
    size = 'default',
    disabled = false,
    type = 'button',
    title,
    'aria-label': ariaLabel,
    class: className = '',
    ref = $bindable(null),
    children
  }: {
    onclick?: (e: MouseEvent) => void;
    ondblclick?: (e: MouseEvent) => void;
    variant?: Variant;
    size?: Size;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    title?: string;
    'aria-label'?: string;
    class?: string;
    ref?: HTMLButtonElement | null;
    children?: Snippet;
  } = $props();

  function handleClick(e: MouseEvent) {
    try {
      if (onclick) onclick(e);
    } catch {}
  }

  function handleDoubleClick(e: MouseEvent) {
    try {
      if (ondblclick) ondblclick(e);
    } catch {}
  }
</script>

<button
  bind:this={ref}
  {type}
  class="{BASE_CLASSES} {VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.default} {SIZE_CLASSES[size] ?? SIZE_CLASSES.default} {className}"
  {disabled}
  {title}
  aria-label={ariaLabel}
  onclick={onclick ? handleClick : undefined}
  ondblclick={ondblclick ? handleDoubleClick : undefined}
>
  {#if children}
    {@render children()}
  {/if}
</button>

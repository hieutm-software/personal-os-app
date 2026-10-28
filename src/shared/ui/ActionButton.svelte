<script module lang="ts">
  export type ActionType = 'default' | 'delete' | 'restore' | 'edit' | 'view' | 'download';

  const ACTION_TYPE_CLASSES: Readonly<Record<ActionType, string>> = Object.freeze({
    default: 'hover:bg-muted-foreground/10 hover:text-foreground',
    delete: 'hover:bg-destructive/10 hover:text-destructive',
    restore: 'hover:bg-emerald-500/10 hover:text-emerald-500',
    edit: 'hover:bg-blue-500/10 hover:text-blue-500',
    view: 'hover:bg-cyan-500/10 hover:text-cyan-500',
    download: 'hover:bg-indigo-500/10 hover:text-indigo-500'
  });
</script>

<script lang="ts">
  import type { ComponentType, Snippet } from 'svelte';
  import Button from './Button.svelte';

  let {
    onclick,
    onClick,
    actionType,
    variant,
    title,
    disabled = false,
    class: className = '',
    icon: IconComponent,
    children
  }: {
    onclick?: (e: MouseEvent) => void;
    onClick?: (e: MouseEvent) => void;
    actionType?: ActionType;
    variant?: ActionType;
    title?: string;
    disabled?: boolean;
    class?: string;
    icon?: ComponentType;
    children?: Snippet;
  } = $props();

  let finalActionType = $derived<ActionType>(actionType || variant || 'default');
  let typeClass = $derived(ACTION_TYPE_CLASSES[finalActionType] ?? ACTION_TYPE_CLASSES.default);

  function handleActionClick(e: MouseEvent) {
    try {
      const handler = onclick || onClick;
      if (handler) handler(e);
    } catch {}
  }
</script>

<Button
  variant="ghost"
  size="icon"
  {disabled}
  {title}
  onclick={onclick || onClick ? handleActionClick : undefined}
  class="h-8 w-8 shrink-0 text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring {typeClass} {className}"
>
  {#if children}
    {@render children()}
  {:else if IconComponent}
    <IconComponent class="w-4 h-4" />
  {/if}
</Button>

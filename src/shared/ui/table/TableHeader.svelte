<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className = '',
    onclick: onclickProp,
    ...rest
  }: {
    children?: Snippet;
    class?: string;
    onclick?: (e: MouseEvent) => void;
  } & HTMLAttributes<HTMLTableSectionElement> = $props();

  function handleClick(e: MouseEvent) {
    try {
      if (onclickProp) onclickProp(e);
    } catch {}
  }
</script>

<thead
  class="sticky top-0 z-20 bg-background shadow-sm text-xs text-muted-foreground [&_tr]:hover:bg-transparent [&_tr]:cursor-default {className}"
  onclick={onclickProp ? handleClick : undefined}
  {...rest}
>
  {#if children}
    {@render children()}
  {/if}
</thead>

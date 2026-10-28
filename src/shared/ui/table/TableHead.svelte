<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLThAttributes } from 'svelte/elements';

  let {
    children,
    class: className = '',
    onclick: onclickProp,
    'aria-sort': ariaSort,
    ...rest
  }: {
    children?: Snippet;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    'aria-sort'?: 'ascending' | 'descending' | 'none';
  } & HTMLThAttributes = $props();

  function handleClick(e: MouseEvent) {
    try {
      if (onclickProp) onclickProp(e);
    } catch {}
  }
</script>

<th
  scope="col"
  class="group/head px-3.5 py-2.5 font-medium align-middle bg-background sticky top-1 border-b border-premium-border z-10 has-[[role=checkbox]]:pr-0 [&.cursor-pointer]:hover:bg-accent before:absolute before:inset-x-0 before:-top-1 before:h-1.5 before:bg-background before:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-1 after:bg-background after:pointer-events-none {className}"
  onclick={onclickProp ? handleClick : undefined}
  aria-sort={ariaSort}
  {...rest}
>
  {#if children}
    {@render children()}
  {/if}
</th>

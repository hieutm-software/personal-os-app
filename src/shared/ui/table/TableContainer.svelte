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
  } & HTMLAttributes<HTMLDivElement> = $props();

  function handleClick(e: MouseEvent) {
    try {
      if (onclickProp) onclickProp(e);
    } catch {}
  }
</script>

<div
  class="flex-1 overflow-auto overscroll-none bg-transparent px-2 sm:px-4 {className}"
  onclick={onclickProp ? handleClick : undefined}
  role="region"
  aria-label="Data Table"
  {...rest}
>
  {#if children}
    {@render children()}
  {/if}
</div>

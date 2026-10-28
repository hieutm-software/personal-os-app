<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLTdAttributes } from 'svelte/elements';

  let {
    children,
    class: className = '',
    colspan,
    ...rest
  }: {
    children?: Snippet;
    class?: string;
    colspan?: number;
  } & HTMLTdAttributes = $props();

  let safeColspan = $derived(
    typeof colspan === 'number' && Number.isInteger(colspan) && colspan > 0 ? colspan : undefined
  );
</script>

<td
  class="px-3.5 py-2.5 align-middle [&:has([role=checkbox])]:pr-0 {className}"
  colspan={safeColspan}
  {...rest}
>
  {#if children}
    {@render children()}
  {/if}
</td>

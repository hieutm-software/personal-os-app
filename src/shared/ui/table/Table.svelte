<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLTableAttributes } from 'svelte/elements';

  let {
    children,
    class: className = '',
    ...rest
  }: {
    children?: Snippet;
    class?: string;
  } & HTMLTableAttributes = $props();
</script>

<table
  class="w-full text-sm text-left select-none table-fixed border-separate border-spacing-y-1 {className}"
  {...rest}
>
  {#if children}
    {@render children()}
  {/if}
</table>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    children,
    class: className = '',
    ...rest
  }: {
    children?: Snippet;
    class?: string;
  } & HTMLAttributes<HTMLTableSectionElement> = $props();
</script>

<tbody class="divide-y divide-border/50 relative {className}" {...rest}>
  {#if children}
    {@render children()}
  {/if}
</tbody>

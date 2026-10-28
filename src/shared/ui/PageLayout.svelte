<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className = ''
  }: {
    children?: Snippet;
    class?: string;
  } = $props();
</script>

<div class="flex flex-col h-full bg-background overflow-hidden {className}">
  {#if children}
    {@render children()}
  {/if}
</div>

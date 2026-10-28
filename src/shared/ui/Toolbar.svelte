<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    search,
    actions,
    class: className = ''
  }: {
    search?: Snippet;
    actions?: Snippet;
    class?: string;
  } = $props();
</script>

<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 lg:px-6 border-b border-white/5 bg-transparent {className}">
  <div class="flex-1 min-w-0 w-full sm:w-auto">
    {#if search}
      {@render search()}
    {/if}
  </div>
  <div class="flex items-center gap-2 overflow-x-auto hide-scrollbar w-full sm:w-auto p-1 -m-1">
    {#if actions}
      {@render actions()}
    {/if}
  </div>
</div>

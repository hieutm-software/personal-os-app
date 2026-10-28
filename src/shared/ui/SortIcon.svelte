<script lang="ts">
  import { ChevronUp, ChevronDown } from 'lucide-svelte';

  let {
    active,
    direction,
    class: className = ''
  }: {
    active: boolean;
    direction: 'asc' | 'desc';
    class?: string;
  } = $props();
</script>

{#if !active}
  <ChevronDown class="w-3.5 h-3.5 opacity-0 group-hover:opacity-40 group-hover/head:opacity-40 transition-opacity {className}" />
{:else if direction === 'asc'}
  <ChevronUp class="w-3.5 h-3.5 text-muted-foreground {className}" />
{:else}
  <ChevronDown class="w-3.5 h-3.5 text-muted-foreground {className}" />
{/if}

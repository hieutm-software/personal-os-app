<script lang="ts">
  import { Search, X } from 'lucide-svelte';
  import Input from './Input.svelte';

  let {
    value = $bindable(''),
    placeholder = 'Search...',
    class: className = '',
    containerClass = ''
  }: {
    value?: string;
    placeholder?: string;
    class?: string;
    containerClass?: string;
  } = $props();

  function clearSearch() {
    try {
      value = '';
    } catch {}
  }
</script>

<div class="relative group flex items-center {containerClass}">
  <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
  <Input
    type="text"
    variant="search"
    {placeholder}
    bind:value
    class="w-full pl-9 pr-8 {className}"
  />
  {#if value}
    <button
      type="button"
      onclick={clearSearch}
      class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors outline-none"
      title="Clear search"
      aria-label="Clear search"
    >
      <X class="w-3.5 h-3.5" />
    </button>
  {/if}
</div>

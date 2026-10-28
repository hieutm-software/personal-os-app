<script lang="ts">
  import type { ComponentType } from 'svelte';

  type TabItem = {
    value: string;
    label: string;
    icon?: ComponentType;
  };

  let {
    tabs,
    value = $bindable(),
    onValueChange,
    class: className = ''
  }: {
    tabs: TabItem[];
    value: string;
    onValueChange?: (val: string) => void;
    class?: string;
  } = $props();

  function handleClick(val: string) {
    try {
      if (onValueChange) onValueChange(val);
      else value = val;
    } catch {}
  }
</script>

<div
  class="inline-flex shrink-0 items-center gap-1 w-fit bg-card p-1.5 rounded-full border border-black/8 dark:border-premium-border {className}"
>
  {#each tabs as tab (tab.value)}
    {@const isActive = value === tab.value}
    {@const Icon = tab.icon}
    <button
      type="button"
      onclick={() => handleClick(tab.value)}
      title={tab.label}
      aria-label={tab.label}
      class="shrink-0 whitespace-nowrap flex items-center justify-center gap-1.5 rounded-full px-3.5 sm:px-4 py-1.5 text-sm font-medium transition-colors outline-none cursor-pointer {isActive ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10 hover:text-foreground'}"
    >
      {#if Icon}
        <Icon class="w-4 h-4 shrink-0" />
      {/if}
      <span class="inline shrink-0">{tab.label}</span>
    </button>
  {/each}
</div>


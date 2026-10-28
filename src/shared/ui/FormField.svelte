<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    id,
    error,
    class: className = '',
    children
  }: {
    label?: string;
    id?: string;
    error?: string;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="space-y-2 {className}">
  {#if label}
    <label for={id} class="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-1">
      {label}
    </label>
  {/if}
  {#if children}
    {@render children()}
  {/if}
  {#if error}
    <p class="text-xs text-destructive px-1">{error}</p>
  {/if}
</div>

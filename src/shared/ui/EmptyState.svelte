<script lang="ts">
  import type { ComponentType } from 'svelte';

  let {
    icon: Icon,
    title,
    description,
    size = 'md',
    class: className = ''
  }: {
    icon: ComponentType;
    title: string;
    description?: string;
    size?: 'sm' | 'md' | 'lg';
    class?: string;
  } = $props();

  const iconSizes = {
    sm: 'w-10 h-10 mb-2',
    md: 'w-14 h-14 mb-4',
    lg: 'w-20 h-20 mb-5'
  };

  const titleSizes = {
    sm: 'text-sm font-semibold text-foreground',
    md: 'text-base sm:text-lg font-semibold text-foreground',
    lg: 'text-xl sm:text-2xl font-semibold text-foreground'
  };

  const descSizes = {
    sm: 'text-xs text-muted-foreground mt-1 max-w-xs',
    md: 'text-sm text-muted-foreground mt-1.5 max-w-sm',
    lg: 'text-sm text-muted-foreground mt-2 max-w-md'
  };
</script>

<div class="flex flex-col items-center justify-center w-full h-full min-h-36 text-center px-4 select-none {className}">
  {#if Icon}
    <Icon class="{iconSizes[size] || iconSizes.md} text-muted-foreground/60 transition-colors" strokeWidth={1.2} />
  {/if}
  <h3 class="{titleSizes[size] || titleSizes.md}">{title}</h3>
  {#if description}
    <p class="{descSizes[size] || descSizes.md}">
      {description}
    </p>
  {/if}
</div>

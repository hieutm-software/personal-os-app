<script module lang="ts">
  const ALIGN_CLASSES: Readonly<Record<'start' | 'end' | 'center', string>> = Object.freeze({
    start: 'left-0',
    end: 'right-0',
    center: 'left-1/2 -translate-x-1/2'
  });

  const TRANSITION_PARAMS = Object.freeze({ duration: 150, start: 0.95 });
</script>

<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { scale } from 'svelte/transition';
  import { POPOVER_CONTEXT_KEY, type PopoverContext } from './index';

  let {
    children,
    class: className = '',
    align = 'center'
  }: {
    children?: Snippet;
    class?: string;
    align?: 'start' | 'end' | 'center';
  } = $props();

  const ctx = getContext<PopoverContext | undefined>(POPOVER_CONTEXT_KEY);

  let alignClass = $derived(ALIGN_CLASSES[align] ?? ALIGN_CLASSES.center);
</script>

{#if ctx?.open}
  <div
    role="dialog"
    tabindex="-1"
    class="absolute top-full mt-2 z-50 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-2xl outline-none overflow-hidden {alignClass} {className}"
    transition:scale={TRANSITION_PARAMS}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}

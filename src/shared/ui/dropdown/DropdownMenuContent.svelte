<script module lang="ts">
  const ALIGN_CLASSES: Readonly<Record<'start' | 'end' | 'center', string>> = Object.freeze({
    start: 'left-0',
    end: 'right-0',
    center: 'left-1/2 -translate-x-1/2'
  });

  const SIDE_CLASSES: Readonly<Record<'top' | 'bottom', string>> = Object.freeze({
    top: 'bottom-full mb-2 origin-bottom',
    bottom: 'top-full mt-2 origin-top'
  });

  const TRANSITION_PARAMS = Object.freeze({ duration: 150, start: 0.95 });
</script>

<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { scale } from 'svelte/transition';
  import { DROPDOWN_MENU_CONTEXT_KEY, type DropdownMenuContext } from './index';

  let {
    children,
    class: className = '',
    align = 'end',
    side = 'bottom'
  }: {
    children?: Snippet;
    class?: string;
    align?: 'start' | 'end' | 'center';
    side?: 'top' | 'bottom';
  } = $props();

  const ctx = getContext<DropdownMenuContext | undefined>(DROPDOWN_MENU_CONTEXT_KEY);

  function contentRefAction(node: HTMLElement) {
    ctx?.registerContent(node);
    return {
      destroy() {
        ctx?.registerContent(null);
      }
    };
  }

  let alignClass = $derived(ALIGN_CLASSES[align] ?? ALIGN_CLASSES.start);
  let sideClass = $derived(SIDE_CLASSES[side] ?? SIDE_CLASSES.bottom);
</script>

{#if ctx?.open}
  <div
    use:contentRefAction
    role="menu"
    tabindex="-1"
    class="absolute z-50 min-w-32 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-2xl {alignClass} {sideClass} {className}"
    transition:scale={TRANSITION_PARAMS}
  >
    {#if children}
      {@render children()}
    {/if}
  </div>
{/if}

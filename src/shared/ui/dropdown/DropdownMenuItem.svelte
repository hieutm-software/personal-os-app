<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { DROPDOWN_MENU_CONTEXT_KEY, type DropdownMenuContext } from './index';

  let {
    children,
    class: className = '',
    onclick,
    disabled = false
  }: {
    children?: Snippet;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
  } = $props();

  const ctx = getContext<DropdownMenuContext | undefined>(DROPDOWN_MENU_CONTEXT_KEY);

  function handleClick(e: MouseEvent) {
    try {
      if (disabled) return;
      if (onclick) onclick(e);
      if (ctx) {
        ctx.closeAndFocusTrigger();
      }
    } catch {}
  }
</script>

<button
  type="button"
  role="menuitem"
  class="relative flex w-full min-w-0 overflow-hidden cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 {className}"
  {disabled}
  onclick={handleClick}
>
  {#if children}
    {@render children()}
  {/if}
</button>

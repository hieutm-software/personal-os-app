<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { DROPDOWN_MENU_CONTEXT_KEY, type DropdownMenuContext } from './index';

  let {
    children,
    class: className = '',
    disabled = false
  }: {
    children?: Snippet;
    class?: string;
    disabled?: boolean;
  } = $props();

  const ctx = getContext<DropdownMenuContext | undefined>(DROPDOWN_MENU_CONTEXT_KEY);

  function triggerRefAction(node: HTMLElement) {
    ctx?.registerTrigger(node);
    return {
      destroy() {
        ctx?.registerTrigger(null);
      }
    };
  }

  function toggle() {
    try {
      if (disabled || !ctx) return;
      ctx.toggleMenu();
    } catch {}
  }

  function handleKeydown(e: KeyboardEvent) {
    try {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    } catch {}
  }
</script>

<div
  use:triggerRefAction
  class="{className} {disabled ? 'pointer-events-none cursor-default' : ''}"
  onclick={toggle}
  onkeydown={handleKeydown}
  role="button"
  tabindex={disabled ? -1 : 0}
  aria-disabled={disabled}
  aria-haspopup="menu"
  aria-expanded={ctx?.open ?? false}
>
  {#if children}
    {@render children()}
  {/if}
</div>

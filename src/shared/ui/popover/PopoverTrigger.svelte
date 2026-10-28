<script lang="ts">
  import { getContext, type Snippet } from 'svelte';
  import { POPOVER_CONTEXT_KEY, type PopoverContext } from './index';

  let {
    children,
    class: className = '',
    disabled = false,
    onclick
  }: {
    children?: Snippet;
    class?: string;
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
  } = $props();

  const ctx = getContext<PopoverContext | undefined>(POPOVER_CONTEXT_KEY);

  function triggerRefAction(node: HTMLElement) {
    ctx?.registerTrigger(node);
    return {
      destroy() {
        ctx?.registerTrigger(null);
      }
    };
  }

  function handleTriggerActivate(e?: MouseEvent) {
    try {
      if (disabled) return;
      ctx?.toggle();
      if (onclick && e) onclick(e);
    } catch {}
  }

  function handleKeydown(e: KeyboardEvent) {
    try {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTriggerActivate(e as unknown as MouseEvent);
      }
    } catch {}
  }
</script>

<div
  use:triggerRefAction
  class="{className} {disabled ? 'pointer-events-none cursor-default' : ''}"
  onclick={handleTriggerActivate}
  onkeydown={handleKeydown}
  role="button"
  tabindex={disabled ? -1 : 0}
  aria-disabled={disabled}
  aria-haspopup="dialog"
  aria-expanded={ctx?.open ?? false}
>
  {#if children}
    {@render children()}
  {/if}
</div>

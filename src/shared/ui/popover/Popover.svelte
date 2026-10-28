<script lang="ts">
  import { setContext, onDestroy, type Snippet } from 'svelte';
  import type { Subscriber, Unsubscriber, Updater, Writable } from 'svelte/store';
  import { POPOVER_CONTEXT_KEY, type PopoverContext } from './index';

  let {
    children,
    class: className = '',
    open = $bindable(false)
  }: {
    children?: Snippet;
    class?: string;
    open?: boolean;
  } = $props();

  let container: HTMLElement | undefined = $state();
  let triggerElement: HTMLElement | null = null;
  let focusTimeout: ReturnType<typeof setTimeout> | null = null;

  const storeSubscribers = new Set<Subscriber<boolean>>();

  function setOpenState(nextValue: boolean) {
    const normalized = Boolean(nextValue);
    if (open === normalized) return;
    open = normalized;
    if (storeSubscribers.size > 0) {
      for (const sub of storeSubscribers) {
        try {
          sub(open);
        } catch {}
      }
    }
  }

  $effect(() => {
    const current = Boolean(open);
    if (storeSubscribers.size > 0) {
      for (const sub of storeSubscribers) {
        try {
          sub(current);
        } catch {}
      }
    }
  });

  const isOpenStore: Writable<boolean> = {
    subscribe(run: Subscriber<boolean>): Unsubscriber {
      storeSubscribers.add(run);
      try {
        run(Boolean(open));
      } catch {}
      return () => {
        storeSubscribers.delete(run);
      };
    },
    set(value: boolean) {
      setOpenState(value);
    },
    update(updater: Updater<boolean>) {
      try {
        setOpenState(updater(Boolean(open)));
      } catch {}
    }
  };

  function clearFocusTimeout() {
    if (focusTimeout !== null) {
      clearTimeout(focusTimeout);
      focusTimeout = null;
    }
  }

  function resolveTriggerFocusable(): HTMLElement | null {
    if (triggerElement) {
      const innerBtn = triggerElement.querySelector<HTMLElement>('button:not([disabled]), [role="button"]');
      return innerBtn ?? triggerElement;
    }
    if (container) {
      return container.querySelector<HTMLElement>('[role="button"], button:not([disabled])');
    }
    return null;
  }

  function closeAndFocusTrigger() {
    try {
      setOpenState(false);
      clearFocusTimeout();
      focusTimeout = setTimeout(() => {
        focusTimeout = null;
        try {
          resolveTriggerFocusable()?.focus();
        } catch {}
      }, 10);
    } catch {}
  }

  const contextValue: PopoverContext = {
    get open() {
      return Boolean(open);
    },
    isOpen: isOpenStore,
    setOpen: setOpenState,
    toggle() {
      setOpenState(!open);
    },
    closeAndFocusTrigger,
    registerTrigger(node: HTMLElement | null) {
      triggerElement = node;
    }
  };

  setContext<PopoverContext>(POPOVER_CONTEXT_KEY, contextValue);

  function handleOutsideClick(e: MouseEvent) {
    if (!open) return;
    try {
      const target = e.target as Node | null;
      if (container && target && !container.contains(target)) {
        setOpenState(false);
      }
    } catch {}
  }

  function handleFocusIn() {
    if (!open) return;
    try {
      const active = document.activeElement;
      if (container && active && !container.contains(active)) {
        setOpenState(false);
      }
    } catch {}
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    try {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeAndFocusTrigger();
      }
    } catch {}
  }

  $effect(() => {
    if (!open || typeof window === 'undefined') return;
    window.addEventListener('click', handleOutsideClick, true);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('click', handleOutsideClick, true);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  onDestroy(() => {
    clearFocusTimeout();
    storeSubscribers.clear();
    triggerElement = null;
  });
</script>

<div bind:this={container} class="relative w-full text-left {className}">
  {#if children}
    {@render children()}
  {/if}
</div>

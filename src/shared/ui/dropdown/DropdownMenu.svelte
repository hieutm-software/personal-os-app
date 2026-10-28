<script lang="ts">
  import { setContext, onDestroy, type Snippet } from 'svelte';
  import type { Subscriber, Unsubscriber, Updater, Writable } from 'svelte/store';
  import { DROPDOWN_MENU_CONTEXT_KEY, type DropdownMenuContext } from './index';

  let {
    children,
    class: className = ''
  }: {
    children?: Snippet;
    class?: string;
  } = $props();

  let openState = $state(false);
  let container: HTMLElement | undefined = $state();
  let triggerElement: HTMLElement | null = null;
  let contentElement: HTMLElement | null = null;
  let focusTimeout: ReturnType<typeof setTimeout> | null = null;

  const storeSubscribers = new Set<Subscriber<boolean>>();

  function setOpenState(nextValue: boolean) {
    const normalized = Boolean(nextValue);
    if (openState === normalized) return;
    openState = normalized;
    if (storeSubscribers.size > 0) {
      for (const sub of storeSubscribers) {
        try {
          sub(openState);
        } catch {}
      }
    }
  }

  const isOpenStore: Writable<boolean> = {
    subscribe(run: Subscriber<boolean>): Unsubscriber {
      storeSubscribers.add(run);
      try {
        run(openState);
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
        setOpenState(updater(openState));
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

  function getMenuItems(): HTMLButtonElement[] {
    const scope = contentElement ?? container;
    if (!scope) return [];
    const nodeList = scope.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]:not([disabled]), button:not([disabled])'
    );
    const items: HTMLButtonElement[] = [];
    for (let i = 0; i < nodeList.length; i++) {
      const btn = nodeList[i];
      if (!triggerElement || !triggerElement.contains(btn)) {
        items.push(btn);
      }
    }
    return items;
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

  const contextValue: DropdownMenuContext = {
    get open() {
      return openState;
    },
    isOpen: isOpenStore,
    openMenu() {
      setOpenState(true);
    },
    closeMenu() {
      setOpenState(false);
    },
    toggleMenu() {
      setOpenState(!openState);
    },
    closeAndFocusTrigger,
    registerTrigger(node: HTMLElement | null) {
      triggerElement = node;
    },
    registerContent(node: HTMLElement | null) {
      contentElement = node;
    }
  };

  setContext<DropdownMenuContext>(DROPDOWN_MENU_CONTEXT_KEY, contextValue);

  function handleOutsideClick(e: MouseEvent) {
    try {
      if (!openState) return;
      const target = e.target as Node | null;
      if (container && target && !container.contains(target)) {
        setOpenState(false);
      }
    } catch {}
  }

  function handleFocusIn() {
    try {
      if (!openState) return;
      const active = document.activeElement;
      if (container && active && !container.contains(active)) {
        setOpenState(false);
      }
    } catch {}
  }

  function handleKeydown(e: KeyboardEvent) {
    try {
      const key = e.key;
      if (!openState && key !== 'ArrowDown' && key !== 'ArrowUp') return;
      if (!container || !container.contains(document.activeElement)) return;

      if (key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeAndFocusTrigger();
        return;
      }

      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
        e.preventDefault();
        if (!openState) {
          setOpenState(true);
          clearFocusTimeout();
          focusTimeout = setTimeout(() => {
            focusTimeout = null;
            try {
              const items = getMenuItems();
              if (items.length > 0) {
                const targetIdx = key === 'ArrowUp' || key === 'End' ? items.length - 1 : 0;
                items[targetIdx]?.focus();
              }
            } catch {}
          }, 25);
          return;
        }

        const items = getMenuItems();
        const count = items.length;
        if (count === 0) return;

        if (key === 'Home') {
          items[0]?.focus();
          return;
        }
        if (key === 'End') {
          items[count - 1]?.focus();
          return;
        }

        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        if (key === 'ArrowDown') {
          const nextIndex = currentIndex < 0 || currentIndex >= count - 1 ? 0 : currentIndex + 1;
          items[nextIndex]?.focus();
        } else {
          const prevIndex = currentIndex <= 0 ? count - 1 : currentIndex - 1;
          items[prevIndex]?.focus();
        }
      }
    } catch {}
  }

  $effect(() => {
    if (!openState || typeof window === 'undefined') return;
    window.addEventListener('click', handleOutsideClick, true);
    window.addEventListener('focusin', handleFocusIn);
    return () => {
      window.removeEventListener('click', handleOutsideClick, true);
      window.removeEventListener('focusin', handleFocusIn);
    };
  });

  onDestroy(() => {
    clearFocusTimeout();
    storeSubscribers.clear();
    triggerElement = null;
    contentElement = null;
  });
</script>

<div
  bind:this={container}
  onkeydown={handleKeydown}
  class="relative inline-block text-left {className}"
  role="presentation"
>
  {#if children}
    {@render children()}
  {/if}
</div>

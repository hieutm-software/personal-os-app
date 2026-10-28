<script module lang="ts">
  import { cubicOut } from 'svelte/easing';

  const SCALE_IN_PARAMS = Object.freeze({ duration: 200, start: 0.95, easing: cubicOut });
  const FIRST_INPUT_SELECTOR =
    'input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly])';
  const FOCUSABLE_SELECTOR =
    'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), textarea:not([disabled]), button:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';
</script>

<script lang="ts">
  import { scale } from 'svelte/transition';
  import { onDestroy } from 'svelte';
  import type { Snippet } from 'svelte';

  let {
    isOpen = $bindable(false),
    title,
    submitText = 'Create',
    submitDisabled = false,
    isDirty: isDirtyProp,
    onSubmit,
    children
  }: {
    isOpen: boolean;
    title: string;
    submitText?: string;
    submitDisabled?: boolean;
    isDirty?: boolean;
    onSubmit: () => void | Promise<void>;
    children?: Snippet;
  } = $props();

  let modalRef = $state<HTMLDivElement | null>(null);
  let isSubmitting = $state(false);
  let isConfirmDiscardOpen = $state(false);
  let userHasTyped = $state(false);
  let focusTimeout: ReturnType<typeof setTimeout> | null = null;
  const initialValuesMap = new Map<HTMLElement, string | boolean>();

  function clearFocusTimeout() {
    if (focusTimeout !== null) {
      clearTimeout(focusTimeout);
      focusTimeout = null;
    }
  }

  function snapshotInitialValues() {
    initialValuesMap.clear();
    userHasTyped = false;
    if (!modalRef) return;
    const form = modalRef.querySelector('form');
    if (!form) return;
    const elements = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]), textarea, select'
    );
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        initialValuesMap.set(el, el.checked);
      } else {
        initialValuesMap.set(el, (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
      }
    }
  }

  function isFormDirty(): boolean {
    if (isDirtyProp !== undefined) return isDirtyProp;
    if (!modalRef) return userHasTyped;
    const form = modalRef.querySelector('form');
    if (!form) return userHasTyped;
    const elements = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]), textarea, select'
    );
    if (elements.length === 0) return userHasTyped;

    if (initialValuesMap.size === 0) {
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
          if (el.checked) return true;
        } else if (el.value && el.value.trim().length > 0) {
          return true;
        }
      }
      return false;
    }

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const initial = initialValuesMap.get(el);
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        if (initial !== undefined && el.checked !== initial) return true;
      } else {
        if (initial !== undefined && el.value !== initial) return true;
        if (initial === undefined && el.value && el.value.trim().length > 0) return true;
      }
    }
    return userHasTyped;
  }

  function attemptClose() {
    if (isFormDirty()) {
      isConfirmDiscardOpen = true;
    } else {
      forceClose();
    }
  }

  function forceClose() {
    isConfirmDiscardOpen = false;
    isOpen = false;
  }

  async function handleSubmit(e: SubmitEvent) {
    try {
      e.preventDefault();
      if (submitDisabled || isSubmitting) return;
      isSubmitting = true;
      await onSubmit();
    } catch {
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;

    try {
      if (e.key === 'Escape') {
        if (isConfirmDiscardOpen) {
          isConfirmDiscardOpen = false;
        } else {
          attemptClose();
        }
        return;
      }

      if (e.key === 'Tab') {
        if (!modalRef) return;

        const nodes = modalRef.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        const focusables: HTMLElement[] = [];
        const activeEl = document.activeElement as HTMLElement | null;
        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i];
          if (el.offsetWidth > 0 || el.offsetHeight > 0 || el === activeEl) {
            focusables.push(el);
          }
        }

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const currentIndex = activeEl ? focusables.indexOf(activeEl) : -1;

        if (e.shiftKey) {
          if (currentIndex <= 0) {
            e.preventDefault();
            focusables[focusables.length - 1]?.focus();
          }
        } else {
          if (currentIndex === -1 || currentIndex >= focusables.length - 1) {
            e.preventDefault();
            focusables[0]?.focus();
          }
        }
      }
    } catch {}
  }

  $effect(() => {
    if (!isOpen) {
      isConfirmDiscardOpen = false;
      userHasTyped = false;
      initialValuesMap.clear();
      return;
    }
    clearFocusTimeout();
    focusTimeout = setTimeout(() => {
      focusTimeout = null;
      try {
        snapshotInitialValues();
        const input = modalRef?.querySelector<HTMLInputElement | HTMLTextAreaElement>(FIRST_INPUT_SELECTOR);
        if (input) {
          input.focus();
          if (typeof input.select === 'function' && input.value) {
            input.select();
          }
        }
      } catch {}
    }, 60);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeydown);
      return () => {
        window.removeEventListener('keydown', handleKeydown);
      };
    }
  });

  onDestroy(clearFocusTimeout);

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      attemptClose();
    }
  }
</script>

{#if isOpen}
  <div
    class="fixed inset-0 z-modal bg-background/90 backdrop-blur-md flex items-center justify-center p-4"
    onclick={handleBackdropClick}
    role="presentation"
  >
    <div
      bind:this={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="form-modal-title"
      tabindex="-1"
      class="bg-card w-full max-w-md rounded-3xl shadow-2xl relative border border-white/5 break-words"
      in:scale={SCALE_IN_PARAMS}
    >
      <div class="flex items-center justify-between px-6 pt-5 pb-4 gap-2 overflow-hidden rounded-t-3xl">
        <div class="w-8 shrink-0"></div>
        <h2 id="form-modal-title" class="text-lg font-bold text-foreground tracking-wide break-words [word-break:break-word] max-w-full text-center min-w-0">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          tabindex="-1"
          onclick={attemptClose}
          class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors shrink-0 cursor-pointer"
        >
          <svg class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <form
        onsubmit={handleSubmit}
        oninput={() => (userHasTyped = true)}
        onchange={() => (userHasTyped = true)}
        class="px-6 pb-6 flex flex-col gap-6"
      >
        {#if children}
          {@render children()}
        {/if}
        {#if submitText}
          <div class="flex justify-center mt-2">
            <button
              type="submit"
              disabled={submitDisabled || isSubmitting}
              class="bg-primary hover:opacity-90 text-white px-12 py-2.5 rounded-full font-bold text-sm transition-colors shadow-lg outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {submitText}
            </button>
          </div>
        {/if}
      </form>
    </div>
  </div>

  {#if isConfirmDiscardOpen}
    <div
      class="fixed inset-0 z-modal bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      role="presentation"
      onclick={(e) => {
        if (e.target === e.currentTarget) isConfirmDiscardOpen = false;
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="form-discard-title"
        class="card-aura-responsive bg-card border-premium-border p-6 rounded-2xl shadow-2xl max-w-sm w-full space-y-4"
        in:scale={{ duration: 150, start: 0.95 }}
      >
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h3 id="form-discard-title" class="text-base font-semibold text-foreground">Unsaved Changes</h3>
            <p class="text-xs text-muted-foreground mt-0.5">You have unsaved changes. Are you sure you want to discard them?</p>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            class="px-4 py-2 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            onclick={() => (isConfirmDiscardOpen = false)}
          >
            Keep Editing
          </button>
          <button
            type="button"
            class="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-xs cursor-pointer"
            onclick={forceClose}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

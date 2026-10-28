<script lang="ts">
  import { onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';

  let {
    isOpen = $bindable(false),
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Delete',
    cancelText = 'Cancel',
    onConfirm,
    isDestructive = true
  }: {
    isOpen: boolean;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    isDestructive?: boolean;
  } = $props();

  let cancelBtnRef = $state<HTMLButtonElement | null>(null);
  let confirmBtnRef = $state<HTMLButtonElement | null>(null);
  let focusTimeout: ReturnType<typeof setTimeout> | null = null;

  function clearFocusTimeout() {
    if (focusTimeout !== null) {
      clearTimeout(focusTimeout);
      focusTimeout = null;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;
    try {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (document.activeElement === cancelBtnRef) {
          confirmBtnRef?.focus();
        } else {
          cancelBtnRef?.focus();
        }
      } else if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === cancelBtnRef) {
          e.preventDefault();
          confirmBtnRef?.focus();
        } else if (!e.shiftKey && document.activeElement === confirmBtnRef) {
          e.preventDefault();
          cancelBtnRef?.focus();
        }
      }
    } catch {}
  }

  $effect(() => {
    if (!isOpen) return;
    clearFocusTimeout();
    focusTimeout = setTimeout(() => {
      focusTimeout = null;
      try {
        cancelBtnRef?.focus();
      } catch {}
    }, 50);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeydown);
      return () => {
        window.removeEventListener('keydown', handleKeydown);
      };
    }
  });

  onDestroy(clearFocusTimeout);

  function handleSubmit() {
    try {
      if (onConfirm) onConfirm();
    } catch {}
    isOpen = false;
  }
</script>

<Modal
  bind:isOpen
  {title}
  description={message}
  hideCloseButton={true}
  onSubmit={handleSubmit}
  className="max-w-md mx-auto text-center"
  titleClass="justify-center text-center"
  descriptionClass="text-center"
>
  {#snippet footer()}
    <div class="flex items-center justify-center gap-4 mt-6">
      <Button
        bind:ref={cancelBtnRef}
        type="button"
        variant="secondary"
        class="flex-1 rounded-xl font-bold transition-all hover:brightness-110 focus:ring-2 focus:ring-primary focus:outline-none"
        onclick={() => (isOpen = false)}
      >
        {cancelText}
      </Button>
      <Button
        bind:ref={confirmBtnRef}
        type="submit"
        variant={isDestructive ? 'destructive' : 'default'}
        class="flex-1 rounded-xl font-bold transition-all hover:brightness-110 focus:ring-2 focus:ring-primary focus:outline-none"
      >
        {confirmText}
      </Button>
    </div>
  {/snippet}
</Modal>

<script module lang="ts">
  import { cubicOut } from 'svelte/easing';

  const FADE_PARAMS = Object.freeze({ duration: 150 });
  const SCALE_IN_PARAMS = Object.freeze({ duration: 200, start: 0.95, easing: cubicOut });
  const SCALE_OUT_PARAMS = Object.freeze({ duration: 150, start: 0.95, easing: cubicOut });
</script>

<script lang="ts">
  import { fade, scale } from 'svelte/transition';
  import type { ComponentType, Snippet } from 'svelte';
  import Button from './Button.svelte';

  let {
    title,
    description,
    isOpen = $bindable(false),
    onSubmit,
    isSubmitting = false,
    submitText = 'Save',
    submitDisabled = false,
    cancelText = 'Cancel',
    error,
    footer,
    className = '',
    style = '',
    titleClass = '',
    titleStyle = '',
    descriptionClass = '',
    descriptionStyle = '',
    hideTitle = false,
    hideCloseButton = false,
    closeOnBackdropClick = true,
    closeOnEscape = true,
    titleIcon,
    children
  }: {
    title: string;
    description?: string;
    isOpen?: boolean;
    onSubmit?: (e: Event) => void;
    isSubmitting?: boolean;
    submitText?: string;
    submitDisabled?: boolean;
    cancelText?: string;
    error?: string;
    footer?: Snippet;
    className?: string;
    style?: string;
    titleClass?: string;
    titleStyle?: string;
    descriptionClass?: string;
    descriptionStyle?: string;
    hideTitle?: boolean;
    hideCloseButton?: boolean;
    closeOnBackdropClick?: boolean;
    closeOnEscape?: boolean;
    titleIcon?: ComponentType;
    children?: Snippet;
  } = $props();

  function handleKeydown(e: KeyboardEvent) {
    try {
      if (!isOpen) return;
      if (closeOnEscape && e.key === 'Escape') {
        isOpen = false;
      }
    } catch {}
  }

  $effect(() => {
    if (!isOpen || !closeOnEscape || typeof window === 'undefined') return;
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  function handleBackdropClick(e: MouseEvent) {
    try {
      if (closeOnBackdropClick && e.target === e.currentTarget) {
        isOpen = false;
      }
    } catch {}
  }

  function handleSubmit(e: Event) {
    try {
      e.preventDefault();
      if (onSubmit) onSubmit(e);
    } catch {}
  }
</script>

{#if isOpen}
  <div
    class="fixed inset-0 z-modal bg-background/90 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
    transition:fade={FADE_PARAMS}
    onclick={handleBackdropClick}
    role="presentation"
  >
    <div
      class="card-aura-responsive border-premium-border p-6 sm:p-8 rounded-2xl shadow-2xl break-words w-full {className.includes('max-w-') ? '' : 'max-w-lg'} relative {className}"
      {style}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      in:scale={SCALE_IN_PARAMS}
      out:scale={SCALE_OUT_PARAMS}
    >
      <div class="flex flex-col space-y-1.5 mb-4 overflow-hidden">
        <div class="flex items-center gap-2.5 {titleClass}">
          {#if titleIcon}
            {@const IconComp = titleIcon}
            <IconComp class="w-5 h-5 text-red-500 shrink-0" />
          {/if}
          <h2
            id="modal-title"
            class="text-xl font-semibold tracking-tight break-words [word-break:break-word] max-w-full {hideTitle ? 'sr-only' : ''}"
            style={titleStyle}
          >
            {title}
          </h2>
        </div>
        {#if !hideTitle && description}
          <p
            class="text-sm text-muted-foreground break-words [word-break:break-word] max-w-full {descriptionClass}"
            style={descriptionStyle}
          >
            {description}
          </p>
        {/if}
      </div>

      {#if onSubmit}
        <form onsubmit={handleSubmit} class="space-y-4">
          <div class="space-y-4">
            {#if children}
              {@render children()}
            {/if}
          </div>

          {#if error}
            <div class="text-sm font-medium text-destructive mt-2">
              {error}
            </div>
          {/if}

          {#if footer}
            {@render footer()}
          {:else}
            <div class="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onclick={() => (isOpen = false)}>
                {cancelText}
              </Button>
              <Button type="submit" disabled={isSubmitting || submitDisabled}>
                {#if isSubmitting}
                  <span class="inline-block animate-spin mr-2">⏳</span>
                {/if}
                {submitText}
              </Button>
            </div>
          {/if}
        </form>
      {:else}
        <div class="space-y-4">
          {#if children}
            {@render children()}
          {/if}
        </div>

        {#if error}
          <div class="text-sm font-medium text-destructive mt-2">
            {error}
          </div>
        {/if}

        {#if footer}
          {@render footer()}
        {/if}
      {/if}

      {#if !hideCloseButton}
        <button
          type="button"
          class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          onclick={() => (isOpen = false)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
          <span class="sr-only">Close</span>
        </button>
      {/if}
    </div>
  </div>
{/if}

<script module lang="ts">
  import { CheckCircle2, Info, XCircle } from 'lucide-svelte';
  import type { ToastType } from '../../toast.svelte';

  const FLY_IN_PARAMS = Object.freeze({ y: -16, duration: 150 });
  const FADE_OUT_PARAMS = Object.freeze({ duration: 120 });

  const BASE_TOAST_CLASS =
    'pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-lg border text-sm font-medium max-w-sm w-fit backdrop-blur-sm';

  const TOAST_VARIANTS: Readonly<
    Record<
      ToastType,
      {
        readonly role: 'alert' | 'status';
        readonly variantClass: string;
        readonly Icon: typeof CheckCircle2;
      }
    >
  > = Object.freeze({
    error: Object.freeze({
      role: 'alert',
      variantClass: 'bg-destructive/10 border-destructive/30 text-destructive',
      Icon: XCircle
    }),
    info: Object.freeze({
      role: 'status',
      variantClass: 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400',
      Icon: Info
    }),
    success: Object.freeze({
      role: 'status',
      variantClass: 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400',
      Icon: CheckCircle2
    })
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { X } from 'lucide-svelte';
  import { fade, fly } from 'svelte/transition';
  import { toastState } from '../../toast.svelte';

  function handleRemove(id: string | number) {
    try {
      if (id === null || id === undefined) return;
      toastState.remove(String(id));
    } catch {}
  }

  onDestroy(() => {
    try {
      toastState.clear();
    } catch {}
  });
</script>

<div
  aria-live="polite"
  aria-atomic="false"
  class="fixed top-4 left-1/2 -translate-x-1/2 z-toast flex flex-col items-center gap-2 pointer-events-none"
>
  {#each toastState.toasts as t (t.id)}
    {@const variant = TOAST_VARIANTS[t.type] ?? TOAST_VARIANTS.success}
    {@const VariantIcon = variant.Icon}
    <div
      in:fly={FLY_IN_PARAMS}
      out:fade={FADE_OUT_PARAMS}
      role={variant.role}
      class="{BASE_TOAST_CLASS} {variant.variantClass}"
    >
      <VariantIcon class="w-4 h-4 mt-0.5 shrink-0" />
      <span class="flex-1 flex items-center gap-1.5">
        <span>{t.message}</span>
        {#if t.count > 1}
          <span class="px-1.5 py-0.5 text-xs font-bold rounded-full border bg-background/50 leading-none transition-transform scale-100">
            x{t.count}
          </span>
        {/if}
      </span>
      <button
        type="button"
        onclick={() => handleRemove(t.id)}
        class="ml-1 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X class="w-3.5 h-3.5" />
      </button>
    </div>
  {/each}
</div>

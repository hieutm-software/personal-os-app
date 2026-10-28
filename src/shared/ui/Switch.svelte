<script module lang="ts">
  const BASE_TRACK_CLASS =
    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50';
  const BASE_THUMB_CLASS =
    'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform';
</script>

<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    checked = $bindable(false),
    class: className = '',
    ...rest
  }: HTMLButtonAttributes & {
    checked?: boolean;
    class?: string;
  } = $props();

  function toggleChecked() {
    try {
      if (rest.disabled) return;
      checked = !checked;
    } catch {}
  }
</script>

<button
  type="button"
  role="switch"
  aria-checked={Boolean(checked)}
  aria-label="Toggle"
  onclick={toggleChecked}
  class="{BASE_TRACK_CLASS} {checked ? 'bg-primary' : 'bg-white/10'} {className}"
  {...rest}
>
  <span class="{BASE_THUMB_CLASS} {checked ? 'translate-x-4' : 'translate-x-0'}"></span>
</button>

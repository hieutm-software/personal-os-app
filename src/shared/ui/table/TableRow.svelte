<script module lang="ts">
  const BASE_ROW_CLASS =
    'group cursor-pointer select-none border [&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl [&>th:first-child]:rounded-l-xl [&>th:last-child]:rounded-r-xl';
  const SELECTED_STATE_CLASS = 'bg-accent border-premium-border';
  const UNSELECTED_STATE_CLASS = 'border-transparent hover:bg-accent hover:border-premium-border';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    children,
    class: className = '',
    selected = false,
    onclick: onclickProp,
    ondblclick: ondblclickProp,
    ondragstart: ondragstartProp,
    ...rest
  }: {
    children?: Snippet;
    class?: string;
    selected?: boolean;
    onclick?: (e: MouseEvent) => void;
    ondblclick?: (e: MouseEvent) => void;
    ondragstart?: (e: DragEvent) => void;
    [key: string]: unknown;
  } & HTMLAttributes<HTMLTableRowElement> = $props();

  function handleClick(e: MouseEvent) {
    try {
      if (onclickProp) onclickProp(e);
    } catch {}
  }

  function handleDoubleClick(e: MouseEvent) {
    try {
      if (ondblclickProp) ondblclickProp(e);
    } catch {}
  }

  function handleDragStart(e: DragEvent) {
    try {
      if (ondragstartProp) {
        ondragstartProp(e);
      } else if (!rest.draggable) {
        e.preventDefault();
      }
    } catch {}
  }
</script>

<tr
  aria-selected={Boolean(selected)}
  class="{BASE_ROW_CLASS} {selected ? SELECTED_STATE_CLASS : UNSELECTED_STATE_CLASS} {className}"
  onclick={onclickProp ? handleClick : undefined}
  ondblclick={ondblclickProp ? handleDoubleClick : undefined}
  ondragstart={handleDragStart}
  {...rest}
>
  {#if children}
    {@render children()}
  {/if}
</tr>

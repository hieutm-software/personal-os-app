<script lang="ts">
  let {
    isResizing = false,
    disabled = false,
    onResize,
    onFinish,
    onReset,
    class: className = ""
  }: {
    isResizing?: boolean;
    disabled?: boolean;
    onResize?: (deltaX: number) => void;
    onFinish?: () => void;
    onReset?: () => void;
    class?: string;
  } = $props();

  let startX = 0;
  let activePointerId: number | null = null;
  let element: HTMLElement | null = $state(null);

  function handlePointerDown(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    startX = e.clientX;
    activePointerId = e.pointerId;

    const scrollContainer = element?.closest(".overflow-auto") as HTMLElement | null;
    const initialScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

    try {
      element?.setPointerCapture(e.pointerId);
    } catch {}

    const originalUserSelect = document.body.style.userSelect;
    const originalCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onPointerMove = (ev: PointerEvent) => {
      ev.preventDefault();
      if (scrollContainer && scrollContainer.scrollTop !== initialScrollTop) {
        scrollContainer.scrollTop = initialScrollTop;
      }
      const deltaX = ev.clientX - startX;
      startX = ev.clientX;
      if (onResize) onResize(deltaX);
    };

    const onPointerUp = (_ev?: PointerEvent) => {
      try {
        if (activePointerId !== null && element) {
          element.releasePointerCapture(activePointerId);
        }
      } catch {}
      activePointerId = null;
      document.body.style.userSelect = originalUserSelect;
      document.body.style.cursor = originalCursor;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (onFinish) onFinish();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function handleDblClick(e: MouseEvent) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (onReset) onReset();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      if (onResize) onResize(-10);
      if (onFinish) onFinish();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      if (onResize) onResize(10);
      if (onFinish) onFinish();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      if (onReset) onReset();
    }
  }
</script>

{#if disabled}
  <div
    class="absolute -right-2 top-0 bottom-0 w-4 select-none pointer-events-none z-20 flex items-center justify-center {className}"
    aria-hidden="true"
  >
    <div class="w-[2px] h-3.5 rounded-full bg-border/70"></div>
  </div>
{:else}
  <button
    bind:this={element}
    type="button"
    aria-label="Resize column width"
    class="absolute -right-2 top-0 bottom-0 w-4 cursor-col-resize select-none touch-none z-30 flex items-center justify-center group/resizer bg-transparent border-0 p-0 focus:outline-none {className}"
    onpointerdown={handlePointerDown}
    ondblclick={handleDblClick}
    onclick={(e) => e.stopPropagation()}
    onkeydown={handleKeyDown}
    title="Drag to resize (Double-click to reset)"
  >
    <div
      class="w-[2px] h-3.5 rounded-full bg-border/70 group-hover/resizer:bg-primary group-hover/resizer:h-[calc(100%-8px)] transition-all {isResizing ? 'bg-primary h-[calc(100%-8px)] ring-2 ring-primary/40' : ''}"
    ></div>
  </button>
{/if}

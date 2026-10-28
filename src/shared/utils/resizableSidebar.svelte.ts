import { onDestroy } from "svelte";

export function createResizableSidebar(options: {
  storageKey?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
} = {}) {
  const storageKey = options.storageKey ?? "personal_os_secondary_sidebar_width";
  const defaultWidth = options.defaultWidth ?? 256;
  const minWidth = options.minWidth ?? 256;
  const maxWidth = options.maxWidth ?? 600;

  function getInitialWidth(): number {
    try {
      if (typeof localStorage === "undefined") return defaultWidth;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = Number.parseFloat(saved);
        if (!Number.isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    } catch {}
    return defaultWidth;
  }

  let width = $state(getInitialWidth());
  let isResizing = $state(false);
  let activeCleanup: (() => void) | null = null;

  function handleResizePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (activeCleanup) {
      activeCleanup();
    }

    const target = e.currentTarget as HTMLElement | null;
    const pointerId = e.pointerId;
    try {
      target?.setPointerCapture(pointerId);
    } catch {}

    const startX = e.clientX;
    const startWidth = width;
    isResizing = true;

    const blockDrag = (ev: Event) => ev.preventDefault();

    const onPointerMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const delta = ev.clientX - startX;
      const currentMaxWidth = Math.min(maxWidth, Math.max(minWidth, window.innerWidth * 0.55));
      const newWidth = Math.min(Math.max(minWidth, startWidth + delta), currentMaxWidth);
      width = Math.round(newWidth);
    };

    const cleanup = () => {
      isResizing = false;
      try {
        if (target && pointerId !== undefined) {
          target.releasePointerCapture(pointerId);
        }
      } catch {}
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("dragstart", blockDrag, true);
      window.removeEventListener("selectstart", blockDrag, true);
      if (target) {
        target.removeEventListener("lostpointercapture", onPointerUp);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      activeCleanup = null;

      try {
        localStorage.setItem(storageKey, String(width));
      } catch {}
    };

    function onPointerUp() {
      cleanup();
    }

    activeCleanup = cleanup;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    if (target) {
      target.addEventListener("lostpointercapture", onPointerUp);
    }
    window.addEventListener("dragstart", blockDrag, true);
    window.addEventListener("selectstart", blockDrag, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function resetWidth() {
    width = defaultWidth;
    try {
      localStorage.setItem(storageKey, String(defaultWidth));
    } catch {}
  }

  function destroy() {
    if (activeCleanup) {
      activeCleanup();
    }
  }

  try {
    onDestroy(destroy);
  } catch {}

  return {
    get width() {
      return width;
    },
    set width(v: number) {
      width = v;
    },
    get isResizing() {
      return isResizing;
    },
    handleResizePointerDown,
    resetWidth,
    destroy,
    minWidth,
    defaultWidth,
  };
}

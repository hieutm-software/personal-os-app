import { uiPreferenceRepo } from '../db/repo/uiPreferenceRepo';

interface CachedRectEntry {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
  midY: number;
}

const NO_DRAG_SELECTOR = 'button, input, textarea, select, a, [data-no-drag]';

function sanitizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item === 'string' && item.length > 0) {
      result.push(item);
    }
  }
  return result;
}

export interface GripReorderOptions {
  allowNest?: boolean;
  itemLabel?: string;
  getGroupName?: (groupId: string | null) => string;
  onNest?: (sourceId: string, targetId: string) => void | Promise<void>;
  onUnnest?: (sourceId: string) => void | Promise<void>;
}

export function createPointerReorder(storageKey: string) {
  function getInitialOrder(): string[] {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const valid = sanitizeStringArray(parsed);
        if (valid) return valid;
      }
    } catch {}
    return [];
  }

  let groupOrder = $state<string[]>(getInitialOrder());
  let isPointerDragging = $state(false);
  let draggedGroupId = $state<string | null>(null);
  let dragOverGroupId = $state<string | null>(null);
  let dropPosition = $state<'above' | 'inside' | 'below' | null>(null);

  let isItemDragging = $state(false);
  let draggedItemIds = $state<string[]>([]);
  let itemDropGroupId = $state<string | null>(null);
  let allTargetEl: HTMLElement | null = null;

  const elements = new Map<string, HTMLElement>();

  let activeGripCleanup: (() => void) | null = null;
  let activeItemCleanup: (() => void) | null = null;
  let gripResetTimer: ReturnType<typeof setTimeout> | null = null;
  let itemResetTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSuppressClick: ((e: MouseEvent) => void) | null = null;

  let orderIndexMap = $derived.by(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < groupOrder.length; i++) {
      map.set(groupOrder[i], i);
    }
    return map;
  });

  function cleanupAllActiveDrags() {
    if (activeGripCleanup) {
      activeGripCleanup();
      activeGripCleanup = null;
    }
    if (activeItemCleanup) {
      activeItemCleanup();
      activeItemCleanup = null;
    }
    if (gripResetTimer !== null) {
      clearTimeout(gripResetTimer);
      gripResetTimer = null;
    }
    if (itemResetTimer !== null) {
      clearTimeout(itemResetTimer);
      itemResetTimer = null;
    }
    if (activeSuppressClick && typeof window !== 'undefined') {
      window.removeEventListener('click', activeSuppressClick, true);
      activeSuppressClick = null;
    }
  }

  function allTargetAction(node: HTMLElement) {
    allTargetEl = node;
    return {
      destroy() {
        if (allTargetEl === node) allTargetEl = null;
      }
    };
  }

  $effect(() => {
    let active = true;
    const loadOrder = async () => {
      try {
        const dbOrder = await uiPreferenceRepo.get(storageKey);
        if (!active) return;
        if (dbOrder) {
          try {
            const parsed = JSON.parse(dbOrder);
            const valid = sanitizeStringArray(parsed);
            if (valid) {
              groupOrder = valid;
              localStorage.setItem(storageKey, dbOrder);
              return;
            }
          } catch {}
        }
        groupOrder = getInitialOrder();
      } catch {}
    };
    loadOrder();
    const onRestored = () => {
      loadOrder();
    };
    window.addEventListener('backup-restored', onRestored);
    return () => {
      active = false;
      window.removeEventListener('backup-restored', onRestored);
      cleanupAllActiveDrags();
    };
  });

  function saveOrder(newOrder: string[]) {
    groupOrder = newOrder;
    try {
      const json = JSON.stringify(newOrder);
      localStorage.setItem(storageKey, json);
      uiPreferenceRepo.set(storageKey, json).catch(() => {});
    } catch {}
  }

  function elementAction(node: HTMLElement, id: string) {
    let currentKey = id;
    elements.set(currentKey, node);
    return {
      update(newId: string) {
        if (currentKey !== newId) {
          elements.delete(currentKey);
          currentKey = newId;
          elements.set(currentKey, node);
        }
      },
      destroy() {
        elements.delete(currentKey);
      }
    };
  }

  function snapshotElementRects(excludeId?: string): CachedRectEntry[] {
    const rects: CachedRectEntry[] = [];
    for (const [itemId, el] of elements.entries()) {
      if (excludeId !== undefined && itemId === excludeId) continue;
      const r = el.getBoundingClientRect();
      rects.push({
        id: itemId,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        midY: r.top + r.height * 0.5
      });
    }
    return rects;
  }

  function handleGripPointerDown(
    e: PointerEvent,
    id: string,
    currentItemIds: string[],
    options?: GripReorderOptions
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (activeGripCleanup) {
      activeGripCleanup();
      activeGripCleanup = null;
    }
    if (gripResetTimer !== null) {
      clearTimeout(gripResetTimer);
      gripResetTimer = null;
    }

    const gripEl = e.currentTarget as HTMLElement | null;
    const pointerId = e.pointerId;
    try {
      gripEl?.setPointerCapture?.(pointerId);
    } catch {}

    isPointerDragging = true;
    draggedGroupId = id;
    dragOverGroupId = null;
    dropPosition = null;

    let cachedRects = snapshotElementRects(id);
    let cachedAllTargetRect = allTargetEl ? allTargetEl.getBoundingClientRect() : null;
    const refreshRectsOnScroll = () => {
      cachedRects = snapshotElementRects(id);
      cachedAllTargetRect = allTargetEl ? allTargetEl.getBoundingClientRect() : null;
    };

    let ghostEl: HTMLDivElement | null = null;
    let ghostTargetEl: HTMLSpanElement | null = null;

    const blockNativeDrag = (ev: Event) => {
      ev.preventDefault();
    };

    const createGripGhost = (label: string, initialX: number, initialY: number) => {
      const el = document.createElement('div');
      el.className =
        'fixed left-0 top-0 z-[99999] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card/95 backdrop-blur-md border border-primary/50 shadow-2xl text-xs font-medium text-foreground will-change-transform';
      el.style.transform = `translate3d(${initialX + 14}px, ${initialY + 14}px, 0)`;

      const gripIcon = document.createElement('span');
      gripIcon.className = 'text-primary font-bold';
      gripIcon.textContent = '⠿';
      el.appendChild(gripIcon);

      const textSpan = document.createElement('span');
      textSpan.className = 'truncate max-w-40 font-medium';
      textSpan.textContent = label;
      el.appendChild(textSpan);

      const targetSpan = document.createElement('span');
      targetSpan.className = 'text-primary font-semibold truncate max-w-40 hidden';
      el.appendChild(targetSpan);
      ghostTargetEl = targetSpan;

      document.body.appendChild(el);
      return el;
    };

    if (options?.itemLabel) {
      ghostEl = createGripGhost(options.itemLabel, e.clientX, e.clientY);
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const clientY = moveEvent.clientY;
      const clientX = moveEvent.clientX;

      if (ghostEl) {
        ghostEl.style.transform = `translate3d(${clientX + 14}px, ${clientY + 14}px, 0)`;
      }

      let foundId: string | null = null;
      let foundPos: 'above' | 'inside' | 'below' | null = null;

      if (options?.allowNest && cachedAllTargetRect) {
        const r = cachedAllTargetRect;
        if (
          clientX >= r.left - 10 &&
          clientX <= r.right + 10 &&
          clientY >= r.top - 6 &&
          clientY <= r.bottom + 6
        ) {
          foundId = '__ALL__';
          foundPos = 'inside';
        }
      }

      if (!foundId) {
        for (let i = 0; i < cachedRects.length; i++) {
          const rect = cachedRects[i];
          if (
            clientY >= rect.top - 12 &&
            clientY <= rect.bottom + 12 &&
            clientX >= rect.left - 40 &&
            clientX <= rect.right + 40
          ) {
            foundId = rect.id;
            if (options?.allowNest) {
              const h = rect.bottom - rect.top;
              const relY = clientY - rect.top;
              if (relY < h * 0.28) {
                foundPos = 'above';
              } else if (relY > h * 0.72) {
                foundPos = 'below';
              } else {
                foundPos = 'inside';
              }
            } else {
              foundPos = clientY < rect.midY ? 'above' : 'below';
            }
            break;
          }
        }
      }

      dragOverGroupId = foundId;
      dropPosition = foundPos;

      if (ghostTargetEl) {
        if (foundId === '__ALL__') {
          ghostTargetEl.textContent = '→ Make Root Group';
          ghostTargetEl.classList.remove('hidden');
        } else if (foundId && foundPos === 'inside') {
          const gName = options?.getGroupName ? options.getGroupName(foundId) : 'Group';
          ghostTargetEl.textContent = `→ Nest into ${gName}`;
          ghostTargetEl.classList.remove('hidden');
        } else {
          ghostTargetEl.classList.add('hidden');
        }
      }
    };

    const detachGripListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('dragstart', blockNativeDrag, true);
      window.removeEventListener('selectstart', blockNativeDrag, true);
      window.removeEventListener('scroll', refreshRectsOnScroll, true);
      try {
        gripEl?.releasePointerCapture?.(pointerId);
      } catch {}
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (ghostEl) {
        ghostEl.remove();
        ghostEl = null;
        ghostTargetEl = null;
      }
    };

    const onPointerUp = () => {
      detachGripListeners();
      activeGripCleanup = null;

      const sourceId = draggedGroupId;
      const targetId = dragOverGroupId;
      const pos = dropPosition;

      draggedGroupId = null;
      dragOverGroupId = null;
      dropPosition = null;

      if (activeSuppressClick) {
        window.removeEventListener('click', activeSuppressClick, true);
      }
      const suppressClick = (clickEv: MouseEvent) => {
        clickEv.stopPropagation();
        clickEv.preventDefault();
        window.removeEventListener('click', suppressClick, true);
        if (activeSuppressClick === suppressClick) {
          activeSuppressClick = null;
        }
      };
      activeSuppressClick = suppressClick;
      window.addEventListener('click', suppressClick, true);

      gripResetTimer = setTimeout(() => {
        window.removeEventListener('click', suppressClick, true);
        if (activeSuppressClick === suppressClick) {
          activeSuppressClick = null;
        }
        isPointerDragging = false;
        gripResetTimer = null;
      }, 80);

      if (!sourceId || !targetId || sourceId === targetId) return;

      if (targetId === '__ALL__') {
        if (options?.onUnnest) {
          options.onUnnest(sourceId);
        }
        return;
      }

      if (pos === 'inside' && options?.onNest) {
        options.onNest(sourceId, targetId);
        return;
      }

      const fromIndex = currentItemIds.indexOf(sourceId);
      if (fromIndex === -1) return;

      const newOrder = [...currentItemIds];
      const [moved] = newOrder.splice(fromIndex, 1);

      let toIndex = newOrder.indexOf(targetId);
      if (toIndex === -1) return;

      if (pos === 'below') {
        toIndex += 1;
      }
      newOrder.splice(toIndex, 0, moved);
      saveOrder(newOrder);
    };

    activeGripCleanup = () => {
      detachGripListeners();
      draggedGroupId = null;
      dragOverGroupId = null;
      dropPosition = null;
      isPointerDragging = false;
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    window.addEventListener('dragstart', blockNativeDrag, true);
    window.addEventListener('selectstart', blockNativeDrag, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('scroll', refreshRectsOnScroll, true);
  }

  function handleItemPointerDown(
    e: PointerEvent,
    itemId: string,
    selectedIds: Set<string>,
    onDrop: (itemIds: string[], targetGroupId: string | null) => void | Promise<void>,
    options?: {
      disabled?: boolean;
      itemLabel?: string;
      getGroupName?: (groupId: string | null) => string;
    }
  ) {
    if (e.button !== 0 || options?.disabled) return;
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest(NO_DRAG_SELECTOR)) {
      return;
    }

    if (activeItemCleanup) {
      activeItemCleanup();
      activeItemCleanup = null;
    }

    e.preventDefault();
    try {
      window.getSelection()?.removeAllRanges();
    } catch {}

    const rowEl = e.currentTarget as HTMLElement | null;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    let ghostEl: HTMLDivElement | null = null;
    let ghostTargetEl: HTMLSpanElement | null = null;
    let cachedGroupRects: CachedRectEntry[] = [];
    let cachedAllTargetRect: DOMRect | null = null;

    const refreshTargetRects = () => {
      cachedGroupRects = snapshotElementRects();
      cachedAllTargetRect = allTargetEl ? allTargetEl.getBoundingClientRect() : null;
    };

    const blockNativeDrag = (ev: Event) => {
      ev.preventDefault();
    };

    const createGhost = (count: number, initialX: number, initialY: number) => {
      const el = document.createElement('div');
      el.className =
        'fixed left-0 top-0 z-[99999] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card/95 backdrop-blur-md border border-primary/50 shadow-2xl text-xs font-medium text-foreground will-change-transform';
      el.style.transform = `translate3d(${initialX + 14}px, ${initialY + 14}px, 0)`;

      const badge = document.createElement('span');
      badge.className =
        'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold leading-none';
      badge.textContent = String(count);
      el.appendChild(badge);

      const label = document.createElement('span');
      label.className = 'truncate max-w-44';
      label.textContent = count > 1 ? 'items selected' : options?.itemLabel || 'item';
      el.appendChild(label);

      const targetSpan = document.createElement('span');
      targetSpan.className = 'text-primary font-semibold truncate max-w-36 hidden';
      el.appendChild(targetSpan);
      ghostTargetEl = targetSpan;

      document.body.appendChild(el);
      return el;
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const clientX = moveEvent.clientX;
      const clientY = moveEvent.clientY;

      if (!started) {
        if (Math.hypot(clientX - startX, clientY - startY) < 4) return;
        started = true;
        isItemDragging = true;
        refreshTargetRects();
        try {
          rowEl?.setPointerCapture?.(pointerId);
        } catch {}
        const ids = selectedIds.has(itemId) ? Array.from(selectedIds) : [itemId];
        draggedItemIds = ids;
        try {
          window.getSelection()?.removeAllRanges();
        } catch {}
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        ghostEl = createGhost(ids.length, clientX, clientY);
      }

      moveEvent.preventDefault();

      if (ghostEl) {
        ghostEl.style.transform = `translate3d(${clientX + 14}px, ${clientY + 14}px, 0)`;
      }

      let foundTarget: string | null = null;
      if (cachedAllTargetRect) {
        const r = cachedAllTargetRect;
        if (
          clientX >= r.left - 10 &&
          clientX <= r.right + 10 &&
          clientY >= r.top - 4 &&
          clientY <= r.bottom + 4
        ) {
          foundTarget = '__ALL__';
        }
      }

      if (!foundTarget) {
        for (let i = 0; i < cachedGroupRects.length; i++) {
          const r = cachedGroupRects[i];
          if (
            clientX >= r.left - 10 &&
            clientX <= r.right + 10 &&
            clientY >= r.top - 4 &&
            clientY <= r.bottom + 4
          ) {
            foundTarget = r.id;
            break;
          }
        }
      }

      if (itemDropGroupId !== foundTarget) {
        itemDropGroupId = foundTarget;
        if (ghostTargetEl) {
          if (foundTarget !== null) {
            const gName =
              foundTarget === '__ALL__'
                ? options?.getGroupName
                  ? options.getGroupName(null)
                  : 'Ungroup'
                : options?.getGroupName
                  ? options.getGroupName(foundTarget)
                  : 'Group';
            ghostTargetEl.textContent = `→ ${gName}`;
            ghostTargetEl.classList.remove('hidden');
          } else {
            ghostTargetEl.classList.add('hidden');
          }
        }
      }
    };

    const detachItemListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('dragstart', blockNativeDrag, true);
      window.removeEventListener('selectstart', blockNativeDrag, true);
      window.removeEventListener('scroll', refreshTargetRects, true);

      if (started) {
        try {
          rowEl?.releasePointerCapture?.(pointerId);
        } catch {}
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }

      if (ghostEl) {
        ghostEl.remove();
        ghostEl = null;
        ghostTargetEl = null;
      }
    };

    const onPointerUp = () => {
      detachItemListeners();
      activeItemCleanup = null;

      if (!started) return;

      const finalTarget = itemDropGroupId;
      const idsToMove = [...draggedItemIds];

      draggedItemIds = [];
      itemDropGroupId = null;

      if (activeSuppressClick) {
        window.removeEventListener('click', activeSuppressClick, true);
      }
      const suppressClick = (clickEv: MouseEvent) => {
        clickEv.stopPropagation();
        clickEv.preventDefault();
        window.removeEventListener('click', suppressClick, true);
        if (activeSuppressClick === suppressClick) {
          activeSuppressClick = null;
        }
      };
      activeSuppressClick = suppressClick;
      window.addEventListener('click', suppressClick, true);

      if (itemResetTimer !== null) {
        clearTimeout(itemResetTimer);
      }
      itemResetTimer = setTimeout(() => {
        window.removeEventListener('click', suppressClick, true);
        if (activeSuppressClick === suppressClick) {
          activeSuppressClick = null;
        }
        isItemDragging = false;
        itemResetTimer = null;
      }, 80);

      if (finalTarget !== null && idsToMove.length > 0) {
        onDrop(idsToMove, finalTarget === '__ALL__' ? null : finalTarget);
      }
    };

    activeItemCleanup = () => {
      detachItemListeners();
      draggedItemIds = [];
      itemDropGroupId = null;
      isItemDragging = false;
    };

    window.addEventListener('dragstart', blockNativeDrag, true);
    window.addEventListener('selectstart', blockNativeDrag, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('scroll', refreshTargetRects, true);
  }

  function sortItems<T extends { id: string }>(items: T[]): T[] {
    if (!groupOrder || groupOrder.length === 0 || items.length <= 1) return items;
    const idxMap = orderIndexMap;
    return [...items].sort((a, b) => {
      const indexA = idxMap.get(a.id) ?? -1;
      const indexB = idxMap.get(b.id) ?? -1;
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return 0;
    });
  }

  return {
    get groupOrder() {
      return groupOrder;
    },
    get isPointerDragging() {
      return isPointerDragging;
    },
    get draggedGroupId() {
      return draggedGroupId;
    },
    get dragOverGroupId() {
      return dragOverGroupId;
    },
    get dropPosition() {
      return dropPosition;
    },
    get isItemDragging() {
      return isItemDragging;
    },
    get draggedItemIds() {
      return draggedItemIds;
    },
    get itemDropGroupId() {
      return itemDropGroupId;
    },
    elementAction,
    allTargetAction,
    handleGripPointerDown,
    handleItemPointerDown,
    sortItems,
    saveOrder
  };
}

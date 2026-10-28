export function getNextSelection(
  e: MouseEvent,
  id: string,
  currentSelection: Set<string>,
  orderedIds: string[] = [],
  lastSelectedId: string | null = null
): { selection: Set<string>; lastSelectedId: string | null } {
  try {
    if (!e || !id || !(currentSelection instanceof Set)) {
      return { selection: new Set([id]), lastSelectedId: id };
    }

    if (e.shiftKey && Array.isArray(orderedIds) && orderedIds.length > 0 && lastSelectedId) {
      let startIdx = -1;
      let endIdx = -1;
      for (let i = 0; i < orderedIds.length; i++) {
        const cur = orderedIds[i];
        if (cur === lastSelectedId && startIdx === -1) startIdx = i;
        if (cur === id && endIdx === -1) endIdx = i;
        if (startIdx !== -1 && endIdx !== -1) break;
      }

      const next = new Set(currentSelection);
      if (startIdx !== -1 && endIdx !== -1) {
        const min = startIdx < endIdx ? startIdx : endIdx;
        const max = startIdx > endIdx ? startIdx : endIdx;
        for (let i = min; i <= max; i++) {
          next.add(orderedIds[i]);
        }
      }
      return { selection: next, lastSelectedId };
    }

    if (e.ctrlKey || e.metaKey) {
      const next = new Set(currentSelection);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selection: next, lastSelectedId: id };
    }

    if (currentSelection.size === 1 && currentSelection.has(id)) {
      return { selection: new Set<string>(), lastSelectedId: null };
    }

    return { selection: new Set<string>([id]), lastSelectedId: id };
  } catch {
    return { selection: new Set([id]), lastSelectedId: id };
  }
}

export function getNextSort<T>(
  newKey: T,
  currentKey: T,
  currentDirection: 'asc' | 'desc'
): { key: T; direction: 'asc' | 'desc' } {
  try {
    if (currentKey === newKey) {
      return { key: newKey, direction: currentDirection === 'asc' ? 'desc' : 'asc' };
    }
    return { key: newKey, direction: 'asc' };
  } catch {
    return { key: newKey, direction: 'asc' };
  }
}

export interface ColumnDef {
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
}

export function createResizableColumns(options: {
  storageKey: string;
  columns: Record<string, ColumnDef>;
}) {
  const { storageKey, columns } = options;

  function loadInitialWidths(): Record<string, number> {
    const initial: Record<string, number> = {};
    for (const [key, def] of Object.entries(columns)) {
      initial[key] = def.defaultWidth;
    }

    try {
      if (typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === "object") {
            for (const [key, def] of Object.entries(columns)) {
              const val = Number(parsed[key]);
              if (
                Number.isFinite(val) &&
                val >= (def.minWidth ?? 40) &&
                val <= (def.maxWidth ?? 1500)
              ) {
                initial[key] = Math.round(val);
              }
            }
          }
        }
      }
    } catch {}

    return initial;
  }

  let widths = $state<Record<string, number>>(loadInitialWidths());
  let resizingPair = $state<string | null>(null);

  const totalWidth = $derived.by(() => {
    let total = 0;
    for (const [key, def] of Object.entries(columns)) {
      total += widths[key] ?? def.defaultWidth;
    }
    return total;
  });

  function saveWidths() {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify(widths));
      }
    } catch {}
  }

  function resizePair(leftKey: string, rightKey: string, deltaX: number) {
    const leftDef = columns[leftKey];
    const rightDef = columns[rightKey];
    if (!leftDef || !rightDef) return;

    const leftCur = widths[leftKey] ?? leftDef.defaultWidth;
    const rightCur = widths[rightKey] ?? rightDef.defaultWidth;

    const leftMin = leftDef.minWidth ?? 60;
    const leftMax = leftDef.maxWidth ?? 1500;
    const rightMin = rightDef.minWidth ?? 60;
    const rightMax = rightDef.maxWidth ?? 1500;

    let delta = deltaX;
    if (delta > 0) {
      const canGrowLeft = leftMax - leftCur;
      const canShrinkRight = rightCur - rightMin;
      delta = Math.min(delta, canGrowLeft, canShrinkRight);
      if (delta < 0) delta = 0;
    } else if (delta < 0) {
      const canShrinkLeft = leftCur - leftMin;
      const canGrowRight = rightMax - rightCur;
      delta = -Math.min(-delta, canShrinkLeft, canGrowRight);
      if (delta > 0) delta = 0;
    }

    if (delta !== 0) {
      widths[leftKey] = Math.round(leftCur + delta);
      widths[rightKey] = Math.round(rightCur - delta);
      resizingPair = `${leftKey}-${rightKey}`;
    }
  }

  function finishResize() {
    resizingPair = null;
    saveWidths();
  }

  function resetPair(leftKey: string, rightKey: string) {
    const leftDef = columns[leftKey];
    const rightDef = columns[rightKey];
    if (!leftDef || !rightDef) return;
    widths[leftKey] = leftDef.defaultWidth;
    widths[rightKey] = rightDef.defaultWidth;
    saveWidths();
  }

  function resetAll() {
    for (const [key, def] of Object.entries(columns)) {
      widths[key] = def.defaultWidth;
    }
    saveWidths();
  }

  function getWidth(key: string): number {
    return widths[key] ?? columns[key]?.defaultWidth ?? 100;
  }

  function getStyle(key: string): string {
    const w = getWidth(key);
    return `width: ${w}px; min-width: ${w}px; max-width: ${w}px;`;
  }

  return {
    get widths() {
      return widths;
    },
    get resizingPair() {
      return resizingPair;
    },
    get totalWidth() {
      return totalWidth;
    },
    getWidth,
    getStyle,
    resizePair,
    finishResize,
    resetPair,
    resetAll,
  };
}

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  count: number;
}

const MAX_TOASTS = 3;
const DEFAULT_TIMEOUT_MS = 3000;
let fallbackIdCounter = 0;

function generateToastId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  fallbackIdCounter = (fallbackIdCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `toast-${Date.now()}-${fallbackIdCounter}`;
}

function sanitizeToastType(type: unknown): ToastType {
  return type === 'success' || type === 'error' || type === 'info' ? type : 'info';
}

class ToastState {
  toasts = $state<Toast[]>([]);
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  private clearTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private scheduleRemoval(id: string, timeout: number) {
    if (Number.isFinite(timeout) && timeout > 0) {
      const timer = setTimeout(() => this.remove(id), timeout);
      this.timers.set(id, timer);
    }
  }

  add(type: ToastType, message: string, timeout: number = DEFAULT_TIMEOUT_MS): string {
    try {
      const validType = sanitizeToastType(type);
      const safeMessage = String(message ?? '').trim().slice(0, 500);
      if (!safeMessage) return '';

      const existing = this.toasts.find((t) => t.type === validType && t.message === safeMessage);
      if (existing) {
        existing.count += 1;
        this.clearTimer(existing.id);
        this.scheduleRemoval(existing.id, timeout);
        return existing.id;
      }

      while (this.toasts.length >= MAX_TOASTS) {
        const oldest = this.toasts.shift();
        if (oldest) {
          this.clearTimer(oldest.id);
        }
      }

      const id = generateToastId();
      this.toasts.push({ id, type: validType, message: safeMessage, count: 1 });
      this.scheduleRemoval(id, timeout);
      return id;
    } catch {
      return '';
    }
  }

  remove(id: string) {
    try {
      if (!id) return;
      this.clearTimer(id);
      const idx = this.toasts.findIndex((t) => t.id === id);
      if (idx !== -1) {
        this.toasts.splice(idx, 1);
      }
    } catch {}
  }

  clear() {
    try {
      for (const timer of this.timers.values()) {
        clearTimeout(timer);
      }
      this.timers.clear();
      this.toasts = [];
    } catch {}
  }
}

export const toastState = new ToastState();

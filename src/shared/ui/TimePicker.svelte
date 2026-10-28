<script module lang="ts">
  const HOURS: readonly string[] = Object.freeze(
    Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
  );
  const MINUTES: readonly string[] = Object.freeze(
    Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
  );
  const HANDLED_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ']);
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Popover, PopoverContent, PopoverTrigger } from './popover';
  import Button from './Button.svelte';
  import { Clock } from 'lucide-svelte';

  let {
    value = $bindable(''),
    onChange,
    placeholder = 'Select time',
    class: className = '',
    disabled = false,
    ref = $bindable(null)
  }: {
    value?: string;
    onChange?: (val: string) => void;
    placeholder?: string;
    class?: string;
    disabled?: boolean;
    ref?: HTMLButtonElement | null;
  } = $props();

  let isOpen = $state(false);
  let focusTimeout: ReturnType<typeof setTimeout> | null = null;

  let hour = $state('');
  let minute = $state('');
  let hoursContainer = $state<HTMLElement | null>(null);
  let minutesContainer = $state<HTMLElement | null>(null);

  function clearFocusTimeout() {
    if (focusTimeout !== null) {
      clearTimeout(focusTimeout);
      focusTimeout = null;
    }
  }

  function closeAndRestoreFocus() {
    isOpen = false;
    clearFocusTimeout();
    focusTimeout = setTimeout(() => {
      focusTimeout = null;
      try {
        ref?.focus();
      } catch {}
    }, 10);
  }

  $effect(() => {
    try {
      if (value) {
        const colonIdx = value.indexOf(':');
        if (colonIdx > 0) {
          const h = value.slice(0, colonIdx);
          const m = value.slice(colonIdx + 1);
          if (h && m) {
            hour = h.padStart(2, '0');
            minute = m.padStart(2, '0');
            return;
          }
        }
      }
      hour = '';
      minute = '';
    } catch {}
  });

  function handleSelect(h: string, m: string) {
    try {
      if (disabled) return;
      const selectedH = h || '12';
      const selectedM = m || '00';
      hour = selectedH;
      minute = selectedM;
      const newVal = `${selectedH}:${selectedM}`;
      value = newVal;
      if (onChange) onChange(newVal);
    } catch {}
  }

  function handleClear() {
    try {
      if (disabled) return;
      hour = '';
      minute = '';
      value = '';
      if (onChange) onChange('');
      isOpen = false;
    } catch {}
  }

  function handleKeydown(e: KeyboardEvent) {
    try {
      if (disabled || !HANDLED_KEYS.has(e.key)) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const inHours = Boolean(activeEl && hoursContainer?.contains(activeEl));
      const inMinutes = Boolean(activeEl && minutesContainer?.contains(activeEl));

      if (!inHours && !inMinutes) return;

      e.preventDefault();

      if (e.key === 'ArrowRight' && inHours) {
        const selectedMinBtn = (minutesContainer?.querySelector('button.bg-primary') ||
          minutesContainer?.querySelector('button')) as HTMLButtonElement | null;
        selectedMinBtn?.focus();
        selectedMinBtn?.scrollIntoView({ block: 'nearest' });
        return;
      }

      if (e.key === 'ArrowLeft' && inMinutes) {
        const selectedHourBtn = (hoursContainer?.querySelector('button.bg-primary') ||
          hoursContainer?.querySelector('button')) as HTMLButtonElement | null;
        selectedHourBtn?.focus();
        selectedHourBtn?.scrollIntoView({ block: 'nearest' });
        return;
      }

      const currentContainer = inHours ? hoursContainer : minutesContainer;
      if (!currentContainer) return;

      const buttons = currentContainer.querySelectorAll<HTMLButtonElement>('button');
      const count = buttons.length;
      if (count === 0) return;

      let currentIndex = -1;
      for (let i = 0; i < count; i++) {
        if (buttons[i] === activeEl) {
          currentIndex = i;
          break;
        }
      }

      if (e.key === 'ArrowDown') {
        const nextIndex = currentIndex < 0 || currentIndex >= count - 1 ? 0 : currentIndex + 1;
        const targetBtn = buttons[nextIndex];
        targetBtn.focus();
        targetBtn.scrollIntoView({ block: 'nearest' });
        const targetVal = inHours ? HOURS[nextIndex] : MINUTES[nextIndex];
        if (targetVal) {
          if (inHours) handleSelect(targetVal, minute);
          else handleSelect(hour, targetVal);
        }
      } else if (e.key === 'ArrowUp') {
        const prevIndex = currentIndex <= 0 ? count - 1 : currentIndex - 1;
        const targetBtn = buttons[prevIndex];
        targetBtn.focus();
        targetBtn.scrollIntoView({ block: 'nearest' });
        const targetVal = inHours ? HOURS[prevIndex] : MINUTES[prevIndex];
        if (targetVal) {
          if (inHours) handleSelect(targetVal, minute);
          else handleSelect(hour, targetVal);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (activeEl && 'click' in activeEl) {
          activeEl.click();
        }
        closeAndRestoreFocus();
      }
    } catch {}
  }

  let displayValue = $derived.by(() => {
    try {
      if (!value) return '';
      const colonIdx = value.indexOf(':');
      if (colonIdx <= 0) return '';
      const h = value.slice(0, colonIdx);
      const m = value.slice(colonIdx + 1);
      if (!h || !m) return '';
      return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    } catch {
      return '';
    }
  });

  onDestroy(clearFocusTimeout);
</script>

<Popover bind:open={isOpen}>
  <PopoverTrigger class="w-full" {disabled}>
    <Button
      bind:ref
      type="button"
      variant="outline"
      {disabled}
      class="w-full justify-start text-left font-normal bg-white/90 dark:bg-black/20 border-black/8 dark:border-premium-border text-premium-text shadow-sm hover:bg-white dark:hover:bg-premium-dark {!value ? 'text-muted-foreground' : ''} {disabled ? 'opacity-50 pointer-events-none' : ''} {className}"
    >
      <Clock class="mr-2 h-4 w-4" />
      {displayValue || placeholder}
    </Button>
  </PopoverTrigger>

  {#if !disabled}
    <PopoverContent align="start" class="w-auto p-0 bg-white/90 dark:bg-premium-dark border border-black/8 dark:border-premium-border shadow-xl backdrop-blur-xl -mt-8 rounded-md">
      <div
        class="flex h-48 w-48 divide-x divide-black/8 dark:divide-premium-border rounded-t-md overflow-hidden"
        onkeydown={handleKeydown}
        role="presentation"
      >
        <div bind:this={hoursContainer} class="flex-1 overflow-y-auto scroll-smooth">
          <div class="flex flex-col p-1">
            {#each HOURS as h (h)}
              <Button
                type="button"
                variant="ghost"
                onclick={(e: MouseEvent) => {
                  e.preventDefault();
                  handleSelect(h, minute);
                }}
                class="rounded-sm px-2 py-1 h-8 text-sm justify-center hover:bg-primary/20 hover:text-primary {hour === h ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground' : 'text-premium-text'}"
              >
                {h}
              </Button>
            {/each}
          </div>
        </div>
        <div bind:this={minutesContainer} class="flex-1 overflow-y-auto scroll-smooth">
          <div class="flex flex-col p-1">
            {#each MINUTES as m (m)}
              <Button
                type="button"
                variant="ghost"
                onclick={(e: MouseEvent) => {
                  e.preventDefault();
                  handleSelect(hour, m);
                }}
                class="rounded-sm px-2 py-1 h-8 text-sm justify-center hover:bg-primary/20 hover:text-primary {minute === m ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground' : 'text-premium-text'}"
              >
                {m}
              </Button>
            {/each}
          </div>
        </div>
      </div>
      <div class="p-2 border-t border-black/8 dark:border-premium-border bg-black/5 dark:bg-black/20 flex gap-2 rounded-md">
        <Button type="button" size="sm" variant="ghost" class="flex-1" onclick={handleClear}>
          Clear
        </Button>
        <Button type="button" size="sm" class="flex-1" onclick={closeAndRestoreFocus}>
          Done
        </Button>
      </div>
    </PopoverContent>
  {/if}
</Popover>

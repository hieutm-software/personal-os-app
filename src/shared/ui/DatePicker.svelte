<script module lang="ts">
  const WEEKDAYS = Object.freeze(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  const MONTHS = Object.freeze([
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ]);

  function formatYmd(year: number, monthIndex: number, day: number): string {
    const m = String(monthIndex + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  }

  function parseYmdLocal(ymd: string): Date | null {
    if (!ymd || typeof ymd !== 'string') return null;
    const parts = ymd.split('-');
    if (parts.length === 3) {
      const y = Number.parseInt(parts[0], 10);
      const m = Number.parseInt(parts[1], 10);
      const d = Number.parseInt(parts[2], 10);
      if (Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d)) {
        const parsed = new Date(y, m - 1, d);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
    }
    const fallback = new Date(ymd);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
</script>

<script lang="ts">
  import { Popover, PopoverContent, PopoverTrigger } from './popover';
  import Button from './Button.svelte';
  import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-svelte';

  let {
    value = $bindable(''),
    placeholder = 'Select date',
    class: className = '',
    disabled = false,
    ref = $bindable(null)
  }: {
    value?: string;
    placeholder?: string;
    class?: string;
    disabled?: boolean;
    ref?: HTMLButtonElement | null;
  } = $props();

  let currentMonth = $state(new Date());

  $effect(() => {
    try {
      if (value) {
        const parsed = parseYmdLocal(value);
        if (parsed) {
          currentMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
        }
      }
    } catch {}
  });

  function shiftMonth(delta: number) {
    try {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
    } catch {}
  }

  let calendarGrid = $derived.by(() => {
    try {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0);

      const startDate = new Date(monthStart);
      startDate.setDate(startDate.getDate() - startDate.getDay());
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(monthEnd);
      endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));
      endDate.setHours(23, 59, 59, 999);

      const now = new Date();
      const todayKey = formatYmd(now.getFullYear(), now.getMonth(), now.getDate());

      const cells: {
        dayNumber: number;
        dateKey: string;
        isCurrentMonth: boolean;
        isToday: boolean;
      }[] = [];

      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        const cYear = cursor.getFullYear();
        const cMonth = cursor.getMonth();
        const cDate = cursor.getDate();
        const dateKey = formatYmd(cYear, cMonth, cDate);
        cells.push({
          dayNumber: cDate,
          dateKey,
          isCurrentMonth: cYear === year && cMonth === month,
          isToday: dateKey === todayKey
        });
        cursor.setDate(cDate + 1);
      }
      return cells;
    } catch {
      return [];
    }
  });

  function handleSelectDateKey(dateKey: string) {
    try {
      if (disabled) return;
      value = dateKey;
    } catch {}
  }
</script>

<Popover>
  <PopoverTrigger class="w-full" {disabled}>
    <Button
      bind:ref
      variant="outline"
      {disabled}
      class="w-full justify-start text-left font-normal bg-white/90 dark:bg-black/20 border-black/8 dark:border-premium-border text-premium-text shadow-sm hover:bg-white dark:hover:bg-premium-dark {!value ? 'text-muted-foreground' : ''} {disabled ? 'opacity-50 pointer-events-none' : ''} {className}"
    >
      <CalendarIcon class="mr-2 h-4 w-4" />
      {value ? value : placeholder}
    </Button>
  </PopoverTrigger>

  {#if !disabled}
    <PopoverContent align="start" class="w-72 p-3 bg-white/90 dark:bg-premium-dark border border-black/8 dark:border-premium-border shadow-xl backdrop-blur-xl">
      <div class="flex items-center justify-between mb-2">
        <Button variant="ghost" size="icon" class="h-7 w-7" type="button" onclick={() => shiftMonth(-1)}>
          <ChevronLeft class="h-4 w-4" />
        </Button>
        <div class="text-sm font-medium">
          {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </div>
        <Button variant="ghost" size="icon" class="h-7 w-7" type="button" onclick={() => shiftMonth(1)}>
          <ChevronRight class="h-4 w-4" />
        </Button>
      </div>

      <div class="grid grid-cols-7 gap-1 text-center mb-1">
        {#each WEEKDAYS as day (day)}
          <div class="text-xs font-semibold text-muted-foreground py-1">{day}</div>
        {/each}
      </div>

      <div class="grid grid-cols-7 gap-1">
        {#each calendarGrid as cell (cell.dateKey)}
          {@const isSelected = value === cell.dateKey}
          <PopoverTrigger
            class="flex items-center justify-center h-8 w-8 rounded-md text-sm transition-colors focus:outline-none {!cell.isCurrentMonth ? 'text-muted-foreground/40' : 'text-foreground hover:bg-primary/20 hover:text-primary'} {isSelected ? 'bg-primary! text-primary-foreground! font-medium shadow-sm hover:bg-primary/90!' : ''} {!isSelected && cell.isToday ? 'border border-primary text-primary' : ''}"
            onclick={() => handleSelectDateKey(cell.dateKey)}
          >
            {cell.dayNumber}
          </PopoverTrigger>
        {/each}
      </div>
    </PopoverContent>
  {/if}
</Popover>

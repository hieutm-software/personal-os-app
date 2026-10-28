import type { Writable } from 'svelte/store';

export const POPOVER_CONTEXT_KEY = 'popover';

export interface PopoverContext {
  readonly open: boolean;
  readonly isOpen: Writable<boolean>;
  setOpen: (value: boolean) => void;
  toggle: () => void;
  closeAndFocusTrigger: () => void;
  registerTrigger: (node: HTMLElement | null) => void;
}

export { default as Popover } from './Popover.svelte';
export { default as PopoverTrigger } from './PopoverTrigger.svelte';
export { default as PopoverContent } from './PopoverContent.svelte';

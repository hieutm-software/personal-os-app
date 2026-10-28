import type { Writable } from 'svelte/store';

export const DROPDOWN_MENU_CONTEXT_KEY = 'dropdown-menu';

export interface DropdownMenuContext {
  readonly open: boolean;
  readonly isOpen: Writable<boolean>;
  openMenu: () => void;
  closeMenu: () => void;
  toggleMenu: () => void;
  closeAndFocusTrigger: () => void;
  registerTrigger: (node: HTMLElement | null) => void;
  registerContent: (node: HTMLElement | null) => void;
}

export { default as DropdownMenu } from './DropdownMenu.svelte';
export { default as DropdownMenuTrigger } from './DropdownMenuTrigger.svelte';
export { default as DropdownMenuContent } from './DropdownMenuContent.svelte';
export { default as DropdownMenuItem } from './DropdownMenuItem.svelte';

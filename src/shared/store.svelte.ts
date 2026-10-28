export interface GlobalState {
  currentModule: string;
  vaultUnlocked: boolean;
}

export const globalState = $state<GlobalState>({
  currentModule: 'dashboard',
  vaultUnlocked: false,
});

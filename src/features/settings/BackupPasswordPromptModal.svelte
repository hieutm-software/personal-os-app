<script lang="ts">
  import { Lock, Eye, EyeOff, Key, Loader2, X, AlertCircle } from "lucide-svelte";
  import Button from "../../shared/ui/Button.svelte";

  let {
    isOpen = false,
    filePath = "",
    error = null,
    isSubmitting = false,
    onSubmit,
    onCancel,
  }: {
    isOpen: boolean;
    filePath?: string;
    error?: string | null;
    isSubmitting?: boolean;
    onSubmit: (password: string) => void;
    onCancel: () => void;
  } = $props();

  let password = $state("");
  let showPassword = $state(false);
  let localError = $state<string | null>(null);

  const fileName = $derived(filePath ? filePath.split(/[/\\]/).pop() : "backup");

  $effect(() => {
    if (isOpen) {
      password = "";
      showPassword = false;
      localError = null;
    }
  });

  $effect(() => {
    localError = error || null;
  });

  function handleFormSubmit(e?: Event) {
    e?.preventDefault();
    localError = null;
    const trimmed = password.trim();
    if (!trimmed) {
      localError = "Please enter the backup password.";
      return;
    }
    onSubmit(trimmed);
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
    <div
      class="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
    >
      <!-- Header -->
      <div class="p-5 border-b border-border bg-muted/20 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-sm">
            <Lock class="w-5 h-5" />
          </div>
          <div>
            <h2 class="text-base font-bold tracking-tight">Encrypted Backup</h2>
            <p class="text-xs text-muted-foreground mt-0.5 max-w-64 truncate" title={fileName}>
              {fileName}
            </p>
          </div>
        </div>
        <button
          type="button"
          class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
          onclick={onCancel}
          disabled={isSubmitting}
          aria-label="Close"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Body -->
      <form onsubmit={handleFormSubmit} class="p-5 space-y-4">
        <p class="text-xs text-muted-foreground leading-relaxed">
          This archive is secured with AES-256-GCM. Please provide the decryption password to view and restore its contents.
        </p>

        <!-- Password Input -->
        <div class="space-y-1.5">
          <label for="restore-pwd" class="text-xs font-semibold text-foreground">
            Password
          </label>
          <div class="relative">
            <input
              id="restore-pwd"
              type={showPassword ? "text" : "password"}
              bind:value={password}
              placeholder="Enter backup password"
              disabled={isSubmitting}
              class="w-full h-10 px-3 pl-9 pr-9 text-xs rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              required
            />
            <Key class="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
            <button
              type="button"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-md hover:bg-muted"
              onclick={() => (showPassword = !showPassword)}
              tabindex="-1"
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {#if showPassword}
                <EyeOff class="w-4 h-4" />
              {:else}
                <Eye class="w-4 h-4" />
              {/if}
            </button>
          </div>
        </div>

        {#if localError}
          <div class="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
            <AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
            <span class="leading-relaxed">{localError}</span>
          </div>
        {/if}

        <!-- Actions -->
        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
          <Button variant="ghost" class="h-9 px-4 text-xs font-medium" onclick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="default" class="h-9 px-4 text-xs font-medium flex items-center gap-1.5" disabled={isSubmitting}>
            {#if isSubmitting}
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
              <span>Decrypting...</span>
            {:else}
              <Lock class="w-3.5 h-3.5" />
              <span>Unlock & Restore</span>
            {/if}
          </Button>
        </div>
      </form>
    </div>
  </div>
{/if}

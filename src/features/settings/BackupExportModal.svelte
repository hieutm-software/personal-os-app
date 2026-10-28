<script lang="ts">
  import { Shield, ShieldAlert, Lock, Eye, EyeOff, Download, X } from "lucide-svelte";
  import Button from "../../shared/ui/Button.svelte";

  let {
    isOpen = false,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    onConfirm: (password?: string) => void;
    onCancel: () => void;
  } = $props();

  let encryptBackup = $state(true);
  let password = $state("");
  let confirmPassword = $state("");
  let showPassword = $state(false);
  let validationError = $state<string | null>(null);

  $effect(() => {
    if (isOpen) {
      encryptBackup = true;
      password = "";
      confirmPassword = "";
      showPassword = false;
      validationError = null;
    }
  });

  function handleFormSubmit(e?: Event) {
    e?.preventDefault();
    validationError = null;

    if (encryptBackup) {
      const trimmed = password.trim();
      if (!trimmed) {
        validationError = "Please enter an encryption password.";
        return;
      }
      if (trimmed.length < 4) {
        validationError = "Password should be at least 4 characters long.";
        return;
      }
      if (confirmPassword.trim() !== trimmed) {
        validationError = "Passwords do not match. Please verify.";
        return;
      }
      onConfirm(trimmed);
    } else {
      onConfirm(undefined);
    }
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
            <Shield class="w-5 h-5" />
          </div>
          <div>
            <h2 class="text-base font-bold tracking-tight">Export System Backup</h2>
            <p class="text-xs text-muted-foreground mt-0.5">Secure your database, documents, and notes</p>
          </div>
        </div>
        <button
          type="button"
          class="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
          onclick={onCancel}
          aria-label="Close"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Body -->
      <form onsubmit={handleFormSubmit} class="p-5 space-y-4">
        <!-- Encryption Toggle Card -->
        <label
          class="flex items-start gap-3 p-3.5 rounded-xl border border-border bg-card/50 hover:bg-accent/30 cursor-pointer transition-colors"
        >
          <input
            type="checkbox"
            bind:checked={encryptBackup}
            class="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary accent-primary"
          />
          <div class="flex-1 text-xs">
            <div class="font-semibold text-foreground flex items-center gap-1.5">
              <span>Encrypt Backup with AES-256-GCM</span>
              <span class="text-xs uppercase font-bold tracking-wider px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full leading-none">
                Recommended
              </span>
            </div>
            <p class="text-muted-foreground mt-1 leading-relaxed">
              Protects sensitive files and passwords. Hides all filenames, structure, and database metadata using Argon2id key derivation.
            </p>
          </div>
        </label>

        {#if encryptBackup}
          <div class="space-y-3 pt-1">
            <!-- Password Input -->
            <div class="space-y-1.5">
              <label for="export-pwd" class="text-xs font-semibold text-foreground">
                Backup Password
              </label>
              <div class="relative">
                <input
                  id="export-pwd"
                  type={showPassword ? "text" : "password"}
                  bind:value={password}
                  placeholder="Enter a strong password"
                  class="w-full h-10 px-3 pl-9 pr-9 text-xs rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  required
                />
                <Lock class="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
                <button
                  type="button"
                  class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-md hover:bg-muted"
                  onclick={() => (showPassword = !showPassword)}
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

            <!-- Confirm Password Input -->
            <div class="space-y-1.5">
              <label for="export-confirm-pwd" class="text-xs font-semibold text-foreground">
                Confirm Password
              </label>
              <div class="relative">
                <input
                  id="export-confirm-pwd"
                  type={showPassword ? "text" : "password"}
                  bind:value={confirmPassword}
                  placeholder="Re-enter your password"
                  class="w-full h-10 px-3 pl-9 pr-9 text-xs rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  required
                />
                <Lock class="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
              </div>
            </div>

            <p class="text-xs text-muted-foreground leading-normal">
              Important: This password cannot be recovered. Keep it in a safe place.
            </p>
          </div>
        {:else}
          <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 flex items-start gap-2.5">
            <ShieldAlert class="w-4 h-4 mt-0.5 shrink-0" />
            <p class="text-xs leading-relaxed">
              Unencrypted backups will be saved as a standard ZIP file. File names, database tables, and attachments will not be encrypted.
            </p>
          </div>
        {/if}

        {#if validationError}
          <div class="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs">
            {validationError}
          </div>
        {/if}

        <!-- Actions -->
        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
          <Button variant="ghost" class="h-9 px-4 text-xs font-medium" onclick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="default" class="h-9 px-4 text-xs font-medium flex items-center gap-1.5">
            <Download class="w-3.5 h-3.5" />
            {encryptBackup ? "Export Encrypted (.posbackup)" : "Export Standard ZIP"}
          </Button>
        </div>
      </form>
    </div>
  </div>
{/if}

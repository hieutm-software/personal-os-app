<script lang="ts">
  import { Check, Footprints } from "lucide-svelte";
  import Button from "../../shared/ui/Button.svelte";
  import Modal from "../../shared/ui/Modal.svelte";

  let {
    isOpen = $bindable(false),
    onDismiss,
  }: { isOpen: boolean; onDismiss: () => void } = $props();

  function handleConfirm(): void {
    try {
      if (!isOpen) return;
      isOpen = false;
      if (typeof onDismiss === "function") {
        onDismiss();
      }
    } catch {}
  }

  function handleKeydown(keyboardEvent: KeyboardEvent): void {
    try {
      if (!isOpen || keyboardEvent.repeat || keyboardEvent.key !== "Enter") {
        return;
      }
      keyboardEvent.preventDefault();
      handleConfirm();
    } catch {}
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Modal
  bind:isOpen
  title="Stand Up & Stretch"
  className="max-w-md"
  titleClass="text-center sm:text-center w-full"
  closeOnBackdropClick={false}
  closeOnEscape={false}
>
  <div class="flex flex-col items-center gap-4 py-2 text-center">
    <div
      class="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-8 ring-emerald-500/5 animate-bounce will-change-transform"
    >
      <Footprints class="h-8 w-8" />
    </div>

    <div class="space-y-1 text-center">
      <h3 class="text-lg font-bold text-foreground">
        Time to Move & Stretch!
      </h3>
      <p class="text-sm text-muted-foreground leading-relaxed">
        You've been sitting continuously. Take a short 2-minute break to stand
        up, walk around, or stretch your muscles.
      </p>
    </div>

    <div class="w-full pt-2">
      <Button
        variant="premium"
        class="w-full gap-2 shadow-lg shadow-primary/25"
        onclick={handleConfirm}
      >
        <Check class="h-4 w-4" />
        I've Stood Up & Stretched
      </Button>
    </div>
  </div>
</Modal>

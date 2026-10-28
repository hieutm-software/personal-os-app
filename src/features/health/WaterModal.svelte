<script lang="ts">
  import { Check, Droplet } from "lucide-svelte";
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
  title="Hydration Reminder"
  className="max-w-md"
  titleClass="text-center sm:text-center w-full"
  closeOnBackdropClick={false}
  closeOnEscape={false}
>
  <div class="flex flex-col items-center gap-4 py-2 text-center">
    <div
      class="flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10 text-blue-400 ring-8 ring-blue-500/5 animate-bounce will-change-transform"
    >
      <Droplet class="h-8 w-8" />
    </div>

    <div class="space-y-1 text-center">
      <h3 class="text-lg font-bold text-foreground">Time to Drink Water!</h3>
      <p class="text-sm text-muted-foreground leading-relaxed">
        Take a short break and drink some water to stay healthy, hydrated, and
        focused.
      </p>
    </div>

    <div class="w-full pt-2">
      <Button
        variant="premium"
        class="w-full gap-2 shadow-lg shadow-primary/25 bg-blue-600 hover:bg-blue-500 text-white"
        onclick={handleConfirm}
      >
        <Check class="h-4 w-4" />
        I've Had Water
      </Button>
    </div>
  </div>
</Modal>

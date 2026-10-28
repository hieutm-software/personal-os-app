<script lang="ts">
  import { onDestroy } from "svelte";
  import { Check, Clock, Eye, Play } from "lucide-svelte";
  import Button from "../../shared/ui/Button.svelte";
  import Modal from "../../shared/ui/Modal.svelte";
  import { stopContinuousAlarm } from "../../shared/utils/sound";

  type EyeCareStep = "ready" | "running" | "finished";

  const EYE_REST_DURATION_SECONDS = 20;
  const TIMER_TICK_INTERVAL_MS = 1000;

  let {
    isOpen = $bindable(false),
    onDismiss,
  }: { isOpen: boolean; onDismiss: () => void } = $props();

  let step = $state<EyeCareStep>("ready");
  let secondsLeft = $state(EYE_REST_DURATION_SECONDS);
  let activeTimerId: ReturnType<typeof setInterval> | null = null;
  let isMounted = true;

  let progressScale = $derived(
    Math.max(0, Math.min(1, secondsLeft / EYE_REST_DURATION_SECONDS))
  );

  function stopTimer(): void {
    if (activeTimerId !== null) {
      clearInterval(activeTimerId);
      activeTimerId = null;
    }
  }

  function resetModalState(): void {
    stopTimer();
    step = "ready";
    secondsLeft = EYE_REST_DURATION_SECONDS;
  }

  onDestroy(() => {
    isMounted = false;
    stopTimer();
  });

  $effect(() => {
    isOpen;
    resetModalState();
    return () => {
      stopTimer();
    };
  });

  function startTimer(): void {
    try {
      if (!isOpen || step === "running") return;
      stopTimer();
      stopContinuousAlarm();
      step = "running";
      secondsLeft = EYE_REST_DURATION_SECONDS;

      activeTimerId = setInterval(() => {
        if (!isMounted || !isOpen) {
          stopTimer();
          return;
        }
        if (secondsLeft > 1) {
          secondsLeft -= 1;
        } else {
          stopTimer();
          secondsLeft = 0;
          step = "finished";
        }
      }, TIMER_TICK_INTERVAL_MS);
    } catch {
      stopTimer();
    }
  }

  function handleFinish(): void {
    try {
      if (!isOpen) return;
      stopTimer();
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
      if (step === "ready") {
        startTimer();
      } else if (step === "finished") {
        handleFinish();
      }
    } catch {}
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Modal
  bind:isOpen
  title="20-20-20 Eye Care"
  className="max-w-md"
  titleClass="text-center sm:text-center w-full"
  closeOnBackdropClick={false}
  closeOnEscape={false}
>
  <div class="flex flex-col items-center gap-4 py-2 text-center">
    <div
      class="flex h-16 w-16 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-400 ring-8 ring-cyan-500/5 {step ===
      'running'
        ? 'animate-pulse'
        : ''}"
    >
      <Eye class="h-8 w-8" />
    </div>

    <div class="space-y-1 text-center w-full">
      <h3 class="text-lg font-bold text-foreground">
        {#if step === "ready"}
          Ready to Rest Your Eyes?
        {:else if step === "running"}
          Resting Your Eyes...
        {:else}
          Eye Rest Completed!
        {/if}
      </h3>
      <p class="text-sm text-muted-foreground leading-relaxed">
        {#if step === "ready"}
          Look at an object
          <strong class="text-foreground">20 feet (~6m) away</strong>
          for
          <strong class="text-cyan-400 font-mono">20 seconds</strong>
          to reduce eye strain.
        {:else if step === "running"}
          Keep looking at an object 20 feet (~6m) away for
          <strong class="text-cyan-400 font-mono">{secondsLeft}s</strong>...
        {:else}
          Great job! You've taken a break to rest your eyes. Click confirm to
          continue.
        {/if}
      </p>

      {#if step !== "ready"}
        <div
          class="h-2 w-full overflow-hidden rounded-full bg-secondary/50 mt-3 relative"
        >
          <div
            class="absolute top-0 left-0 h-full w-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-transform duration-1000 ease-linear origin-left will-change-transform"
            style="transform: scaleX({progressScale})"
          ></div>
        </div>
      {/if}
    </div>

    <div class="w-full pt-2">
      {#if step === "ready"}
        <Button
          variant="premium"
          class="w-full gap-2 shadow-lg shadow-primary/25 bg-cyan-600 hover:bg-cyan-500 text-white"
          onclick={startTimer}
        >
          <Play class="h-4 w-4 fill-current" />
          Start 20s Eye Rest
        </Button>
      {:else if step === "running"}
        <Button
          variant="premium"
          disabled
          class="w-full gap-2 opacity-60 cursor-not-allowed bg-cyan-900/50 text-cyan-200 border border-cyan-500/30"
        >
          <Clock class="h-4 w-4 animate-spin" />
          Resting Eyes... ({secondsLeft}s)
        </Button>
      {:else}
        <Button
          variant="premium"
          class="w-full gap-2 shadow-lg shadow-primary/25 bg-emerald-600 hover:bg-emerald-500 text-white"
          onclick={handleFinish}
        >
          <Check class="h-4 w-4" />
          I've Rested My Eyes
        </Button>
      {/if}
    </div>
  </div>
</Modal>

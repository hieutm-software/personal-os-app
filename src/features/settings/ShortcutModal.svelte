<script lang="ts">
  import Modal from "../../shared/ui/Modal.svelte";
  import Button from "../../shared/ui/Button.svelte";
  import DropdownMenu from "../../shared/ui/dropdown/DropdownMenu.svelte";
  import DropdownMenuTrigger from "../../shared/ui/dropdown/DropdownMenuTrigger.svelte";
  import DropdownMenuContent from "../../shared/ui/dropdown/DropdownMenuContent.svelte";
  import DropdownMenuItem from "../../shared/ui/dropdown/DropdownMenuItem.svelte";
  import { shortcutStore } from "../../shared/shortcutStore.svelte";
  import { Keyboard, RotateCcw, ChevronDown } from "lucide-svelte";

  type ShortcutParts = {
    mod1: string;
    mod2: string;
    key: string;
  };

  const MODIFIERS: readonly string[] = ["None", "Ctrl", "Cmd", "Meta", "Shift", "Alt"];
  const VALID_MODIFIER_SET = new Set<string>(MODIFIERS);
  const ZERO_WIDTH_AND_CONTROL_REGEX = /[\u200B-\u200D\uFEFF\x00-\x1f\x7f]/g;
  const MAX_KEY_LENGTH = 10;

  let { isOpen = $bindable(false) }: { isOpen?: boolean } = $props();

  function sanitizeKeyToken(rawKey: string): string {
    if (typeof rawKey !== "string") return "";
    return rawKey.replace(ZERO_WIDTH_AND_CONTROL_REGEX, "").trim().slice(0, MAX_KEY_LENGTH);
  }

  function decompose(shortcutStr: string | null | undefined): ShortcutParts {
    try {
      if (!shortcutStr || typeof shortcutStr !== "string") {
        return { mod1: "None", mod2: "None", key: "" };
      }
      const parts = shortcutStr.split("+");
      const rawKey = parts.pop() || "";
      const key = sanitizeKeyToken(rawKey);
      const rawMod1 = parts.length > 0 ? parts[0].trim() : "None";
      const rawMod2 = parts.length > 1 ? parts[1].trim() : "None";
      const mod1 = VALID_MODIFIER_SET.has(rawMod1) ? rawMod1 : "None";
      const mod2 = VALID_MODIFIER_SET.has(rawMod2) && rawMod2 !== mod1 ? rawMod2 : "None";
      return { mod1, mod2, key };
    } catch {
      return { mod1: "None", mod2: "None", key: "" };
    }
  }

  function compose(parts: ShortcutParts): string | null {
    try {
      if (!parts || typeof parts !== "object") return null;
      const cleanKey = sanitizeKeyToken(parts.key).toUpperCase();
      if (!cleanKey) return null;

      const tokens: string[] = [];
      const mod1 = VALID_MODIFIER_SET.has(parts.mod1) ? parts.mod1 : "None";
      const mod2 = VALID_MODIFIER_SET.has(parts.mod2) ? parts.mod2 : "None";

      if (mod1 !== "None") {
        tokens.push(mod1);
      }
      if (mod2 !== "None" && mod2 !== mod1) {
        tokens.push(mod2);
      }
      tokens.push(cleanKey);
      return tokens.join("+");
    } catch {
      return null;
    }
  }

  let editingTask = $state<ShortcutParts>(decompose(null));
  let editingNote = $state<ShortcutParts>(decompose(null));
  let editingCommand = $state<ShortcutParts>(decompose(null));
  let editingEvent = $state<ShortcutParts>(decompose(null));

  function syncFromStore() {
    try {
      const currentConfig = shortcutStore.config;
      editingTask = decompose(currentConfig.newTask);
      editingNote = decompose(currentConfig.newNote);
      editingCommand = decompose(currentConfig.commandPalette);
      editingEvent = decompose(currentConfig.newEvent);
    } catch {}
  }

  $effect(() => {
    if (isOpen) {
      syncFromStore();
    }
  });

  function handleSave() {
    try {
      shortcutStore.updateConfig({
        newTask: compose(editingTask),
        newNote: compose(editingNote),
        commandPalette: compose(editingCommand),
        newEvent: compose(editingEvent),
      });
      isOpen = false;
    } catch {}
  }

  function handleReset() {
    try {
      shortcutStore.reset();
      syncFromStore();
    } catch {}
  }
</script>

{#snippet modifierDropdown(value: string, onSelect: (modifier: string) => void)}
  <DropdownMenu>
    <DropdownMenuTrigger>
      <Button
        variant="outline"
        class="w-24 sm:w-28 justify-between font-normal h-10 px-3 py-2 bg-background"
      >
        {value}
        <ChevronDown class="w-4 h-4 opacity-50" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-24 sm:w-28">
      {#each MODIFIERS as modifier (modifier)}
        <DropdownMenuItem onclick={() => onSelect(modifier)}>
          <span class={value === modifier ? "font-semibold text-primary" : ""}>{modifier}</span>
        </DropdownMenuItem>
      {/each}
    </DropdownMenuContent>
  </DropdownMenu>
{/snippet}

{#snippet shortcutRow(title: string, desc: string, binding: ShortcutParts)}
  <div
    class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl border border-border bg-card/50 hover:bg-card/80 transition-colors"
  >
    <div>
      <h4 class="text-base font-semibold">{title}</h4>
      <p class="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
    <div class="flex items-center flex-wrap gap-2.5">
      {@render modifierDropdown(binding.mod1, (modifier) => (binding.mod1 = modifier))}
      <span class="text-muted-foreground text-sm font-terminal font-semibold">+</span>
      {@render modifierDropdown(binding.mod2, (modifier) => (binding.mod2 = modifier))}
      <span class="text-muted-foreground text-sm font-terminal font-semibold">+</span>
      <input
        type="text"
        bind:value={binding.key}
        placeholder="Key"
        maxlength={MAX_KEY_LENGTH}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        class="flex h-10 w-20 rounded-md border border-input bg-background px-3 py-2 text-sm text-center font-terminal font-bold shadow-sm focus:outline-none focus:ring-1 focus:ring-primary uppercase placeholder:normal-case placeholder:text-muted-foreground placeholder:font-normal"
      />
    </div>
  </div>
{/snippet}

<Modal bind:isOpen title="Keyboard Shortcuts" className="max-w-4xl">
  <div class="space-y-6 py-2">
    <div
      class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 w-fit"
    >
      <Keyboard class="w-4 h-4" />
      <span class="text-xs font-semibold uppercase tracking-widest">Customize Shortcuts</span>
    </div>

    <p class="text-sm text-muted-foreground leading-relaxed max-w-3xl">
      Choose modifier keys from the dropdowns and type a key character (e.g. <code>T</code>,
      <code>N</code>). Leave the key input empty to disable that shortcut. Set a modifier to
      <code>None</code> to ignore it.
    </p>

    <div class="space-y-4">
      {@render shortcutRow("New Task", "Quickly open the create task modal.", editingTask)}
      {@render shortcutRow("New Note", "Quickly create a new Markdown note in Documents.", editingNote)}
      {@render shortcutRow("New Event", "Quickly open the create event modal.", editingEvent)}
      {@render shortcutRow(
        "Command Palette",
        "Open quick search and navigation.",
        editingCommand
      )}
    </div>

    <div class="flex items-center justify-between pt-6 border-t border-border mt-8">
      <Button variant="outline" onclick={handleReset}>
        <RotateCcw class="w-4 h-4 mr-2" />
        Reset Defaults
      </Button>
      <div class="flex items-center gap-3">
        <Button variant="outline" onclick={() => (isOpen = false)}>Cancel</Button>
        <Button variant="premium" onclick={handleSave}>Save Changes</Button>
      </div>
    </div>
  </div>
</Modal>

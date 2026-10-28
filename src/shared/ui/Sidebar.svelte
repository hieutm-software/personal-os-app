<script module lang="ts">
  import { Home, ListTodo, Calendar, Folder, ShieldCheck } from "lucide-svelte";

  const MODULES = Object.freeze([
    Object.freeze({ id: "dashboard", label: "Dashboard", icon: Home }),
    Object.freeze({ id: "tasks", label: "Tasks", icon: ListTodo }),
    Object.freeze({ id: "calendar", label: "Calendar", icon: Calendar }),
    Object.freeze({ id: "documents", label: "Documents", icon: Folder }),
    Object.freeze({ id: "vault", label: "Vault", icon: ShieldCheck })
  ]);
</script>

<script lang="ts">
  import { globalState } from "../../shared/store.svelte";
  import { Settings } from "lucide-svelte";

  let isSettingsActive = $derived(globalState.currentModule === "settings");

  function handleNavClick(modId: string) {
    try {
      globalState.currentModule = modId;
    } catch {}
  }
</script>

<aside
  class="sidebar-glass border-r border-border/40 shadow-xs z-sidebar flex flex-col h-screen sticky top-0 shrink-0 w-14 py-3 px-2 items-center select-none"
  aria-label="Activity Bar"
>
  <nav class="flex flex-col items-center gap-1.5 w-full">
    {#each MODULES as mod (mod.id)}
      {@const isActive = globalState.currentModule === mod.id}
      {@const Icon = mod.icon}
      <button
        type="button"
        title={mod.label}
        aria-label={mod.label}
        class="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer {isActive
          ? 'bg-accent text-foreground shadow-xs'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
        onclick={() => handleNavClick(mod.id)}
      >
        <Icon
          class="w-5 h-5 shrink-0 {isActive ? 'text-foreground' : 'text-muted-foreground'}"
          strokeWidth={1.8}
        />
      </button>
    {/each}
  </nav>

  <div class="mt-auto flex flex-col items-center w-full pt-2">
    <button
      type="button"
      title="Settings"
      aria-label="Settings"
      class="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 cursor-pointer {isSettingsActive
        ? 'bg-accent text-foreground shadow-xs'
        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
      onclick={() => handleNavClick("settings")}
    >
      <Settings
        class="w-5 h-5 shrink-0 {isSettingsActive ? 'text-foreground' : 'text-muted-foreground'}"
        strokeWidth={1.8}
      />
    </button>
  </div>
</aside>

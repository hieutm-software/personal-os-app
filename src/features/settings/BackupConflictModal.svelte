<script lang="ts">
  import {
    AlertTriangle,
    GitMerge,
    Check,
    CheckCheck,
    FileText,
    CheckSquare,
    Folder,
    Lock,
    Calendar,
    ArrowRight,
    Search,
    X,
  } from "lucide-svelte";
  import type { BackupDiffResult } from "./backupRestore";

  let {
    isOpen = false,
    diffResult = null,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    diffResult: BackupDiffResult | null;
    onConfirm: (resolutions: Map<string, "overwrite" | "keep_local">) => void;
    onCancel: () => void;
  } = $props();

  let resolutions = $state<Map<string, "overwrite" | "keep_local">>(new Map());
  let searchQuery = $state("");
  let selectedCategory = $state<string>("ALL");

  $effect(() => {
    if (diffResult && diffResult.conflicts) {
      const nextMap = new Map<string, "overwrite" | "keep_local">();
      for (const c of diffResult.conflicts) {
        nextMap.set(c.id, c.resolution);
      }
      resolutions = nextMap;
      searchQuery = "";
      selectedCategory = "ALL";
    }
  });

  function setAllResolutions(action: "overwrite" | "keep_local") {
    if (!diffResult) return;
    const nextMap = new Map<string, "overwrite" | "keep_local">();
    for (const c of diffResult.conflicts) {
      nextMap.set(c.id, action);
    }
    resolutions = nextMap;
  }

  function setItemResolution(id: string, action: "overwrite" | "keep_local") {
    const nextMap = new Map(resolutions);
    nextMap.set(id, action);
    resolutions = nextMap;
  }

  let filteredConflicts = $derived.by(() => {
    if (!diffResult || !diffResult.conflicts) return [];
    return diffResult.conflicts.filter((c) => {
      if (selectedCategory !== "ALL" && c.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          c.title.toLowerCase().includes(query) ||
          c.categoryLabel.toLowerCase().includes(query)
        );
      }
      return true;
    });
  });

  function formatDate(ms?: number): string {
    if (!ms) return "Unknown date";
    return new Date(ms).toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function getCategoryIcon(category: string) {
    switch (category) {
      case "notes":
        return FileText;
      case "tasks":
        return CheckSquare;
      case "documents":
        return Folder;
      case "vault":
        return Lock;
      case "events":
        return Calendar;
      default:
        return FileText;
    }
  }

  function getCategoryColor(category: string): string {
    switch (category) {
      case "notes":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
      case "tasks":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
      case "documents":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
      case "vault":
        return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
      case "events":
        return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    }
  }
</script>

{#if isOpen && diffResult}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
    <div
      class="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
    >
      <div class="p-6 border-b border-border bg-muted/20">
        <div class="flex items-start justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20 shadow-sm">
              <GitMerge class="w-6 h-6" />
            </div>
            <div>
              <h2 class="text-lg font-bold tracking-tight flex items-center gap-2">
                Backup Data Conflict
                <span class="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  {diffResult.conflicts.length} conflicting items
                </span>
              </h2>
              <p class="text-xs text-muted-foreground mt-0.5">
                The items below have matching identifiers/names but different content. Please select which version you wish to keep.
              </p>
            </div>
          </div>
          <button
            onclick={onCancel}
            class="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted/80 transition-colors"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2.5 mt-4 text-xs">
          <div class="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Check class="w-3.5 h-3.5" />
            <span><strong>{diffResult.newItemsCount}</strong> new items (automatically added)</span>
          </div>
          <div class="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <CheckCheck class="w-3.5 h-3.5" />
            <span><strong>{diffResult.identicalCount}</strong> identical items (preserved)</span>
          </div>
          <div class="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <AlertTriangle class="w-3.5 h-3.5" />
            <span><strong>{diffResult.conflicts.length}</strong> conflicts to resolve</span>
          </div>
        </div>
      </div>

      <div class="px-6 py-3 border-b border-border bg-card flex flex-wrap items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground font-medium">Quick select:</span>
          <button
            type="button"
            onclick={() => setAllResolutions("overwrite")}
            class="px-2.5 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted font-medium transition-colors"
          >
            Overwrite all with Backup
          </button>
          <button
            type="button"
            onclick={() => setAllResolutions("keep_local")}
            class="px-2.5 py-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted font-medium transition-colors"
          >
            Keep all Local versions
          </button>
        </div>

        <div class="relative w-64">
          <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            bind:value={searchQuery}
            placeholder="Search conflicting items..."
            class="w-full pl-8 pr-3 py-1 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-6 space-y-4">
        {#if filteredConflicts.length === 0}
          <div class="text-center py-12 text-muted-foreground">
            <p>No items matched your search filter.</p>
          </div>
        {:else}
          {#each filteredConflicts as conflict (conflict.id)}
            {@const Icon = getCategoryIcon(conflict.category)}
            {@const currentRes = resolutions.get(conflict.id) || conflict.resolution}
            <div class="border border-border rounded-xl p-4 bg-card hover:border-primary/30 transition-colors shadow-sm">
              <div class="flex items-center justify-between gap-3 mb-3">
                <div class="flex items-center gap-2">
                  <span class={`flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-md border font-medium ${getCategoryColor(conflict.category)}`}>
                    <Icon class="w-3.5 h-3.5" />
                    {conflict.categoryLabel}
                  </span>
                  <span class="font-semibold text-sm truncate max-w-md" title={conflict.title}>
                    {conflict.title}
                  </span>
                  {#if conflict.path}
                    <span class="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                      {conflict.path}
                    </span>
                  {/if}
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <button
                  type="button"
                  onclick={() => setItemResolution(conflict.id, "keep_local")}
                  class={`text-left p-3 rounded-lg border transition-all flex flex-col justify-between ${
                    currentRes === "keep_local"
                      ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                      : "border-border bg-muted/10 hover:bg-muted/30"
                  }`}
                >
                  <div>
                    <div class="flex items-center justify-between font-semibold mb-1 text-foreground">
                      <span>Current local version</span>
                      {#if currentRes === "keep_local"}
                        <span class="text-primary flex items-center gap-1 font-bold">
                          <Check class="w-3.5 h-3.5" /> Selected (Keep Local)
                        </span>
                      {/if}
                    </div>
                    <p class="text-muted-foreground text-xs mb-1.5">
                      Updated: {formatDate(conflict.localUpdatedAt)}
                    </p>
                    <p class="text-muted-foreground/90 line-clamp-2 bg-background/50 p-1.5 rounded border border-border/50 font-mono text-xs">
                      {conflict.localPreview || "(No content)"}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onclick={() => setItemResolution(conflict.id, "overwrite")}
                  class={`text-left p-3 rounded-lg border transition-all flex flex-col justify-between ${
                    currentRes === "overwrite"
                      ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                      : "border-border bg-muted/10 hover:bg-muted/30"
                  }`}
                >
                  <div>
                    <div class="flex items-center justify-between font-semibold mb-1 text-foreground">
                      <span>Backup file version</span>
                      {#if currentRes === "overwrite"}
                        <span class="text-primary flex items-center gap-1 font-bold">
                          <Check class="w-3.5 h-3.5" /> Selected (Overwrite)
                        </span>
                      {/if}
                    </div>
                    <p class="text-muted-foreground text-xs mb-1.5">
                      Updated: {formatDate(conflict.backupUpdatedAt)}
                    </p>
                    <p class="text-muted-foreground/90 line-clamp-2 bg-background/50 p-1.5 rounded border border-border/50 font-mono text-xs">
                      {conflict.backupPreview || "(No content)"}
                    </p>
                  </div>
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <div class="p-4 px-6 border-t border-border bg-muted/20 flex items-center justify-between gap-3 text-xs">
        <span class="text-muted-foreground">
          Selected to overwrite: <strong>{Array.from(resolutions.values()).filter(v => v === "overwrite").length}</strong> |
          Keep local: <strong>{Array.from(resolutions.values()).filter(v => v === "keep_local").length}</strong>
        </span>

        <div class="flex items-center gap-2.5">
          <button
            type="button"
            onclick={onCancel}
            class="px-4 py-2 rounded-xl border border-border hover:bg-muted font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={() => onConfirm(resolutions)}
            class="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold shadow-md hover:bg-primary/90 transition-all flex items-center gap-2"
          >
            <span>Proceed with Restore</span>
            <ArrowRight class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

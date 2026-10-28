<script module lang="ts">
  import { cubicOut } from 'svelte/easing';
  import { Home, ListTodo, Calendar, Folder, ShieldCheck } from 'lucide-svelte';

  const BACKDROP_FADE_PARAMS = Object.freeze({ duration: 150 });
  const DIALOG_FLY_IN_PARAMS = Object.freeze({ y: -10, duration: 200, easing: cubicOut });

  const NAVIGATION_ITEMS = Object.freeze([
    Object.freeze({ id: 'dashboard', label: 'Dashboard', Icon: Home }),
    Object.freeze({ id: 'tasks', label: 'Tasks', Icon: ListTodo }),
    Object.freeze({ id: 'calendar', label: 'Calendar', Icon: Calendar }),
    Object.freeze({ id: 'documents', label: 'Documents', Icon: Folder }),
    Object.freeze({ id: 'vault', label: 'Vault', Icon: ShieldCheck })
  ]);

  const MAX_RESULTS_PER_CATEGORY = 5;
</script>

<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { Search, Loader2, Settings } from 'lucide-svelte';
  import { globalState } from '../store.svelte';
  import { db } from '../../shared/db/client';
  import { tasks, documents, type Task, type DocumentItem } from '../../shared/db/schema';
  import { like, or } from 'drizzle-orm';
  import { taskStore } from '../taskStore.svelte';
  import { shortcutStore } from '../../shared/shortcutStore.svelte';

  const EMPTY_SEARCH_RESULTS = Object.freeze({
    tasks: [] as Task[],
    documents: [] as DocumentItem[]
  });

  let open = $state(false);
  let search = $state('');
  let isExecuting = $state(false);
  let latestSearchId = 0;

  let searchResults = $state<{
    tasks: Task[];
    documents: DocumentItem[];
  }>({ tasks: [], documents: [] });

  $effect(() => {
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      try {
        if (!shortcutStore.isInitialized) return;

        if (shortcutStore.matchShortcut(e, shortcutStore.config.commandPalette)) {
          e.preventDefault();
          open = !open;
          return;
        }
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          open = false;
        }
      } catch {}
    };
    document.addEventListener('keydown', handleGlobalKeydown);
    return () => document.removeEventListener('keydown', handleGlobalKeydown);
  });

  $effect(() => {
    if (!open) {
      latestSearchId++;
      isExecuting = false;
      search = '';
      searchResults = {
        tasks: EMPTY_SEARCH_RESULTS.tasks,
        documents: EMPTY_SEARCH_RESULTS.documents
      };
      return;
    }

    try {
      if (!taskStore.isInitialized) taskStore.fetchAll().catch(() => {});
    } catch {}

    const trimmedQuery = search.trim();
    if (trimmedQuery.length === 0) {
      latestSearchId++;
      isExecuting = false;
      searchResults = {
        tasks: EMPTY_SEARCH_RESULTS.tasks,
        documents: EMPTY_SEARCH_RESULTS.documents
      };
      return;
    }

    const timer = setTimeout(() => {
      executeSearch(trimmedQuery).catch(() => {});
    }, 300);

    return () => clearTimeout(timer);
  });

  async function executeSearch(query: string) {
    const requestId = ++latestSearchId;
    isExecuting = true;
    try {
      const sanitized = query.replace(/[%_]/g, '\\$&');
      const pattern = `%${sanitized}%`;

      const [foundTasks, foundDocs] = await Promise.all([
        taskStore.isInitialized
          ? Promise.resolve(EMPTY_SEARCH_RESULTS.tasks)
          : db
              .select()
              .from(tasks)
              .where(or(like(tasks.title, pattern), like(tasks.description, pattern)))
              .limit(MAX_RESULTS_PER_CATEGORY),
        db
          .select()
          .from(documents)
          .where(like(documents.name, pattern))
          .limit(MAX_RESULTS_PER_CATEGORY)
      ]);

      if (requestId !== latestSearchId || !open) return;

      searchResults = {
        tasks: foundTasks,
        documents: foundDocs
      };
    } catch {
      if (requestId === latestSearchId) {
        searchResults = {
          tasks: EMPTY_SEARCH_RESULTS.tasks,
          documents: EMPTY_SEARCH_RESULTS.documents
        };
      }
    } finally {
      if (requestId === latestSearchId) {
        isExecuting = false;
      }
    }
  }

  function runCommand(moduleId: string) {
    try {
      open = false;
      globalState.currentModule = moduleId;
    } catch {}
  }

  let normalizedQuery = $derived(search.trim().toLowerCase());

  let storeTasks = $derived.by(() => {
    try {
      const q = normalizedQuery;
      if (!q) return EMPTY_SEARCH_RESULTS.tasks;
      const matches: Task[] = [];
      const allTasks = taskStore.tasks;
      for (let i = 0; i < allTasks.length; i++) {
        const t = allTasks[i];
        if (t.deletedAt) continue;
        if (
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q))
        ) {
          matches.push(t);
          if (matches.length === MAX_RESULTS_PER_CATEGORY) break;
        }
      }
      return matches;
    } catch {
      return EMPTY_SEARCH_RESULTS.tasks;
    }
  });

  let effectiveTasks = $derived(storeTasks.length > 0 ? storeTasks : searchResults.tasks);
  let effectiveDocs = $derived(searchResults.documents);

  let hasSearchResults = $derived(
    effectiveTasks.length > 0 || effectiveDocs.length > 0
  );

  function handleBackdropClick(e: MouseEvent) {
    try {
      if (e.target === e.currentTarget) {
        open = false;
      }
    } catch {}
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-command bg-background/80 backdrop-blur-sm"
    transition:fade={BACKDROP_FADE_PARAMS}
    onclick={handleBackdropClick}
    role="presentation"
  >
    <div class="fixed left-1/2 top-[20%] w-full max-w-2xl -translate-x-1/2 p-4">
      <div
        class="card-aura-responsive border border-premium-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        tabindex="-1"
        in:fly={DIALOG_FLY_IN_PARAMS}
        out:fade={BACKDROP_FADE_PARAMS}
      >
        <div class="flex items-center border-b border-border px-3">
          <Search class="mr-2 h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            bind:value={search}
            placeholder="Search tasks, documents, or navigate..."
            class="flex h-14 w-full rounded-md bg-transparent py-3 text-lg outline-none placeholder:text-muted-foreground"
          />
          {#if isExecuting}
            <Loader2 class="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-muted-foreground" />
          {/if}
        </div>

        <div class="max-h-96 overflow-y-auto p-2 scroll-smooth">
          {#if normalizedQuery.length > 0 && !hasSearchResults && !isExecuting}
            <div class="py-6 text-center text-sm text-muted-foreground">
              No results found for "{search}".
            </div>
          {/if}

          {#if normalizedQuery.length > 0}
            {#if effectiveTasks.length > 0}
              <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">Tasks</div>
              {#each effectiveTasks as task (task.id)}
                <button
                  type="button"
                  class="w-full relative flex items-center rounded-sm px-2 py-2.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  onclick={() => runCommand('tasks')}
                >
                  <ListTodo class="mr-2 h-4 w-4 text-indigo-500" />
                  <span class="truncate">{task.title}</span>
                </button>
              {/each}
            {/if}

            {#if effectiveDocs.length > 0}
              <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground mt-2">Documents</div>
              {#each effectiveDocs as doc (doc.id)}
                <button
                  type="button"
                  class="w-full relative flex items-center rounded-sm px-2 py-2.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  onclick={() => runCommand('documents')}
                >
                  <Folder class="mr-2 h-4 w-4 text-amber-500" />
                  <span class="truncate">{doc.name}</span>
                </button>
              {/each}
            {/if}
          {:else}
            <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground">Navigation</div>
            {#each NAVIGATION_ITEMS as nav (nav.id)}
              {@const NavIcon = nav.Icon}
              <button
                type="button"
                class="w-full relative flex items-center rounded-sm px-2 py-2.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                onclick={() => runCommand(nav.id)}
              >
                <NavIcon class="mr-2 h-4 w-4" />
                <span>{nav.label}</span>
              </button>
            {/each}

            <div class="px-2 py-1.5 text-xs font-medium text-muted-foreground mt-2">Settings</div>
            <button
              type="button"
              class="w-full relative flex items-center rounded-sm px-2 py-2.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
              onclick={() => runCommand('settings')}
            >
              <Settings class="mr-2 h-4 w-4" />
              <span>System Settings</span>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

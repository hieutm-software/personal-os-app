<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Bell, Calendar, CheckCheck, CheckCircle2, Info, X, AlertCircle } from 'lucide-svelte';
  import { notificationCenterStore, type NotificationItem } from '../notificationCenterStore.svelte';
  import { eventStore } from '../eventStore.svelte';
  import { globalState } from '../store.svelte';
  import { taskStore } from '../taskStore.svelte';

  let { isOpen = $bindable(false) }: { isOpen?: boolean } = $props();
  let activeTab = $state<'all' | 'calendar' | 'task'>('all');
  let isMounted = true;

  onMount(() => {
    try {
      notificationCenterStore.refresh();
    } catch {}
  });

  onDestroy(() => {
    isMounted = false;
  });

  function handleKeydown(e: KeyboardEvent) {
    try {
      if (isOpen && e.key === 'Escape') {
        isOpen = false;
      }
    } catch {}
  }

  $effect(() => {
    if (!isOpen || !isMounted) return;
    try {
      notificationCenterStore.refresh();
    } catch {}

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeydown);
      return () => {
        window.removeEventListener('keydown', handleKeydown);
      };
    }
  });

  const filteredNotifications = $derived.by(() => {
    try {
      const list = notificationCenterStore.notifications;
      if (activeTab === 'all') return list;
      const filtered: NotificationItem[] = [];
      for (let i = 0; i < list.length; i++) {
        if (list[i].type === activeTab) {
          filtered.push(list[i]);
        }
      }
      return filtered;
    } catch {
      return [];
    }
  });

  function handleItemClick(item: NotificationItem) {
    try {
      notificationCenterStore.markAsRead(item.id);

      if (item.type === 'calendar' && item.targetId) {
        let targetEvent = null;
        const allEvents = eventStore.events;
        for (let i = 0; i < allEvents.length; i++) {
          if (allEvents[i].id === item.targetId) {
            targetEvent = allEvents[i];
            break;
          }
        }

        if (!targetEvent) {
          notificationCenterStore.refresh();
          eventStore.notifyMissingEvent();
          isOpen = false;
          return;
        }

        eventStore.selectEventFromNotification(targetEvent.id);
        isOpen = false;
        return;
      }

      if (item.type === 'task' && item.targetId) {
        let targetTask = null;
        const allTasks = taskStore.tasks;
        for (let i = 0; i < allTasks.length; i++) {
          if (allTasks[i].id === item.targetId) {
            targetTask = allTasks[i];
            break;
          }
        }

        if (!targetTask) {
          notificationCenterStore.refresh();
          taskStore.notifyMissingTask();
          isOpen = false;
          return;
        }

        const realTimeFilter = targetTask.status === 'COMPLETED' ? 'COMPLETED' : 'PENDING';
        taskStore.selectTaskFromNotification(realTimeFilter, targetTask.id);
      }

      globalState.currentModule = item.linkModule;
      isOpen = false;
    } catch {}
  }

  function handleMarkAllRead() {
    try {
      notificationCenterStore.markAllAsRead();
    } catch {}
  }
</script>

{#if isOpen}
  <button
    type="button"
    aria-label="Close notification center"
    class="fixed inset-0 z-40 bg-black/20 backdrop-blur-xs w-full h-full cursor-default border-none p-0 focus:outline-none"
    onclick={() => (isOpen = false)}
  ></button>

  <div
    class="absolute right-0 top-12 z-50 w-80 sm:w-96 rounded-2xl border border-premium-border bg-card/95 backdrop-blur-xl shadow-2xl p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200"
  >
    <div class="flex items-center justify-between pb-2 border-b border-white/5">
      <div class="flex items-center gap-2">
        <Bell class="w-4 h-4 text-primary" />
        <span class="text-sm font-semibold text-foreground">Notifications</span>
        {#if notificationCenterStore.unreadCount > 0}
          <span class="px-2 py-0.5 text-xs font-bold rounded-full bg-primary/20 text-primary border border-primary/30">
            {notificationCenterStore.unreadCount} new
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-1">
        {#if notificationCenterStore.unreadCount > 0}
          <button
            type="button"
            onclick={handleMarkAllRead}
            class="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors text-xs flex items-center gap-1"
            title="Mark all as read"
          >
            <CheckCheck class="w-3.5 h-3.5 text-emerald-400" />
          </button>
        {/if}
        <button
          type="button"
          onclick={() => (isOpen = false)}
          class="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
        >
          <X class="w-4 h-4" />
        </button>
      </div>
    </div>

    <div class="flex items-center gap-1 p-0.5 bg-black/5 dark:bg-white/5 rounded-xl text-xs font-medium">
      <button
        type="button"
        onclick={() => (activeTab = 'all')}
        class="flex-1 py-1 rounded-lg transition-colors text-center {activeTab === 'all' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
      >
        All
      </button>
      <button
        type="button"
        onclick={() => (activeTab = 'calendar')}
        class="flex-1 py-1 rounded-lg transition-colors text-center {activeTab === 'calendar' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
      >
        Events
      </button>
      <button
        type="button"
        onclick={() => (activeTab = 'task')}
        class="flex-1 py-1 rounded-lg transition-colors text-center {activeTab === 'task' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
      >
        Tasks
      </button>
    </div>

    <div class="max-h-72 overflow-y-auto space-y-1.5 pr-1">
      {#if filteredNotifications.length === 0}
        <div class="py-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
          <CheckCircle2 class="w-8 h-8 text-muted-foreground/40" />
          <span>No notifications</span>
        </div>
      {:else}
        {#each filteredNotifications as item (item.id)}
          <button
            type="button"
            onclick={() => handleItemClick(item)}
            class="w-full text-left p-2.5 rounded-xl transition-all border border-transparent hover:border-premium-border hover:bg-white/5 flex items-start gap-3 relative group {item.isRead ? 'opacity-60' : 'bg-primary/5 border-primary/20'}"
          >
            <div class="p-2 rounded-lg bg-black/5 dark:bg-white/5 shrink-0 mt-0.5">
              {#if item.type === 'calendar'}
                <Calendar
                  class="w-3.5 h-3.5 {item.severity === 'error' ? 'text-red-500' : item.severity === 'warning' ? 'text-amber-500' : 'text-blue-400'}"
                />
              {:else if item.type === 'task'}
                {#if item.severity === 'error'}
                  <AlertCircle class="w-3.5 h-3.5 text-red-500" />
                {:else}
                  <CheckCircle2
                    class="w-3.5 h-3.5 {item.severity === 'warning' ? 'text-amber-500' : 'text-emerald-500'}"
                  />
                {/if}
              {:else}
                <Info class="w-3.5 h-3.5 text-indigo-400" />
              {/if}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium text-muted-foreground truncate">{item.title}</span>
                <span class="text-xs text-muted-foreground/60 shrink-0">{item.time}</span>
              </div>
              <p class="text-xs font-semibold text-foreground truncate mt-0.5">{item.message}</p>
            </div>

            {#if !item.isRead}
              <div class="w-2 h-2 rounded-full bg-primary shrink-0 self-center"></div>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>
{/if}

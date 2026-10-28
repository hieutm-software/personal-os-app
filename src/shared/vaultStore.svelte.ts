import { vaultRepo, vaultGroupRepo } from './db/repo/vaultRepo';
import { uiPreferenceRepo } from './db/repo/uiPreferenceRepo';
import type { VaultItem, VaultGroup } from './db/schema';
import { toastState } from './toast.svelte';

function pruneGroupOrder(storageKey: string, deletedId: string) {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const next = parsed.filter((id) => id !== deletedId);
          const nextJson = JSON.stringify(next);
          localStorage.setItem(storageKey, nextJson);
          uiPreferenceRepo.set(storageKey, nextJson).catch(() => {});
        }
      }
    }
  } catch {}
}

const DAY_MS = 86400000;

export type DecryptedVaultEntry = {
  username?: string;
  password?: string;
  note?: string;
};

function createVaultStore() {
  let items = $state<VaultItem[]>([]);
  let vaultGroups = $state<VaultGroup[]>([]);
  let initialized = $state(false);
  let masterKey = $state('');
  let decryptedDataCache = $state<Record<string, DecryptedVaultEntry>>({});
  let fetchPromise: Promise<void> | null = null;

  function purgeDecryptedIds(ids: Iterable<string>) {
    for (const id of ids) {
      if (id in decryptedDataCache) {
        delete decryptedDataCache[id];
      }
    }
  }

  return {
    get items() {
      return items;
    },
    get vaultGroups() {
      return vaultGroups;
    },
    get isInitialized() {
      return initialized;
    },
    get masterKey() {
      return masterKey;
    },
    set masterKey(v: string) {
      masterKey = v ? String(v) : '';
    },
    get decryptedDataCache() {
      return decryptedDataCache;
    },
    set decryptedDataCache(v: Record<string, DecryptedVaultEntry>) {
      decryptedDataCache = v && typeof v === 'object' ? v : {};
    },

    lock() {
      masterKey = '';
      decryptedDataCache = {};
    },

    async fetchAll() {
      if (fetchPromise) return fetchPromise;
      fetchPromise = (async () => {
        try {
          const [fetchedItems, fetchedGroups] = await Promise.all([
            vaultRepo.getAll(),
            vaultGroupRepo.getAll(),
          ]);
          const groupMap = new Map<string, VaultGroup>();
          const seenKeys = new Set<string>();
          for (let i = 0; i < fetchedGroups.length; i++) {
            const g = fetchedGroups[i];
            if (g && g.id && g.deletedAt == null) {
              const key = `${g.parentId || 'root'}:::${g.name.trim().toLowerCase()}`;
              if (!groupMap.has(g.id) && !seenKeys.has(key)) {
                groupMap.set(g.id, g);
                seenKeys.add(key);
              }
            }
          }
          const uniqueGroups = Array.from(groupMap.values());
          vaultGroups = uniqueGroups;
          const groupIds = new Set(uniqueGroups.map((g) => g.id));
          items = fetchedItems.map((i) => (i.groupId && !groupIds.has(i.groupId) ? { ...i, groupId: null } : i));
          initialized = true;
          vaultGroupRepo.sanitizeOrphans().catch(() => {});
        } catch {
          initialized = true;
          toastState.add('error', 'Failed to fetch vault items');
        } finally {
          fetchPromise = null;
        }
      })();
      return fetchPromise;
    },

    async addItem(item: VaultItem) {
      try {
        if (!item || !item.id) return;
        if (item.name && item.name.length > 255) {
          toastState.add('error', 'Name exceeds 255 characters');
          return;
        }
        if (item.encryptedData && item.encryptedData.length > 10000) {
          toastState.add('error', 'Encrypted data exceeds 10,000 characters');
          return;
        }
        const prev = [...items];
        items = [...items, item];
        try {
          await vaultRepo.create(item);
          toastState.add('success', 'Credential created');
        } catch {
          items = prev;
          toastState.add('error', 'Failed to create credential');
        }
      } catch {
        toastState.add('error', 'Failed to create credential');
      }
    },

    async updateItem(id: string, data: Partial<VaultItem>, silent: boolean = false) {
      try {
        if (!id || !data) return;
        if (data.name && data.name.length > 255) {
          toastState.add('error', 'Name exceeds 255 characters');
          return;
        }
        if (data.encryptedData && data.encryptedData.length > 10000) {
          toastState.add('error', 'Encrypted data exceeds 10,000 characters');
          return;
        }
        const payload: Partial<VaultItem> = { ...data, updatedAt: Date.now() };
        const index = items.findIndex((i) => i.id === id);
        const original = index !== -1 ? items[index] : null;
        if (index !== -1 && original) {
          items[index] = { ...original, ...payload };
        }
        try {
          await vaultRepo.update(id, payload);
          if (!silent) toastState.add('success', 'Credential updated');
        } catch {
          if (original) {
            const curIdx = items.findIndex((i) => i.id === id);
            if (curIdx !== -1) items[curIdx] = original;
          }
          toastState.add('error', 'Failed to update credential');
        }
      } catch {
        toastState.add('error', 'Failed to update credential');
      }
    },

    async moveToTrash(id: string) {
      try {
        if (!id) return;
        const index = items.findIndex((i) => i.id === id);
        if (index === -1) return;
        const original = items[index];
        const now = Date.now();
        items[index] = { ...original, deletedAt: now, updatedAt: now };
        try {
          await vaultRepo.update(id, { deletedAt: now, updatedAt: now });
          toastState.add('success', 'Credential moved to trash');
        } catch {
          const curIdx = items.findIndex((i) => i.id === id);
          if (curIdx !== -1) items[curIdx] = original;
          toastState.add('error', 'Failed to move credential to trash');
        }
      } catch {
        toastState.add('error', 'Failed to move credential to trash');
      }
    },

    async restoreFromTrash(id: string) {
      try {
        if (!id) return;
        const index = items.findIndex((i) => i.id === id);
        if (index === -1) return;
        const original = items[index];
        const now = Date.now();
        items[index] = { ...original, deletedAt: null, updatedAt: now };
        try {
          await vaultRepo.update(id, { deletedAt: null, updatedAt: now });
          toastState.add('success', 'Credential restored');
        } catch {
          const curIdx = items.findIndex((i) => i.id === id);
          if (curIdx !== -1) items[curIdx] = original;
          toastState.add('error', 'Failed to restore credential');
        }
      } catch {
        toastState.add('error', 'Failed to restore credential');
      }
    },

    async bulkMoveToTrash(ids: string[]) {
      try {
        if (!ids || ids.length === 0) return;
        const prev = [...items];
        const now = Date.now();
        const idSet = new Set(ids);
        items = items.map((i) => (idSet.has(i.id) ? { ...i, deletedAt: now, updatedAt: now } : i));
        try {
          await vaultRepo.updateMany(ids, { deletedAt: now, updatedAt: now });
          toastState.add('success', `${ids.length} credential(s) moved to trash`);
        } catch {
          items = prev;
          toastState.add('error', 'Failed to move credentials to trash');
        }
      } catch {
        toastState.add('error', 'Failed to move credentials to trash');
      }
    },

    async bulkRestoreFromTrash(ids: string[]) {
      try {
        if (!ids || ids.length === 0) return;
        const prev = [...items];
        const now = Date.now();
        const idSet = new Set(ids);
        items = items.map((i) => (idSet.has(i.id) ? { ...i, deletedAt: null, updatedAt: now } : i));
        try {
          await vaultRepo.updateMany(ids, { deletedAt: null, updatedAt: now });
          toastState.add('success', `${ids.length} credential(s) restored`);
        } catch {
          items = prev;
          toastState.add('error', 'Failed to restore credentials');
        }
      } catch {
        toastState.add('error', 'Failed to restore credentials');
      }
    },

    async deleteItem(id: string) {
      if (!id) return;
      await this.deleteMany([id]);
    },

    async deleteMany(ids: string[]) {
      try {
        if (!ids || ids.length === 0) return;
        const idSet = new Set(ids);
        const prev = [...items];
        items = items.filter((i) => !idSet.has(i.id));
        try {
          await vaultRepo.deleteMany(ids);
          purgeDecryptedIds(idSet);
          toastState.add('success', `${ids.length} credential(s) permanently deleted`);
        } catch {
          items = prev;
          toastState.add('error', 'Failed to delete credentials');
        }
      } catch {
        toastState.add('error', 'Failed to delete credentials');
      }
    },

    async cleanupAuto(retentionDays: number) {
      try {
        const days = Number(retentionDays);
        if (!Number.isFinite(days) || days <= 0) return;
        const threshold = Date.now() - days * DAY_MS;

        const idsToDelete: string[] = [];
        for (let i = 0, len = items.length; i < len; i++) {
          const item = items[i];
          if (item.deletedAt != null && item.deletedAt < threshold) {
            idsToDelete.push(item.id);
          }
        }

        if (idsToDelete.length > 0) {
          const idSet = new Set(idsToDelete);
          try {
            await vaultRepo.deleteMany(idsToDelete);
            items = items.filter((i) => !idSet.has(i.id));
            purgeDecryptedIds(idSet);
          } catch {}
        }
      } catch {}
    },

    async addGroup(group: VaultGroup) {
      if (!group || !group.id) return;
      const cleanName = group.name?.trim().toLowerCase();
      if (cleanName && vaultGroups.some((g) => g.id !== group.id && g.name.trim().toLowerCase() === cleanName)) {
        toastState.add('error', 'Group name already exists. Please choose a different name.');
        return;
      }
      const prev = [...vaultGroups];
      try {
        vaultGroups = [...vaultGroups, group];
        await vaultGroupRepo.create(group);
        toastState.add('success', 'Group created');
      } catch {
        vaultGroups = prev;
        toastState.add('error', 'Failed to create group');
      }
    },

    async updateGroup(id: string, data: Partial<VaultGroup>) {
      if (!id || !data) return;
      if (data.name) {
        const cleanName = data.name.trim().toLowerCase();
        if (vaultGroups.some((g) => g.id !== id && g.name.trim().toLowerCase() === cleanName)) {
          toastState.add('error', 'Group name already exists. Please choose a different name.');
          return;
        }
      }
      const idx = vaultGroups.findIndex((g) => g.id === id);
      if (idx === -1) return;
      const prev = vaultGroups[idx];
      const payload: Partial<VaultGroup> = { ...data, updatedAt: Date.now() };
      vaultGroups[idx] = { ...prev, ...payload };
      try {
        await vaultGroupRepo.update(id, payload);
        toastState.add('success', 'Group updated');
      } catch {
        const curIdx = vaultGroups.findIndex((g) => g.id === id);
        if (curIdx !== -1) vaultGroups[curIdx] = prev;
        toastState.add('error', 'Failed to update group');
      }
    },

    async deleteGroup(id: string) {
      if (!id) return;
      const prevGroups = [...vaultGroups];
      const prevItems = [...items];

      const deletedGroupIds = new Set<string>([id]);
      let foundMore = true;
      while (foundMore) {
        foundMore = false;
        for (const g of vaultGroups) {
          if (g.parentId && deletedGroupIds.has(g.parentId) && !deletedGroupIds.has(g.id)) {
            deletedGroupIds.add(g.id);
            foundMore = true;
          }
        }
      }

      vaultGroups = vaultGroups.filter((g) => !deletedGroupIds.has(g.id));
      items = items.map((i) => (i.groupId && deletedGroupIds.has(i.groupId) ? { ...i, groupId: null } : i));

      try {
        await vaultGroupRepo.delete(id);
        for (const gid of deletedGroupIds) {
          pruneGroupOrder('personal_os_vault_group_order', gid);
          pruneGroupOrder('personal_os_vault_expanded_parents', gid);
        }
        toastState.add('success', 'Group and dependent subgroups deleted');
      } catch {
        vaultGroups = prevGroups;
        items = prevItems;
        toastState.add('error', 'Failed to delete group');
      }
    },
  };
}

export const vaultStore = createVaultStore();

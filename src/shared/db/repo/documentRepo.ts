import { eq, inArray, and, or, like, isNotNull, lt } from 'drizzle-orm';
import { db } from '../client';
import { documents, documentFolders } from '../schema';

const BATCH_CHUNK_SIZE = 500;

function extractUniqueStrings(items: string[]): string[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item === 'string' && item.length > 0) {
      seen.add(item);
    }
  }
  return Array.from(seen);
}

export const documentRepo = {
  async deleteFolder(path: string): Promise<void> {
    if (typeof path !== 'string' || path.length === 0) return;
    const cleanPath = path.replace(/\\/g, '/').replace(/\/+$/, '');
    await db.delete(documentFolders).where(
      or(
        eq(documentFolders.id, cleanPath),
        like(documentFolders.id, `${cleanPath}/%`),
        eq(documentFolders.parentId, cleanPath),
        like(documentFolders.parentId, `${cleanPath}/%`)
      )
    );
    await db.delete(documents).where(
      or(
        eq(documents.folderId, cleanPath),
        like(documents.folderId, `${cleanPath}/%`)
      )
    );
  },

  async deleteDoc(id: string): Promise<void> {
    if (typeof id !== 'string' || id.length === 0) return;
    await db.delete(documents).where(eq(documents.id, id));
  },

  async deleteManyDocs(ids: string[]): Promise<void> {
    const uniqueIds = extractUniqueStrings(ids);
    if (uniqueIds.length === 0) return;
    if (uniqueIds.length === 1) {
      await db.delete(documents).where(eq(documents.id, uniqueIds[0]));
      return;
    }
    for (let i = 0; i < uniqueIds.length; i += BATCH_CHUNK_SIZE) {
      const chunk = uniqueIds.slice(i, i + BATCH_CHUNK_SIZE);
      await db.delete(documents).where(inArray(documents.id, chunk));
    }
  },

  async deleteManyFolders(paths: string[]): Promise<void> {
    const uniquePaths = extractUniqueStrings(paths);
    if (uniquePaths.length === 0) return;
    for (const p of uniquePaths) {
      await this.deleteFolder(p);
    }
  },

  async cleanupAuto(retentionMs: number): Promise<void> {
    const safeRetentionMs = Number(retentionMs);
    if (!Number.isFinite(safeRetentionMs) || safeRetentionMs <= 0) return;
    const threshold = Date.now() - safeRetentionMs;
    await db
      .delete(documents)
      .where(and(isNotNull(documents.deletedAt), lt(documents.deletedAt, threshold)));
    await db
      .delete(documentFolders)
      .where(and(isNotNull(documentFolders.deletedAt), lt(documentFolders.deletedAt, threshold)));
  }
};

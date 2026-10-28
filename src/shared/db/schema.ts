import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const taskGroups = sqliteTable('task_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('gray'),
  parentId: text('parent_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type TaskGroup = typeof taskGroups.$inferSelect;
export type InsertTaskGroup = typeof taskGroups.$inferInsert;

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull(),
  dueDate: integer('due_date'),
  groupId: text('group_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

export const eventGroups = sqliteTable('event_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('gray'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type EventGroup = typeof eventGroups.$inferSelect;
export type InsertEventGroup = typeof eventGroups.$inferInsert;

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  startTime: text('start_time'),
  endTime: text('end_time'),
  isAllDay: integer('is_all_day', { mode: 'boolean' }).notNull().default(false),
  recurrence: text('recurrence').default('NONE'),
  source: text('source').default('LOCAL').notNull(),
  externalId: text('external_id'),
  groupId: text('group_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type Event = typeof events.$inferSelect;
export type InsertEvent = typeof events.$inferInsert;

export const vaultGroups = sqliteTable('vault_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export type VaultGroup = typeof vaultGroups.$inferSelect;
export type InsertVaultGroup = typeof vaultGroups.$inferInsert;

export const vault = sqliteTable('vault', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  encryptedData: text('encrypted_data').notNull(),
  groupId: text('group_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export type VaultItem = typeof vault.$inferSelect;
export type InsertVaultItem = typeof vault.$inferInsert;

export const documentFolders = sqliteTable('document_folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export type DocumentFolder = typeof documentFolders.$inferSelect;
export type InsertDocumentFolder = typeof documentFolders.$inferInsert;

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  folderId: text('folder_id'),
  size: integer('size').notNull(),
  mimeType: text('mime_type').notNull(),
  storageProvider: text('storage_provider').default('LOCAL').notNull(),
  remotePath: text('remote_path'),
  localPath: text('local_path'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
});

export type DocumentItem = typeof documents.$inferSelect;
export type InsertDocumentItem = typeof documents.$inferInsert;

export const uiPreferences = sqliteTable('ui_preferences', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type UiPreference = typeof uiPreferences.$inferSelect;
export type InsertUiPreference = typeof uiPreferences.$inferInsert;

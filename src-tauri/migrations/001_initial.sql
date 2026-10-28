CREATE TABLE IF NOT EXISTS `task_groups` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `color` TEXT DEFAULT 'gray',
  `parent_id` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `title` TEXT NOT NULL,
  `description` TEXT,
  `status` TEXT NOT NULL,
  `due_date` INTEGER,
  `group_id` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `deleted_at` INTEGER
);

CREATE TABLE IF NOT EXISTS `event_groups` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `color` TEXT DEFAULT 'gray',
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `title` TEXT NOT NULL,
  `description` TEXT,
  `start_time` TEXT,
  `end_time` TEXT,
  `is_all_day` INTEGER NOT NULL DEFAULT 0,
  `recurrence` TEXT NOT NULL DEFAULT 'NONE',
  `source` TEXT NOT NULL DEFAULT 'LOCAL',
  `external_id` TEXT,
  `group_id` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS `note_groups` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `parent_id` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `deleted_at` INTEGER
);

CREATE TABLE IF NOT EXISTS `notes` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `title` TEXT NOT NULL,
  `content` TEXT,
  `group_id` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `deleted_at` INTEGER
);

CREATE TABLE IF NOT EXISTS `vault_groups` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `parent_id` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `deleted_at` INTEGER
);

CREATE TABLE IF NOT EXISTS `vault` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `encrypted_data` TEXT NOT NULL,
  `group_id` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `deleted_at` INTEGER
);

CREATE TABLE IF NOT EXISTS `document_folders` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `parent_id` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `deleted_at` INTEGER
);

CREATE TABLE IF NOT EXISTS `documents` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `name` TEXT NOT NULL,
  `folder_id` TEXT,
  `size` INTEGER NOT NULL,
  `mime_type` TEXT NOT NULL,
  `storage_provider` TEXT DEFAULT 'LOCAL' NOT NULL,
  `remote_path` TEXT,
  `local_path` TEXT,
  `created_at` INTEGER NOT NULL,
  `updated_at` INTEGER NOT NULL,
  `deleted_at` INTEGER
);

CREATE TABLE IF NOT EXISTS `ui_preferences` (
  `key` TEXT PRIMARY KEY NOT NULL,
  `value` TEXT NOT NULL,
  `updated_at` INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS `notes_fts` USING fts5(id UNINDEXED, title, content);

CREATE TRIGGER IF NOT EXISTS `notes_fts_insert` AFTER INSERT ON `notes` BEGIN
  INSERT INTO `notes_fts`(`id`, `title`, `content`) VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS `notes_fts_delete` AFTER DELETE ON `notes` BEGIN
  DELETE FROM `notes_fts` WHERE `id` = old.id;
END;

CREATE TRIGGER IF NOT EXISTS `notes_fts_update` AFTER UPDATE ON `notes` BEGIN
  UPDATE `notes_fts` SET `title` = new.title, `content` = new.content WHERE `id` = old.id;
END;

CREATE INDEX IF NOT EXISTS `idx_task_groups_parent` ON `task_groups`(`parent_id`);
CREATE INDEX IF NOT EXISTS `idx_tasks_status_deleted` ON `tasks`(`status`, `deleted_at`);
CREATE INDEX IF NOT EXISTS `idx_tasks_group_id` ON `tasks`(`group_id`);
CREATE INDEX IF NOT EXISTS `idx_events_start_time` ON `events`(`start_time`);
CREATE INDEX IF NOT EXISTS `idx_events_source` ON `events`(`source`);
CREATE INDEX IF NOT EXISTS `idx_events_group_id` ON `events`(`group_id`);
CREATE INDEX IF NOT EXISTS `idx_note_groups_parent` ON `note_groups`(`parent_id`);
CREATE INDEX IF NOT EXISTS `idx_notes_deleted_updated` ON `notes`(`deleted_at`, `updated_at`);
CREATE INDEX IF NOT EXISTS `idx_notes_group_id` ON `notes`(`group_id`);
CREATE INDEX IF NOT EXISTS `idx_vault_groups_parent` ON `vault_groups`(`parent_id`);
CREATE INDEX IF NOT EXISTS `idx_vault_deleted_updated` ON `vault`(`deleted_at`, `updated_at`);
CREATE INDEX IF NOT EXISTS `idx_vault_group_id` ON `vault`(`group_id`);
CREATE INDEX IF NOT EXISTS `idx_documents_folder_deleted` ON `documents`(`folder_id`, `deleted_at`);
CREATE INDEX IF NOT EXISTS `idx_document_folders_parent_deleted` ON `document_folders`(`parent_id`, `deleted_at`);

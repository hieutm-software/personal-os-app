# Data Flow & Database Schema

## 1. SQLite Schema (`src/shared/db/schema.ts`)

Personal OS persists structured records in a local SQLite database (`personal-os-v2.db`) using `WAL` mode, while physical files and Markdown documents live directly on the local filesystem (`~/Documents/PersonalOS/docs/`).

### `tasks` & `task_groups`
- **`task_groups`**: `id`, `name`, `parentId`, `createdAt`, `updatedAt`, `deletedAt`
- **`tasks`**: `id`, `title`, `description` (Markdown note content), `status` (`'PENDING'` | `'IN_PROGRESS'` | `'COMPLETED'`), `priority`, `groupId`, `dueDate`, `createdAt`, `updatedAt`, `deletedAt`

### `events` & `event_groups`
- **`event_groups`**: `id`, `name`, `color`, `createdAt`, `updatedAt`, `deletedAt`
- **`events`**: `id`, `title`, `description`, `startTime`, `endTime`, `isAllDay`, `recurrence`, `source` (`'LOCAL'` or `'GOOGLE::<ical_url>'`), `externalId`, `groupId`, `createdAt`, `updatedAt`

### `documents` & `document_folders`
- **`document_folders`**: `id` (normalized relative path `docs/...`), `name`, `parentId`, `createdAt`, `updatedAt`, `deletedAt`
- **`documents`**: `id` (normalized relative path `docs/...`), `name`, `folderId`, `size`, `mimeType`, `storageProvider` (`'LOCAL'`), `localPath`, `createdAt`, `updatedAt`, `deletedAt`

### `vault` & `vault_groups`
- **`vault_groups`**: `id`, `name`, `parentId`, `createdAt`, `updatedAt`, `deletedAt`
- **`vault`**: `id`, `name`, `username`, `encryptedData` (Base64 `salt + iv + ciphertext`), `groupId`, `createdAt`, `updatedAt`, `deletedAt`

### `ui_preferences`
- **`ui_preferences`**: `key`, `value` (JSON/string), `updatedAt` — persists cross-session preferences such as Google Calendar iCal URLs, group ordering, and UI state.

---

## 2. Cross-Platform Backup & Restore Flow (Windows ↔ Linux)

### Export (`exportBackupData`)
1. Scans active SQLite tables (`tasks`, `task_groups`, `events`, `event_groups`, `vault`, `vault_groups`, `ui_preferences`) excluding soft-deleted records (`deletedAt IS NULL`).
2. Invokes `scan_document_tree` on the physical `docs/` directory to synchronize all active folders (including empty directories) and files into `manifest.json` with normalized forward-slash (`/`) relative paths.
3. Packages `manifest.json`, a sanitized SQLite snapshot (`VACUUM INTO`), `.vault_key`, and physical `docs/` files into either a standard `.zip` archive or an `Argon2id` + `AES-256-GCM` encrypted `.posbackup` file.

### Import & Conflict Resolution (`analyzeBackup` & `executeRestoreWithResolutions`)
1. Decrypts (if `.posbackup`) and inspects `manifest.json` in a temporary directory guarded by RAII (`TempFileGuard`).
2. Compares incoming records against local SQLite tables and the live local `docs/` directory tree (`scan_document_tree`).
3. If modified items collide, presents `BackupConflictModal` allowing per-item or bulk resolution (`Overwrite with Backup` vs `Keep Local`).
4. Restores groups and folders topologically (`sortTopologically`), extracts physical files while respecting skipped local files and cross-platform path validation (`isPlatformPathValid`), and seamlessly re-encrypts Vault items if keys differ.

# IPC Commands & Repository Reference

## 1. Tauri IPC Commands (`src-tauri/src/commands/`)

| Command | Module | Description |
| :--- | :--- | :--- |
| `pick_folder` | `dialog_cmd.rs` | Opens native OS folder selection dialog |
| `get_default_document_dir` | `dialog_cmd.rs` | Resolves default `~/Documents/PersonalOS` directory |
| `watch_directory` | `file_cmd.rs` | Starts recursive filesystem watcher and emits `fs-changed` |
| `scan_document_tree` | `file_cmd.rs` | Recursively scans `docs/` or `docs/.trash` directory tree |
| `list_directory_files` | `file_cmd.rs` | Lists files and subdirectories for a target relative path |
| `create_folder` | `file_cmd.rs` | Creates a directory inside the documents workspace |
| `create_new_file` | `file_cmd.rs` | Creates a new file with optional initial text content |
| `upload_file` | `file_cmd.rs` | Writes binary byte array to target path (100 MB max) |
| `upload_file_from_path` | `file_cmd.rs` | Copies a local OS file into the documents workspace |
| `read_file` | `file_cmd.rs` | Reads file bytes via zero-copy `tauri::ipc::Response` (100 MB max) |
| `move_file` | `file_cmd.rs` | Renames or moves a file/folder within the workspace |
| `soft_delete_file` | `file_cmd.rs` | Moves file/folder to `docs/.trash` and records `.trash_metadata.json` |
| `restore_file` | `file_cmd.rs` | Restores item from `docs/.trash` to its original relative path |
| `delete_file` | `file_cmd.rs` | Moves item to the native OS Recycle Bin / Trash |
| `empty_documents_trash` | `file_cmd.rs` | Empties `docs/.trash` into the OS Recycle Bin / Trash |
| `cleanup_documents_trash` | `file_cmd.rs` | Purges expired items in `docs/.trash` based on retention policy |
| `get_dragged_items_contents` | `file_cmd.rs` | Flattens dropped OS files and folders for batch upload |
| `open_in_os` | `file_cmd.rs` | Opens a file or folder in the native OS file manager / default app |
| `create_backup_zip` | `file_cmd.rs` | Packages sanitized DB snapshot + `docs/` into `.zip` or encrypted `.posbackup` |
| `inspect_backup_manifest` | `file_cmd.rs` | Reads and decrypts `manifest.json` from `.zip` or `.posbackup` archive |
| `extract_backup_zip_absolute` | `file_cmd.rs` | Extracts backup archive with conflict skip list and cross-OS path safety |
| `get_system_metrics` | `system_cmd.rs` | Returns real-time disk usage and network download/upload speeds |
| `authenticate_os` | `vault_cmd.rs` | Prompts native OS password/biometric authentication |
| `get_vault_key` / `save_vault_key` | `vault_cmd.rs` | Reads or persists the Vault encryption key via OS Keyring & config file |

---

## 2. Database Repositories (`src/shared/db/repo/`)

- **`taskRepo`** (`taskRepo.ts`): CRUD, group management, soft-delete, and auto-cleanup for `tasks` and `task_groups`.
- **`eventRepo`** (`eventRepo.ts`): CRUD, iCal batch sync, and group management for `events` and `event_groups`.
- **`documentRepo`** (`documentRepo.ts`): Folder/document metadata cleanup and batch deletion for `documents` and `document_folders`.
- **`vaultRepo`** (`vaultRepo.ts`): CRUD, group management, and soft-delete for encrypted `vault` and `vault_groups`.
- **`uiPreferenceRepo`** (`uiPreferenceRepo.ts`): Key-value persistence in `ui_preferences`.

---

## 3. Global Reactive Stores (`src/shared/`)

- **`taskStore.svelte.ts`**: Reactive task & task group state, optimistic updates, and retention cleanup.
- **`eventStore.svelte.ts`**: Calendar events, event groups, and Google Calendar iCal sync state.
- **`vaultStore.svelte.ts`**: Ephemeral Master Key state, in-memory decrypted cache, and vault item management.
- **`healthStore.svelte.ts`**: Hydration, sedentary movement, and 20-20-20 eye-care timer states.
- **`shortcutStore.svelte.ts`**: Customizable global keyboard shortcuts with localStorage persistence.
- **`autoCleanupStore.svelte.ts`**: Configurable retention periods (3, 7, 14, 30 days) per module.
- **`theme.svelte.ts`**: System / Light / Dark theme synchronization.

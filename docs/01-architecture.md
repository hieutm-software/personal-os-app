# Architecture Overview

## Technology Stack

- **Desktop Core:** Tauri v2 (Rust Backend & Native OS IPC)
- **Frontend Framework:** Svelte 5 (Runes exclusively: `$state`, `$derived`, `$effect`)
- **Build & Bundling:** Vite SPA with manual vendor chunking (`tauri`, `db`, `icons`, `markdown`, `utils`) for fast cold boot
- **Styling:** Tailwind CSS v4 (Dark/Light GNOME-inspired flat aesthetic)
- **Database:** Embedded SQLite (`personal-os-v2.db`) with `WAL` journal mode + Drizzle ORM
- **Cryptography:** WebCrypto API (`PBKDF2-SHA256` + `AES-256-GCM`) & Rust `Argon2id` + `AES-256-GCM` (`backup_crypto_service`)

---

## Application Model

Personal OS is architected as a local-first Single Page Application (SPA) with state-driven module switching (`globalState.currentModule`), eliminating page-reload latency across all modules (`Dashboard`, `Tasks`, `Calendar`, `Documents`, `Vault`, `Settings`, and `UserGuide`).

---

## Directory Structure (Feature-Sliced Design)

```text
src/
├── app/
│   ├── App.svelte                 # Root layout, global shortcuts, background notification & health pollers
│   └── app.css                    # Tailwind CSS v4 theme tokens & typography
├── features/                      # Domain-isolated modules
│   ├── dashboard/                 # Weather widget, system metrics, task/event overview, countdowns
│   ├── tasks/                     # List & Kanban views, nested groups, TaskNoteModal (Markdown editor)
│   ├── calendar/                  # Monthly/weekly calendar, multi-day events, iCal synchronization
│   ├── documents/                 # Local filesystem hub, tree navigation, DocumentEditorModal, trash
│   ├── vault/                     # Zero-knowledge AES-256-GCM credential manager
│   ├── health/                    # WaterModal, SedentaryModal, and 20-20-20 EyeCareModal overlays
│   ├── settings/                  # Appearance, shortcuts, auto-cleanup, and Backup/Restore modals
│   └── guide/                     # Bilingual (VI/EN) interactive UserGuide
└── shared/                        # Shared UI primitives, database layer, and reactive stores
    ├── ui/                        # Reusable components (Modal, Table, DatePicker, CommandPalette, etc.)
    ├── db/                        # Drizzle ORM client (`client.ts`), schema (`schema.ts`), and repos
    └── *.svelte.ts                # Reactive stores (taskStore, eventStore, vaultStore, healthStore, shortcutStore, autoCleanupStore)
```

```text
src-tauri/src/
├── main.rs                        # Tauri binary entry point
├── lib.rs                         # Plugin registration, single-instance lock, system tray, IPC handlers
├── core/
│   ├── constants.rs               # DB_NAME ("personal-os-v2.db"), MAX_FILE_SIZE (100MB), keyring constants
│   ├── state.rs                   # AppState & SQLite WAL initialization
│   ├── db_jobs.rs                 # Background WAL checkpointing & periodic maintenance
│   └── error.rs                   # Unified AppError serialization for IPC
├── commands/                      # Exposed #[tauri::command] handlers
│   ├── dialog_cmd.rs              # Native folder picker & default document directory resolution
│   ├── file_cmd.rs                # Filesystem CRUD, tree scanner, two-tier trash, ZIP/.posbackup archive engine
│   ├── system_cmd.rs              # Real-time disk usage & network throughput telemetry (`sysinfo`)
│   └── vault_cmd.rs               # OS authentication, vault master key storage, SQLite snapshot sanitization
└── services/
    ├── fs_service.rs              # Cross-platform (Windows/Linux) path validation & traversal protection
    ├── os_auth_service.rs         # Native OS password verification (Windows CredUI / Linux pkexec / macOS osascript)
    └── backup_crypto_service.rs   # Argon2id key derivation & AES-256-GCM `.posbackup` encryption
```

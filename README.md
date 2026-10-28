<div align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="Personal OS Logo" width="88" height="88" />
  <h1>Personal OS</h1>
  <p><strong>Local-First, Zero-Knowledge Desktop Productivity Suite</strong></p>

  <p>
    <a href="https://github.com/hieutm-software/personal-os-app/raw/main/src-tauri/target/release/bundle/nsis/Personal%20OS_0.1.0_x64-setup.exe">
      <img src="https://img.shields.io/badge/Windows_(x64)-.exe_Installer-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Windows Installer (.exe)" />
    </a>
    <a href="https://github.com/hieutm-software/personal-os-app/raw/main/src-tauri/target/release/bundle/deb/Personal%20OS_0.1.0_amd64.deb">
      <img src="https://img.shields.io/badge/Ubuntu_%2F_Debian-.deb_Package-10b981?style=for-the-badge&logo=ubuntu&logoColor=white" alt="Linux Package (.deb)" />
    </a>
  </p>
  <sub>Click your OS button above to get the ready-to-run installer directly.</sub>
</div>

---

## 🧩 Core Modules

- 🖥️ **Dashboard** — Real-time weather, system telemetry, daily task progress, upcoming schedule, and countdown timers.
- 🎯 **Tasks** — Priority Kanban & List views, due-date alerts, and Markdown notes (`Write` / `Split` / `Preview` with sync scroll & 1-click copy).
- 🗓️ **Calendar** — Monthly/weekly planner, multi-day events, Google Calendar iCal sync, and 30-minute advance reminders.
- 🗂️ **Documents** — Local directory tree, multi-tab Markdown editor, media preview (PDF/Image/Audio/Video), and two-tier Trash.
- 🛡️ **Vault** — Zero-knowledge `AES-256-GCM` credential manager protected by native OS authentication.
- 🌿 **Wellness & Backup** — Hydration, posture, and 20-20-20 eye-care reminders + cross-platform `.posbackup` encrypted snapshots.

## ⚙️ Tech Stack

`Tauri v2 (Rust)` · `Svelte 5 (Runes)` · `Tailwind CSS v4` · `SQLite (WAL) + Drizzle ORM` · `WebCrypto & Argon2id`

## 📘 Documentation

[`Architecture`](./docs/01-architecture.md) · [`Data Flow`](./docs/02-data-flow.md) · [`Security`](./docs/03-security.md) · [`UI/UX`](./docs/04-ui-ux.md) · [`IPC Reference`](./docs/05-ipc-and-repositories.md)

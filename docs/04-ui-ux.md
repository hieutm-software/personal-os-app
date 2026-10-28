# UI/UX & Interaction Design

## 1. Svelte 5 Runes & Reactive Architecture

- **State-Driven Navigation:** `App.svelte` switches active modules via `globalState.currentModule` without page reloads.
- **Fine-Grained Reactivity:** All components and stores use Svelte 5 Runes (`$state`, `$derived`, `$derived.by`, `$effect`) with deterministic cleanup callbacks for timers, event listeners, and Tauri `UnlistenFn` handles.
- **Optimistic UI Updates:** Task, Calendar, and Vault mutations update local `$state` immediately for zero-latency feedback and roll back automatically if an underlying operation fails.

---

## 2. Markdown Editor (`DocumentEditorModal` & `TaskNoteModal`)

- **Three Editing Modes:** `Write`, `Split` (side-by-side editor and live preview), and `Preview` (GitHub-flavored Markdown with syntax highlighting).
- **Proportional Synchronized Scrolling:** Bi-directional scroll synchronization (`Sync Scroll` / `Independent` toggle) keeps the Markdown source and rendered preview aligned at the exact relative position across all 3 modes.
- **Quick Copy Actions:** Floating 1-click Copy button in the top-right corner of the editor and preview panes, plus individual copy buttons on fenced code blocks.

---

## 3. Directory Tree & Drag-and-Drop UX

- **Unified Sidebar Tree:** `Tasks`, `Calendar`, `Documents`, and `Vault` share a consistent resizable sidebar with collapsible nested groups/folders, item count badges, and smooth pointer/drag reordering.
- **Multi-Tab Documents Workspace:** Open multiple documents simultaneously in tabs, drag-and-drop files or entire folders from the OS file manager, and preview PDFs, images, audio, and video inline.
- **Two-Tier Trash Safety:** Deleting a document moves it to the in-app `.trash` folder first (preserving `original_path` metadata for 1-click restore); permanent deletion moves it to the OS Recycle Bin / Trash.

---

## 4. Global Shortcuts & Health Care Overlays

- **Customizable Shortcuts (`ShortcutModal`):** Global hotkeys for Command Palette (`Ctrl + K`), New Task (`Ctrl + T`), New Markdown File (`Ctrl + N`), and New Event (`Ctrl + E`) with conflict detection.
- **Health Care Reminders:** Non-intrusive background timers for Hydration (`WaterModal`), Movement (`SedentaryModal`), and 20-20-20 Eye Care (`EyeCareModal`) with audio notifications and automatic window focus.

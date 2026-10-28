# Security & Zero-Knowledge Architecture

## 1. Zero-Knowledge Vault Encryption (E2EE)

The `Vault` module encrypts all sensitive credentials in frontend memory before any data reaches SQLite:
- **Key Derivation:** Derives a 256-bit key using WebCrypto **PBKDF2-SHA256** (600,000 iterations) with a random 16-byte salt.
- **Authenticated Encryption:** Encrypts secret payloads using **AES-256-GCM** with a random 12-byte IV.
- **Storage Format:** Only the Base64-encoded `salt + iv + ciphertext` is stored in SQLite (`vault.encryptedData`).

---

## 2. Encrypted System Backups (`.posbackup`)

Full-system backups can be password-protected using `backup_crypto_service.rs`:
- **Binary Container (`POSB`):** Uses a 34-byte header (`"POSB"` magic bytes + version + KDF ID + 16-byte salt + 12-byte nonce).
- **Key Derivation:** **Argon2id** (`v0x13`, 32 MB memory cost, 3 iterations, 32-byte output key).
- **AEAD Cipher:** **AES-256-GCM** authenticated encryption; any tampering or wrong password immediately fails authentication with `INVALID_BACKUP_PASSWORD`.
- **Deterministic Temp Cleanup:** Temporary ZIP buffers created during encryption/decryption are wrapped in `TempFileGuard` (`Drop` trait) so plaintext temporary files are automatically removed.

---

## 3. Native OS Authentication (`os_auth_service.rs`)

Accessing the Vault or sensitive operations requires native OS user verification:
- **Windows:** Uses Win32 `CredUIPromptForWindowsCredentialsW` + `LogonUserW` with immediate zeroization (`ptr::write_bytes` / `.fill(0)`) of credential buffers before freeing memory.
- **Linux:** Uses PolicyKit (`pkexec`).
- **macOS:** Uses `osascript` with sanitized prompt strings.

---

## 4. Path Traversal & IPC Hardening

- **Path Sanitization (`fs_service.rs`):** Every relative path passed to Tauri file commands is sanitized via `sanitize_relative_path_str`, rejecting `..` segments, null bytes, control characters, and verifying `full_path.starts_with(&canonical_base)`.
- **Cross-Platform Path Isolation:** `is_valid_platform_path` and `is_usable_platform_dir` prevent Windows paths (`C:\...`) from being created on Linux and vice versa during cross-OS backup restores.
- **Payload Size Bound:** File reads and uploads enforce `MAX_FILE_SIZE = 100 MB`.
- **Strict Content Security Policy (CSP):** Configured in `src-tauri/tauri.conf.json`, restricting `connect-src` strictly to `self`, `https://api.open-meteo.com`, and `https://calendar.google.com`, and sanitizing all rendered Markdown HTML via `DOMPurify`.

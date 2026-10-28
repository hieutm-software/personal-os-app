use crate::core::constants::MAX_FILE_SIZE;
use crate::core::error::AppError;
use crate::services::fs_service;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct WatcherState {
    pub watchers: Mutex<std::collections::HashMap<std::path::PathBuf, RecommendedWatcher>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self::new()
    }
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(std::collections::HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn watch_directory(
    app: AppHandle,
    watcher_state: State<'_, WatcherState>,
    _provider: Option<String>,
    target_path: String,
    base_path: Option<String>,
) -> Result<(), AppError> {
    let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;

    if !path.exists() {
        fs::create_dir_all(&path)?;
    }

    if let Ok(guard) = watcher_state.watchers.lock() {
        if guard.contains_key(&path) {
            return Ok(());
        }
    }

    let app_clone = app.clone();

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if !matches!(event.kind, notify::EventKind::Access(_)) {
                let _ = app_clone.emit("fs-changed", ());
            }
        }
    })
    .map_err(|e| AppError::Unknown(e.to_string()))?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Unknown(e.to_string()))?;

    if let Ok(mut guard) = watcher_state.watchers.lock() {
        guard.insert(path, watcher);
    }

    Ok(())
}

#[tauri::command]
pub async fn upload_file_from_path(
    app: AppHandle,
    _provider: Option<String>,
    target_path: String,
    source_path: String,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let dest = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&source_path, &dest)?;
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn upload_file(
    app: AppHandle,
    _provider: Option<String>,
    target_path: String,
    file_data: Vec<u8>,
    base_path: Option<String>,
) -> Result<(), AppError> {
    if file_data.len() as u64 > MAX_FILE_SIZE {
        return Err(AppError::Unknown(
            "File size exceeds maximum upload limit of 100MB".to_string(),
        ));
    }

    tokio::task::spawn_blocking(move || {
        let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = fs::File::create(path)?;
        file.write_all(&file_data)?;
        file.flush()?;
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn read_file(
    app: AppHandle,
    _provider: Option<String>,
    target_path: String,
    base_path: Option<String>,
) -> Result<tauri::ipc::Response, AppError> {
    let buffer = tokio::task::spawn_blocking(move || {
        let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        let meta = fs::metadata(&path)?;
        if meta.len() > MAX_FILE_SIZE {
            return Err(AppError::Unknown(
                "File size exceeds maximum read limit of 100MB".to_string(),
            ));
        }
        Ok(fs::read(path)?)
    })
    .await??;

    Ok(tauri::ipc::Response::new(buffer))
}

#[derive(Serialize)]
pub struct DirectoryFile {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
}

pub const TRASH_METADATA_FILE: &str = ".trash_metadata.json";

struct TempFileGuard(std::path::PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if self.0.exists() {
            let _ = std::fs::remove_file(&self.0);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashMetadataEntry {
    pub original_path: String,
    pub original_name: String,
    pub deleted_at: u64,
    pub is_dir: bool,
}

pub type TrashMetadataMap = std::collections::HashMap<String, TrashMetadataEntry>;

pub fn load_trash_metadata(trash_dir: &std::path::Path) -> TrashMetadataMap {
    let meta_path = trash_dir.join(TRASH_METADATA_FILE);
    if meta_path.exists() {
        if let Ok(bytes) = fs::read(&meta_path) {
            if let Ok(map) = serde_json::from_slice::<TrashMetadataMap>(&bytes) {
                return map;
            }
        }
    }
    std::collections::HashMap::new()
}

pub fn save_trash_metadata(trash_dir: &std::path::Path, map: &TrashMetadataMap) -> Result<(), AppError> {
    if !trash_dir.exists() {
        let _ = fs::create_dir_all(trash_dir);
    }
    let meta_path = trash_dir.join(TRASH_METADATA_FILE);
    let bytes = serde_json::to_vec_pretty(map).map_err(|e| AppError::Unknown(e.to_string()))?;
    fs::write(&meta_path, bytes).map_err(|e| AppError::Unknown(e.to_string()))?;
    Ok(())
}

pub fn find_unique_trash_name(trash_dir: &std::path::Path, item_name: &str, is_dir: bool) -> String {
    if !trash_dir.join(item_name).exists() {
        return item_name.to_string();
    }
    if is_dir {
        let mut counter = 1;
        loop {
            let candidate = format!("{} ({})", item_name, counter);
            if !trash_dir.join(&candidate).exists() {
                return candidate;
            }
            counter += 1;
        }
    } else {
        let path = std::path::Path::new(item_name);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(item_name);
        let ext = path.extension().and_then(|e| e.to_str());
        let mut counter = 1;
        loop {
            let candidate = match ext {
                Some(e) if !e.is_empty() => format!("{} ({}).{}", stem, counter, e),
                _ => format!("{} ({})", stem, counter),
            };
            if !trash_dir.join(&candidate).exists() {
                return candidate;
            }
            counter += 1;
        }
    }
}

fn calculate_dir_size(path: &std::path::Path) -> u64 {
    let mut total: u64 = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += calculate_dir_size(&entry_path);
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

pub fn is_dir_empty_or_junk(dir: &std::path::Path) -> bool {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".keep" {
                return false;
            }
            if name != "Thumbs.db" && name != "desktop.ini" && name != ".DS_Store" {
                return false;
            }
        }
        true
    } else {
        false
    }
}

pub fn cleanup_empty_dirs_in(dir: &std::path::Path) {
    if !dir.exists() || !dir.is_dir() {
        return;
    }
    for entry in walkdir::WalkDir::new(dir)
        .min_depth(1)
        .contents_first(true)
        .into_iter()
        .flatten()
    {
        let p = entry.path();
        if p.is_dir() {
            let name = entry.file_name().to_string_lossy();
            if name == ".trash" {
                continue;
            }
            if is_dir_empty_or_junk(p) {
                if let Ok(entries) = std::fs::read_dir(p) {
                    for junk in entries.flatten() {
                        let _ = std::fs::remove_file(junk.path());
                    }
                }
                let _ = std::fs::remove_dir(p);
            }
        }
    }
}

fn merge_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), std::io::Error> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let entry_path = entry.path();
        let dest_child = dst.join(entry.file_name());
        if entry_path.is_dir() {
            merge_dir_recursive(&entry_path, &dest_child)?;
        } else {
            if dest_child.exists() {
                let _ = fs::remove_file(&dest_child);
            }
            if let Some(parent) = dest_child.parent() {
                let _ = fs::create_dir_all(parent);
            }
            fs::rename(&entry_path, &dest_child)?;
        }
    }
    let _ = fs::remove_dir(src);
    Ok(())
}

#[tauri::command]
pub async fn list_directory_files(
    app: AppHandle,
    _provider: Option<String>,
    target_path: String,
    base_path: Option<String>,
) -> Result<Vec<DirectoryFile>, AppError> {
    tokio::task::spawn_blocking(move || {
        let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        let mut files = Vec::new();
        if path.exists() && path.is_dir() {
            let normalized_target = target_path.replace('\\', "/").trim_matches('/').to_string();
            let is_trash = normalized_target == "docs/.trash" || normalized_target.starts_with("docs/.trash/");
            let metadata_map: TrashMetadataMap = if is_trash {
                if let Ok(trash_dir) = fs_service::get_local_path(&app, "docs/.trash", base_path.as_deref()) {
                    load_trash_metadata(&trash_dir)
                } else {
                    std::collections::HashMap::new()
                }
            } else {
                std::collections::HashMap::new()
            };

            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let meta = entry.metadata()?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if name == ".keep"
                    || name == ".trash"
                    || name == ".DS_Store"
                    || name == "."
                    || name == ".."
                    || name == TRASH_METADATA_FILE
                {
                    continue;
                }
                let is_dir = meta.is_dir();
                let size = if is_dir {
                    calculate_dir_size(&entry.path())
                } else {
                    meta.len()
                };
                let modified = meta.modified().unwrap_or(std::time::SystemTime::now());
                let updated_at = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                let original_path = if is_trash {
                    metadata_map.get(&name).map(|m| m.original_path.clone())
                } else {
                    None
                };
                files.push(DirectoryFile {
                    name,
                    size,
                    is_dir,
                    updated_at,
                    original_path,
                });
            }
        }
        Ok(files)
    })
    .await?
}

#[tauri::command]
pub async fn delete_file(
    app: AppHandle,
    _provider: Option<String>,
    target_path: String,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        if path.exists() {
            let clean_path = fs_service::strip_verbatim_prefix(&path);
            trash::delete(&clean_path).map_err(|e| {
                AppError::Unknown(format!("Failed to move item to Windows Recycle Bin: {}", e))
            })?;
        }
        let normalized_target = target_path.replace('\\', "/").trim_matches('/').to_string();
        if normalized_target.starts_with("docs/.trash") {
            if let Ok(trash_dir) = fs_service::get_local_path(&app, "docs/.trash", base_path.as_deref()) {
                let rel_key = if normalized_target.starts_with("docs/.trash/") {
                    normalized_target.strip_prefix("docs/.trash/").unwrap_or(&normalized_target)
                } else {
                    normalized_target.trim_start_matches("docs/.trash")
                };
                if !rel_key.is_empty() {
                    let mut meta = load_trash_metadata(&trash_dir);
                    if meta.remove(rel_key).is_some() {
                        let _ = save_trash_metadata(&trash_dir, &meta);
                    }
                }
                cleanup_empty_dirs_in(&trash_dir);
            }
        }
        let _ = app.emit("fs-changed", ());
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn soft_delete_file(
    app: AppHandle,
    _provider: Option<String>,
    target_path: String,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        if !path.exists() {
            return Ok(());
        }

        let normalized_target = target_path.replace('\\', "/").trim_matches('/').to_string();
        if normalized_target.starts_with("docs/.trash") {
            return Ok(());
        }

        let is_dir = path.is_dir();
        let file_name = std::path::Path::new(&normalized_target)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("item")
            .to_string();

        let trash_dir = fs_service::get_local_path(&app, "docs/.trash", base_path.as_deref())?;
        if !trash_dir.exists() {
            fs::create_dir_all(&trash_dir)?;
        }

        let unique_name = find_unique_trash_name(&trash_dir, &file_name, is_dir);
        let trash_path = trash_dir.join(&unique_name);

        if is_dir {
            if trash_path.exists() || fs::rename(&path, &trash_path).is_err() {
                merge_dir_recursive(&path, &trash_path)?;
            }
        } else {
            if fs::rename(&path, &trash_path).is_err() {
                fs::copy(&path, &trash_path)?;
                let _ = fs::remove_file(&path);
            }
        }

        let now = filetime::FileTime::now();
        let _ = filetime::set_file_mtime(&trash_path, now);

        let now_millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let mut metadata_map = load_trash_metadata(&trash_dir);
        metadata_map.insert(
            unique_name,
            TrashMetadataEntry {
                original_path: normalized_target,
                original_name: file_name,
                deleted_at: now_millis,
                is_dir,
            },
        );
        let _ = save_trash_metadata(&trash_dir, &metadata_map);

        let _ = app.emit("fs-changed", ());
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn restore_file(
    app: AppHandle,
    _provider: Option<String>,
    trash_path: String,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let t_path = fs_service::get_local_path(&app, &trash_path, base_path.as_deref())?;
        if !t_path.exists() {
            return Err(AppError::Unknown("Item not found in trash".to_string()));
        }

        let trash_dir = fs_service::get_local_path(&app, "docs/.trash", base_path.as_deref())?;
        let normalized_trash = trash_path.replace('\\', "/").trim_matches('/').to_string();

        let rel_key = if normalized_trash.starts_with("docs/.trash/") {
            normalized_trash.strip_prefix("docs/.trash/").unwrap_or(&normalized_trash)
        } else if normalized_trash == "docs/.trash" {
            return Ok(());
        } else if normalized_trash.starts_with(".trash/") {
            normalized_trash.strip_prefix(".trash/").unwrap_or(&normalized_trash)
        } else {
            &normalized_trash
        };

        let mut metadata_map = load_trash_metadata(&trash_dir);

        if rel_key.contains('/') {
            let root_item = rel_key.split('/').next().unwrap_or("");
            if !root_item.is_empty() && metadata_map.contains_key(root_item) {
                return Err(AppError::Unknown(format!(
                    "Cannot restore individual items inside deleted folder '{}'. Please restore the entire folder.",
                    root_item
                )));
            }
        }

        let meta_entry = metadata_map.get(rel_key).cloned();

        let target = if let Some(ref entry) = meta_entry {
            entry.original_path.clone()
        } else if normalized_trash.starts_with("docs/.trash/") {
            normalized_trash.replacen("docs/.trash/", "docs/", 1)
        } else if normalized_trash == "docs/.trash" {
            "docs".to_string()
        } else {
            normalized_trash.replace(".trash/", "")
        };

        let original_path = fs_service::get_local_path(&app, &target, base_path.as_deref())?;

        if t_path == original_path {
            return Ok(());
        }

        if t_path.is_dir() {
            if original_path.exists() {
                if original_path.is_dir() {
                    merge_dir_recursive(&t_path, &original_path)?;
                } else {
                    if original_path != t_path {
                        let _ = fs::remove_file(&original_path);
                    }
                    if fs::rename(&t_path, &original_path).is_err() {
                        merge_dir_recursive(&t_path, &original_path)?;
                    }
                }
            } else {
                if let Some(parent) = original_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                if fs::rename(&t_path, &original_path).is_err() {
                    merge_dir_recursive(&t_path, &original_path)?;
                }
            }
        } else {
            if original_path.exists() && original_path != t_path {
                if original_path.is_file() {
                    let _ = fs::remove_file(&original_path);
                } else if original_path.is_dir() && is_dir_empty_or_junk(&original_path) {
                    let _ = fs::remove_dir_all(&original_path);
                }
            }
            if let Some(parent) = original_path.parent() {
                fs::create_dir_all(parent)?;
            }
            if fs::rename(&t_path, &original_path).is_err() {
                fs::copy(&t_path, &original_path)?;
                let _ = fs::remove_file(&t_path);
            }
        }

        if meta_entry.is_some() {
            metadata_map.remove(rel_key);
            let _ = save_trash_metadata(&trash_dir, &metadata_map);
        }

        cleanup_empty_dirs_in(&trash_dir);
        let _ = app.emit("fs-changed", ());
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn open_in_os(
    app: AppHandle,
    target_path: String,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        opener::open(&path).map_err(|e| AppError::Unknown(e.to_string()))?;
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn create_folder(
    app: AppHandle,
    _provider: Option<String>,
    target_path: String,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        fs::create_dir_all(&path)?;
        let _ = app.emit("fs-changed", ());
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn create_new_file(
    app: AppHandle,
    _provider: Option<String>,
    target_path: String,
    content: Option<String>,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let path = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if path.exists() {
            return Err(AppError::Unknown("File already exists".to_string()));
        }
        let mut file = fs::File::create(&path)?;
        if let Some(c) = content {
            file.write_all(c.as_bytes())?;
        }
        file.flush()?;
        let _ = app.emit("fs-changed", ());
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn move_file(
    app: AppHandle,
    _provider: Option<String>,
    source_path: String,
    target_path: String,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let src = fs_service::get_local_path(&app, &source_path, base_path.as_deref())?;
        let dest = fs_service::get_local_path(&app, &target_path, base_path.as_deref())?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&src, &dest)?;
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn create_backup_zip(
    app: AppHandle,
    manifest_json: String,
    docs_base_path: Option<String>,
    dest_zip_path: String,
    password: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        let _ = crate::services::os_auth_service::get_vault_key(&app);

        let final_dest_path = std::path::PathBuf::from(&dest_zip_path);
        let trimmed_pwd = password.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty());
        let has_password = trimmed_pwd.is_some();

        let (zip_dest_path, _temp_guard) = if has_password {
            let temp_dir = app.path().temp_dir().unwrap_or_else(|_| std::env::temp_dir());
            let temp_zip = temp_dir.join(format!(
                "pos_export_{}_{}.zip",
                std::process::id(),
                rand::random::<u64>()
            ));
            let guard = TempFileGuard(temp_zip.clone());
            (temp_zip, Some(guard))
        } else {
            (final_dest_path.clone(), None)
        };

        if let Some(parent) = zip_dest_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let dest_file = std::fs::File::create(&zip_dest_path)?;
        let writer = std::io::BufWriter::with_capacity(256 * 1024, dest_file);
        let mut zip = zip::ZipWriter::new(writer);
        let options =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("manifest.json", options)?;
        zip.write_all(manifest_json.as_bytes())?;

        let config_dir = app.path().app_config_dir().ok();
        let data_dir = app.path().app_data_dir().ok();

        if let Some(ref cfg_dir) = config_dir {
            let _ = std::fs::create_dir_all(cfg_dir);
            let active_db = if cfg_dir.join(crate::core::constants::DB_NAME).exists() {
                cfg_dir.join(crate::core::constants::DB_NAME)
            } else if let Some(ref d_dir) = data_dir {
                if d_dir.join(crate::core::constants::DB_NAME).exists() {
                    d_dir.join(crate::core::constants::DB_NAME)
                } else {
                    cfg_dir.join(crate::core::constants::DB_NAME)
                }
            } else {
                cfg_dir.join(crate::core::constants::DB_NAME)
            };

            if active_db.exists() {
                let temp_export_db =
                    cfg_dir.join(format!("{}.export_tmp", crate::core::constants::DB_NAME));
                if temp_export_db.exists() {
                    let _ = std::fs::remove_file(&temp_export_db);
                }
                let mut snapshot_success = false;
                if let Ok(src_conn) = rusqlite::Connection::open(&active_db) {
                    let _ = src_conn.busy_timeout(std::time::Duration::from_secs(10));
                    let _ = src_conn.pragma_update(None, "journal_mode", "WAL");
                    let _ = src_conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
                    if src_conn
                        .execute("VACUUM INTO ?1", [temp_export_db.to_string_lossy().as_ref()])
                        .is_ok()
                    {
                        if let Ok(dst_conn) = rusqlite::Connection::open(&temp_export_db) {
                            crate::commands::vault_cmd::sanitize_export_snapshot_db(&dst_conn);
                            snapshot_success = true;
                        }
                    }
                }

                if snapshot_success && temp_export_db.exists() {
                    if let Ok(mut f) = std::fs::File::open(&temp_export_db) {
                        if zip
                            .start_file(format!("system/{}", crate::core::constants::DB_NAME), options)
                            .is_ok()
                        {
                            let _ = std::io::copy(&mut f, &mut zip);
                        }
                    }
                    let _ = std::fs::remove_file(&temp_export_db);
                } else {
                    return Err(AppError::Unknown(
                        "Failed to create sanitized database snapshot for backup export".to_string(),
                    ));
                }
            }

            let extra_keys = [".vault_key"];
            for key_file in extra_keys {
                let path = if cfg_dir.join(key_file).exists() {
                    cfg_dir.join(key_file)
                } else if let Some(ref d_dir) = data_dir {
                    if d_dir.join(key_file).exists() {
                        d_dir.join(key_file)
                    } else {
                        continue;
                    }
                } else {
                    continue;
                };
                if let Ok(mut f) = std::fs::File::open(&path) {
                    if zip.start_file(format!("system/{}", key_file), options).is_ok() {
                        let _ = std::io::copy(&mut f, &mut zip);
                    }
                }
            }
        }

        let base_docs_dir =
            crate::services::fs_service::resolve_base_docs_dir(&app, docs_base_path.as_deref())?;
        let final_canonical = std::fs::canonicalize(&final_dest_path).ok();
        let final_str = final_dest_path.to_string_lossy().replace('/', "\\");
        let zip_canonical = std::fs::canonicalize(&zip_dest_path).ok();
        let zip_str = zip_dest_path.to_string_lossy().replace('/', "\\");

        let user_dirs = ["notes", "documents", "docs"];
        for dir_name in user_dirs {
            let dir_path = base_docs_dir.join(dir_name);
            if dir_path.exists() {
                for entry in walkdir::WalkDir::new(&dir_path).into_iter().flatten() {
                    let path = entry.path();
                    if path == final_dest_path || path == zip_dest_path {
                        continue;
                    }
                    if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("zip") || ext.eq_ignore_ascii_case("posbackup")) {
                        let is_same = if let (Some(ref dc), Ok(pc)) = (&final_canonical, std::fs::canonicalize(path)) {
                            dc == &pc
                        } else if let (Some(ref zc), Ok(pc)) = (&zip_canonical, std::fs::canonicalize(path)) {
                            zc == &pc
                        } else {
                            let p_str = path.to_string_lossy().replace('/', "\\");
                            p_str.eq_ignore_ascii_case(&final_str) || p_str.eq_ignore_ascii_case(&zip_str)
                        };
                        if is_same {
                            continue;
                        }
                    }

                    if let Ok(meta) = entry.metadata() {
                        if meta.len() > crate::core::constants::MAX_FILE_SIZE {
                            continue;
                        }
                    }

                    if let Ok(rel_path) = path.strip_prefix(&base_docs_dir) {
                        if crate::commands::vault_cmd::is_trash_or_temp_rel_path(rel_path) {
                            continue;
                        }
                        let zip_path = rel_path.to_string_lossy().replace('\\', "/");
                        if zip_path.is_empty() {
                            continue;
                        }

                        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                        let is_media_or_compressed = matches!(
                            ext.as_str(),
                            "mp4" | "mkv" | "avi" | "mov" | "webm" | "mp3" | "wav" | "flac" | "zip" | "gz" | "tar" | "7z" | "rar" | "jpg" | "jpeg" | "png" | "webp" | "gif" | "pdf" | "docx" | "xlsx" | "pptx" | "posbackup"
                        );
                        let file_options = if is_media_or_compressed {
                            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored)
                        } else {
                            options
                        };

                        if path.is_dir() {
                            let _ = zip.add_directory(format!("{}/", zip_path), options);
                        } else if path.is_file() && zip.start_file(&zip_path, file_options).is_ok() {
                            if let Ok(mut f) = std::fs::File::open(path) {
                                let _ = std::io::copy(&mut f, &mut zip);
                            }
                        }
                    }
                }
            }
        }

        zip.finish()?;

        if let Some(pwd) = trimmed_pwd {
            crate::services::backup_crypto_service::encrypt_file_to_posb(
                &zip_dest_path,
                &final_dest_path,
                pwd,
            )?;
        }

        Ok(())
    })
    .await?
}

fn extract_backup_zip_from_path(
    app: &AppHandle,
    zip_path: &std::path::Path,
    docs_base_path: Option<&str>,
    skip_files: Option<&[String]>,
    skip_db_import: bool,
) -> Result<String, AppError> {
    let zip_file = std::fs::File::open(zip_path)?;
    let reader = std::io::BufReader::with_capacity(256 * 1024, zip_file);
    let mut archive = zip::ZipArchive::new(reader)?;

    let mut manifest_content = String::new();
    let config_dir = app.path().app_config_dir().ok();
    let data_dir = app.path().app_data_dir().ok();
    let base_docs_dir =
        crate::services::fs_service::resolve_base_docs_dir(app, docs_base_path)?;

    if let Some(ref cfg_dir) = config_dir {
        let _ = std::fs::create_dir_all(cfg_dir);
    }
    let _ = std::fs::create_dir_all(&base_docs_dir);

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;

        let raw_name = file.name().replace('\\', "/");
        let name = raw_name.trim_start_matches('/');
        if name.is_empty()
            || name
                .split('/')
                .any(|part| part == ".." || part == ".trash" || part == "temp_notes")
        {
            continue;
        }

        let is_db = name == crate::core::constants::DB_NAME
            || name.strip_prefix("system/") == Some(crate::core::constants::DB_NAME);
        let is_key_file = matches!(
            name,
            ".vault_key" | "system/.vault_key"
        );
        let is_system_file = is_db
            || name.ends_with("-wal")
            || name.ends_with("-shm")
            || is_key_file
            || name.starts_with("system/");

        if name == "manifest.json" {
            let _ = std::io::Read::read_to_string(&mut file, &mut manifest_content);
        } else if is_system_file {
            if let Some(ref cfg_dir) = config_dir {
                if name.ends_with("-wal") || name.ends_with("-shm") {
                    continue;
                }

                if is_key_file && !file.is_dir() {
                    let key_filename = ".vault_key";
                    let mut key_content = String::new();
                    if std::io::Read::read_to_string(&mut file, &mut key_content).is_ok() {
                        let trimmed = key_content.trim();
                        if !trimmed.is_empty() {
                            let _ = std::fs::write(cfg_dir.join(key_filename), trimmed);
                            if let Some(ref d_dir) = data_dir {
                                if d_dir != cfg_dir && d_dir.exists() {
                                    let _ = std::fs::write(d_dir.join(key_filename), trimmed);
                                }
                            }
                        }
                    }
                    continue;
                }

                let base_dir = if cfg_dir.join(crate::core::constants::DB_NAME).exists() {
                    cfg_dir
                } else if let Some(ref d_dir) = data_dir {
                    if d_dir.join(crate::core::constants::DB_NAME).exists() {
                        d_dir
                    } else {
                        cfg_dir
                    }
                } else {
                    cfg_dir
                };

                let rel_str = name.strip_prefix("system/").unwrap_or(name);
                let Some(sanitized_rel) =
                    crate::services::fs_service::sanitize_relative_path_str(rel_str)
                else {
                    continue;
                };

                let target_file_path = base_dir.join(&sanitized_rel);
                if file.is_dir() {
                    let _ = std::fs::create_dir_all(&target_file_path);
                } else {
                    if let Some(p) = target_file_path.parent() {
                        let _ = std::fs::create_dir_all(p);
                    }

                    if is_db {
                        if skip_db_import {
                            continue;
                        }
                        let temp_db_path = cfg_dir
                            .join(format!("{}.import_tmp", crate::core::constants::DB_NAME));
                        if let Ok(mut outfile) = std::fs::File::create(&temp_db_path) {
                            if std::io::copy(&mut file, &mut outfile).is_ok() {
                                drop(outfile);
                                let _ = crate::commands::vault_cmd::import_sqlite_db(
                                    &temp_db_path,
                                    &target_file_path,
                                );
                                let _ = std::fs::remove_file(&temp_db_path);
                                continue;
                            }
                        }
                    }

                    if let Ok(outfile) = std::fs::File::create(&target_file_path) {
                        let mut buf_out = std::io::BufWriter::with_capacity(64 * 1024, outfile);
                        let _ = std::io::copy(&mut file, &mut buf_out);
                        let _ = std::io::Write::flush(&mut buf_out);
                        crate::commands::vault_cmd::remove_local_trash_replica(&base_docs_dir, name);
                    }
                }
            }
        } else if name.starts_with("notes/")
            || name == "notes"
            || name.starts_with("documents/")
            || name == "documents"
            || name.starts_with("docs/")
            || name == "docs"
        {
            if let Some(skips) = skip_files {
                let lower_name = name.to_lowercase();
                if skips.iter().any(|s| {
                    let ls = s.to_lowercase().replace('\\', "/");
                    let cs = ls.trim_start_matches('/');
                    lower_name == cs
                        || lower_name.ends_with(&format!("/{}", cs))
                        || cs.ends_with(&format!("/{}", lower_name))
                }) {
                    continue;
                }
            }
            let Some(sanitized_enclosed) =
                crate::services::fs_service::sanitize_relative_path_str(name)
            else {
                continue;
            };
            let target_file_path = base_docs_dir.join(&sanitized_enclosed);
            if target_file_path.starts_with(&base_docs_dir) {
                if file.is_dir() || raw_name.ends_with('/') {
                    if target_file_path.is_file() {
                        let _ = std::fs::remove_file(&target_file_path);
                    }
                    let _ = std::fs::create_dir_all(&target_file_path);
                } else {
                    if let Some(p) = target_file_path.parent() {
                        if p.is_file() {
                            let _ = std::fs::remove_file(p);
                        }
                        let _ = std::fs::create_dir_all(p);
                    }
                    if target_file_path.is_dir() {
                        let _ = std::fs::remove_dir_all(&target_file_path);
                    }
                    if let Ok(outfile) = std::fs::File::create(&target_file_path) {
                        let mut buf_out = std::io::BufWriter::with_capacity(64 * 1024, outfile);
                        let _ = std::io::copy(&mut file, &mut buf_out);
                        let _ = std::io::Write::flush(&mut buf_out);
                        crate::commands::vault_cmd::remove_local_trash_replica(&base_docs_dir, name);
                    }
                }
            }
        } else if let Some(rel_str) = name.strip_prefix("files/docs/") {
            if let Some(skips) = skip_files {
                let lower_name = rel_str.to_lowercase();
                if skips.iter().any(|s| {
                    let ls = s.to_lowercase().replace('\\', "/");
                    let cs = ls.trim_start_matches('/');
                    lower_name == cs
                        || lower_name.ends_with(&format!("/{}", cs))
                        || cs.ends_with(&format!("/{}", lower_name))
                }) {
                    continue;
                }
            }
            let Some(sanitized_rel) =
                crate::services::fs_service::sanitize_relative_path_str(rel_str)
            else {
                continue;
            };
            let target_file_path = base_docs_dir.join("docs").join(sanitized_rel);
            if target_file_path.starts_with(&base_docs_dir) {
                if file.is_dir() || raw_name.ends_with('/') {
                    if target_file_path.is_file() {
                        let _ = std::fs::remove_file(&target_file_path);
                    }
                    let _ = std::fs::create_dir_all(&target_file_path);
                } else {
                    if let Some(p) = target_file_path.parent() {
                        if p.is_file() {
                            let _ = std::fs::remove_file(p);
                        }
                        let _ = std::fs::create_dir_all(p);
                    }
                    if target_file_path.is_dir() {
                        let _ = std::fs::remove_dir_all(&target_file_path);
                    }
                    if let Ok(outfile) = std::fs::File::create(&target_file_path) {
                        let mut buf_out = std::io::BufWriter::with_capacity(64 * 1024, outfile);
                        let _ = std::io::copy(&mut file, &mut buf_out);
                        let _ = std::io::Write::flush(&mut buf_out);
                        crate::commands::vault_cmd::remove_local_trash_replica(&base_docs_dir, name);
                    }
                }
            }
        }
    }

    if let Some(ref cfg_dir) = config_dir {
        let data_dir_ref = data_dir.as_ref().unwrap_or(cfg_dir);
        crate::commands::vault_cmd::restore_keyring_keys(cfg_dir, data_dir_ref);
    }

    let _ = app.emit("fs-changed", ());

    Ok(manifest_content)
}

#[derive(Serialize)]
pub struct FlatFileItem {
    pub source_path: String,
    pub target_rel_path: String,
}

#[tauri::command]
pub async fn get_dragged_items_contents(
    paths: Vec<String>,
) -> Result<Vec<FlatFileItem>, AppError> {
    tokio::task::spawn_blocking(move || {
        let mut items = Vec::with_capacity(paths.len() * 2);
        for p in paths {
            let path = std::path::Path::new(&p);
            if path.is_file() {
                if let Some(file_name) = path.file_name() {
                    let target_rel_path = file_name.to_string_lossy().into_owned();
                    items.push(FlatFileItem {
                        source_path: p,
                        target_rel_path,
                    });
                }
            } else if path.is_dir() {
                if let Some(folder_name) = path.file_name() {
                    let folder_str = folder_name.to_string_lossy();
                    for entry in walkdir::WalkDir::new(path).into_iter().flatten() {
                        let entry_path = entry.path();
                        if entry_path.is_file() {
                            if let Ok(rel_path) = entry_path.strip_prefix(path) {
                                let rel_str = rel_path.to_string_lossy().replace('\\', "/");
                                items.push(FlatFileItem {
                                    source_path: entry_path.to_string_lossy().into_owned(),
                                    target_rel_path: format!("{}/{}", folder_str, rel_str),
                                });
                            }
                        }
                    }
                }
            }
        }
        Ok(items)
    })
    .await?
}

#[tauri::command]
pub async fn extract_backup_zip_absolute(
    app: AppHandle,
    absolute_path: String,
    docs_base_path: Option<String>,
    skip_files: Option<Vec<String>>,
    skip_db_import: Option<bool>,
    password: Option<String>,
) -> Result<String, AppError> {
    let manifest_content = tokio::task::spawn_blocking(move || {
        let zip_path = std::path::PathBuf::from(&absolute_path);
        if !zip_path.exists() {
            return Err(AppError::Unknown("Backup file not found".to_string()));
        }

        let format = crate::services::backup_crypto_service::detect_backup_format(&zip_path)?;
        match format {
            crate::services::backup_crypto_service::BackupFormat::EncryptedPosb { .. } => {
                let pwd = match password.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    Some(p) => p,
                    None => return Err(AppError::Unknown("PASSWORD_REQUIRED".to_string())),
                };

                let temp_dir = app.path().temp_dir().unwrap_or_else(|_| std::env::temp_dir());
                let temp_zip = temp_dir.join(format!(
                    "pos_extract_{}_{}.zip",
                    std::process::id(),
                    rand::random::<u64>()
                ));
                let _guard = TempFileGuard(temp_zip.clone());

                crate::services::backup_crypto_service::decrypt_posb_to_file(&zip_path, &temp_zip, pwd)?;

                extract_backup_zip_from_path(
                    &app,
                    &temp_zip,
                    docs_base_path.as_deref(),
                    skip_files.as_deref(),
                    skip_db_import.unwrap_or(false),
                )
            }
            crate::services::backup_crypto_service::BackupFormat::LegacyZip => {
                extract_backup_zip_from_path(
                    &app,
                    &zip_path,
                    docs_base_path.as_deref(),
                    skip_files.as_deref(),
                    skip_db_import.unwrap_or(false),
                )
            }
            crate::services::backup_crypto_service::BackupFormat::Unknown => {
                Err(AppError::Unknown("INVALID_BACKUP_FORMAT".to_string()))
            }
        }
    })
    .await??;
    Ok(manifest_content)
}

#[tauri::command]
pub async fn inspect_backup_manifest(
    app: AppHandle,
    absolute_path: String,
    password: Option<String>,
) -> Result<String, AppError> {
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&absolute_path);
        if !path.exists() {
            return Err(AppError::Unknown("Backup file not found".to_string()));
        }

        let format = crate::services::backup_crypto_service::detect_backup_format(path)?;
        match format {
            crate::services::backup_crypto_service::BackupFormat::EncryptedPosb { .. } => {
                let pwd = match password.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    Some(p) => p,
                    None => return Err(AppError::Unknown("PASSWORD_REQUIRED".to_string())),
                };

                let temp_dir = app.path().temp_dir().unwrap_or_else(|_| std::env::temp_dir());
                let temp_zip = temp_dir.join(format!(
                    "pos_inspect_{}_{}.zip",
                    std::process::id(),
                    rand::random::<u64>()
                ));
                let _guard = TempFileGuard(temp_zip.clone());

                crate::services::backup_crypto_service::decrypt_posb_to_file(path, &temp_zip, pwd)?;

                let file = std::fs::File::open(&temp_zip)?;
                let reader = std::io::BufReader::with_capacity(64 * 1024, file);
                let mut archive = zip::ZipArchive::new(reader)?;
                for i in 0..archive.len() {
                    let mut file = archive.by_index(i)?;
                    let raw_name = file.name().replace('\\', "/");
                    let name = raw_name.trim_start_matches('/');
                    if name == "manifest.json" {
                        let mut manifest_content = String::new();
                        std::io::Read::read_to_string(&mut file, &mut manifest_content)?;
                        return Ok(manifest_content);
                    }
                }
                Err(AppError::Unknown("manifest.json not found in backup archive".to_string()))
            }
            crate::services::backup_crypto_service::BackupFormat::LegacyZip => {
                let file = std::fs::File::open(path)?;
                let reader = std::io::BufReader::with_capacity(64 * 1024, file);
                let mut archive = zip::ZipArchive::new(reader)?;
                for i in 0..archive.len() {
                    let mut file = archive.by_index(i)?;
                    let raw_name = file.name().replace('\\', "/");
                    let name = raw_name.trim_start_matches('/');
                    if name == "manifest.json" {
                        let mut manifest_content = String::new();
                        std::io::Read::read_to_string(&mut file, &mut manifest_content)?;
                        return Ok(manifest_content);
                    }
                }
                Err(AppError::Unknown("manifest.json not found in backup archive".to_string()))
            }
            crate::services::backup_crypto_service::BackupFormat::Unknown => {
                let meta = std::fs::metadata(path)?;
                if meta.len() <= 10_000_000 {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        if content.trim_start().starts_with('{') {
                            return Ok(content);
                        }
                    }
                }
                Err(AppError::Unknown("INVALID_BACKUP_FORMAT".to_string()))
            }
        }
    })
    .await?
}

#[tauri::command]
pub async fn cleanup_documents_trash(
    app: AppHandle,
    retention_ms: u64,
) -> Result<(), AppError> {
    let base_path = None;
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        if let Ok(trash_path) = fs_service::get_local_path(&app_clone, "docs/.trash", base_path) {
            if trash_path.exists() {
                let now = std::time::SystemTime::now();
                let threshold = std::time::Duration::from_millis(retention_ms);

                for entry in walkdir::WalkDir::new(&trash_path)
                    .min_depth(1)
                    .contents_first(true)
                    .into_iter()
                    .flatten()
                {
                    if let Ok(metadata) = entry.metadata() {
                        if let Ok(modified) = metadata.modified() {
                            if let Ok(duration) = now.duration_since(modified) {
                                if duration > threshold {
                                    let clean_entry_path = fs_service::strip_verbatim_prefix(entry.path());
                                    let _ = trash::delete(&clean_entry_path).or_else(|_| {
                                        if metadata.is_dir() {
                                            std::fs::remove_dir_all(&clean_entry_path)
                                        } else {
                                            std::fs::remove_file(&clean_entry_path)
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
                let mut meta = load_trash_metadata(&trash_path);
                meta.retain(|k, _| trash_path.join(k).exists());
                let _ = save_trash_metadata(&trash_path, &meta);
            }
        }
    })
    .await
    .unwrap_or(());

    Ok(())
}

#[tauri::command]
pub async fn empty_documents_trash(
    app: AppHandle,
    base_path: Option<String>,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        if let Ok(trash_dir) = fs_service::get_local_path(&app, "docs/.trash", base_path.as_deref()) {
            if trash_dir.exists() && trash_dir.is_dir() {
                let clean_trash_dir = fs_service::strip_verbatim_prefix(&trash_dir);
                if let Ok(entries) = fs::read_dir(&clean_trash_dir) {
                    for entry in entries.flatten() {
                        let path = fs_service::strip_verbatim_prefix(entry.path());
                        let _ = trash::delete(&path);
                    }
                }
                cleanup_empty_dirs_in(&clean_trash_dir);
                let meta_file = clean_trash_dir.join(TRASH_METADATA_FILE);
                if meta_file.exists() {
                    let _ = fs::remove_file(&meta_file);
                }
            }
        }
        let _ = app.emit("fs-changed", ());
        Ok(())
    })
    .await?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentTreeEntry {
    pub name: String,
    pub path: String,
    pub parent_path: Option<String>,
    pub is_dir: bool,
    pub size: u64,
    pub updated_at: u64,
}

#[tauri::command]
pub async fn scan_document_tree(
    app: AppHandle,
    _provider: Option<String>,
    base_path: Option<String>,
    scope: Option<String>,
) -> Result<Vec<DocumentTreeEntry>, AppError> {
    tokio::task::spawn_blocking(move || {
        let is_trash = scope.as_deref() == Some("trash");
        let target_sub = if is_trash { "docs/.trash" } else { "docs" };
        let docs_dir = fs_service::get_local_path(&app, target_sub, base_path.as_deref())?;
        if !docs_dir.exists() {
            let _ = fs::create_dir_all(&docs_dir);
            return Ok(Vec::new());
        }

        let mut results = Vec::new();

        for entry in walkdir::WalkDir::new(&docs_dir)
            .min_depth(1)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                if !is_trash
                    && (name == ".trash"
                        || name == ".keep"
                        || name == ".DS_Store"
                        || name == "."
                        || name == ".."
                        || name == TRASH_METADATA_FILE)
                {
                    return false;
                }
                if is_trash
                    && (name == ".keep"
                        || name == ".DS_Store"
                        || name == "."
                        || name == ".."
                        || name == TRASH_METADATA_FILE)
                {
                    return false;
                }
                true
            })
            .flatten()
        {
            let path = entry.path();
            let rel = match path.strip_prefix(&docs_dir) {
                Ok(p) => p,
                Err(_) => continue,
            };

            let rel_str = rel.to_string_lossy().replace('\\', "/");
            if rel_str.is_empty() {
                continue;
            }

            let is_dir = entry.file_type().is_dir();
            let file_name = entry.file_name().to_string_lossy().into_owned();

            let parent_path = rel.parent().and_then(|p| {
                let s = p.to_string_lossy().replace('\\', "/");
                if s.is_empty() {
                    None
                } else {
                    Some(s)
                }
            });

            let meta = entry.metadata().ok();
            let size = if is_dir {
                0
            } else {
                meta.as_ref().map(|m| m.len()).unwrap_or(0)
            };

            let updated_at = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            results.push(DocumentTreeEntry {
                name: file_name,
                path: rel_str,
                parent_path,
                is_dir,
                size,
                updated_at,
            });
        }

        results.sort_by(|a, b| {
            if a.is_dir != b.is_dir {
                b.is_dir.cmp(&a.is_dir)
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });

        Ok(results)
    })
    .await?
}


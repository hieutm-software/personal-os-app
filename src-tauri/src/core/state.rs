use crate::core::constants::DB_NAME;
use crate::core::error::AppError;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

pub struct AppState {}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {}
    }

    pub fn get_connection(&self, app: &AppHandle) -> Result<Connection, AppError> {
        let mut db_path = app.path().app_config_dir()?.join(DB_NAME);
        if !db_path.exists() {
            let fallback_path = app.path().app_data_dir()?.join(DB_NAME);
            if fallback_path.exists() {
                db_path = fallback_path;
            }
        }

        if let Some(parent) = db_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)?;
            }
        }

        let conn = Connection::open(db_path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "busy_timeout", "10000")?;
        conn.pragma_update(None, "temp_store", "MEMORY")?;
        conn.pragma_update(None, "cache_size", "-20000")?;

        Ok(conn)
    }
}

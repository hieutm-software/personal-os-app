use crate::core::constants::THIRTY_DAYS_MS;
use crate::core::error::AppError;
use crate::core::state::AppState;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

pub async fn run_background_cleanup(app: AppHandle) {
    tokio::time::sleep(std::time::Duration::from_secs(60)).await;

    let _ = tokio::task::spawn_blocking(move || perform_cleanup(&app)).await;
}

pub fn perform_cleanup(app: &AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let mut conn = state.get_connection(app)?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(10));

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let threshold = now - THIRTY_DAYS_MS;

    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    let d1 = tx.execute(
        "DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [threshold],
    )?;

    let d2 = tx.execute(
        "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [threshold],
    )?;

    let d3 = tx.execute(
        "DELETE FROM note_groups WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [threshold],
    )?;

    let d4 = tx.execute(
        "DELETE FROM vault WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [threshold],
    )?;

    let d5 = tx.execute(
        "DELETE FROM vault_groups WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [threshold],
    )?;

    let d6 = tx.execute(
        "DELETE FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [threshold],
    )?;

    let d7 = tx.execute(
        "DELETE FROM document_folders WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [threshold],
    )?;

    tx.commit()?;

    if (d1 + d2 + d3 + d4 + d5 + d6 + d7) > 0 {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE); PRAGMA optimize;");
    }

    Ok(())
}

use crate::core::error::AppError;
use crate::services::os_auth_service;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[tauri::command]
pub async fn authenticate_os(reason: String) -> Result<bool, AppError> {
    os_auth_service::authenticate_os(&reason)
}

#[tauri::command]
pub async fn get_vault_key(app: AppHandle) -> Result<String, AppError> {
    os_auth_service::get_vault_key(&app)
}

#[tauri::command]
pub async fn save_vault_key(app: AppHandle, key: String) -> Result<(), AppError> {
    os_auth_service::save_vault_key(&app, &key)
}

pub fn ensure_db_schema(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let alter_stmts = [
        "ALTER TABLE `tasks` ADD COLUMN `due_date` INTEGER;",
        "ALTER TABLE `tasks` ADD COLUMN `group_id` TEXT;",
        "ALTER TABLE `task_groups` ADD COLUMN `parent_id` TEXT;",
        "ALTER TABLE `events` ADD COLUMN `source` TEXT NOT NULL DEFAULT 'LOCAL';",
        "ALTER TABLE `events` ADD COLUMN `external_id` TEXT;",
        "ALTER TABLE `events` ADD COLUMN `group_id` TEXT;",
        "ALTER TABLE `vault` ADD COLUMN `group_id` TEXT;",
        "ALTER TABLE `vault_groups` ADD COLUMN `parent_id` TEXT;",
        "ALTER TABLE `notes` ADD COLUMN `group_id` TEXT;",
        "ALTER TABLE `note_groups` ADD COLUMN `parent_id` TEXT;",
    ];
    for stmt in alter_stmts {
        let _ = conn.execute(stmt, []);
    }

    conn.execute_batch(include_str!("../../migrations/001_initial.sql"))?;

    Ok(())
}

fn get_table_columns(conn: &rusqlite::Connection, schema: &str, table: &str) -> Vec<String> {
    let query = format!("PRAGMA {}.table_info(\"{}\")", schema, table);
    if let Ok(mut stmt) = conn.prepare(&query) {
        if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) {
            return rows.flatten().collect();
        }
    }
    Vec::new()
}

pub fn sanitize_export_snapshot_db(conn: &rusqlite::Connection) {
    let cascade_and_delete_stmts = [
        // 1. Delete documents inside trashed document folders (recursive CTE)
        "WITH RECURSIVE trashed_df(id) AS (
            SELECT id FROM document_folders WHERE deleted_at IS NOT NULL
            UNION ALL
            SELECT df.id FROM document_folders df
            JOIN trashed_df ON df.parent_id = trashed_df.id
        )
        DELETE FROM documents WHERE folder_id IN (SELECT id FROM trashed_df);",

        // 2. Delete trashed document folders (including child folders of trashed folders)
        "WITH RECURSIVE trashed_df(id) AS (
            SELECT id FROM document_folders WHERE deleted_at IS NOT NULL
            UNION ALL
            SELECT df.id FROM document_folders df
            JOIN trashed_df ON df.parent_id = trashed_df.id
        )
        DELETE FROM document_folders WHERE id IN (SELECT id FROM trashed_df);",

        // 3. Delete notes inside trashed note groups (recursive CTE)
        "WITH RECURSIVE trashed_ng(id) AS (
            SELECT id FROM note_groups WHERE deleted_at IS NOT NULL
            UNION ALL
            SELECT ng.id FROM note_groups ng
            JOIN trashed_ng ON ng.parent_id = trashed_ng.id
        )
        DELETE FROM notes WHERE group_id IN (SELECT id FROM trashed_ng);",

        // 4. Delete trashed note groups (including child groups of trashed groups)
        "WITH RECURSIVE trashed_ng(id) AS (
            SELECT id FROM note_groups WHERE deleted_at IS NOT NULL
            UNION ALL
            SELECT ng.id FROM note_groups ng
            JOIN trashed_ng ON ng.parent_id = trashed_ng.id
        )
        DELETE FROM note_groups WHERE id IN (SELECT id FROM trashed_ng);",

        // 5. Delete vault items inside trashed vault groups (recursive CTE)
        "WITH RECURSIVE trashed_vg(id) AS (
            SELECT id FROM vault_groups WHERE deleted_at IS NOT NULL
            UNION ALL
            SELECT vg.id FROM vault_groups vg
            JOIN trashed_vg ON vg.parent_id = trashed_vg.id
        )
        DELETE FROM vault WHERE group_id IN (SELECT id FROM trashed_vg);",

        // 6. Delete trashed vault groups (including child groups of trashed groups)
        "WITH RECURSIVE trashed_vg(id) AS (
            SELECT id FROM vault_groups WHERE deleted_at IS NOT NULL
            UNION ALL
            SELECT vg.id FROM vault_groups vg
            JOIN trashed_vg ON vg.parent_id = trashed_vg.id
        )
        DELETE FROM vault_groups WHERE id IN (SELECT id FROM trashed_vg);",

        // 7. Delete directly soft-deleted records across all tables
        "DELETE FROM tasks WHERE deleted_at IS NOT NULL;",
        "DELETE FROM notes WHERE deleted_at IS NOT NULL;",
        "DELETE FROM documents WHERE deleted_at IS NOT NULL;",
        "DELETE FROM document_folders WHERE deleted_at IS NOT NULL;",
        "DELETE FROM vault WHERE deleted_at IS NOT NULL;",
        "DELETE FROM note_groups WHERE deleted_at IS NOT NULL;",
        "DELETE FROM vault_groups WHERE deleted_at IS NOT NULL;",
        "DELETE FROM events WHERE source LIKE 'GOOGLE%' OR group_id = 'GOOGLE_CALENDAR';",
        "INSERT INTO notes_fts(notes_fts) VALUES('rebuild');",
    ];
    for stmt in cascade_and_delete_stmts {
        let _ = conn.execute_batch(stmt);
    }
    let _ = conn.execute_batch("VACUUM;");
}

pub fn is_trash_or_temp_rel_path(rel_path: &Path) -> bool {
    rel_path.iter().any(|seg| {
        let s = seg.to_string_lossy();
        s == ".trash"
            || s == "temp_notes"
            || s == ".trash_metadata.json"
            || s == ".DS_Store"
    })
}

pub fn remove_local_trash_replica(base_docs_dir: &Path, rel_name: &str) {
    let clean_rel = rel_name.replace('\\', "/").trim_start_matches('/').to_string();
    if clean_rel.is_empty() {
        return;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(sub) = clean_rel.strip_prefix("notes/") {
        candidates.push(base_docs_dir.join("notes/.trash").join(sub));
        if let Some(fname) = Path::new(sub).file_name() {
            candidates.push(base_docs_dir.join("notes/.trash").join(fname));
        }
        candidates.push(base_docs_dir.join(".trash").join(&clean_rel));
    } else if let Some(sub) = clean_rel.strip_prefix("docs/") {
        candidates.push(base_docs_dir.join("docs/.trash").join(sub));
        if let Some(fname) = Path::new(sub).file_name() {
            candidates.push(base_docs_dir.join("docs/.trash").join(fname));
        }
        candidates.push(base_docs_dir.join(".trash").join(&clean_rel));
    } else if let Some(sub) = clean_rel.strip_prefix("documents/") {
        candidates.push(base_docs_dir.join("documents/.trash").join(sub));
        if let Some(fname) = Path::new(sub).file_name() {
            candidates.push(base_docs_dir.join("documents/.trash").join(fname));
        }
        candidates.push(base_docs_dir.join(".trash").join(&clean_rel));
    }

    for c in candidates {
        if c.exists() {
            if c.is_file() {
                let _ = fs::remove_file(&c);
            } else if c.is_dir() {
                let _ = fs::remove_dir_all(&c);
            }
        }
    }
}

pub fn import_sqlite_db(src_db_path: &Path, dst_db_path: &Path) -> Result<(), AppError> {
    if let Some(parent) = dst_db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let dst_conn = rusqlite::Connection::open(dst_db_path)?;
    let _ = dst_conn.busy_timeout(std::time::Duration::from_secs(10));
    let _ = dst_conn.pragma_update(None, "journal_mode", "WAL");
    let _ = dst_conn.pragma_update(None, "synchronous", "NORMAL");

    ensure_db_schema(&dst_conn)?;

    dst_conn.execute(
        "ATTACH DATABASE ?1 AS backup_db",
        [src_db_path.to_string_lossy().as_ref()],
    )?;

    // Strict topological dependency order:
    // 1. Settings & configs
    // 2. Active groups & folder trees (parent_id IS NULL first, then nested)
    // 3. Active data items & files
    let tables = [
        "ui_preferences",
        "task_groups",
        "event_groups",
        "vault_groups",
        "note_groups",
        "document_folders",
        "tasks",
        "events",
        "notes",
        "documents",
        "vault",
    ];

    let tx_res = (|| -> Result<(), AppError> {
        dst_conn.execute_batch("BEGIN IMMEDIATE;")?;

        for table in tables {
            let exists: bool = dst_conn
                .query_row(
                    "SELECT count(*) > 0 FROM backup_db.sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !exists {
                continue;
            }

            let main_cols = get_table_columns(&dst_conn, "main", table);
            let backup_cols_vec = get_table_columns(&dst_conn, "backup_db", table);
            let backup_cols: HashSet<String> = backup_cols_vec.into_iter().collect();

            let has_deleted_at = backup_cols.contains("deleted_at");
            let has_source = backup_cols.contains("source");
            let has_group_id = backup_cols.contains("group_id");
            let has_parent_id = backup_cols.contains("parent_id");

            let common_cols: Vec<String> = main_cols
                .into_iter()
                .filter(|c| backup_cols.contains(c))
                .map(|c| format!("\"{}\"", c))
                .collect();

            if common_cols.is_empty() {
                continue;
            }

            let mut where_clauses: Vec<&str> = Vec::new();
            if has_deleted_at
                && matches!(
                    table,
                    "tasks"
                        | "notes"
                        | "documents"
                        | "document_folders"
                        | "vault"
                        | "note_groups"
                        | "vault_groups"
                )
            {
                where_clauses.push("\"deleted_at\" IS NULL");
            }
            if table == "events" {
                if has_source {
                    where_clauses.push("(\"source\" IS NULL OR \"source\" NOT LIKE 'GOOGLE%')");
                }
                if has_group_id {
                    where_clauses
                        .push("(\"group_id\" IS NULL OR \"group_id\" != 'GOOGLE_CALENDAR')");
                }
            }

            let where_sql = if where_clauses.is_empty() {
                String::new()
            } else {
                format!(" WHERE {}", where_clauses.join(" AND "))
            };

            let order_by_sql = if has_parent_id {
                " ORDER BY CASE WHEN \"parent_id\" IS NULL THEN 0 ELSE 1 END"
            } else {
                ""
            };

            let cols_list = common_cols.join(", ");
            let copy_sql = format!(
                "INSERT OR REPLACE INTO main.\"{}\" ({}) SELECT {} FROM backup_db.\"{}\"{}{};",
                table, cols_list, cols_list, table, where_sql, order_by_sql
            );
            dst_conn.execute_batch(&copy_sql)?;
        }

        // Rebuild FTS index safely without deleting any user notes
        let _ = dst_conn.execute_batch("INSERT INTO main.notes_fts(notes_fts) VALUES('rebuild');");
        dst_conn.execute_batch("COMMIT;")?;
        Ok(())
    })();

    if tx_res.is_err() {
        let _ = dst_conn.execute_batch("ROLLBACK;");
    }

    let _ = dst_conn.execute("DETACH DATABASE backup_db", []);
    let _ = dst_conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

    tx_res
}

pub fn restore_keyring_keys(config_dir: &Path, data_dir: &Path) {
    let p_vault = config_dir.join(".vault_key");
    let vault_key_path = if p_vault.exists() {
        Some(p_vault)
    } else {
        let p2 = data_dir.join(".vault_key");
        if p2.exists() {
            Some(p2)
        } else {
            None
        }
    };

    if let Some(path) = vault_key_path {
        if let Ok(vault_key) = fs::read_to_string(path) {
            let trimmed = vault_key.trim();
            if !trimmed.is_empty() {
                let _ = fs::write(config_dir.join(".vault_key"), trimmed);
                if let Ok(entry) = keyring::Entry::new(
                    crate::core::constants::KEYRING_VAULT_SERVICE,
                    crate::core::constants::KEYRING_VAULT_USER,
                ) {
                    let _ = entry.set_password(trimmed);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("test_backup_{}", uuid::Uuid::new_v4()));
            let _ = fs::create_dir_all(&path);
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn setup_test_db(conn: &rusqlite::Connection) {
        conn.execute_batch(include_str!("../../migrations/001_initial.sql"))
            .expect("Failed to initialize schema");
    }

    #[test]
    fn test_sanitize_export_snapshot_db() {
        let conn = rusqlite::Connection::open_in_memory().expect("open memory db");
        setup_test_db(&conn);

        let now = 1700000000i64;
        conn.execute(
            "INSERT INTO tasks (id, title, status, created_at, updated_at, deleted_at) VALUES ('t1', 'Active Task', 'TODO', ?1, ?1, NULL)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, status, created_at, updated_at, deleted_at) VALUES ('t2', 'Deleted Task', 'DONE', ?1, ?1, ?1)",
            [now],
        ).unwrap();

        conn.execute(
            "INSERT INTO note_groups (id, name, created_at, updated_at, deleted_at) VALUES ('ng1', 'Active Group', ?1, ?1, NULL)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO note_groups (id, name, created_at, updated_at, deleted_at) VALUES ('ng2', 'Deleted Group', ?1, ?1, ?1)",
            [now],
        ).unwrap();

        conn.execute(
            "INSERT INTO vault_groups (id, name, created_at, updated_at, deleted_at) VALUES ('vg1', 'Active VG', ?1, ?1, NULL)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO vault_groups (id, name, created_at, updated_at, deleted_at) VALUES ('vg2', 'Deleted VG', ?1, ?1, ?1)",
            [now],
        ).unwrap();

        conn.execute(
            "INSERT INTO events (id, title, source, created_at, updated_at) VALUES ('e1', 'Local Event', 'LOCAL', ?1, ?1)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO events (id, title, source, created_at, updated_at) VALUES ('e2', 'Google Event', 'GOOGLE::calendar', ?1, ?1)",
            [now],
        ).unwrap();

        // Notes and Documents cascading checks
        conn.execute(
            "INSERT INTO notes (id, title, group_id, created_at, updated_at, deleted_at) VALUES ('n_in_del_g', 'Note In Deleted Group', 'ng2', ?1, ?1, NULL)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO notes (id, title, group_id, created_at, updated_at, deleted_at) VALUES ('n_in_act_g', 'Note In Active Group', 'ng1', ?1, ?1, NULL)",
            [now],
        ).unwrap();

        conn.execute(
            "INSERT INTO document_folders (id, name, created_at, updated_at, deleted_at) VALUES ('df1', 'Active Folder', ?1, ?1, NULL)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO document_folders (id, name, created_at, updated_at, deleted_at) VALUES ('df2', 'Deleted Folder', ?1, ?1, ?1)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO documents (id, name, folder_id, size, mime_type, storage_provider, created_at, updated_at, deleted_at) VALUES ('d_in_del_f', 'Doc In Del Folder', 'df2', 10, 'text/plain', 'LOCAL', ?1, ?1, NULL)",
            [now],
        ).unwrap();
        conn.execute(
            "INSERT INTO documents (id, name, folder_id, size, mime_type, storage_provider, created_at, updated_at, deleted_at) VALUES ('d_in_act_f', 'Doc In Act Folder', 'df1', 10, 'text/plain', 'LOCAL', ?1, ?1, NULL)",
            [now],
        ).unwrap();

        sanitize_export_snapshot_db(&conn);

        let active_tasks: i64 = conn.query_row("SELECT count(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(active_tasks, 1);

        let active_ng: i64 = conn.query_row("SELECT count(*) FROM note_groups", [], |r| r.get(0)).unwrap();
        assert_eq!(active_ng, 1);

        let active_vg: i64 = conn.query_row("SELECT count(*) FROM vault_groups", [], |r| r.get(0)).unwrap();
        assert_eq!(active_vg, 1);

        let active_events: i64 = conn.query_row("SELECT count(*) FROM events", [], |r| r.get(0)).unwrap();
        assert_eq!(active_events, 1);

        // Verify cascade exclusion of items whose parent group/folder was trashed
        let active_notes: i64 = conn.query_row("SELECT count(*) FROM notes", [], |r| r.get(0)).unwrap();
        assert_eq!(active_notes, 1); // Only 'n_in_act_g' remains
        let act_note_title: String = conn.query_row("SELECT title FROM notes LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(act_note_title, "Note In Active Group");

        let active_docs: i64 = conn.query_row("SELECT count(*) FROM documents", [], |r| r.get(0)).unwrap();
        assert_eq!(active_docs, 1); // Only 'd_in_act_f' remains
        let act_doc_name: String = conn.query_row("SELECT name FROM documents LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(act_doc_name, "Doc In Act Folder");
    }

    #[test]
    fn test_sqlite_db_import_merge() {
        let dir = TempDir::new();
        let src_path = dir.path().join("src.db");
        let dst_path = dir.path().join("dst.db");

        let src_conn = rusqlite::Connection::open(&src_path).expect("open src");
        setup_test_db(&src_conn);

        let dst_conn = rusqlite::Connection::open(&dst_path).expect("open dst");
        setup_test_db(&dst_conn);

        let now = 1700000000i64;
        src_conn.execute(
            "INSERT INTO tasks (id, title, status, created_at, updated_at, deleted_at) VALUES ('t1', 'Imported Task', 'TODO', ?1, ?1, NULL)",
            [now],
        ).unwrap();
        src_conn.execute(
            "INSERT INTO tasks (id, title, status, created_at, updated_at, deleted_at) VALUES ('t_del', 'Deleted Task', 'TODO', ?1, ?1, ?1)",
            [now],
        ).unwrap();

        // Local has 't1' in TRASH (deleted_at IS NOT NULL)
        dst_conn.execute(
            "INSERT INTO tasks (id, title, status, created_at, updated_at, deleted_at) VALUES ('t1', 'Local Trashed Task', 'TODO', ?1, ?1, ?1)",
            [now - 100],
        ).unwrap();
        // Local has an un-imported task in trash that MUST be preserved untouched
        dst_conn.execute(
            "INSERT INTO tasks (id, title, status, created_at, updated_at, deleted_at) VALUES ('local_trash', 'Local Unique Trash', 'DONE', ?1, ?1, ?1)",
            [now - 200],
        ).unwrap();

        import_sqlite_db(&src_path, &dst_path).expect("import_sqlite_db success");

        // t1 must be overwritten and un-trashed (deleted_at IS NULL)
        let (dst_tasks, t1_deleted_at): (i64, Option<i64>) = dst_conn.query_row(
            "SELECT count(*), deleted_at FROM tasks WHERE id='t1'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(dst_tasks, 1);
        assert_eq!(t1_deleted_at, None); // Un-trashed!

        // Deleted item from backup should NOT be imported
        let dst_del_tasks: i64 = dst_conn.query_row("SELECT count(*) FROM tasks WHERE id='t_del'", [], |r| r.get(0)).unwrap();
        assert_eq!(dst_del_tasks, 0);

        // Pre-existing local trash NOT in backup must be preserved 100% untouched
        let local_trash_count: i64 = dst_conn.query_row("SELECT count(*) FROM tasks WHERE id='local_trash'", [], |r| r.get(0)).unwrap();
        assert_eq!(local_trash_count, 1);
    }


}


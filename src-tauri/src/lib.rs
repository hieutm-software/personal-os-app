use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_sql::{Migration, MigrationKind};

pub mod commands;
pub mod core;
pub mod services;

fn reconcile_existing_database(app: &tauri::AppHandle) {
    let mut candidate_paths = Vec::with_capacity(2);
    if let Ok(cfg_dir) = app.path().app_config_dir() {
        candidate_paths.push(cfg_dir.join(crate::core::constants::DB_NAME));
    }
    if let Ok(data_dir) = app.path().app_data_dir() {
        let data_db = data_dir.join(crate::core::constants::DB_NAME);
        if !candidate_paths.contains(&data_db) {
            candidate_paths.push(data_db);
        }
    }

    for db_path in candidate_paths {
        if !db_path.exists() {
            continue;
        }
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let _ = conn.busy_timeout(std::time::Duration::from_secs(10));
            let _ = conn.pragma_update(None, "journal_mode", "WAL");
            let _ = conn.pragma_update(None, "synchronous", "NORMAL");
            let _ = conn.pragma_update(None, "foreign_keys", "ON");
            let _ = conn.pragma_update(None, "temp_store", "MEMORY");
            let _ = crate::commands::vault_cmd::ensure_db_schema(&conn);
            let _ = conn.execute_batch("DROP TABLE IF EXISTS `_sqlx_migrations`;");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initial_schema",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    let db_reconciler_plugin =
        tauri::plugin::Builder::<tauri::Wry, ()>::new("db-migration-reconciler")
            .setup(|app, _api| {
                reconcile_existing_database(app);
                Ok(())
            })
            .build();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(crate::core::state::AppState::new())
        .plugin(db_reconciler_plugin)
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:personal-os-v2.db", migrations)
                .build(),
        )
        .manage(commands::file_cmd::WatcherState::new())
        .manage(std::sync::Mutex::new(commands::system_cmd::SystemMonitorState::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let default_size = tauri::Size::Physical(tauri::PhysicalSize {
                    width: 1600,
                    height: 900,
                });
                let min_size = tauri::Size::Physical(tauri::PhysicalSize {
                    width: 1280,
                    height: 720,
                });
                let _ = window.set_resizable(true);
                let _ = window.set_min_size(Some(min_size));
                let _ = window.set_max_size(None::<tauri::Size>);
                let _ = window.set_size(default_size);
                let scale = window.scale_factor().unwrap_or(1.0);
                if scale > 0.0 {
                    let _ = window.set_zoom(1.0 / scale);
                }
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }

            let _ = crate::services::fs_service::resolve_default_document_dir(&handle);

            tauri::async_runtime::spawn(async move {
                loop {
                    crate::core::db_jobs::run_background_cleanup(handle.clone()).await;
                    tokio::time::sleep(std::time::Duration::from_secs(12 * 60 * 60)).await;
                }
            });

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show Personal OS", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let icon = app.default_window_icon().cloned();
            let mut builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            let is_minimized = window.is_minimized().unwrap_or(false);
                            if is_visible && !is_minimized {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                });

            if let Some(i) = icon {
                builder = builder.icon(i);
            }

            builder.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::dialog_cmd::pick_folder,
            commands::dialog_cmd::get_default_document_dir,
            commands::file_cmd::upload_file_from_path,
            commands::file_cmd::upload_file,
            commands::file_cmd::move_file,
            commands::file_cmd::read_file,
            commands::file_cmd::delete_file,
            commands::file_cmd::soft_delete_file,
            commands::file_cmd::restore_file,
            commands::file_cmd::watch_directory,
            commands::file_cmd::list_directory_files,
            commands::file_cmd::open_in_os,
            commands::file_cmd::create_folder,
            commands::file_cmd::create_new_file,
            commands::vault_cmd::authenticate_os,
            commands::vault_cmd::get_vault_key,
            commands::vault_cmd::save_vault_key,
            commands::file_cmd::create_backup_zip,
            commands::file_cmd::extract_backup_zip_absolute,
            commands::file_cmd::inspect_backup_manifest,
            commands::file_cmd::get_dragged_items_contents,
            commands::file_cmd::cleanup_documents_trash,
            commands::file_cmd::empty_documents_trash,
            commands::file_cmd::scan_document_tree,
            commands::system_cmd::get_system_metrics
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run Tauri application");
}

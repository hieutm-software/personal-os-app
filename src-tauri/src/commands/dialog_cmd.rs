use crate::core::error::AppError;
use crate::services::fs_service;
use tauri::AppHandle;

#[tauri::command]
pub async fn pick_folder(default_path: Option<String>) -> Result<Option<String>, AppError> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(ref path) = default_path {
        let trimmed = path.trim();
        if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
            dialog = dialog.set_directory(trimmed);
        }
    }

    let folder = dialog.pick_folder().await;
    Ok(folder.map(|f| f.path().to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn get_default_document_dir(app: AppHandle) -> Result<String, AppError> {
    let p = fs_service::resolve_default_document_dir(&app)?;
    Ok(p.to_string_lossy().into_owned())
}

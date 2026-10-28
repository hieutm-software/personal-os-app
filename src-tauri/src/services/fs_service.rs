use crate::core::constants::DEFAULT_APP_FOLDER;
use crate::core::error::AppError;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn is_valid_platform_path(path_str: &str) -> bool {
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        if trimmed.starts_with('/') || trimmed.starts_with("\\home") {
            return false;
        }
        let bytes = trimmed.as_bytes();
        if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return true;
        }
        if trimmed.starts_with("\\\\") {
            return true;
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        let bytes = trimmed.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' {
            return false;
        }
        trimmed.starts_with('/')
    }
}

pub fn is_usable_platform_dir(path_str: &str) -> bool {
    let trimmed = path_str.trim();
    if !is_valid_platform_path(trimmed) {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        let bytes = trimmed.as_bytes();
        if bytes.len() >= 9 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            let prefix = &trimmed[2..9];
            if prefix.eq_ignore_ascii_case("\\users\\") || prefix.eq_ignore_ascii_case("/users/") {
                let rest = &trimmed[9..];
                let user_seg = rest.split(['/', '\\']).next().unwrap_or("");
                if !user_seg.is_empty() {
                    let drive_char = bytes[0] as char;
                    let user_home = PathBuf::from(format!("{}:\\Users\\{}", drive_char, user_seg));
                    if !user_home.exists() {
                        return false;
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(rest) = trimmed.strip_prefix("/home/") {
            let user_seg = rest.split('/').next().unwrap_or("");
            if !user_seg.is_empty() {
                let user_home = PathBuf::from(format!("/home/{}", user_seg));
                if !user_home.exists() {
                    return false;
                }
            }
        }
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.exists() {
        candidate.is_dir()
    } else {
        fs::create_dir_all(&candidate).is_ok()
    }
}

pub fn resolve_default_document_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Documents")))
        .or_else(|_| app.path().app_data_dir())?;
    let dir = base.join(DEFAULT_APP_FOLDER);
    let _ = fs::create_dir_all(&dir);
    let _ = fs::create_dir_all(dir.join("docs"));
    Ok(dir)
}

pub fn resolve_base_docs_dir(
    app: &AppHandle,
    custom_path: Option<&str>,
) -> Result<PathBuf, AppError> {
    let dir = if let Some(p) = custom_path {
        if is_usable_platform_dir(p) {
            PathBuf::from(p.trim())
        } else {
            resolve_default_document_dir(app)?
        }
    } else {
        resolve_default_document_dir(app)?
    };
    let _ = fs::create_dir_all(&dir);
    let _ = fs::create_dir_all(dir.join("docs"));
    Ok(dir)
}

pub fn sanitize_relative_path_str(raw_path: &str) -> Option<PathBuf> {
    let mut clean = PathBuf::new();

    for seg in raw_path.split(['/', '\\']) {
        let trimmed = seg.trim_matches('\0');
        if trimmed.is_empty() || trimmed == "." {
            continue;
        }
        if trimmed == ".." {
            return None;
        }

        #[cfg(target_os = "windows")]
        {
            let mut sanitized = String::with_capacity(trimmed.len());
            for c in trimmed.chars() {
                match c {
                    ':' | '*' | '?' | '"' | '<' | '>' | '|' => sanitized.push('_'),
                    c if c.is_control() => sanitized.push('_'),
                    _ => sanitized.push(c),
                }
            }
            while sanitized.ends_with(' ') || (sanitized.ends_with('.') && sanitized != ".keep" && sanitized != ".trash") {
                sanitized.pop();
            }
            if !sanitized.is_empty() {
                clean.push(sanitized);
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let mut sanitized = String::with_capacity(trimmed.len());
            for c in trimmed.chars() {
                if c.is_control() {
                    sanitized.push('_');
                } else {
                    sanitized.push(c);
                }
            }
            if !sanitized.is_empty() {
                clean.push(sanitized);
            }
        }
    }

    if clean.as_os_str().is_empty() {
        None
    } else {
        Some(clean)
    }
}

pub fn sanitize_relative_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    sanitize_relative_path_str(&s).unwrap_or_default()
}

pub fn strip_verbatim_prefix<P: AsRef<Path>>(path: P) -> PathBuf {
    let p = path.as_ref();
    #[cfg(target_os = "windows")]
    {
        let s = p.to_string_lossy();
        if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", stripped));
        }
        if let Some(stripped) = s.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    p.to_path_buf()
}

pub fn get_local_path(
    app: &AppHandle,
    target_path: &str,
    base_path: Option<&str>,
) -> Result<PathBuf, AppError> {
    let base = resolve_base_docs_dir(app, base_path)?;

    if !base.exists() {
        fs::create_dir_all(&base)?;
    }

    let canonical_base = base.canonicalize().unwrap_or(base);
    let relative_clean = sanitize_relative_path_str(target_path).unwrap_or_default();

    let full_path = canonical_base.join(relative_clean);
    if !full_path.starts_with(&canonical_base) {
        return Err(AppError::Unknown("Path traversal attempt detected".to_string()));
    }
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(strip_verbatim_prefix(full_path))
}

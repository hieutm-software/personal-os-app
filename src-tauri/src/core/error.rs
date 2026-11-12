use serde::Serialize;
use std::borrow::Cow;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Keyring error: {0}")]
    Keyring(String),
    #[error("Database error: {0}")]
    Database(String),
    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        #[derive(Serialize)]
        struct ErrorWrapper<'a> {
            error_type: &'a str,
            message: Cow<'a, str>,
        }

        let (error_type, message) = match self {
            AppError::Io(e) => ("Io", Cow::Owned(e.to_string())),
            AppError::Keyring(s) => ("Keyring", Cow::Borrowed(s.as_str())),
            AppError::Database(s) => ("Database", Cow::Borrowed(s.as_str())),
            AppError::Unknown(s) => ("Unknown", Cow::Borrowed(s.as_str())),
        };

        let wrapper = ErrorWrapper {
            error_type,
            message,
        };
        wrapper.serialize(serializer)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database(err.to_string())
    }
}

impl From<keyring::Error> for AppError {
    fn from(err: keyring::Error) -> Self {
        AppError::Keyring(err.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        AppError::Unknown(err.to_string())
    }
}

impl From<tokio::task::JoinError> for AppError {
    fn from(err: tokio::task::JoinError) -> Self {
        AppError::Unknown(err.to_string())
    }
}

impl From<std::string::FromUtf8Error> for AppError {
    fn from(err: std::string::FromUtf8Error) -> Self {
        AppError::Unknown(err.to_string())
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(err: zip::result::ZipError) -> Self {
        AppError::Unknown(err.to_string())
    }
}

impl From<trash::Error> for AppError {
    fn from(err: trash::Error) -> Self {
        AppError::Unknown(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Unknown(err.to_string())
    }
}

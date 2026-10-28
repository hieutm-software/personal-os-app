use crate::core::error::AppError;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use std::fs::File;
use std::io::Read;
use std::path::Path;

pub const POSB_MAGIC: &[u8; 4] = b"POSB";
pub const POSB_VERSION: u8 = 1;
pub const POSB_KDF_ARGON2ID: u8 = 1;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const HEADER_LEN: usize = 4 + 1 + 1 + SALT_LEN + NONCE_LEN; // 34 bytes

#[derive(Debug, PartialEq, Eq)]
pub enum BackupFormat {
    EncryptedPosb {
        version: u8,
        kdf: u8,
        salt: [u8; SALT_LEN],
        nonce: [u8; NONCE_LEN],
    },
    LegacyZip,
    Unknown,
}

pub fn detect_backup_format<P: AsRef<Path>>(path: P) -> Result<BackupFormat, AppError> {
    let mut file = File::open(path)?;
    let mut magic = [0u8; 4];
    let n = file.read(&mut magic)?;
    if n < 4 {
        return Ok(BackupFormat::Unknown);
    }
    if &magic == POSB_MAGIC {
        let mut header_rest = [0u8; 1 + 1 + SALT_LEN + NONCE_LEN];
        file.read_exact(&mut header_rest)?;
        let version = header_rest[0];
        let kdf = header_rest[1];
        let mut salt = [0u8; SALT_LEN];
        salt.copy_from_slice(&header_rest[2..2 + SALT_LEN]);
        let mut nonce = [0u8; NONCE_LEN];
        nonce.copy_from_slice(&header_rest[2 + SALT_LEN..2 + SALT_LEN + NONCE_LEN]);
        Ok(BackupFormat::EncryptedPosb {
            version,
            kdf,
            salt,
            nonce,
        })
    } else if &magic == b"PK\x03\x04" {
        Ok(BackupFormat::LegacyZip)
    } else {
        Ok(BackupFormat::Unknown)
    }
}

pub fn derive_key(password: &str, salt: &[u8; SALT_LEN]) -> Result<[u8; 32], AppError> {
    // 32 MB RAM, 3 iterations, 1 parallelism, 32-byte key
    let params = Params::new(32768, 3, 1, Some(32))
        .map_err(|e| AppError::Unknown(format!("Argon2 params error: {}", e)))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Unknown(format!("Key derivation failed: {}", e)))?;
    Ok(key)
}

pub fn encrypt_bytes_to_posb(payload: &[u8], password: &str) -> Result<Vec<u8>, AppError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    let mut rng = rand::rngs::OsRng;
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, payload)
        .map_err(|e| AppError::Unknown(format!("Encryption error: {}", e)))?;

    let mut output = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    output.extend_from_slice(POSB_MAGIC);
    output.push(POSB_VERSION);
    output.push(POSB_KDF_ARGON2ID);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(output)
}

pub fn decrypt_posb_bytes(encrypted: &[u8], password: &str) -> Result<Vec<u8>, AppError> {
    if encrypted.len() < HEADER_LEN {
        return Err(AppError::Unknown("Invalid backup file: header too short".to_string()));
    }
    if &encrypted[0..4] != POSB_MAGIC {
        return Err(AppError::Unknown("INVALID_BACKUP_FORMAT".to_string()));
    }
    let version = encrypted[4];
    if version != POSB_VERSION {
        return Err(AppError::Unknown(format!("Unsupported backup version: {}", version)));
    }
    let kdf = encrypted[5];
    if kdf != POSB_KDF_ARGON2ID {
        return Err(AppError::Unknown(format!("Unsupported KDF algorithm: {}", kdf)));
    }

    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&encrypted[6..6 + SALT_LEN]);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    nonce_bytes.copy_from_slice(&encrypted[6 + SALT_LEN..HEADER_LEN]);

    let ciphertext = &encrypted[HEADER_LEN..];

    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new((&key).into());
    let nonce = Nonce::from_slice(&nonce_bytes);

    let decrypted = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Unknown("INVALID_BACKUP_PASSWORD".to_string()))?;

    Ok(decrypted)
}

pub fn encrypt_file_to_posb<P1: AsRef<Path>, P2: AsRef<Path>>(
    src_plain_path: P1,
    dst_posb_path: P2,
    password: &str,
) -> Result<(), AppError> {
    let payload = std::fs::read(src_plain_path.as_ref())?;
    let encrypted = encrypt_bytes_to_posb(&payload, password)?;
    if let Some(parent) = dst_posb_path.as_ref().parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(dst_posb_path.as_ref(), encrypted)?;
    Ok(())
}

pub fn decrypt_posb_to_file<P1: AsRef<Path>, P2: AsRef<Path>>(
    src_posb_path: P1,
    dst_plain_path: P2,
    password: &str,
) -> Result<(), AppError> {
    let encrypted = std::fs::read(src_posb_path.as_ref())?;
    let decrypted = decrypt_posb_bytes(&encrypted, password)?;
    if let Some(parent) = dst_plain_path.as_ref().parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(dst_plain_path.as_ref(), decrypted)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_posb_encrypt_decrypt_roundtrip() {
        let secret_data = b"Hello Personal OS Secure Backup! 1234567890";
        let password = "SuperSecretPassword#2026";

        let encrypted = encrypt_bytes_to_posb(secret_data, password).expect("encryption succeeds");
        assert_eq!(&encrypted[0..4], POSB_MAGIC);
        assert_eq!(encrypted[4], POSB_VERSION);
        assert_eq!(encrypted[5], POSB_KDF_ARGON2ID);
        assert!(encrypted.len() > secret_data.len() + HEADER_LEN);

        // Correct password
        let decrypted = decrypt_posb_bytes(&encrypted, password).expect("decryption succeeds");
        assert_eq!(decrypted, secret_data);

        // Wrong password fails immediately with INVALID_BACKUP_PASSWORD
        let wrong_res = decrypt_posb_bytes(&encrypted, "WrongPassword!");
        assert!(wrong_res.is_err());
        let err_str = wrong_res.unwrap_err().to_string();
        assert!(err_str.contains("INVALID_BACKUP_PASSWORD"));
    }

    #[test]
    fn test_detect_format() {
        let temp_dir = std::env::temp_dir();
        let posb_path = temp_dir.join("test_detect.posb");
        let zip_path = temp_dir.join("test_detect.zip");

        let encrypted = encrypt_bytes_to_posb(b"data", "pass").unwrap();
        std::fs::write(&posb_path, encrypted).unwrap();

        std::fs::write(&zip_path, b"PK\x03\x04dummyzipcontent").unwrap();

        assert!(matches!(
            detect_backup_format(&posb_path).unwrap(),
            BackupFormat::EncryptedPosb { .. }
        ));

        assert!(matches!(
            detect_backup_format(&zip_path).unwrap(),
            BackupFormat::LegacyZip
        ));

        let _ = std::fs::remove_file(posb_path);
        let _ = std::fs::remove_file(zip_path);
    }

    #[test]
    fn test_tamper_detection_and_integrity() {
        let secret = b"Integrity check payload for Personal OS";
        let password = "IntegrityPassword@2026";
        let mut encrypted = encrypt_bytes_to_posb(secret, password).unwrap();

        // Tamper with a byte in the payload
        let last_idx = encrypted.len() - 1;
        encrypted[last_idx] ^= 0xFF;

        let res = decrypt_posb_bytes(&encrypted, password);
        assert!(res.is_err(), "Tampered backup must be rejected by AEAD auth tag");
        let err_msg = res.unwrap_err().to_string();
        assert!(err_msg.contains("INVALID_BACKUP_PASSWORD"));
    }
}

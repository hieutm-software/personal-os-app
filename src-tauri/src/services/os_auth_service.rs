use crate::core::constants::{KEYRING_VAULT_SERVICE, KEYRING_VAULT_USER};
use crate::core::error::AppError;
use keyring::Entry;
use std::fs;
use tauri::{AppHandle, Manager};

pub fn save_vault_key(app: &AppHandle, key: &str) -> Result<(), AppError> {
    let clean_key = key.trim();
    if clean_key.is_empty() {
        return Err(AppError::Unknown("Vault key cannot be empty".to_string()));
    }

    if let Ok(entry) = Entry::new(KEYRING_VAULT_SERVICE, KEYRING_VAULT_USER) {
        let _ = entry.set_password(clean_key);
    }

    let cfg_dir = app.path().app_config_dir()?;
    let _ = fs::create_dir_all(&cfg_dir);
    let file_path = cfg_dir.join(".vault_key");
    fs::write(&file_path, clean_key)?;

    if let Ok(data_dir) = app.path().app_data_dir() {
        let data_file = data_dir.join(".vault_key");
        if data_file != file_path && data_file.exists() {
            let _ = fs::write(&data_file, clean_key);
        }
    }
    Ok(())
}

pub fn get_vault_key(app: &AppHandle) -> Result<String, AppError> {
    let cfg_dir = app.path().app_config_dir()?;
    let file_path = cfg_dir.join(".vault_key");

    if file_path.exists() {
        if let Ok(raw) = fs::read_to_string(&file_path) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                let secret = trimmed.to_string();
                if let Ok(entry) = Entry::new(KEYRING_VAULT_SERVICE, KEYRING_VAULT_USER) {
                    let _ = entry.set_password(&secret);
                }
                return Ok(secret);
            }
        }
    }

    if let Ok(data_dir) = app.path().app_data_dir() {
        let df = data_dir.join(".vault_key");
        if df.exists() {
            if let Ok(raw) = fs::read_to_string(&df) {
                let trimmed = raw.trim();
                if !trimmed.is_empty() {
                    let secret = trimmed.to_string();
                    let _ = fs::create_dir_all(&cfg_dir);
                    let _ = fs::write(&file_path, &secret);
                    if let Ok(entry) = Entry::new(KEYRING_VAULT_SERVICE, KEYRING_VAULT_USER) {
                        let _ = entry.set_password(&secret);
                    }
                    return Ok(secret);
                }
            }
        }
    }

    if let Ok(entry) = Entry::new(KEYRING_VAULT_SERVICE, KEYRING_VAULT_USER) {
        if let Ok(raw) = entry.get_password() {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                let secret = trimmed.to_string();
                let _ = fs::create_dir_all(&cfg_dir);
                let _ = fs::write(&file_path, &secret);
                return Ok(secret);
            }
        }
    }

    let new_key = uuid::Uuid::new_v4().to_string();
    if let Ok(entry) = Entry::new(KEYRING_VAULT_SERVICE, KEYRING_VAULT_USER) {
        let _ = entry.set_password(&new_key);
    }
    let _ = fs::create_dir_all(&cfg_dir);
    fs::write(&file_path, &new_key)?;
    Ok(new_key)
}

pub fn authenticate_os(_reason: &str) -> Result<bool, AppError> {
    #[cfg(target_os = "linux")]
    {
        let status = std::process::Command::new("pkexec")
            .arg("true")
            .status()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
        Ok(status.success())
    }

    #[cfg(target_os = "macos")]
    {
        let safe_reason = _reason.replace('\"', "\\\"");
        let script = format!(
            "do shell script \"echo true\" with prompt \"{}\" with administrator privileges",
            safe_reason
        );
        let status = std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .status()
            .map_err(|e| AppError::Unknown(e.to_string()))?;
        return Ok(status.success());
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;

        #[repr(C)]
        struct CREDUI_INFOW {
            cb_size: u32,
            hwnd_parent: *mut std::ffi::c_void,
            message_text: *const u16,
            caption_text: *const u16,
            hbm_banner: *mut std::ffi::c_void,
        }

        const CREDUIWIN_GENERIC: u32 = 0x00000001;
        const CREDUIWIN_IN_CRED_ONLY: u32 = 0x00000020;
        const CREDUIWIN_ENUMERATE_CURRENT_USER: u32 = 0x00000200;
        const ERROR_SUCCESS: u32 = 0;
        const ERROR_LOGON_FAILURE: u32 = 1326;
        const LOGON32_LOGON_INTERACTIVE: u32 = 2;
        const LOGON32_LOGON_NETWORK: u32 = 3;
        const LOGON32_PROVIDER_DEFAULT: u32 = 0;

        #[link(name = "credui")]
        extern "system" {
            fn CredPackAuthenticationBufferW(
                dwFlags: u32,
                pszUserName: *const u16,
                pszPassword: *const u16,
                pPackedCredentials: *mut u8,
                pcbPackedCredentials: *mut u32,
            ) -> i32;

            fn CredUIPromptForWindowsCredentialsW(
                pUiInfo: *mut CREDUI_INFOW,
                dwAuthError: u32,
                pulAuthPackage: *mut u32,
                pvInAuthBuffer: *const std::ffi::c_void,
                ulInAuthBufferSize: u32,
                ppvOutAuthBuffer: *mut *mut std::ffi::c_void,
                pulOutAuthBufferSize: *mut u32,
                pfSave: *mut i32,
                dwFlags: u32,
            ) -> u32;

            fn CredUnPackAuthenticationBufferW(
                dwFlags: u32,
                pAuthBuffer: *const std::ffi::c_void,
                cbAuthBuffer: u32,
                pszUserName: *mut u16,
                pcchMaxUserName: *mut u32,
                pszDomainName: *mut u16,
                pcchMaxDomainName: *mut u32,
                pszPassword: *mut u16,
                pcchMaxPassword: *mut u32,
            ) -> i32;
        }

        #[link(name = "ole32")]
        extern "system" {
            fn CoTaskMemFree(pv: *mut std::ffi::c_void);
        }

        #[link(name = "advapi32")]
        extern "system" {
            fn GetUserNameW(lpBuffer: *mut u16, pcbBuffer: *mut u32) -> i32;

            fn LogonUserW(
                lpszUsername: *const u16,
                lpszDomain: *const u16,
                lpszPassword: *const u16,
                dwLogonType: u32,
                dwLogonProvider: u32,
                phToken: *mut *mut std::ffi::c_void,
            ) -> i32;
        }

        #[link(name = "kernel32")]
        extern "system" {
            fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
        }

        let username_str = std::env::var("USERNAME").unwrap_or_else(|_| {
            let mut name_buf = [0u16; 256];
            let mut name_len = name_buf.len() as u32;
            // SAFETY: name_buf is valid for name_len u16 elements.
            if unsafe { GetUserNameW(name_buf.as_mut_ptr(), &mut name_len) } != 0 && name_len > 1 {
                String::from_utf16_lossy(&name_buf[..(name_len as usize - 1)])
            } else {
                "User".to_string()
            }
        });

        let to_wide_null = |s: &str| -> Vec<u16> {
            let mut v = Vec::with_capacity(s.len() + 1);
            v.extend(OsStr::new(s).encode_wide());
            v.push(0);
            v
        };

        let username_wide = to_wide_null(&username_str);
        let empty_pw: [u16; 1] = [0];

        let mut in_buf_size: u32 = 0;
        // SAFETY: Calling CredPackAuthenticationBufferW with null buffer to query required buffer size.
        unsafe {
            CredPackAuthenticationBufferW(
                0,
                username_wide.as_ptr(),
                empty_pw.as_ptr(),
                ptr::null_mut(),
                &mut in_buf_size,
            );
        }

        let mut in_buffer = vec![0u8; in_buf_size as usize];
        let packed_ok = if in_buf_size > 0 {
            // SAFETY: in_buffer has been allocated with at least in_buf_size bytes, and username_wide/empty_pw are valid null-terminated UTF-16 strings.
            unsafe {
                CredPackAuthenticationBufferW(
                    0,
                    username_wide.as_ptr(),
                    empty_pw.as_ptr(),
                    in_buffer.as_mut_ptr(),
                    &mut in_buf_size,
                ) != 0
            }
        } else {
            false
        };

        let caption = to_wide_null("Personal OS - Unlock Vault");
        let prompt_message = if _reason.trim().is_empty() {
            "Please enter your Windows password to unlock the Vault.".to_string()
        } else {
            format!("{}. Please enter your Windows password.", _reason)
        };
        let message = to_wide_null(&prompt_message);

        let mut ui_info = CREDUI_INFOW {
            cb_size: std::mem::size_of::<CREDUI_INFOW>() as u32,
            hwnd_parent: ptr::null_mut(),
            message_text: message.as_ptr(),
            caption_text: caption.as_ptr(),
            hbm_banner: ptr::null_mut(),
        };

        let local_dot: [u16; 2] = [b'.' as u16, 0];
        let mut auth_error: u32 = 0;

        for _ in 0..3 {
            let mut auth_package: u32 = 0;
            let mut out_buffer: *mut std::ffi::c_void = ptr::null_mut();
            let mut out_buffer_size: u32 = 0;
            let mut save: i32 = 0;

            let (in_ptr, in_size, dw_flags) = if packed_ok {
                (
                    in_buffer.as_ptr() as *const std::ffi::c_void,
                    in_buf_size,
                    CREDUIWIN_GENERIC | CREDUIWIN_IN_CRED_ONLY,
                )
            } else {
                (
                    ptr::null(),
                    0,
                    CREDUIWIN_GENERIC | CREDUIWIN_ENUMERATE_CURRENT_USER,
                )
            };

            // SAFETY: UI info and pointers are properly initialized, and out_buffer is managed by CoTaskMemFree upon return.
            let result = unsafe {
                CredUIPromptForWindowsCredentialsW(
                    &mut ui_info,
                    auth_error,
                    &mut auth_package,
                    in_ptr,
                    in_size,
                    &mut out_buffer,
                    &mut out_buffer_size,
                    &mut save,
                    dw_flags,
                )
            };

            if result != ERROR_SUCCESS {
                in_buffer.fill(0);
                return Ok(false);
            }

            let mut user_buf = [0u16; 512];
            let mut user_len = user_buf.len() as u32;
            let mut domain_buf = [0u16; 512];
            let mut domain_len = domain_buf.len() as u32;
            let mut pass_buf = [0u16; 512];
            let mut pass_len = pass_buf.len() as u32;

            // SAFETY: out_buffer contains credentials packed by Windows; destination buffers are fixed at 512 elements each.
            let unpack_ok = unsafe {
                CredUnPackAuthenticationBufferW(
                    0,
                    out_buffer,
                    out_buffer_size,
                    user_buf.as_mut_ptr(),
                    &mut user_len,
                    domain_buf.as_mut_ptr(),
                    &mut domain_len,
                    pass_buf.as_mut_ptr(),
                    &mut pass_len,
                )
            };

            // SAFETY: Wiping sensitive credential buffer in place before releasing CoTaskMem allocated by CredUIPrompt.
            unsafe {
                if !out_buffer.is_null() {
                    ptr::write_bytes(out_buffer as *mut u8, 0, out_buffer_size as usize);
                    CoTaskMemFree(out_buffer);
                }
            }

            if unpack_ok == 0 {
                pass_buf.fill(0);
                user_buf.fill(0);
                domain_buf.fill(0);
                in_buffer.fill(0);
                return Ok(false);
            }

            let mut token: *mut std::ffi::c_void = ptr::null_mut();
            let domain_ptr = if domain_buf[0] != 0 {
                domain_buf.as_ptr()
            } else {
                ptr::null()
            };

            // SAFETY: Strings are null-terminated wide strings and token is an output handle pointer.
            let mut logon_ok = unsafe {
                LogonUserW(
                    user_buf.as_ptr(),
                    domain_ptr,
                    pass_buf.as_ptr(),
                    LOGON32_LOGON_INTERACTIVE,
                    LOGON32_PROVIDER_DEFAULT,
                    &mut token,
                )
            };

            if logon_ok == 0 {
                // SAFETY: Fallback logon attempt with local domain dot.
                logon_ok = unsafe {
                    LogonUserW(
                        user_buf.as_ptr(),
                        local_dot.as_ptr(),
                        pass_buf.as_ptr(),
                        LOGON32_LOGON_INTERACTIVE,
                        LOGON32_PROVIDER_DEFAULT,
                        &mut token,
                    )
                };
            }

            if logon_ok == 0 {
                // SAFETY: Fallback logon attempt using network logon provider.
                logon_ok = unsafe {
                    LogonUserW(
                        user_buf.as_ptr(),
                        domain_ptr,
                        pass_buf.as_ptr(),
                        LOGON32_LOGON_NETWORK,
                        LOGON32_PROVIDER_DEFAULT,
                        &mut token,
                    )
                };
            }

            if logon_ok == 0 {
                // SAFETY: Fallback logon attempt using network logon with local domain dot.
                logon_ok = unsafe {
                    LogonUserW(
                        user_buf.as_ptr(),
                        local_dot.as_ptr(),
                        pass_buf.as_ptr(),
                        LOGON32_LOGON_NETWORK,
                        LOGON32_PROVIDER_DEFAULT,
                        &mut token,
                    )
                };
            }

            pass_buf.fill(0);
            user_buf.fill(0);
            domain_buf.fill(0);

            if logon_ok != 0 && !token.is_null() {
                // SAFETY: CloseHandle called on successfully retrieved valid user logon token.
                unsafe {
                    CloseHandle(token);
                }
                in_buffer.fill(0);
                return Ok(true);
            }

            auth_error = ERROR_LOGON_FAILURE;
        }

        in_buffer.fill(0);
        Ok(false)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Ok(true)
    }
}

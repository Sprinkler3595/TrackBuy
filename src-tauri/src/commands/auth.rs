use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, State};
use zeroize::Zeroizing;

use crate::crypto::{self, Argon2Params};
use crate::db::{models::VaultInfo, Database};

pub struct AppState {
    pub db: Mutex<Option<Database>>,
    pub vault_dir: Mutex<Option<PathBuf>>,
    pub encryption_key: Mutex<Option<Zeroizing<[u8; 32]>>>,
    pub active_vault: Mutex<String>,
    pub unlock_attempts: Mutex<HashMap<String, AttemptState>>,
}

#[derive(Debug, Clone)]
pub struct AttemptState {
    pub failures: u32,
    pub locked_until: Option<Instant>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            db: Mutex::new(None),
            vault_dir: Mutex::new(None),
            encryption_key: Mutex::new(None),
            active_vault: Mutex::new("Maison".to_string()),
            unlock_attempts: Mutex::new(HashMap::new()),
        }
    }
}

pub fn get_vaults_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data.join("vaults"))
}

fn get_vault_path(app: &tauri::AppHandle, vault_name: &str) -> Result<PathBuf, String> {
    if vault_name.is_empty()
        || vault_name.contains('/')
        || vault_name.contains('\\')
        || vault_name.contains("..")
        || vault_name.starts_with('.')
    {
        return Err("Nom de coffre invalide".to_string());
    }
    Ok(get_vaults_dir(app)?.join(vault_name))
}

fn read_salt(vault_dir: &PathBuf) -> Result<[u8; 16], String> {
    let salt_bytes = std::fs::read(vault_dir.join("salt.bin"))
        .map_err(|e| format!("Failed to read salt: {}", e))?;
    salt_bytes
        .try_into()
        .map_err(|_| "Invalid salt file".to_string())
}

fn params_path(vault_dir: &PathBuf) -> PathBuf {
    vault_dir.join("argon2_params.json")
}

fn read_params(vault_dir: &PathBuf) -> Argon2Params {
    let path = params_path(vault_dir);
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Argon2Params>(&bytes).ok())
        .unwrap_or(Argon2Params {
            // Legacy fallback for vaults created before per-vault Argon2 params
            // were persisted (OWASP minimum: m=19456 KiB, t=2, p=1, v=0x13).
            m_cost_kib: 19_456,
            t_cost: 2,
            p_cost: 1,
            version: 0x13,
        })
}

fn write_params(vault_dir: &PathBuf, params: &Argon2Params) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(params).map_err(|e| e.to_string())?;
    std::fs::write(params_path(vault_dir), &json)
        .map_err(|e| format!("Failed to save params: {}", e))?;
    Ok(())
}

// ---- Rate-limit ----------------------------------------------------------

const FAILURES_BEFORE_LOCK: u32 = 5;
const BASE_LOCK_SECS: u64 = 5;
const MAX_LOCK_SECS: u64 = 300; // 5 min

fn check_locked(state: &State<'_, AppState>, vault_name: &str) -> Result<(), String> {
    let map = state
        .unlock_attempts
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    if let Some(att) = map.get(vault_name) {
        if let Some(until) = att.locked_until {
            let now = Instant::now();
            if now < until {
                let remaining = (until - now).as_secs() + 1;
                return Err(format!(
                    "Trop de tentatives. Attendez {} seconde(s).",
                    remaining
                ));
            }
        }
    }
    Ok(())
}

fn record_failure(state: &State<'_, AppState>, vault_name: &str) {
    if let Ok(mut map) = state.unlock_attempts.lock() {
        let entry = map.entry(vault_name.to_string()).or_insert(AttemptState {
            failures: 0,
            locked_until: None,
        });
        entry.failures = entry.failures.saturating_add(1);
        if entry.failures >= FAILURES_BEFORE_LOCK {
            let over = entry.failures - FAILURES_BEFORE_LOCK;
            let secs = BASE_LOCK_SECS
                .saturating_mul(1u64 << over.min(6)) // cap exponent
                .min(MAX_LOCK_SECS);
            entry.locked_until = Some(Instant::now() + Duration::from_secs(secs));
        }
    }
}

fn record_success(state: &State<'_, AppState>, vault_name: &str) {
    if let Ok(mut map) = state.unlock_attempts.lock() {
        map.remove(vault_name);
    }
}

// ---- Commands ------------------------------------------------------------

#[tauri::command]
pub fn check_vault_exists(app: tauri::AppHandle, vault_name: Option<String>) -> Result<bool, String> {
    let name = vault_name.unwrap_or_else(|| "Maison".to_string());
    let vault_dir = get_vault_path(&app, &name)?;
    Ok(vault_dir.join("vault.db").exists() || vault_dir.join("salt.bin").exists())
}

#[tauri::command]
pub fn create_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    vault_name: String,
    password: String,
) -> Result<(), String> {
    // Zeroize the password as soon as we're done with it.
    let password = Zeroizing::new(password);

    let vault_dir = get_vault_path(&app, &vault_name)?;
    if vault_dir.join("vault.db").exists() {
        return Err("Ce coffre existe déjà".to_string());
    }

    std::fs::create_dir_all(&vault_dir)
        .map_err(|e| format!("Failed to create vault dir: {}", e))?;

    let salt = crypto::generate_salt();
    let params = Argon2Params::default();
    write_params(&vault_dir, &params)?;
    std::fs::write(vault_dir.join("salt.bin"), &salt)
        .map_err(|e| format!("Failed to save salt: {}", e))?;
    std::fs::create_dir_all(vault_dir.join("files"))
        .map_err(|e| format!("Failed to create files dir: {}", e))?;

    let key = crypto::derive_key(&password, &salt, &params)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    let db = Database::open(&vault_dir, &key)?;

    set_state(&state, db, vault_dir, key, vault_name)
}

#[tauri::command]
pub fn unlock_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    vault_name: String,
    password: String,
) -> Result<(), String> {
    let password = Zeroizing::new(password);

    check_locked(&state, &vault_name)?;

    let vault_dir = get_vault_path(&app, &vault_name)?;
    let salt = read_salt(&vault_dir)?;
    let params = read_params(&vault_dir);
    let key = crypto::derive_key(&password, &salt, &params)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    let db = match Database::open(&vault_dir, &key) {
        Ok(db) => db,
        Err(e) => {
            // Wrong-password failures (and only those) feed the rate-limiter.
            if e.contains("Mot de passe incorrect") {
                record_failure(&state, &vault_name);
            }
            return Err(e);
        }
    };

    record_success(&state, &vault_name);
    set_state(&state, db, vault_dir, key, vault_name)
}

fn set_state(
    state: &State<'_, AppState>,
    db: Database,
    vault_dir: PathBuf,
    key: Zeroizing<[u8; 32]>,
    vault_name: String,
) -> Result<(), String> {
    *state
        .db
        .lock()
        .map_err(|_| "lock poisoned".to_string())? = Some(db);
    *state
        .vault_dir
        .lock()
        .map_err(|_| "lock poisoned".to_string())? = Some(vault_dir);
    *state
        .encryption_key
        .lock()
        .map_err(|_| "lock poisoned".to_string())? = Some(key);
    *state
        .active_vault
        .lock()
        .map_err(|_| "lock poisoned".to_string())? = vault_name;
    Ok(())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> Result<(), String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .take();
    if let Some(db) = db {
        db.close().ok();
        drop(db);
    }
    *state
        .vault_dir
        .lock()
        .map_err(|_| "lock poisoned".to_string())? = None;
    // Zeroizing's Drop wipes the key automatically when the Option is replaced.
    *state
        .encryption_key
        .lock()
        .map_err(|_| "lock poisoned".to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn list_vaults(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<VaultInfo>, String> {
    let vaults_dir = get_vaults_dir(&app)?;
    let active = state
        .active_vault
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .clone();

    let mut vaults = Vec::new();
    if vaults_dir.exists() {
        for entry in std::fs::read_dir(&vaults_dir)
            .map_err(|e| format!("Failed to read vaults directory: {}", e))?
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();
            if path.is_dir()
                && (path.join("vault.db").exists() || path.join("data.db.enc").exists())
            {
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                vaults.push(VaultInfo {
                    is_active: name == active,
                    name,
                    path: path.to_string_lossy().to_string(),
                    created_at: None,
                });
            }
        }
    }

    Ok(vaults)
}

#[derive(Debug, serde::Serialize)]
pub struct VaultLocation {
    pub vault_name: String,
    pub vault_dir: String,
    pub db_file: String,
    pub attachments_dir: String,
    pub db_size_bytes: u64,
}

#[tauri::command]
pub fn get_active_vault_location(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<VaultLocation, String> {
    let vault_dir_guard = state
        .vault_dir
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir_guard
        .as_ref()
        .ok_or("Aucun coffre actif")?
        .clone();
    drop(vault_dir_guard);

    let vault_name = state
        .active_vault
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .clone();

    // Resolve to an absolute path, falling back to the original if canonicalize fails
    // (e.g., path doesn't exist on disk yet for some reason).
    let abs_dir = std::fs::canonicalize(&vault_dir).unwrap_or_else(|_| vault_dir.clone());
    let db_path = abs_dir.join("vault.db");
    let files_dir = abs_dir.join("files");

    let db_size_bytes = std::fs::metadata(&db_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // app is only used to ensure the AppHandle import stays valid for future needs.
    let _ = app;

    Ok(VaultLocation {
        vault_name,
        vault_dir: abs_dir.to_string_lossy().to_string(),
        db_file: db_path.to_string_lossy().to_string(),
        attachments_dir: files_dir.to_string_lossy().to_string(),
        db_size_bytes,
    })
}

#[tauri::command]
pub fn open_active_vault_folder(state: State<'_, AppState>) -> Result<(), String> {
    let vault_dir = state
        .vault_dir
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .as_ref()
        .ok_or("Aucun coffre actif")?
        .clone();

    let abs = std::fs::canonicalize(&vault_dir).unwrap_or(vault_dir);

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&abs).status();

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&abs).status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&abs).status();

    let status = result.map_err(|e| format!("Failed to launch file manager: {}", e))?;
    if !status.success() {
        return Err(format!("File manager exited with status {}", status));
    }
    Ok(())
}

#[tauri::command]
pub fn switch_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    vault_name: String,
    password: String,
) -> Result<(), String> {
    lock_vault(state.clone())?;
    unlock_vault(app, state, vault_name, password)
}

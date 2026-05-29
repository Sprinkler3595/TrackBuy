use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AttemptState {
    pub failures: u32,
    /// Unix epoch seconds at which the lock expires. None = not locked.
    /// SystemTime (not Instant) so the cooldown survives a process restart —
    /// without persistence, an attacker can defeat the rate-limit by simply
    /// killing the app between attempts.
    #[serde(default)]
    pub locked_until_epoch: Option<u64>,
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

fn read_params(vault_dir: &PathBuf) -> Result<Argon2Params, String> {
    let path = params_path(vault_dir);
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<Argon2Params>(&bytes).map_err(|e| {
            format!(
                "Paramètres Argon2id corrompus dans {}: {}. \
                 Restaurez ce fichier depuis une sauvegarde — sans lui, \
                 la clé dérivée ne correspondra pas et le coffre est irrécupérable.",
                path.display(),
                e
            )
        }),
        // Only the absent-file case falls back to legacy OWASP defaults,
        // for vaults created before per-vault Argon2 params were persisted.
        Err(ref e) if e.kind() == io::ErrorKind::NotFound => Ok(Argon2Params {
            m_cost_kib: 19_456,
            t_cost: 2,
            p_cost: 1,
            version: 0x13,
        }),
        Err(e) => Err(format!("Impossible de lire {}: {}", path.display(), e)),
    }
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
const ATTEMPTS_FILE: &str = "attempts.json";

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn attempts_path(app: &tauri::AppHandle, vault_name: &str) -> Result<PathBuf, String> {
    Ok(get_vault_path(app, vault_name)?.join(ATTEMPTS_FILE))
}

fn load_attempts(app: &tauri::AppHandle, vault_name: &str) -> AttemptState {
    let path = match attempts_path(app, vault_name) {
        Ok(p) => p,
        Err(_) => {
            return AttemptState {
                failures: 0,
                locked_until_epoch: None,
            }
        }
    };
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<AttemptState>(&bytes).ok())
        .unwrap_or(AttemptState {
            failures: 0,
            locked_until_epoch: None,
        })
}

fn save_attempts(app: &tauri::AppHandle, vault_name: &str, att: &AttemptState) {
    let path = match attempts_path(app, vault_name) {
        Ok(p) => p,
        Err(_) => return,
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(att) {
        let _ = std::fs::write(&path, &bytes);
    }
}

fn clear_attempts(app: &tauri::AppHandle, vault_name: &str) {
    if let Ok(path) = attempts_path(app, vault_name) {
        let _ = std::fs::remove_file(&path);
    }
}

fn check_locked(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    vault_name: &str,
) -> Result<(), String> {
    // Mirror disk state into memory for in-process callers that still read it.
    let on_disk = load_attempts(app, vault_name);
    {
        let mut map = state
            .unlock_attempts
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        map.insert(vault_name.to_string(), on_disk.clone());
    }
    if let Some(until) = on_disk.locked_until_epoch {
        let now = now_epoch();
        if now < until {
            let remaining = until - now + 1;
            return Err(format!(
                "Trop de tentatives. Attendez {} seconde(s).",
                remaining
            ));
        }
    }
    Ok(())
}

fn record_failure(app: &tauri::AppHandle, state: &State<'_, AppState>, vault_name: &str) {
    let mut current = load_attempts(app, vault_name);
    current.failures = current.failures.saturating_add(1);
    if current.failures >= FAILURES_BEFORE_LOCK {
        let over = current.failures - FAILURES_BEFORE_LOCK;
        let secs = BASE_LOCK_SECS
            .saturating_mul(1u64 << over.min(6)) // cap exponent
            .min(MAX_LOCK_SECS);
        current.locked_until_epoch =
            Some(now_epoch() + Duration::from_secs(secs).as_secs());
    }
    save_attempts(app, vault_name, &current);
    if let Ok(mut map) = state.unlock_attempts.lock() {
        map.insert(vault_name.to_string(), current);
    }
}

fn record_success(app: &tauri::AppHandle, state: &State<'_, AppState>, vault_name: &str) {
    clear_attempts(app, vault_name);
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

    check_locked(&app, &state, &vault_name)?;

    let vault_dir = get_vault_path(&app, &vault_name)?;
    // Termine/annule une éventuelle rotation de mot de passe interrompue avant
    // de lire le sel : sinon on dériverait avec un sel/params incohérents.
    recover_pending_rekey(&vault_dir);
    let salt = read_salt(&vault_dir)?;
    let params = read_params(&vault_dir)?;
    let key = crypto::derive_key(&password, &salt, &params)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    let db = match Database::open(&vault_dir, &key) {
        Ok(db) => db,
        Err(e) => {
            // Wrong-password failures (and only those) feed the rate-limiter.
            if e.contains("Mot de passe incorrect") {
                record_failure(&app, &state, &vault_name);
            }
            return Err(e);
        }
    };

    record_success(&app, &state, &vault_name);
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

// ---- Rotation du mot de passe maître -------------------------------------
//
// La clé dérivée sert À LA FOIS de clé SQLCipher (vault.db) ET de clé
// ChaCha20-Poly1305 pour les pièces jointes (files/*.enc). Une rotation doit
// donc, de façon cohérente : re-dériver une clé (nouveau sel + params),
// `PRAGMA rekey` la base, ET re-chiffrer TOUS les fichiers de pièces jointes.
//
// Sel, base et pièces jointes vivent dans trois fichiers distincts : aucun
// renommage unique ne peut tout basculer atomiquement. On rend donc le commit
// IDEMPOTENT et REJOUABLE via un journal :
//   1. on prépare un jeu complet de fichiers « .new » (base re-chiffrée sur une
//      COPIE, pièces jointes re-chiffrées, sel/params) — les originaux restent
//      intacts, le coffre s'ouvre toujours avec l'ANCIEN mot de passe ;
//   2. on écrit `rekey.journal` (point de commit) ;
//   3. on renomme les « .new » par-dessus les originaux.
// Si une rotation est interrompue : absence de journal ⇒ on supprime les « .new »
// (retour à l'ANCIEN) ; présence du journal ⇒ on rejoue les renommages
// (convergence vers le NOUVEAU). `recover_pending_rekey` applique cette logique
// avant chaque ouverture de coffre.

const REKEY_JOURNAL: &str = "rekey.journal";

/// Termine ou annule une rotation interrompue. Idempotent. À appeler avant
/// d'ouvrir un coffre.
pub(crate) fn recover_pending_rekey(vault_dir: &Path) {
    let journal = vault_dir.join(REKEY_JOURNAL);
    if journal.exists() {
        // Un jeu « .new » complet a été préparé : le commit a pu être partiel.
        commit_rekey(vault_dir);
        let _ = std::fs::remove_file(&journal);
    } else {
        // Échec AVANT le point de commit : on jette la préparation.
        cleanup_rekey_staging(vault_dir);
    }
}

/// Renomme tous les fichiers « .new » par-dessus leurs originaux. La base passe
/// en premier (et ses WAL/SHM obsolètes, chiffrés avec l'ancienne clé, sont
/// supprimés) ; le sel en dernier. Chaque renommage POSIX est atomique, et
/// rejouer la fonction converge vers l'état NOUVEAU.
fn commit_rekey(vault_dir: &Path) {
    let db_new = vault_dir.join("vault.db.new");
    if db_new.exists() {
        let _ = std::fs::rename(&db_new, vault_dir.join("vault.db"));
        let _ = std::fs::remove_file(vault_dir.join("vault.db-wal"));
        let _ = std::fs::remove_file(vault_dir.join("vault.db-shm"));
    }

    let files_dir = vault_dir.join("files");
    if let Ok(rd) = std::fs::read_dir(&files_dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if let Some(stripped) = p
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|n| n.strip_suffix(".new"))
            {
                let _ = std::fs::rename(&p, files_dir.join(stripped));
            }
        }
    }

    if vault_dir.join("argon2_params.json.new").exists() {
        let _ = std::fs::rename(
            vault_dir.join("argon2_params.json.new"),
            vault_dir.join("argon2_params.json"),
        );
    }
    // Le sel détermine l'identité de la clé : on le bascule en dernier.
    if vault_dir.join("salt.bin.new").exists() {
        let _ = std::fs::rename(vault_dir.join("salt.bin.new"), vault_dir.join("salt.bin"));
    }
}

/// Supprime tous les fichiers de préparation « .new » d'une rotation avortée.
fn cleanup_rekey_staging(vault_dir: &Path) {
    let _ = std::fs::remove_file(vault_dir.join("vault.db.new"));
    let _ = std::fs::remove_file(vault_dir.join("salt.bin.new"));
    let _ = std::fs::remove_file(vault_dir.join("argon2_params.json.new"));
    if let Ok(rd) = std::fs::read_dir(vault_dir.join("files")) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) == Some("new") {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

/// Prépare puis valide la rotation. En cas d'erreur AVANT le point de commit,
/// rien n'a bougé côté originaux (le coffre reste sur l'ancien mot de passe).
fn perform_rekey(
    vault_dir: &Path,
    old_key: &[u8; 32],
    new_key: &[u8; 32],
    new_salt: &[u8; 16],
    new_params: &Argon2Params,
) -> Result<(), String> {
    // Jette d'éventuels restes d'une tentative précédente.
    cleanup_rekey_staging(vault_dir);

    // 1. Base : on travaille sur une COPIE, l'original reste lisible.
    let db_path = vault_dir.join("vault.db");
    let db_new = vault_dir.join("vault.db.new");
    std::fs::copy(&db_path, &db_new)
        .map_err(|e| format!("Échec de la copie de la base: {}", e))?;
    crate::db::rekey_db_file(&db_new, old_key, new_key)?;

    // 2. Pièces jointes : déchiffre (ancienne clé) → rechiffre (nouvelle clé)
    //    vers « <nom>.new ». Les originaux ne sont pas touchés.
    let files_dir = vault_dir.join("files");
    if files_dir.is_dir() {
        for entry in std::fs::read_dir(&files_dir)
            .map_err(|e| format!("Lecture du dossier des pièces jointes: {}", e))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            // Ignore les éventuels résidus « .new ».
            if path.extension().and_then(|s| s.to_str()) == Some("new") {
                continue;
            }
            let cipher_old = std::fs::read(&path)
                .map_err(|e| format!("Lecture pièce jointe {}: {}", path.display(), e))?;
            // Le clair transite en mémoire : on le zeroize dès que possible.
            let plain = Zeroizing::new(
                crypto::decrypt_data(old_key, &cipher_old)
                    .map_err(|e| format!("Déchiffrement {}: {}", path.display(), e))?,
            );
            let cipher_new = crypto::encrypt_data(new_key, &plain)
                .map_err(|e| format!("Re-chiffrement {}: {}", path.display(), e))?;
            let mut new_path = path.clone().into_os_string();
            new_path.push(".new");
            std::fs::write(&new_path, &cipher_new)
                .map_err(|e| format!("Écriture pièce jointe re-chiffrée: {}", e))?;
        }
    }

    // 3. Sel + paramètres Argon2id.
    std::fs::write(vault_dir.join("salt.bin.new"), new_salt)
        .map_err(|e| format!("Écriture du sel: {}", e))?;
    let params_json = serde_json::to_vec_pretty(new_params).map_err(|e| e.to_string())?;
    std::fs::write(vault_dir.join("argon2_params.json.new"), &params_json)
        .map_err(|e| format!("Écriture des paramètres: {}", e))?;

    // 4. Point de commit : à partir d'ici, une interruption sera RÉSOLUE en
    //    avant (vers le nouveau mot de passe) par recover_pending_rekey.
    std::fs::write(vault_dir.join(REKEY_JOURNAL), b"commit")
        .map_err(|e| format!("Écriture du journal de rotation: {}", e))?;
    commit_rekey(vault_dir);
    let _ = std::fs::remove_file(vault_dir.join(REKEY_JOURNAL));
    Ok(())
}

/// Change le mot de passe maître du coffre actif : re-dérive la clé (nouveau
/// sel + paramètres), re-chiffre la base (`PRAGMA rekey`) ET toutes les pièces
/// jointes, de façon rejouable. Le coffre doit être déverrouillé. En cas
/// d'échec avant le commit, le coffre reste intact sur l'ancien mot de passe.
#[tauri::command]
pub fn change_master_password(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let old_password = Zeroizing::new(old_password);
    let new_password = Zeroizing::new(new_password);

    if new_password.chars().count() < 8 {
        return Err("Le nouveau mot de passe doit contenir au moins 8 caractères.".to_string());
    }
    if *old_password == *new_password {
        return Err("Le nouveau mot de passe doit être différent de l'ancien.".to_string());
    }

    // Snapshot du coffre actif.
    let vault_dir = {
        let g = state
            .vault_dir
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        g.as_ref().ok_or("Aucun coffre actif")?.clone()
    };
    let vault_name = state
        .active_vault
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .clone();

    // Vérifie l'ancien mot de passe : la clé re-dérivée doit correspondre à la
    // clé en mémoire (issue du déverrouillage courant).
    let salt = read_salt(&vault_dir)?;
    let params = read_params(&vault_dir)?;
    let old_key = crypto::derive_key(&old_password, &salt, &params)
        .map_err(|e| format!("Key derivation failed: {}", e))?;
    {
        let kg = state
            .encryption_key
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        let current = kg.as_ref().ok_or("Coffre verrouillé")?;
        if current[..] != old_key[..] {
            return Err("Ancien mot de passe incorrect.".to_string());
        }
    }

    // Nouvelle clé (nouveau sel + paramètres recommandés du moment).
    let new_salt = crypto::generate_salt();
    let new_params = Argon2Params::default();
    let new_key = crypto::derive_key(&new_password, &new_salt, &new_params)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    // Ferme la base active (checkpoint) pour libérer vault.db avant la copie.
    {
        let db = state
            .db
            .lock()
            .map_err(|_| "lock poisoned".to_string())?
            .take();
        if let Some(db) = db {
            db.close().ok();
            drop(db);
        }
    }

    match perform_rekey(&vault_dir, &old_key, &new_key, &new_salt, &new_params) {
        Ok(()) => {
            let db = Database::open(&vault_dir, &new_key)?;
            set_state(&state, db, vault_dir, new_key, vault_name.clone())?;
            record_success(&app, &state, &vault_name);
            Ok(())
        }
        Err(e) => {
            // Échec avant commit : on jette la préparation et on rouvre le
            // coffre sur l'ANCIEN mot de passe, intact.
            cleanup_rekey_staging(&vault_dir);
            if let Ok(db) = Database::open(&vault_dir, &old_key) {
                let _ = set_state(&state, db, vault_dir, old_key, vault_name);
            }
            Err(format!(
                "Rotation annulée — le coffre est intact (ancien mot de passe toujours valide). Cause : {}",
                e
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::storage;
    use crate::util::test_support::TempDir;

    fn fast_params() -> Argon2Params {
        Argon2Params {
            m_cost_kib: 8,
            t_cost: 1,
            p_cost: 1,
            version: 0x13,
        }
    }

    // Deux clés distinctes : la rotation manipule des octets de clé, peu importe
    // comment ils ont été dérivés.
    fn key(seed: u8) -> [u8; 32] {
        [seed; 32]
    }

    /// Construit un coffre (db chiffrée + 1 ligne + 1 pièce jointe) avec `old`.
    fn setup_vault(dir: &Path, old: &[u8; 32]) -> String {
        {
            let db = Database::open(dir, old).unwrap();
            let conn = db.conn.lock().unwrap();
            conn.execute("INSERT INTO merchants (id, name) VALUES ('m1','Coop')", [])
                .unwrap();
        }
        std::fs::write(dir.join("salt.bin"), [1u8; 16]).unwrap();
        std::fs::write(
            dir.join("argon2_params.json"),
            serde_json::to_vec_pretty(&fast_params()).unwrap(),
        )
        .unwrap();
        storage::save_attachment(dir, "att-1", b"facture secrete", old).unwrap()
    }

    #[test]
    fn rotation_round_trip_db_et_pieces_jointes() {
        let tmp = TempDir::new();
        let old = key(7);
        let new = key(200);
        let stored = setup_vault(tmp.path(), &old);

        let new_salt = [42u8; 16];
        perform_rekey(tmp.path(), &old, &new, &new_salt, &fast_params()).unwrap();

        // Base lisible avec la NOUVELLE clé, et la donnée est préservée.
        {
            let db = Database::open(tmp.path(), &new).unwrap();
            let conn = db.conn.lock().unwrap();
            let name: String = conn
                .query_row("SELECT name FROM merchants WHERE id='m1'", [], |r| r.get(0))
                .unwrap();
            assert_eq!(name, "Coop");
        }

        // L'ANCIENNE clé ne doit plus ouvrir la base.
        match Database::open(tmp.path(), &old) {
            Ok(_) => panic!("l'ancienne clé ne devrait plus fonctionner"),
            Err(e) => assert!(e.contains("Mot de passe incorrect")),
        }

        // Pièce jointe re-chiffrée : lisible avec la nouvelle clé, pas l'ancienne.
        let att_path = storage::attachments_dir(tmp.path()).join(&stored);
        let p = att_path.to_str().unwrap();
        assert_eq!(storage::read_attachment(p, &new).unwrap(), b"facture secrete");
        assert!(storage::read_attachment(p, &old).is_err());

        // Sel basculé, et plus aucun fichier de préparation ni journal.
        assert_eq!(std::fs::read(tmp.path().join("salt.bin")).unwrap(), new_salt);
        assert!(!tmp.path().join("vault.db.new").exists());
        assert!(!tmp.path().join("salt.bin.new").exists());
        assert!(!tmp.path().join(REKEY_JOURNAL).exists());
        assert!(!tmp.path().join("files").join(format!("{}.new", stored)).exists());
    }

    #[test]
    fn recover_sans_journal_jette_la_preparation() {
        let tmp = TempDir::new();
        // Préparation partielle SANS journal = échec avant commit.
        std::fs::write(tmp.path().join("salt.bin"), [1u8; 16]).unwrap();
        std::fs::write(tmp.path().join("salt.bin.new"), [9u8; 16]).unwrap();
        std::fs::write(tmp.path().join("vault.db.new"), b"junk").unwrap();
        std::fs::create_dir_all(tmp.path().join("files")).unwrap();
        std::fs::write(tmp.path().join("files").join("a.enc.new"), b"x").unwrap();

        recover_pending_rekey(tmp.path());

        // Les « .new » sont supprimés, l'original est conservé.
        assert!(!tmp.path().join("salt.bin.new").exists());
        assert!(!tmp.path().join("vault.db.new").exists());
        assert!(!tmp.path().join("files").join("a.enc.new").exists());
        assert_eq!(std::fs::read(tmp.path().join("salt.bin")).unwrap(), [1u8; 16]);
    }

    #[test]
    fn recover_avec_journal_termine_le_commit() {
        let tmp = TempDir::new();
        std::fs::create_dir_all(tmp.path().join("files")).unwrap();
        // Commit interrompu : journal présent + un « .new » pas encore renommé.
        std::fs::write(tmp.path().join("salt.bin"), [1u8; 16]).unwrap();
        std::fs::write(tmp.path().join("salt.bin.new"), [9u8; 16]).unwrap();
        std::fs::write(tmp.path().join("files").join("a.enc.new"), b"new-cipher").unwrap();
        std::fs::write(tmp.path().join(REKEY_JOURNAL), b"commit").unwrap();

        recover_pending_rekey(tmp.path());

        // Le commit est rejoué jusqu'au bout : sel basculé, pièce jointe en place,
        // journal effacé.
        assert_eq!(std::fs::read(tmp.path().join("salt.bin")).unwrap(), [9u8; 16]);
        assert!(!tmp.path().join("salt.bin.new").exists());
        assert_eq!(
            std::fs::read(tmp.path().join("files").join("a.enc")).unwrap(),
            b"new-cipher"
        );
        assert!(!tmp.path().join("files").join("a.enc.new").exists());
        assert!(!tmp.path().join(REKEY_JOURNAL).exists());
    }

    #[test]
    fn rotation_puis_recover_est_un_noop() {
        let tmp = TempDir::new();
        let old = key(7);
        let new = key(200);
        setup_vault(tmp.path(), &old);
        perform_rekey(tmp.path(), &old, &new, &[42u8; 16], &fast_params()).unwrap();

        // Aucun journal après une rotation réussie : recover ne doit rien casser.
        recover_pending_rekey(tmp.path());
        let db = Database::open(tmp.path(), &new).unwrap();
        let conn = db.conn.lock().unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM merchants", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}

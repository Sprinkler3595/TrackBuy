use std::path::{Component, Path, PathBuf};

/// Validate a user-provided file path used for export/write operations.
///
/// Requirements:
/// - Must be absolute
/// - Must not contain `..` components
/// - Parent directory must exist and canonicalize cleanly (no broken symlinks)
///
/// The file itself does not need to exist yet (it's a write target).
pub fn validate_write_target(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("Chemin vide".to_string());
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err("Chemin absolu requis".to_string());
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("'..' interdit dans le chemin".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Pas de répertoire parent".to_string())?;
    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("Répertoire parent invalide: {}", e))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "Pas de nom de fichier".to_string())?;
    Ok(canon_parent.join(file_name))
}

/// Validate a user-provided path for a read operation.
///
/// Requirements:
/// - Must be absolute
/// - Must not contain `..` components
/// - File must exist and canonicalize cleanly (no broken symlinks)
pub fn validate_read_source(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return Err("Chemin vide".to_string());
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err("Chemin absolu requis".to_string());
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("'..' interdit dans le chemin".to_string());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("Fichier introuvable: {}", e))?;
    if !canon.is_file() {
        return Err("La cible doit être un fichier".to_string());
    }
    Ok(canon)
}

/// Validate that `path` is contained within `base` after canonicalisation.
/// Used for internal sanity checks (e.g. attachment file_path stored in DB
/// must point inside the vault's `files/` directory).
pub fn ensure_within(path: &Path, base: &Path) -> Result<PathBuf, String> {
    let canon = path
        .canonicalize()
        .map_err(|e| format!("Fichier introuvable: {}", e))?;
    let canon_base = base
        .canonicalize()
        .map_err(|e| format!("Base introuvable: {}", e))?;
    if !canon.starts_with(&canon_base) {
        return Err("Chemin hors de la zone autorisée".to_string());
    }
    Ok(canon)
}

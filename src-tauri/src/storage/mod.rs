use std::path::{Path, PathBuf};
use crate::crypto;
use crate::util::path::ensure_within;
use crate::util::secure_delete::shred_and_remove;

/// Get the attachments directory for a vault
pub fn attachments_dir(vault_dir: &Path) -> PathBuf {
    vault_dir.join("files")
}

/// Resolve a `file_path` value stored in the attachments table into a real
/// filesystem path inside the *current* vault. Only the file name component is
/// trusted — any directory prefix is discarded so a path from a different
/// vault (e.g. after restoring a backup under a new name) still resolves to
/// the right file. Result is `ensure_within`-checked for defense in depth.
pub fn resolve_attachment(stored: &str, attachments_root: &Path) -> Result<PathBuf, String> {
    let filename = Path::new(stored)
        .file_name()
        .ok_or_else(|| "Attachment path is empty".to_string())?;
    let resolved = attachments_root.join(filename);
    ensure_within(&resolved, attachments_root)
}

/// Save an encrypted attachment to disk
pub fn save_attachment(
    vault_dir: &Path,
    attachment_id: &str,
    data: &[u8],
    key: &[u8; 32],
) -> Result<String, String> {
    let dir = attachments_dir(vault_dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create attachments dir: {}", e))?;

    let encrypted = crypto::encrypt_data(key, data)
        .map_err(|e| format!("Failed to encrypt attachment: {}", e))?;

    let filename = format!("{}.enc", attachment_id);
    let file_path = dir.join(&filename);
    std::fs::write(&file_path, &encrypted)
        .map_err(|e| format!("Failed to write attachment: {}", e))?;

    // Return only the file name (relative to the vault's attachments dir) so
    // the stored path stays valid across vault renames and backup restores.
    Ok(filename)
}

/// Read and decrypt an attachment from disk
pub fn read_attachment(file_path: &str, key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let encrypted = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read attachment: {}", e))?;

    crypto::decrypt_data(key, &encrypted)
        .map_err(|e| format!("Failed to decrypt attachment: {}", e))
}

/// Delete an encrypted attachment from disk. Best-effort secure delete:
/// overwrite the ciphertext with zeros before unlinking. On SSDs with TRIM the
/// overwrite may be redirected by the FTL; on HDDs/USB it reliably destroys
/// the previous bytes.
pub fn delete_attachment_file(file_path: &str) -> Result<(), String> {
    shred_and_remove(Path::new(file_path))
}

/// Detect MIME type from file extension
pub fn detect_mime_type(filename: &str) -> String {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
    .to_string()
}

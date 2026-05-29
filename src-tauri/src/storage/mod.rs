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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{test_key, TempDir};

    #[test]
    fn save_then_read_attachment_round_trip() {
        let tmp = TempDir::new();
        let key = test_key();
        let data = b"contenu binaire de la piece jointe \x00\x01\x02";

        let stored = save_attachment(tmp.path(), "att-123", data, &key).unwrap();
        // On ne renvoie que le nom de fichier (portable entre coffres).
        assert_eq!(stored, "att-123.enc");

        let on_disk = attachments_dir(tmp.path()).join(&stored);
        // Le fichier sur disque est chiffré : il ne contient pas le clair.
        let raw = std::fs::read(&on_disk).unwrap();
        assert_ne!(raw, data);

        let decrypted =
            read_attachment(on_disk.to_str().unwrap(), &key).unwrap();
        assert_eq!(decrypted, data);
    }

    #[test]
    fn read_attachment_echoue_avec_mauvaise_cle() {
        let tmp = TempDir::new();
        let key = test_key();
        let stored = save_attachment(tmp.path(), "att-1", b"secret", &key).unwrap();
        let on_disk = attachments_dir(tmp.path()).join(&stored);

        let mut wrong = [0u8; 32];
        wrong[0] = 0xff;
        assert!(read_attachment(on_disk.to_str().unwrap(), &wrong).is_err());
    }

    #[test]
    fn resolve_attachment_ne_garde_que_le_nom() {
        let tmp = TempDir::new();
        let root = attachments_dir(tmp.path());
        std::fs::create_dir_all(&root).unwrap();
        // `ensure_within` canonicalise et exige l'existence du fichier cible.
        std::fs::write(root.join("abc.enc"), b"x").unwrap();

        // Un chemin venant d'un autre coffre doit se résoudre dans le coffre
        // courant en ne gardant que le composant final.
        let resolved =
            resolve_attachment("/un/autre/coffre/files/abc.enc", &root).unwrap();
        assert_eq!(resolved.file_name().unwrap(), "abc.enc");
        assert!(resolved.starts_with(root.canonicalize().unwrap()));
    }

    #[test]
    fn resolve_attachment_rejette_echappement() {
        let tmp = TempDir::new();
        let root = attachments_dir(tmp.path());
        std::fs::create_dir_all(&root).unwrap();
        // file_name() de ".." est None → erreur, pas d'évasion possible.
        assert!(resolve_attachment("..", &root).is_err());
    }

    #[test]
    fn delete_attachment_supprime_le_fichier() {
        let tmp = TempDir::new();
        let key = test_key();
        let stored = save_attachment(tmp.path(), "att-x", b"abc", &key).unwrap();
        let on_disk = attachments_dir(tmp.path()).join(&stored);
        assert!(on_disk.exists());
        delete_attachment_file(on_disk.to_str().unwrap()).unwrap();
        assert!(!on_disk.exists());
    }
}

use base64::{engine::general_purpose, Engine as _};

use crate::util::path::{validate_read_source, validate_write_target};

/// Write a UTF-8 string to a user-chosen path. The path must come from a
/// Tauri dialog (`save()`); we re-validate it server-side anyway.
#[tauri::command]
pub fn write_text_file(destination: String, content: String) -> Result<(), String> {
    let path = validate_write_target(&destination)?;
    std::fs::write(&path, content.as_bytes())
        .map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Read a user-chosen text file. Path must come from `open()` dialog.
#[tauri::command]
pub fn read_text_file(source: String) -> Result<String, String> {
    let path = validate_read_source(&source)?;
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Read a user-chosen binary file and return base64. Path from `open()` dialog.
/// Capped at 50 MB to prevent accidental OOM on huge files (OCR/scan flow).
#[tauri::command]
pub fn read_binary_file_base64(source: String) -> Result<String, String> {
    let path = validate_read_source(&source)?;
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("Fichier trop volumineux (max 50 MB)".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

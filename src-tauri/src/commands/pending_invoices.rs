use base64::{engine::general_purpose, Engine as _};
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{Attachment, PendingInvoice};
use crate::storage;
use crate::util::path::validate_read_source;

const PENDING_INVOICE_SELECT_COLUMNS: &str =
    "id, label, notes, original_name, mime_type, file_path, size_bytes, created_at, updated_at";

fn row_to_pending_invoice(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingInvoice> {
    Ok(PendingInvoice {
        id: row.get(0)?,
        label: row.get(1)?,
        notes: row.get(2)?,
        original_name: row.get(3)?,
        mime_type: row.get(4)?,
        file_path: row.get(5)?,
        size_bytes: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[tauri::command]
pub fn list_pending_invoices(state: State<'_, AppState>) -> Result<Vec<PendingInvoice>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM pending_invoices ORDER BY created_at DESC",
        PENDING_INVOICE_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let invoices = stmt
        .query_map([], row_to_pending_invoice)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(invoices)
}

/// Reads the source file from disk, encrypts it via the same pipeline as
/// `add_attachment`, and inserts a `pending_invoices` row. The optional label
/// and notes can be set at upload time or edited later via
/// `update_pending_invoice`.
#[tauri::command]
pub fn add_pending_invoice(
    state: State<'_, AppState>,
    source_path: String,
    label: Option<String>,
    notes: Option<String>,
) -> Result<PendingInvoice, String> {
    add_pending_invoice_impl(&state, &source_path, label, notes)
}

/// Multi-file variant for the "Importer plusieurs factures" entry point.
/// Errors on individual files are surfaced as a single concatenated error so
/// the frontend can report partial failures without losing the successful
/// imports. Returns the list of successfully created rows.
#[tauri::command]
pub fn add_pending_invoices_batch(
    state: State<'_, AppState>,
    source_paths: Vec<String>,
) -> Result<Vec<PendingInvoice>, String> {
    let mut created: Vec<PendingInvoice> = Vec::with_capacity(source_paths.len());
    let mut errors: Vec<String> = Vec::new();

    for path in source_paths {
        match add_pending_invoice_impl(&state, &path, None, None) {
            Ok(inv) => created.push(inv),
            Err(err) => errors.push(format!("{}: {}", path, err)),
        }
    }

    if !errors.is_empty() && created.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(created)
}

fn add_pending_invoice_impl(
    state: &State<'_, AppState>,
    source_path: &str,
    label: Option<String>,
    notes: Option<String>,
) -> Result<PendingInvoice, String> {
    let safe_source = validate_read_source(source_path)?;
    let data = std::fs::read(&safe_source)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let size_bytes = data.len() as i64;
    if size_bytes > 100 * 1024 * 1024 {
        return Err("File too large (max 100 MB)".to_string());
    }

    let original_name = safe_source
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let mime_type = storage::detect_mime_type(&original_name);
    let id = Uuid::new_v4().to_string();

    let vault_dir = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir.as_ref().ok_or("No active vault")?;
    let key_guard = state.encryption_key.lock().map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?;
    let key_bytes: &[u8; 32] = key;

    let file_path = storage::save_attachment(vault_dir, &id, &data, key_bytes)?;

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let label_norm = label.and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    let notes_norm = notes.and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });

    conn.execute(
        "INSERT INTO pending_invoices (id, label, notes, original_name, mime_type, file_path, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, label_norm, notes_norm, original_name, mime_type, file_path, size_bytes],
    ).map_err(|e| e.to_string())?;

    let select_sql = format!(
        "SELECT {} FROM pending_invoices WHERE id = ?1",
        PENDING_INVOICE_SELECT_COLUMNS
    );
    conn.query_row(&select_sql, [&id], row_to_pending_invoice)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_pending_invoice(
    state: State<'_, AppState>,
    id: String,
    label: Option<String>,
    notes: Option<String>,
) -> Result<PendingInvoice, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let label_norm = label.and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });
    let notes_norm = notes.and_then(|s| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    });

    let updated = conn.execute(
        "UPDATE pending_invoices
         SET label = ?2, notes = ?3, updated_at = datetime('now')
         WHERE id = ?1",
        rusqlite::params![id, label_norm, notes_norm],
    ).map_err(|e| e.to_string())?;

    if updated == 0 {
        return Err("Facture en attente introuvable".to_string());
    }

    let select_sql = format!(
        "SELECT {} FROM pending_invoices WHERE id = ?1",
        PENDING_INVOICE_SELECT_COLUMNS
    );
    conn.query_row(&select_sql, [&id], row_to_pending_invoice)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_pending_invoice(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let file_path: String = conn.query_row(
        "SELECT file_path FROM pending_invoices WHERE id = ?1",
        [&id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM pending_invoices WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    let vault_dir_guard = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
    if let Some(vault_dir) = vault_dir_guard.as_ref() {
        let attachments_root = storage::attachments_dir(vault_dir);
        if let Ok(resolved) = storage::resolve_attachment(&file_path, &attachments_root) {
            let _ = storage::delete_attachment_file(resolved.to_str().unwrap_or(""));
        }
    }
    Ok(())
}

/// Decrypts the stored file and returns it as a base64 data URL, suitable for
/// re-injecting into the scan page (preview + OCR pipeline) without writing
/// the plaintext to disk. Capped at 10 MB to avoid blowing up the JS heap.
#[tauri::command]
pub fn get_pending_invoice_data(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let vault_dir_guard = state
        .vault_dir
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir_guard.as_ref().ok_or("No active vault")?;
    let attachments_root = storage::attachments_dir(vault_dir);

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let (file_path, mime_type): (String, String) = conn
        .query_row(
            "SELECT file_path, mime_type FROM pending_invoices WHERE id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let safe_source = storage::resolve_attachment(&file_path, &attachments_root)?;

    let key_guard = state
        .encryption_key
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?;
    let key_bytes: &[u8; 32] = key;

    let data = storage::read_attachment(safe_source.to_str().unwrap_or(""), key_bytes)?;
    if data.len() > 10 * 1024 * 1024 {
        return Err("Pending invoice too large for inline display (max 10 MB)".to_string());
    }

    Ok(format!(
        "data:{};base64,{}",
        mime_type,
        general_purpose::STANDARD.encode(&data)
    ))
}

/// Promotes a pending invoice into a real `attachments` row pointed at the
/// given item (and optionally shared at the order level). The encrypted
/// ciphertext on disk is left untouched — only the metadata row moves — so
/// nothing has to be decrypted/reencrypted. Atomic via a SQL transaction:
/// either both the INSERT and the DELETE succeed, or neither does.
#[tauri::command]
pub fn attach_pending_invoice_to_item(
    state: State<'_, AppState>,
    pending_invoice_id: String,
    item_id: String,
    attachment_type: Option<String>,
    display_name: Option<String>,
    share_with_order: Option<bool>,
) -> Result<Attachment, String> {
    let mut db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_mut().ok_or("Vault not unlocked")?;
    let mut conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Read the pending row's metadata (label/notes are dropped — they were
    // workflow helpers and don't survive the move).
    let (pending_label, pending_original_name, pending_mime_type, pending_file_path, pending_size_bytes):
        (Option<String>, String, String, String, i64) = conn
        .query_row(
            "SELECT label, original_name, mime_type, file_path, size_bytes
             FROM pending_invoices WHERE id = ?1",
            [&pending_invoice_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .map_err(|e| format!("Facture en attente introuvable: {}", e))?;

    // Resolve order_id when caller wants the attachment shared across the
    // whole order (mirror of add_attachment's share_with_order branch).
    let (db_item_id, db_order_id): (Option<String>, Option<String>) =
        if share_with_order.unwrap_or(false) {
            let order_id: Option<String> = conn
                .query_row(
                    "SELECT order_id FROM items WHERE id = ?1",
                    [&item_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Article introuvable: {}", e))?;
            match order_id {
                Some(oid) => (None, Some(oid)),
                None => return Err("Cet article ne fait pas partie d'un achat groupé".to_string()),
            }
        } else {
            (Some(item_id.clone()), None)
        };

    let new_id = Uuid::new_v4().to_string();
    let att_type = attachment_type.unwrap_or_else(|| "invoice".to_string());
    let display = display_name
        .filter(|s| !s.trim().is_empty())
        .or(pending_label.filter(|s| !s.trim().is_empty()))
        .unwrap_or_else(|| pending_original_name.clone());

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO attachments (id, item_id, order_id, subscription_id, original_name, display_name, mime_type, file_path, size_bytes, attachment_type)
         VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            new_id, db_item_id, db_order_id,
            pending_original_name, display, pending_mime_type,
            pending_file_path, pending_size_bytes, att_type,
        ],
    ).map_err(|e| format!("Insertion attachment échouée: {}", e))?;

    tx.execute(
        "DELETE FROM pending_invoices WHERE id = ?1",
        [&pending_invoice_id],
    ).map_err(|e| format!("Suppression facture en attente échouée: {}", e))?;

    tx.commit().map_err(|e| format!("Commit échoué: {}", e))?;

    // Read back the freshly-inserted row to return a complete Attachment.
    conn.query_row(
        "SELECT id, item_id, order_id, subscription_id, engagement_id, engagement_charge_id,
                engagement_revision_id, original_name, display_name, mime_type, file_path,
                size_bytes, attachment_type, created_at
         FROM attachments WHERE id = ?1",
        [&new_id],
        |row| Ok(Attachment {
            id: row.get(0)?,
            item_id: row.get(1)?,
            order_id: row.get(2)?,
            subscription_id: row.get(3)?,
            engagement_id: row.get(4)?,
            engagement_charge_id: row.get(5)?,
            engagement_revision_id: row.get(6)?,
            original_name: row.get(7)?,
            display_name: row.get(8)?,
            mime_type: row.get(9)?,
            file_path: row.get(10)?,
            size_bytes: row.get(11)?,
            attachment_type: row.get(12)?,
            created_at: row.get(13)?,
        }),
    ).map_err(|e| e.to_string())
}

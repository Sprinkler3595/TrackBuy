use base64::{engine::general_purpose, Engine as _};
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::Attachment;
use crate::storage;
use crate::util::path::{validate_read_source, validate_write_target};

/// SELECT clause shared by every attachment fetch — keeps column order aligned
/// with `row_to_attachment` so adding new polymorphic targets only touches one
/// place. Current targets: item / order / subscription / engagement /
/// engagement_charge / engagement_revision / income / income_receipt.
const ATTACHMENT_SELECT_COLUMNS: &str =
    "id, item_id, order_id, subscription_id, engagement_id, engagement_charge_id, engagement_revision_id,
     income_id, income_receipt_id,
     original_name, display_name, mime_type, file_path, size_bytes, attachment_type, created_at";

/// Polymorphic target for `insert_polymorphic_attachment` — every CHECK-allowed
/// parent on the attachments table maps to one variant. Add a new variant when
/// the schema grows another FK.
#[allow(dead_code)]
enum AttachmentTarget<'a> {
    Item(&'a str),
    Order(&'a str),
    Subscription(&'a str),
    Engagement(&'a str),
    EngagementCharge(&'a str),
    EngagementRevision(&'a str),
    Income(&'a str),
    IncomeReceipt(&'a str),
}

#[tauri::command]
pub fn get_attachments(state: State<'_, AppState>, item_id: String) -> Result<Vec<Attachment>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Return both item-specific attachments AND attachments shared at the
    // order level (one invoice across multiple items).
    let sql = format!(
        "SELECT {} FROM attachments
         WHERE item_id = ?1
            OR (order_id IS NOT NULL AND order_id = (SELECT order_id FROM items WHERE id = ?1))
         ORDER BY created_at",
        ATTACHMENT_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let attachments = stmt
        .query_map([&item_id], row_to_attachment)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(attachments)
}

#[tauri::command]
pub fn get_subscription_attachments(
    state: State<'_, AppState>,
    subscription_id: String,
) -> Result<Vec<Attachment>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM attachments WHERE subscription_id = ?1 ORDER BY created_at",
        ATTACHMENT_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let attachments = stmt
        .query_map([&subscription_id], row_to_attachment)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(attachments)
}

fn row_to_attachment(row: &rusqlite::Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        item_id: row.get(1)?,
        order_id: row.get(2)?,
        subscription_id: row.get(3)?,
        engagement_id: row.get(4)?,
        engagement_charge_id: row.get(5)?,
        engagement_revision_id: row.get(6)?,
        income_id: row.get(7)?,
        income_receipt_id: row.get(8)?,
        original_name: row.get(9)?,
        display_name: row.get(10)?,
        mime_type: row.get(11)?,
        file_path: row.get(12)?,
        size_bytes: row.get(13)?,
        attachment_type: row.get(14)?,
        created_at: row.get(15)?,
    })
}

/// Encrypt + persist a source file as an attachment row pointed at a single
/// polymorphic parent. Factored out so each `add_*_attachment` command stays a
/// thin wrapper instead of duplicating the IO/crypto/insert pipeline.
fn insert_polymorphic_attachment(
    state: &State<'_, AppState>,
    target: AttachmentTarget<'_>,
    source_path: &str,
    display_name: Option<String>,
    attachment_type: Option<String>,
) -> Result<Attachment, String> {
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
    let display = display_name.unwrap_or_else(|| original_name.clone());
    let att_type = attachment_type.unwrap_or_else(|| "other".to_string());
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

    let (item_id, order_id, sub_id, eng_id, charge_id, rev_id, income_id, receipt_id): (
        Option<&str>, Option<&str>, Option<&str>, Option<&str>,
        Option<&str>, Option<&str>, Option<&str>, Option<&str>,
    ) = match target {
        AttachmentTarget::Item(id) => (Some(id), None, None, None, None, None, None, None),
        AttachmentTarget::Order(id) => (None, Some(id), None, None, None, None, None, None),
        AttachmentTarget::Subscription(id) => (None, None, Some(id), None, None, None, None, None),
        AttachmentTarget::Engagement(id) => (None, None, None, Some(id), None, None, None, None),
        AttachmentTarget::EngagementCharge(id) => (None, None, None, None, Some(id), None, None, None),
        AttachmentTarget::EngagementRevision(id) => (None, None, None, None, None, Some(id), None, None),
        AttachmentTarget::Income(id) => (None, None, None, None, None, None, Some(id), None),
        AttachmentTarget::IncomeReceipt(id) => (None, None, None, None, None, None, None, Some(id)),
    };

    conn.execute(
        "INSERT INTO attachments (id, item_id, order_id, subscription_id, engagement_id,
         engagement_charge_id, engagement_revision_id, income_id, income_receipt_id,
         original_name, display_name, mime_type, file_path, size_bytes, attachment_type)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![
            id, item_id, order_id, sub_id, eng_id, charge_id, rev_id, income_id, receipt_id,
            original_name, display, mime_type, file_path, size_bytes, att_type
        ],
    ).map_err(|e| e.to_string())?;

    let select_sql = format!(
        "SELECT {} FROM attachments WHERE id = ?1",
        ATTACHMENT_SELECT_COLUMNS
    );
    conn.query_row(&select_sql, [&id], row_to_attachment)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_engagement_attachments(
    state: State<'_, AppState>,
    engagement_id: String,
) -> Result<Vec<Attachment>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM attachments WHERE engagement_id = ?1 ORDER BY created_at",
        ATTACHMENT_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let attachments = stmt
        .query_map([&engagement_id], row_to_attachment)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(attachments)
}

#[tauri::command]
pub fn get_engagement_charge_attachments(
    state: State<'_, AppState>,
    charge_id: String,
) -> Result<Vec<Attachment>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM attachments WHERE engagement_charge_id = ?1 ORDER BY created_at",
        ATTACHMENT_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let attachments = stmt
        .query_map([&charge_id], row_to_attachment)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(attachments)
}

#[tauri::command]
pub fn add_engagement_attachment(
    state: State<'_, AppState>,
    engagement_id: String,
    source_path: String,
    display_name: Option<String>,
    attachment_type: Option<String>,
) -> Result<Attachment, String> {
    insert_polymorphic_attachment(
        &state,
        AttachmentTarget::Engagement(&engagement_id),
        &source_path,
        display_name,
        attachment_type,
    )
}

#[tauri::command]
pub fn add_engagement_charge_attachment(
    state: State<'_, AppState>,
    charge_id: String,
    source_path: String,
    display_name: Option<String>,
    attachment_type: Option<String>,
) -> Result<Attachment, String> {
    insert_polymorphic_attachment(
        &state,
        AttachmentTarget::EngagementCharge(&charge_id),
        &source_path,
        display_name,
        attachment_type,
    )
}

#[tauri::command]
pub fn add_engagement_revision_attachment(
    state: State<'_, AppState>,
    revision_id: String,
    source_path: String,
    display_name: Option<String>,
    attachment_type: Option<String>,
) -> Result<Attachment, String> {
    insert_polymorphic_attachment(
        &state,
        AttachmentTarget::EngagementRevision(&revision_id),
        &source_path,
        display_name,
        attachment_type,
    )
}

#[tauri::command]
pub fn get_income_attachments(
    state: State<'_, AppState>,
    income_id: String,
) -> Result<Vec<Attachment>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM attachments WHERE income_id = ?1 ORDER BY created_at",
        ATTACHMENT_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let attachments = stmt
        .query_map([&income_id], row_to_attachment)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(attachments)
}

#[tauri::command]
pub fn get_income_receipt_attachments(
    state: State<'_, AppState>,
    receipt_id: String,
) -> Result<Vec<Attachment>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM attachments WHERE income_receipt_id = ?1 ORDER BY created_at",
        ATTACHMENT_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let attachments = stmt
        .query_map([&receipt_id], row_to_attachment)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(attachments)
}

#[tauri::command]
pub fn add_income_attachment(
    state: State<'_, AppState>,
    income_id: String,
    source_path: String,
    display_name: Option<String>,
    attachment_type: Option<String>,
) -> Result<Attachment, String> {
    insert_polymorphic_attachment(
        &state,
        AttachmentTarget::Income(&income_id),
        &source_path,
        display_name,
        attachment_type,
    )
}

#[tauri::command]
pub fn add_income_receipt_attachment(
    state: State<'_, AppState>,
    receipt_id: String,
    source_path: String,
    display_name: Option<String>,
    attachment_type: Option<String>,
) -> Result<Attachment, String> {
    insert_polymorphic_attachment(
        &state,
        AttachmentTarget::IncomeReceipt(&receipt_id),
        &source_path,
        display_name,
        attachment_type,
    )
}

#[tauri::command]
pub fn add_attachment(
    state: State<'_, AppState>,
    item_id: String,
    source_path: String,
    display_name: Option<String>,
    attachment_type: Option<String>,
    // When share_with_order is true, the attachment is linked at the item's
    // order_id (visible from every sibling). Item must already be in an order.
    share_with_order: Option<bool>,
) -> Result<Attachment, String> {
    // Validate user-provided path (must come from open() dialog, absolute, no ..)
    let safe_source = validate_read_source(&source_path)?;
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
    let display = display_name.unwrap_or_else(|| original_name.clone());
    let att_type = attachment_type.unwrap_or_else(|| "other".to_string());
    let id = Uuid::new_v4().to_string();

    // Encrypt and save to disk
    let vault_dir = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir.as_ref().ok_or("No active vault")?;
    let key_guard = state.encryption_key.lock().map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?;
    let key_bytes: &[u8; 32] = key;

    let file_path = storage::save_attachment(vault_dir, &id, &data, key_bytes)?;

    // Insert into database
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Resolve the order_id if the caller asks to share it with the whole order.
    let (db_item_id, db_order_id): (Option<String>, Option<String>) = if share_with_order.unwrap_or(false) {
        let order_id: Option<String> = conn
            .query_row("SELECT order_id FROM items WHERE id = ?1", [&item_id], |row| row.get(0))
            .map_err(|e| format!("Item not found: {}", e))?;
        match order_id {
            Some(oid) => (None, Some(oid)),
            None => return Err("Cet article ne fait pas partie d'un achat groupé".to_string()),
        }
    } else {
        (Some(item_id.clone()), None)
    };

    conn.execute(
        "INSERT INTO attachments (id, item_id, order_id, subscription_id, original_name, display_name, mime_type, file_path, size_bytes, attachment_type)
         VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![id, db_item_id, db_order_id, original_name, display, mime_type, file_path, size_bytes, att_type],
    ).map_err(|e| e.to_string())?;

    let select_sql = format!(
        "SELECT {} FROM attachments WHERE id = ?1",
        ATTACHMENT_SELECT_COLUMNS
    );
    conn.query_row(&select_sql, [&id], row_to_attachment)
        .map_err(|e| e.to_string())
}

/// Attach a file to a subscription (invoice, contract, plan terms…). Same
/// encryption pipeline as the item version, just polymorphic on
/// `subscription_id`.
#[tauri::command]
pub fn add_subscription_attachment(
    state: State<'_, AppState>,
    subscription_id: String,
    source_path: String,
    display_name: Option<String>,
    attachment_type: Option<String>,
) -> Result<Attachment, String> {
    let safe_source = validate_read_source(&source_path)?;
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
    let display = display_name.unwrap_or_else(|| original_name.clone());
    let att_type = attachment_type.unwrap_or_else(|| "other".to_string());
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

    conn.execute(
        "INSERT INTO attachments (id, item_id, order_id, subscription_id, original_name, display_name, mime_type, file_path, size_bytes, attachment_type)
         VALUES (?1, NULL, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, subscription_id, original_name, display, mime_type, file_path, size_bytes, att_type],
    ).map_err(|e| e.to_string())?;

    let select_sql = format!(
        "SELECT {} FROM attachments WHERE id = ?1",
        ATTACHMENT_SELECT_COLUMNS
    );
    conn.query_row(&select_sql, [&id], row_to_attachment)
        .map_err(|e| e.to_string())
}

/// Inline secret payload (voucher code, license key, activation key…). The
/// caller passes the raw text and it is encrypted on disk just like a normal
/// file attachment. This avoids forcing the user to first write the code to a
/// temp file, while keeping the same security model (ChaCha20-Poly1305, no
/// plaintext stored in the DB).
#[tauri::command]
pub fn add_text_attachment(
    state: State<'_, AppState>,
    item_id: String,
    content: String,
    display_name: Option<String>,
    attachment_type: Option<String>,
) -> Result<Attachment, String> {
    if content.is_empty() {
        return Err("Le contenu ne peut pas être vide".to_string());
    }
    // 1 MiB cap is generous for a code/key — protects against accidental huge
    // pastes that would bloat the encrypted file pool.
    if content.len() > 1024 * 1024 {
        return Err("Contenu trop volumineux (max 1 MB)".to_string());
    }

    let data = content.into_bytes();
    let size_bytes = data.len() as i64;
    let att_type = attachment_type.unwrap_or_else(|| "secret".to_string());
    let display = display_name.unwrap_or_else(|| match att_type.as_str() {
        "voucher_code" => "Code voucher".to_string(),
        "license_key" => "Clé licence".to_string(),
        "ticket_code" => "Code billet".to_string(),
        _ => "Code".to_string(),
    });
    let original_name = format!("{}.txt", display);
    let mime_type = "text/plain".to_string();
    let id = Uuid::new_v4().to_string();

    // Encrypt and save to disk
    let vault_dir = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir.as_ref().ok_or("No active vault")?;
    let key_guard = state.encryption_key.lock().map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?;
    let key_bytes: &[u8; 32] = key;

    let file_path = storage::save_attachment(vault_dir, &id, &data, key_bytes)?;

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "INSERT INTO attachments (id, item_id, order_id, subscription_id, original_name, display_name, mime_type, file_path, size_bytes, attachment_type)
         VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, item_id, original_name, display, mime_type, file_path, size_bytes, att_type],
    ).map_err(|e| e.to_string())?;

    let select_sql = format!(
        "SELECT {} FROM attachments WHERE id = ?1",
        ATTACHMENT_SELECT_COLUMNS
    );
    conn.query_row(&select_sql, [&id], row_to_attachment)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_attachment(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Get file path before deleting record
    let file_path: String = conn.query_row(
        "SELECT file_path FROM attachments WHERE id = ?1",
        [&id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM attachments WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    // Resolve through the current vault so we delete the right file even if
    // the stored path is from a previous vault (post-restore situation).
    let vault_dir_guard = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
    if let Some(vault_dir) = vault_dir_guard.as_ref() {
        let attachments_root = storage::attachments_dir(vault_dir);
        if let Ok(resolved) = storage::resolve_attachment(&file_path, &attachments_root) {
            let _ = storage::delete_attachment_file(resolved.to_str().unwrap_or(""));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn export_attachment(
    state: State<'_, AppState>,
    id: String,
    destination: String,
) -> Result<(), String> {
    // Validate the destination before doing any work.
    let safe_dest = validate_write_target(&destination)?;

    let vault_dir_guard = state
        .vault_dir
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir_guard.as_ref().ok_or("No active vault")?;
    let attachments_root = storage::attachments_dir(vault_dir);

    let db_guard = state
        .db
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let file_path: String = conn
        .query_row(
            "SELECT file_path FROM attachments WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Resolve via basename against the current vault — survives vault renames
    // and backup restores where the stored path may be obsolete.
    let safe_source = storage::resolve_attachment(&file_path, &attachments_root)?;

    let key_guard = state
        .encryption_key
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?;
    let key_bytes: &[u8; 32] = key;

    let data = storage::read_attachment(safe_source.to_str().unwrap_or(""), key_bytes)?;
    std::fs::write(&safe_dest, &data)
        .map_err(|e| format!("Failed to write exported file: {}", e))?;

    Ok(())
}

/// Decrypt an attachment and return it as a base64 data URL suitable for
/// inline rendering (e.g. `<img src="...">`). Capped at 10 MB decrypted to
/// avoid blowing up the JS heap on accidental huge files.
#[tauri::command]
pub fn get_attachment_data(state: State<'_, AppState>, id: String) -> Result<String, String> {
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
            "SELECT file_path, mime_type FROM attachments WHERE id = ?1",
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
        return Err("Attachment too large for inline display (max 10 MB)".to_string());
    }

    Ok(format!(
        "data:{};base64,{}",
        mime_type,
        general_purpose::STANDARD.encode(&data)
    ))
}

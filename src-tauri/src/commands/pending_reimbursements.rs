use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{CreateReimbursementRequest, PendingReimbursement};

const REIMB_SELECT_COLUMNS: &str =
    "r.id, r.label, r.reimbursement_type, r.expected_amount, r.received_amount,
     r.currency, r.debtor_name, r.debtor_creditor_id, r.item_id, r.engagement_charge_id,
     r.source_description, r.requested_on, r.expected_by, r.received_on, r.status,
     r.notes, r.created_at, r.updated_at,
     cr.name as debtor_creditor_name, i.description as item_description";

const REIMB_JOINS: &str =
    "LEFT JOIN creditors cr ON r.debtor_creditor_id = cr.id
     LEFT JOIN items i ON r.item_id = i.id";

fn row_to_reimbursement(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingReimbursement> {
    Ok(PendingReimbursement {
        id: row.get(0)?,
        label: row.get(1)?,
        reimbursement_type: row.get(2)?,
        expected_amount: row.get(3)?,
        received_amount: row.get(4)?,
        currency: row.get(5)?,
        debtor_name: row.get(6)?,
        debtor_creditor_id: row.get(7)?,
        item_id: row.get(8)?,
        engagement_charge_id: row.get(9)?,
        source_description: row.get(10)?,
        requested_on: row.get(11)?,
        expected_by: row.get(12)?,
        received_on: row.get(13)?,
        status: row.get(14)?,
        notes: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        debtor_creditor_name: row.get(18)?,
        item_description: row.get(19)?,
    })
}

#[tauri::command]
pub fn list_pending_reimbursements(
    state: State<'_, AppState>,
    status: Option<String>,
) -> Result<Vec<PendingReimbursement>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut sql = format!(
        "SELECT {} FROM pending_reimbursements r {} WHERE 1=1",
        REIMB_SELECT_COLUMNS, REIMB_JOINS
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref s) = status {
        if s != "all" && !s.is_empty() {
            sql.push_str(" AND r.status = ?");
            params.push(Box::new(s.clone()));
        }
    }
    sql.push_str(" ORDER BY COALESCE(r.expected_by, r.requested_on, r.created_at) DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_reimbursement)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn get_pending_reimbursement(
    state: State<'_, AppState>,
    id: String,
) -> Result<PendingReimbursement, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM pending_reimbursements r {} WHERE r.id = ?1",
        REIMB_SELECT_COLUMNS, REIMB_JOINS
    );
    conn.query_row(&sql, [&id], row_to_reimbursement)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_pending_reimbursement(
    state: State<'_, AppState>,
    reimb: CreateReimbursementRequest,
) -> Result<PendingReimbursement, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = reimb.currency.unwrap_or_else(|| "CHF".to_string());
    let status = reimb.status.unwrap_or_else(|| "pending".to_string());
    let reimbursement_type = reimb.reimbursement_type.unwrap_or_else(|| "other".to_string());

    conn.execute(
        "INSERT INTO pending_reimbursements (id, label, reimbursement_type, expected_amount,
         currency, debtor_name, debtor_creditor_id, item_id, engagement_charge_id,
         source_description, requested_on, expected_by, status, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            id,
            reimb.label,
            reimbursement_type,
            reimb.expected_amount,
            currency,
            reimb.debtor_name,
            reimb.debtor_creditor_id,
            reimb.item_id,
            reimb.engagement_charge_id,
            reimb.source_description,
            reimb.requested_on,
            reimb.expected_by,
            status,
            reimb.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM pending_reimbursements r {} WHERE r.id = ?1",
        REIMB_SELECT_COLUMNS, REIMB_JOINS
    );
    conn.query_row(&sql, [&id], row_to_reimbursement)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_pending_reimbursement(
    state: State<'_, AppState>,
    reimb: PendingReimbursement,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE pending_reimbursements SET label = ?1, reimbursement_type = ?2,
         expected_amount = ?3, received_amount = ?4, currency = ?5, debtor_name = ?6,
         debtor_creditor_id = ?7, item_id = ?8, engagement_charge_id = ?9,
         source_description = ?10, requested_on = ?11, expected_by = ?12, received_on = ?13,
         status = ?14, notes = ?15, updated_at = datetime('now')
         WHERE id = ?16",
        rusqlite::params![
            reimb.label,
            reimb.reimbursement_type,
            reimb.expected_amount,
            reimb.received_amount,
            reimb.currency,
            reimb.debtor_name,
            reimb.debtor_creditor_id,
            reimb.item_id,
            reimb.engagement_charge_id,
            reimb.source_description,
            reimb.requested_on,
            reimb.expected_by,
            reimb.received_on,
            reimb.status,
            reimb.notes,
            reimb.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// One-shot status change to 'claimed' with `requested_on` defaulting to today.
/// Lets the UI offer a "Marquer demandé" quick action without exposing the
/// full update form.
#[tauri::command]
pub fn mark_reimbursement_claimed(
    state: State<'_, AppState>,
    id: String,
    requested_on: Option<String>,
) -> Result<PendingReimbursement, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let date = requested_on.unwrap_or_else(|| {
        let today: String = conn
            .query_row("SELECT date('now')", [], |row| row.get(0))
            .unwrap_or_else(|_| "".to_string());
        today
    });

    conn.execute(
        "UPDATE pending_reimbursements SET status = 'claimed',
         requested_on = COALESCE(requested_on, ?1), updated_at = datetime('now')
         WHERE id = ?2",
        rusqlite::params![date, id],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM pending_reimbursements r {} WHERE r.id = ?1",
        REIMB_SELECT_COLUMNS, REIMB_JOINS
    );
    conn.query_row(&sql, [&id], row_to_reimbursement)
        .map_err(|e| e.to_string())
}

/// Settle a claim with the amount actually received. If `received_amount`
/// is less than `expected_amount`, the status becomes 'partial'; otherwise
/// 'settled'. This matches the typical workflow where the user receives
/// confirmation from the debtor and types the credited amount.
#[tauri::command]
pub fn mark_reimbursement_settled(
    state: State<'_, AppState>,
    id: String,
    received_on: String,
    received_amount: f64,
) -> Result<PendingReimbursement, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let expected: Option<f64> = conn
        .query_row(
            "SELECT expected_amount FROM pending_reimbursements WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let status = match expected {
        Some(exp) if received_amount + 0.01 < exp => "partial",
        _ => "settled",
    };

    conn.execute(
        "UPDATE pending_reimbursements SET status = ?1, received_on = ?2,
         received_amount = ?3, updated_at = datetime('now')
         WHERE id = ?4",
        rusqlite::params![status, received_on, received_amount, id],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM pending_reimbursements r {} WHERE r.id = ?1",
        REIMB_SELECT_COLUMNS, REIMB_JOINS
    );
    conn.query_row(&sql, [&id], row_to_reimbursement)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_pending_reimbursement(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Wipe attached justificatifs (note de frais PDF, courriers d'assurance,
    // accusés de réception…) before CASCADE removes the row.
    let attachment_paths: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT file_path FROM attachments WHERE reimbursement_id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    conn.execute("DELETE FROM pending_reimbursements WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    for path in attachment_paths {
        let _ = crate::storage::delete_attachment_file(&path);
    }

    Ok(())
}

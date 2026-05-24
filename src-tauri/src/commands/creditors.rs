use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{CreateCreditorRequest, Creditor};

const CREDITOR_SELECT_COLUMNS: &str =
    "id, name, creditor_type, contact_email, contact_phone, address, iban,
     reference_prefix, notes, logo_path, created_at, updated_at";

fn row_to_creditor(row: &rusqlite::Row<'_>) -> rusqlite::Result<Creditor> {
    Ok(Creditor {
        id: row.get(0)?,
        name: row.get(1)?,
        creditor_type: row.get(2)?,
        contact_email: row.get(3)?,
        contact_phone: row.get(4)?,
        address: row.get(5)?,
        iban: row.get(6)?,
        reference_prefix: row.get(7)?,
        notes: row.get(8)?,
        logo_path: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

#[tauri::command]
pub fn get_creditors(
    state: State<'_, AppState>,
    creditor_type: Option<String>,
) -> Result<Vec<Creditor>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match creditor_type {
        Some(ref t) if !t.is_empty() && t != "all" => (
            format!(
                "SELECT {} FROM creditors WHERE creditor_type = ?1 ORDER BY name",
                CREDITOR_SELECT_COLUMNS
            ),
            vec![Box::new(t.clone())],
        ),
        _ => (
            format!("SELECT {} FROM creditors ORDER BY name", CREDITOR_SELECT_COLUMNS),
            vec![],
        ),
    };

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_creditor)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn create_creditor(
    state: State<'_, AppState>,
    creditor: CreateCreditorRequest,
) -> Result<Creditor, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let creditor_type = creditor.creditor_type.unwrap_or_else(|| "other".to_string());

    conn.execute(
        "INSERT INTO creditors (id, name, creditor_type, contact_email, contact_phone, address,
         iban, reference_prefix, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            id,
            creditor.name,
            creditor_type,
            creditor.contact_email,
            creditor.contact_phone,
            creditor.address,
            creditor.iban,
            creditor.reference_prefix,
            creditor.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!("SELECT {} FROM creditors WHERE id = ?1", CREDITOR_SELECT_COLUMNS);
    conn.query_row(&sql, [&id], row_to_creditor)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_creditor(state: State<'_, AppState>, creditor: Creditor) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE creditors SET name = ?1, creditor_type = ?2, contact_email = ?3,
         contact_phone = ?4, address = ?5, iban = ?6, reference_prefix = ?7,
         notes = ?8, logo_path = ?9, updated_at = datetime('now')
         WHERE id = ?10",
        rusqlite::params![
            creditor.name,
            creditor.creditor_type,
            creditor.contact_email,
            creditor.contact_phone,
            creditor.address,
            creditor.iban,
            creditor.reference_prefix,
            creditor.notes,
            creditor.logo_path,
            creditor.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_creditor(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM creditors WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

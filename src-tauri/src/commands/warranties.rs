use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{CreateWarrantyRequest, Warranty};

#[tauri::command]
pub fn get_warranties(state: State<'_, AppState>, item_id: Option<String>) -> Result<Vec<Warranty>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // start_date and end_date are always derived from the item's purchase_date.
    // The warranties.start_date column is ignored (kept for legacy data only).
    let (sql, params): (String, Vec<String>) = if let Some(ref iid) = item_id {
        (
            "SELECT w.id, w.item_id, i.purchase_date as start_date, w.duration_months, w.notes, w.created_at, w.updated_at,
                    date(i.purchase_date, '+' || w.duration_months || ' months') as end_date,
                    i.description as item_description
             FROM warranties w
             INNER JOIN items i ON w.item_id = i.id
             WHERE w.item_id = ?1
             ORDER BY i.purchase_date".to_string(),
            vec![iid.clone()],
        )
    } else {
        (
            "SELECT w.id, w.item_id, i.purchase_date as start_date, w.duration_months, w.notes, w.created_at, w.updated_at,
                    date(i.purchase_date, '+' || w.duration_months || ' months') as end_date,
                    i.description as item_description
             FROM warranties w
             INNER JOIN items i ON w.item_id = i.id
             ORDER BY end_date".to_string(),
            vec![],
        )
    };

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let warranties = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(Warranty {
                id: row.get(0)?,
                item_id: row.get(1)?,
                start_date: row.get(2)?,
                duration_months: row.get(3)?,
                notes: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                end_date: row.get(7)?,
                item_description: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(warranties)
}

#[tauri::command]
pub fn get_expiring_warranties(state: State<'_, AppState>, days: Option<i32>) -> Result<Vec<Warranty>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let days = days.unwrap_or(30);

    let mut stmt = conn.prepare(
        "SELECT w.id, w.item_id, i.purchase_date as start_date, w.duration_months, w.notes, w.created_at, w.updated_at,
                date(i.purchase_date, '+' || w.duration_months || ' months') as end_date,
                i.description as item_description
         FROM warranties w
         INNER JOIN items i ON w.item_id = i.id
         WHERE date(i.purchase_date, '+' || w.duration_months || ' months') >= date('now')
           AND date(i.purchase_date, '+' || w.duration_months || ' months') <= date('now', '+' || ?1 || ' days')
         ORDER BY end_date"
    ).map_err(|e| e.to_string())?;

    let warranties = stmt
        .query_map([days], |row| {
            Ok(Warranty {
                id: row.get(0)?,
                item_id: row.get(1)?,
                start_date: row.get(2)?,
                duration_months: row.get(3)?,
                notes: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                end_date: row.get(7)?,
                item_description: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(warranties)
}

#[tauri::command]
pub fn create_warranty(state: State<'_, AppState>, warranty: CreateWarrantyRequest) -> Result<Warranty, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();

    // Warranty start_date is always the item's purchase_date — clients cannot
    // override it. Any value sent in the request is ignored.
    let start_date: String = conn
        .query_row(
            "SELECT purchase_date FROM items WHERE id = ?1",
            [&warranty.item_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Item not found: {}", e))?;

    conn.execute(
        "INSERT INTO warranties (id, item_id, start_date, duration_months, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, warranty.item_id, start_date, warranty.duration_months, warranty.notes],
    ).map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT w.id, w.item_id, i.purchase_date as start_date, w.duration_months, w.notes, w.created_at, w.updated_at,
                date(i.purchase_date, '+' || w.duration_months || ' months') as end_date,
                i.description as item_description
         FROM warranties w INNER JOIN items i ON w.item_id = i.id WHERE w.id = ?1",
        [&id],
        |row| Ok(Warranty {
            id: row.get(0)?, item_id: row.get(1)?, start_date: row.get(2)?,
            duration_months: row.get(3)?, notes: row.get(4)?, created_at: row.get(5)?,
            updated_at: row.get(6)?, end_date: row.get(7)?, item_description: row.get(8)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_warranty(state: State<'_, AppState>, warranty: Warranty) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // start_date is intentionally not editable — it always reflects the
    // item's purchase_date set at creation time.
    conn.execute(
        "UPDATE warranties SET duration_months = ?1, notes = ?2, updated_at = datetime('now') WHERE id = ?3",
        rusqlite::params![warranty.duration_months, warranty.notes, warranty.id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_warranty(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM warranties WHERE id = ?1", [&id]).map_err(|e| e.to_string())?;
    Ok(())
}

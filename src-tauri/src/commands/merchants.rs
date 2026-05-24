use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{CreateMerchantRequest, Merchant};

#[tauri::command]
pub fn get_merchants(state: State<'_, AppState>) -> Result<Vec<Merchant>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, contact_email, contact_phone, address, logo_path, created_at, updated_at FROM merchants ORDER BY name")
        .map_err(|e| e.to_string())?;

    let merchants = stmt
        .query_map([], |row| {
            Ok(Merchant {
                id: row.get(0)?,
                name: row.get(1)?,
                contact_email: row.get(2)?,
                contact_phone: row.get(3)?,
                address: row.get(4)?,
                logo_path: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(merchants)
}

#[tauri::command]
pub fn create_merchant(
    state: State<'_, AppState>,
    merchant: CreateMerchantRequest,
) -> Result<Merchant, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO merchants (id, name, contact_email, contact_phone, address) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            id,
            merchant.name,
            merchant.contact_email,
            merchant.contact_phone,
            merchant.address
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, contact_email, contact_phone, address, logo_path, created_at, updated_at FROM merchants WHERE id = ?1",
        [&id],
        |row| Ok(Merchant {
            id: row.get(0)?,
            name: row.get(1)?,
            contact_email: row.get(2)?,
            contact_phone: row.get(3)?,
            address: row.get(4)?,
            logo_path: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_merchant(state: State<'_, AppState>, merchant: Merchant) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE merchants SET name = ?1, contact_email = ?2, contact_phone = ?3, address = ?4, logo_path = ?5, updated_at = datetime('now') WHERE id = ?6",
        rusqlite::params![
            merchant.name,
            merchant.contact_email,
            merchant.contact_phone,
            merchant.address,
            merchant.logo_path,
            merchant.id
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_merchant(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM merchants WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

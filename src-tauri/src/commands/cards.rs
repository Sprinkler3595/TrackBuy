use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{CreateCardRequest, PaymentCard};

#[tauri::command]
pub fn get_cards(state: State<'_, AppState>) -> Result<Vec<PaymentCard>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, is_credit_card, extended_warranty_months, extended_warranty_description, created_at, updated_at FROM payment_cards ORDER BY name")
        .map_err(|e| e.to_string())?;

    let cards = stmt
        .query_map([], |row| {
            Ok(PaymentCard {
                id: row.get(0)?,
                name: row.get(1)?,
                is_credit_card: row.get(2)?,
                extended_warranty_months: row.get(3)?,
                extended_warranty_description: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(cards)
}

#[tauri::command]
pub fn create_card(state: State<'_, AppState>, card: CreateCardRequest) -> Result<PaymentCard, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let warranty_months = card.extended_warranty_months.unwrap_or(0);

    conn.execute(
        "INSERT INTO payment_cards (id, name, is_credit_card, extended_warranty_months, extended_warranty_description) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, card.name, card.is_credit_card, warranty_months, card.extended_warranty_description],
    ).map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, name, is_credit_card, extended_warranty_months, extended_warranty_description, created_at, updated_at FROM payment_cards WHERE id = ?1",
        [&id],
        |row| Ok(PaymentCard {
            id: row.get(0)?, name: row.get(1)?, is_credit_card: row.get(2)?,
            extended_warranty_months: row.get(3)?, extended_warranty_description: row.get(4)?,
            created_at: row.get(5)?, updated_at: row.get(6)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_card(state: State<'_, AppState>, card: PaymentCard) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE payment_cards SET name = ?1, is_credit_card = ?2, extended_warranty_months = ?3, extended_warranty_description = ?4, updated_at = datetime('now') WHERE id = ?5",
        rusqlite::params![card.name, card.is_credit_card, card.extended_warranty_months, card.extended_warranty_description, card.id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_card(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM payment_cards WHERE id = ?1", [&id]).map_err(|e| e.to_string())?;
    Ok(())
}

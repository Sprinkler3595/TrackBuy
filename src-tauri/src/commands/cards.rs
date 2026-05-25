use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{CreateCardRequest, PaymentCard};

const CARD_SELECT_COLUMNS: &str =
    "id, name, is_credit_card, extended_warranty_months, extended_warranty_description,
     account_kind, iban, bic, account_holder, institution, created_at, updated_at";

fn row_to_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<PaymentCard> {
    Ok(PaymentCard {
        id: row.get(0)?,
        name: row.get(1)?,
        is_credit_card: row.get(2)?,
        extended_warranty_months: row.get(3)?,
        extended_warranty_description: row.get(4)?,
        account_kind: row.get(5)?,
        iban: row.get(6)?,
        bic: row.get(7)?,
        account_holder: row.get(8)?,
        institution: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

#[tauri::command]
pub fn get_cards(state: State<'_, AppState>) -> Result<Vec<PaymentCard>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!("SELECT {} FROM payment_cards ORDER BY name", CARD_SELECT_COLUMNS);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let cards = stmt
        .query_map([], row_to_card)
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
    let account_kind = card.account_kind.unwrap_or_else(|| "card".to_string());

    conn.execute(
        "INSERT INTO payment_cards (id, name, is_credit_card, extended_warranty_months,
         extended_warranty_description, account_kind, iban, bic, account_holder, institution)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            id,
            card.name,
            card.is_credit_card,
            warranty_months,
            card.extended_warranty_description,
            account_kind,
            card.iban,
            card.bic,
            card.account_holder,
            card.institution,
        ],
    ).map_err(|e| e.to_string())?;

    let sql = format!("SELECT {} FROM payment_cards WHERE id = ?1", CARD_SELECT_COLUMNS);
    conn.query_row(&sql, [&id], row_to_card).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_card(state: State<'_, AppState>, card: PaymentCard) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE payment_cards SET name = ?1, is_credit_card = ?2, extended_warranty_months = ?3,
         extended_warranty_description = ?4, account_kind = ?5, iban = ?6, bic = ?7,
         account_holder = ?8, institution = ?9, updated_at = datetime('now')
         WHERE id = ?10",
        rusqlite::params![
            card.name,
            card.is_credit_card,
            card.extended_warranty_months,
            card.extended_warranty_description,
            card.account_kind,
            card.iban,
            card.bic,
            card.account_holder,
            card.institution,
            card.id,
        ],
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

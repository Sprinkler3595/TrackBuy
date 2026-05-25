use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{
    CreateIncomeReceiptRequest, CreateIncomeRequest, Income, IncomeReceipt,
};

const INCOME_SELECT_COLUMNS: &str =
    "i.id, i.name, i.income_type, i.source_name, i.payment_card_id, i.billing_cycle,
     i.cycle_interval, i.next_expected_date, i.current_amount, i.currency, i.status,
     i.started_on, i.ended_on, i.notes, i.created_at, i.updated_at,
     pc.name as card_name";

fn row_to_income(row: &rusqlite::Row<'_>) -> rusqlite::Result<Income> {
    Ok(Income {
        id: row.get(0)?,
        name: row.get(1)?,
        income_type: row.get(2)?,
        source_name: row.get(3)?,
        payment_card_id: row.get(4)?,
        billing_cycle: row.get(5)?,
        cycle_interval: row.get(6)?,
        next_expected_date: row.get(7)?,
        current_amount: row.get(8)?,
        currency: row.get(9)?,
        status: row.get(10)?,
        started_on: row.get(11)?,
        ended_on: row.get(12)?,
        notes: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
        card_name: row.get(16)?,
    })
}

const RECEIPT_SELECT_COLUMNS: &str =
    "id, income_id, received_on, amount, currency, period_label,
     gross_amount, social_charges_amount, pension_amount, tax_at_source_amount,
     other_deductions_amount, bonus_amount, notes, created_at";

fn row_to_receipt(row: &rusqlite::Row<'_>) -> rusqlite::Result<IncomeReceipt> {
    Ok(IncomeReceipt {
        id: row.get(0)?,
        income_id: row.get(1)?,
        received_on: row.get(2)?,
        amount: row.get(3)?,
        currency: row.get(4)?,
        period_label: row.get(5)?,
        gross_amount: row.get(6)?,
        social_charges_amount: row.get(7)?,
        pension_amount: row.get(8)?,
        tax_at_source_amount: row.get(9)?,
        other_deductions_amount: row.get(10)?,
        bonus_amount: row.get(11)?,
        notes: row.get(12)?,
        created_at: row.get(13)?,
    })
}

#[tauri::command]
pub fn get_incomes(
    state: State<'_, AppState>,
    status: Option<String>,
    income_type: Option<String>,
) -> Result<Vec<Income>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut sql = format!(
        "SELECT {} FROM incomes i
         LEFT JOIN payment_cards pc ON i.payment_card_id = pc.id
         WHERE 1=1",
        INCOME_SELECT_COLUMNS
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref s) = status {
        if s != "all" && !s.is_empty() {
            sql.push_str(" AND i.status = ?");
            params.push(Box::new(s.clone()));
        }
    }
    if let Some(ref t) = income_type {
        if !t.is_empty() {
            sql.push_str(" AND i.income_type = ?");
            params.push(Box::new(t.clone()));
        }
    }
    sql.push_str(" ORDER BY i.next_expected_date");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_income)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn get_income(state: State<'_, AppState>, id: String) -> Result<Income, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM incomes i
         LEFT JOIN payment_cards pc ON i.payment_card_id = pc.id
         WHERE i.id = ?1",
        INCOME_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_income)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_income(
    state: State<'_, AppState>,
    income: CreateIncomeRequest,
) -> Result<Income, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = income.currency.unwrap_or_else(|| "CHF".to_string());
    let status = income.status.unwrap_or_else(|| "active".to_string());
    let cycle_interval = income.cycle_interval.unwrap_or(1).max(1);

    conn.execute(
        "INSERT INTO incomes (id, name, income_type, source_name, payment_card_id,
         billing_cycle, cycle_interval, next_expected_date, current_amount, currency,
         status, started_on, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            id,
            income.name,
            income.income_type,
            income.source_name,
            income.payment_card_id,
            income.billing_cycle,
            cycle_interval,
            income.next_expected_date,
            income.current_amount,
            currency,
            status,
            income.started_on,
            income.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM incomes i
         LEFT JOIN payment_cards pc ON i.payment_card_id = pc.id
         WHERE i.id = ?1",
        INCOME_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_income)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_income(state: State<'_, AppState>, income: Income) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE incomes SET name = ?1, income_type = ?2, source_name = ?3,
         payment_card_id = ?4, billing_cycle = ?5, cycle_interval = ?6,
         next_expected_date = ?7, current_amount = ?8, currency = ?9, status = ?10,
         started_on = ?11, ended_on = ?12, notes = ?13, updated_at = datetime('now')
         WHERE id = ?14",
        rusqlite::params![
            income.name,
            income.income_type,
            income.source_name,
            income.payment_card_id,
            income.billing_cycle,
            income.cycle_interval.max(1),
            income.next_expected_date,
            income.current_amount,
            income.currency,
            income.status,
            income.started_on,
            income.ended_on,
            income.notes,
            income.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_income(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Wipe attached PDFs (payslips, source documents) for the income itself
    // AND all its receipts before CASCADE drops the rows. Same pattern as
    // delete_engagement.
    let attachment_paths: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT file_path FROM attachments
                 WHERE income_id = ?1
                    OR income_receipt_id IN (SELECT id FROM income_receipts WHERE income_id = ?1)",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    conn.execute("DELETE FROM incomes WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    for path in attachment_paths {
        let _ = crate::storage::delete_attachment_file(&path);
    }

    Ok(())
}

#[tauri::command]
pub fn get_income_receipts(
    state: State<'_, AppState>,
    income_id: String,
) -> Result<Vec<IncomeReceipt>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM income_receipts WHERE income_id = ?1 ORDER BY received_on DESC",
        RECEIPT_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&income_id], row_to_receipt)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn log_income_receipt(
    state: State<'_, AppState>,
    receipt: CreateIncomeReceiptRequest,
) -> Result<IncomeReceipt, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = receipt.currency.unwrap_or_else(|| "CHF".to_string());

    conn.execute(
        "INSERT INTO income_receipts (id, income_id, received_on, amount, currency,
         period_label, gross_amount, social_charges_amount, pension_amount,
         tax_at_source_amount, other_deductions_amount, bonus_amount, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            id,
            receipt.income_id,
            receipt.received_on,
            receipt.amount,
            currency,
            receipt.period_label,
            receipt.gross_amount,
            receipt.social_charges_amount,
            receipt.pension_amount,
            receipt.tax_at_source_amount,
            receipt.other_deductions_amount,
            receipt.bonus_amount,
            receipt.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM income_receipts WHERE id = ?1",
        RECEIPT_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_receipt)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_income_receipt(
    state: State<'_, AppState>,
    receipt: IncomeReceipt,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE income_receipts SET received_on = ?1, amount = ?2, currency = ?3,
         period_label = ?4, gross_amount = ?5, social_charges_amount = ?6,
         pension_amount = ?7, tax_at_source_amount = ?8, other_deductions_amount = ?9,
         bonus_amount = ?10, notes = ?11
         WHERE id = ?12",
        rusqlite::params![
            receipt.received_on,
            receipt.amount,
            receipt.currency,
            receipt.period_label,
            receipt.gross_amount,
            receipt.social_charges_amount,
            receipt.pension_amount,
            receipt.tax_at_source_amount,
            receipt.other_deductions_amount,
            receipt.bonus_amount,
            receipt.notes,
            receipt.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_income_receipt(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Wipe attached PDFs (payslips) before CASCADE removes the row.
    let attachment_paths: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT file_path FROM attachments WHERE income_receipt_id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    conn.execute("DELETE FROM income_receipts WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    for path in attachment_paths {
        let _ = crate::storage::delete_attachment_file(&path);
    }

    Ok(())
}

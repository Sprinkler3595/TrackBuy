use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{
    CreateIncomeReceiptRequest, CreateIncomeRequest, Income, IncomeReceipt,
};

const INCOME_SELECT_COLUMNS: &str =
    "i.id, i.name, i.income_type, i.source_name, i.payment_card_id, i.billing_cycle,
     i.cycle_interval, i.next_expected_date, i.current_amount, i.currency, i.status,
     i.started_on, i.ended_on, i.attributed_to_member_id, i.notes,
     i.created_at, i.updated_at, pc.name as card_name";

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
        attributed_to_member_id: row.get(13)?,
        notes: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
        card_name: row.get(17)?,
    })
}

/// Colonnes d'un versement, dans l'ordre attendu par `row_to_receipt`.
/// Regroupées comme sur un bulletin : identité, brut, retenues, frais.
pub(crate) const RECEIPT_SELECT_COLUMNS: &str = "id, income_id, received_on, amount, currency,
     period_label, period_start, period_end, fiscal_year,
     gross_amount, base_salary_amount, thirteenth_amount, overtime_amount,
     overtime_hours, holiday_pay_amount, bonus_amount, benefits_in_kind_amount,
     company_car_private_amount, family_allowance_amount, other_gross_amount,
     social_charges_amount, ac_amount, ac_solidarity_amount, pension_amount,
     laa_nonoccupational_amount, ijm_amount, tax_at_source_amount,
     other_deductions_amount,
     expense_reimbursement_amount, expense_lump_sum_amount,
     notes, created_at";

pub(crate) fn row_to_receipt(row: &rusqlite::Row<'_>) -> rusqlite::Result<IncomeReceipt> {
    Ok(IncomeReceipt {
        id: row.get(0)?,
        income_id: row.get(1)?,
        received_on: row.get(2)?,
        amount: row.get(3)?,
        currency: row.get(4)?,
        period_label: row.get(5)?,
        period_start: row.get(6)?,
        period_end: row.get(7)?,
        fiscal_year: row.get(8)?,
        gross_amount: row.get(9)?,
        base_salary_amount: row.get(10)?,
        thirteenth_amount: row.get(11)?,
        overtime_amount: row.get(12)?,
        overtime_hours: row.get(13)?,
        holiday_pay_amount: row.get(14)?,
        bonus_amount: row.get(15)?,
        benefits_in_kind_amount: row.get(16)?,
        company_car_private_amount: row.get(17)?,
        family_allowance_amount: row.get(18)?,
        other_gross_amount: row.get(19)?,
        social_charges_amount: row.get(20)?,
        ac_amount: row.get(21)?,
        ac_solidarity_amount: row.get(22)?,
        pension_amount: row.get(23)?,
        laa_nonoccupational_amount: row.get(24)?,
        ijm_amount: row.get(25)?,
        tax_at_source_amount: row.get(26)?,
        other_deductions_amount: row.get(27)?,
        expense_reimbursement_amount: row.get(28)?,
        expense_lump_sum_amount: row.get(29)?,
        notes: row.get(30)?,
        created_at: row.get(31)?,
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
         status, started_on, attributed_to_member_id, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
            income.attributed_to_member_id,
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
         started_on = ?11, ended_on = ?12, attributed_to_member_id = ?13, notes = ?14,
         updated_at = datetime('now')
         WHERE id = ?15",
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
            income.attributed_to_member_id,
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

    // Rattache le versement à une année fiscale : celle de la période
    // couverte si elle est connue, sinon celle de l'encaissement. Un salaire
    // de décembre versé en janvier appartient bien à l'année de la période.
    let fiscal_year = receipt.fiscal_year.or_else(|| {
        receipt
            .period_end
            .as_deref()
            .or(receipt.period_start.as_deref())
            .unwrap_or(receipt.received_on.as_str())
            .get(0..4)
            .and_then(|y| y.parse::<i32>().ok())
    });

    conn.execute(
        "INSERT INTO income_receipts (id, income_id, received_on, amount, currency,
         period_label, period_start, period_end, fiscal_year,
         gross_amount, base_salary_amount, thirteenth_amount, overtime_amount,
         overtime_hours, holiday_pay_amount, bonus_amount, benefits_in_kind_amount,
         company_car_private_amount, family_allowance_amount, other_gross_amount,
         social_charges_amount, ac_amount, ac_solidarity_amount, pension_amount,
         laa_nonoccupational_amount, ijm_amount, tax_at_source_amount,
         other_deductions_amount, expense_reimbursement_amount,
         expense_lump_sum_amount, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                 ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                 ?29, ?30, ?31)",
        rusqlite::params![
            id,
            receipt.income_id,
            receipt.received_on,
            receipt.amount,
            currency,
            receipt.period_label,
            receipt.period_start,
            receipt.period_end,
            fiscal_year,
            receipt.gross_amount,
            receipt.base_salary_amount,
            receipt.thirteenth_amount,
            receipt.overtime_amount,
            receipt.overtime_hours,
            receipt.holiday_pay_amount,
            receipt.bonus_amount,
            receipt.benefits_in_kind_amount,
            receipt.company_car_private_amount,
            receipt.family_allowance_amount,
            receipt.other_gross_amount,
            receipt.social_charges_amount,
            receipt.ac_amount,
            receipt.ac_solidarity_amount,
            receipt.pension_amount,
            receipt.laa_nonoccupational_amount,
            receipt.ijm_amount,
            receipt.tax_at_source_amount,
            receipt.other_deductions_amount,
            receipt.expense_reimbursement_amount,
            receipt.expense_lump_sum_amount,
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
         period_label = ?4, period_start = ?5, period_end = ?6, fiscal_year = ?7,
         gross_amount = ?8, base_salary_amount = ?9, thirteenth_amount = ?10,
         overtime_amount = ?11, overtime_hours = ?12, holiday_pay_amount = ?13,
         bonus_amount = ?14, benefits_in_kind_amount = ?15,
         company_car_private_amount = ?16, family_allowance_amount = ?17,
         other_gross_amount = ?18, social_charges_amount = ?19, ac_amount = ?20,
         ac_solidarity_amount = ?21, pension_amount = ?22,
         laa_nonoccupational_amount = ?23, ijm_amount = ?24,
         tax_at_source_amount = ?25, other_deductions_amount = ?26,
         expense_reimbursement_amount = ?27, expense_lump_sum_amount = ?28,
         notes = ?29
         WHERE id = ?30",
        rusqlite::params![
            receipt.received_on,
            receipt.amount,
            receipt.currency,
            receipt.period_label,
            receipt.period_start,
            receipt.period_end,
            receipt.fiscal_year,
            receipt.gross_amount,
            receipt.base_salary_amount,
            receipt.thirteenth_amount,
            receipt.overtime_amount,
            receipt.overtime_hours,
            receipt.holiday_pay_amount,
            receipt.bonus_amount,
            receipt.benefits_in_kind_amount,
            receipt.company_car_private_amount,
            receipt.family_allowance_amount,
            receipt.other_gross_amount,
            receipt.social_charges_amount,
            receipt.ac_amount,
            receipt.ac_solidarity_amount,
            receipt.pension_amount,
            receipt.laa_nonoccupational_amount,
            receipt.ijm_amount,
            receipt.tax_at_source_amount,
            receipt.other_deductions_amount,
            receipt.expense_reimbursement_amount,
            receipt.expense_lump_sum_amount,
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

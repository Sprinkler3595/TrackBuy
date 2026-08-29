use rusqlite::OptionalExtension;
use serde::Serialize;
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
     expense_reimbursement_amount, expense_lump_sum_amount, net_addition_amount,
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
        net_addition_amount: row.get(30)?,
        notes: row.get(31)?,
        created_at: row.get(32)?,
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
    // Les revenus actifs se lisent par échéance : c'est ce qui arrive
    // bientôt qui intéresse. Les revenus terminés se lisent en sens inverse,
    // du plus récemment quitté au premier employeur — c'est la chronologie
    // d'une carrière, et `next_expected_date` n'y veut plus rien dire.
    sql.push_str(
        " ORDER BY CASE WHEN i.status = 'ended' THEN 1 ELSE 0 END,
                   CASE WHEN i.status = 'ended'
                        THEN COALESCE(i.ended_on, i.started_on, '') END DESC,
                   i.next_expected_date",
    );

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
         status, started_on, ended_on, attributed_to_member_id, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
            income.ended_on,
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
         expense_lump_sum_amount, net_addition_amount, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                 ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                 ?29, ?30, ?31, ?32)",
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
            receipt.net_addition_amount,
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

// ===========================================================================
// Import en lot
// ===========================================================================

/// Année fiscale d'un versement à enregistrer : la période couverte prime sur
/// l'encaissement, comme partout ailleurs. Le salaire de décembre versé le
/// 5 janvier appartient à décembre.
fn request_fiscal_year(r: &CreateIncomeReceiptRequest) -> Option<i32> {
    r.fiscal_year.or_else(|| {
        r.period_end
            .as_deref()
            .or(r.period_start.as_deref())
            .unwrap_or(r.received_on.as_str())
            .get(0..4)
            .and_then(|y| y.parse::<i32>().ok())
    })
}

/// Signature de période d'un versement : ce qui fait qu'un bulletin est « le
/// même » qu'un autre. La fin de période prime, faute de quoi deux dates
/// d'encaissement différentes pour le même mois passeraient pour deux
/// bulletins distincts.
fn request_period_key(r: &CreateIncomeReceiptRequest) -> String {
    r.period_end
        .clone()
        .or_else(|| r.period_start.clone())
        .unwrap_or_else(|| r.received_on.clone())
}

/// Verdict d'une ligne du lot.
///
/// Le protocole `Err("DUPLICATE:…")` des transactions bancaires convient à une
/// ligne, pas à un lot de deux cents : une seule erreur globale obligerait à
/// tout recommencer pour un doublon. Chaque ligne reçoit donc son propre
/// verdict, et l'écran de revue peut montrer lesquelles sont passées.
#[derive(Debug, Serialize)]
pub struct BulkReceiptResult {
    /// Position dans le lot envoyé — le front recolle chaque verdict à sa
    /// ligne sans se fier à l'ordre de retour.
    pub index: usize,
    /// `created` | `replaced` | `duplicate` | `rejected`
    pub status: &'static str,
    pub receipt_id: Option<String>,
    /// Bulletin déjà enregistré pour la même période, le cas échéant.
    pub existing_id: Option<String>,
    pub message: Option<String>,
}

/// Enregistre plusieurs bulletins d'un coup.
///
/// Deux garde-fous repris de l'import des relevés bancaires :
///
/// 1. **tout est validé avant que la base ne soit touchée** — un lot à moitié
///    écrit après une erreur au trentième fichier serait pire que rien ;
/// 2. **une seule transaction** — deux cents INSERT unitaires repasseraient
///    chacun par le verrou de la base.
///
/// Un doublon n'est jamais écrasé en silence : sans `replace_duplicates`, la
/// ligne est refusée avec l'identifiant du bulletin déjà présent.
#[tauri::command]
pub fn log_income_receipts_bulk(
    state: State<'_, AppState>,
    receipts: Vec<CreateIncomeReceiptRequest>,
    replace_duplicates: Option<bool>,
) -> Result<Vec<BulkReceiptResult>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let mut conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    bulk_insert_receipts(&mut conn, receipts, replace_duplicates.unwrap_or(false))
}

/// Séparé de la commande pour rester testable sans coffre déverrouillé.
pub(crate) fn bulk_insert_receipts(
    conn: &mut rusqlite::Connection,
    receipts: Vec<CreateIncomeReceiptRequest>,
    replace_duplicates: bool,
) -> Result<Vec<BulkReceiptResult>, String> {
    if receipts.is_empty() {
        return Ok(Vec::new());
    }

    // --- validation intégrale, avant toute écriture ---
    for (i, r) in receipts.iter().enumerate() {
        if r.income_id.trim().is_empty() {
            return Err(format!("Ligne {} : revenu non renseigné.", i + 1));
        }
        if r.received_on.trim().len() < 10 {
            return Err(format!(
                "Ligne {} : date de versement absente ou incomplète.",
                i + 1
            ));
        }
        if !r.amount.is_finite() {
            return Err(format!("Ligne {} : montant net illisible.", i + 1));
        }
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM incomes WHERE id = ?1",
                [&r.income_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists == 0 {
            return Err(format!("Ligne {} : ce revenu n'existe plus.", i + 1));
        }
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(receipts.len());

    for (index, r) in receipts.iter().enumerate() {
        let fiscal_year = request_fiscal_year(r);
        let period_key = request_period_key(r);

        // Un bulletin est « le même » quand il couvre la même période chez le
        // même employeur. Deux cents fiches importées en plusieurs sessions,
        // c'est le premier risque d'un historique de carrière.
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM income_receipts
                 WHERE income_id = ?1
                   AND COALESCE(period_end, period_start, received_on) = ?2
                 LIMIT 1",
                rusqlite::params![r.income_id, period_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(existing_id) = existing {
            if !replace_duplicates {
                out.push(BulkReceiptResult {
                    index,
                    status: "duplicate",
                    receipt_id: None,
                    existing_id: Some(existing_id),
                    message: Some(format!("Un bulletin couvre déjà {}.", period_key)),
                });
                continue;
            }
            tx.execute("DELETE FROM income_receipts WHERE id = ?1", [&existing_id])
                .map_err(|e| e.to_string())?;
            let id = insert_receipt_row(&tx, r, fiscal_year)?;
            out.push(BulkReceiptResult {
                index,
                status: "replaced",
                receipt_id: Some(id),
                existing_id: Some(existing_id),
                message: None,
            });
            continue;
        }

        let id = insert_receipt_row(&tx, r, fiscal_year)?;
        out.push(BulkReceiptResult {
            index,
            status: "created",
            receipt_id: Some(id),
            existing_id: None,
            message: None,
        });
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(out)
}

/// L'INSERT nu, partagé par la saisie unitaire et par le lot : une seule
/// liste de colonnes, donc pas de dérive entre les deux chemins.
fn insert_receipt_row(
    conn: &rusqlite::Connection,
    receipt: &CreateIncomeReceiptRequest,
    fiscal_year: Option<i32>,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let currency = receipt.currency.clone().unwrap_or_else(|| "CHF".to_string());
    conn.execute(
        "INSERT INTO income_receipts (id, income_id, received_on, amount, currency,
         period_label, period_start, period_end, fiscal_year,
         gross_amount, base_salary_amount, thirteenth_amount, overtime_amount,
         overtime_hours, holiday_pay_amount, bonus_amount, benefits_in_kind_amount,
         company_car_private_amount, family_allowance_amount, other_gross_amount,
         social_charges_amount, ac_amount, ac_solidarity_amount, pension_amount,
         laa_nonoccupational_amount, ijm_amount, tax_at_source_amount,
         other_deductions_amount, expense_reimbursement_amount,
         expense_lump_sum_amount, net_addition_amount, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                 ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                 ?29, ?30, ?31, ?32)",
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
            receipt.net_addition_amount,
            receipt.notes,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
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
         net_addition_amount = ?29, notes = ?30
         WHERE id = ?31",
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
            receipt.net_addition_amount,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::util::test_support::{test_key, TempDir};

    fn open_db() -> (TempDir, Database) {
        let tmp = TempDir::new();
        let db = Database::open(tmp.path(), &test_key()).unwrap();
        (tmp, db)
    }

    fn insert_income(conn: &rusqlite::Connection, id: &str) {
        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES (?1, 'Salaire ACME', 'salary', 'monthly', 'CHF', 'active')",
            [id],
        )
        .unwrap();
    }

    fn request(income_id: &str, month: u32, received_on: &str) -> CreateIncomeReceiptRequest {
        CreateIncomeReceiptRequest {
            income_id: income_id.into(),
            received_on: received_on.into(),
            amount: 7_180.58,
            currency: Some("CHF".into()),
            period_label: None,
            period_start: Some(format!("2019-{month:02}-01")),
            period_end: Some(format!("2019-{month:02}-28")),
            fiscal_year: None,
            gross_amount: Some(8_000.0),
            base_salary_amount: Some(8_000.0),
            thirteenth_amount: None,
            overtime_amount: None,
            overtime_hours: None,
            holiday_pay_amount: None,
            bonus_amount: None,
            benefits_in_kind_amount: None,
            company_car_private_amount: None,
            family_allowance_amount: None,
            other_gross_amount: None,
            social_charges_amount: Some(424.0),
            ac_amount: Some(88.0),
            ac_solidarity_amount: None,
            pension_amount: Some(187.43),
            laa_nonoccupational_amount: Some(80.0),
            ijm_amount: Some(40.0),
            tax_at_source_amount: None,
            other_deductions_amount: None,
            expense_reimbursement_amount: None,
            expense_lump_sum_amount: None,
            net_addition_amount: None,
            notes: None,
        }
    }

    /// Le cas nominal : douze fiches d'un coup, une transaction, douze lignes.
    #[test]
    fn a_batch_inserts_every_row_in_one_go() {
        let (_tmp, db) = open_db();
        let mut conn = db.conn.lock().unwrap();
        insert_income(&conn, "inc1");

        let batch: Vec<_> = (1..=12)
            .map(|m| request("inc1", m, &format!("2019-{m:02}-25")))
            .collect();
        let out = bulk_insert_receipts(&mut conn, batch, false).unwrap();

        assert_eq!(out.len(), 12);
        assert!(out.iter().all(|r| r.status == "created"));
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM income_receipts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 12);
    }

    /// Réimporter le même mois ne crée pas un second bulletin : il est
    /// signalé, avec l'identifiant de celui déjà là. C'est le premier risque
    /// quand on reprend une carrière en plusieurs sessions.
    #[test]
    fn an_already_imported_period_is_reported_not_duplicated() {
        let (_tmp, db) = open_db();
        let mut conn = db.conn.lock().unwrap();
        insert_income(&conn, "inc1");

        let first = bulk_insert_receipts(&mut conn, vec![request("inc1", 3, "2019-03-25")], false)
            .unwrap();
        let created_id = first[0].receipt_id.clone().unwrap();

        // Même période, encaissée un autre jour : c'est bien le même bulletin.
        let again =
            bulk_insert_receipts(&mut conn, vec![request("inc1", 3, "2019-04-02")], false).unwrap();
        assert_eq!(again[0].status, "duplicate");
        assert_eq!(again[0].existing_id.as_deref(), Some(created_id.as_str()));

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM income_receipts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "aucun doublon n'a été écrit");
    }

    /// Remplacer reste possible, mais sur demande explicite.
    #[test]
    fn replacing_a_duplicate_is_opt_in() {
        let (_tmp, db) = open_db();
        let mut conn = db.conn.lock().unwrap();
        insert_income(&conn, "inc1");

        bulk_insert_receipts(&mut conn, vec![request("inc1", 5, "2019-05-25")], false).unwrap();
        let mut better = request("inc1", 5, "2019-05-25");
        better.gross_amount = Some(9_000.0);
        let out = bulk_insert_receipts(&mut conn, vec![better], true).unwrap();

        assert_eq!(out[0].status, "replaced");
        let (count, gross): (i64, f64) = conn
            .query_row(
                "SELECT COUNT(*), MAX(gross_amount) FROM income_receipts",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(gross, 9_000.0);
    }

    /// Une ligne invalide arrête TOUT avant la moindre écriture : un lot à
    /// moitié importé serait pire que pas d'import.
    #[test]
    fn an_invalid_row_aborts_the_whole_batch_before_writing() {
        let (_tmp, db) = open_db();
        let mut conn = db.conn.lock().unwrap();
        insert_income(&conn, "inc1");

        let mut batch = vec![request("inc1", 1, "2019-01-25"), request("inc1", 2, "2019-02-25")];
        batch[1].income_id = "revenu-supprime".into();

        let err = bulk_insert_receipts(&mut conn, batch, false).unwrap_err();
        assert!(err.contains("Ligne 2"), "message inattendu : {err}");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM income_receipts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "rien ne doit avoir été écrit");
    }

    /// L'année fiscale suit la période, pas l'encaissement — le bulletin de
    /// décembre versé en janvier reste dans son année.
    #[test]
    fn the_fiscal_year_follows_the_period_not_the_payment() {
        let (_tmp, db) = open_db();
        let mut conn = db.conn.lock().unwrap();
        insert_income(&conn, "inc1");

        let mut r = request("inc1", 12, "2020-01-05");
        r.period_start = Some("2019-12-01".into());
        r.period_end = Some("2019-12-31".into());
        bulk_insert_receipts(&mut conn, vec![r], false).unwrap();

        let year: i32 = conn
            .query_row("SELECT fiscal_year FROM income_receipts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(year, 2019);
    }
}

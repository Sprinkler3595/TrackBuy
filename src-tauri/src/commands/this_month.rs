//! Aggregations powering the "Ce mois" landing page — the first thing a
//! Swiss user sees after unlocking the vault.
//!
//! Returns four numbers + lists in a single round-trip so the home view
//! renders in one paint:
//!   - to_pay: scheduled engagement charges due in the next 30 days
//!   - to_receive: expected incomes in the next 30 days
//!   - inbox: pending bank-statement transactions + pending invoices not
//!     yet linked to an engagement or item
//!   - net_estimate: to_receive - to_pay

use serde::Serialize;
use tauri::State;

use crate::commands::auth::AppState;

#[derive(Debug, Serialize)]
pub struct ToPayLine {
    pub charge_id: String,
    pub engagement_id: String,
    pub engagement_name: String,
    pub engagement_type: String,
    pub creditor_name: Option<String>,
    pub due_date: String,
    pub amount: f64,
    pub currency: String,
    pub payment_method: Option<String>,
    pub reference_number: Option<String>,
    pub days_until: i64,
}

#[derive(Debug, Serialize)]
pub struct ToReceiveLine {
    pub income_id: String,
    pub name: String,
    pub income_type: String,
    pub source: Option<String>,
    pub next_expected: String,
    pub amount: f64,
    pub currency: String,
    pub days_until: i64,
}

#[derive(Debug, Serialize)]
pub struct ThisMonthSummary {
    pub to_pay_total_chf: f64,
    pub to_pay_lines: Vec<ToPayLine>,
    pub to_receive_total_chf: f64,
    pub to_receive_lines: Vec<ToReceiveLine>,
    pub inbox_pending_transactions: i64,
    pub inbox_pending_invoices: i64,
    pub net_estimate_chf: f64,
}

#[tauri::command]
pub fn get_this_month(state: State<'_, AppState>) -> Result<ThisMonthSummary, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut to_pay_lines: Vec<ToPayLine> = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT c.id, e.id, e.name, e.engagement_type, cr.name,
                    c.due_date, c.amount, c.currency, e.payment_method, c.reference_number,
                    CAST(julianday(date(c.due_date)) - julianday(date('now')) AS INTEGER)
             FROM engagement_charges c
             JOIN engagements e ON e.id = c.engagement_id
             LEFT JOIN creditors cr ON cr.id = e.creditor_id
             WHERE c.status IN ('scheduled', 'late')
               AND date(c.due_date) <= date('now', '+30 days')
             ORDER BY c.due_date",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ToPayLine {
                charge_id: row.get(0)?,
                engagement_id: row.get(1)?,
                engagement_name: row.get(2)?,
                engagement_type: row.get(3)?,
                creditor_name: row.get(4)?,
                due_date: row.get(5)?,
                amount: row.get(6)?,
                currency: row.get(7)?,
                payment_method: row.get(8)?,
                reference_number: row.get(9)?,
                days_until: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    for r in rows {
        to_pay_lines.push(r.map_err(|e| e.to_string())?);
    }

    let to_pay_total_chf: f64 = to_pay_lines
        .iter()
        .filter(|l| l.currency == "CHF")
        .map(|l| l.amount)
        .sum();

    let mut to_receive_lines: Vec<ToReceiveLine> = Vec::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, name, income_type, source_name, next_expected_date,
                    COALESCE(current_amount, 0), currency,
                    CAST(julianday(date(next_expected_date)) - julianday(date('now')) AS INTEGER)
             FROM incomes
             WHERE status = 'active'
               AND next_expected_date IS NOT NULL
               AND date(next_expected_date) <= date('now', '+30 days')
             ORDER BY next_expected_date",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ToReceiveLine {
                income_id: row.get(0)?,
                name: row.get(1)?,
                income_type: row.get(2)?,
                source: row.get(3)?,
                next_expected: row.get(4)?,
                amount: row.get(5)?,
                currency: row.get(6)?,
                days_until: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    for r in rows {
        to_receive_lines.push(r.map_err(|e| e.to_string())?);
    }

    let to_receive_total_chf: f64 = to_receive_lines
        .iter()
        .filter(|l| l.currency == "CHF")
        .map(|l| l.amount)
        .sum();

    // Inbox counts: unreviewed bank statements + pending invoices.
    let inbox_pending_transactions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bank_statement_transactions
             WHERE match_status = 'unmatched'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let inbox_pending_invoices: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pending_invoices",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(ThisMonthSummary {
        to_pay_total_chf,
        to_pay_lines,
        to_receive_total_chf,
        to_receive_lines,
        inbox_pending_transactions,
        inbox_pending_invoices,
        net_estimate_chf: to_receive_total_chf - to_pay_total_chf,
    })
}

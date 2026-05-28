//! Annual tax declaration support.
//!
//! Two halves:
//!   - mutators: set or clear `tax_category` on items / engagement_charges
//!   - aggregators: produce per-year totals grouped by deduction rubric, so
//!     the frontend Taxes page can show what's already collected toward the
//!     Swiss declaration without re-running heuristics in JS.
//!
//! Tax categories used here:
//!   pro            — frais professionnels (transports, repas, formation pro)
//!   medical        — frais médicaux / dentaires / hospitaliers / médicaments
//!   don            — dons à organisations d'utilité publique
//!   entretien      — frais d'entretien de l'immeuble (propriétaires)
//!   3a             — versements à un compte de 3ᵉ pilier lié (3a)
//!   formation      — frais de formation continue
//!   garde_enfant   — frais de garde (crèche, parascolaire)

use serde::Serialize;
use tauri::State;

use crate::commands::auth::AppState;

#[derive(Debug, Serialize)]
pub struct TaxBucket {
    /// One of the 7 canonical categories above.
    pub category: String,
    /// Sum across items + engagement_charges within the year, expressed in
    /// CHF for now (currency conversion is intentionally out of scope —
    /// items in a foreign currency are reported separately so the user
    /// notices and can convert by hand for the declaration).
    pub total_chf: f64,
    /// Number of rows feeding `total_chf`.
    pub count: i64,
    /// Sum of foreign-currency rows (not added to total_chf). Currency lost
    /// in the rollup; the frontend lists the offending lines on demand.
    pub total_other_currencies: f64,
}

#[derive(Debug, Serialize)]
pub struct TaxLine {
    pub source: String, // 'item' | 'charge'
    pub source_id: String,
    pub category: String,
    pub date: String,
    pub amount: f64,
    pub currency: String,
    pub label: String,
    pub member_id: Option<String>,
    pub member_name: Option<String>,
}

#[tauri::command]
pub fn set_item_tax_category(
    state: State<'_, AppState>,
    item_id: String,
    category: Option<String>,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE items SET tax_category = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![category, item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_charge_tax_category(
    state: State<'_, AppState>,
    charge_id: String,
    category: Option<String>,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE engagement_charges SET tax_category = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        rusqlite::params![category, charge_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Aggregate deductible expenses for a fiscal year. Returns one row per
/// known category — including zeroed ones — so the frontend can render
/// all rubrics with consistent ordering.
#[tauri::command]
pub fn get_tax_buckets(
    state: State<'_, AppState>,
    year: i32,
) -> Result<Vec<TaxBucket>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let categories = [
        "pro",
        "medical",
        "don",
        "entretien",
        "3a",
        "formation",
        "garde_enfant",
    ];

    let mut buckets = Vec::with_capacity(categories.len());

    for cat in categories {
        let (sum_chf, count_chf): (Option<f64>, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(purchase_price), 0), COUNT(*)
                 FROM items
                 WHERE tax_category = ?1
                   AND substr(purchase_date, 1, 4) = ?2
                   AND currency = 'CHF'",
                rusqlite::params![cat, year.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        let (sum_charge_chf, count_charge_chf): (Option<f64>, i64) = conn
            .query_row(
                "SELECT COALESCE(SUM(amount), 0), COUNT(*)
                 FROM engagement_charges
                 WHERE tax_category = ?1
                   AND substr(COALESCE(paid_on, due_date), 1, 4) = ?2
                   AND currency = 'CHF'",
                rusqlite::params![cat, year.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        let (sum_other_items, sum_other_charges): (Option<f64>, Option<f64>) = conn
            .query_row(
                "SELECT
                    (SELECT COALESCE(SUM(purchase_price), 0)
                     FROM items
                     WHERE tax_category = ?1
                       AND substr(purchase_date, 1, 4) = ?2
                       AND currency <> 'CHF'),
                    (SELECT COALESCE(SUM(amount), 0)
                     FROM engagement_charges
                     WHERE tax_category = ?1
                       AND substr(COALESCE(paid_on, due_date), 1, 4) = ?2
                       AND currency <> 'CHF')",
                rusqlite::params![cat, year.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        buckets.push(TaxBucket {
            category: cat.to_string(),
            total_chf: sum_chf.unwrap_or(0.0) + sum_charge_chf.unwrap_or(0.0),
            count: count_chf + count_charge_chf,
            total_other_currencies: sum_other_items.unwrap_or(0.0)
                + sum_other_charges.unwrap_or(0.0),
        });
    }

    Ok(buckets)
}

/// Every individual line for one (category, year) — used when the frontend
/// expands a rubric to show all underlying expenses.
#[tauri::command]
pub fn list_tax_lines(
    state: State<'_, AppState>,
    year: i32,
    category: String,
) -> Result<Vec<TaxLine>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut lines = Vec::new();

    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.purchase_date, i.purchase_price, i.currency, i.description,
                    i.attributed_to_member_id, hm.name
             FROM items i
             LEFT JOIN household_members hm ON hm.id = i.attributed_to_member_id
             WHERE i.tax_category = ?1
               AND substr(i.purchase_date, 1, 4) = ?2
             ORDER BY i.purchase_date DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![&category, year.to_string()], |row| {
            Ok(TaxLine {
                source: "item".to_string(),
                source_id: row.get(0)?,
                category: category.clone(),
                date: row.get(1)?,
                amount: row.get(2)?,
                currency: row.get(3)?,
                label: row.get(4)?,
                member_id: row.get(5)?,
                member_name: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        lines.push(row.map_err(|e| e.to_string())?);
    }

    let mut stmt2 = conn
        .prepare(
            "SELECT c.id, COALESCE(c.paid_on, c.due_date), c.amount, c.currency,
                    e.name, e.attributed_to_member_id, hm.name
             FROM engagement_charges c
             JOIN engagements e ON e.id = c.engagement_id
             LEFT JOIN household_members hm ON hm.id = e.attributed_to_member_id
             WHERE c.tax_category = ?1
               AND substr(COALESCE(c.paid_on, c.due_date), 1, 4) = ?2
             ORDER BY COALESCE(c.paid_on, c.due_date) DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows2 = stmt2
        .query_map(rusqlite::params![&category, year.to_string()], |row| {
            Ok(TaxLine {
                source: "charge".to_string(),
                source_id: row.get(0)?,
                category: category.clone(),
                date: row.get(1)?,
                amount: row.get(2)?,
                currency: row.get(3)?,
                label: row.get(4)?,
                member_id: row.get(5)?,
                member_name: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    for row in rows2 {
        lines.push(row.map_err(|e| e.to_string())?);
    }

    Ok(lines)
}

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

/// Sous-total monétaire pour une devise donnée. On expose un total PAR devise
/// plutôt qu'un montant unique en CHF : sans table de taux de change, additionner
/// des CHF, EUR et USD produirait un nombre sans unité et masquerait
/// silencieusement les montants en devise étrangère.
#[derive(Debug, Serialize)]
pub struct CurrencyTotal {
    pub currency: String,
    pub amount: f64,
}

#[derive(Debug, Serialize)]
pub struct ThisMonthSummary {
    pub to_pay_lines: Vec<ToPayLine>,
    pub to_receive_lines: Vec<ToReceiveLine>,
    /// Sous-totaux « à payer » par devise (CHF en tête, puis alphabétique).
    pub to_pay_totals: Vec<CurrencyTotal>,
    /// Sous-totaux « à encaisser » par devise.
    pub to_receive_totals: Vec<CurrencyTotal>,
    /// Solde net estimé par devise (encaissements − paiements, même devise).
    /// Aucune conversion inter-devises : un solde n'a de sens qu'au sein d'une
    /// même devise.
    pub net_estimate_totals: Vec<CurrencyTotal>,
    pub inbox_pending_transactions: i64,
    pub inbox_pending_invoices: i64,
}

/// Agrège des montants par devise sans aucune conversion. Tri : CHF d'abord,
/// puis ordre alphabétique, pour un affichage stable.
fn totals_by_currency<I>(items: I) -> Vec<CurrencyTotal>
where
    I: IntoIterator<Item = (String, f64)>,
{
    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, f64> = BTreeMap::new();
    for (cur, amt) in items {
        *map.entry(cur).or_insert(0.0) += amt;
    }
    let mut out: Vec<CurrencyTotal> = map
        .into_iter()
        .map(|(currency, amount)| CurrencyTotal { currency, amount })
        .collect();
    out.sort_by(|a, b| {
        let rank = |c: &str| if c == "CHF" { 0 } else { 1 };
        rank(&a.currency)
            .cmp(&rank(&b.currency))
            .then_with(|| a.currency.cmp(&b.currency))
    });
    out
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

    // Sous-totaux par devise — aucune devise n'est masquée, aucune conversion.
    let to_pay_totals =
        totals_by_currency(to_pay_lines.iter().map(|l| (l.currency.clone(), l.amount)));
    let to_receive_totals =
        totals_by_currency(to_receive_lines.iter().map(|l| (l.currency.clone(), l.amount)));
    let net_estimate_totals = {
        use std::collections::BTreeMap;
        let mut map: BTreeMap<String, f64> = BTreeMap::new();
        for t in &to_receive_totals {
            *map.entry(t.currency.clone()).or_insert(0.0) += t.amount;
        }
        for t in &to_pay_totals {
            *map.entry(t.currency.clone()).or_insert(0.0) -= t.amount;
        }
        totals_by_currency(map)
    };

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
        to_pay_lines,
        to_receive_lines,
        to_pay_totals,
        to_receive_totals,
        net_estimate_totals,
        inbox_pending_transactions,
        inbox_pending_invoices,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn totals_par_devise_naditionne_jamais_entre_devises() {
        let totals = totals_by_currency(vec![
            ("CHF".to_string(), 10.0),
            ("EUR".to_string(), 5.0),
            ("CHF".to_string(), 2.5),
            ("USD".to_string(), 7.0),
        ]);
        // Une entrée par devise, CHF d'abord puis alphabétique.
        assert_eq!(totals.len(), 3);
        assert_eq!(totals[0].currency, "CHF");
        assert!((totals[0].amount - 12.5).abs() < 1e-9);
        assert_eq!(totals[1].currency, "EUR");
        assert!((totals[1].amount - 5.0).abs() < 1e-9);
        assert_eq!(totals[2].currency, "USD");
        assert!((totals[2].amount - 7.0).abs() < 1e-9);
    }

    #[test]
    fn totals_par_devise_vide() {
        assert!(totals_by_currency(Vec::<(String, f64)>::new()).is_empty());
    }

    #[test]
    fn une_devise_etrangere_seule_nest_pas_masquee() {
        // Régression du bug 2.1 : auparavant un total filtré sur CHF aurait
        // renvoyé 0 et fait disparaître ce montant en EUR.
        let totals = totals_by_currency(vec![("EUR".to_string(), 42.0)]);
        assert_eq!(totals.len(), 1);
        assert_eq!(totals[0].currency, "EUR");
        assert!((totals[0].amount - 42.0).abs() < 1e-9);
    }
}

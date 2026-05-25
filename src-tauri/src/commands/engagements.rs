use rusqlite::Connection;
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{
    CreateEngagementChargeRequest, CreateEngagementRequest, CreateEngagementRevisionRequest,
    Engagement, EngagementCharge, EngagementRevision,
};

const ENG_SELECT_COLUMNS: &str =
    "e.id, e.name, e.engagement_type, e.parent_engagement_id, e.creditor_id, e.payment_card_id,
     e.contract_reference, e.contract_start_date, e.contract_end_date, e.notice_period_days,
     e.billing_cycle, e.cycle_interval, e.next_due_date, e.current_amount, e.currency,
     e.payment_method, e.auto_pay, e.status, e.ended_on, e.notes, e.clauses_json,
     e.created_at, e.updated_at,
     cr.name as creditor_name, pc.name as card_name, p.name as parent_name";

const ENG_JOINS: &str =
    "LEFT JOIN creditors cr ON e.creditor_id = cr.id
     LEFT JOIN payment_cards pc ON e.payment_card_id = pc.id
     LEFT JOIN engagements p ON e.parent_engagement_id = p.id";

fn row_to_engagement(row: &rusqlite::Row<'_>) -> rusqlite::Result<Engagement> {
    Ok(Engagement {
        id: row.get(0)?,
        name: row.get(1)?,
        engagement_type: row.get(2)?,
        parent_engagement_id: row.get(3)?,
        creditor_id: row.get(4)?,
        payment_card_id: row.get(5)?,
        contract_reference: row.get(6)?,
        contract_start_date: row.get(7)?,
        contract_end_date: row.get(8)?,
        notice_period_days: row.get(9)?,
        billing_cycle: row.get(10)?,
        cycle_interval: row.get(11)?,
        next_due_date: row.get(12)?,
        current_amount: row.get(13)?,
        currency: row.get(14)?,
        payment_method: row.get(15)?,
        auto_pay: row.get(16)?,
        status: row.get(17)?,
        ended_on: row.get(18)?,
        notes: row.get(19)?,
        clauses_json: row.get(20)?,
        created_at: row.get(21)?,
        updated_at: row.get(22)?,
        creditor_name: row.get(23)?,
        card_name: row.get(24)?,
        parent_name: row.get(25)?,
    })
}

const CHARGE_SELECT_COLUMNS: &str =
    "c.id, c.engagement_id, c.period_start, c.period_end, c.due_date, c.amount, c.currency,
     c.quantity, c.unit, c.unit_price, c.paid_on, c.status, c.payment_card_id,
     c.reference_number, c.invoice_number, c.notes, c.created_at, c.updated_at,
     pc.name as card_name";

fn row_to_charge(row: &rusqlite::Row<'_>) -> rusqlite::Result<EngagementCharge> {
    Ok(EngagementCharge {
        id: row.get(0)?,
        engagement_id: row.get(1)?,
        period_start: row.get(2)?,
        period_end: row.get(3)?,
        due_date: row.get(4)?,
        amount: row.get(5)?,
        currency: row.get(6)?,
        quantity: row.get(7)?,
        unit: row.get(8)?,
        unit_price: row.get(9)?,
        paid_on: row.get(10)?,
        status: row.get(11)?,
        payment_card_id: row.get(12)?,
        reference_number: row.get(13)?,
        invoice_number: row.get(14)?,
        notes: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
        card_name: row.get(18)?,
    })
}

fn row_to_revision(row: &rusqlite::Row<'_>) -> rusqlite::Result<EngagementRevision> {
    Ok(EngagementRevision {
        id: row.get(0)?,
        engagement_id: row.get(1)?,
        effective_date: row.get(2)?,
        amount: row.get(3)?,
        currency: row.get(4)?,
        change_reason: row.get(5)?,
        notes: row.get(6)?,
        created_at: row.get(7)?,
    })
}

/// SQLite `date()` modifier for one engagement billing cycle. Mirrors
/// `subscriptions::cycle_modifier` but adds `semiannual` and `one_shot`:
/// `one_shot` never rolls forward (returns an empty modifier so callers know
/// to skip).
fn cycle_modifier(billing_cycle: &str, interval: i32) -> Option<String> {
    let n = interval.max(1);
    match billing_cycle {
        "monthly" => Some(format!("+{} months", n)),
        "quarterly" => Some(format!("+{} months", n * 3)),
        "semiannual" => Some(format!("+{} months", n * 6)),
        "yearly" => Some(format!("+{} years", n)),
        "custom" => Some(format!("+{} days", n)),
        "one_shot" => None,
        _ => Some(format!("+{} months", n)),
    }
}

fn advance_date(conn: &Connection, date: &str, modifier: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT date(?1, ?2)",
        rusqlite::params![date, modifier],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Generate `engagement_charges` rows for every active engagement whose
/// `next_due_date` has passed. Charges with `auto_pay = 1` are inserted with
/// `status = 'paid'` (LSV/SEPA settles automatically); otherwise they start
/// as `'scheduled'` so the user can confirm payment later. Hard-capped at
/// 1000 iterations per engagement, like `subscriptions::roll_forward_inner`.
fn roll_forward_inner(conn: &Connection) -> Result<i32, String> {
    let due: Vec<(String, String, String, i32, f64, String, Option<String>, bool)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, next_due_date, billing_cycle, cycle_interval, current_amount,
                        currency, payment_card_id, auto_pay
                 FROM engagements
                 WHERE status = 'active'
                   AND next_due_date IS NOT NULL
                   AND current_amount IS NOT NULL
                   AND billing_cycle != 'one_shot'
                   AND date(next_due_date) < date('now')",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, bool>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    let mut inserted = 0;
    for (id, mut current, cycle, interval, amount, currency, card_id, auto_pay) in due {
        let Some(modifier) = cycle_modifier(&cycle, interval) else {
            continue;
        };
        for _ in 0..1000 {
            let today: String = conn
                .query_row("SELECT date('now')", [], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            if current >= today {
                break;
            }
            let charge_id = Uuid::new_v4().to_string();
            let (status, paid_on) = if auto_pay {
                ("paid", Some(current.clone()))
            } else {
                ("scheduled", None::<String>)
            };
            conn.execute(
                "INSERT INTO engagement_charges (id, engagement_id, due_date, amount, currency,
                 payment_card_id, paid_on, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![charge_id, id, current, amount, currency, card_id, paid_on, status],
            )
            .map_err(|e| e.to_string())?;
            inserted += 1;
            current = advance_date(conn, &current, &modifier)?;
        }
        conn.execute(
            "UPDATE engagements SET next_due_date = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![current, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(inserted)
}

#[tauri::command]
pub fn roll_forward_due_engagements(state: State<'_, AppState>) -> Result<i32, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    roll_forward_inner(&conn)
}

#[tauri::command]
pub fn get_engagements(
    state: State<'_, AppState>,
    status: Option<String>,
    engagement_type: Option<String>,
    parent_id: Option<String>,
) -> Result<Vec<Engagement>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    roll_forward_inner(&conn)?;

    let mut sql = format!(
        "SELECT {} FROM engagements e {} WHERE 1=1",
        ENG_SELECT_COLUMNS, ENG_JOINS
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref s) = status {
        if s != "all" && !s.is_empty() {
            sql.push_str(" AND e.status = ?");
            params.push(Box::new(s.clone()));
        }
    }
    if let Some(ref t) = engagement_type {
        if !t.is_empty() {
            sql.push_str(" AND e.engagement_type = ?");
            params.push(Box::new(t.clone()));
        }
    }
    if let Some(ref p) = parent_id {
        if !p.is_empty() {
            sql.push_str(" AND e.parent_engagement_id = ?");
            params.push(Box::new(p.clone()));
        }
    }
    sql.push_str(" ORDER BY e.next_due_date");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_engagement)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn get_engagement(state: State<'_, AppState>, id: String) -> Result<Engagement, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    roll_forward_inner(&conn)?;

    let sql = format!(
        "SELECT {} FROM engagements e {} WHERE e.id = ?1",
        ENG_SELECT_COLUMNS, ENG_JOINS
    );
    conn.query_row(&sql, [&id], row_to_engagement)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_engagement_children(
    state: State<'_, AppState>,
    parent_id: String,
) -> Result<Vec<Engagement>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM engagements e {} WHERE e.parent_engagement_id = ?1 ORDER BY e.name",
        ENG_SELECT_COLUMNS, ENG_JOINS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&parent_id], row_to_engagement)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn create_engagement(
    state: State<'_, AppState>,
    engagement: CreateEngagementRequest,
) -> Result<Engagement, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = engagement.currency.unwrap_or_else(|| "CHF".to_string());
    let status = engagement.status.unwrap_or_else(|| "active".to_string());
    let auto_pay = engagement.auto_pay.unwrap_or(false);
    let cycle_interval = engagement.cycle_interval.unwrap_or(1).max(1);

    conn.execute(
        "INSERT INTO engagements (id, name, engagement_type, parent_engagement_id, creditor_id,
         payment_card_id, contract_reference, contract_start_date, contract_end_date,
         notice_period_days, billing_cycle, cycle_interval, next_due_date, current_amount,
         currency, payment_method, auto_pay, status, notes, clauses_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                 ?18, ?19, ?20)",
        rusqlite::params![
            id,
            engagement.name,
            engagement.engagement_type,
            engagement.parent_engagement_id,
            engagement.creditor_id,
            engagement.payment_card_id,
            engagement.contract_reference,
            engagement.contract_start_date,
            engagement.contract_end_date,
            engagement.notice_period_days,
            engagement.billing_cycle,
            cycle_interval,
            engagement.next_due_date,
            engagement.current_amount,
            currency,
            engagement.payment_method,
            auto_pay,
            status,
            engagement.notes,
            engagement.clauses_json,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM engagements e {} WHERE e.id = ?1",
        ENG_SELECT_COLUMNS, ENG_JOINS
    );
    conn.query_row(&sql, [&id], row_to_engagement)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_engagement(
    state: State<'_, AppState>,
    engagement: Engagement,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE engagements SET name = ?1, engagement_type = ?2, parent_engagement_id = ?3,
         creditor_id = ?4, payment_card_id = ?5, contract_reference = ?6,
         contract_start_date = ?7, contract_end_date = ?8, notice_period_days = ?9,
         billing_cycle = ?10, cycle_interval = ?11, next_due_date = ?12,
         current_amount = ?13, currency = ?14, payment_method = ?15, auto_pay = ?16,
         status = ?17, ended_on = ?18, notes = ?19, clauses_json = ?20,
         updated_at = datetime('now')
         WHERE id = ?21",
        rusqlite::params![
            engagement.name,
            engagement.engagement_type,
            engagement.parent_engagement_id,
            engagement.creditor_id,
            engagement.payment_card_id,
            engagement.contract_reference,
            engagement.contract_start_date,
            engagement.contract_end_date,
            engagement.notice_period_days,
            engagement.billing_cycle,
            engagement.cycle_interval.max(1),
            engagement.next_due_date,
            engagement.current_amount,
            engagement.currency,
            engagement.payment_method,
            engagement.auto_pay,
            engagement.status,
            engagement.ended_on,
            engagement.notes,
            engagement.clauses_json,
            engagement.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_engagement(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Collect every encrypted blob to wipe before the cascade removes the
    // rows: direct engagement attachments, charge attachments, revision
    // attachments. CASCADE drops the rows; we shred the files ourselves.
    let attachment_paths: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT file_path FROM attachments
                 WHERE engagement_id = ?1
                    OR engagement_charge_id IN (SELECT id FROM engagement_charges WHERE engagement_id = ?1)
                    OR engagement_revision_id IN (SELECT id FROM engagement_revisions WHERE engagement_id = ?1)",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    conn.execute("DELETE FROM engagements WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    for path in attachment_paths {
        let _ = crate::storage::delete_attachment_file(&path);
    }

    Ok(())
}

#[tauri::command]
pub fn get_upcoming_engagement_charges(
    state: State<'_, AppState>,
    days: Option<i32>,
) -> Result<Vec<EngagementCharge>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    roll_forward_inner(&conn)?;

    let days = days.unwrap_or(30);
    let sql = format!(
        "SELECT {} FROM engagement_charges c
         LEFT JOIN payment_cards pc ON c.payment_card_id = pc.id
         WHERE c.status = 'scheduled'
           AND date(c.due_date) >= date('now')
           AND date(c.due_date) <= date('now', '+' || ?1 || ' days')
         ORDER BY c.due_date",
        CHARGE_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([days], row_to_charge)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

// ----- Charges (one row per occurrence) --------------------------------

#[tauri::command]
pub fn get_engagement_charges(
    state: State<'_, AppState>,
    engagement_id: String,
) -> Result<Vec<EngagementCharge>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM engagement_charges c
         LEFT JOIN payment_cards pc ON c.payment_card_id = pc.id
         WHERE c.engagement_id = ?1
         ORDER BY c.due_date DESC",
        CHARGE_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&engagement_id], row_to_charge)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn add_engagement_charge(
    state: State<'_, AppState>,
    charge: CreateEngagementChargeRequest,
) -> Result<EngagementCharge, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = charge.currency.unwrap_or_else(|| "CHF".to_string());
    let status = charge.status.unwrap_or_else(|| "scheduled".to_string());

    conn.execute(
        "INSERT INTO engagement_charges (id, engagement_id, period_start, period_end, due_date,
         amount, currency, quantity, unit, unit_price, paid_on, status, payment_card_id,
         reference_number, invoice_number, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        rusqlite::params![
            id,
            charge.engagement_id,
            charge.period_start,
            charge.period_end,
            charge.due_date,
            charge.amount,
            currency,
            charge.quantity,
            charge.unit,
            charge.unit_price,
            charge.paid_on,
            status,
            charge.payment_card_id,
            charge.reference_number,
            charge.invoice_number,
            charge.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM engagement_charges c
         LEFT JOIN payment_cards pc ON c.payment_card_id = pc.id
         WHERE c.id = ?1",
        CHARGE_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_charge)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_engagement_charge(
    state: State<'_, AppState>,
    charge: EngagementCharge,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE engagement_charges SET period_start = ?1, period_end = ?2, due_date = ?3,
         amount = ?4, currency = ?5, quantity = ?6, unit = ?7, unit_price = ?8,
         paid_on = ?9, status = ?10, payment_card_id = ?11, reference_number = ?12,
         invoice_number = ?13, notes = ?14, updated_at = datetime('now')
         WHERE id = ?15",
        rusqlite::params![
            charge.period_start,
            charge.period_end,
            charge.due_date,
            charge.amount,
            charge.currency,
            charge.quantity,
            charge.unit,
            charge.unit_price,
            charge.paid_on,
            charge.status,
            charge.payment_card_id,
            charge.reference_number,
            charge.invoice_number,
            charge.notes,
            charge.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mark_charge_paid(
    state: State<'_, AppState>,
    id: String,
    paid_on: String,
    payment_card_id: Option<String>,
) -> Result<EngagementCharge, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE engagement_charges SET status = 'paid', paid_on = ?1,
         payment_card_id = COALESCE(?2, payment_card_id), updated_at = datetime('now')
         WHERE id = ?3",
        rusqlite::params![paid_on, payment_card_id, id],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM engagement_charges c
         LEFT JOIN payment_cards pc ON c.payment_card_id = pc.id
         WHERE c.id = ?1",
        CHARGE_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_charge)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_engagement_charge(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM engagement_charges WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ----- Revisions (contract amendments) ---------------------------------

#[tauri::command]
pub fn get_engagement_revisions(
    state: State<'_, AppState>,
    engagement_id: String,
) -> Result<Vec<EngagementRevision>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, engagement_id, effective_date, amount, currency, change_reason, notes, created_at
             FROM engagement_revisions
             WHERE engagement_id = ?1
             ORDER BY effective_date DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&engagement_id], row_to_revision)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn add_engagement_revision(
    state: State<'_, AppState>,
    revision: CreateEngagementRevisionRequest,
) -> Result<EngagementRevision, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = revision.currency.unwrap_or_else(|| "CHF".to_string());

    conn.execute(
        "INSERT INTO engagement_revisions (id, engagement_id, effective_date, amount, currency,
         change_reason, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            id,
            revision.engagement_id,
            revision.effective_date,
            revision.amount,
            currency,
            revision.change_reason,
            revision.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, engagement_id, effective_date, amount, currency, change_reason, notes, created_at
         FROM engagement_revisions WHERE id = ?1",
        [&id],
        row_to_revision,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_engagement_revision(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM engagement_revisions WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// One-shot migration: turns an existing `subscriptions` row into an
/// `engagements` row of the chosen type, transfers any attachments, and
/// deletes the source subscription. Wrapped in a SQLite transaction so an
/// error mid-flight rolls everything back — the user never sees half-
/// migrated state.
///
/// Field mapping:
///   subscriptions.name           → engagements.name
///   subscriptions.merchant       → (the front separately resolves a creditor)
///   subscriptions.payment_card   → engagements.payment_card_id
///   subscriptions.start_date     → engagements.contract_start_date
///   subscriptions.next_renewal   → engagements.next_due_date
///   subscriptions.billing_cycle  → engagements.billing_cycle (same values)
///   subscriptions.cycle_interval → engagements.cycle_interval
///   subscriptions.price          → engagements.current_amount
///   subscriptions.currency       → engagements.currency
///   subscriptions.notes          → engagements.notes (+ trace line)
///   subscription_payments        → engagement_charges (status='paid' since
///                                  every payment row represents a settled
///                                  charge in the old model)
#[tauri::command]
pub fn migrate_subscription_to_engagement(
    state: State<'_, AppState>,
    subscription_id: String,
    engagement_type: String,
    creditor_id: Option<String>,
) -> Result<Engagement, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let mut conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // 1. Read the source subscription.
    let (name, payment_card_id, start_date, next_renewal_date, billing_cycle,
         cycle_interval, price, currency, notes): (
        String, Option<String>, String, String, String, i32, f64, String, Option<String>
    ) = tx
        .query_row(
            "SELECT name, payment_card_id, start_date, next_renewal_date, billing_cycle,
                    cycle_interval, price, currency, notes
             FROM subscriptions WHERE id = ?1",
            [&subscription_id],
            |row| {
                Ok((
                    row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                    row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?,
                ))
            },
        )
        .map_err(|e| format!("Abonnement introuvable: {}", e))?;

    let new_id = Uuid::new_v4().to_string();
    let merged_notes = match notes {
        Some(n) if !n.is_empty() => format!("{}\n— Migré depuis l'abonnement « {} »", n, name),
        _ => format!("Migré depuis l'abonnement « {} »", name),
    };

    // 2. Create the engagement.
    tx.execute(
        "INSERT INTO engagements (id, name, engagement_type, payment_card_id, creditor_id,
         contract_start_date, billing_cycle, cycle_interval, next_due_date,
         current_amount, currency, status, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'active', ?12)",
        rusqlite::params![
            new_id, name, engagement_type, payment_card_id, creditor_id,
            start_date, billing_cycle, cycle_interval, next_renewal_date,
            price, currency, merged_notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    // 3. Copy each historical subscription_payment into engagement_charges
    //    with status='paid'. The original price snapshot is preserved.
    tx.execute(
        "INSERT INTO engagement_charges (id, engagement_id, due_date, amount, currency,
         payment_card_id, paid_on, status)
         SELECT lower(hex(randomblob(16))), ?1, paid_on, amount, currency,
                payment_card_id, paid_on, 'paid'
         FROM subscription_payments WHERE subscription_id = ?2",
        rusqlite::params![new_id, subscription_id],
    )
    .map_err(|e| e.to_string())?;

    // 4. Re-point any existing attachments from subscription_id → engagement_id.
    tx.execute(
        "UPDATE attachments SET subscription_id = NULL, engagement_id = ?1
         WHERE subscription_id = ?2",
        rusqlite::params![new_id, subscription_id],
    )
    .map_err(|e| e.to_string())?;

    // 5. Drop the source subscription (CASCADE wipes payments + members).
    tx.execute("DELETE FROM subscriptions WHERE id = ?1", [&subscription_id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM engagements e {} WHERE e.id = ?1",
        ENG_SELECT_COLUMNS, ENG_JOINS
    );
    conn.query_row(&sql, [&new_id], row_to_engagement)
        .map_err(|e| e.to_string())
}

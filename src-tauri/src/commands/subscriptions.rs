use rusqlite::Connection;
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{
    CreateSubscriptionMemberRequest, CreateSubscriptionPaymentRequest,
    CreateSubscriptionRequest, Subscription, SubscriptionMember, SubscriptionPayment,
};

const SUB_SELECT_COLUMNS: &str =
    "s.id, s.name, s.category, s.merchant_id, s.payment_card_id, s.start_date,
     s.next_renewal_date, s.billing_cycle, s.cycle_interval, s.price, s.currency,
     s.auto_renewal, s.trial_end_date, s.cancel_by_date, s.cancellation_url,
     s.status, s.notes, s.kind, s.created_at, s.updated_at,
     m.name as merchant_name, pc.name as card_name";

fn row_to_subscription(row: &rusqlite::Row<'_>) -> rusqlite::Result<Subscription> {
    Ok(Subscription {
        id: row.get(0)?,
        name: row.get(1)?,
        category: row.get(2)?,
        merchant_id: row.get(3)?,
        payment_card_id: row.get(4)?,
        start_date: row.get(5)?,
        next_renewal_date: row.get(6)?,
        billing_cycle: row.get(7)?,
        cycle_interval: row.get(8)?,
        price: row.get(9)?,
        currency: row.get(10)?,
        auto_renewal: row.get(11)?,
        trial_end_date: row.get(12)?,
        cancel_by_date: row.get(13)?,
        cancellation_url: row.get(14)?,
        status: row.get(15)?,
        notes: row.get(16)?,
        kind: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        merchant_name: row.get(20)?,
        card_name: row.get(21)?,
    })
}

/// SQLite `date()` modifier for one billing cycle step. `custom` is treated as
/// "N days" so the UI can model anything outside the month/quarter/year grid.
fn cycle_modifier(billing_cycle: &str, interval: i32) -> String {
    let n = interval.max(1);
    match billing_cycle {
        "monthly" => format!("+{} months", n),
        "quarterly" => format!("+{} months", n * 3),
        "yearly" => format!("+{} years", n),
        "custom" => format!("+{} days", n),
        // Unknown cycle: fall back to month so the date still advances and we
        // don't spin forever in the roll-forward loop.
        _ => format!("+{} months", n),
    }
}

fn advance_date(conn: &Connection, date: &str, modifier: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT date(?1, ?2)",
        rusqlite::params![date, modifier],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())
}

/// Walk every active, auto-renewing subscription whose `next_renewal_date`
/// has passed and roll it forward — once per missed cycle — logging a payment
/// row each time so the historic price is preserved. Trial-period rows whose
/// trial hasn't ended yet are skipped (no charge happens during the trial).
/// Returns the total number of payment rows inserted across all subs.
fn roll_forward_inner(conn: &Connection) -> Result<i32, String> {
    let due: Vec<(String, String, String, i32, f64, String, Option<String>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, next_renewal_date, billing_cycle, cycle_interval, price, currency, payment_card_id
                 FROM subscriptions
                 WHERE status = 'active'
                   AND auto_renewal = 1
                   AND date(next_renewal_date) < date('now')
                   AND (trial_end_date IS NULL OR date(trial_end_date) < date('now'))",
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
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    let mut inserted = 0;
    for (id, mut current, cycle, interval, price, currency, card_id) in due {
        let modifier = cycle_modifier(&cycle, interval);
        // Hard cap on the loop in case data is corrupt — 1000 cycles covers
        // ~83 years of monthly subs, plenty of headroom while still terminating.
        for _ in 0..1000 {
            let today: String = conn
                .query_row("SELECT date('now')", [], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            if current >= today {
                break;
            }
            // Garde anti-double-comptage : si un paiement existe déjà pour cette
            // échéance (p. ex. créé par mark_renewed), on ne le duplique pas —
            // on avance simplement la date.
            let already: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM subscription_payments
                     WHERE subscription_id = ?1 AND paid_on = ?2",
                    rusqlite::params![id, current],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if already == 0 {
                let payment_id = Uuid::new_v4().to_string();
                // is_presumed = 1 : le débit est SUPPOSÉ, pas confirmé.
                conn.execute(
                    "INSERT INTO subscription_payments (id, subscription_id, paid_on, amount, currency, payment_card_id, is_presumed)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                    rusqlite::params![payment_id, id, current, price, currency, card_id],
                )
                .map_err(|e| e.to_string())?;
                inserted += 1;
            }
            current = advance_date(conn, &current, &modifier)?;
        }
        conn.execute(
            "UPDATE subscriptions SET next_renewal_date = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![current, id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(inserted)
}

#[tauri::command]
pub fn roll_forward_due_subscriptions(state: State<'_, AppState>) -> Result<i32, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    roll_forward_inner(&conn)
}

#[tauri::command]
pub fn get_subscriptions(
    state: State<'_, AppState>,
    status: Option<String>,
    category: Option<String>,
) -> Result<Vec<Subscription>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    roll_forward_inner(&conn)?;

    let mut sql = format!(
        "SELECT {} FROM subscriptions s
         LEFT JOIN merchants m ON s.merchant_id = m.id
         LEFT JOIN payment_cards pc ON s.payment_card_id = pc.id
         WHERE s.kind = 'online'",
        SUB_SELECT_COLUMNS
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref s) = status {
        if s != "all" && !s.is_empty() {
            sql.push_str(" AND s.status = ?");
            params.push(Box::new(s.clone()));
        }
    }
    if let Some(ref c) = category {
        if !c.is_empty() {
            sql.push_str(" AND s.category = ?");
            params.push(Box::new(c.clone()));
        }
    }
    sql.push_str(" ORDER BY s.next_renewal_date");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let subs = stmt
        .query_map(param_refs.as_slice(), row_to_subscription)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(subs)
}

#[tauri::command]
pub fn get_subscription(state: State<'_, AppState>, id: String) -> Result<Subscription, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    roll_forward_inner(&conn)?;

    let sql = format!(
        "SELECT {} FROM subscriptions s
         LEFT JOIN merchants m ON s.merchant_id = m.id
         LEFT JOIN payment_cards pc ON s.payment_card_id = pc.id
         WHERE s.id = ?1",
        SUB_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_subscription)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_subscription(
    state: State<'_, AppState>,
    subscription: CreateSubscriptionRequest,
) -> Result<Subscription, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = subscription.currency.unwrap_or_else(|| "CHF".to_string());
    let status = subscription.status.unwrap_or_else(|| "active".to_string());
    let kind = subscription.kind.unwrap_or_else(|| "online".to_string());
    let auto_renewal = subscription.auto_renewal.unwrap_or(true);
    let cycle_interval = subscription.cycle_interval.unwrap_or(1).max(1);

    conn.execute(
        "INSERT INTO subscriptions (id, name, category, merchant_id, payment_card_id, start_date,
         next_renewal_date, billing_cycle, cycle_interval, price, currency,
         auto_renewal, trial_end_date, cancel_by_date, cancellation_url, status, notes, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        rusqlite::params![
            id,
            subscription.name,
            subscription.category,
            subscription.merchant_id,
            subscription.payment_card_id,
            subscription.start_date,
            subscription.next_renewal_date,
            subscription.billing_cycle,
            cycle_interval,
            subscription.price,
            currency,
            auto_renewal,
            subscription.trial_end_date,
            subscription.cancel_by_date,
            subscription.cancellation_url,
            status,
            subscription.notes,
            kind,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM subscriptions s
         LEFT JOIN merchants m ON s.merchant_id = m.id
         LEFT JOIN payment_cards pc ON s.payment_card_id = pc.id
         WHERE s.id = ?1",
        SUB_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_subscription)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_subscription(
    state: State<'_, AppState>,
    subscription: Subscription,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE subscriptions SET name = ?1, category = ?2, merchant_id = ?3,
         payment_card_id = ?4, start_date = ?5, next_renewal_date = ?6,
         billing_cycle = ?7, cycle_interval = ?8, price = ?9, currency = ?10,
         auto_renewal = ?11, trial_end_date = ?12, cancel_by_date = ?13,
         cancellation_url = ?14, status = ?15, notes = ?16, kind = ?17,
         updated_at = datetime('now')
         WHERE id = ?18",
        rusqlite::params![
            subscription.name,
            subscription.category,
            subscription.merchant_id,
            subscription.payment_card_id,
            subscription.start_date,
            subscription.next_renewal_date,
            subscription.billing_cycle,
            subscription.cycle_interval.max(1),
            subscription.price,
            subscription.currency,
            subscription.auto_renewal,
            subscription.trial_end_date,
            subscription.cancel_by_date,
            subscription.cancellation_url,
            subscription.status,
            subscription.notes,
            subscription.kind,
            subscription.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_subscription(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Capture file paths for attachments BEFORE the cascade so we can wipe
    // the encrypted blobs off disk after the row delete.
    let attachment_paths: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT file_path FROM attachments WHERE subscription_id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_map([&id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    conn.execute("DELETE FROM subscriptions WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    for path in attachment_paths {
        let _ = crate::storage::delete_attachment_file(&path);
    }

    Ok(())
}

#[tauri::command]
pub fn get_upcoming_renewals(
    state: State<'_, AppState>,
    days: Option<i32>,
) -> Result<Vec<Subscription>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    roll_forward_inner(&conn)?;

    let days = days.unwrap_or(30);

    let sql = format!(
        "SELECT {} FROM subscriptions s
         LEFT JOIN merchants m ON s.merchant_id = m.id
         LEFT JOIN payment_cards pc ON s.payment_card_id = pc.id
         WHERE s.status = 'active'
           AND date(s.next_renewal_date) >= date('now')
           AND date(s.next_renewal_date) <= date('now', '+' || ?1 || ' days')
         ORDER BY s.next_renewal_date",
        SUB_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let subs = stmt
        .query_map([days], row_to_subscription)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(subs)
}

/// Manual "I just paid for this" trigger from the UI: logs a payment for the
/// current `next_renewal_date` and bumps the date one cycle forward. Useful
/// for subs with `auto_renewal = false` where the user wants to confirm each
/// charge by hand.
#[tauri::command]
pub fn mark_renewed(state: State<'_, AppState>, id: String) -> Result<Subscription, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    mark_renewed_inner(&conn, &id)
}

/// Cœur testable de `mark_renewed` : enregistre un paiement pour l'échéance
/// courante puis avance `next_renewal_date` d'un cycle. Extrait de la commande
/// pour pouvoir le tester sans `State`/`AppHandle`.
fn mark_renewed_inner(conn: &Connection, id: &str) -> Result<Subscription, String> {
    let (current, cycle, interval, price, currency, card_id): (
        String,
        String,
        i32,
        f64,
        String,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT next_renewal_date, billing_cycle, cycle_interval, price, currency, payment_card_id
             FROM subscriptions WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    // Confirmation explicite : si un paiement présumé existe déjà pour cette
    // échéance (généré par le roll-forward), on le CONFIRME (is_presumed = 0)
    // au lieu d'en créer un second — évite le double-comptage. Sinon on insère
    // un paiement confirmé.
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM subscription_payments
             WHERE subscription_id = ?1 AND paid_on = ?2 LIMIT 1",
            rusqlite::params![id, current],
            |row| row.get(0),
        )
        .ok();
    if let Some(pid) = existing_id {
        conn.execute(
            "UPDATE subscription_payments SET is_presumed = 0 WHERE id = ?1",
            [&pid],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let payment_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO subscription_payments (id, subscription_id, paid_on, amount, currency, payment_card_id, is_presumed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![payment_id, id, current, price, currency, card_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let modifier = cycle_modifier(&cycle, interval);
    let next = advance_date(conn, &current, &modifier)?;
    conn.execute(
        "UPDATE subscriptions SET next_renewal_date = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![next, id],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM subscriptions s
         LEFT JOIN merchants m ON s.merchant_id = m.id
         LEFT JOIN payment_cards pc ON s.payment_card_id = pc.id
         WHERE s.id = ?1",
        SUB_SELECT_COLUMNS
    );
    conn.query_row(&sql, [id], row_to_subscription)
        .map_err(|e| e.to_string())
}

// ---------- Payment history ----------

fn row_to_payment(row: &rusqlite::Row<'_>) -> rusqlite::Result<SubscriptionPayment> {
    Ok(SubscriptionPayment {
        id: row.get(0)?,
        subscription_id: row.get(1)?,
        paid_on: row.get(2)?,
        amount: row.get(3)?,
        currency: row.get(4)?,
        payment_card_id: row.get(5)?,
        notes: row.get(6)?,
        created_at: row.get(7)?,
        is_presumed: row.get::<_, i64>(8)? != 0,
        card_name: row.get(9)?,
    })
}

#[tauri::command]
pub fn get_subscription_payments(
    state: State<'_, AppState>,
    subscription_id: String,
) -> Result<Vec<SubscriptionPayment>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.subscription_id, p.paid_on, p.amount, p.currency,
                    p.payment_card_id, p.notes, p.created_at, p.is_presumed,
                    pc.name as card_name
             FROM subscription_payments p
             LEFT JOIN payment_cards pc ON p.payment_card_id = pc.id
             WHERE p.subscription_id = ?1
             ORDER BY p.paid_on DESC",
        )
        .map_err(|e| e.to_string())?;

    let payments = stmt
        .query_map([&subscription_id], row_to_payment)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(payments)
}

#[tauri::command]
pub fn log_subscription_payment(
    state: State<'_, AppState>,
    payment: CreateSubscriptionPaymentRequest,
) -> Result<SubscriptionPayment, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = payment.currency.unwrap_or_else(|| "CHF".to_string());

    conn.execute(
        "INSERT INTO subscription_payments (id, subscription_id, paid_on, amount, currency, payment_card_id, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            id,
            payment.subscription_id,
            payment.paid_on,
            payment.amount,
            currency,
            payment.payment_card_id,
            payment.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT p.id, p.subscription_id, p.paid_on, p.amount, p.currency,
                p.payment_card_id, p.notes, p.created_at, p.is_presumed,
                pc.name as card_name
         FROM subscription_payments p
         LEFT JOIN payment_cards pc ON p.payment_card_id = pc.id
         WHERE p.id = ?1",
        [&id],
        row_to_payment,
    )
    .map_err(|e| e.to_string())
}

/// Confirme un paiement présumé (généré par le roll-forward) : le débit a bien
/// eu lieu. Bascule is_presumed à 0 pour qu'il compte comme réellement payé.
#[tauri::command]
pub fn confirm_subscription_payment(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    conn.execute(
        "UPDATE subscription_payments SET is_presumed = 0 WHERE id = ?1",
        [&id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_subscription_payment(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM subscription_payments WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Members ----------

fn row_to_member(row: &rusqlite::Row<'_>) -> rusqlite::Result<SubscriptionMember> {
    Ok(SubscriptionMember {
        id: row.get(0)?,
        subscription_id: row.get(1)?,
        name: row.get(2)?,
        share_amount: row.get(3)?,
        share_percent: row.get(4)?,
        notes: row.get(5)?,
        created_at: row.get(6)?,
    })
}

#[tauri::command]
pub fn get_subscription_members(
    state: State<'_, AppState>,
    subscription_id: String,
) -> Result<Vec<SubscriptionMember>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, subscription_id, name, share_amount, share_percent, notes, created_at
             FROM subscription_members
             WHERE subscription_id = ?1
             ORDER BY name",
        )
        .map_err(|e| e.to_string())?;

    let members = stmt
        .query_map([&subscription_id], row_to_member)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(members)
}

#[tauri::command]
pub fn add_subscription_member(
    state: State<'_, AppState>,
    member: CreateSubscriptionMemberRequest,
) -> Result<SubscriptionMember, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO subscription_members (id, subscription_id, name, share_amount, share_percent, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            id,
            member.subscription_id,
            member.name,
            member.share_amount,
            member.share_percent,
            member.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, subscription_id, name, share_amount, share_percent, notes, created_at
         FROM subscription_members WHERE id = ?1",
        [&id],
        row_to_member,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_subscription_member(
    state: State<'_, AppState>,
    member: SubscriptionMember,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE subscription_members SET name = ?1, share_amount = ?2, share_percent = ?3, notes = ?4
         WHERE id = ?5",
        rusqlite::params![
            member.name,
            member.share_amount,
            member.share_percent,
            member.notes,
            member.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_subscription_member(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute("DELETE FROM subscription_members WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::util::test_support::{test_key, TempDir};

    /// Ouvre un coffre temporaire avec le schéma complet pour exercer le
    /// roll-forward sur une vraie base SQLCipher.
    fn open_db() -> (TempDir, Database) {
        let tmp = TempDir::new();
        let db = Database::open(tmp.path(), &test_key()).unwrap();
        (tmp, db)
    }

    /// Insère un abonnement dont `next_renewal_date` est calculé par SQLite
    /// relativement à aujourd'hui, pour des tests indépendants de la date.
    fn insert_sub(
        conn: &Connection,
        id: &str,
        renewal_modifier: &str,
        cycle: &str,
        interval: i32,
        auto_renewal: bool,
        status: &str,
        trial_modifier: Option<&str>,
    ) {
        let trial_expr = match trial_modifier {
            Some(m) => format!("date('now', '{}')", m),
            None => "NULL".to_string(),
        };
        conn.execute(
            &format!(
                "INSERT INTO subscriptions
                 (id, name, start_date, next_renewal_date, billing_cycle, cycle_interval,
                  price, currency, auto_renewal, status, trial_end_date)
                 VALUES (?1, 'Test', date('now','-1 years'), date('now', '{}'),
                         ?2, ?3, 9.90, 'CHF', ?4, ?5, {})",
                renewal_modifier, trial_expr
            ),
            rusqlite::params![id, cycle, interval, auto_renewal as i32, status],
        )
        .unwrap();
    }

    fn payment_count(conn: &Connection, sub_id: &str) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM subscription_payments WHERE subscription_id = ?1",
            [sub_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn roll_forward_insere_un_paiement_par_cycle_manque() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        // 4 cycles de 10 jours en retard : -35, -25, -15, -5 (tous < aujourd'hui).
        insert_sub(&conn, "s1", "-35 days", "custom", 10, true, "active", None);

        let inserted = roll_forward_inner(&conn).unwrap();
        assert_eq!(inserted, 4);
        assert_eq!(payment_count(&conn, "s1"), 4);

        // Plus aucune échéance dépassée : next_renewal_date repasse dans le futur.
        let next: String = conn
            .query_row(
                "SELECT next_renewal_date FROM subscriptions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let today: String = conn.query_row("SELECT date('now')", [], |r| r.get(0)).unwrap();
        assert!(next >= today);

        // Aucun paiement présumé daté dans le futur.
        let future: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subscription_payments WHERE date(paid_on) >= date('now')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(future, 0);
    }

    #[test]
    fn roll_forward_saute_la_periode_dessai() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        // Échéance dépassée mais essai non terminé → aucun débit ne doit naître.
        insert_sub(
            &conn,
            "s1",
            "-5 days",
            "custom",
            10,
            true,
            "active",
            Some("+10 days"),
        );
        assert_eq!(roll_forward_inner(&conn).unwrap(), 0);
        assert_eq!(payment_count(&conn, "s1"), 0);
    }

    #[test]
    fn roll_forward_ignore_les_abos_non_actifs_ou_sans_renouvellement() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_sub(&conn, "annule", "-35 days", "custom", 10, true, "cancelled", None);
        insert_sub(&conn, "manuel", "-35 days", "custom", 10, false, "active", None);
        assert_eq!(roll_forward_inner(&conn).unwrap(), 0);
        assert_eq!(payment_count(&conn, "annule"), 0);
        assert_eq!(payment_count(&conn, "manuel"), 0);
    }

    #[test]
    fn roll_forward_plafonne_a_1000_iterations() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        // ~5000 jours de retard à 1 jour/cycle : le plafond doit borner à 1000.
        insert_sub(&conn, "s1", "-5000 days", "custom", 1, true, "active", None);
        assert_eq!(roll_forward_inner(&conn).unwrap(), 1000);
        assert_eq!(payment_count(&conn, "s1"), 1000);
        // Toujours en retard : le plafond a interrompu le rattrapage.
        let next: String = conn
            .query_row(
                "SELECT next_renewal_date FROM subscriptions WHERE id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let today: String = conn.query_row("SELECT date('now')", [], |r| r.get(0)).unwrap();
        assert!(next < today);
    }

    #[test]
    fn mark_renewed_puis_roll_forward_ne_double_compte_pas() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        // 4 cycles de retard. mark_renewed en règle un, roll-forward le reste.
        insert_sub(&conn, "s1", "-35 days", "custom", 10, true, "active", None);

        mark_renewed_inner(&conn, "s1").unwrap();
        assert_eq!(payment_count(&conn, "s1"), 1);

        roll_forward_inner(&conn).unwrap();

        // Au total 4 paiements, et surtout 4 dates DISTINCTES : aucune échéance
        // n'est comptée deux fois entre mark_renewed et le roll-forward.
        assert_eq!(payment_count(&conn, "s1"), 4);
        let distinct: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT paid_on) FROM subscription_payments WHERE subscription_id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(distinct, 4);
    }

    #[test]
    fn roll_forward_marque_les_paiements_comme_presumes() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_sub(&conn, "s1", "-35 days", "custom", 10, true, "active", None);
        roll_forward_inner(&conn).unwrap();
        let presumed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subscription_payments WHERE subscription_id='s1' AND is_presumed=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(presumed, 4, "toutes les lignes auto-générées sont présumées");
    }

    #[test]
    fn roll_forward_est_idempotent_sur_les_dates() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_sub(&conn, "s1", "-35 days", "custom", 10, true, "active", None);
        roll_forward_inner(&conn).unwrap();
        let after_first = payment_count(&conn, "s1");
        // Un second passage ne doit RIEN ajouter (garde anti-double-comptage).
        let inserted_again = roll_forward_inner(&conn).unwrap();
        assert_eq!(inserted_again, 0);
        assert_eq!(payment_count(&conn, "s1"), after_first);
    }

    #[test]
    fn mark_renewed_confirme_un_paiement_presume_existant() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_sub(&conn, "s1", "-35 days", "custom", 10, true, "active", None);
        // Le roll-forward crée 4 paiements présumés et avance la date au futur.
        roll_forward_inner(&conn).unwrap();
        let count_before = payment_count(&conn, "s1");
        // On replace l'échéance sur une date déjà payée (présumée) puis on
        // confirme : aucune nouvelle ligne, et celle-ci passe à is_presumed=0.
        conn.execute(
            "UPDATE subscriptions SET next_renewal_date = (SELECT MIN(paid_on) FROM subscription_payments WHERE subscription_id='s1') WHERE id='s1'",
            [],
        )
        .unwrap();
        mark_renewed_inner(&conn, "s1").unwrap();
        assert_eq!(payment_count(&conn, "s1"), count_before, "pas de doublon");
        let confirmed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM subscription_payments WHERE subscription_id='s1' AND is_presumed=0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(confirmed, 1, "le paiement de cette échéance est confirmé");
    }
}

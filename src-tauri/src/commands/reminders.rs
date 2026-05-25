use tauri::State;

use crate::commands::auth::AppState;
use crate::db::models::Reminder;

/// Upcoming reminders unified across entities:
///   - "event"      : ticket event dates (items.event_datetime)
///   - "expiration" : voucher / license / ticket expirations (items.expiration_date)
///   - "renewal"    : subscription renewals (subscriptions.next_renewal_date)
///   - "due"        : engagements whose `next_due_date` is approaching and that
///                    won't auto-pay (so the user still has to act). Skipped if
///                    a `scheduled` charge already covers that date — the
///                    `charge_due` row below is then the source of truth.
///   - "charge_due" : engagement charges still in `status='scheduled'` (e.g.
///                    QR-bill received, not yet paid manually).
///   - "notice"     : contract resignation deadlines, computed as
///                    `contract_end_date − notice_period_days`. Surfaces the
///                    last moment to send a cancellation letter before the
///                    contract auto-renews.
///
/// The dashboard and notification hooks share the same threshold pattern
/// (7 days = urgent, 30 days = warning). Each row carries `entity_type`
/// ("item" | "subscription" | "engagement" | "charge") so the front routes
/// the click to the right detail page. For both 'engagement' and 'charge'
/// rows, `item_id` carries the parent `engagements.id` so the dashboard
/// can always link to `/engagements/:id`.
///
/// Items that have already been used (`redeemed_at IS NOT NULL`) and
/// subscriptions/engagements that are paused/cancelled/ended are excluded.
#[tauri::command]
pub fn get_upcoming_reminders(
    state: State<'_, AppState>,
    days: Option<i32>,
) -> Result<Vec<Reminder>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let days = days.unwrap_or(30);

    let sql = "
        SELECT i.id, 'item' as entity_type, i.description, i.item_kind, 'event' as reminder_type,
               i.event_datetime as target_date,
               CAST(julianday(date(i.event_datetime)) - julianday(date('now')) AS INTEGER) as days_until,
               m.name as merchant_name
        FROM items i
        LEFT JOIN merchants m ON i.merchant_id = m.id
        WHERE i.item_kind = 'ticket'
          AND i.event_datetime IS NOT NULL
          AND i.redeemed_at IS NULL
          AND date(i.event_datetime) >= date('now')
          AND date(i.event_datetime) <= date('now', '+' || ?1 || ' days')

        UNION ALL

        SELECT i.id, 'item' as entity_type, i.description, i.item_kind, 'expiration' as reminder_type,
               i.expiration_date as target_date,
               CAST(julianday(date(i.expiration_date)) - julianday(date('now')) AS INTEGER) as days_until,
               m.name as merchant_name
        FROM items i
        LEFT JOIN merchants m ON i.merchant_id = m.id
        WHERE i.item_kind IN ('voucher', 'license', 'ticket')
          AND i.expiration_date IS NOT NULL
          AND i.redeemed_at IS NULL
          AND date(i.expiration_date) >= date('now')
          AND date(i.expiration_date) <= date('now', '+' || ?1 || ' days')

        UNION ALL

        SELECT s.id, 'subscription' as entity_type, s.name as description,
               s.billing_cycle as item_kind, 'renewal' as reminder_type,
               s.next_renewal_date as target_date,
               CAST(julianday(date(s.next_renewal_date)) - julianday(date('now')) AS INTEGER) as days_until,
               m.name as merchant_name
        FROM subscriptions s
        LEFT JOIN merchants m ON s.merchant_id = m.id
        WHERE s.status = 'active'
          AND s.kind = 'online'
          AND date(s.next_renewal_date) >= date('now')
          AND date(s.next_renewal_date) <= date('now', '+' || ?1 || ' days')

        UNION ALL

        -- Engagements with an upcoming due date that won't auto-settle. Skip
        -- rows where a scheduled charge already materialises that date (the
        -- charge_due block covers it).
        SELECT e.id, 'engagement' as entity_type, e.name as description,
               e.engagement_type as item_kind, 'due' as reminder_type,
               e.next_due_date as target_date,
               CAST(julianday(date(e.next_due_date)) - julianday(date('now')) AS INTEGER) as days_until,
               cr.name as merchant_name
        FROM engagements e
        LEFT JOIN creditors cr ON e.creditor_id = cr.id
        WHERE e.status = 'active'
          AND e.auto_pay = 0
          AND e.next_due_date IS NOT NULL
          AND e.billing_cycle != 'one_shot'
          AND date(e.next_due_date) >= date('now')
          AND date(e.next_due_date) <= date('now', '+' || ?1 || ' days')
          AND NOT EXISTS (
              SELECT 1 FROM engagement_charges ec
              WHERE ec.engagement_id = e.id
                AND ec.due_date = e.next_due_date
                AND ec.status = 'scheduled'
          )

        UNION ALL

        -- Scheduled (unpaid) engagement charges within the window. The
        -- description prefixes the engagement name with a facture marker so
        -- the dashboard can distinguish them from the parent engagement.
        -- `item_id` carries the parent engagement_id (not the charge_id) so
        -- the dashboard click can route directly to `/engagements/:id`.
        SELECT e.id, 'charge' as entity_type,
               e.name || ' — facture' as description,
               e.engagement_type as item_kind, 'charge_due' as reminder_type,
               c.due_date as target_date,
               CAST(julianday(date(c.due_date)) - julianday(date('now')) AS INTEGER) as days_until,
               cr.name as merchant_name
        FROM engagement_charges c
        JOIN engagements e ON c.engagement_id = e.id
        LEFT JOIN creditors cr ON e.creditor_id = cr.id
        WHERE c.status = 'scheduled'
          AND date(c.due_date) >= date('now')
          AND date(c.due_date) <= date('now', '+' || ?1 || ' days')

        UNION ALL

        -- Contract resignation notice: surfaces the latest date the user can
        -- send a cancellation letter before the contract auto-renews. Only
        -- when contract_end_date and notice_period_days are both set.
        SELECT e.id, 'engagement' as entity_type,
               e.name as description,
               e.engagement_type as item_kind, 'notice' as reminder_type,
               date(e.contract_end_date, '-' || e.notice_period_days || ' days') as target_date,
               CAST(julianday(date(e.contract_end_date, '-' || e.notice_period_days || ' days'))
                    - julianday(date('now')) AS INTEGER) as days_until,
               cr.name as merchant_name
        FROM engagements e
        LEFT JOIN creditors cr ON e.creditor_id = cr.id
        WHERE e.status = 'active'
          AND e.contract_end_date IS NOT NULL
          AND e.notice_period_days IS NOT NULL
          AND date(e.contract_end_date, '-' || e.notice_period_days || ' days') >= date('now')
          AND date(e.contract_end_date, '-' || e.notice_period_days || ' days') <= date('now', '+' || ?1 || ' days')

        ORDER BY target_date
    ";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let reminders = stmt
        .query_map([days], |row| {
            Ok(Reminder {
                item_id: row.get(0)?,
                entity_type: row.get(1)?,
                description: row.get(2)?,
                item_kind: row.get(3)?,
                reminder_type: row.get(4)?,
                target_date: row.get(5)?,
                days_until: row.get(6)?,
                merchant_name: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(reminders)
}

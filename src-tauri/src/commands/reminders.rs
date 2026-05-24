use tauri::State;

use crate::commands::auth::AppState;
use crate::db::models::Reminder;

/// Upcoming reminders unified across entities:
///   - "event"      : ticket event dates (items.event_datetime)
///   - "expiration" : voucher / license / ticket expirations (items.expiration_date)
///   - "renewal"    : subscription renewals (subscriptions.next_renewal_date)
///
/// The dashboard and notification hook share the same threshold pattern
/// (7 days = urgent, 30 days = warning). Each row carries `entity_type`
/// ("item" | "subscription") so the front can route the click to the right
/// detail page.
///
/// Items that have already been used (`redeemed_at IS NOT NULL`) and
/// subscriptions that are paused/cancelled are excluded.
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
          AND date(s.next_renewal_date) >= date('now')
          AND date(s.next_renewal_date) <= date('now', '+' || ?1 || ' days')

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

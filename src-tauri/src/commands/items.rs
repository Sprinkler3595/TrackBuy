use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{CreateItemRequest, CreateOrderRequest, CreateOrderResult, Item};
use crate::storage;
use crate::util::path::validate_read_source;

#[tauri::command]
pub fn get_items(
    state: State<'_, AppState>,
    search: Option<String>,
    status: Option<String>,
    merchant_id: Option<String>,
    location_id: Option<String>,
    // Kind filter for the /items vs /tickets split.
    // - None or "all": return everything.
    // - "physical": only physical purchases (used by the existing Items page).
    // - "digital": tickets + vouchers + licenses (used by the Tickets page).
    // - any specific kind value ("ticket", "voucher", "license"): exact match.
    kind: Option<String>,
) -> Result<Vec<Item>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut sql = format!(
        "SELECT {} FROM items i
         LEFT JOIN merchants m ON i.merchant_id = m.id
         LEFT JOIN locations l ON i.location_id = l.id
         LEFT JOIN payment_cards pc ON i.payment_card_id = pc.id
         WHERE 1=1",
        ITEM_SELECT_COLUMNS
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref s) = status {
        if s != "all" {
            sql.push_str(" AND i.status = ?");
            params.push(Box::new(s.clone()));
        }
    }
    if let Some(ref mid) = merchant_id {
        sql.push_str(" AND i.merchant_id = ?");
        params.push(Box::new(mid.clone()));
    }
    if let Some(ref lid) = location_id {
        sql.push_str(" AND i.location_id = ?");
        params.push(Box::new(lid.clone()));
    }
    if let Some(ref k) = kind {
        match k.as_str() {
            "all" | "" => {}
            "digital" => {
                sql.push_str(" AND i.item_kind <> 'physical'");
            }
            other => {
                sql.push_str(" AND i.item_kind = ?");
                params.push(Box::new(other.to_string()));
            }
        }
    }
    if let Some(ref q) = search {
        if !q.is_empty() {
            sql.push_str(" AND (i.description LIKE ? OR i.notes LIKE ? OR i.invoice_number LIKE ? OR i.product_reference LIKE ?)");
            let pattern = format!("%{}%", q);
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern));
        }
    }

    sql.push_str(" ORDER BY i.purchase_date DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(param_refs.as_slice(), row_to_item)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}

/// SELECT clause used in every `Item` fetch — keeps columns and indexes
/// aligned between queries.
const ITEM_SELECT_COLUMNS: &str =
    "i.id, i.description, i.purchase_date, i.purchase_price, i.currency,
     i.status, i.merchant_id, i.location_id, i.payment_card_id, i.notes,
     i.invoice_number, i.product_reference, i.quantity, i.price_excl_tax, i.tax_rate,
     i.order_id, i.item_kind, i.event_datetime, i.event_location,
     i.expiration_date, i.redemption_url, i.redeemed_at,
     i.created_at, i.updated_at,
     m.name as merchant_name, l.name as location_name, pc.name as card_name";

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<Item> {
    Ok(Item {
        id: row.get(0)?,
        description: row.get(1)?,
        purchase_date: row.get(2)?,
        purchase_price: row.get(3)?,
        currency: row.get(4)?,
        status: row.get(5)?,
        merchant_id: row.get(6)?,
        location_id: row.get(7)?,
        payment_card_id: row.get(8)?,
        notes: row.get(9)?,
        invoice_number: row.get(10)?,
        product_reference: row.get(11)?,
        quantity: row.get(12)?,
        price_excl_tax: row.get(13)?,
        tax_rate: row.get(14)?,
        order_id: row.get(15)?,
        item_kind: row.get(16)?,
        event_datetime: row.get(17)?,
        event_location: row.get(18)?,
        expiration_date: row.get(19)?,
        redemption_url: row.get(20)?,
        redeemed_at: row.get(21)?,
        created_at: row.get(22)?,
        updated_at: row.get(23)?,
        merchant_name: row.get(24)?,
        location_name: row.get(25)?,
        card_name: row.get(26)?,
    })
}

#[tauri::command]
pub fn create_item(
    state: State<'_, AppState>,
    item: CreateItemRequest,
) -> Result<Item, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let currency = item.currency.unwrap_or_else(|| "CAD".to_string());
    let status = item.status.unwrap_or_else(|| "active".to_string());
    let quantity = item.quantity.unwrap_or(1);
    let item_kind = item.item_kind.unwrap_or_else(|| "physical".to_string());

    conn.execute(
        "INSERT INTO items (id, description, purchase_date, purchase_price, currency, status,
         merchant_id, location_id, payment_card_id, notes,
         invoice_number, product_reference, quantity, price_excl_tax, tax_rate, order_id,
         item_kind, event_datetime, event_location, expiration_date, redemption_url, redeemed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                 ?17, ?18, ?19, ?20, ?21, ?22)",
        rusqlite::params![
            id, item.description, item.purchase_date, item.purchase_price,
            currency, status, item.merchant_id, item.location_id,
            item.payment_card_id, item.notes,
            item.invoice_number, item.product_reference, quantity,
            item.price_excl_tax, item.tax_rate, item.order_id,
            item_kind, item.event_datetime, item.event_location,
            item.expiration_date, item.redemption_url, item.redeemed_at,
        ],
    ).map_err(|e| e.to_string())?;

    // Return the created item with joined fields
    let sql = format!(
        "SELECT {} FROM items i
         LEFT JOIN merchants m ON i.merchant_id = m.id
         LEFT JOIN locations l ON i.location_id = l.id
         LEFT JOIN payment_cards pc ON i.payment_card_id = pc.id
         WHERE i.id = ?1",
        ITEM_SELECT_COLUMNS
    );
    let created = conn.query_row(&sql, [&id], row_to_item).map_err(|e| e.to_string())?;

    Ok(created)
}

#[tauri::command]
pub fn update_item(
    state: State<'_, AppState>,
    item: Item,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE items SET description = ?1, purchase_date = ?2, purchase_price = ?3,
         currency = ?4, status = ?5, merchant_id = ?6, location_id = ?7,
         payment_card_id = ?8, notes = ?9,
         invoice_number = ?10, product_reference = ?11, quantity = ?12,
         price_excl_tax = ?13, tax_rate = ?14,
         item_kind = ?15, event_datetime = ?16, event_location = ?17,
         expiration_date = ?18, redemption_url = ?19, redeemed_at = ?20,
         updated_at = datetime('now')
         WHERE id = ?21",
        rusqlite::params![
            item.description, item.purchase_date, item.purchase_price,
            item.currency, item.status, item.merchant_id, item.location_id,
            item.payment_card_id, item.notes,
            item.invoice_number, item.product_reference, item.quantity,
            item.price_excl_tax, item.tax_rate,
            item.item_kind, item.event_datetime, item.event_location,
            item.expiration_date, item.redemption_url, item.redeemed_at,
            item.id
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_item(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // If this item belongs to an order, find out so we can clean up the
    // shared (order-level) attachments when the last sibling is removed.
    let order_id: Option<String> = conn
        .query_row("SELECT order_id FROM items WHERE id = ?1", [&id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM items WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if let Some(ref oid) = order_id {
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM items WHERE order_id = ?1",
                [oid],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if remaining == 0 {
            // Last sibling: delete order-level attachments (both DB rows and
            // their encrypted files on disk).
            let mut stmt = conn
                .prepare("SELECT file_path FROM attachments WHERE order_id = ?1 AND item_id IS NULL")
                .map_err(|e| e.to_string())?;
            let paths: Vec<String> = stmt
                .query_map([oid], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            conn.execute(
                "DELETE FROM attachments WHERE order_id = ?1 AND item_id IS NULL",
                [oid],
            )
            .map_err(|e| e.to_string())?;

            for p in paths {
                let _ = storage::delete_attachment_file(&p);
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn create_order_with_items(
    state: State<'_, AppState>,
    order: CreateOrderRequest,
) -> Result<CreateOrderResult, String> {
    if order.lines.is_empty() {
        return Err("Au moins un article requis".to_string());
    }

    // Validate the invoice path BEFORE touching the DB so we fail early.
    let invoice_data: Option<(String, String, Vec<u8>, String)> = if let Some(ref src) = order.invoice_source_path {
        let safe = validate_read_source(src)?;
        let bytes = std::fs::read(&safe).map_err(|e| format!("Failed to read invoice: {}", e))?;
        if bytes.len() as i64 > 100 * 1024 * 1024 {
            return Err("Facture trop volumineuse (max 100 MB)".to_string());
        }
        let original_name = safe.file_name().unwrap_or_default().to_string_lossy().to_string();
        let mime = storage::detect_mime_type(&original_name);
        let display = order.invoice_display_name.clone().unwrap_or_else(|| original_name.clone());
        Some((original_name, display, bytes, mime))
    } else {
        None
    };

    let order_id = Uuid::new_v4().to_string();
    let currency = order.currency.clone().unwrap_or_else(|| "CAD".to_string());
    let status = order.status.clone().unwrap_or_else(|| "active".to_string());

    let vault_dir_guard = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir_guard.as_ref().ok_or("No active vault")?.clone();
    drop(vault_dir_guard);

    let key_guard = state.encryption_key.lock().map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?.clone();
    drop(key_guard);

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let mut conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut created_ids: Vec<String> = Vec::with_capacity(order.lines.len());
    for line in &order.lines {
        let item_id = Uuid::new_v4().to_string();
        let quantity = line.quantity.unwrap_or(1);
        tx.execute(
            "INSERT INTO items (id, description, purchase_date, purchase_price, currency, status,
             merchant_id, location_id, payment_card_id, notes,
             invoice_number, product_reference, quantity, price_excl_tax, tax_rate, order_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            rusqlite::params![
                item_id,
                line.description,
                order.purchase_date,
                line.purchase_price,
                currency,
                status,
                order.merchant_id,
                order.location_id,
                order.payment_card_id,
                line.notes,
                order.invoice_number,
                line.product_reference,
                quantity,
                line.price_excl_tax,
                line.tax_rate,
                order_id,
            ],
        )
        .map_err(|e| e.to_string())?;

        if let Some(months) = line.warranty_months {
            if months > 0 {
                let warranty_id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO warranties (id, item_id, start_date, duration_months, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![warranty_id, item_id, order.purchase_date, months, "Garantie fabricant"],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        created_ids.push(item_id);
    }

    // Persist the shared invoice (encrypted) and link it to the order_id.
    if let Some((original_name, display, bytes, mime)) = invoice_data {
        let att_id = Uuid::new_v4().to_string();
        let key_bytes: &[u8; 32] = &key;
        let file_path = storage::save_attachment(&vault_dir, &att_id, &bytes, key_bytes)?;
        tx.execute(
            "INSERT INTO attachments (id, item_id, order_id, original_name, display_name, mime_type, file_path, size_bytes, attachment_type)
             VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                att_id,
                order_id,
                original_name,
                display,
                mime,
                file_path,
                bytes.len() as i64,
                "invoice",
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    // Fetch all created items with joined fields.
    let sql = format!(
        "SELECT {} FROM items i
         LEFT JOIN merchants m ON i.merchant_id = m.id
         LEFT JOIN locations l ON i.location_id = l.id
         LEFT JOIN payment_cards pc ON i.payment_card_id = pc.id
         WHERE i.order_id = ?1
         ORDER BY i.created_at",
        ITEM_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map([&order_id], row_to_item)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(CreateOrderResult { order_id, items })
}

#[tauri::command]
pub fn link_items_to_order(
    state: State<'_, AppState>,
    item_ids: Vec<String>,
) -> Result<String, String> {
    if item_ids.len() < 2 {
        return Err("Au moins deux articles requis pour grouper".to_string());
    }

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let mut conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // If any selected item already belongs to an order, reuse the most common
    // order_id so we merge rather than overwrite an existing grouping.
    let existing_orders: Vec<String> = {
        let placeholders = std::iter::repeat("?")
            .take(item_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT order_id FROM items WHERE id IN ({}) AND order_id IS NOT NULL",
            placeholders
        );
        let params: Vec<&dyn rusqlite::types::ToSql> =
            item_ids.iter().map(|i| i as &dyn rusqlite::types::ToSql).collect();
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        stmt.query_map(params.as_slice(), |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let order_id = existing_orders
        .into_iter()
        .next()
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in &item_ids {
        tx.execute(
            "UPDATE items SET order_id = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![order_id, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(order_id)
}

#[tauri::command]
pub fn unlink_item_from_order(
    state: State<'_, AppState>,
    item_id: String,
) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE items SET order_id = NULL, updated_at = datetime('now') WHERE id = ?1",
        [&item_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

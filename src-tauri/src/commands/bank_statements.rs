use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{
    BankMatchRule, BankStatement, BankStatementTransaction, CreateBankMatchRuleRequest,
    ExtractedTransactionInput,
};
use crate::storage;
use crate::util::path::validate_read_source;

const STATEMENT_COLUMNS: &str =
    "id, label, bank_name, account_iban, period_start, period_end, statement_date,
     opening_balance, closing_balance, currency, file_path, original_name, mime_type,
     size_bytes, status, extracted_at, notes, created_at, updated_at";

fn row_to_statement(row: &rusqlite::Row<'_>) -> rusqlite::Result<BankStatement> {
    Ok(BankStatement {
        id: row.get(0)?,
        label: row.get(1)?,
        bank_name: row.get(2)?,
        account_iban: row.get(3)?,
        period_start: row.get(4)?,
        period_end: row.get(5)?,
        statement_date: row.get(6)?,
        opening_balance: row.get(7)?,
        closing_balance: row.get(8)?,
        currency: row.get(9)?,
        file_path: row.get(10)?,
        original_name: row.get(11)?,
        mime_type: row.get(12)?,
        size_bytes: row.get(13)?,
        status: row.get(14)?,
        extracted_at: row.get(15)?,
        notes: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
    })
}

const TX_COLUMNS: &str =
    "id, statement_id, transaction_date, booking_date, raw_description, cleaned_description,
     amount, currency, direction, reference_number, counterparty_iban,
     match_target_kind, match_target_id, match_confidence, match_rule_id, match_status,
     review_notes, created_at, updated_at";

fn row_to_tx(row: &rusqlite::Row<'_>) -> rusqlite::Result<BankStatementTransaction> {
    Ok(BankStatementTransaction {
        id: row.get(0)?,
        statement_id: row.get(1)?,
        transaction_date: row.get(2)?,
        booking_date: row.get(3)?,
        raw_description: row.get(4)?,
        cleaned_description: row.get(5)?,
        amount: row.get(6)?,
        currency: row.get(7)?,
        direction: row.get(8)?,
        reference_number: row.get(9)?,
        counterparty_iban: row.get(10)?,
        match_target_kind: row.get(11)?,
        match_target_id: row.get(12)?,
        match_confidence: row.get(13)?,
        match_rule_id: row.get(14)?,
        match_status: row.get(15)?,
        review_notes: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        match_target_label: None,
    })
}

const RULE_COLUMNS: &str =
    "id, pattern, pattern_kind, direction, amount_min, amount_max, target_kind, target_id,
     learned, enabled, hit_count, last_hit_at, notes, created_at, updated_at";

fn row_to_rule(row: &rusqlite::Row<'_>) -> rusqlite::Result<BankMatchRule> {
    Ok(BankMatchRule {
        id: row.get(0)?,
        pattern: row.get(1)?,
        pattern_kind: row.get(2)?,
        direction: row.get(3)?,
        amount_min: row.get(4)?,
        amount_max: row.get(5)?,
        target_kind: row.get(6)?,
        target_id: row.get(7)?,
        learned: row.get(8)?,
        enabled: row.get(9)?,
        hit_count: row.get(10)?,
        last_hit_at: row.get(11)?,
        notes: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

/// Normalise a bank libellé so the matching is robust to surface noise:
/// lowercase, collapse whitespace, strip very long digit runs (which tend
/// to be QR-bill references that vary across months). The original
/// description stays in `raw_description` for display.
fn clean_description(raw: &str) -> String {
    let lowered = raw.to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut last_was_space = false;
    let mut digit_run = 0;
    for ch in lowered.chars() {
        if ch.is_ascii_digit() {
            digit_run += 1;
            if digit_run <= 4 {
                out.push(ch);
                last_was_space = false;
            } else if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else if ch.is_whitespace() {
            digit_run = 0;
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else {
            digit_run = 0;
            out.push(ch);
            last_was_space = false;
        }
    }
    out.trim().to_string()
}

// =====================================================================
// Statement import (file is already encrypted by storage::save_attachment)
// =====================================================================

#[tauri::command]
pub fn add_bank_statement(
    state: State<'_, AppState>,
    source_path: String,
    label: Option<String>,
    bank_name: Option<String>,
) -> Result<BankStatement, String> {
    let safe_source = validate_read_source(&source_path)?;
    let data = std::fs::read(&safe_source).map_err(|e| format!("Failed to read file: {}", e))?;

    let size_bytes = data.len() as i64;
    if size_bytes > 100 * 1024 * 1024 {
        return Err("File too large (max 100 MB)".to_string());
    }

    let original_name = safe_source
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let mime_type = storage::detect_mime_type(&original_name);

    let id = Uuid::new_v4().to_string();

    let vault_dir = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir.as_ref().ok_or("No active vault")?;
    let key_guard = state.encryption_key.lock().map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?;
    let key_bytes: &[u8; 32] = key;
    let file_path = storage::save_attachment(vault_dir, &id, &data, key_bytes)?;

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "INSERT INTO bank_statements (id, label, bank_name, file_path, original_name,
         mime_type, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, label, bank_name, file_path, original_name, mime_type, size_bytes],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!("SELECT {} FROM bank_statements WHERE id = ?1", STATEMENT_COLUMNS);
    conn.query_row(&sql, [&id], row_to_statement)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_bank_statements(
    state: State<'_, AppState>,
    status: Option<String>,
) -> Result<Vec<BankStatement>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match status {
        Some(ref s) if s != "all" && !s.is_empty() => (
            format!(
                "SELECT {} FROM bank_statements WHERE status = ?1 ORDER BY created_at DESC",
                STATEMENT_COLUMNS
            ),
            vec![Box::new(s.clone())],
        ),
        _ => (
            format!("SELECT {} FROM bank_statements ORDER BY created_at DESC", STATEMENT_COLUMNS),
            vec![],
        ),
    };
    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_statement)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn get_bank_statement(
    state: State<'_, AppState>,
    id: String,
) -> Result<BankStatement, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    let sql = format!("SELECT {} FROM bank_statements WHERE id = ?1", STATEMENT_COLUMNS);
    conn.query_row(&sql, [&id], row_to_statement)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bank_statement(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Capture the PDF path before the row is dropped — same pattern as
    // delete_engagement / delete_income.
    let file_path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM bank_statements WHERE id = ?1",
            [&id],
            |row| row.get::<_, String>(0),
        )
        .ok();

    conn.execute("DELETE FROM bank_statements WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    if let Some(path) = file_path {
        let _ = crate::storage::delete_attachment_file(&path);
    }
    Ok(())
}

// =====================================================================
// Persist AI-extracted transactions (parsing itself happens in the front,
// via pdfjs + `ai_extract_bank_statement`)
// =====================================================================

#[tauri::command]
pub fn save_extracted_transactions(
    state: State<'_, AppState>,
    statement_id: String,
    transactions: Vec<ExtractedTransactionInput>,
) -> Result<i32, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Drop any previous extraction so the user can re-run without dupes.
    conn.execute(
        "DELETE FROM bank_statement_transactions WHERE statement_id = ?1",
        [&statement_id],
    )
    .map_err(|e| e.to_string())?;

    let mut inserted = 0;
    for tx in &transactions {
        let id = Uuid::new_v4().to_string();
        let cleaned = clean_description(&tx.raw_description);
        let currency = tx
            .currency
            .clone()
            .unwrap_or_else(|| "CHF".to_string());
        conn.execute(
            "INSERT INTO bank_statement_transactions (id, statement_id, transaction_date,
             booking_date, raw_description, cleaned_description, amount, currency, direction,
             reference_number, counterparty_iban, match_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'unmatched')",
            rusqlite::params![
                id,
                statement_id,
                tx.transaction_date,
                tx.booking_date,
                tx.raw_description,
                cleaned,
                tx.amount,
                currency,
                tx.direction,
                tx.reference_number,
                tx.counterparty_iban,
            ],
        )
        .map_err(|e| e.to_string())?;
        inserted += 1;
    }

    conn.execute(
        "UPDATE bank_statements SET status = 'extracted',
         extracted_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?1",
        [&statement_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(inserted)
}

#[tauri::command]
pub fn list_statement_transactions(
    state: State<'_, AppState>,
    statement_id: String,
) -> Result<Vec<BankStatementTransaction>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM bank_statement_transactions
         WHERE statement_id = ?1
         ORDER BY transaction_date, id",
        TX_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([&statement_id], row_to_tx)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Resolve `match_target_label` from the target table so the UI shows
    // a human-readable hint without an extra round-trip per row.
    for r in &mut rows {
        if let (Some(kind), Some(target_id)) = (&r.match_target_kind, &r.match_target_id) {
            let label: Option<String> = match kind.as_str() {
                "engagement" | "engagement_charge" => conn
                    .query_row(
                        "SELECT name FROM engagements WHERE id = ?1",
                        [target_id],
                        |row| row.get(0),
                    )
                    .ok(),
                "subscription" | "subscription_payment" => conn
                    .query_row(
                        "SELECT name FROM subscriptions WHERE id = ?1",
                        [target_id],
                        |row| row.get(0),
                    )
                    .ok(),
                "income" | "income_receipt" => conn
                    .query_row(
                        "SELECT name FROM incomes WHERE id = ?1",
                        [target_id],
                        |row| row.get(0),
                    )
                    .ok(),
                "item" => conn
                    .query_row(
                        "SELECT description FROM items WHERE id = ?1",
                        [target_id],
                        |row| row.get(0),
                    )
                    .ok(),
                "reimbursement" => conn
                    .query_row(
                        "SELECT label FROM pending_reimbursements WHERE id = ?1",
                        [target_id],
                        |row| row.get(0),
                    )
                    .ok(),
                "merchant" => conn
                    .query_row(
                        "SELECT name FROM merchants WHERE id = ?1",
                        [target_id],
                        |row| row.get(0),
                    )
                    .ok(),
                _ => None,
            };
            r.match_target_label = label;
        }
    }

    Ok(rows)
}

/// Compute suggestions for every transaction of a statement that's still
/// `unmatched`: (1) check learned rules first (best signal), then fall back
/// to a substring match against engagements / subscriptions / merchants.
/// Each suggested transaction is moved to `suggested` with a confidence and
/// — when a rule fired — the rule's `match_rule_id`. Rule hit_count is
/// incremented in the same transaction so popular rules surface in the
/// settings UI.
#[tauri::command]
pub fn suggest_matches_for_statement(
    state: State<'_, AppState>,
    statement_id: String,
) -> Result<i32, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Load active rules into memory — small set in practice.
    let rules: Vec<BankMatchRule> = {
        let sql = format!(
            "SELECT {} FROM bank_match_rules WHERE enabled = 1 ORDER BY hit_count DESC",
            RULE_COLUMNS
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        stmt.query_map([], row_to_rule)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect()
    };

    let txs: Vec<(String, String, Option<String>, f64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, raw_description, cleaned_description, amount, direction
                 FROM bank_statement_transactions
                 WHERE statement_id = ?1 AND match_status = 'unmatched'",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map([&statement_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    let mut updated = 0;
    for (tx_id, raw, cleaned, amount, direction) in txs {
        let haystack = cleaned.clone().unwrap_or_else(|| raw.to_lowercase());
        // 1) Persisted rules
        let mut matched: Option<(String, String, String, f64)> = None; // (kind, id, rule_id, conf)
        for r in &rules {
            if let Some(ref d) = r.direction {
                if d != &direction { continue; }
            }
            if let Some(min) = r.amount_min { if amount < min { continue; } }
            if let Some(max) = r.amount_max { if amount > max { continue; } }
            let needle = r.pattern.to_lowercase();
            let hit = if r.pattern_kind == "substring" {
                haystack.contains(&needle)
            } else {
                // Naive regex fallback: we keep things simple by skipping
                // until we add the `regex` crate explicitly.
                haystack.contains(&needle)
            };
            if hit {
                matched = Some((r.target_kind.clone(), r.target_id.clone(), r.id.clone(), 1.0));
                break;
            }
        }

        // 2) Heuristic: engagements / subscriptions / merchants by name.
        if matched.is_none() {
            let candidates: Vec<(String, String, String)> = {
                let mut stmt = conn
                    .prepare(
                        "SELECT 'engagement' as kind, id, lower(name) as needle FROM engagements WHERE status = 'active'
                         UNION ALL
                         SELECT 'subscription' as kind, id, lower(name) FROM subscriptions WHERE status = 'active'
                         UNION ALL
                         SELECT 'merchant' as kind, id, lower(name) FROM merchants
                         UNION ALL
                         SELECT 'income' as kind, id, lower(name) FROM incomes WHERE status = 'active'",
                    )
                    .map_err(|e| e.to_string())?;
                stmt.query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
            };
            for (kind, id, needle) in &candidates {
                if needle.len() < 3 { continue; } // skip pathological short names
                if haystack.contains(needle) {
                    matched = Some((kind.clone(), id.clone(), String::new(), 0.7));
                    break;
                }
            }
        }

        if let Some((kind, target_id, rule_id, conf)) = matched {
            conn.execute(
                "UPDATE bank_statement_transactions SET match_status = 'suggested',
                 match_target_kind = ?1, match_target_id = ?2,
                 match_rule_id = NULLIF(?3, ''), match_confidence = ?4,
                 updated_at = datetime('now')
                 WHERE id = ?5",
                rusqlite::params![kind, target_id, rule_id, conf, tx_id],
            )
            .map_err(|e| e.to_string())?;
            if !rule_id.is_empty() {
                conn.execute(
                    "UPDATE bank_match_rules SET hit_count = hit_count + 1,
                     last_hit_at = datetime('now') WHERE id = ?1",
                    [&rule_id],
                )
                .map_err(|e| e.to_string())?;
            }
            updated += 1;
        }
    }

    Ok(updated)
}

/// Confirm a suggestion (or assign a fresh target on an `unmatched` line),
/// optionally persisting the libellé → target mapping as a `bank_match_rules`
/// row so the next statement picks it up automatically.
#[tauri::command]
pub fn apply_transaction_match(
    state: State<'_, AppState>,
    tx_id: String,
    target_kind: String,
    target_id: String,
    learn_rule: Option<bool>,
) -> Result<BankStatementTransaction, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let (cleaned, direction): (Option<String>, String) = conn
        .query_row(
            "SELECT cleaned_description, direction
             FROM bank_statement_transactions WHERE id = ?1",
            [&tx_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE bank_statement_transactions SET match_status = 'confirmed',
         match_target_kind = ?1, match_target_id = ?2, updated_at = datetime('now')
         WHERE id = ?3",
        rusqlite::params![target_kind, target_id, tx_id],
    )
    .map_err(|e| e.to_string())?;

    if learn_rule.unwrap_or(false) {
        if let Some(pattern_seed) = cleaned {
            // Drop digit-heavy tokens before learning so the pattern stays
            // stable across months (BVR refs change every cycle).
            let pattern: String = pattern_seed
                .split_whitespace()
                .filter(|tok| !tok.chars().all(|c| c.is_ascii_digit()))
                .take(3)
                .collect::<Vec<_>>()
                .join(" ");
            if !pattern.is_empty() {
                let id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO bank_match_rules (id, pattern, pattern_kind, direction,
                     target_kind, target_id, learned, enabled)
                     VALUES (?1, ?2, 'substring', ?3, ?4, ?5, 1, 1)",
                    rusqlite::params![id, pattern, direction, target_kind, target_id],
                )
                .ok(); // duplicate patterns are silently ignored
            }
        }
    }

    let sql = format!(
        "SELECT {} FROM bank_statement_transactions WHERE id = ?1",
        TX_COLUMNS
    );
    conn.query_row(&sql, [&tx_id], row_to_tx)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ignore_transaction(state: State<'_, AppState>, tx_id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    conn.execute(
        "UPDATE bank_statement_transactions SET match_status = 'ignored',
         updated_at = datetime('now') WHERE id = ?1",
        [&tx_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// =====================================================================
// Match rule management (settings/bank-rules page)
// =====================================================================

#[tauri::command]
pub fn list_match_rules(
    state: State<'_, AppState>,
    enabled: Option<bool>,
) -> Result<Vec<BankMatchRule>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match enabled {
        Some(e) => (
            format!(
                "SELECT {} FROM bank_match_rules WHERE enabled = ?1 ORDER BY hit_count DESC, created_at DESC",
                RULE_COLUMNS
            ),
            vec![Box::new(e)],
        ),
        None => (
            format!(
                "SELECT {} FROM bank_match_rules ORDER BY hit_count DESC, created_at DESC",
                RULE_COLUMNS
            ),
            vec![],
        ),
    };

    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), row_to_rule)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn create_match_rule(
    state: State<'_, AppState>,
    rule: CreateBankMatchRuleRequest,
) -> Result<BankMatchRule, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = Uuid::new_v4().to_string();
    let pattern_kind = rule.pattern_kind.unwrap_or_else(|| "substring".to_string());
    let learned = rule.learned.unwrap_or(false);

    conn.execute(
        "INSERT INTO bank_match_rules (id, pattern, pattern_kind, direction, amount_min,
         amount_max, target_kind, target_id, learned, enabled, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10)",
        rusqlite::params![
            id,
            rule.pattern,
            pattern_kind,
            rule.direction,
            rule.amount_min,
            rule.amount_max,
            rule.target_kind,
            rule.target_id,
            learned,
            rule.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!("SELECT {} FROM bank_match_rules WHERE id = ?1", RULE_COLUMNS);
    conn.query_row(&sql, [&id], row_to_rule).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_match_rule(state: State<'_, AppState>, rule: BankMatchRule) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    conn.execute(
        "UPDATE bank_match_rules SET pattern = ?1, pattern_kind = ?2, direction = ?3,
         amount_min = ?4, amount_max = ?5, target_kind = ?6, target_id = ?7,
         enabled = ?8, notes = ?9, updated_at = datetime('now')
         WHERE id = ?10",
        rusqlite::params![
            rule.pattern,
            rule.pattern_kind,
            rule.direction,
            rule.amount_min,
            rule.amount_max,
            rule.target_kind,
            rule.target_id,
            rule.enabled,
            rule.notes,
            rule.id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_match_rule(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    conn.execute("DELETE FROM bank_match_rules WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Surface the encrypted PDF as base64 so the front (pdfjs) can render
/// it for visual cross-check during review. Same access path as
/// `get_attachment_data` but resolved via the `bank_statements.file_path`.
#[tauri::command]
pub fn get_bank_statement_data(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let file_path: String = {
        let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
        let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
        conn.query_row(
            "SELECT file_path FROM bank_statements WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| format!("Statement not found: {}", e))?
    };

    let key_guard = state.encryption_key.lock().map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?;
    let key_bytes: &[u8; 32] = key;

    let data = storage::read_attachment(&file_path, key_bytes)?;
    use base64::{engine::general_purpose, Engine as _};
    Ok(general_purpose::STANDARD.encode(data))
}

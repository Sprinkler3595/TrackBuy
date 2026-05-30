use std::collections::HashMap;

use chrono::NaiveDate;
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::commands::items::{fetch_item_by_id, insert_item_row};
use crate::commands::pending_invoices::{
    row_to_pending_invoice, PENDING_INVOICE_SELECT_COLUMNS,
};
use crate::db::models::{
    BankMatchRule, BankStatement, BankStatementTransaction, CreateBankMatchRuleRequest,
    CreateItemRequest, ExtractedTransactionInput, Item, PendingInvoice,
};
use crate::storage;
use crate::util::path::validate_read_source;

// =====================================================================
// Item-matching tuning. Used by suggest_matches_for_statement to find
// already-entered purchases that line up with a bank line, so the user
// doesn't end up with duplicates after importing the monthly statement.
// =====================================================================

/// Window (in days) around a candidate item's purchase_date in which a
/// bank line can still legitimately settle it. Covers card-debit lag
/// (1-3d typical), PayPal / late captures (up to a week).
const ITEM_DATE_TOLERANCE_DAYS: i64 = 7;

/// Slack on the price comparison, in cents. Absorbs rounding noise on
/// foreign-currency lines while staying tight enough to avoid false
/// positives (a 0.10 CHF window would already overlap many cart totals).
const AMOUNT_EPSILON_CENTS: i64 = 2;

/// Hard cap on the subset-sum search per (merchant, day) bucket. The
/// meet-in-the-middle algorithm is O(2^(N/2)), so 12 ≈ 2^6 = 64 combos
/// per half — instant. Bigger buckets fall back to single-item matching
/// only, which is fine: nobody buys 13 items in one day at one store.
const MAX_GROUP_CANDIDATES: usize = 12;

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
     review_notes, match_group_ids, created_at, updated_at,
     location, original_amount, original_currency, exchange_rate";

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
        match_group_ids: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        match_target_label: None,
        location: row.get(20)?,
        original_amount: row.get(21)?,
        original_currency: row.get(22)?,
        exchange_rate: row.get(23)?,
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

/// Mirror of `src/lib/fuzzy-match.ts::normalizeName`: lowercase, strip
/// accents, keep alphanumerics and spaces only, collapse whitespace.
/// "L'Apple Store !" → "lapple store". Used by item matching so a libellé
/// like "MIGROS-GENEVE 4565" still matches a merchant named "Migros".
fn normalize_name(s: &str) -> String {
    let lowered = s.to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut last_space = true;
    for ch in lowered.nfd_strip_accents().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_space = false;
        } else if !last_space {
            out.push(' ');
            last_space = true;
        }
    }
    out.trim().to_string()
}

/// Tiny extension trait to fold NFD accent stripping into the iterator
/// chain above without pulling in `unicode-normalization` — we just hand
/// the bytes through and let `char::is_ascii_alphanumeric` discard the
/// combining marks that NFD would produce.
trait NfdStrip {
    fn nfd_strip_accents(&self) -> String;
}
impl NfdStrip for String {
    fn nfd_strip_accents(&self) -> String {
        // Manual stripping table for the few European accents we actually
        // hit on Swiss merchant names. Far cheaper than a full NFD pass
        // and avoids the extra crate dependency.
        let mut out = String::with_capacity(self.len());
        for ch in self.chars() {
            let replacement = match ch {
                'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
                'ç' => 'c',
                'è' | 'é' | 'ê' | 'ë' => 'e',
                'ì' | 'í' | 'î' | 'ï' => 'i',
                'ñ' => 'n',
                'ò' | 'ó' | 'ô' | 'ö' | 'õ' => 'o',
                'ù' | 'ú' | 'û' | 'ü' => 'u',
                'ý' | 'ÿ' => 'y',
                'ß' => 's',
                _ => ch,
            };
            out.push(replacement);
        }
        out
    }
}

/// In-memory snapshot of an item that could still match a bank line.
/// Loaded once per call to `suggest_matches_for_statement` to keep the
/// per-transaction loop O(1) on DB hits.
struct ItemCandidate {
    id: String,
    purchase_date: String,
    amount_cents: i64,
    currency: String,
    merchant_id: String,
    merchant_name_normalized: String,
}

/// Convert a price expressed as f64 (the DB column type) into integer
/// cents for exact arithmetic. f64 to_int_unchecked is unsafe — round
/// first to absorb the typical 0.0000000001 drift on REAL values.
fn to_cents(amount: f64) -> i64 {
    (amount * 100.0).round() as i64
}

/// Active items inside the statement period (±tolerance) that haven't
/// already been reconciled to a confirmed/created bank line. The window
/// widens to (-30, +7) when the statement has no period (rare, but the
/// AI sometimes fails to extract it).
fn load_item_candidates(
    conn: &rusqlite::Connection,
    period_start: Option<&str>,
    period_end: Option<&str>,
) -> Result<Vec<ItemCandidate>, String> {
    // Build a generous window: clamp the lower bound to period_start-7d
    // and the upper bound to period_end+7d so we cover late captures.
    let (lo, hi): (String, String) = match (period_start, period_end) {
        (Some(s), Some(e)) => {
            let lo = NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map(|d| d - chrono::Duration::days(ITEM_DATE_TOLERANCE_DAYS))
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|_| s.to_string());
            let hi = NaiveDate::parse_from_str(e, "%Y-%m-%d")
                .map(|d| d + chrono::Duration::days(ITEM_DATE_TOLERANCE_DAYS))
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|_| e.to_string());
            (lo, hi)
        }
        _ => ("1900-01-01".to_string(), "2999-12-31".to_string()),
    };

    let sql = "SELECT i.id, i.purchase_date,
                      i.purchase_price,
                      i.currency,
                      i.merchant_id,
                      COALESCE(m.name, '')
               FROM items i
               LEFT JOIN merchants m ON i.merchant_id = m.id
               WHERE i.status = 'active'
                 AND i.purchase_date >= ?1
                 AND i.purchase_date <= ?2
                 AND NOT EXISTS (
                   SELECT 1 FROM bank_statement_transactions btx
                   WHERE btx.match_target_kind = 'item'
                     AND btx.match_target_id = i.id
                     AND btx.match_status IN ('confirmed', 'created')
                 )
                 AND i.bank_transaction_id IS NULL
               ORDER BY i.purchase_date";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&lo, &hi], |row| {
            let amount: f64 = row.get(2)?;
            let merchant_name: String = row.get(5)?;
            Ok(ItemCandidate {
                id: row.get(0)?,
                purchase_date: row.get(1)?,
                amount_cents: to_cents(amount),
                currency: row.get(3)?,
                merchant_id: row.get(4)?,
                merchant_name_normalized: normalize_name(&merchant_name),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Days between two YYYY-MM-DD strings, or `None` if either is unparseable.
fn date_diff_days(a: &str, b: &str) -> Option<i64> {
    let da = NaiveDate::parse_from_str(a, "%Y-%m-%d").ok()?;
    let db = NaiveDate::parse_from_str(b, "%Y-%m-%d").ok()?;
    Some((da - db).num_days().abs())
}

/// Cherche un article actif déjà saisi très proche de celui qu'on s'apprête à
/// créer depuis une transaction bancaire : même devise, montant à
/// `AMOUNT_EPSILON_CENTS` près, et date d'achat dans la fenêtre
/// `ITEM_DATE_TOLERANCE_DAYS` (mêmes seuils que `suggest_matches_for_statement`,
/// pour rester cohérent). Renvoie une courte description du doublon potentiel
/// (pour avertir l'utilisateur) ou `None`.
fn find_duplicate_item(
    conn: &rusqlite::Connection,
    item: &CreateItemRequest,
) -> Result<Option<String>, String> {
    let currency = item
        .currency
        .clone()
        .unwrap_or_else(|| "CHF".to_string());
    let target_cents = to_cents(item.purchase_price);

    // Fenêtre de dates ±tolérance, en s'appuyant sur la comparaison lexicale
    // des dates ISO (YYYY-MM-DD). Si la date est illisible, on n'élargit pas.
    let (lo, hi) = match NaiveDate::parse_from_str(&item.purchase_date, "%Y-%m-%d") {
        Ok(d) => (
            (d - chrono::Duration::days(ITEM_DATE_TOLERANCE_DAYS))
                .format("%Y-%m-%d")
                .to_string(),
            (d + chrono::Duration::days(ITEM_DATE_TOLERANCE_DAYS))
                .format("%Y-%m-%d")
                .to_string(),
        ),
        Err(_) => (item.purchase_date.clone(), item.purchase_date.clone()),
    };

    let sql = "SELECT i.description, i.purchase_date, i.purchase_price, i.currency
               FROM items i
               WHERE i.status = 'active'
                 AND i.purchase_date >= ?1 AND i.purchase_date <= ?2
               ORDER BY i.purchase_date";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&lo, &hi], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for r in rows {
        let (desc, date, price, cur) = r.map_err(|e| e.to_string())?;
        // Devise différente = pas de doublon (pas de conversion de change).
        if !cur.eq_ignore_ascii_case(&currency) {
            continue;
        }
        if (to_cents(price) - target_cents).abs() > AMOUNT_EPSILON_CENTS {
            continue;
        }
        return Ok(Some(format!("« {} » du {} ({:.2} {})", desc, date, price, cur)));
    }
    Ok(None)
}

/// Try to match the transaction to a single item. Returns (item_id, conf).
/// Confidence rubric (debits only):
/// - exact amount + merchant hit + |Δdate| ≤ 3j  → 0.95
/// - exact amount + merchant hit + |Δdate| ≤ 7j  → 0.85
/// - exact amount + |Δdate| ≤ 3j                 → 0.70
/// - exact amount + |Δdate| ≤ 7j                 → 0.55
fn match_single_item(
    haystack: &str,
    tx_amount_cents: i64,
    tx_currency: &str,
    tx_date: &str,
    direction: &str,
    items: &[ItemCandidate],
) -> Option<(String, f64)> {
    if direction != "debit" {
        return None;
    }
    let mut best: Option<(String, f64)> = None;
    for it in items {
        // Skip currency mismatch — no FX conversion is performed, so a
        // 100 CHF item must not falsely match a 100 EUR debit.
        if !it.currency.eq_ignore_ascii_case(tx_currency) {
            continue;
        }
        if (it.amount_cents - tx_amount_cents).abs() > AMOUNT_EPSILON_CENTS {
            continue;
        }
        let Some(dd) = date_diff_days(&it.purchase_date, tx_date) else {
            continue;
        };
        if dd > ITEM_DATE_TOLERANCE_DAYS {
            continue;
        }
        let merchant_hit = it.merchant_name_normalized.len() >= 3
            && haystack.contains(&it.merchant_name_normalized);
        let conf = match (merchant_hit, dd) {
            (true, d) if d <= 3 => 0.95,
            (true, _) => 0.85,
            (false, d) if d <= 3 => 0.70,
            (false, _) => 0.55,
        };
        match best {
            Some((_, prev)) if prev >= conf => {}
            _ => best = Some((it.id.clone(), conf)),
        }
    }
    best
}

/// Try to explain the transaction as the SUM of several same-day,
/// same-merchant items (Amazon multi-line orders typically debit as
/// one consolidated line). The merchant hit on the libellé is required
/// — without it the signal would be too weak to be trusted.
///
/// Returns (item_ids, confidence) for the best matching subset; 0.85 if
/// it covers the whole bucket (clean "all items reconciled at once"
/// case), 0.75 for a strict subset.
fn match_grouped_items(
    haystack: &str,
    tx_amount_cents: i64,
    tx_currency: &str,
    tx_date: &str,
    direction: &str,
    items: &[ItemCandidate],
) -> Option<(Vec<String>, f64)> {
    if direction != "debit" {
        return None;
    }
    // Bucket by (merchant_id, purchase_date) and only keep buckets where
    // (a) the bank libellé contains the merchant name (signal required),
    // (b) the bucket has at least 2 items (else use single_item path),
    // (c) the date is within ±7d of the transaction date (window),
    // (d) the currency matches the bank line (no FX conversion).
    let mut buckets: HashMap<(String, String), Vec<&ItemCandidate>> = HashMap::new();
    for it in items {
        if !it.currency.eq_ignore_ascii_case(tx_currency) {
            continue;
        }
        let dd = date_diff_days(&it.purchase_date, tx_date).unwrap_or(i64::MAX);
        if dd > ITEM_DATE_TOLERANCE_DAYS {
            continue;
        }
        if it.merchant_name_normalized.len() < 3 {
            continue;
        }
        if !haystack.contains(&it.merchant_name_normalized) {
            continue;
        }
        buckets
            .entry((it.merchant_id.clone(), it.purchase_date.clone()))
            .or_default()
            .push(it);
    }

    let mut best: Option<(Vec<String>, f64, usize)> = None; // (ids, conf, size)
    for ((_mid, _date), bucket) in buckets {
        if bucket.len() < 2 || bucket.len() > MAX_GROUP_CANDIDATES {
            continue;
        }
        let Some(subset_indices) = subset_sum_meet_in_the_middle(&bucket, tx_amount_cents) else {
            continue;
        };
        if subset_indices.len() < 2 {
            continue;
        }
        let covers_all = subset_indices.len() == bucket.len();
        let conf = if covers_all { 0.85 } else { 0.75 };
        let ids: Vec<String> = subset_indices.iter().map(|&i| bucket[i].id.clone()).collect();
        let candidate = (ids, conf, subset_indices.len());
        best = match best {
            Some((_, bc, bs)) if bc > candidate.1 || (bc == candidate.1 && bs >= candidate.2) => {
                best
            }
            _ => Some(candidate),
        };
    }
    best.map(|(ids, conf, _)| (ids, conf))
}

/// Meet-in-the-middle subset sum. Returns indices into `items` whose
/// `amount_cents` sum to `target` (±AMOUNT_EPSILON_CENTS), or None.
/// O(2^(N/2)) instead of the naive O(2^N). Capped above by the caller.
fn subset_sum_meet_in_the_middle(
    items: &[&ItemCandidate],
    target: i64,
) -> Option<Vec<usize>> {
    let n = items.len();
    let mid = n / 2;
    // Enumerate every subset of the right half, keyed by their sum, with
    // the bitmask of selected indices preserved so we can reconstruct.
    let mut right_sums: HashMap<i64, u32> = HashMap::new();
    for mask in 0u32..(1u32 << (n - mid)) {
        let mut s: i64 = 0;
        for b in 0..(n - mid) {
            if mask & (1 << b) != 0 {
                s += items[mid + b].amount_cents;
            }
        }
        right_sums.insert(s, mask);
    }
    // For every subset of the left half, look up the complement in the
    // right map. We prefer the LARGEST total subset (= most items
    // reconciled at once), then the smallest right-mask as a tie-break
    // for determinism. Skip the empty subset on both sides.
    let mut best: Option<(u32, u32, usize)> = None; // (left_mask, right_mask, size)
    for lmask in 0u32..(1u32 << mid) {
        let mut s: i64 = 0;
        for b in 0..mid {
            if lmask & (1 << b) != 0 {
                s += items[b].amount_cents;
            }
        }
        let need = target - s;
        for delta in -AMOUNT_EPSILON_CENTS..=AMOUNT_EPSILON_CENTS {
            if let Some(&rmask) = right_sums.get(&(need + delta)) {
                if lmask == 0 && rmask == 0 {
                    continue;
                }
                let size = (lmask.count_ones() + rmask.count_ones()) as usize;
                if size < 2 {
                    continue;
                }
                let candidate = (lmask, rmask, size);
                best = match best {
                    Some((_, _, bs)) if bs >= size => best,
                    _ => Some(candidate),
                };
                break;
            }
        }
    }
    let (lmask, rmask, _) = best?;
    let mut out: Vec<usize> = Vec::new();
    for b in 0..mid {
        if lmask & (1 << b) != 0 {
            out.push(b);
        }
    }
    for b in 0..(n - mid) {
        if rmask & (1 << b) != 0 {
            out.push(mid + b);
        }
    }
    Some(out)
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
    let abs_file_path = storage::attachments_dir(vault_dir).join(&file_path);

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    if let Err(e) = conn.execute(
        "INSERT INTO bank_statements (id, label, bank_name, file_path, original_name,
         mime_type, size_bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, label, bank_name, file_path, original_name, mime_type, size_bytes],
    ) {
        let _ = storage::delete_attachment_file(&abs_file_path.to_string_lossy());
        return Err(e.to_string());
    }

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

    // Same filename-only convention as the read path — resolve against the
    // vault's attachments directory before unlinking, otherwise the PDF is
    // left behind on disk while the DB row is gone.
    if let Some(path) = file_path {
        let vault_dir = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
        if let Some(vault_dir) = vault_dir.as_ref() {
            let attachments_root = crate::storage::attachments_dir(vault_dir);
            if let Ok(resolved) = crate::storage::resolve_attachment(&path, &attachments_root) {
                let _ = crate::storage::delete_attachment_file(resolved.to_str().unwrap_or(""));
            }
        }
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
    let mut conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Validate inputs BEFORE touching the DB. Re-extraction wipes the
    // previous extraction, so any per-row validation error after the DELETE
    // would leave the user with neither the old nor the new extraction.
    for tx in &transactions {
        let direction = tx.direction.trim().to_lowercase();
        if direction != "debit" && direction != "credit" {
            return Err(format!(
                "Direction invalide '{}' pour la transaction « {} » — attendu 'debit' ou 'credit'.",
                tx.direction, tx.raw_description
            ));
        }
    }

    // Refuse re-extraction when the user has already confirmed/materialized
    // any match on this statement — wiping those rows would also orphan the
    // back-links posted on items.bank_transaction_id. Force an explicit
    // delete-statement-and-re-import flow instead of silent data loss.
    let engaged: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM bank_statement_transactions
             WHERE statement_id = ?1 AND match_status IN ('confirmed', 'created')",
            [&statement_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if engaged > 0 {
        return Err(format!(
            "Re-extraction refusée : {} transaction(s) déjà confirmée(s) ou matérialisée(s) sur ce relevé. \
             Supprimez le relevé pour repartir à zéro.",
            engaged
        ));
    }

    // Wrap DELETE + INSERTs + UPDATE in one transaction. Without this, a
    // failure mid-loop would have already destroyed the previous extraction
    // and left the user with a half-populated statement.
    let tx_db = conn.transaction().map_err(|e| e.to_string())?;
    tx_db
        .execute(
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
        let direction = tx.direction.trim().to_lowercase();
        tx_db
            .execute(
                "INSERT INTO bank_statement_transactions (id, statement_id, transaction_date,
             booking_date, raw_description, cleaned_description, amount, currency, direction,
             reference_number, counterparty_iban, match_status,
             location, original_amount, original_currency, exchange_rate)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'unmatched',
             ?12, ?13, ?14, ?15)",
                rusqlite::params![
                    id,
                    statement_id,
                    tx.transaction_date,
                    tx.booking_date,
                    tx.raw_description,
                    cleaned,
                    tx.amount,
                    currency,
                    direction,
                    tx.reference_number,
                    tx.counterparty_iban,
                    tx.location,
                    tx.original_amount,
                    tx.original_currency,
                    tx.exchange_rate,
                ],
            )
            .map_err(|e| e.to_string())?;
        inserted += 1;
    }

    tx_db
        .execute(
            "UPDATE bank_statements SET status = 'extracted',
         extracted_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?1",
            [&statement_id],
        )
        .map_err(|e| e.to_string())?;

    tx_db.commit().map_err(|e| e.to_string())?;
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
                "item_group" => conn
                    .query_row(
                        "SELECT COUNT(*) || ' articles' FROM items WHERE order_id = ?1",
                        [target_id],
                        |row| row.get::<_, String>(0),
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

    // Statement period drives the item-candidate window (±7d each side).
    // Read it once up-front; suggesting items for a thousand transactions
    // would otherwise hit the items table a thousand times.
    let (period_start, period_end): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT period_start, period_end FROM bank_statements WHERE id = ?1",
            [&statement_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let item_candidates = load_item_candidates(
        &conn,
        period_start.as_deref(),
        period_end.as_deref(),
    )?;

    let txs: Vec<(String, String, Option<String>, f64, String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, raw_description, cleaned_description, amount, direction, transaction_date, currency
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
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    let mut updated = 0;
    for (tx_id, raw, cleaned, amount, direction, tx_date, tx_currency) in txs {
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

        // 3) Items: exact amount + (optional) merchant signal + date window.
        // Runs last so engagement/subscription rules (richer signal) keep
        // priority. Single-item path first; grouped sum only if the single
        // path failed and several items at the same merchant/day add up.
        if matched.is_none() && direction == "debit" {
            let amount_cents = to_cents(amount);
            // Normalize the libellé the same way as merchant names so the
            // substring check is symmetric ("MIGROS-GENEVE" ↔ "Migros").
            let needle_haystack = normalize_name(&haystack);
            if let Some((item_id, conf)) = match_single_item(
                &needle_haystack,
                amount_cents,
                &tx_currency,
                &tx_date,
                &direction,
                &item_candidates,
            ) {
                matched = Some(("item".to_string(), item_id, String::new(), conf));
            } else if let Some((ids, conf)) = match_grouped_items(
                &needle_haystack,
                amount_cents,
                &tx_currency,
                &tx_date,
                &direction,
                &item_candidates,
            ) {
                // Grouped match: write match_target_kind='item_group' with
                // match_target_id NULL (no order_id materialized yet) and
                // stash the candidate ids in match_group_ids. The user's
                // confirmation in apply_transaction_match will turn this
                // into a real order.
                let csv = ids.join(",");
                conn.execute(
                    "UPDATE bank_statement_transactions SET match_status = 'suggested',
                     match_target_kind = 'item_group', match_target_id = NULL,
                     match_group_ids = ?1, match_confidence = ?2,
                     updated_at = datetime('now')
                     WHERE id = ?3",
                    rusqlite::params![csv, conf, tx_id],
                )
                .map_err(|e| e.to_string())?;
                updated += 1;
                continue;
            }
        }

        if let Some((kind, target_id, rule_id, conf)) = matched {
            conn.execute(
                "UPDATE bank_statement_transactions SET match_status = 'suggested',
                 match_target_kind = ?1, match_target_id = ?2,
                 match_rule_id = NULLIF(?3, ''), match_confidence = ?4,
                 match_group_ids = NULL,
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
///
/// For `target_kind == "item_group"`, `target_id` is ignored (it was NULL
/// at the suggestion stage anyway) — we read `match_group_ids` from the
/// transaction row, group those items under a fresh / reused order, and
/// stamp the resulting `order_id` as the final `match_target_id`. The
/// `items.bank_transaction_id` back-link is set on every group member.
///
/// For `target_kind == "item"`, the back-link is set on the single item.
/// Rule learning is skipped for grouped matches (one-off orders).
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
    let mut conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let (cleaned, direction, group_ids_csv): (Option<String>, String, Option<String>) = conn
        .query_row(
            "SELECT cleaned_description, direction, match_group_ids
             FROM bank_statement_transactions WHERE id = ?1",
            [&tx_id],
            |row| Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            )),
        )
        .map_err(|e| e.to_string())?;

    // Resolve the final target_id. For item_group, this means materializing
    // an order_id and setting it on every group member.
    let final_target_id = if target_kind == "item_group" {
        let csv = group_ids_csv
            .ok_or("Aucun groupe d'articles enregistré pour cette transaction")?;
        let ids: Vec<String> = csv
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if ids.len() < 2 {
            return Err("Le groupe doit contenir au moins deux articles".to_string());
        }

        let tx = conn.transaction().map_err(|e| e.to_string())?;

        // Reuse the most common existing order_id among the selected items
        // (mirror of link_items_to_order's behaviour), else mint a fresh one.
        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let existing_orders: Vec<String> = {
            let sql = format!(
                "SELECT order_id FROM items WHERE id IN ({}) AND order_id IS NOT NULL",
                placeholders
            );
            let params: Vec<&dyn rusqlite::types::ToSql> =
                ids.iter().map(|i| i as &dyn rusqlite::types::ToSql).collect();
            let mut stmt = tx.prepare(&sql).map_err(|e| e.to_string())?;
            stmt.query_map(params.as_slice(), |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let order_id = existing_orders
            .into_iter()
            .next()
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        // Link every group member to this order_id AND set the bank back-link.
        for id in &ids {
            tx.execute(
                "UPDATE items SET order_id = ?1, bank_transaction_id = ?2,
                 updated_at = datetime('now') WHERE id = ?3",
                rusqlite::params![order_id, tx_id, id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        order_id
    } else {
        target_id.clone()
    };

    conn.execute(
        "UPDATE bank_statement_transactions SET match_status = 'confirmed',
         match_target_kind = ?1, match_target_id = ?2, updated_at = datetime('now')
         WHERE id = ?3",
        rusqlite::params![target_kind, final_target_id, tx_id],
    )
    .map_err(|e| e.to_string())?;

    // Back-link the item to the bank line so the candidate scan can skip
    // it on the next re-suggest pass (idempotence).
    if target_kind == "item" {
        conn.execute(
            "UPDATE items SET bank_transaction_id = ?1, updated_at = datetime('now')
             WHERE id = ?2",
            rusqlite::params![tx_id, final_target_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Rule learning: skip for item_group (orders are one-off, the libellé
    // wouldn't recur). Also skip for individual items by default — they're
    // not recurring either. The existing engagement/subscription path
    // remains the main beneficiary of learned rules.
    let skip_learn = target_kind == "item_group" || target_kind == "item";
    if learn_rule.unwrap_or(false) && !skip_learn {
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
                    rusqlite::params![id, pattern, direction, target_kind, final_target_id],
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

/// Promote an orphan bank transaction into a brand-new item AND link the
/// two together. Used by the "Créer un achat" action in the review UI
/// when a debit doesn't match anything that's already in the vault.
///
/// The frontend pre-fills the form (amount/date/currency/merchant guess)
/// from the bank line; this command runs the same insertion logic as
/// `create_item` then sets `match_status='created'` on the transaction.
#[tauri::command]
pub fn create_item_from_transaction(
    state: State<'_, AppState>,
    tx_id: String,
    item: CreateItemRequest,
    force: Option<bool>,
) -> Result<Item, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Garde-fou anti-doublon : un même achat peut déjà avoir été saisi via le
    // scanner. À moins que l'utilisateur ne confirme (force), on refuse et on
    // décrit l'article proche trouvé. Le préfixe « DUPLICATE: » permet au
    // frontend de proposer une confirmation plutôt qu'une simple erreur.
    if !force.unwrap_or(false) {
        if let Some(dup) = find_duplicate_item(&conn, &item)? {
            return Err(format!("DUPLICATE:{}", dup));
        }
    }

    let new_id = insert_item_row(&conn, &item)?;

    conn.execute(
        "UPDATE items SET bank_transaction_id = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        rusqlite::params![tx_id, new_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE bank_statement_transactions SET match_status = 'created',
         match_target_kind = 'item', match_target_id = ?1,
         match_group_ids = NULL, updated_at = datetime('now')
         WHERE id = ?2",
        rusqlite::params![new_id, tx_id],
    )
    .map_err(|e| e.to_string())?;

    fetch_item_by_id(&conn, &new_id)
}

/// Materialize a "facture à fournir plus tard" entry from a bank line:
/// adds a file-less row to `pending_invoices` carrying the bank tx's
/// amount/date/currency as `expected_*` fields, and marks the bank
/// transaction as `created` (the orphan flow has produced something).
/// The user later uploads the actual PDF/image into this pending row.
#[tauri::command]
pub fn create_pending_invoice_from_transaction(
    state: State<'_, AppState>,
    tx_id: String,
    label: Option<String>,
) -> Result<PendingInvoice, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let (raw_description, amount, currency, tx_date): (String, f64, String, String) = conn
        .query_row(
            "SELECT raw_description, amount, currency, transaction_date
             FROM bank_statement_transactions WHERE id = ?1",
            [&tx_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("Transaction introuvable: {}", e))?;

    let derived_label = label.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
        let snippet: String = raw_description.chars().take(60).collect();
        format!("{:.2} {} — {} — {}", amount, currency, snippet.trim(), tx_date)
    });

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO pending_invoices (id, label, source_bank_tx_id,
         expected_amount, expected_date, currency)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, derived_label, tx_id, amount, tx_date, currency],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE bank_statement_transactions SET match_status = 'created',
         match_target_kind = NULL, match_target_id = NULL, match_group_ids = NULL,
         review_notes = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        rusqlite::params![format!("pending_invoice:{}", id), tx_id],
    )
    .map_err(|e| e.to_string())?;

    let sql = format!(
        "SELECT {} FROM pending_invoices WHERE id = ?1",
        PENDING_INVOICE_SELECT_COLUMNS
    );
    conn.query_row(&sql, [&id], row_to_pending_invoice)
        .map_err(|e| e.to_string())
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
///
/// `save_attachment` stores only the *filename* (e.g. `abc.enc`) so the
/// path stays valid across vault renames/restores; we must resolve it
/// against the current vault's attachments directory before reading,
/// otherwise the bare filename is interpreted relative to the process'
/// cwd and `std::fs::read` returns "No such file or directory".
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

    let vault_dir = state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())?;
    let vault_dir = vault_dir.as_ref().ok_or("No active vault")?;
    let attachments_root = storage::attachments_dir(vault_dir);
    let resolved = storage::resolve_attachment(&file_path, &attachments_root)?;

    let key_guard = state.encryption_key.lock().map_err(|_| "lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("No encryption key")?;
    let key_bytes: &[u8; 32] = key;

    let data = storage::read_attachment(resolved.to_str().unwrap_or(""), key_bytes)?;
    use base64::{engine::general_purpose, Engine as _};
    Ok(general_purpose::STANDARD.encode(data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::CreateItemRequest;
    use crate::db::Database;
    use crate::util::test_support::{test_key, TempDir};

    fn req(date: &str, price: f64, currency: &str) -> CreateItemRequest {
        CreateItemRequest {
            description: "Casque audio".to_string(),
            purchase_date: date.to_string(),
            purchase_price: price,
            currency: Some(currency.to_string()),
            status: None,
            merchant_id: "m1".to_string(),
            location_id: "l1".to_string(),
            payment_card_id: None,
            notes: None,
            invoice_number: None,
            product_reference: None,
            quantity: None,
            price_excl_tax: None,
            tax_rate: None,
            order_id: None,
            item_kind: None,
            event_datetime: None,
            event_location: None,
            expiration_date: None,
            redemption_url: None,
            redeemed_at: None,
        }
    }

    /// Coffre avec un marchand + un lieu (FK) et un article existant.
    fn open_with_item(date: &str, price: f64, currency: &str) -> (TempDir, Database) {
        let tmp = TempDir::new();
        let db = Database::open(tmp.path(), &test_key()).unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("INSERT INTO merchants (id, name) VALUES ('m1','Fnac')", [])
                .unwrap();
            conn.execute("INSERT INTO locations (id, name) VALUES ('l1','Lausanne')", [])
                .unwrap();
            conn.execute(
                "INSERT INTO items (id, description, purchase_date, purchase_price, currency, merchant_id, location_id)
                 VALUES ('i1','Casque audio',?1,?2,?3,'m1','l1')",
                rusqlite::params![date, price, currency],
            )
            .unwrap();
        }
        (tmp, db)
    }

    #[test]
    fn detecte_un_doublon_proche() {
        let (_tmp, db) = open_with_item("2026-04-10", 199.90, "CHF");
        let conn = db.conn.lock().unwrap();
        // Même montant, 2 jours plus tard, même devise → doublon signalé.
        let dup = find_duplicate_item(&conn, &req("2026-04-12", 199.90, "CHF")).unwrap();
        assert!(dup.is_some(), "un article quasi identique aurait dû être détecté");
        assert!(dup.unwrap().contains("Casque audio"));
    }

    #[test]
    fn pas_de_doublon_si_montant_eloigne() {
        let (_tmp, db) = open_with_item("2026-04-10", 199.90, "CHF");
        let conn = db.conn.lock().unwrap();
        assert!(find_duplicate_item(&conn, &req("2026-04-10", 250.00, "CHF"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn pas_de_doublon_si_hors_fenetre_de_dates() {
        let (_tmp, db) = open_with_item("2026-04-10", 199.90, "CHF");
        let conn = db.conn.lock().unwrap();
        // 30 jours d'écart > ITEM_DATE_TOLERANCE_DAYS.
        assert!(find_duplicate_item(&conn, &req("2026-05-10", 199.90, "CHF"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn pas_de_doublon_si_devise_differente() {
        let (_tmp, db) = open_with_item("2026-04-10", 199.90, "CHF");
        let conn = db.conn.lock().unwrap();
        // Même montant nominal mais EUR ≠ CHF : pas de conversion, pas de doublon.
        assert!(find_duplicate_item(&conn, &req("2026-04-10", 199.90, "EUR"))
            .unwrap()
            .is_none());
    }
}

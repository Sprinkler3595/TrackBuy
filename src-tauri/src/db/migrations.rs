use rusqlite::Connection;

/// Highest schema version this build of TrackBuy knows how to read.
/// Bump in lockstep with the last `migrate_vN` function declared below.
pub const CURRENT_SCHEMA_VERSION: i64 = 34;

pub fn run(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY
        );
        "
    ).map_err(|e| format!("Failed to create schema_version table: {}", e))?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // Refuse to open a vault that was written by a newer TrackBuy. Silently
    // running on an unknown schema risks reading rows with missing columns,
    // half-writing new ones, and corrupting the user's data over time.
    if current_version > CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Ce coffre a été créé par une version plus récente de TrackBuy (schéma v{}, cette version supporte jusqu'à v{}). Mettez à jour l'application avant de l'ouvrir.",
            current_version, CURRENT_SCHEMA_VERSION
        ));
    }

    if current_version < 1 {
        migrate_v1(conn)?;
    }
    if current_version < 2 {
        migrate_v2(conn)?;
    }
    if current_version < 3 {
        migrate_v3(conn)?;
    }
    if current_version < 4 {
        migrate_v4(conn)?;
    }
    if current_version < 5 {
        migrate_v5(conn)?;
    }
    if current_version < 6 {
        migrate_v6(conn)?;
    }
    if current_version < 7 {
        migrate_v7(conn)?;
    }
    if current_version < 8 {
        migrate_v8(conn)?;
    }
    if current_version < 9 {
        migrate_v9(conn)?;
    }
    if current_version < 10 {
        migrate_v10(conn)?;
    }
    if current_version < 11 {
        migrate_v11(conn)?;
    }
    if current_version < 12 {
        migrate_v12(conn)?;
    }
    if current_version < 13 {
        migrate_v13(conn)?;
    }
    if current_version < 14 {
        migrate_v14(conn)?;
    }
    if current_version < 15 {
        migrate_v15(conn)?;
    }
    if current_version < 16 {
        migrate_v16(conn)?;
    }
    if current_version < 17 {
        migrate_v17(conn)?;
    }
    if current_version < 18 {
        migrate_v18(conn)?;
    }
    if current_version < 19 {
        migrate_v19(conn)?;
    }
    if current_version < 20 {
        migrate_v20(conn)?;
    }
    if current_version < 21 {
        migrate_v21(conn)?;
    }
    if current_version < 22 {
        migrate_v22(conn)?;
    }
    if current_version < 23 {
        migrate_v23(conn)?;
    }
    if current_version < 24 {
        migrate_v24(conn)?;
    }
    if current_version < 25 {
        migrate_v25(conn)?;
    }
    if current_version < 26 {
        migrate_v26(conn)?;
    }
    if current_version < 27 {
        migrate_v27(conn)?;
    }
    if current_version < 28 {
        migrate_v28(conn)?;
    }
    if current_version < 29 {
        migrate_v29(conn)?;
    }
    if current_version < 30 {
        migrate_v30(conn)?;
    }
    if current_version < 31 {
        migrate_v31(conn)?;
    }
    if current_version < 32 {
        migrate_v32(conn)?;
    }
    if current_version < 33 {
        migrate_v33(conn)?;
    }
    if current_version < 34 {
        migrate_v34(conn)?;
    }

    Ok(())
}

fn migrate_v1(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS locations (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            icon TEXT DEFAULT 'home',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS merchants (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            contact_email TEXT,
            contact_phone TEXT,
            address TEXT,
            logo_path TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS payment_cards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_credit_card INTEGER NOT NULL DEFAULT 0,
            extended_warranty_months INTEGER NOT NULL DEFAULT 0,
            extended_warranty_description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            purchase_date TEXT NOT NULL,
            purchase_price REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CAD',
            status TEXT NOT NULL DEFAULT 'active',
            merchant_id TEXT NOT NULL,
            location_id TEXT NOT NULL,
            payment_card_id TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (merchant_id) REFERENCES merchants(id),
            FOREIGN KEY (location_id) REFERENCES locations(id),
            FOREIGN KEY (payment_card_id) REFERENCES payment_cards(id)
        );

        CREATE TABLE IF NOT EXISTS warranties (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            start_date TEXT NOT NULL,
            duration_months INTEGER NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            original_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            attachment_type TEXT NOT NULL DEFAULT 'other',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        );

        -- Full-text search index for items
        CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
            description, notes, content='items', content_rowid='rowid'
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
            INSERT INTO items_fts(rowid, description, notes)
            VALUES (new.rowid, new.description, new.notes);
        END;

        CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
            INSERT INTO items_fts(items_fts, rowid, description, notes)
            VALUES ('delete', old.rowid, old.description, old.notes);
        END;

        CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
            INSERT INTO items_fts(items_fts, rowid, description, notes)
            VALUES ('delete', old.rowid, old.description, old.notes);
            INSERT INTO items_fts(rowid, description, notes)
            VALUES (new.rowid, new.description, new.notes);
        END;

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_items_merchant ON items(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_items_location ON items(location_id);
        CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
        CREATE INDEX IF NOT EXISTS idx_items_date ON items(purchase_date);
        CREATE INDEX IF NOT EXISTS idx_warranties_item ON warranties(item_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(item_id);

        INSERT INTO schema_version (version) VALUES (1);
        "
    ).map_err(|e| format!("Migration v1 failed: {}", e))?;

    Ok(())
}

fn migrate_v2(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE items ADD COLUMN invoice_number TEXT;
        ALTER TABLE items ADD COLUMN product_reference TEXT;
        ALTER TABLE items ADD COLUMN quantity INTEGER DEFAULT 1;
        ALTER TABLE items ADD COLUMN price_excl_tax REAL;
        ALTER TABLE items ADD COLUMN tax_rate REAL;

        INSERT INTO schema_version (version) VALUES (2);
        "
    ).map_err(|e| format!("Migration v2 failed: {}", e))?;

    Ok(())
}

/// Multi-item purchases: items can share a single `order_id` (free UUID tag),
/// and attachments can be linked to an order instead of (or in addition to)
/// a specific item — e.g. one invoice shared by multiple products.
fn migrate_v3(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE items ADD COLUMN order_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_items_order ON items(order_id);

        -- SQLite cannot drop NOT NULL in place — rebuild the table.
        CREATE TABLE attachments_new (
            id TEXT PRIMARY KEY,
            item_id TEXT,
            order_id TEXT,
            original_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            attachment_type TEXT NOT NULL DEFAULT 'other',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (item_id IS NOT NULL OR order_id IS NOT NULL),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        );

        INSERT INTO attachments_new (id, item_id, order_id, original_name, display_name, mime_type, file_path, size_bytes, attachment_type, created_at)
        SELECT id, item_id, NULL, original_name, display_name, mime_type, file_path, size_bytes, attachment_type, created_at
        FROM attachments;

        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;

        CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(item_id);
        CREATE INDEX IF NOT EXISTS idx_attachments_order ON attachments(order_id);

        INSERT INTO schema_version (version) VALUES (3);
        "
    ).map_err(|e| format!("Migration v3 failed: {}", e))?;

    Ok(())
}

/// Digital items: tickets, vouchers, license codes. Adds a `item_kind`
/// discriminator on items (default 'physical' = existing rows untouched) and a
/// handful of nullable columns to hold kind-specific metadata. The actual
/// secret payload (ticket PDF/QR, voucher code, license key) lives in the
/// encrypted attachments table — only metadata sits on items.
fn migrate_v4(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE items ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'physical';
        ALTER TABLE items ADD COLUMN event_datetime TEXT;
        ALTER TABLE items ADD COLUMN event_location TEXT;
        ALTER TABLE items ADD COLUMN expiration_date TEXT;
        ALTER TABLE items ADD COLUMN redemption_url TEXT;
        ALTER TABLE items ADD COLUMN redeemed_at TEXT;

        CREATE INDEX IF NOT EXISTS idx_items_kind ON items(item_kind);
        CREATE INDEX IF NOT EXISTS idx_items_event ON items(event_datetime) WHERE event_datetime IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_items_expiration ON items(expiration_date) WHERE expiration_date IS NOT NULL;

        INSERT INTO schema_version (version) VALUES (4);
        "
    ).map_err(|e| format!("Migration v4 failed: {}", e))?;

    Ok(())
}

/// Recurring subscriptions (Netflix, Spotify, hosting, gym, …). Subscriptions
/// have their own lifecycle distinct from one-shot `items`: a price, a billing
/// cycle, a next-renewal date that rolls forward automatically when due, and
/// a per-renewal payment history that snapshots the price at the time of the
/// charge (so renaming the plan later doesn't rewrite history).
///
/// Optional secondary tables: `subscription_members` for family/share splits,
/// and a polymorphic `subscription_id` column on `attachments` so invoices and
/// contracts can be attached alongside the existing item/order patterns. The
/// attachments table CHECK constraint can't be widened in place, so it's
/// rebuilt with the same `attachments_new` → swap pattern used in v3.
fn migrate_v5(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE subscriptions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT,
            merchant_id TEXT,
            payment_card_id TEXT,
            start_date TEXT NOT NULL,
            next_renewal_date TEXT NOT NULL,
            billing_cycle TEXT NOT NULL,
            cycle_interval INTEGER NOT NULL DEFAULT 1,
            price REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CAD',
            auto_renewal INTEGER NOT NULL DEFAULT 1,
            trial_end_date TEXT,
            cancel_by_date TEXT,
            cancellation_url TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (merchant_id) REFERENCES merchants(id),
            FOREIGN KEY (payment_card_id) REFERENCES payment_cards(id)
        );

        CREATE TABLE subscription_payments (
            id TEXT PRIMARY KEY,
            subscription_id TEXT NOT NULL,
            paid_on TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            payment_card_id TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
            FOREIGN KEY (payment_card_id) REFERENCES payment_cards(id)
        );

        CREATE TABLE subscription_members (
            id TEXT PRIMARY KEY,
            subscription_id TEXT NOT NULL,
            name TEXT NOT NULL,
            share_amount REAL,
            share_percent REAL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
        );

        -- Widen attachments to allow polymorphic linking against a subscription
        -- (alternative to item_id / order_id). SQLite cannot ALTER a CHECK
        -- constraint in place — same rebuild pattern as v3.
        CREATE TABLE attachments_new (
            id TEXT PRIMARY KEY,
            item_id TEXT,
            order_id TEXT,
            subscription_id TEXT,
            original_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            attachment_type TEXT NOT NULL DEFAULT 'other',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (item_id IS NOT NULL OR order_id IS NOT NULL OR subscription_id IS NOT NULL),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
        );

        INSERT INTO attachments_new (id, item_id, order_id, subscription_id, original_name, display_name, mime_type, file_path, size_bytes, attachment_type, created_at)
        SELECT id, item_id, order_id, NULL, original_name, display_name, mime_type, file_path, size_bytes, attachment_type, created_at
        FROM attachments;

        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;

        CREATE INDEX idx_attachments_item ON attachments(item_id);
        CREATE INDEX idx_attachments_order ON attachments(order_id);
        CREATE INDEX idx_attachments_subscription ON attachments(subscription_id);

        -- Full-text search for subscriptions (mirrors items_fts in v1).
        CREATE VIRTUAL TABLE subscriptions_fts USING fts5(
            name, notes, content='subscriptions', content_rowid='rowid'
        );

        CREATE TRIGGER subscriptions_ai AFTER INSERT ON subscriptions BEGIN
            INSERT INTO subscriptions_fts(rowid, name, notes)
            VALUES (new.rowid, new.name, new.notes);
        END;

        CREATE TRIGGER subscriptions_ad AFTER DELETE ON subscriptions BEGIN
            INSERT INTO subscriptions_fts(subscriptions_fts, rowid, name, notes)
            VALUES ('delete', old.rowid, old.name, old.notes);
        END;

        CREATE TRIGGER subscriptions_au AFTER UPDATE ON subscriptions BEGIN
            INSERT INTO subscriptions_fts(subscriptions_fts, rowid, name, notes)
            VALUES ('delete', old.rowid, old.name, old.notes);
            INSERT INTO subscriptions_fts(rowid, name, notes)
            VALUES (new.rowid, new.name, new.notes);
        END;

        CREATE INDEX idx_subscriptions_merchant ON subscriptions(merchant_id);
        CREATE INDEX idx_subscriptions_status ON subscriptions(status);
        CREATE INDEX idx_subscriptions_renewal ON subscriptions(next_renewal_date);
        CREATE INDEX idx_subscription_payments_sub ON subscription_payments(subscription_id);
        CREATE INDEX idx_subscription_payments_date ON subscription_payments(paid_on);
        CREATE INDEX idx_subscription_members_sub ON subscription_members(subscription_id);

        INSERT INTO schema_version (version) VALUES (5);
        "
    ).map_err(|e| format!("Migration v5 failed: {}", e))?;

    Ok(())
}

/// Pending invoices: a holding area for receipt files (PDF/image) uploaded by
/// the user but not yet scanned and turned into items. Each row keeps the
/// encrypted file path (same `<vault>/files/` pool as attachments) plus
/// optional user metadata (short label, free-form notes). Rows are deleted —
/// and the underlying ciphertext shredded — once the user processes the
/// invoice through the scan-review wizard.
fn migrate_v6(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE pending_invoices (
            id TEXT PRIMARY KEY,
            label TEXT,
            notes TEXT,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_pending_invoices_created ON pending_invoices(created_at);

        INSERT INTO schema_version (version) VALUES (6);
        "
    ).map_err(|e| format!("Migration v6 failed: {}", e))?;

    Ok(())
}

/// User-overrides for attachment display name templates. One row per
/// `attachment_type` when the user has customized the pattern. Absence of a
/// row means "fall back to the bundled default" (defaults live in TS so they
/// can evolve with the app without a migration).
fn migrate_v7(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE filename_templates (
            attachment_type TEXT PRIMARY KEY,
            template TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO schema_version (version) VALUES (7);
        "
    ).map_err(|e| format!("Migration v7 failed: {}", e))?;

    Ok(())
}

/// Refocus `subscriptions` on online services (streaming, SaaS, cloud, gaming)
/// by adding a `kind` discriminator. Existing rows default to 'online' so the
/// new filter on `get_subscriptions` keeps showing them unchanged. Future kinds
/// (e.g. 'gym') stay open without breaking the current contract.
///
/// Real-world recurring charges (insurance, rent, utilities, taxes, fines…)
/// will live in their own `engagements` table introduced by a later migration,
/// rather than overloading this one further.
fn migrate_v8(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE subscriptions ADD COLUMN kind TEXT NOT NULL DEFAULT 'online';
        CREATE INDEX idx_subscriptions_kind ON subscriptions(kind);

        INSERT INTO schema_version (version) VALUES (8);
        "
    ).map_err(|e| format!("Migration v8 failed: {}", e))?;

    Ok(())
}

/// Engagements & recurring real-world charges (insurances, rent, leasing,
/// utilities, fuel, telecom, taxes, fines…). This is the sibling domain of
/// `subscriptions` (which now covers only online services) and uses the same
/// roll-forward / payments-history pattern.
///
/// Companion tables introduced here:
/// - `creditors`: payees with Swiss-specific fields (IBAN, BVR reference
///   prefix). Kept separate from `merchants` so item vendor dropdowns stay
///   clean and creditors can be typed (insurer, landlord, utility, …).
/// - `engagement_revisions`: explicit contract amendments (annual premium
///   adjustments, rent indexation). Complements `engagement_charges` snapshots
///   for "official" price changes that haven't yet triggered a charge.
/// - `engagement_charges`: each due/paid occurrence with snapshot amount,
///   plus optional `quantity` / `unit` / `unit_price` for utilities (kWh, m³,
///   litres) so price-per-unit can be tracked independently of consumption.
///
/// `payment_cards` is extended with IBAN / account holder so a single table
/// can model both cards and bank accounts (LSV / standing orders / QR-bills).
///
/// The `attachments` table CHECK constraint is rebuilt (same pattern as
/// migrate_v3 / migrate_v5) to allow polymorphic linking to engagements,
/// engagement charges, and engagement revisions — contracts, conditions,
/// BVR slips and invoices can now be attached at the right granularity.
fn migrate_v9(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        -- Extend payment_cards to cover bank accounts (LSV/SEPA/QR-bill).
        ALTER TABLE payment_cards ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'card';
        ALTER TABLE payment_cards ADD COLUMN iban TEXT;
        ALTER TABLE payment_cards ADD COLUMN bic TEXT;
        ALTER TABLE payment_cards ADD COLUMN account_holder TEXT;
        ALTER TABLE payment_cards ADD COLUMN institution TEXT;
        CREATE INDEX idx_payment_cards_kind ON payment_cards(account_kind);

        -- Creditors / payees (separate from merchants).
        CREATE TABLE creditors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            creditor_type TEXT NOT NULL DEFAULT 'other',
            contact_email TEXT,
            contact_phone TEXT,
            address TEXT,
            iban TEXT,
            reference_prefix TEXT,
            notes TEXT,
            logo_path TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_creditors_type ON creditors(creditor_type);

        -- Engagements header (one row per contract / recurring commitment).
        CREATE TABLE engagements (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            engagement_type TEXT NOT NULL,
            parent_engagement_id TEXT,
            creditor_id TEXT,
            payment_card_id TEXT,
            contract_reference TEXT,
            contract_start_date TEXT,
            contract_end_date TEXT,
            notice_period_days INTEGER,
            billing_cycle TEXT NOT NULL,
            cycle_interval INTEGER NOT NULL DEFAULT 1,
            next_due_date TEXT,
            current_amount REAL,
            currency TEXT NOT NULL DEFAULT 'CHF',
            payment_method TEXT,
            auto_pay INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            ended_on TEXT,
            notes TEXT,
            clauses_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (parent_engagement_id) REFERENCES engagements(id) ON DELETE SET NULL,
            FOREIGN KEY (creditor_id) REFERENCES creditors(id),
            FOREIGN KEY (payment_card_id) REFERENCES payment_cards(id)
        );
        CREATE INDEX idx_engagements_type ON engagements(engagement_type);
        CREATE INDEX idx_engagements_status ON engagements(status);
        CREATE INDEX idx_engagements_creditor ON engagements(creditor_id);
        CREATE INDEX idx_engagements_parent ON engagements(parent_engagement_id);
        CREATE INDEX idx_engagements_due ON engagements(next_due_date);
        CREATE INDEX idx_engagements_end ON engagements(contract_end_date);

        -- Explicit contract revisions / amendments (annual premium changes,
        -- rent indexation), independent of payment events.
        CREATE TABLE engagement_revisions (
            id TEXT PRIMARY KEY,
            engagement_id TEXT NOT NULL,
            effective_date TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            change_reason TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_engagement_revisions_eng ON engagement_revisions(engagement_id);
        CREATE INDEX idx_engagement_revisions_eff ON engagement_revisions(effective_date);

        -- One row per scheduled / paid occurrence. The snapshot amount tracks
        -- price evolution independently of contract revisions; utility-style
        -- columns let us follow unit prices (kWh, m³, litres, GB, minutes).
        CREATE TABLE engagement_charges (
            id TEXT PRIMARY KEY,
            engagement_id TEXT NOT NULL,
            period_start TEXT,
            period_end TEXT,
            due_date TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            quantity REAL,
            unit TEXT,
            unit_price REAL,
            paid_on TEXT,
            status TEXT NOT NULL DEFAULT 'scheduled',
            payment_card_id TEXT,
            reference_number TEXT,
            invoice_number TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
            FOREIGN KEY (payment_card_id) REFERENCES payment_cards(id)
        );
        CREATE INDEX idx_charges_engagement ON engagement_charges(engagement_id);
        CREATE INDEX idx_charges_due ON engagement_charges(due_date);
        CREATE INDEX idx_charges_paid ON engagement_charges(paid_on);
        CREATE INDEX idx_charges_status ON engagement_charges(status);

        -- Widen attachments to allow polymorphic linking against engagements,
        -- their charges and revisions. SQLite cannot ALTER a CHECK in place,
        -- so we rebuild the table (same pattern as v3 / v5).
        CREATE TABLE attachments_new (
            id TEXT PRIMARY KEY,
            item_id TEXT,
            order_id TEXT,
            subscription_id TEXT,
            engagement_id TEXT,
            engagement_charge_id TEXT,
            engagement_revision_id TEXT,
            original_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            attachment_type TEXT NOT NULL DEFAULT 'other',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (item_id IS NOT NULL OR order_id IS NOT NULL OR subscription_id IS NOT NULL
                   OR engagement_id IS NOT NULL OR engagement_charge_id IS NOT NULL
                   OR engagement_revision_id IS NOT NULL),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_charge_id) REFERENCES engagement_charges(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_revision_id) REFERENCES engagement_revisions(id) ON DELETE CASCADE
        );

        INSERT INTO attachments_new
            (id, item_id, order_id, subscription_id, engagement_id,
             engagement_charge_id, engagement_revision_id,
             original_name, display_name, mime_type, file_path, size_bytes,
             attachment_type, created_at)
        SELECT id, item_id, order_id, subscription_id, NULL, NULL, NULL,
               original_name, display_name, mime_type, file_path, size_bytes,
               attachment_type, created_at
        FROM attachments;

        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;

        CREATE INDEX idx_attachments_item ON attachments(item_id);
        CREATE INDEX idx_attachments_order ON attachments(order_id);
        CREATE INDEX idx_attachments_subscription ON attachments(subscription_id);
        CREATE INDEX idx_attachments_engagement ON attachments(engagement_id);
        CREATE INDEX idx_attachments_charge ON attachments(engagement_charge_id);
        CREATE INDEX idx_attachments_revision ON attachments(engagement_revision_id);

        -- FTS5 mirror for engagements (calque subscriptions_fts).
        CREATE VIRTUAL TABLE engagements_fts USING fts5(
            name, contract_reference, notes, content='engagements', content_rowid='rowid'
        );

        CREATE TRIGGER engagements_ai AFTER INSERT ON engagements BEGIN
            INSERT INTO engagements_fts(rowid, name, contract_reference, notes)
            VALUES (new.rowid, new.name, new.contract_reference, new.notes);
        END;

        CREATE TRIGGER engagements_ad AFTER DELETE ON engagements BEGIN
            INSERT INTO engagements_fts(engagements_fts, rowid, name, contract_reference, notes)
            VALUES ('delete', old.rowid, old.name, old.contract_reference, old.notes);
        END;

        CREATE TRIGGER engagements_au AFTER UPDATE ON engagements BEGIN
            INSERT INTO engagements_fts(engagements_fts, rowid, name, contract_reference, notes)
            VALUES ('delete', old.rowid, old.name, old.contract_reference, old.notes);
            INSERT INTO engagements_fts(rowid, name, contract_reference, notes)
            VALUES (new.rowid, new.name, new.contract_reference, new.notes);
        END;

        INSERT INTO schema_version (version) VALUES (9);
        "
    ).map_err(|e| format!("Migration v9 failed: {}", e))?;

    Ok(())
}

/// Incomes (salaries, bonuses, allowances, dividends, refunds…). Designed
/// as the symmetric counterpart to `engagements`: a header table for each
/// recurring (or one-shot) income stream, plus an `income_receipts` table
/// that snapshots each actual reception.
///
/// Receipts carry optional payslip-detail columns (gross_amount, social
/// charges, pension, tax-at-source, other deductions, bonus). For a
/// non-salary income (allocations familiales, dividendes…) these stay
/// NULL — only `amount` (= what landed in the account) is filled.
/// Keeping payslip detail on the same row avoids a JOIN-per-receipt and
/// matches the typical "one payslip → one credit" reality. If a payslip
/// ever needs richer structure (multiple bonus lines, hourly breakdown),
/// we can split into a child table without a breaking change.
///
/// `attachments` is rebuilt once more (same `attachments_new` pattern as
/// v3/v5/v9) to add polymorphic FKs to incomes and income_receipts so the
/// encrypted PDF bulletin lives next to the receipt that materialises it.
fn migrate_v10(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE incomes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            income_type TEXT NOT NULL,
            source_name TEXT,
            payment_card_id TEXT,
            billing_cycle TEXT NOT NULL,
            cycle_interval INTEGER NOT NULL DEFAULT 1,
            next_expected_date TEXT,
            current_amount REAL,
            currency TEXT NOT NULL DEFAULT 'CHF',
            status TEXT NOT NULL DEFAULT 'active',
            started_on TEXT,
            ended_on TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (payment_card_id) REFERENCES payment_cards(id)
        );
        CREATE INDEX idx_incomes_type ON incomes(income_type);
        CREATE INDEX idx_incomes_status ON incomes(status);
        CREATE INDEX idx_incomes_next ON incomes(next_expected_date);

        CREATE TABLE income_receipts (
            id TEXT PRIMARY KEY,
            income_id TEXT NOT NULL,
            received_on TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            period_label TEXT,
            -- Optional payslip detail (salaries only): all NULL for
            -- allocations / dividends / refunds. Sum of deductions should
            -- equal gross_amount - amount, but no DB constraint enforces
            -- it — the UI handles the sanity check.
            gross_amount REAL,
            social_charges_amount REAL,
            pension_amount REAL,
            tax_at_source_amount REAL,
            other_deductions_amount REAL,
            bonus_amount REAL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_income_receipts_income ON income_receipts(income_id);
        CREATE INDEX idx_income_receipts_date ON income_receipts(received_on);

        -- Widen attachments once more: add income_id + income_receipt_id.
        -- Same `attachments_new` rebuild pattern as v3/v5/v9 since SQLite
        -- cannot ALTER a CHECK constraint in place.
        CREATE TABLE attachments_new (
            id TEXT PRIMARY KEY,
            item_id TEXT,
            order_id TEXT,
            subscription_id TEXT,
            engagement_id TEXT,
            engagement_charge_id TEXT,
            engagement_revision_id TEXT,
            income_id TEXT,
            income_receipt_id TEXT,
            original_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            attachment_type TEXT NOT NULL DEFAULT 'other',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (item_id IS NOT NULL OR order_id IS NOT NULL OR subscription_id IS NOT NULL
                   OR engagement_id IS NOT NULL OR engagement_charge_id IS NOT NULL
                   OR engagement_revision_id IS NOT NULL
                   OR income_id IS NOT NULL OR income_receipt_id IS NOT NULL),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_charge_id) REFERENCES engagement_charges(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_revision_id) REFERENCES engagement_revisions(id) ON DELETE CASCADE,
            FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE,
            FOREIGN KEY (income_receipt_id) REFERENCES income_receipts(id) ON DELETE CASCADE
        );

        INSERT INTO attachments_new
            (id, item_id, order_id, subscription_id, engagement_id,
             engagement_charge_id, engagement_revision_id,
             income_id, income_receipt_id,
             original_name, display_name, mime_type, file_path, size_bytes,
             attachment_type, created_at)
        SELECT id, item_id, order_id, subscription_id, engagement_id,
               engagement_charge_id, engagement_revision_id,
               NULL, NULL,
               original_name, display_name, mime_type, file_path, size_bytes,
               attachment_type, created_at
        FROM attachments;

        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;

        CREATE INDEX idx_attachments_item ON attachments(item_id);
        CREATE INDEX idx_attachments_order ON attachments(order_id);
        CREATE INDEX idx_attachments_subscription ON attachments(subscription_id);
        CREATE INDEX idx_attachments_engagement ON attachments(engagement_id);
        CREATE INDEX idx_attachments_charge ON attachments(engagement_charge_id);
        CREATE INDEX idx_attachments_revision ON attachments(engagement_revision_id);
        CREATE INDEX idx_attachments_income ON attachments(income_id);
        CREATE INDEX idx_attachments_income_receipt ON attachments(income_receipt_id);

        INSERT INTO schema_version (version) VALUES (10);
        "
    ).map_err(|e| format!("Migration v10 failed: {}", e))?;

    Ok(())
}

/// Pending reimbursements: amounts the user is waiting to recover from
/// someone (employer expense reports, insurance claims, warranty returns,
/// product returns, deposits, tax refunds…). Distinct from `pending_invoices`
/// which is a "file to classify" queue — here the queue tracks a *monetary*
/// claim with a workflow:
///   pending → claimed → settled / partial / rejected / cancelled.
///
/// Origin is optional and polymorphic: an item, an engagement_charge, or a
/// free-text description. None of the three is required (a user can log
/// "deposit at landlord" without referencing any existing record), so no
/// CHECK constraint is added.
///
/// `attachments` is rebuilt one more time (same pattern as v3/v5/v9/v10) to
/// add `reimbursement_id` for justificatifs (note de frais PDF, courrier
/// d'assurance, accusé de réception…).
fn migrate_v11(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE pending_reimbursements (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            reimbursement_type TEXT NOT NULL DEFAULT 'other',
            expected_amount REAL,
            received_amount REAL,
            currency TEXT NOT NULL DEFAULT 'CHF',
            debtor_name TEXT,
            debtor_creditor_id TEXT,
            item_id TEXT,
            engagement_charge_id TEXT,
            source_description TEXT,
            requested_on TEXT,
            expected_by TEXT,
            received_on TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (debtor_creditor_id) REFERENCES creditors(id),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
            FOREIGN KEY (engagement_charge_id) REFERENCES engagement_charges(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_reimb_status ON pending_reimbursements(status);
        CREATE INDEX idx_reimb_expected ON pending_reimbursements(expected_by);
        CREATE INDEX idx_reimb_item ON pending_reimbursements(item_id);
        CREATE INDEX idx_reimb_charge ON pending_reimbursements(engagement_charge_id);

        -- Widen attachments once more: add reimbursement_id.
        CREATE TABLE attachments_new (
            id TEXT PRIMARY KEY,
            item_id TEXT,
            order_id TEXT,
            subscription_id TEXT,
            engagement_id TEXT,
            engagement_charge_id TEXT,
            engagement_revision_id TEXT,
            income_id TEXT,
            income_receipt_id TEXT,
            reimbursement_id TEXT,
            original_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            attachment_type TEXT NOT NULL DEFAULT 'other',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (item_id IS NOT NULL OR order_id IS NOT NULL OR subscription_id IS NOT NULL
                   OR engagement_id IS NOT NULL OR engagement_charge_id IS NOT NULL
                   OR engagement_revision_id IS NOT NULL
                   OR income_id IS NOT NULL OR income_receipt_id IS NOT NULL
                   OR reimbursement_id IS NOT NULL),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_charge_id) REFERENCES engagement_charges(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_revision_id) REFERENCES engagement_revisions(id) ON DELETE CASCADE,
            FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE,
            FOREIGN KEY (income_receipt_id) REFERENCES income_receipts(id) ON DELETE CASCADE,
            FOREIGN KEY (reimbursement_id) REFERENCES pending_reimbursements(id) ON DELETE CASCADE
        );

        INSERT INTO attachments_new
            (id, item_id, order_id, subscription_id, engagement_id,
             engagement_charge_id, engagement_revision_id,
             income_id, income_receipt_id, reimbursement_id,
             original_name, display_name, mime_type, file_path, size_bytes,
             attachment_type, created_at)
        SELECT id, item_id, order_id, subscription_id, engagement_id,
               engagement_charge_id, engagement_revision_id,
               income_id, income_receipt_id, NULL,
               original_name, display_name, mime_type, file_path, size_bytes,
               attachment_type, created_at
        FROM attachments;

        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;

        CREATE INDEX idx_attachments_item ON attachments(item_id);
        CREATE INDEX idx_attachments_order ON attachments(order_id);
        CREATE INDEX idx_attachments_subscription ON attachments(subscription_id);
        CREATE INDEX idx_attachments_engagement ON attachments(engagement_id);
        CREATE INDEX idx_attachments_charge ON attachments(engagement_charge_id);
        CREATE INDEX idx_attachments_revision ON attachments(engagement_revision_id);
        CREATE INDEX idx_attachments_income ON attachments(income_id);
        CREATE INDEX idx_attachments_income_receipt ON attachments(income_receipt_id);
        CREATE INDEX idx_attachments_reimbursement ON attachments(reimbursement_id);

        INSERT INTO schema_version (version) VALUES (11);
        "
    ).map_err(|e| format!("Migration v11 failed: {}", e))?;

    Ok(())
}

/// Bank statement import & transaction matching. A monthly PDF (or image)
/// is ingested as an encrypted attachment, the AI command
/// `ai_extract_bank_statement` parses each line, and the user validates
/// each transaction against a target (engagement_charge, subscription
/// payment, item, income_receipt, reimbursement). Patterns learned during
/// validation are persisted in `bank_match_rules` so the next month's
/// statement pre-fills the same matches automatically.
///
/// Tables added :
/// - `bank_statements`     : header (bank name, period, file path, status)
/// - `bank_statement_transactions` : one row per parsed line, carries the
///   match target (polymorphic via `match_target_kind` + `match_target_id`)
///   and the workflow status (unmatched / suggested / confirmed / created /
///   ignored).
/// - `bank_match_rules`    : libellé pattern → target binding. `hit_count`
///   surfaces noisy rules.
fn migrate_v12(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE bank_statements (
            id TEXT PRIMARY KEY,
            label TEXT,
            bank_name TEXT,
            account_iban TEXT,
            period_start TEXT,
            period_end TEXT,
            statement_date TEXT,
            opening_balance REAL,
            closing_balance REAL,
            currency TEXT NOT NULL DEFAULT 'CHF',
            file_path TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            extracted_at TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_bank_statements_status ON bank_statements(status);
        CREATE INDEX idx_bank_statements_period ON bank_statements(period_start, period_end);

        -- Match rules first: bank_statement_transactions FK back to it via
        -- match_rule_id, so the rules table must exist when the txn table
        -- declares its constraint.
        CREATE TABLE bank_match_rules (
            id TEXT PRIMARY KEY,
            pattern TEXT NOT NULL,
            pattern_kind TEXT NOT NULL DEFAULT 'substring',
            direction TEXT,
            amount_min REAL,
            amount_max REAL,
            target_kind TEXT NOT NULL,
            target_id TEXT NOT NULL,
            learned INTEGER NOT NULL DEFAULT 1,
            enabled INTEGER NOT NULL DEFAULT 1,
            hit_count INTEGER NOT NULL DEFAULT 0,
            last_hit_at TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_match_rules_enabled ON bank_match_rules(enabled);
        CREATE INDEX idx_match_rules_target ON bank_match_rules(target_kind, target_id);

        CREATE TABLE bank_statement_transactions (
            id TEXT PRIMARY KEY,
            statement_id TEXT NOT NULL,
            transaction_date TEXT NOT NULL,
            booking_date TEXT,
            raw_description TEXT NOT NULL,
            cleaned_description TEXT,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            direction TEXT NOT NULL,
            reference_number TEXT,
            counterparty_iban TEXT,
            match_target_kind TEXT,
            match_target_id TEXT,
            match_confidence REAL,
            match_rule_id TEXT,
            match_status TEXT NOT NULL DEFAULT 'unmatched',
            review_notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (statement_id) REFERENCES bank_statements(id) ON DELETE CASCADE,
            FOREIGN KEY (match_rule_id) REFERENCES bank_match_rules(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_bank_tx_statement ON bank_statement_transactions(statement_id);
        CREATE INDEX idx_bank_tx_status ON bank_statement_transactions(match_status);
        CREATE INDEX idx_bank_tx_target ON bank_statement_transactions(match_target_kind, match_target_id);
        CREATE INDEX idx_bank_tx_date ON bank_statement_transactions(transaction_date);

        INSERT INTO schema_version (version) VALUES (12);
        "
    ).map_err(|e| format!("Migration v12 failed: {}", e))?;

    Ok(())
}

/// Bank ↔ items reconciliation. Three pieces:
/// 1. `items.bank_transaction_id` — back-link from a purchase to the bank
///    line that paid it, so `suggest_matches_for_statement` can skip items
///    already reconciled (idempotent re-runs) and the items list can show
///    a "rapproché" hint.
/// 2. `bank_statement_transactions.match_group_ids` — CSV of item ids when
///    a single debit equals the sum of several same-day/same-merchant
///    purchases (typical Amazon multi-line order). Stored at the suggestion
///    stage; promoted to a real `order_id` only when the user confirms.
/// 3. `pending_invoices` widened to allow rows without a file: useful when
///    a bank line has no matching item AND no scanned receipt yet — the
///    user wants to mark "facture à fournir plus tard" and provide the PDF
///    when it arrives. Same `_new` rebuild pattern as v3/v5/v9/v10/v11.
fn migrate_v13(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE items ADD COLUMN bank_transaction_id TEXT
            REFERENCES bank_statement_transactions(id) ON DELETE SET NULL;
        CREATE INDEX idx_items_bank_tx ON items(bank_transaction_id);

        -- Speeds up the candidate scan in load_item_candidates (active items
        -- in a date window with a target price). Partial index keeps it tiny.
        CREATE INDEX idx_items_price_date ON items(purchase_date, purchase_price)
            WHERE status = 'active';

        ALTER TABLE bank_statement_transactions ADD COLUMN match_group_ids TEXT;

        -- Rebuild pending_invoices to: (a) make file_path nullable for the
        -- 'expected invoice' flow, (b) add a source bank-transaction link,
        -- and (c) add optional expected_amount/date/currency carried over
        -- from the bank line so the user sees what they owe a PDF for.
        CREATE TABLE pending_invoices_new (
            id TEXT PRIMARY KEY,
            label TEXT,
            notes TEXT,
            original_name TEXT NOT NULL DEFAULT '',
            mime_type TEXT NOT NULL DEFAULT '',
            file_path TEXT,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            source_bank_tx_id TEXT,
            expected_amount REAL,
            expected_date TEXT,
            currency TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (source_bank_tx_id)
                REFERENCES bank_statement_transactions(id) ON DELETE SET NULL
        );

        INSERT INTO pending_invoices_new
            (id, label, notes, original_name, mime_type, file_path, size_bytes,
             created_at, updated_at)
        SELECT id, label, notes, original_name, mime_type, file_path, size_bytes,
               created_at, updated_at
        FROM pending_invoices;

        DROP TABLE pending_invoices;
        ALTER TABLE pending_invoices_new RENAME TO pending_invoices;

        CREATE INDEX idx_pending_invoices_created ON pending_invoices(created_at);
        CREATE INDEX idx_pending_invoices_bank_tx ON pending_invoices(source_bank_tx_id);

        INSERT INTO schema_version (version) VALUES (13);
        "
    ).map_err(|e| format!("Migration v13 failed: {}", e))?;

    Ok(())
}

// v14 — Swiss workflow: tax categorisation on purchases & charges, household
// members for multi-person attribution, canton on tax engagements, LAMal /
// mortgage specifics, and Twint as an account kind.
fn migrate_v14(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        -- Tax category for the annual declaration: pro / medical / don /
        -- entretien / 3a / formation / garde_enfant. NULL = not deductible.
        ALTER TABLE items ADD COLUMN tax_category TEXT;
        ALTER TABLE engagement_charges ADD COLUMN tax_category TEXT;
        CREATE INDEX idx_items_tax_category ON items(tax_category)
            WHERE tax_category IS NOT NULL;
        CREATE INDEX idx_engagement_charges_tax_category
            ON engagement_charges(tax_category)
            WHERE tax_category IS NOT NULL;

        -- Canton field for tax_federal / tax_cantonal / tax_communal /
        -- tax_other engagements. Two-letter ISO 3166-2:CH code (VD, GE, NE...).
        ALTER TABLE engagements ADD COLUMN canton TEXT;

        -- LAMal (compulsory Swiss health insurance) specifics.
        -- model: standard / family_doctor / hmo / telmed
        -- franchise_chf: 300 / 500 / 1000 / 1500 / 2000 / 2500
        -- franchise_reached_chf: year-to-date amount counting toward franchise
        -- accident_covered: boolean
        ALTER TABLE engagements ADD COLUMN lamal_model TEXT;
        ALTER TABLE engagements ADD COLUMN lamal_franchise_chf REAL;
        ALTER TABLE engagements ADD COLUMN lamal_franchise_reached_chf REAL;
        ALTER TABLE engagements ADD COLUMN lamal_accident_covered INTEGER;

        -- Mortgage specifics.
        -- mortgage_kind: fixed / saron / libor / variable
        ALTER TABLE engagements ADD COLUMN mortgage_kind TEXT;
        ALTER TABLE engagements ADD COLUMN mortgage_rate_pct REAL;
        ALTER TABLE engagements ADD COLUMN mortgage_renewal_date TEXT;
        ALTER TABLE engagements ADD COLUMN mortgage_amortisation_chf REAL;

        -- Household members: spouse / child / parent / other. Per-person LAMal,
        -- attributable expenses, tax declaration breakdowns.
        CREATE TABLE household_members (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            relation TEXT NOT NULL DEFAULT 'other',
            birth_date TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_household_members_relation ON household_members(relation);

        -- Attribute purchases & engagements to a member (NULL = household-wide).
        ALTER TABLE items ADD COLUMN attributed_to_member_id TEXT
            REFERENCES household_members(id) ON DELETE SET NULL;
        ALTER TABLE engagements ADD COLUMN attributed_to_member_id TEXT
            REFERENCES household_members(id) ON DELETE SET NULL;
        CREATE INDEX idx_items_member ON items(attributed_to_member_id)
            WHERE attributed_to_member_id IS NOT NULL;
        CREATE INDEX idx_engagements_member ON engagements(attributed_to_member_id)
            WHERE attributed_to_member_id IS NOT NULL;

        INSERT INTO schema_version (version) VALUES (14);
        "
    ).map_err(|e| format!("Migration v14 failed: {}", e))?;

    Ok(())
}

fn migrate_v15(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        -- Lignes auto-générées par le roll-forward : un paiement/charge est
        -- INSÉRÉ par cycle dépassé en SUPPOSANT que le débit a eu lieu. Ce
        -- drapeau marque ces lignes comme « présumées / à confirmer » pour ne
        -- pas les compter comme réellement payées tant que l'utilisateur ne
        -- les a pas validées (cf. mark_renewed / mark_charge_paid / confirm_*).
        --
        -- Rétro-compatibilité : les lignes existantes prennent 0 (= confirmées).
        -- On ne requalifie pas rétroactivement l'historique déjà saisi ; seules
        -- les nouvelles lignes générées automatiquement seront marquées à 1.
        ALTER TABLE subscription_payments ADD COLUMN is_presumed INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE engagement_charges ADD COLUMN is_presumed INTEGER NOT NULL DEFAULT 0;

        INSERT INTO schema_version (version) VALUES (15);
        "
    ).map_err(|e| format!("Migration v15 failed: {}", e))?;

    Ok(())
}

fn migrate_v16(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        -- Règles de classification marchand définies par l'utilisateur.
        -- La table statique de classify.rs est suisse-centrée ; ces règles la
        -- COMPLÈTENT et la SURCHARGENT (vérifiées en premier). `needle` est une
        -- sous-chaîne cherchée dans le libellé bancaire (comparaison en
        -- majuscules, avec frontières de mot, comme les patterns intégrés).
        CREATE TABLE merchant_rules (
            id TEXT PRIMARY KEY,
            needle TEXT NOT NULL,
            merchant TEXT NOT NULL,
            category TEXT,
            tax_category TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO schema_version (version) VALUES (16);
        "
    ).map_err(|e| format!("Migration v16 failed: {}", e))?;

    Ok(())
}

// v17 — Auto-extraction des tickets stockés. On OCR'ise/extrait chaque reçu
// déposé dans l'inbox pour qu'il porte marchand/montant/date exploitables, afin
// que `suggest_matches_for_statement` puisse le proposer comme correspondance
// d'une transaction bancaire. Les colonnes `expected_amount`/`expected_date`/
// `currency` (ajoutées en v13) servent de clés de rapprochement canoniques ; les
// `extracted_*` portent le reste des champs lus sur le ticket.
fn migrate_v17(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE pending_invoices ADD COLUMN extracted_merchant TEXT;
        ALTER TABLE pending_invoices ADD COLUMN extracted_invoice_number TEXT;
        ALTER TABLE pending_invoices ADD COLUMN extracted_tax_rate REAL;
        ALTER TABLE pending_invoices ADD COLUMN extracted_price_excl_tax REAL;
        ALTER TABLE pending_invoices ADD COLUMN extracted_warranty_months INTEGER;
        -- NULL | 'pending' | 'extracted' | 'failed'
        ALTER TABLE pending_invoices ADD COLUMN extraction_status TEXT;
        ALTER TABLE pending_invoices ADD COLUMN extracted_at TEXT;
        -- ExtractedReceipt sérialisé (conserve les lignes multi-articles pour un
        -- futur 'éclater en plusieurs articles').
        ALTER TABLE pending_invoices ADD COLUMN extracted_json TEXT;

        -- Accélère le scan des candidats dans load_pending_invoice_candidates
        -- (reçus avec un montant attendu dans une fenêtre de dates).
        CREATE INDEX idx_pending_invoices_expected
            ON pending_invoices(expected_date, expected_amount);

        INSERT INTO schema_version (version) VALUES (17);
        "
    ).map_err(|e| format!("Migration v17 failed: {}", e))?;

    Ok(())
}

/// Retire the deprecated `subscriptions` domain. Online subscriptions were
/// superseded by `engagements` (richer real-world contract model) and users
/// have migrated their data across, so the tables, their FTS mirror and the
/// polymorphic `subscription_id` link on `attachments` are dropped for good.
///
/// `attachments` is rebuilt one last time (same `_new` swap pattern as
/// v3/v5/v9/v10/v11) to remove the `subscription_id` column, its FK and its
/// slot in the CHECK constraint. Any attachment that pointed ONLY at a
/// subscription is left behind by the copy (it would otherwise violate the
/// tightened CHECK); migration of subscriptions to engagements already
/// re-pointed real invoices/contracts, so these are stale rows.
///
/// Child tables are dropped before their parent (`subscriptions`) so the
/// implicit row-clearing DROP performs under `foreign_keys=ON` without
/// tripping a constraint.
fn migrate_v18(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        -- Rebuild attachments without subscription_id.
        CREATE TABLE attachments_new (
            id TEXT PRIMARY KEY,
            item_id TEXT,
            order_id TEXT,
            engagement_id TEXT,
            engagement_charge_id TEXT,
            engagement_revision_id TEXT,
            income_id TEXT,
            income_receipt_id TEXT,
            reimbursement_id TEXT,
            original_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            attachment_type TEXT NOT NULL DEFAULT 'other',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (item_id IS NOT NULL OR order_id IS NOT NULL
                   OR engagement_id IS NOT NULL OR engagement_charge_id IS NOT NULL
                   OR engagement_revision_id IS NOT NULL
                   OR income_id IS NOT NULL OR income_receipt_id IS NOT NULL
                   OR reimbursement_id IS NOT NULL),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_charge_id) REFERENCES engagement_charges(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_revision_id) REFERENCES engagement_revisions(id) ON DELETE CASCADE,
            FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE,
            FOREIGN KEY (income_receipt_id) REFERENCES income_receipts(id) ON DELETE CASCADE,
            FOREIGN KEY (reimbursement_id) REFERENCES pending_reimbursements(id) ON DELETE CASCADE
        );

        INSERT INTO attachments_new
            (id, item_id, order_id, engagement_id,
             engagement_charge_id, engagement_revision_id,
             income_id, income_receipt_id, reimbursement_id,
             original_name, display_name, mime_type, file_path, size_bytes,
             attachment_type, created_at)
        SELECT id, item_id, order_id, engagement_id,
               engagement_charge_id, engagement_revision_id,
               income_id, income_receipt_id, reimbursement_id,
               original_name, display_name, mime_type, file_path, size_bytes,
               attachment_type, created_at
        FROM attachments
        WHERE subscription_id IS NULL;

        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;

        CREATE INDEX idx_attachments_item ON attachments(item_id);
        CREATE INDEX idx_attachments_order ON attachments(order_id);
        CREATE INDEX idx_attachments_engagement ON attachments(engagement_id);
        CREATE INDEX idx_attachments_charge ON attachments(engagement_charge_id);
        CREATE INDEX idx_attachments_revision ON attachments(engagement_revision_id);
        CREATE INDEX idx_attachments_income ON attachments(income_id);
        CREATE INDEX idx_attachments_income_receipt ON attachments(income_receipt_id);
        CREATE INDEX idx_attachments_reimbursement ON attachments(reimbursement_id);

        -- Drop the subscription FTS mirror and its sync triggers first so they
        -- can't fire while the base tables are torn down.
        DROP TRIGGER IF EXISTS subscriptions_ai;
        DROP TRIGGER IF EXISTS subscriptions_au;
        DROP TRIGGER IF EXISTS subscriptions_ad;
        DROP TABLE IF EXISTS subscriptions_fts;

        -- Children before parent (FK-safe under foreign_keys=ON).
        DROP TABLE IF EXISTS subscription_members;
        DROP TABLE IF EXISTS subscription_payments;
        DROP TABLE IF EXISTS subscriptions;

        INSERT INTO schema_version (version) VALUES (18);
        "
    ).map_err(|e| format!("Migration v18 failed: {}", e))?;

    Ok(())
}

/// Parking specifics for `engagement_type='parking'`. A parking spot is modelled
/// as a child engagement of the apartment's rent; these two columns hold the
/// structured details the rent assistant collects.
///   - parking_spot_number : the spot label/number on the lease (e.g. "42").
///   - parking_kind        : 'outdoor' | 'collective_garage' | 'box'.
/// NULL for every non-parking engagement.
fn migrate_v19(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE engagements ADD COLUMN parking_spot_number TEXT;
        ALTER TABLE engagements ADD COLUMN parking_kind TEXT;

        INSERT INTO schema_version (version) VALUES (19);
        "
    ).map_err(|e| format!("Migration v19 failed: {}", e))?;

    Ok(())
}

/// Vehicle leasing specifics for `engagement_type='leasing'`. Car leasing in
/// Switzerland is driven by a handful of structured terms the assistant
/// collects: the vehicle identity (make/model/plate/VIN/first registration)
/// and the financial terms (vehicle price, duration, down payment, residual
/// value, effective rate (TAEG), included annual mileage and the cost of each
/// extra km). All NULL for non-leasing engagements.
fn migrate_v20(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE engagements ADD COLUMN vehicle_make TEXT;
        ALTER TABLE engagements ADD COLUMN vehicle_model TEXT;
        ALTER TABLE engagements ADD COLUMN vehicle_plate TEXT;
        ALTER TABLE engagements ADD COLUMN vehicle_vin TEXT;
        ALTER TABLE engagements ADD COLUMN vehicle_first_registration TEXT;
        ALTER TABLE engagements ADD COLUMN leasing_vehicle_price REAL;
        ALTER TABLE engagements ADD COLUMN leasing_duration_months INTEGER;
        ALTER TABLE engagements ADD COLUMN leasing_down_payment REAL;
        ALTER TABLE engagements ADD COLUMN leasing_residual_value REAL;
        ALTER TABLE engagements ADD COLUMN leasing_interest_rate_pct REAL;
        ALTER TABLE engagements ADD COLUMN leasing_annual_mileage_km INTEGER;
        ALTER TABLE engagements ADD COLUMN leasing_excess_km_cost REAL;

        INSERT INTO schema_version (version) VALUES (20);
        "
    ).map_err(|e| format!("Migration v20 failed: {}", e))?;

    Ok(())
}

/// Commercial discount on a leasing (e.g. a manufacturer/dealer offer such as
/// a Tesla promotion the customer accepted). Stored separately from the gross
/// down payment so both the headline terms and the deal are kept: the net the
/// customer actually pays up front is `leasing_down_payment - leasing_discount`.
/// NULL for non-leasing engagements.
fn migrate_v21(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE engagements ADD COLUMN leasing_discount REAL;

        INSERT INTO schema_version (version) VALUES (21);
        "
    ).map_err(|e| format!("Migration v21 failed: {}", e))?;

    Ok(())
}

/// Car insurance specifics for `engagement_type='insurance_car'`. Reuses the
/// generic `vehicle_*` columns (v20) for the insured vehicle, and adds:
///   - insurance_coverage        : 'rc' | 'partial_casco' | 'full_casco'.
///   - insurance_franchise_casco : collision/full-casco deductible (CHF).
///   - insurance_franchise_partial: partial-casco deductible (CHF).
///   - insurance_bonus_pct       : no-claims bonus level (% of base premium).
///   - insurance_options_json    : JSON array of extra-coverage slugs (parking
///                                 damage, bonus protection, passengers, legal
///                                 protection, assistance, new value…). Stored
///                                 opaque — the backend never parses it.
/// All NULL for non-insurance engagements.
fn migrate_v22(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE engagements ADD COLUMN insurance_coverage TEXT;
        ALTER TABLE engagements ADD COLUMN insurance_franchise_casco REAL;
        ALTER TABLE engagements ADD COLUMN insurance_franchise_partial REAL;
        ALTER TABLE engagements ADD COLUMN insurance_bonus_pct REAL;
        ALTER TABLE engagements ADD COLUMN insurance_options_json TEXT;

        INSERT INTO schema_version (version) VALUES (22);
        "
    ).map_err(|e| format!("Migration v22 failed: {}", e))?;

    Ok(())
}

/// Per-coverage premium breakdown for a car insurance, mirroring a real Swiss
/// offer (RC / casco collision / casco partielle / extra coverages / passenger
/// accident, plus taxes). Stored as an opaque JSON object so the headline
/// `current_amount` stays the budget figure (total incl. taxes) while the
/// detail is kept for reference. NULL when not provided.
fn migrate_v23(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE engagements ADD COLUMN insurance_premium_breakdown_json TEXT;

        INSERT INTO schema_version (version) VALUES (23);
        "
    ).map_err(|e| format!("Migration v23 failed: {}", e))?;

    Ok(())
}

/// More vehicle/insurance details taken from a real Swiss offer:
///   - vehicle_category             : 'passenger_car' | 'motorcycle' | … .
///   - vehicle_registration_number  : Swiss registration no. (n° de matricule).
///   - vehicle_is_leasing           : the vehicle is leased (offer "Leasing: Oui").
///   - insurance_young_driver_franchise: extra deductible for young drivers (CHF).
/// All NULL when not applicable.
fn migrate_v24(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE engagements ADD COLUMN vehicle_category TEXT;
        ALTER TABLE engagements ADD COLUMN vehicle_registration_number TEXT;
        ALTER TABLE engagements ADD COLUMN vehicle_is_leasing INTEGER;
        ALTER TABLE engagements ADD COLUMN insurance_young_driver_franchise REAL;

        INSERT INTO schema_version (version) VALUES (24);
        "
    ).map_err(|e| format!("Migration v24 failed: {}", e))?;

    Ok(())
}

/// Monthly AI token usage counter. One row per calendar month ('YYYY-MM'),
/// accumulating tokens sent (`prompt_tokens`) and received (`completion_tokens`)
/// plus the number of AI calls. Lets the user see their AI consumption per
/// month. Purely informational; written best-effort after each AI call.
fn migrate_v25(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ai_usage (
            month TEXT PRIMARY KEY,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            calls INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO schema_version (version) VALUES (25);
        "
    ).map_err(|e| format!("Migration v25 failed: {}", e))?;

    Ok(())
}

/// Vehicle hub (v26): a dedicated `vehicles` entity that groups everything about
/// one car — its leasing, insurance and tax engagements, plus (from v27) an
/// expense ledger. Engagements gain a nullable `vehicle_id` so leasing /
/// insurance_car / vehicle-tax positions can be attached to a vehicle.
///
/// The generic `vehicle_*` columns already on `engagements` (make/model/plate…)
/// stay: they describe the insured/leased vehicle on that specific contract,
/// while the `vehicles` row is the canonical, shared identity.
fn migrate_v26(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE vehicles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            make TEXT,
            model TEXT,
            plate TEXT,
            vin TEXT,
            registration_number TEXT,
            category TEXT,                 -- passenger_car | motorcycle | light_commercial | motorhome | other
            energy_type TEXT,              -- electric | gasoline | diesel | hybrid | phev | other
            first_registration TEXT,
            canton TEXT,                   -- for the (manually entered) vehicle tax
            color TEXT,
            power_kw REAL,
            displacement_cc INTEGER,
            weight_kg INTEGER,
            battery_kwh REAL,              -- usable battery capacity (EV/PHEV)
            purchase_date TEXT,
            purchase_price REAL,
            odometer_km INTEGER,           -- last known odometer reading
            status TEXT NOT NULL DEFAULT 'active',  -- active | sold | scrapped
            sold_on TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_vehicles_status ON vehicles(status);
        CREATE INDEX idx_vehicles_plate ON vehicles(plate);

        ALTER TABLE engagements ADD COLUMN vehicle_id TEXT
            REFERENCES vehicles(id) ON DELETE SET NULL;
        CREATE INDEX idx_engagements_vehicle ON engagements(vehicle_id);

        INSERT INTO schema_version (version) VALUES (26);
        "
    ).map_err(|e| format!("Migration v26 failed: {}", e))?;

    Ok(())
}

/// Vehicle expense ledger (v27): every cost tied to a vehicle — charging (kWh),
/// fuel (litres), tires, maintenance, repairs, cleaning, inspection, vignette,
/// parking, fines, toll, misc — with optional quantity/unit price, odometer
/// reading, location and a "next due" reminder (km or date, e.g. next tire
/// change / service). Receipts attach via the new `attachments.vehicle_expense_id`
/// parent, so the `attachments` table is rebuilt once more (SQLite can't ALTER
/// a CHECK constraint in place — same `attachments_new` swap as v3/v5/v9/v11).
fn migrate_v27(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE vehicle_expenses (
            id TEXT PRIMARY KEY,
            vehicle_id TEXT NOT NULL,
            expense_date TEXT NOT NULL,
            category TEXT NOT NULL,        -- charging | fuel | tires | maintenance | repair | cleaning | accessories | inspection | vignette | parking | fine | toll | tax | other
            description TEXT,
            amount REAL NOT NULL,
            currency TEXT NOT NULL DEFAULT 'CHF',
            odometer_km INTEGER,
            quantity REAL,                 -- kWh (charging) or litres (fuel)
            unit TEXT,                     -- 'kWh' | 'l'
            unit_price REAL,               -- price per kWh / litre
            location TEXT,                 -- station / charge point / garage
            merchant TEXT,
            payment_card_id TEXT,
            next_due_km INTEGER,           -- e.g. next service / tire change at km
            next_due_date TEXT,            -- e.g. next inspection date
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
            FOREIGN KEY (payment_card_id) REFERENCES payment_cards(id)
        );
        CREATE INDEX idx_vehicle_expenses_vehicle ON vehicle_expenses(vehicle_id);
        CREATE INDEX idx_vehicle_expenses_date ON vehicle_expenses(expense_date);
        CREATE INDEX idx_vehicle_expenses_category ON vehicle_expenses(category);

        -- Widen attachments: add vehicle_expense_id (receipts on an expense).
        -- Mirrors the current (v18) shape — no subscription_id — plus the new FK.
        CREATE TABLE attachments_new (
            id TEXT PRIMARY KEY,
            item_id TEXT,
            order_id TEXT,
            engagement_id TEXT,
            engagement_charge_id TEXT,
            engagement_revision_id TEXT,
            income_id TEXT,
            income_receipt_id TEXT,
            reimbursement_id TEXT,
            vehicle_expense_id TEXT,
            original_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            attachment_type TEXT NOT NULL DEFAULT 'other',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            CHECK (item_id IS NOT NULL OR order_id IS NOT NULL
                   OR engagement_id IS NOT NULL OR engagement_charge_id IS NOT NULL
                   OR engagement_revision_id IS NOT NULL
                   OR income_id IS NOT NULL OR income_receipt_id IS NOT NULL
                   OR reimbursement_id IS NOT NULL OR vehicle_expense_id IS NOT NULL),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_charge_id) REFERENCES engagement_charges(id) ON DELETE CASCADE,
            FOREIGN KEY (engagement_revision_id) REFERENCES engagement_revisions(id) ON DELETE CASCADE,
            FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE,
            FOREIGN KEY (income_receipt_id) REFERENCES income_receipts(id) ON DELETE CASCADE,
            FOREIGN KEY (reimbursement_id) REFERENCES pending_reimbursements(id) ON DELETE CASCADE,
            FOREIGN KEY (vehicle_expense_id) REFERENCES vehicle_expenses(id) ON DELETE CASCADE
        );

        INSERT INTO attachments_new
            (id, item_id, order_id, engagement_id,
             engagement_charge_id, engagement_revision_id,
             income_id, income_receipt_id, reimbursement_id, vehicle_expense_id,
             original_name, display_name, mime_type, file_path, size_bytes,
             attachment_type, created_at)
        SELECT id, item_id, order_id, engagement_id,
               engagement_charge_id, engagement_revision_id,
               income_id, income_receipt_id, reimbursement_id, NULL,
               original_name, display_name, mime_type, file_path, size_bytes,
               attachment_type, created_at
        FROM attachments;

        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;

        CREATE INDEX idx_attachments_item ON attachments(item_id);
        CREATE INDEX idx_attachments_order ON attachments(order_id);
        CREATE INDEX idx_attachments_engagement ON attachments(engagement_id);
        CREATE INDEX idx_attachments_charge ON attachments(engagement_charge_id);
        CREATE INDEX idx_attachments_revision ON attachments(engagement_revision_id);
        CREATE INDEX idx_attachments_income ON attachments(income_id);
        CREATE INDEX idx_attachments_income_receipt ON attachments(income_receipt_id);
        CREATE INDEX idx_attachments_reimbursement ON attachments(reimbursement_id);
        CREATE INDEX idx_attachments_vehicle_expense ON attachments(vehicle_expense_id);

        INSERT INTO schema_version (version) VALUES (27);
        "
    ).map_err(|e| format!("Migration v27 failed: {}", e))?;

    Ok(())
}

/// Salaire suisse (v28) : ce qu'il faut pour contrôler un bulletin et
/// reconstituer un certificat de salaire.
///
/// Trois ajouts et une préparation.
///
/// 1. `employment_contracts` — les termes de l'emploi, saisis une fois : taux
///    d'activité, salaire annuel convenu, heures hebdomadaires, et surtout les
///    trois taux que AUCUN barème ne permet de deviner (part employé de la
///    caisse de pension, prime AANP, prime IJM). Sans eux le moteur annonce
///    qu'il ne peut pas contrôler, plutôt que d'inventer un montant.
///    Un contrat par revenu (`UNIQUE`), parce qu'un revenu de type `salary`
///    correspond à un employeur.
///
/// 2. `income_receipts` s'élargit par simple `ADD COLUMN` — pas de
///    reconstruction, pas de backfill : les bulletins déjà saisis restent
///    lisibles tels quels. On RÉUTILISE les colonnes v10 plutôt que d'en
///    créer des doublons : `social_charges_amount` reste l'AVS/AI/APG (c'est
///    déjà son libellé dans l'UI et dans l'export CSV) et `pension_amount`
///    reste le 2ᵉ pilier. Les nouvelles colonnes décomposent le brut (13ᵉ,
///    heures supplémentaires, allocations, part privée du véhicule…) et
///    séparent les retenues jusqu'ici noyées dans `other_deductions_amount`.
///
///    Deux distinctions comptent juridiquement et justifient des colonnes
///    dédiées : les allocations familiales transitent par le bulletin sans
///    être du salaire déterminant (art. 6 RAVS), et les frais remboursés ne
///    sont ni du salaire ni du revenu imposable (art. 327a CO, ch. 13 du
///    certificat). Les noyer dans le brut fausse toutes les cotisations.
///
/// 3. `annual_salary_certificates` — le certificat de salaire rubrique par
///    rubrique. L'employeur doit l'établir (art. 127 LIFD) ; le stocker tel
///    quel permet de le confronter aux douze bulletins.
///
/// 4. `incomes.attributed_to_member_id` — même forme que sur `items` et
///    `engagements` (v14). Aucune UI ne s'en sert encore : la colonne existe
///    pour que le jour où un second revenu entre dans le ménage, il n'y ait
///    pas de migration cassante sur une table déjà remplie.
fn migrate_v28(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE employment_contracts (
            id TEXT PRIMARY KEY,
            income_id TEXT NOT NULL UNIQUE,
            employer_name TEXT,
            employer_uid TEXT,                     -- IDE, format CHE-123.456.789
            avs_number TEXT,                       -- n° AVS, format 756.xxxx.xxxx.xx
            birth_date TEXT,                       -- sert à la tranche de bonification LPP
            work_canton TEXT,                      -- canton de travail (barème des allocations familiales)
            activity_rate_pct REAL,
            annual_gross_agreed REAL,
            salary_periods_per_year INTEGER,       -- 12 ou 13 selon que le 13e est versé à part
            weekly_hours REAL,
            hourly_paid INTEGER NOT NULL DEFAULT 0,
            thirteenth_salary INTEGER NOT NULL DEFAULT 0,
            -- Taux contractuels : jamais déduits d'un barème.
            lpp_fund_name TEXT,
            lpp_employee_share_pct REAL,           -- % du salaire coordonné
            laa_insurer TEXT,
            laa_nonoccupational_pct REAL,          -- AANP, % du salaire assuré
            ijm_employee_pct REAL,                 -- indemnités journalières maladie
            -- Régime fiscal. L'impôt à la source est préparé mais l'app vise
            -- d'abord la taxation ordinaire.
            tax_at_source INTEGER NOT NULL DEFAULT 0,
            tax_at_source_scale TEXT,              -- A | B | C | H | ...
            -- Prix d'achat HT du véhicule d'entreprise : la part privée vaut
            -- 0.9 %/mois de ce montant (min. 150 CHF), ch. 2.2 du certificat.
            company_car_purchase_price REAL,
            -- Pilote le forfait repas déductible : 3'200 CHF/an, ou 1'600 si
            -- l'employeur subventionne la cantine.
            subsidized_canteen INTEGER NOT NULL DEFAULT 0,
            commute_km_per_day REAL,
            commute_public_transport_cost_year REAL,
            started_on TEXT,
            ended_on TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_employment_contracts_income ON employment_contracts(income_id);

        -- Décomposition du brut.
        ALTER TABLE income_receipts ADD COLUMN period_start TEXT;
        ALTER TABLE income_receipts ADD COLUMN period_end TEXT;
        ALTER TABLE income_receipts ADD COLUMN fiscal_year INTEGER;
        ALTER TABLE income_receipts ADD COLUMN base_salary_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN thirteenth_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN overtime_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN overtime_hours REAL;
        ALTER TABLE income_receipts ADD COLUMN holiday_pay_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN family_allowance_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN benefits_in_kind_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN company_car_private_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN other_gross_amount REAL;

        -- Retenues, jusqu'ici agrégées dans other_deductions_amount.
        ALTER TABLE income_receipts ADD COLUMN ac_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN ac_solidarity_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN laa_nonoccupational_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN ijm_amount REAL;

        -- Frais remboursés : ni salaire, ni revenu imposable.
        ALTER TABLE income_receipts ADD COLUMN expense_reimbursement_amount REAL;
        ALTER TABLE income_receipts ADD COLUMN expense_lump_sum_amount REAL;

        -- Renseigne l'année fiscale des bulletins déjà saisis à partir de leur
        -- date de réception, pour que les agrégations annuelles les voient.
        UPDATE income_receipts
           SET fiscal_year = CAST(substr(received_on, 1, 4) AS INTEGER)
         WHERE fiscal_year IS NULL;

        CREATE INDEX idx_income_receipts_year ON income_receipts(fiscal_year);

        CREATE TABLE annual_salary_certificates (
            id TEXT PRIMARY KEY,
            income_id TEXT NOT NULL,
            fiscal_year INTEGER NOT NULL,
            -- Rubriques du formulaire officiel (form. 11).
            r1_salary REAL,                        -- 1.  Salaire brut / rente
            r2_1_benefits_in_kind REAL,            -- 2.1 Prestations en nature (repas, logement)
            r2_2_company_car REAL,                 -- 2.2 Part privée du véhicule de service
            r2_3_other_benefits REAL,              -- 2.3 Autres prestations salariales accessoires
            r3_irregular REAL,                     -- 3.  Prestations non périodiques
            r4_capital_shares REAL,                -- 4.  Participations de collaborateur
            r5_board_fees REAL,                    -- 5.  Indemnités des membres de l'administration
            r6_other_benefits REAL,                -- 6.  Autres prestations
            r7_other_payments REAL,                -- 7.  Prestations en capital
            r8_gross_total REAL,                   -- 8.  Salaire brut total
            r9_social_contributions REAL,          -- 9.  Cotisations AVS/AI/APG/AC/AANP
            r10_1_lpp_ordinary REAL,               -- 10.1 Cotisations LPP ordinaires
            r10_2_lpp_buyback REAL,                -- 10.2 Cotisations LPP, rachats
            r11_net_salary REAL,                   -- 11. Salaire net
            r12_tax_at_source REAL,                -- 12. Impôt à la source retenu
            r13_1_effective_expenses REAL,         -- 13.1 Frais effectifs
            r13_2_lump_sum_expenses REAL,          -- 13.2 Frais forfaitaires
            r14_other_disclosures REAL,            -- 14. Autres prestations de l'employeur
            r15_remarks TEXT,                      -- 15. Observations
            -- Cases à cocher du certificat.
            box_f_employer_transport INTEGER NOT NULL DEFAULT 0,
            box_g_free_meals INTEGER NOT NULL DEFAULT 0,
            received_on TEXT,
            origin TEXT NOT NULL DEFAULT 'manual', -- manual | ai_scan
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (income_id, fiscal_year),
            FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_salary_certificates_income ON annual_salary_certificates(income_id);
        CREATE INDEX idx_salary_certificates_year ON annual_salary_certificates(fiscal_year);

        -- Préparation multi-membres : même forme que items / engagements.
        ALTER TABLE incomes ADD COLUMN attributed_to_member_id TEXT
            REFERENCES household_members(id) ON DELETE SET NULL;
        CREATE INDEX idx_incomes_member ON incomes(attributed_to_member_id)
            WHERE attributed_to_member_id IS NOT NULL;

        INSERT INTO schema_version (version) VALUES (28);
        "
    ).map_err(|e| format!("Migration v28 failed: {}", e))?;

    Ok(())
}

/// v29 — le brut devient saisissable, et les barèmes deviennent modifiables.
///
/// Trois ajouts, tous purement additifs (pas de reconstruction, pas de
/// backfill) :
///
/// 1. `payroll_param_overrides` — une ligne par année, une colonne NULLABLE
///    par valeur de `PayrollParams`. `NULL` signifie « garder la valeur
///    livrée avec l'application ». Ce choix, plutôt qu'une copie complète du
///    barème, donne la provenance valeur par valeur : l'écran Barèmes peut
///    dire quels chiffres l'utilisateur a changés, et « Réinitialiser » se
///    contente de remettre `NULL`.
///
/// 2. `tax_at_source_tariffs` / `tax_at_source_imports` — les barèmes
///    cantonaux d'impôt à la source. L'AFC ne les publie qu'en fichiers
///    réservés aux employeurs et aux éditeurs de logiciels : ils ne peuvent
///    donc pas être livrés avec l'application, l'utilisateur les importe.
///    Tant qu'aucun tarif n'est importé, l'impôt est annoncé comme non
///    calculable — jamais estimé au doigt mouillé.
///
/// 3. `employment_contracts.tax_at_source_rate_pct` — le repli : le taux
///    effectif lu sur la fiche de salaire, utilisable sans aucun import.
fn migrate_v29(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE payroll_param_overrides (
            year INTEGER PRIMARY KEY,

            -- AVS / AI / APG (LAVS)
            avs_ai_apg_employee_pct REAL,
            avs_ai_apg_employer_pct REAL,

            -- Assurance-chômage (LACI)
            ac_employee_pct REAL,
            ac_ceiling REAL,
            ac_solidarity_employee_pct REAL,

            -- LAA
            laa_max_insured REAL,
            laa_nonoccupational_min_weekly_hours REAL,

            -- LPP / OPP2
            lpp_entry_threshold REAL,
            lpp_coordination_deduction REAL,
            lpp_avs_upper_limit REAL,
            lpp_min_coordinated REAL,
            -- JSON [[age_min, age_max, taux_total_pct], ...] : la réforme LPP
            -- remplacerait les 4 paliers par 2 taux, d'où le format libre.
            lpp_credit_brackets TEXT,

            -- Pilier 3a (OPP3)
            pillar3a_with_lpp REAL,
            pillar3a_without_lpp_pct REAL,
            pillar3a_without_lpp_cap REAL,

            -- Frais professionnels (art. 26 LIFD)
            pro_lump_sum_pct REAL,
            pro_lump_sum_min REAL,
            pro_lump_sum_max REAL,
            meals_full_year REAL,
            meals_subsidized_year REAL,
            meals_full_day REAL,
            meals_subsidized_day REAL,
            commute_cap_ifd REAL,
            commute_private_car_per_km REAL,

            -- Part privée d'un véhicule d'entreprise
            private_car_monthly_pct REAL,
            private_car_monthly_min REAL,

            -- Allocations familiales (LAFam)
            family_allowance_min_child REAL,
            family_allowance_min_training REAL,

            -- Pourquoi l'utilisateur a changé ces valeurs (circulaire, CCT...).
            note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Barèmes d'impôt à la source, tels que livrés par les cantons.
        -- Une ligne = une tranche : l'impôt dû pour un revenu compris entre
        -- income_from et income_from + income_step.
        CREATE TABLE tax_at_source_tariffs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            canton TEXT NOT NULL,
            tariff_code TEXT NOT NULL,          -- A0N, B2Y, C1N...
            valid_from TEXT NOT NULL,           -- AAAA-MM-JJ
            children INTEGER NOT NULL,
            income_from REAL NOT NULL,
            income_step REAL NOT NULL,
            tax_amount REAL,                    -- montant d'impôt de la tranche
            rate_pct REAL,                      -- certains cantons livrent un taux
            UNIQUE (canton, tariff_code, valid_from, children, income_from)
        );
        CREATE INDEX idx_qst_lookup ON tax_at_source_tariffs
            (canton, tariff_code, children, valid_from, income_from);

        -- Trace des imports : sans elle, impossible de dire à l'utilisateur
        -- quels cantons et quelles années il a déjà chargés.
        CREATE TABLE tax_at_source_imports (
            id TEXT PRIMARY KEY,
            canton TEXT NOT NULL,
            fiscal_year INTEGER NOT NULL,
            source_file TEXT NOT NULL,
            file_created_on TEXT,               -- date portée par l'en-tête du fichier
            row_count INTEGER NOT NULL,
            imported_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (canton, fiscal_year)
        );

        -- Repli quand aucun tarif n'est importé : le taux effectif que
        -- l'utilisateur lit sur sa fiche de salaire.
        ALTER TABLE employment_contracts ADD COLUMN tax_at_source_rate_pct REAL;

        INSERT INTO schema_version (version) VALUES (29);
        "
    ).map_err(|e| format!("Migration v29 failed: {}", e))?;

    Ok(())
}

/// v30 — une année de barème peut être déclarée vérifiée.
///
/// Contrôler une fiche de 2012 suppose les barèmes de 2012. L'application n'en
/// publie que cinq (2022-2026) : pour tout le reste, les chiffres viennent de
/// l'utilisateur, et rien ne dit s'il les a recopiés d'une source officielle
/// ou saisis de mémoire.
///
/// La différence est lourde de conséquences. Sur un barème incertain, un écart
/// constaté ne prouve pas une erreur de l'employeur — il peut tout aussi bien
/// venir du barème. Tant qu'une année n'est pas confirmée, les constats
/// plafonnent donc en avertissement ; cocher cette case, source officielle
/// sous les yeux, leur rend leur gravité.
fn migrate_v30(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE payroll_param_overrides
            ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0;

        INSERT INTO schema_version (version) VALUES (30);
        "
    ).map_err(|e| format!("Migration v30 failed: {}", e))?;

    Ok(())
}

/// v31 — les retenues salariales propres à un canton.
///
/// Le moteur ne connaissait que le droit fédéral. Or deux prélèvements
/// cantonaux tombent bel et bien sur la fiche de paie du salarié :
///
///   - **Vaud et Valais** font cotiser l'employé aux allocations familiales,
///     là où les autres cantons ne chargent que l'employeur ;
///   - **Genève** prélève l'assurance maternité cantonale (AMat), pour moitié
///     à charge de l'employé.
///
/// Sans eux, le net d'un salarié vaudois ou genevois est faux de quelques
/// francs par mois, et surtout le contrôle de bulletin signale un écart qui
/// n'en est pas un — il prend une cotisation légitime pour une anomalie.
///
/// La table naît VIDE, et c'est délibéré : ces taux changent chaque année et
/// dépendent de la caisse de compensation. Les inscrire en dur reviendrait à
/// livrer des chiffres que personne n'a vérifiés. L'écran des barèmes les
/// demande, en indiquant où les trouver.
fn migrate_v31(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE cantonal_payroll_params (
            canton TEXT NOT NULL,
            year INTEGER NOT NULL,
            -- Cotisation SALARIÉE aux allocations familiales (VD, VS).
            family_allowance_employee_pct REAL,
            -- Assurance maternité cantonale, part employé (GE).
            maternity_employee_pct REAL,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (canton, year)
        );

        INSERT INTO schema_version (version) VALUES (31);
        "
    ).map_err(|e| format!("Migration v31 failed: {}", e))?;

    Ok(())
}

/// v32 — le contrat devient une suite d'avenants, et le canton se dédouble.
///
/// Deux hypothèses de la v28 tombent en même temps, et elles se corrigent au
/// même endroit : la table est reconstruite une seule fois.
///
/// **Un contrat par revenu.** La contrainte `income_id UNIQUE` supposait qu'un
/// employeur = un jeu de conditions, figé. Or un salaire se renégocie : un
/// avenant écrasait les termes précédents, et une fiche de 2019 se retrouvait
/// contrôlée avec le salaire d'aujourd'hui — donc constellée d'écarts qui n'en
/// sont pas. Le contrat devient une suite de versions datées, et le contrôle
/// d'un bulletin va chercher celle qui était en vigueur ce jour-là.
///
/// `started_on` et `ended_on` existaient déjà sans être lus par aucune requête.
/// Ils deviennent la période de validité de la version, plutôt que d'ajouter
/// une seconde paire de dates qui ferait doublon. `started_on` passe donc
/// `NOT NULL`, avec une borne basse volontairement large pour les contrats
/// existants : aucune fiche déjà saisie ne doit se retrouver orpheline.
///
/// **Un seul canton.** `work_canton` servait à la fois au barème d'impôt à la
/// source et aux retenues sociales cantonales. Ce sont deux cantons distincts
/// dès qu'on habite ailleurs qu'au siège de son employeur, et la loi les
/// désigne séparément : l'impôt à la source d'un résident suisse relève du
/// canton de DOMICILE (art. 38 al. 4 let. a LHID), tandis que les allocations
/// familiales et les retenues cantonales suivent la caisse à laquelle
/// l'employeur est affilié, donc son siège. Avec un champ unique, l'un des deux
/// calculs était nécessairement faux.
///
/// SQLite ne sait pas retirer une contrainte `UNIQUE` posée en ligne : il faut
/// reconstruire. Même procédé qu'en v18 pour `attachments`.
fn migrate_v32(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE employment_contracts_new (
            id TEXT PRIMARY KEY,
            -- Plus de UNIQUE : plusieurs versions par revenu, une par avenant.
            income_id TEXT NOT NULL,
            -- Ce qui distingue cette version des autres, à l'écran.
            label TEXT,
            employer_name TEXT,
            employer_uid TEXT,
            avs_number TEXT,
            birth_date TEXT,
            -- Siège de l'employeur : retenues sociales cantonales et caisse
            -- d'allocations familiales.
            work_canton TEXT,
            -- Domicile du salarié : barème d'impôt à la source.
            residence_canton TEXT,
            -- 'residence' (la règle) ou 'work', pour les employeurs qui
            -- retiennent selon leur propre canton puis reversent. Les deux
            -- pratiques existent ; seule la fiche de salaire tranche.
            tax_at_source_canton_source TEXT NOT NULL DEFAULT 'residence',
            activity_rate_pct REAL,
            annual_gross_agreed REAL,
            salary_periods_per_year INTEGER,
            weekly_hours REAL,
            hourly_paid INTEGER NOT NULL DEFAULT 0,
            thirteenth_salary INTEGER NOT NULL DEFAULT 0,
            lpp_fund_name TEXT,
            lpp_employee_share_pct REAL,
            -- 'total' = le brut entier est assuré, suppléments compris ;
            -- 'base' = seul le salaire contractuel l'est. La réponse tient au
            -- règlement de la caisse de pension, elle ne se devine pas.
            lpp_insured_scope TEXT NOT NULL DEFAULT 'total',
            laa_insurer TEXT,
            laa_nonoccupational_pct REAL,
            ijm_employee_pct REAL,
            tax_at_source INTEGER NOT NULL DEFAULT 0,
            tax_at_source_scale TEXT,
            tax_at_source_rate_pct REAL,
            company_car_purchase_price REAL,
            subsidized_canteen INTEGER NOT NULL DEFAULT 0,
            commute_km_per_day REAL,
            commute_public_transport_cost_year REAL,
            -- Période de validité de CETTE version.
            started_on TEXT NOT NULL,
            ended_on TEXT,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (income_id) REFERENCES incomes(id) ON DELETE CASCADE
        );

        INSERT INTO employment_contracts_new
            (id, income_id, label, employer_name, employer_uid, avs_number, birth_date,
             work_canton, residence_canton, tax_at_source_canton_source,
             activity_rate_pct, annual_gross_agreed, salary_periods_per_year,
             weekly_hours, hourly_paid, thirteenth_salary, lpp_fund_name,
             lpp_employee_share_pct, lpp_insured_scope, laa_insurer,
             laa_nonoccupational_pct, ijm_employee_pct, tax_at_source,
             tax_at_source_scale, tax_at_source_rate_pct, company_car_purchase_price,
             subsidized_canteen, commute_km_per_day, commute_public_transport_cost_year,
             started_on, ended_on, notes, created_at, updated_at)
        SELECT id, income_id, NULL, employer_name, employer_uid, avs_number, birth_date,
               work_canton,
               -- Jusqu'ici un seul canton était saisi : on suppose que domicile
               -- et travail coïncident, ce qui est le cas le plus fréquent. Qui
               -- habite ailleurs le corrigera, et l'écran le lui demande.
               work_canton,
               'residence',
               activity_rate_pct, annual_gross_agreed, salary_periods_per_year,
               weekly_hours, hourly_paid, thirteenth_salary, lpp_fund_name,
               lpp_employee_share_pct, 'total', laa_insurer,
               laa_nonoccupational_pct, ijm_employee_pct, tax_at_source,
               tax_at_source_scale, tax_at_source_rate_pct, company_car_purchase_price,
               subsidized_canteen, commute_km_per_day, commute_public_transport_cost_year,
               -- Borne basse large : un contrat sans date d'entrée doit couvrir
               -- toutes les fiches déjà saisies, y compris les plus anciennes.
               COALESCE(started_on, '0001-01-01'),
               ended_on, notes, created_at, updated_at
        FROM employment_contracts;

        DROP TABLE employment_contracts;
        ALTER TABLE employment_contracts_new RENAME TO employment_contracts;

        CREATE INDEX idx_employment_contracts_income ON employment_contracts(income_id);
        -- La recherche « quelle version au jour J » attaque toujours par ce couple.
        CREATE INDEX idx_employment_contracts_period
            ON employment_contracts(income_id, started_on);

        -- Barème d'entreprise des suppléments, attaché à UNE version de
        -- contrat : le tarif du dimanche peut changer avec un avenant, et
        -- l'historique doit pouvoir dire ce qu'il valait en 2019.
        CREATE TABLE salary_supplement_rates (
            id TEXT PRIMARY KEY,
            contract_id TEXT NOT NULL,
            code TEXT NOT NULL,
            label TEXT NOT NULL,
            -- 'week' | 'day' | 'hour' | 'flat'
            unit TEXT NOT NULL DEFAULT 'day',
            amount REAL NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (contract_id) REFERENCES employment_contracts(id) ON DELETE CASCADE,
            UNIQUE (contract_id, code)
        );
        CREATE INDEX idx_supplement_rates_contract ON salary_supplement_rates(contract_id);

        -- Ce qui a réellement été accompli sur un mois donné. Ne porte aucun
        -- calcul de cotisation : le montant, lui, vit dans
        -- `income_receipts.other_gross_amount`, colonne que le moteur sait déjà
        -- soumettre à l'AVS et ranger en rubrique 1 du certificat.
        CREATE TABLE income_receipt_supplements (
            id TEXT PRIMARY KEY,
            receipt_id TEXT NOT NULL,
            code TEXT NOT NULL,
            label TEXT NOT NULL,
            quantity REAL NOT NULL,
            unit_amount REAL NOT NULL,
            amount REAL NOT NULL,
            FOREIGN KEY (receipt_id) REFERENCES income_receipts(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_receipt_supplements_receipt
            ON income_receipt_supplements(receipt_id);

        INSERT INTO schema_version (version) VALUES (32);
        "
    ).map_err(|e| format!("Migration v32 failed: {}", e))?;

    Ok(())
}

/// v33 — le versement qui s'ajoute APRÈS les retenues.
///
/// Un bulletin suisse ne s'arrête pas au total des déductions : viennent
/// ensuite des montants qui rejoignent le net sans passer par les cotisations.
/// Deux d'entre eux existaient déjà, tous deux nommés « frais »
/// (`expense_reimbursement_amount`, `expense_lump_sum_amount`) — or tout ce qui
/// suit la barre des retenues n'est pas un remboursement de frais.
///
/// Faute d'un casier neutre, ces versements finissaient dans une colonne de
/// brut, où ils faisaient gonfler l'assiette AVS d'un montant qui n'y est pas
/// soumis : le contrôle de conformité réclamait alors des cotisations que
/// l'employeur avait eu raison de ne pas prélever.
fn migrate_v33(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        ALTER TABLE income_receipts ADD COLUMN net_addition_amount REAL;

        INSERT INTO schema_version (version) VALUES (33);
        "
    ).map_err(|e| format!("Migration v33 failed: {}", e))?;

    Ok(())
}

/// v34 — le plan de prévoyance de l'entreprise, par tranches d'âge.
///
/// La part employé au 2ᵉ pilier était un scalaire unique. Or aucun plan suisse
/// ne fonctionne comme ça : la cotisation monte par paliers d'âge, et chaque
/// palier a sa répartition entre l'employeur et le salarié — 8 % dont 4 à votre
/// charge entre 18 et 25 ans, 10 % dont 5 ensuite, et rien n'oblige un
/// employeur à s'en tenir à moitié-moitié.
///
/// Avec un taux fixe, le salarié voyait sa retenue projetée figée à vie et
/// devait la corriger à la main le 1ᵉʳ janvier suivant chaque anniversaire de
/// palier — un rendez-vous qu'on manque forcément. Les tranches sont
/// rattachées à une VERSION de contrat, comme le barème de suppléments : un
/// changement de plan se signe par un avenant, et une fiche de 2019 doit
/// rester lue avec le plan de 2019.
///
/// `total_pct` sert au contrôle de l'art. 66 al. 1 LPP : l'employeur doit
/// financer au moins autant que le salarié. Le stocker plutôt que de le
/// déduire évite d'avoir deux vérités sur la part patronale.
fn migrate_v34(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE lpp_plan_brackets (
            id TEXT PRIMARY KEY,
            contract_id TEXT NOT NULL,
            age_from INTEGER NOT NULL,
            age_to INTEGER NOT NULL,
            total_pct REAL NOT NULL,
            employee_pct REAL NOT NULL,
            FOREIGN KEY (contract_id) REFERENCES employment_contracts(id) ON DELETE CASCADE,
            UNIQUE (contract_id, age_from)
        );
        CREATE INDEX idx_lpp_plan_contract
            ON lpp_plan_brackets(contract_id, age_from);

        INSERT INTO schema_version (version) VALUES (34);
        "
    ).map_err(|e| format!("Migration v34 failed: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Replays v1..=v17 on a fresh in-memory DB with foreign keys ON, leaving
    /// the schema in the pre-v18 state (subscriptions still present).
    fn conn_at_v17() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);",
        )
        .unwrap();
        migrate_v1(&conn).unwrap();
        migrate_v2(&conn).unwrap();
        migrate_v3(&conn).unwrap();
        migrate_v4(&conn).unwrap();
        migrate_v5(&conn).unwrap();
        migrate_v6(&conn).unwrap();
        migrate_v7(&conn).unwrap();
        migrate_v8(&conn).unwrap();
        migrate_v9(&conn).unwrap();
        migrate_v10(&conn).unwrap();
        migrate_v11(&conn).unwrap();
        migrate_v12(&conn).unwrap();
        migrate_v13(&conn).unwrap();
        migrate_v14(&conn).unwrap();
        migrate_v15(&conn).unwrap();
        migrate_v16(&conn).unwrap();
        migrate_v17(&conn).unwrap();
        conn
    }

    /// v18 must drop the subscription tables/FTS and the `subscription_id`
    /// column on `attachments`, discard attachments that pointed ONLY at a
    /// subscription, and keep every other attachment intact — even with live
    /// rows present and foreign keys enforced.
    #[test]
    fn v18_purges_subscriptions_but_keeps_other_attachments() {
        let conn = conn_at_v17();

        // An item with its own attachment (must survive).
        conn.execute("INSERT INTO merchants (id, name) VALUES ('m1', 'M')", []).unwrap();
        conn.execute("INSERT INTO locations (id, name) VALUES ('l1', 'L')", []).unwrap();
        conn.execute(
            "INSERT INTO items (id, description, purchase_date, purchase_price, merchant_id, location_id)
             VALUES ('i1', 'x', '2024-01-01', 1.0, 'm1', 'l1')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO attachments (id, item_id, original_name, display_name, mime_type, file_path, size_bytes)
             VALUES ('a_item', 'i1', 'n', 'n', 'x', 'p', 1)",
            [],
        ).unwrap();

        // A subscription with payment + member + a subscription-only attachment
        // (all must disappear).
        conn.execute(
            "INSERT INTO subscriptions (id, name, start_date, next_renewal_date, billing_cycle, price)
             VALUES ('s1', 'Netflix', '2024-01-01', '2024-02-01', 'monthly', 12.0)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO subscription_payments (id, subscription_id, paid_on, amount, currency)
             VALUES ('p1', 's1', '2024-01-01', 12.0, 'CHF')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO subscription_members (id, subscription_id, name) VALUES ('mem1', 's1', 'Alice')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO attachments (id, subscription_id, original_name, display_name, mime_type, file_path, size_bytes)
             VALUES ('a_sub', 's1', 'n', 'n', 'x', 'p', 1)",
            [],
        ).unwrap();

        migrate_v18(&conn).unwrap();

        let tables: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table'
                 AND name IN ('subscriptions','subscription_payments','subscription_members','subscriptions_fts')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 0, "subscription tables/FTS must be gone");

        let col: i64 = conn
            .query_row(
                "SELECT count(*) FROM pragma_table_info('attachments') WHERE name='subscription_id'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(col, 0, "attachments.subscription_id column must be gone");

        let item_att: i64 = conn
            .query_row("SELECT count(*) FROM attachments WHERE id='a_item'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(item_att, 1, "the item attachment must survive");

        let sub_att: i64 = conn
            .query_row("SELECT count(*) FROM attachments WHERE id='a_sub'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sub_att, 0, "the subscription-only attachment must be dropped");

        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 18);
    }

    /// Rejoue toutes les migrations jusqu'à v27 sur une base neuve, clés
    /// étrangères actives — l'état d'un coffre existant avant la v28.
    fn conn_at_v27() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);",
        )
        .unwrap();
        for m in [
            migrate_v1, migrate_v2, migrate_v3, migrate_v4, migrate_v5, migrate_v6,
            migrate_v7, migrate_v8, migrate_v9, migrate_v10, migrate_v11, migrate_v12,
            migrate_v13, migrate_v14, migrate_v15, migrate_v16, migrate_v17, migrate_v18,
            migrate_v19, migrate_v20, migrate_v21, migrate_v22, migrate_v23, migrate_v24,
            migrate_v25, migrate_v26, migrate_v27,
        ] {
            m(&conn).unwrap();
        }
        conn
    }

    /// La v28 ne doit rien casser d'existant : un bulletin saisi avant la
    /// migration garde ses montants, et récupère une année fiscale déduite de
    /// sa date de réception pour entrer dans les agrégations annuelles.
    #[test]
    fn v28_preserves_existing_receipts_and_backfills_the_fiscal_year() {
        let conn = conn_at_v27();

        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire ACME', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO income_receipts (id, income_id, received_on, amount, currency,
                                          gross_amount, social_charges_amount)
             VALUES ('r1', 'inc1', '2025-03-25', 6500.0, 'CHF', 8000.0, 424.0)",
            [],
        )
        .unwrap();

        migrate_v28(&conn).unwrap();

        let (amount, gross, avs, year): (f64, f64, f64, i64) = conn
            .query_row(
                "SELECT amount, gross_amount, social_charges_amount, fiscal_year
                 FROM income_receipts WHERE id = 'r1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(amount, 6500.0);
        assert_eq!(gross, 8000.0, "le brut v10 doit rester intact");
        assert_eq!(avs, 424.0, "social_charges_amount reste l'AVS/AI/APG");
        assert_eq!(year, 2025, "année fiscale déduite de received_on");

        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 28);
    }

    /// Le contrat de travail et le certificat de salaire suivent la
    /// suppression du revenu (CASCADE), comme les versements.
    #[test]
    fn v28_cascades_contract_and_certificate_on_income_delete() {
        let conn = conn_at_v27();
        migrate_v28(&conn).unwrap();

        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire ACME', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO employment_contracts (id, income_id, employer_name)
             VALUES ('c1', 'inc1', 'ACME SA')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO annual_salary_certificates (id, income_id, fiscal_year, r8_gross_total)
             VALUES ('cert1', 'inc1', 2025, 96000.0)",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM incomes WHERE id = 'inc1'", []).unwrap();

        let contracts: i64 = conn
            .query_row("SELECT count(*) FROM employment_contracts", [], |r| r.get(0))
            .unwrap();
        let certs: i64 = conn
            .query_row("SELECT count(*) FROM annual_salary_certificates", [], |r| r.get(0))
            .unwrap();
        assert_eq!(contracts, 0);
        assert_eq!(certs, 0);
    }

    /// Un seul contrat par revenu : deux employeurs = deux revenus.
    #[test]
    fn v28_rejects_a_second_contract_on_the_same_income() {
        let conn = conn_at_v27();
        migrate_v28(&conn).unwrap();

        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO employment_contracts (id, income_id) VALUES ('c1', 'inc1')",
            [],
        )
        .unwrap();
        assert!(
            conn.execute(
                "INSERT INTO employment_contracts (id, income_id) VALUES ('c2', 'inc1')",
                [],
            )
            .is_err()
        );
    }

    /// Un certificat par année et par revenu.
    #[test]
    fn v28_rejects_two_certificates_for_the_same_year() {
        let conn = conn_at_v27();
        migrate_v28(&conn).unwrap();

        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO annual_salary_certificates (id, income_id, fiscal_year)
             VALUES ('cert1', 'inc1', 2025)",
            [],
        )
        .unwrap();
        assert!(
            conn.execute(
                "INSERT INTO annual_salary_certificates (id, income_id, fiscal_year)
                 VALUES ('cert2', 'inc1', 2025)",
                [],
            )
            .is_err()
        );
    }

    /// Le rattachement à un membre du ménage existe en base (sans UI) et
    /// se dénoue proprement quand le membre disparaît.
    #[test]
    fn v28_income_member_link_is_nullable_and_set_null_on_delete() {
        let conn = conn_at_v27();
        migrate_v28(&conn).unwrap();

        conn.execute(
            "INSERT INTO household_members (id, name, relation) VALUES ('m1', 'Moi', 'self')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status,
                                  attributed_to_member_id)
             VALUES ('inc1', 'Salaire', 'salary', 'monthly', 'CHF', 'active', 'm1')",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM household_members WHERE id = 'm1'", []).unwrap();

        let member: Option<String> = conn
            .query_row(
                "SELECT attributed_to_member_id FROM incomes WHERE id = 'inc1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(member.is_none(), "le revenu survit, le lien est dénoué");
    }

    /// État d'un coffre existant juste avant la v29.
    fn conn_at_v28() -> Connection {
        let conn = conn_at_v27();
        migrate_v28(&conn).unwrap();
        conn
    }

    /// La v29 est purement additive : un revenu, son contrat et ses bulletins
    /// saisis avant la migration doivent traverser intacts, et le contrat
    /// gagner une colonne de taux d'impôt à la source vide.
    #[test]
    fn v29_is_additive_and_keeps_existing_rows() {
        let conn = conn_at_v28();

        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status, current_amount)
             VALUES ('inc1', 'Salaire ACME', 'salary', 'monthly', 'CHF', 'active', 7180.58)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO employment_contracts (id, income_id, employer_name, lpp_employee_share_pct)
             VALUES ('c1', 'inc1', 'ACME SA', 3.5)",
            [],
        )
        .unwrap();

        migrate_v29(&conn).unwrap();

        let (amount, lpp, rate): (f64, f64, Option<f64>) = conn
            .query_row(
                "SELECT i.current_amount, c.lpp_employee_share_pct, c.tax_at_source_rate_pct
                 FROM incomes i JOIN employment_contracts c ON c.income_id = i.id
                 WHERE i.id = 'inc1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(amount, 7180.58, "le net déjà enregistré ne bouge pas");
        assert_eq!(lpp, 3.5);
        assert!(rate.is_none(), "la nouvelle colonne naît vide");

        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 29);
    }

    /// Une surcharge de barème est une ligne par année, dont chaque colonne
    /// peut rester NULL — c'est ce NULL qui signifie « garder la valeur
    /// livrée », et il doit donc être accepté partout.
    #[test]
    fn v29_param_override_accepts_partial_rows() {
        let conn = conn_at_v28();
        migrate_v29(&conn).unwrap();

        conn.execute(
            "INSERT INTO payroll_param_overrides (year, ac_ceiling) VALUES (2026, 150000.0)",
            [],
        )
        .unwrap();

        let (ceiling, avs): (f64, Option<f64>) = conn
            .query_row(
                "SELECT ac_ceiling, avs_ai_apg_employee_pct FROM payroll_param_overrides WHERE year = 2026",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(ceiling, 150_000.0);
        assert!(avs.is_none(), "les valeurs non touchées restent NULL");

        // Une seule ligne par année : la surcharge se met à jour, elle ne
        // s'empile pas.
        let dup = conn.execute(
            "INSERT INTO payroll_param_overrides (year, ac_ceiling) VALUES (2026, 1.0)",
            [],
        );
        assert!(dup.is_err(), "year est la clé primaire");
    }

    /// Le même barème ne peut pas être importé deux fois pour un canton et
    /// une année : sinon un double import doublerait chaque tranche.
    #[test]
    fn v29_tax_at_source_tariffs_are_unique_per_bracket() {
        let conn = conn_at_v28();
        migrate_v29(&conn).unwrap();

        conn.execute(
            "INSERT INTO tax_at_source_tariffs
                (canton, tariff_code, valid_from, children, income_from, income_step, tax_amount)
             VALUES ('VD', 'A0N', '2026-01-01', 0, 6000.0, 100.0, 540.0)",
            [],
        )
        .unwrap();

        let dup = conn.execute(
            "INSERT INTO tax_at_source_tariffs
                (canton, tariff_code, valid_from, children, income_from, income_step, tax_amount)
             VALUES ('VD', 'A0N', '2026-01-01', 0, 6000.0, 100.0, 999.0)",
            [],
        );
        assert!(dup.is_err(), "une tranche ne peut pas exister en double");

        conn.execute(
            "INSERT INTO tax_at_source_imports (id, canton, fiscal_year, source_file, row_count)
             VALUES ('imp1', 'VD', 2026, 'tar26vd.txt', 1)",
            [],
        )
        .unwrap();
        let dup_import = conn.execute(
            "INSERT INTO tax_at_source_imports (id, canton, fiscal_year, source_file, row_count)
             VALUES ('imp2', 'VD', 2026, 'tar26vd.txt', 1)",
            [],
        );
        assert!(dup_import.is_err(), "un canton-année ne s'importe qu'une fois");
    }


    /// La v30 n'ajoute qu'un drapeau, et il naît à faux : une année déjà
    /// saisie n'est pas pour autant vérifiée.
    #[test]
    fn v30_adds_an_unconfirmed_flag_to_existing_overrides() {
        let conn = conn_at_v28();
        migrate_v29(&conn).unwrap();
        conn.execute(
            "INSERT INTO payroll_param_overrides (year, ac_ceiling) VALUES (2012, 126000.0)",
            [],
        )
        .unwrap();

        migrate_v30(&conn).unwrap();

        let (ceiling, confirmed): (f64, i64) = conn
            .query_row(
                "SELECT ac_ceiling, confirmed FROM payroll_param_overrides WHERE year = 2012",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(ceiling, 126_000.0, "la saisie existante survit");
        assert_eq!(confirmed, 0, "saisi ne vaut pas vérifié");

        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 30);
    }


    /// La v31 ajoute une table vide : les taux cantonaux changent chaque année
    /// et dépendent de la caisse, les livrer en dur serait livrer des chiffres
    /// non vérifiés.
    #[test]
    fn v31_creates_an_empty_cantonal_table_keyed_by_canton_and_year() {
        let conn = conn_at_v28();
        migrate_v29(&conn).unwrap();
        migrate_v30(&conn).unwrap();
        migrate_v31(&conn).unwrap();

        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM cantonal_payroll_params", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0, "aucun taux n'est livré en dur");

        conn.execute(
            "INSERT INTO cantonal_payroll_params (canton, year, family_allowance_employee_pct)
             VALUES ('VD', 2026, 0.131)",
            [],
        )
        .unwrap();
        // Un canton et une année : une seule ligne, qui se met à jour.
        let dup = conn.execute(
            "INSERT INTO cantonal_payroll_params (canton, year, maternity_employee_pct)
             VALUES ('VD', 2026, 0.05)",
            [],
        );
        assert!(dup.is_err());

        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 31);
    }


    /// État d'un coffre juste avant la v32.
    fn conn_at_v31() -> Connection {
        let conn = conn_at_v28();
        migrate_v29(&conn).unwrap();
        migrate_v30(&conn).unwrap();
        migrate_v31(&conn).unwrap();
        conn
    }

    /// La v32 reconstruit `employment_contracts` : le contrat déjà saisi doit
    /// traverser intact, y compris ses taux, et hériter d'une période de
    /// validité qui couvre les fiches déjà enregistrées.
    #[test]
    fn v32_keeps_the_existing_contract_and_gives_it_a_validity_period() {
        let conn = conn_at_v31();
        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire ACME', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO employment_contracts
                (id, income_id, employer_name, work_canton, annual_gross_agreed,
                 lpp_employee_share_pct, tax_at_source_rate_pct, started_on)
             VALUES ('c1', 'inc1', 'ACME SA', 'GE', 50000.0, 3.5, 12.5, '2018-04-01')",
            [],
        )
        .unwrap();

        migrate_v32(&conn).unwrap();

        let (employer, work, residence, source, gross, lpp, rate, from, scope): (
            String, String, String, String, f64, f64, f64, String, String,
        ) = conn
            .query_row(
                "SELECT employer_name, work_canton, residence_canton,
                        tax_at_source_canton_source, annual_gross_agreed,
                        lpp_employee_share_pct, tax_at_source_rate_pct,
                        started_on, lpp_insured_scope
                 FROM employment_contracts WHERE id = 'c1'",
                [],
                |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                        r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?))
                },
            )
            .unwrap();
        assert_eq!(employer, "ACME SA");
        assert_eq!(gross, 50_000.0);
        assert_eq!(lpp, 3.5);
        assert_eq!(rate, 12.5);
        assert_eq!(work, "GE");
        assert_eq!(residence, "GE", "un seul canton connu : les deux coïncident");
        assert_eq!(source, "residence", "la règle légale par défaut");
        assert_eq!(from, "2018-04-01", "la date d'entrée devient la validité");
        assert_eq!(scope, "total");

        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 32);
    }

    /// Un contrat sans date d'entrée reçoit une borne basse large : sans elle,
    /// les fiches les plus anciennes se retrouveraient sans contrat en vigueur.
    #[test]
    fn v32_gives_an_undated_contract_a_wide_lower_bound() {
        let conn = conn_at_v31();
        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO employment_contracts (id, income_id) VALUES ('c1', 'inc1')",
            [],
        )
        .unwrap();

        migrate_v32(&conn).unwrap();

        let from: String = conn
            .query_row("SELECT started_on FROM employment_contracts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(from, "0001-01-01");
    }

    /// Ce que la v28 interdisait devient possible : deux avenants sur le même
    /// revenu. C'est tout l'objet de la migration.
    #[test]
    fn v32_lets_two_contract_versions_coexist_on_one_income() {
        let conn = conn_at_v31();
        migrate_v32(&conn).unwrap();
        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO employment_contracts (id, income_id, label, annual_gross_agreed,
                                               started_on, ended_on)
             VALUES ('v1', 'inc1', 'Contrat initial', 48000.0, '2018-04-01', '2021-06-30')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO employment_contracts (id, income_id, label, annual_gross_agreed,
                                               started_on)
             VALUES ('v2', 'inc1', 'Avenant 2021', 50000.0, '2021-07-01')",
            [],
        )
        .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM employment_contracts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // La version en vigueur à une date donnée : la requête que le contrôle
        // de bulletin fera.
        let at: String = conn
            .query_row(
                "SELECT id FROM employment_contracts
                 WHERE income_id = 'inc1' AND started_on <= ?1
                   AND (ended_on IS NULL OR ended_on >= ?1)
                 ORDER BY started_on DESC LIMIT 1",
                ["2019-05-31"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(at, "v1", "une fiche de 2019 relève du contrat initial");

        let at: String = conn
            .query_row(
                "SELECT id FROM employment_contracts
                 WHERE income_id = 'inc1' AND started_on <= ?1
                   AND (ended_on IS NULL OR ended_on >= ?1)
                 ORDER BY started_on DESC LIMIT 1",
                ["2021-07-31"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(at, "v2", "et une fiche de juillet 2021 de l'avenant");
    }

    /// Les deux tables de suppléments suivent la suppression de leur parent.
    #[test]
    fn v32_supplements_cascade_from_contract_and_receipt() {
        let conn = conn_at_v31();
        migrate_v32(&conn).unwrap();
        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO employment_contracts (id, income_id, started_on)
             VALUES ('c1', 'inc1', '2020-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO salary_supplement_rates (id, contract_id, code, label, unit, amount)
             VALUES ('s1', 'c1', 'oncall_week', 'Astreinte (semaine)', 'week', 500.0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO income_receipts (id, income_id, received_on, amount, currency)
             VALUES ('r1', 'inc1', '2020-03-25', 4000.0, 'CHF')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO income_receipt_supplements
                (id, receipt_id, code, label, quantity, unit_amount, amount)
             VALUES ('q1', 'r1', 'oncall_week', 'Astreinte (semaine)', 1.0, 500.0, 500.0)",
            [],
        )
        .unwrap();

        // Un même code ne peut pas exister deux fois dans un barème.
        let dup = conn.execute(
            "INSERT INTO salary_supplement_rates (id, contract_id, code, label, unit, amount)
             VALUES ('s2', 'c1', 'oncall_week', 'Doublon', 'week', 600.0)",
            [],
        );
        assert!(dup.is_err());

        conn.execute("DELETE FROM incomes WHERE id = 'inc1'", []).unwrap();
        let rates: i64 = conn
            .query_row("SELECT COUNT(*) FROM salary_supplement_rates", [], |r| r.get(0))
            .unwrap();
        let quantities: i64 = conn
            .query_row("SELECT COUNT(*) FROM income_receipt_supplements", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rates, 0);
        assert_eq!(quantities, 0);
    }
    /// La v33 ajoute le casier des versements qui suivent la barre des
    /// retenues. Une fiche déjà saisie doit le traverser sans rien perdre, et
    /// s'y retrouver à `NULL` — inconnu, pas zéro.
    #[test]
    fn v33_adds_the_after_deductions_slot_without_touching_existing_rows() {
        let conn = conn_at_v31();
        migrate_v32(&conn).unwrap();
        conn.execute(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, currency, status)
             VALUES ('inc1', 'Salaire', 'salary', 'monthly', 'CHF', 'active')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO income_receipts (id, income_id, received_on, amount, currency,
                 expense_reimbursement_amount)
             VALUES ('r1', 'inc1', '2020-03-25', 4000.0, 'CHF', 120.0)",
            [],
        )
        .unwrap();

        migrate_v33(&conn).unwrap();

        let (amount, expenses, addition): (f64, Option<f64>, Option<f64>) = conn
            .query_row(
                "SELECT amount, expense_reimbursement_amount, net_addition_amount
                 FROM income_receipts WHERE id = 'r1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(amount, 4000.0);
        assert_eq!(expenses, Some(120.0), "les frais déjà saisis survivent");
        assert_eq!(addition, None, "inconnu, et surtout pas zéro");

        conn.execute(
            "UPDATE income_receipts SET net_addition_amount = 250.0 WHERE id = 'r1'",
            [],
        )
        .unwrap();
        let stored: Option<f64> = conn
            .query_row(
                "SELECT net_addition_amount FROM income_receipts WHERE id = 'r1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, Some(250.0));
    }
}

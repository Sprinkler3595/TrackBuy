use rusqlite::Connection;

/// Highest schema version this build of TrackBuy knows how to read.
/// Bump in lockstep with the last `migrate_vN` function declared below.
pub const CURRENT_SCHEMA_VERSION: i64 = 15;

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

use rusqlite::Connection;

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

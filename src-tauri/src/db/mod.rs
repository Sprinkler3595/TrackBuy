pub mod migrations;
pub mod models;

use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    /// Open a SQLCipher-encrypted vault DB at vault_dir/vault.db using the given key.
    pub fn open(vault_dir: &Path, key: &[u8; 32]) -> Result<Self, String> {
        let db_path = vault_dir.join("vault.db");

        // Detect legacy format (data.db.enc from pre-SQLCipher build) and refuse
        // to silently overwrite — caller must run the migration explicitly.
        let legacy_path = vault_dir.join("data.db.enc");
        if legacy_path.exists() && !db_path.exists() {
            return Err(
                "Coffre au format obsolète (pré-SQLCipher). Migration manuelle requise."
                    .to_string(),
            );
        }

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // SQLCipher: provide the raw key as a hex blob (skips key derivation,
        // we already did Argon2id on the password).
        let hex_key = hex_encode(key);
        let pragma_key = format!("PRAGMA key = \"x'{}'\";", hex_key);
        conn.execute_batch(&pragma_key)
            .map_err(|e| format!("Failed to set cipher key: {}", e))?;

        // Verify the key is correct by forcing a read of sqlite_master.
        // Wrong key → first SQL call fails with "file is not a database".
        conn.execute_batch("SELECT count(*) FROM sqlite_master;")
            .map_err(|_| "Mot de passe incorrect".to_string())?;

        // Wipe key material from memory after PRAGMA.
        conn.execute_batch("PRAGMA cipher_memory_security = ON;").ok();

        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

        migrations::run(&conn)?;

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    /// Best-effort close: checkpoint WAL so the main file is the source of truth.
    /// With SQLCipher the file is encrypted at rest, so we don't need to re-encrypt.
    pub fn close(&self) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").ok();
        Ok(())
    }
}

impl Drop for Database {
    fn drop(&mut self) {
        self.close().ok();
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{test_key, TempDir};

    #[test]
    fn open_initialise_le_schema_a_la_version_courante() {
        let tmp = TempDir::new();
        let key = test_key();
        let db = Database::open(tmp.path(), &key).unwrap();
        let conn = db.conn.lock().unwrap();
        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, migrations::CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn reouverture_est_idempotente_et_preserve_les_donnees() {
        let tmp = TempDir::new();
        let key = test_key();
        {
            let db = Database::open(tmp.path(), &key).unwrap();
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO merchants (id, name) VALUES ('m1', 'Migros')",
                [],
            )
            .unwrap();
        } // fermeture (checkpoint WAL via Drop)

        // Réouverture : les migrations ne doivent rien casser ni rejouer.
        let db = Database::open(tmp.path(), &key).unwrap();
        let conn = db.conn.lock().unwrap();
        let name: String = conn
            .query_row("SELECT name FROM merchants WHERE id = 'm1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(name, "Migros");
        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, migrations::CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn ouverture_avec_mauvaise_cle_echoue() {
        let tmp = TempDir::new();
        let key = test_key();
        {
            let _db = Database::open(tmp.path(), &key).unwrap();
        }
        let mut wrong = *key;
        wrong[0] ^= 0xff;
        // `Database` n'implémente pas Debug, donc pas de `unwrap_err()` :
        // on inspecte le Result à la main.
        let err = match Database::open(tmp.path(), &wrong) {
            Ok(_) => panic!("ouverture avec mauvaise clé aurait dû échouer"),
            Err(e) => e,
        };
        assert!(
            err.contains("Mot de passe incorrect"),
            "erreur inattendue: {err}"
        );
    }
}

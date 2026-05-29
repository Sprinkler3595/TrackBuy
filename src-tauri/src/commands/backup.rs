use chrono::Local;
use std::io::{Read, Write};
use std::path::{Component, Path};
use tauri::{AppHandle, Emitter, State};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::commands::auth::{get_vaults_dir, AppState};
use crate::util::path::{validate_read_source, validate_write_target};

/// Highest backup format this build knows how to restore.
/// Bump together with any breaking change to manifest.json or the archive
/// layout. Future-version backups are refused with a clear message.
pub const CURRENT_BACKUP_FORMAT_VERSION: i64 = 1;

/// Reject zip entries that aren't a single normal path component sequence —
/// catches `..`, `..\`, absolute Linux paths (`/etc/...`), absolute Windows
/// paths (`C:\...`) and NUL bytes. Stricter than the original substring check
/// which let backslash-based escapes through on Windows.
fn is_safe_zip_entry(entry_name: &str) -> bool {
    if entry_name.is_empty() || entry_name.contains('\0') {
        return false;
    }
    Path::new(entry_name)
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
}

/// Create an encrypted backup of the active vault.
///
/// The backup is a ZIP archive containing the SQLCipher-encrypted vault file,
/// the salt, and all already-encrypted attachments. No plaintext leaves the
/// app: every entry is restored as-is and only decryptable with the master
/// password.
#[tauri::command]
pub fn backup_vault(state: State<'_, AppState>, destination: String) -> Result<String, String> {
    // Snapshot what we need from the locked state, then drop the guards
    // BEFORE the long zip loop — otherwise every other command (idle lock,
    // UI refresh, manual lock) blocks for the entire backup duration.
    let vault_dir = {
        let guard = state
            .vault_dir
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        guard.as_ref().ok_or("No active vault")?.clone()
    };

    {
        let db_guard = state
            .db
            .lock()
            .map_err(|_| "lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
        let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
        // Checkpoint WAL so the main vault.db file contains everything.
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").ok();
    }

    let vault_name = vault_dir
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Resolve destination. The frontend passes a file path from the save()
    // dialog; if the user picked a directory, build a default filename inside.
    let dest = std::path::Path::new(&destination);
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let default_name = format!("trackbuy_{}_{}.tbvbak", vault_name, timestamp);
    let final_raw = if dest.is_dir() {
        dest.join(&default_name).to_string_lossy().to_string()
    } else {
        destination
    };
    let final_path = validate_write_target(&final_raw)?;

    write_vault_archive(&vault_dir, &vault_name, &final_path)?;
    Ok(final_path.to_string_lossy().to_string())
}

/// Écrit l'archive `.tbvbak` (manifest + vault.db chiffré + salt + params +
/// pièces jointes déjà chiffrées). Extrait de `backup_vault` pour être
/// testable sans `State`. N'altère rien sur le disque hors de `final_path`.
fn write_vault_archive(
    vault_dir: &Path,
    vault_name: &str,
    final_path: &Path,
) -> Result<(), String> {
    let file = std::fs::File::create(final_path)
        .map_err(|e| format!("Failed to create backup file: {}", e))?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    // Manifest first
    let manifest = serde_json::json!({
        "format": "tbvbak",
        "format_version": CURRENT_BACKUP_FORMAT_VERSION,
        "vault_name": vault_name,
        "created_at": Local::now().to_rfc3339(),
    });
    zip.start_file("manifest.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(manifest.to_string().as_bytes())
        .map_err(|e| e.to_string())?;

    // vault.db (SQLCipher-encrypted)
    add_file_to_zip(&mut zip, vault_dir.join("vault.db"), "vault.db", opts)?;

    // salt.bin (required for password derivation on restore)
    add_file_to_zip(&mut zip, vault_dir.join("salt.bin"), "salt.bin", opts)?;

    // argon2_params.json (key-derivation parameters). Without it the restored
    // vault falls back to legacy defaults and unlock fails if the original
    // vault used different params.
    add_file_to_zip(
        &mut zip,
        vault_dir.join("argon2_params.json"),
        "argon2_params.json",
        opts,
    )?;

    // Attachments: every file in files/ is already encrypted with ChaCha20-Poly1305
    let files_dir = vault_dir.join("files");
    if files_dir.is_dir() {
        for entry in std::fs::read_dir(&files_dir)
            .map_err(|e| format!("Failed to read attachments dir: {}", e))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                add_file_to_zip(&mut zip, path, &format!("files/{}", name), opts)?;
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Inspect a `.tbvbak` file: returns the vault name stored in its manifest
/// (and whether a vault with that name already exists locally). Lets the
/// frontend warn the user before overwriting.
#[tauri::command]
pub fn inspect_backup(app: AppHandle, source: String) -> Result<serde_json::Value, String> {
    let safe_source = validate_read_source(&source)?;
    let file = std::fs::File::open(&safe_source)
        .map_err(|e| format!("Failed to open backup: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid backup file: {}", e))?;

    let mut manifest_str = String::new();
    archive
        .by_name("manifest.json")
        .map_err(|_| "Not a TrackBuy backup (missing manifest.json)".to_string())?
        .read_to_string(&mut manifest_str)
        .map_err(|e| e.to_string())?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| format!("Invalid manifest: {}", e))?;

    let format = manifest.get("format").and_then(|v| v.as_str()).unwrap_or("");
    if format != "tbvbak" {
        return Err("Format de sauvegarde inconnu".to_string());
    }
    let format_version = manifest
        .get("format_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if format_version > CURRENT_BACKUP_FORMAT_VERSION {
        return Err(format!(
            "Cette sauvegarde a été créée par une version plus récente de TrackBuy (format v{}, cette version supporte jusqu'à v{}). Mettez à jour l'application pour pouvoir la lire.",
            format_version, CURRENT_BACKUP_FORMAT_VERSION
        ));
    }
    let vault_name = manifest
        .get("vault_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let created_at = manifest
        .get("created_at")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let exists = !vault_name.is_empty()
        && get_vaults_dir(&app)?
            .join(&vault_name)
            .join("vault.db")
            .exists();

    Ok(serde_json::json!({
        "vault_name": vault_name,
        "created_at": created_at,
        "format_version": manifest.get("format_version").and_then(|v| v.as_i64()).unwrap_or(0),
        "exists_locally": exists,
    }))
}

/// Restore a `.tbvbak` backup into a vault folder.
///
/// - `target_name` lets the user pick a different vault name than the one
///   stored in the manifest (useful to test a backup without nuking the active
///   vault).
/// - `overwrite` MUST be true to replace an existing vault — otherwise the call
///   refuses, protecting the user from accidental data loss.
///
/// After restore, the user unlocks via the normal flow with their original
/// master password. Nothing is decrypted during restore: every byte stays
/// encrypted on disk.
#[tauri::command]
pub fn restore_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    source: String,
    target_name: Option<String>,
    overwrite: bool,
) -> Result<String, String> {
    let safe_source = validate_read_source(&source)?;
    let file = std::fs::File::open(&safe_source)
        .map_err(|e| format!("Failed to open backup: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid backup file: {}", e))?;

    // Read manifest to determine default target name
    let mut manifest_str = String::new();
    archive
        .by_name("manifest.json")
        .map_err(|_| "Not a TrackBuy backup".to_string())?
        .read_to_string(&mut manifest_str)
        .map_err(|e| e.to_string())?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| format!("Invalid manifest: {}", e))?;
    let format = manifest.get("format").and_then(|v| v.as_str()).unwrap_or("");
    if format != "tbvbak" {
        return Err("Format de sauvegarde inconnu".to_string());
    }
    let format_version = manifest
        .get("format_version")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    if format_version > CURRENT_BACKUP_FORMAT_VERSION {
        return Err(format!(
            "Cette sauvegarde a été créée par une version plus récente de TrackBuy (format v{}, cette version supporte jusqu'à v{}). Mettez à jour l'application avant de la restaurer.",
            format_version, CURRENT_BACKUP_FORMAT_VERSION
        ));
    }
    let manifest_name = manifest
        .get("vault_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let name = target_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(manifest_name);
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || name.starts_with('.')
    {
        return Err("Nom de coffre invalide".to_string());
    }

    let target_dir = get_vaults_dir(&app)?.join(&name);

    // Refuse to clobber unless the user explicitly opted in.
    let already_exists = target_dir.join("vault.db").exists() || target_dir.join("salt.bin").exists();
    if already_exists && !overwrite {
        return Err(format!(
            "Le coffre « {} » existe déjà. Choisis un autre nom ou confirme l'écrasement.",
            name
        ));
    }

    // If we're about to overwrite the currently-active vault, lock it first to
    // release the SQLCipher file handle.
    let mut overwrote_active = false;
    if already_exists {
        let active = state
            .vault_dir
            .lock()
            .map_err(|_| "lock poisoned".to_string())?
            .clone();
        if let Some(active_dir) = active {
            if active_dir == target_dir {
                *state.db.lock().map_err(|_| "lock poisoned".to_string())? = None;
                *state.vault_dir.lock().map_err(|_| "lock poisoned".to_string())? = None;
                *state
                    .encryption_key
                    .lock()
                    .map_err(|_| "lock poisoned".to_string())? = None;
                overwrote_active = true;
            }
        }
        // Clean previous content to avoid mixing old + new attachments.
        std::fs::remove_dir_all(&target_dir).ok();
    }

    extract_vault_archive(&mut archive, &target_dir)?;

    // Tell the frontend it must drop its "unlocked" state if we just nuked
    // the active vault — otherwise it will keep firing IPC against a closed
    // vault and surface confusing "Vault not unlocked" errors everywhere.
    if overwrote_active {
        let _ = app.emit("vault-locked", "restore-overwrite");
    }

    Ok(name)
}

fn add_file_to_zip(
    zip: &mut ZipWriter<std::fs::File>,
    source: std::path::PathBuf,
    archive_name: &str,
    opts: SimpleFileOptions,
) -> Result<(), String> {
    if !source.exists() {
        return Ok(()); // best-effort: skip missing optional files
    }
    zip.start_file(archive_name, opts)
        .map_err(|e| e.to_string())?;
    let mut f = std::fs::File::open(&source)
        .map_err(|e| format!("Failed to open {}: {}", source.display(), e))?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        zip.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Extrait les entrées connues d'une archive `.tbvbak` dans `target_dir`
/// (vault.db, salt.bin, argon2_params.json, files/*), en rejetant toute entrée
/// qui tenterait de sortir du dossier cible. Extrait de `restore_backup` pour
/// être testable. Retourne le nombre d'entrées écrites.
fn extract_vault_archive(
    archive: &mut ZipArchive<std::fs::File>,
    target_dir: &Path,
) -> Result<usize, String> {
    std::fs::create_dir_all(target_dir.join("files"))
        .map_err(|e| format!("Failed to create vault dir: {}", e))?;

    let mut entries_extracted: usize = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let entry_name = entry.name().to_string();

        // Reject anything that tries to escape the target dir. Stricter than
        // a substring check so `..\`, `C:\…`, and NUL bytes are caught too.
        if !is_safe_zip_entry(&entry_name) {
            return Err(format!("Entrée d'archive suspecte: {}", entry_name));
        }
        // Only allow our known entries
        let is_known = entry_name == "manifest.json"
            || entry_name == "vault.db"
            || entry_name == "salt.bin"
            || entry_name == "argon2_params.json"
            || entry_name.starts_with("files/");
        if !is_known {
            continue;
        }
        // Skip directory entries (their names end with /)
        if entry_name.ends_with('/') {
            continue;
        }
        if entry_name == "manifest.json" {
            continue; // not written into the vault dir
        }

        let dest_path = target_dir.join(&entry_name);
        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&dest_path)
            .map_err(|e| format!("Failed to write {}: {}", entry_name, e))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        entries_extracted += 1;
    }

    if entries_extracted == 0 {
        return Err("Sauvegarde vide ou corrompue".to_string());
    }
    Ok(entries_extracted)
}

#[tauri::command]
pub fn export_items_csv(state: State<'_, AppState>) -> Result<String, String> {
    let db_guard = state
        .db
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT i.description, i.purchase_date, i.purchase_price, i.currency, i.status,
                    m.name, l.name, pc.name, i.notes,
                    i.invoice_number, i.product_reference, i.quantity, i.price_excl_tax, i.tax_rate
             FROM items i
             LEFT JOIN merchants m ON i.merchant_id = m.id
             LEFT JOIN locations l ON i.location_id = l.id
             LEFT JOIN payment_cards pc ON i.payment_card_id = pc.id
             ORDER BY i.purchase_date DESC",
        )
        .map_err(|e| e.to_string())?;

    let mut csv = String::from("Description,Date d'achat,Prix,Devise,Statut,Marchand,Lieu,Carte,Notes,N° facture,Réf. produit,Quantité,Prix HT,Taux TVA\n");

    let rows = stmt
        .query_map([], |row| {
            let desc: String = row.get(0)?;
            let date: String = row.get(1)?;
            let price: f64 = row.get(2)?;
            let currency: String = row.get(3)?;
            let status: String = row.get(4)?;
            let merchant: Option<String> = row.get(5)?;
            let location: Option<String> = row.get(6)?;
            let card: Option<String> = row.get(7)?;
            let notes: Option<String> = row.get(8)?;
            let invoice_number: Option<String> = row.get(9)?;
            let product_reference: Option<String> = row.get(10)?;
            let quantity: Option<i32> = row.get(11)?;
            let price_excl_tax: Option<f64> = row.get(12)?;
            let tax_rate: Option<f64> = row.get(13)?;
            Ok((desc, date, price, currency, status, merchant, location, card, notes,
                invoice_number, product_reference, quantity, price_excl_tax, tax_rate))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (desc, date, price, currency, status, merchant, location, card, notes,
             invoice_number, product_reference, quantity, price_excl_tax, tax_rate) =
            row.map_err(|e| e.to_string())?;
        csv.push_str(&format!(
            "{},{},{:.2},{},{},{},{},{},{},{},{},{},{},{}\n",
            escape_csv(&desc),
            date,
            price,
            currency,
            status,
            escape_csv(&merchant.unwrap_or_default()),
            escape_csv(&location.unwrap_or_default()),
            escape_csv(&card.unwrap_or_default()),
            escape_csv(&notes.unwrap_or_default()),
            escape_csv(&invoice_number.unwrap_or_default()),
            escape_csv(&product_reference.unwrap_or_default()),
            quantity.unwrap_or(1),
            price_excl_tax.map(|p| format!("{:.2}", p)).unwrap_or_default(),
            tax_rate.map(|r| format!("{:.2}", r)).unwrap_or_default(),
        ));
    }

    Ok(csv)
}

/// CSV export of engagements with their cumulative paid amount. A single
/// flat file is easier to open in Excel/Numbers than two related tables.
#[tauri::command]
pub fn export_engagements_csv(state: State<'_, AppState>) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT e.name, e.engagement_type, cr.name, e.contract_reference,
                    e.billing_cycle, e.cycle_interval, e.current_amount, e.currency,
                    e.status, e.next_due_date, e.contract_start_date, e.contract_end_date,
                    e.payment_method, e.auto_pay, p.name as parent_name,
                    (SELECT COALESCE(SUM(amount), 0) FROM engagement_charges
                     WHERE engagement_id = e.id AND status = 'paid') as total_paid,
                    e.notes
             FROM engagements e
             LEFT JOIN creditors cr ON e.creditor_id = cr.id
             LEFT JOIN engagements p ON e.parent_engagement_id = p.id
             ORDER BY e.name",
        )
        .map_err(|e| e.to_string())?;

    let mut csv = String::from(
        "Nom,Type,Créancier,N° contrat,Périodicité,Intervalle,Montant courant,Devise,\
         Statut,Prochaine échéance,Début contrat,Fin contrat,Mode de paiement,Auto-paiement,\
         Parent,Total payé,Notes\n",
    );

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i32>(5)?,
                row.get::<_, Option<f64>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, bool>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, f64>(15)?,
                row.get::<_, Option<String>>(16)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (name, typ, creditor, contract_ref, cycle, interval, current_amount, currency,
             status, next_due, start_date, end_date, payment_method, auto_pay, parent,
             total_paid, notes) = row.map_err(|e| e.to_string())?;
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{:.2},{}\n",
            escape_csv(&name),
            typ,
            escape_csv(&creditor.unwrap_or_default()),
            escape_csv(&contract_ref.unwrap_or_default()),
            cycle, interval,
            current_amount.map(|a| format!("{:.2}", a)).unwrap_or_default(),
            currency, status,
            next_due.unwrap_or_default(),
            start_date.unwrap_or_default(),
            end_date.unwrap_or_default(),
            payment_method.unwrap_or_default(),
            if auto_pay { "oui" } else { "non" },
            escape_csv(&parent.unwrap_or_default()),
            total_paid,
            escape_csv(&notes.unwrap_or_default()),
        ));
    }

    Ok(csv)
}

/// Full charges history across all engagements, sorted chronologically.
/// Useful to reconcile against bank exports outside the app.
#[tauri::command]
pub fn export_engagement_charges_csv(state: State<'_, AppState>) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT c.due_date, e.name, e.engagement_type, c.amount, c.currency,
                    c.status, c.paid_on, c.reference_number, c.invoice_number,
                    c.quantity, c.unit, c.unit_price, c.notes
             FROM engagement_charges c
             JOIN engagements e ON c.engagement_id = e.id
             ORDER BY c.due_date DESC",
        )
        .map_err(|e| e.to_string())?;

    let mut csv = String::from(
        "Échéance,Engagement,Type,Montant,Devise,Statut,Payée le,Référence BVR,\
         N° facture,Quantité,Unité,Prix unitaire,Notes\n",
    );

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<f64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<f64>>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (due_date, name, typ, amount, currency, status, paid_on, ref_num, invoice,
             qty, unit, unit_price, notes) = row.map_err(|e| e.to_string())?;
        csv.push_str(&format!(
            "{},{},{},{:.2},{},{},{},{},{},{},{},{},{}\n",
            due_date,
            escape_csv(&name),
            typ, amount, currency, status,
            paid_on.unwrap_or_default(),
            escape_csv(&ref_num.unwrap_or_default()),
            escape_csv(&invoice.unwrap_or_default()),
            qty.map(|q| format!("{:.3}", q)).unwrap_or_default(),
            unit.unwrap_or_default(),
            unit_price.map(|p| format!("{:.4}", p)).unwrap_or_default(),
            escape_csv(&notes.unwrap_or_default()),
        ));
    }

    Ok(csv)
}

/// Incomes: header + cumulative received per income. Payslip breakdown
/// lives in the separate receipts export to keep the table width sane.
#[tauri::command]
pub fn export_incomes_csv(state: State<'_, AppState>) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT i.name, i.income_type, i.source_name, i.billing_cycle, i.cycle_interval,
                    i.current_amount, i.currency, i.status, i.next_expected_date,
                    i.started_on, i.ended_on,
                    (SELECT COALESCE(SUM(amount), 0) FROM income_receipts WHERE income_id = i.id) as total_received,
                    (SELECT COUNT(*) FROM income_receipts WHERE income_id = i.id) as receipt_count,
                    i.notes
             FROM incomes i
             ORDER BY i.name",
        )
        .map_err(|e| e.to_string())?;

    let mut csv = String::from(
        "Nom,Type,Source,Périodicité,Intervalle,Montant courant,Devise,Statut,\
         Prochain versement,Début,Fin,Total reçu,Nb versements,Notes\n",
    );

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i32>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, f64>(11)?,
                row.get::<_, i64>(12)?,
                row.get::<_, Option<String>>(13)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (name, typ, source, cycle, interval, current_amount, currency, status,
             next_expected, started, ended, total, count, notes) =
            row.map_err(|e| e.to_string())?;
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{},{:.2},{},{}\n",
            escape_csv(&name), typ,
            escape_csv(&source.unwrap_or_default()),
            cycle, interval,
            current_amount.map(|a| format!("{:.2}", a)).unwrap_or_default(),
            currency, status,
            next_expected.unwrap_or_default(),
            started.unwrap_or_default(),
            ended.unwrap_or_default(),
            total, count,
            escape_csv(&notes.unwrap_or_default()),
        ));
    }

    Ok(csv)
}

/// Detailed income receipts with full payslip breakdown — useful for
/// year-end fiscal review and cross-checking employer summaries.
#[tauri::command]
pub fn export_income_receipts_csv(state: State<'_, AppState>) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT r.received_on, i.name, i.income_type, r.period_label,
                    r.amount, r.currency, r.gross_amount, r.social_charges_amount,
                    r.pension_amount, r.tax_at_source_amount, r.other_deductions_amount,
                    r.bonus_amount, r.notes
             FROM income_receipts r
             JOIN incomes i ON r.income_id = i.id
             ORDER BY r.received_on DESC",
        )
        .map_err(|e| e.to_string())?;

    let mut csv = String::from(
        "Reçu le,Revenu,Type,Période,Net,Devise,Brut,AVS/AI,2e pilier,Impôt source,\
         Autres retenues,Bonus,Notes\n",
    );

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<f64>>(6)?,
                row.get::<_, Option<f64>>(7)?,
                row.get::<_, Option<f64>>(8)?,
                row.get::<_, Option<f64>>(9)?,
                row.get::<_, Option<f64>>(10)?,
                row.get::<_, Option<f64>>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let fmt_opt = |v: Option<f64>| v.map(|x| format!("{:.2}", x)).unwrap_or_default();

    for row in rows {
        let (received_on, name, typ, period, amount, currency, gross, social, pension,
             tax_source, other, bonus, notes) = row.map_err(|e| e.to_string())?;
        csv.push_str(&format!(
            "{},{},{},{},{:.2},{},{},{},{},{},{},{},{}\n",
            received_on,
            escape_csv(&name), typ,
            escape_csv(&period.unwrap_or_default()),
            amount, currency,
            fmt_opt(gross), fmt_opt(social), fmt_opt(pension),
            fmt_opt(tax_source), fmt_opt(other), fmt_opt(bonus),
            escape_csv(&notes.unwrap_or_default()),
        ));
    }

    Ok(csv)
}

#[tauri::command]
pub fn export_reimbursements_csv(state: State<'_, AppState>) -> Result<String, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT r.label, r.reimbursement_type, r.status, r.expected_amount,
                    r.received_amount, r.currency,
                    COALESCE(cr.name, r.debtor_name) as debtor,
                    i.description as linked_item, r.source_description,
                    r.requested_on, r.expected_by, r.received_on, r.notes
             FROM pending_reimbursements r
             LEFT JOIN creditors cr ON r.debtor_creditor_id = cr.id
             LEFT JOIN items i ON r.item_id = i.id
             ORDER BY r.created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let mut csv = String::from(
        "Intitulé,Type,Statut,Montant attendu,Montant reçu,Devise,Débiteur,\
         Achat lié,Description source,Demandé le,Attendu pour,Reçu le,Notes\n",
    );

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<f64>>(3)?,
                row.get::<_, Option<f64>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let fmt_opt = |v: Option<f64>| v.map(|x| format!("{:.2}", x)).unwrap_or_default();

    for row in rows {
        let (label, typ, status, expected, received, currency, debtor, linked_item,
             source_desc, requested, expected_by, received_on, notes) =
            row.map_err(|e| e.to_string())?;
        csv.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
            escape_csv(&label), typ, status,
            fmt_opt(expected), fmt_opt(received), currency,
            escape_csv(&debtor.unwrap_or_default()),
            escape_csv(&linked_item.unwrap_or_default()),
            escape_csv(&source_desc.unwrap_or_default()),
            requested.unwrap_or_default(),
            expected_by.unwrap_or_default(),
            received_on.unwrap_or_default(),
            escape_csv(&notes.unwrap_or_default()),
        ));
    }

    Ok(csv)
}

#[tauri::command]
pub fn get_stats(
    state: State<'_, AppState>,
    months: Option<i32>,
    currency: Option<String>,
) -> Result<serde_json::Value, String> {
    let db_guard = state
        .db
        .lock()
        .map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // Clamp to a sensible range so a malicious caller can't force a year-long
    // scan of every table on every dashboard load. 24 months covers YoY
    // comparison, which is the heaviest the analytics page asks for.
    let months = months.unwrap_or(12).clamp(1, 24);

    // All monetary aggregates are scoped to one currency. Mixing CHF+EUR+USD
    // in a single SUM produces a number with no unit; the UI surfaces the
    // currency it asked for so the user knows what the totals represent.
    let currency = currency
        .map(|c| c.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| "CHF".to_string());

    let total_items: i64 = conn
        .query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))
        .unwrap_or(0);

    let active_items: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM items WHERE status = 'active'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let total_value: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(purchase_price), 0) FROM items
             WHERE status = 'active' AND currency = ?1",
            [&currency],
            |r| r.get(0),
        )
        .unwrap_or(0.0);

    let total_merchants: i64 = conn
        .query_row("SELECT COUNT(*) FROM merchants", [], |r| r.get(0))
        .unwrap_or(0);

    let total_warranties: i64 = conn
        .query_row("SELECT COUNT(*) FROM warranties", [], |r| r.get(0))
        .unwrap_or(0);

    let total_attachments: i64 = conn
        .query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0))
        .unwrap_or(0);

    let cutoff = format!("-{} months", months);

    // -------- Per-month aggregates (timeline charts) --------

    let monthly_items: Vec<serde_json::Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT strftime('%Y-%m', purchase_date) as month, SUM(purchase_price) as total
                 FROM items
                 WHERE date(purchase_date) >= date('now', ?1) AND currency = ?2
                 GROUP BY month ORDER BY month",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&cutoff, &currency], |row| {
            let month: String = row.get(0)?;
            let total: f64 = row.get(1)?;
            Ok(serde_json::json!({"month": month, "total": total}))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    let monthly_engagements: Vec<serde_json::Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT strftime('%Y-%m', due_date) as month, SUM(amount) as total
                 FROM engagement_charges
                 WHERE date(due_date) >= date('now', ?1) AND currency = ?2
                 GROUP BY month ORDER BY month",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&cutoff, &currency], |row| {
            let month: String = row.get(0)?;
            let total: f64 = row.get(1)?;
            Ok(serde_json::json!({"month": month, "total": total}))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    let monthly_subscriptions: Vec<serde_json::Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT strftime('%Y-%m', paid_on) as month, SUM(amount) as total
                 FROM subscription_payments
                 WHERE date(paid_on) >= date('now', ?1) AND currency = ?2
                 GROUP BY month ORDER BY month",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&cutoff, &currency], |row| {
            let month: String = row.get(0)?;
            let total: f64 = row.get(1)?;
            Ok(serde_json::json!({"month": month, "total": total}))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    let monthly_incomes: Vec<serde_json::Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT strftime('%Y-%m', received_on) as month, SUM(amount) as total
                 FROM income_receipts
                 WHERE date(received_on) >= date('now', ?1) AND currency = ?2
                 GROUP BY month ORDER BY month",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&cutoff, &currency], |row| {
            let month: String = row.get(0)?;
            let total: f64 = row.get(1)?;
            Ok(serde_json::json!({"month": month, "total": total}))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    // -------- Breakdown by category --------

    let engagements_by_type: Vec<serde_json::Value> = {
        // Use the snapshot in engagement_charges so the breakdown reflects
        // what was actually paid in the window — not the contractual
        // current_amount on the parent, which can include suspended rows.
        let mut stmt = conn
            .prepare(
                "SELECT e.engagement_type, SUM(c.amount) as total, COUNT(*) as count
                 FROM engagement_charges c
                 JOIN engagements e ON c.engagement_id = e.id
                 WHERE date(c.due_date) >= date('now', ?1) AND c.currency = ?2
                 GROUP BY e.engagement_type
                 ORDER BY total DESC",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&cutoff, &currency], |row| {
            let typ: String = row.get(0)?;
            let total: f64 = row.get(1)?;
            let count: i64 = row.get(2)?;
            Ok(serde_json::json!({"type": typ, "total": total, "count": count}))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    let incomes_by_type: Vec<serde_json::Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT i.income_type, SUM(r.amount) as total, COUNT(*) as count
                 FROM income_receipts r
                 JOIN incomes i ON r.income_id = i.id
                 WHERE date(r.received_on) >= date('now', ?1) AND r.currency = ?2
                 GROUP BY i.income_type
                 ORDER BY total DESC",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&cutoff, &currency], |row| {
            let typ: String = row.get(0)?;
            let total: f64 = row.get(1)?;
            let count: i64 = row.get(2)?;
            Ok(serde_json::json!({"type": typ, "total": total, "count": count}))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    // -------- Top creditors (where the money goes) --------

    let top_creditors: Vec<serde_json::Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT cr.name, SUM(c.amount) as total
                 FROM engagement_charges c
                 JOIN engagements e ON c.engagement_id = e.id
                 JOIN creditors cr ON e.creditor_id = cr.id
                 WHERE date(c.due_date) >= date('now', ?1) AND c.currency = ?2
                 GROUP BY cr.id
                 ORDER BY total DESC
                 LIMIT 8",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_map(rusqlite::params![&cutoff, &currency], |row| {
            let name: String = row.get(0)?;
            let total: f64 = row.get(1)?;
            Ok(serde_json::json!({"name": name, "total": total}))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect()
    };

    // -------- Year-over-year by engagement (price evolution) --------
    // For each engagement, sum per calendar year over the requested window.
    // Useful for "ma prime d'assurance qui passe de 280 à 305 CHF/mois" once
    // there are enough months of data.
    let yoy_by_engagement: Vec<serde_json::Value> = {
        let mut stmt = conn
            .prepare(
                "SELECT e.id, e.name, strftime('%Y', c.due_date) as year,
                        SUM(c.amount) as total, COUNT(*) as months
                 FROM engagement_charges c
                 JOIN engagements e ON c.engagement_id = e.id
                 WHERE date(c.due_date) >= date('now', ?1) AND c.currency = ?2
                 GROUP BY e.id, year
                 ORDER BY e.name, year",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<(String, String, String, f64, i64)> = stmt
            .query_map(rusqlite::params![&cutoff, &currency], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, f64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        // Group flat rows into { engagement_id, name, series: [{year, total, months}] }.
        use std::collections::BTreeMap;
        let mut by_engagement: BTreeMap<String, (String, Vec<serde_json::Value>)> = BTreeMap::new();
        for (id, name, year, total, mths) in rows {
            let entry = by_engagement.entry(id).or_insert_with(|| (name, Vec::new()));
            entry.1.push(serde_json::json!({"year": year, "total": total, "months": mths}));
        }
        by_engagement
            .into_iter()
            .map(|(id, (name, series))| {
                serde_json::json!({"engagement_id": id, "name": name, "series": series})
            })
            .collect()
    };

    Ok(serde_json::json!({
        "total_items": total_items,
        "active_items": active_items,
        "total_value": total_value,
        "total_merchants": total_merchants,
        "total_warranties": total_warranties,
        "total_attachments": total_attachments,
        // Kept under the historical name for backward-compatibility with the
        // existing dashboard widget.
        "monthly_spending": monthly_items,
        "monthly_engagements": monthly_engagements,
        "monthly_subscriptions": monthly_subscriptions,
        "monthly_incomes": monthly_incomes,
        "engagements_by_type": engagements_by_type,
        "incomes_by_type": incomes_by_type,
        "top_creditors": top_creditors,
        "yoy_by_engagement": yoy_by_engagement,
        "window_months": months,
        "display_currency": currency,
    }))
}

fn escape_csv(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::storage;
    use crate::util::test_support::{test_key, TempDir};
    use zip::ZipArchive;

    /// Round-trip complet : on construit un coffre (db chiffrée + salt + params
    /// + pièce jointe chiffrée), on écrit l'archive `.tbvbak`, on l'extrait dans
    /// un autre dossier, puis on rouvre la base et on relit la pièce jointe.
    #[test]
    fn backup_puis_restore_round_trip() {
        let src = TempDir::new();
        let key = test_key();

        // 1. Coffre source : base SQLCipher + une ligne, salt/params, 1 PJ chiffrée.
        {
            let db = Database::open(src.path(), &key).unwrap();
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO merchants (id, name) VALUES ('m1', 'Migros')",
                [],
            )
            .unwrap();
        }
        std::fs::write(src.path().join("salt.bin"), [9u8; 16]).unwrap();
        std::fs::write(src.path().join("argon2_params.json"), b"{\"x\":1}").unwrap();
        let att = b"contenu chiffre de la facture";
        let stored = storage::save_attachment(src.path(), "att-1", att, &key).unwrap();

        // 2. Écriture de l'archive.
        let backup_dir = TempDir::new();
        let backup_path = backup_dir.path().join("coffre.tbvbak");
        write_vault_archive(src.path(), "Maison", &backup_path).unwrap();
        assert!(backup_path.exists());

        // 3. Extraction dans un coffre cible vierge.
        let dst = TempDir::new();
        let file = std::fs::File::open(&backup_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let n = extract_vault_archive(&mut archive, dst.path()).unwrap();
        assert!(n >= 4, "manifest exclu, mais db+salt+params+1 PJ attendus");

        // salt et params restaurés à l'identique.
        assert_eq!(std::fs::read(dst.path().join("salt.bin")).unwrap(), [9u8; 16]);

        // 4. Réouverture avec la même clé + relecture de la donnée et de la PJ.
        let db = Database::open(dst.path(), &key).unwrap();
        let conn = db.conn.lock().unwrap();
        let name: String = conn
            .query_row("SELECT name FROM merchants WHERE id='m1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Migros");

        let restored_path = storage::attachments_dir(dst.path()).join(&stored);
        let decrypted = storage::read_attachment(restored_path.to_str().unwrap(), &key).unwrap();
        assert_eq!(decrypted, att);
    }

    #[test]
    fn extract_rejette_archive_avec_chemin_traversant() {
        // Une archive malveillante avec une entrée connue mais hors-dossier
        // doit être refusée (et de toute façon, seules les entrées connues
        // sont écrites). Ici on vérifie le garde is_safe_zip_entry.
        assert!(!is_safe_zip_entry("../evil"));
        assert!(!is_safe_zip_entry("/etc/passwd"));
        assert!(!is_safe_zip_entry("files/../../x"));
        assert!(is_safe_zip_entry("files/abc.enc"));
        assert!(is_safe_zip_entry("vault.db"));
    }

    #[test]
    fn round_trip_preserve_le_format_version() {
        let src = TempDir::new();
        let key = test_key();
        {
            let _db = Database::open(src.path(), &key).unwrap();
        }
        let backup_dir = TempDir::new();
        let backup_path = backup_dir.path().join("c.tbvbak");
        write_vault_archive(src.path(), "Maison", &backup_path).unwrap();

        let file = std::fs::File::open(&backup_path).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let mut manifest_str = String::new();
        archive
            .by_name("manifest.json")
            .unwrap()
            .read_to_string(&mut manifest_str)
            .unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&manifest_str).unwrap();
        assert_eq!(
            manifest.get("format_version").and_then(|v| v.as_i64()),
            Some(CURRENT_BACKUP_FORMAT_VERSION)
        );
        assert_eq!(manifest.get("format").and_then(|v| v.as_str()), Some("tbvbak"));
    }
}

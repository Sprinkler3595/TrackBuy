//! Seed the active vault with common Swiss creditors so the user doesn't
//! have to type "CSS Assurance", "Swisscom", "Romande Energie" by hand the
//! first time a QR-bill from one of them arrives.
//!
//! Strictly additive: each row is inserted with `INSERT OR IGNORE` keyed on
//! the unique `name` column, so re-running the seed is safe.

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;

#[derive(Debug, Serialize)]
pub struct SeedSummary {
    pub inserted: usize,
    pub skipped: usize,
}

struct SwissCreditor {
    name: &'static str,
    kind: &'static str,
}

const SWISS_CREDITORS: &[SwissCreditor] = &[
    // Assureurs maladie (LAMal + complémentaires)
    SwissCreditor { name: "CSS Assurance", kind: "insurer" },
    SwissCreditor { name: "Helsana", kind: "insurer" },
    SwissCreditor { name: "Swica", kind: "insurer" },
    SwissCreditor { name: "Groupe Mutuel", kind: "insurer" },
    SwissCreditor { name: "Assura", kind: "insurer" },
    SwissCreditor { name: "Visana", kind: "insurer" },
    SwissCreditor { name: "Concordia", kind: "insurer" },
    SwissCreditor { name: "Sympany", kind: "insurer" },
    SwissCreditor { name: "ÖKK", kind: "insurer" },
    SwissCreditor { name: "Sanitas", kind: "insurer" },
    SwissCreditor { name: "Atupri", kind: "insurer" },
    SwissCreditor { name: "EGK", kind: "insurer" },
    SwissCreditor { name: "KPT", kind: "insurer" },
    SwissCreditor { name: "Mutuel Assurances", kind: "insurer" },
    SwissCreditor { name: "Vivao Sympany", kind: "insurer" },
    SwissCreditor { name: "Aquilana", kind: "insurer" },
    SwissCreditor { name: "AXA Assurances", kind: "insurer" },
    SwissCreditor { name: "Bâloise Assurances", kind: "insurer" },
    SwissCreditor { name: "Generali Assurances", kind: "insurer" },
    SwissCreditor { name: "Helvetia", kind: "insurer" },
    SwissCreditor { name: "La Mobilière", kind: "insurer" },
    SwissCreditor { name: "Swiss Life", kind: "insurer" },
    SwissCreditor { name: "Vaudoise Assurances", kind: "insurer" },
    SwissCreditor { name: "Zurich Assurances", kind: "insurer" },
    SwissCreditor { name: "Allianz Suisse", kind: "insurer" },
    SwissCreditor { name: "TCS", kind: "insurer" },

    // Télécom
    SwissCreditor { name: "Swisscom", kind: "telco" },
    SwissCreditor { name: "Sunrise", kind: "telco" },
    SwissCreditor { name: "Salt", kind: "telco" },
    SwissCreditor { name: "Wingo", kind: "telco" },
    SwissCreditor { name: "M-Budget Mobile", kind: "telco" },
    SwissCreditor { name: "Yallo", kind: "telco" },
    SwissCreditor { name: "Coop Mobile", kind: "telco" },
    SwissCreditor { name: "Lebara", kind: "telco" },
    SwissCreditor { name: "Lyca Mobile", kind: "telco" },
    SwissCreditor { name: "TalkTalk", kind: "telco" },
    SwissCreditor { name: "VTX Telecom", kind: "telco" },
    SwissCreditor { name: "Init7", kind: "telco" },
    SwissCreditor { name: "Quickline", kind: "telco" },
    SwissCreditor { name: "Net+ Léman", kind: "telco" },

    // Énergie / utilités
    SwissCreditor { name: "Romande Energie", kind: "utility" },
    SwissCreditor { name: "SIG (Services Industriels de Genève)", kind: "utility" },
    SwissCreditor { name: "Services Industriels de Lausanne", kind: "utility" },
    SwissCreditor { name: "EWZ (Elektrizitätswerk der Stadt Zürich)", kind: "utility" },
    SwissCreditor { name: "IWB (Industrielle Werke Basel)", kind: "utility" },
    SwissCreditor { name: "BKW", kind: "utility" },
    SwissCreditor { name: "Axpo", kind: "utility" },
    SwissCreditor { name: "Groupe E", kind: "utility" },
    SwissCreditor { name: "Viteos", kind: "utility" },
    SwissCreditor { name: "Alpiq", kind: "utility" },
    SwissCreditor { name: "ESR (Energie Service Region)", kind: "utility" },
    SwissCreditor { name: "Holdigaz", kind: "utility" },
    SwissCreditor { name: "Gaznat", kind: "utility" },
    SwissCreditor { name: "EKZ (Elektrizitätswerke Zürich)", kind: "utility" },
    SwissCreditor { name: "AEW Energie", kind: "utility" },
    SwissCreditor { name: "Repower", kind: "utility" },
    SwissCreditor { name: "Energie Wasser Bern", kind: "utility" },

    // SRG SSR / redevance
    SwissCreditor { name: "Serafe", kind: "other" },
    SwissCreditor { name: "Billag", kind: "other" }, // Legacy, kept for old bills.

    // Banques
    SwissCreditor { name: "UBS", kind: "bank" },
    SwissCreditor { name: "PostFinance", kind: "bank" },
    SwissCreditor { name: "Raiffeisen", kind: "bank" },
    SwissCreditor { name: "Zürcher Kantonalbank (ZKB)", kind: "bank" },
    SwissCreditor { name: "Banque Cantonale Vaudoise (BCV)", kind: "bank" },
    SwissCreditor { name: "Banque Cantonale de Genève (BCGE)", kind: "bank" },
    SwissCreditor { name: "Banque Cantonale Neuchâteloise (BCN)", kind: "bank" },
    SwissCreditor { name: "Banque Cantonale de Fribourg (BCF)", kind: "bank" },
    SwissCreditor { name: "Banque Cantonale du Jura", kind: "bank" },
    SwissCreditor { name: "Banque Cantonale du Valais (BCVs)", kind: "bank" },
    SwissCreditor { name: "Migros Bank", kind: "bank" },
    SwissCreditor { name: "Bank Cler", kind: "bank" },
    SwissCreditor { name: "Crédit Suisse", kind: "bank" },
    SwissCreditor { name: "Julius Bär", kind: "bank" },
    SwissCreditor { name: "Yuh", kind: "bank" },
    SwissCreditor { name: "Neon", kind: "bank" },
    SwissCreditor { name: "Revolut", kind: "bank" },
    SwissCreditor { name: "Zak (Bank Cler)", kind: "bank" },

    // Caisses de pension fréquentes (2ᵉ pilier)
    SwissCreditor { name: "Publica", kind: "other" },
    SwissCreditor { name: "CPEV (Caisse de pensions Etat de Vaud)", kind: "other" },
    SwissCreditor { name: "CIA (Caisse interprofessionnelle AVS)", kind: "other" },

    // Administrations fiscales cantonales
    SwissCreditor { name: "Administration fiscale cantonale de Vaud", kind: "tax_office" },
    SwissCreditor { name: "Administration fiscale cantonale de Genève", kind: "tax_office" },
    SwissCreditor { name: "Administration fiscale cantonale de Neuchâtel", kind: "tax_office" },
    SwissCreditor { name: "Administration fiscale cantonale de Fribourg", kind: "tax_office" },
    SwissCreditor { name: "Administration fiscale cantonale du Valais", kind: "tax_office" },
    SwissCreditor { name: "Administration fiscale cantonale du Jura", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Zürich", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Bern", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Basel-Stadt", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Basel-Landschaft", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Luzern", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Aargau", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton St. Gallen", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Thurgau", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Zug", kind: "tax_office" },
    SwissCreditor { name: "Steueramt Kanton Schwyz", kind: "tax_office" },
    SwissCreditor { name: "Administrazione fiscale cantonale Ticino", kind: "tax_office" },
    SwissCreditor { name: "Administration fédérale des contributions (AFC)", kind: "tax_office" },

    // Transports
    SwissCreditor { name: "CFF (Chemins de fer fédéraux)", kind: "other" },
    SwissCreditor { name: "TPG (Transports publics genevois)", kind: "other" },
    SwissCreditor { name: "TL (Transports publics lausannois)", kind: "other" },
    SwissCreditor { name: "Mobility", kind: "other" },

    // Streaming et abonnements numériques fréquents (créés ici pour matching
    // QR-bill via CarteAuto, mais peuvent aussi être marchands).
    SwissCreditor { name: "Netflix", kind: "other" },
    SwissCreditor { name: "Spotify", kind: "other" },
    SwissCreditor { name: "Apple Services", kind: "other" },
    SwissCreditor { name: "Google", kind: "other" },
    SwissCreditor { name: "Microsoft", kind: "other" },
    SwissCreditor { name: "Infomaniak", kind: "other" },
];

#[tauri::command]
pub fn seed_swiss_creditors(state: State<'_, AppState>) -> Result<SeedSummary, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let mut inserted = 0usize;
    let mut skipped = 0usize;

    for c in SWISS_CREDITORS {
        let id = Uuid::new_v4().to_string();
        let n = conn
            .execute(
                "INSERT OR IGNORE INTO creditors (id, name, creditor_type)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![id, c.name, c.kind],
            )
            .map_err(|e| e.to_string())?;
        if n > 0 {
            inserted += 1;
        } else {
            skipped += 1;
        }
    }

    Ok(SeedSummary { inserted, skipped })
}

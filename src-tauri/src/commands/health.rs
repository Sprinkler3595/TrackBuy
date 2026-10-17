//! Assurance maladie : la fiche d'une police, l'avis de prime de chaque
//! automne, les décomptes de prestations, et ce que le moteur `health` en
//! tire — contrôles, calendrier de la saison, comparaison des franchises.
//!
//! Chaque commande délègue à une fonction `*_inner(&Connection, …)` : c'est
//! elle que les tests appellent, sans coffre déverrouillé.

use chrono::{Datelike, Local, NaiveDate};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::health::calendar::{season_events, season_is_open, season_year_for, PolicyShape, SeasonEvent};
use crate::health::checks::{check_policy, EmploymentContext, HealthFinding, NoticeFacts, PolicyFacts};
use crate::health::{
    age_class, compare_franchises, known_years, params_for_year, participation_status, AgeClass,
    ClaimAmounts, FranchiseComparison, FranchiseOption, HealthParams, ParticipationStatus,
};

macro_rules! with_conn {
    ($state:expr, $conn:ident, $body:expr) => {{
        let db_guard = $state.db.lock().map_err(|_| "lock poisoned".to_string())?;
        let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
        let $conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
        $body
    }};
}

fn today() -> NaiveDate {
    Local::now().date_naive()
}

fn year_of(date: Option<&str>) -> Option<i32> {
    date.and_then(|d| d.get(0..4)).and_then(|y| y.parse().ok())
}

/// Nombre de mois couverts par une échéance, `None` pour un cycle qui n'a
/// pas d'équivalent mensuel fixe.
fn months_per_cycle(cycle: &str, interval: i32) -> Option<f64> {
    let base = match cycle {
        "monthly" => 1.0,
        "quarterly" => 3.0,
        "semiannual" => 6.0,
        "yearly" => 12.0,
        _ => return None,
    };
    Some(base * interval.max(1) as f64)
}

// ===========================================================================
// Barèmes
// ===========================================================================

#[derive(Debug, Serialize)]
pub struct HealthParamsResponse {
    pub params: HealthParams,
    pub known_years: Vec<i32>,
}

#[tauri::command]
pub fn get_health_params(year: i32) -> HealthParamsResponse {
    HealthParamsResponse { params: params_for_year(year), known_years: known_years() }
}

// ===========================================================================
// Fiche de police
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct HealthPolicy {
    pub engagement_id: String,
    /// `basic` (LAMal) | `supplementary` (LCA)
    pub kind: String,
    pub insured_member_id: Option<String>,
    pub insured_name: Option<String>,
    pub insured_birth_date: Option<String>,
    pub canton: Option<String>,
    pub premium_region: Option<String>,
    /// `standard` | `family_doctor` | `hmo` | `telmed` | `other`
    pub model: Option<String>,
    pub franchise: Option<f64>,
    pub accident_covered: Option<bool>,
    pub subsidy_monthly: Option<f64>,
    pub options_json: Option<String>,
    /// Police de la caisse quittée, quand celle-ci la remplace (v37).
    pub replaces_engagement_id: Option<String>,
    /// Date de la confirmation d'affiliation reçue de la nouvelle caisse.
    pub affiliation_confirmed_on: Option<String>,
}

const POLICY_COLUMNS: &str = "engagement_id, kind, insured_member_id, insured_name, insured_birth_date,
     canton, premium_region, model, franchise, accident_covered, subsidy_monthly, options_json,
     replaces_engagement_id, affiliation_confirmed_on";

fn row_to_policy(r: &rusqlite::Row<'_>) -> rusqlite::Result<HealthPolicy> {
    Ok(HealthPolicy {
        engagement_id: r.get(0)?,
        kind: r.get(1)?,
        insured_member_id: r.get(2)?,
        insured_name: r.get(3)?,
        insured_birth_date: r.get(4)?,
        canton: r.get(5)?,
        premium_region: r.get(6)?,
        model: r.get(7)?,
        franchise: r.get(8)?,
        accident_covered: r.get(9)?,
        subsidy_monthly: r.get(10)?,
        options_json: r.get(11)?,
        replaces_engagement_id: r.get(12)?,
        affiliation_confirmed_on: r.get(13)?,
    })
}

pub fn get_policy_inner(conn: &Connection, engagement_id: &str) -> Result<Option<HealthPolicy>, String> {
    conn.query_row(
        &format!("SELECT {POLICY_COLUMNS} FROM health_policies WHERE engagement_id = ?1"),
        [engagement_id],
        row_to_policy,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn upsert_policy_inner(conn: &Connection, p: &HealthPolicy) -> Result<HealthPolicy, String> {
    let kind = if p.kind == "supplementary" { "supplementary" } else { "basic" };
    let engagement_type: Option<String> = conn
        .query_row("SELECT engagement_type FROM engagements WHERE id = ?1", [&p.engagement_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    match engagement_type.as_deref() {
        Some("insurance_health") => {}
        Some(other) => return Err(format!("Engagement de type « {other} » : pas une assurance maladie")),
        None => return Err("Engagement introuvable".to_string()),
    }
    conn.execute(
        "INSERT INTO health_policies
            (engagement_id, kind, insured_member_id, insured_name, insured_birth_date, canton,
             premium_region, model, franchise, accident_covered, subsidy_monthly, options_json,
             replaces_engagement_id, affiliation_confirmed_on)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(engagement_id) DO UPDATE SET
            kind = excluded.kind, insured_member_id = excluded.insured_member_id,
            insured_name = excluded.insured_name, insured_birth_date = excluded.insured_birth_date,
            canton = excluded.canton, premium_region = excluded.premium_region,
            model = excluded.model, franchise = excluded.franchise,
            accident_covered = excluded.accident_covered,
            subsidy_monthly = excluded.subsidy_monthly, options_json = excluded.options_json,
            replaces_engagement_id = excluded.replaces_engagement_id,
            affiliation_confirmed_on = excluded.affiliation_confirmed_on,
            updated_at = datetime('now')",
        rusqlite::params![
            p.engagement_id, kind, p.insured_member_id, p.insured_name, p.insured_birth_date,
            p.canton, p.premium_region, p.model, p.franchise, p.accident_covered,
            p.subsidy_monthly, p.options_json, p.replaces_engagement_id, p.affiliation_confirmed_on,
        ],
    )
    .map_err(|e| e.to_string())?;
    // La personne assurée sert aussi à l'attribution par membre du ménage
    // (impôts, totaux) : on garde les deux alignées.
    conn.execute(
        "UPDATE engagements SET attributed_to_member_id = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![p.insured_member_id, p.engagement_id],
    )
    .map_err(|e| e.to_string())?;
    get_policy_inner(conn, &p.engagement_id)?.ok_or_else(|| "Fiche introuvable".to_string())
}

#[tauri::command]
pub fn get_health_policy(state: State<'_, AppState>, engagement_id: String) -> Result<Option<HealthPolicy>, String> {
    with_conn!(state, conn, get_policy_inner(&conn, &engagement_id))
}

#[tauri::command]
pub fn upsert_health_policy(state: State<'_, AppState>, policy: HealthPolicy) -> Result<HealthPolicy, String> {
    with_conn!(state, conn, upsert_policy_inner(&conn, &policy))
}

// ===========================================================================
// Avis de prime
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PremiumNotice {
    pub id: String,
    pub engagement_id: String,
    pub year: i32,
    pub monthly_premium: Option<f64>,
    pub franchise: Option<f64>,
    pub model: Option<String>,
    pub accident_covered: Option<bool>,
    pub received_on: Option<String>,
    /// `pending` | `keep` | `change_franchise` | `change_model` | `switch_insurer`
    pub decision: String,
    pub revision_id: Option<String>,
    pub notes: Option<String>,
    /// Réduction de primes de l'année annoncée — elle change avec chaque
    /// décision cantonale. `None` : celle de la fiche reste valable.
    pub subsidy_monthly: Option<f64>,
}

const NOTICE_COLUMNS: &str = "id, engagement_id, year, monthly_premium, franchise, model,
     accident_covered, received_on, decision, revision_id, notes, subsidy_monthly";

fn row_to_notice(r: &rusqlite::Row<'_>) -> rusqlite::Result<PremiumNotice> {
    Ok(PremiumNotice {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        year: r.get(2)?,
        monthly_premium: r.get(3)?,
        franchise: r.get(4)?,
        model: r.get(5)?,
        accident_covered: r.get(6)?,
        received_on: r.get(7)?,
        decision: r.get(8)?,
        revision_id: r.get(9)?,
        notes: r.get(10)?,
        subsidy_monthly: r.get(11)?,
    })
}

pub fn list_notices_inner(conn: &Connection, engagement_id: &str) -> Result<Vec<PremiumNotice>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {NOTICE_COLUMNS} FROM health_premium_notices WHERE engagement_id = ?1 ORDER BY year DESC"
        ))
        .map_err(|e| e.to_string())?;
    stmt.query_map([engagement_id], row_to_notice)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn notice_for_year(conn: &Connection, engagement_id: &str, year: i32) -> Result<Option<PremiumNotice>, String> {
    conn.query_row(
        &format!("SELECT {NOTICE_COLUMNS} FROM health_premium_notices WHERE engagement_id = ?1 AND year = ?2"),
        rusqlite::params![engagement_id, year],
        row_to_notice,
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Enregistre l'avis de prime de `notice.year` (un par police et par année)
/// et tient à jour la révision qui fera passer les échéances à la nouvelle
/// prime au 1er janvier.
///
/// Le montant de la révision est ce qui sera FACTURÉ : prime moins réduction
/// de primes, ramenée à la périodicité de l'engagement. Pas de révision
/// quand l'assuré change de caisse — la prime de l'ancienne ne s'appliquera
/// jamais — ni quand la périodicité n'a pas d'équivalent mensuel.
pub fn save_notice_inner(conn: &Connection, n: &PremiumNotice) -> Result<PremiumNotice, String> {
    let (cycle, interval, currency): (String, i32, String) = conn
        .query_row(
            "SELECT billing_cycle, cycle_interval, currency FROM engagements WHERE id = ?1",
            [&n.engagement_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Engagement introuvable".to_string())?;
    let subsidy = match n.subsidy_monthly {
        Some(s) => s,
        None => get_policy_inner(conn, &n.engagement_id)?.and_then(|p| p.subsidy_monthly).unwrap_or(0.0),
    };
    let decision = match n.decision.as_str() {
        "keep" | "change_franchise" | "change_model" | "switch_insurer" => n.decision.as_str(),
        _ => "pending",
    };

    let existing = notice_for_year(conn, &n.engagement_id, n.year)?;
    let id = existing.as_ref().map(|e| e.id.clone()).unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut revision_id = existing.as_ref().and_then(|e| e.revision_id.clone());

    let billed = match (decision, n.monthly_premium, months_per_cycle(&cycle, interval)) {
        ("switch_insurer", _, _) => None,
        (_, Some(m), Some(months)) if m > 0.0 => Some(((m - subsidy).max(0.0) * months * 100.0).round() / 100.0),
        _ => None,
    };
    let effective = format!("{:04}-01-01", n.year);

    // Une révision déjà reportée appartient à l'histoire : on n'y touche plus.
    let applied = match &revision_id {
        Some(rid) => conn
            .query_row(
                "SELECT applied_at IS NOT NULL FROM engagement_revisions WHERE id = ?1",
                [rid],
                |r| r.get::<_, bool>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?,
        None => None,
    };
    if applied.is_none() {
        revision_id = None;
    }
    if applied != Some(true) {
        match (billed, &revision_id) {
            (Some(amount), Some(rid)) => {
                conn.execute(
                    "UPDATE engagement_revisions SET amount = ?1, effective_date = ?2 WHERE id = ?3",
                    rusqlite::params![amount, effective, rid],
                )
                .map_err(|e| e.to_string())?;
            }
            (Some(amount), None) => {
                let rid = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO engagement_revisions
                        (id, engagement_id, effective_date, amount, currency, change_reason, applies_on_roll)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
                    rusqlite::params![
                        rid, n.engagement_id, effective, amount, currency,
                        format!("Avis de prime {}", n.year)
                    ],
                )
                .map_err(|e| e.to_string())?;
                revision_id = Some(rid);
            }
            (None, Some(rid)) => {
                conn.execute("DELETE FROM engagement_revisions WHERE id = ?1", [rid])
                    .map_err(|e| e.to_string())?;
                revision_id = None;
            }
            (None, None) => {}
        }
    }

    conn.execute(
        "INSERT INTO health_premium_notices
            (id, engagement_id, year, monthly_premium, franchise, model, accident_covered,
             received_on, decision, revision_id, notes, subsidy_monthly)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(engagement_id, year) DO UPDATE SET
            monthly_premium = excluded.monthly_premium, franchise = excluded.franchise,
            model = excluded.model, accident_covered = excluded.accident_covered,
            received_on = excluded.received_on, decision = excluded.decision,
            revision_id = excluded.revision_id, notes = excluded.notes,
            subsidy_monthly = excluded.subsidy_monthly,
            updated_at = datetime('now')",
        rusqlite::params![
            id, n.engagement_id, n.year, n.monthly_premium, n.franchise, n.model,
            n.accident_covered, n.received_on, decision, revision_id, n.notes, n.subsidy_monthly,
        ],
    )
    .map_err(|e| e.to_string())?;
    notice_for_year(conn, &n.engagement_id, n.year)?.ok_or_else(|| "Avis introuvable".to_string())
}

pub fn delete_notice_inner(conn: &Connection, id: &str) -> Result<(), String> {
    let rid: Option<String> = conn
        .query_row("SELECT revision_id FROM health_premium_notices WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    if let Some(rid) = rid {
        conn.execute(
            "DELETE FROM engagement_revisions WHERE id = ?1 AND applied_at IS NULL",
            [&rid],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute("DELETE FROM health_premium_notices WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_health_premium_notices(state: State<'_, AppState>, engagement_id: String) -> Result<Vec<PremiumNotice>, String> {
    with_conn!(state, conn, list_notices_inner(&conn, &engagement_id))
}

#[tauri::command]
pub fn save_health_premium_notice(state: State<'_, AppState>, notice: PremiumNotice) -> Result<PremiumNotice, String> {
    with_conn!(state, conn, save_notice_inner(&conn, &notice))
}

#[tauri::command]
pub fn delete_health_premium_notice(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_conn!(state, conn, delete_notice_inner(&conn, &id))
}

// ===========================================================================
// Décomptes de prestations
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct HealthClaim {
    pub id: String,
    pub engagement_id: String,
    pub year: i32,
    pub statement_date: Option<String>,
    pub treatment_date: Option<String>,
    pub provider: Option<String>,
    pub invoiced: f64,
    pub insurer_paid: f64,
    pub franchise: f64,
    pub quote_part: f64,
    pub hospital: f64,
    pub not_covered: f64,
    pub notes: Option<String>,
    /// `tiers_garant` : l'assuré a payé le prestataire, la caisse lui
    /// rembourse `insurer_paid`. `tiers_payant` : la caisse a payé, et facture
    /// à l'assuré sa participation.
    pub billing_mode: Option<String>,
    /// Remboursement attendu créé pour un décompte en tiers garant.
    pub reimbursement_id: Option<String>,
}

const CLAIM_COLUMNS: &str = "id, engagement_id, year, statement_date, treatment_date, provider,
     invoiced, insurer_paid, franchise, quote_part, hospital, not_covered, notes,
     billing_mode, reimbursement_id";

fn row_to_claim(r: &rusqlite::Row<'_>) -> rusqlite::Result<HealthClaim> {
    Ok(HealthClaim {
        id: r.get(0)?,
        engagement_id: r.get(1)?,
        year: r.get(2)?,
        statement_date: r.get(3)?,
        treatment_date: r.get(4)?,
        provider: r.get(5)?,
        invoiced: r.get(6)?,
        insurer_paid: r.get(7)?,
        franchise: r.get(8)?,
        quote_part: r.get(9)?,
        hospital: r.get(10)?,
        not_covered: r.get(11)?,
        notes: r.get(12)?,
        billing_mode: r.get(13)?,
        reimbursement_id: r.get(14)?,
    })
}

pub fn list_claims_inner(conn: &Connection, engagement_id: &str, year: i32) -> Result<Vec<HealthClaim>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {CLAIM_COLUMNS} FROM health_claims WHERE engagement_id = ?1 AND year = ?2
             ORDER BY COALESCE(treatment_date, statement_date) DESC, created_at DESC"
        ))
        .map_err(|e| e.to_string())?;
    stmt.query_map(rusqlite::params![engagement_id, year], row_to_claim)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn add_claim_inner(conn: &Connection, c: &HealthClaim) -> Result<HealthClaim, String> {
    let amounts = [c.invoiced, c.insurer_paid, c.franchise, c.quote_part, c.hospital, c.not_covered];
    if amounts.iter().any(|a| !a.is_finite() || *a < 0.0) {
        return Err("Montants invalides : nombres positifs attendus".to_string());
    }
    // L'année qui compte pour la franchise est celle du traitement ; à défaut,
    // celle du décompte, puis celle indiquée.
    let year = year_of(c.treatment_date.as_deref())
        .or_else(|| year_of(c.statement_date.as_deref()))
        .unwrap_or(c.year);
    let billing_mode = match c.billing_mode.as_deref() {
        Some("tiers_garant") => Some("tiers_garant"),
        Some("tiers_payant") => Some("tiers_payant"),
        _ => None,
    };

    // Tiers garant : l'assuré a avancé la facture, la caisse lui doit sa part.
    // Ce montant attendu rejoint les remboursements en attente, pour qu'on
    // puisse le pointer quand il arrive sur le compte.
    let reimbursement_id = if billing_mode == Some("tiers_garant") && c.insurer_paid > 0.0 {
        let (eng_name, creditor_id, creditor_name): (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT e.name, e.creditor_id, cr.name FROM engagements e
                 LEFT JOIN creditors cr ON cr.id = e.creditor_id WHERE e.id = ?1",
                [&c.engagement_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| "Engagement introuvable".to_string())?;
        let rid = Uuid::new_v4().to_string();
        let label = match &c.provider {
            Some(p) => format!("Remboursement caisse maladie — {p}"),
            None => "Remboursement caisse maladie".to_string(),
        };
        conn.execute(
            "INSERT INTO pending_reimbursements
                (id, label, reimbursement_type, expected_amount, currency, debtor_name,
                 debtor_creditor_id, source_description, requested_on, status)
             VALUES (?1, ?2, 'insurance_claim', ?3, 'CHF', ?4, ?5, ?6, ?7, 'pending')",
            rusqlite::params![
                rid, label, c.insurer_paid, creditor_name, creditor_id,
                format!("Décompte de prestations — {eng_name}"),
                c.statement_date.clone().unwrap_or_else(|| today().format("%Y-%m-%d").to_string()),
            ],
        )
        .map_err(|e| e.to_string())?;
        Some(rid)
    } else {
        None
    };

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO health_claims
            (id, engagement_id, year, statement_date, treatment_date, provider, invoiced,
             insurer_paid, franchise, quote_part, hospital, not_covered, notes, billing_mode,
             reimbursement_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        rusqlite::params![
            id, c.engagement_id, year, c.statement_date, c.treatment_date, c.provider,
            c.invoiced, c.insurer_paid, c.franchise, c.quote_part, c.hospital, c.not_covered, c.notes,
            billing_mode, reimbursement_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    conn.query_row(&format!("SELECT {CLAIM_COLUMNS} FROM health_claims WHERE id = ?1"), [&id], row_to_claim)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_health_claims(state: State<'_, AppState>, engagement_id: String, year: i32) -> Result<Vec<HealthClaim>, String> {
    with_conn!(state, conn, list_claims_inner(&conn, &engagement_id, year))
}

#[tauri::command]
pub fn add_health_claim(state: State<'_, AppState>, claim: HealthClaim) -> Result<HealthClaim, String> {
    with_conn!(state, conn, add_claim_inner(&conn, &claim))
}

#[tauri::command]
pub fn delete_health_claim(state: State<'_, AppState>, id: String) -> Result<(), String> {
    with_conn!(state, conn, delete_claim_inner(&conn, &id))
}

/// Supprime un décompte, et le remboursement qu'il avait créé tant que rien
/// n'a été reçu : un remboursement déjà pointé appartient à l'histoire.
pub fn delete_claim_inner(conn: &Connection, id: &str) -> Result<(), String> {
    let rid: Option<String> = conn
        .query_row("SELECT reimbursement_id FROM health_claims WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    conn.execute("DELETE FROM health_claims WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    if let Some(rid) = rid {
        conn.execute(
            "DELETE FROM pending_reimbursements
             WHERE id = ?1 AND status = 'pending' AND received_amount IS NULL",
            [&rid],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Plusieurs lignes d'un même décompte, en une transaction : un scan qui
/// échoue à la troisième ligne ne laisse pas deux lignes orphelines.
pub fn add_claims_inner(conn: &Connection, claims: &[HealthClaim]) -> Result<Vec<HealthClaim>, String> {
    conn.execute_batch("SAVEPOINT add_claims").map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(claims.len());
    for c in claims {
        match add_claim_inner(conn, c) {
            Ok(x) => out.push(x),
            Err(e) => {
                conn.execute_batch("ROLLBACK TO add_claims; RELEASE add_claims").ok();
                return Err(e);
            }
        }
    }
    conn.execute_batch("RELEASE add_claims").map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn add_health_claims(state: State<'_, AppState>, claims: Vec<HealthClaim>) -> Result<Vec<HealthClaim>, String> {
    with_conn!(state, conn, add_claims_inner(&conn, &claims))
}

// ===========================================================================
// Vue d'ensemble d'une police
// ===========================================================================

#[derive(Debug, Serialize)]
pub struct HealthOverview {
    pub year: i32,
    pub policy: Option<HealthPolicy>,
    pub insured_label: Option<String>,
    pub birth_year: Option<i32>,
    pub age_class: Option<AgeClass>,
    /// Franchises que la loi permet pour cette classe d'âge.
    pub allowed_franchises: Vec<f64>,
    /// Prime mensuelle brute (facturé + réduction de primes), `None` quand la
    /// périodicité n'a pas d'équivalent mensuel.
    pub monthly_gross: Option<f64>,
    pub notice_next_year: Option<PremiumNotice>,
    pub participation: Option<ParticipationStatus>,
    pub findings: Vec<HealthFinding>,
    pub season_year: i32,
    pub season_open: bool,
    pub season: Vec<SeasonEvent>,
}

/// Heures hebdomadaires des contrats de travail EN COURS de l'assuré.
///
/// Les revenus sans membre attribué sont ceux du titulaire du coffre : ils
/// valent pour une police dont l'assuré est « moi » (membre `self`, ou aucun
/// membre ni nom). `None` quand aucun contrat ne correspond — pas « zéro
/// heure », qu'on ne saurait distinguer d'un emploi non saisi.
fn employment_for(conn: &Connection, p: &HealthPolicy, on: NaiveDate) -> Result<Option<EmploymentContext>, String> {
    let relation: Option<String> = match &p.insured_member_id {
        Some(mid) => conn
            .query_row("SELECT relation FROM household_members WHERE id = ?1", [mid], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?,
        None => None,
    };
    let is_owner = relation.as_deref() == Some("self") || (p.insured_member_id.is_none() && p.insured_name.is_none());
    let mut stmt = conn
        .prepare(
            "SELECT ec.weekly_hours FROM employment_contracts ec
             JOIN incomes i ON i.id = ec.income_id
             WHERE i.status = 'active'
               AND ec.started_on <= ?1 AND (ec.ended_on IS NULL OR ec.ended_on >= ?1)
               AND (i.attributed_to_member_id = ?2
                    OR (?3 AND i.attributed_to_member_id IS NULL))",
        )
        .map_err(|e| e.to_string())?;
    let hours: Vec<Option<f64>> = stmt
        .query_map(
            rusqlite::params![on.format("%Y-%m-%d").to_string(), p.insured_member_id, is_owner],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok((!hours.is_empty()).then_some(EmploymentContext { weekly_hours: hours }))
}

pub fn overview_inner(conn: &Connection, engagement_id: &str, on: NaiveDate) -> Result<HealthOverview, String> {
    let year = on.year();
    let params = params_for_year(year);
    let (cycle, interval, amount): (String, i32, Option<f64>) = conn
        .query_row(
            "SELECT billing_cycle, cycle_interval, current_amount FROM engagements WHERE id = ?1",
            [engagement_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Engagement introuvable".to_string())?;
    // Les termes en vigueur : ceux de la fiche, sauf ce que l'avis de prime de
    // l'année a changé (franchise, modèle, accidents). Sans cela, le 1er
    // janvier, la fiche continue de juger l'ancienne franchise — et accuse un
    // jeune adulte de garder sa franchise d'enfant qu'il a justement quittée.
    let notice_this_year = notice_for_year(conn, engagement_id, year)?
        .filter(|n| n.decision != "switch_insurer");
    let policy = get_policy_inner(conn, engagement_id)?.map(|mut p| {
        if let Some(n) = &notice_this_year {
            p.franchise = n.franchise.or(p.franchise);
            p.model = n.model.clone().or(p.model);
            p.accident_covered = n.accident_covered.or(p.accident_covered);
            p.subsidy_monthly = n.subsidy_monthly.or(p.subsidy_monthly);
        }
        p
    });

    let (insured_label, birth_date) = match &policy {
        Some(p) => match &p.insured_member_id {
            Some(mid) => conn
                .query_row("SELECT name, birth_date FROM household_members WHERE id = ?1", [mid], |r| {
                    Ok((Some(r.get::<_, String>(0)?), r.get::<_, Option<String>>(1)?))
                })
                .optional()
                .map_err(|e| e.to_string())?
                .map(|(n, b)| (n, b.or_else(|| p.insured_birth_date.clone())))
                .unwrap_or((p.insured_name.clone(), p.insured_birth_date.clone())),
            // Ni membre ni nom : c'est le titulaire du coffre, pas encore inscrit
            // au ménage. Le nom reste vide en base — c'est ce qui le désigne
            // comme titulaire pour le contrôle des accidents.
            None => (p.insured_name.clone().or_else(|| Some("Moi".to_string())), p.insured_birth_date.clone()),
        },
        None => (None, None),
    };
    let birth_year = year_of(birth_date.as_deref());
    let class = birth_year.map(|b| age_class(&params, b, year));
    let subsidy = policy.as_ref().and_then(|p| p.subsidy_monthly).unwrap_or(0.0);
    let monthly_gross = match (amount, months_per_cycle(&cycle, interval)) {
        (Some(a), Some(m)) => Some(((a / m + subsidy) * 100.0).round() / 100.0),
        _ => None,
    };
    let notice_next_year = notice_for_year(conn, engagement_id, year + 1)?;

    let participation = match &policy {
        Some(p) if p.kind == "basic" => {
            match p.franchise {
                Some(f) => {
                    let claims: Vec<ClaimAmounts> = list_claims_inner(conn, engagement_id, year)?
                        .into_iter()
                        .map(|c| ClaimAmounts {
                            invoiced: c.invoiced,
                            insurer_paid: c.insurer_paid,
                            franchise: c.franchise,
                            quote_part: c.quote_part,
                            hospital: c.hospital,
                            not_covered: c.not_covered,
                        })
                        .collect();
                    Some(participation_status(&params, class.unwrap_or(AgeClass::Adult), f, &claims))
                }
                None => None,
            }
        }
        _ => None,
    };

    let findings = match &policy {
        Some(p) => {
            let facts = PolicyFacts {
                kind: p.kind.clone(),
                birth_year,
                franchise: p.franchise,
                accident_covered: p.accident_covered,
                monthly_premium: monthly_gross,
                next_year_notice: notice_next_year
                    .as_ref()
                    .map(|n| NoticeFacts { monthly_premium: n.monthly_premium }),
                employment: if p.kind == "basic" { employment_for(conn, p, on)? } else { None },
                laa_min_weekly_hours: crate::payroll::params_for_year(year).laa_nonoccupational_min_weekly_hours,
                today: on,
                affiliation_pending: match (&p.replaces_engagement_id, &p.affiliation_confirmed_on) {
                    (Some(_), None) => conn
                        .query_row("SELECT contract_start_date FROM engagements WHERE id = ?1", [engagement_id], |r| {
                            r.get::<_, Option<String>>(0)
                        })
                        .optional()
                        .map_err(|e| e.to_string())?
                        .flatten()
                        .and_then(|d| year_of(Some(&d)))
                        .filter(|y| *y >= year),
                    _ => None,
                },
                replaced_by: conn
                    .query_row(
                        "SELECT e.name, e.contract_start_date FROM health_policies hp
                         JOIN engagements e ON e.id = hp.engagement_id
                         WHERE hp.replaces_engagement_id = ?1",
                        [engagement_id],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .and_then(|(n, d)| year_of(d.as_deref()).map(|y| (n, y))),
            };
            check_policy(&facts)
        }
        None => Vec::new(),
    };

    let shape = PolicyShape {
        ordinary_franchise: match (&policy, class) {
            (Some(p), Some(c)) => p.franchise.is_some_and(|f| (f - params.ordinary_franchise_for(c)).abs() < 0.5),
            _ => false,
        },
        standard_model: policy.as_ref().and_then(|p| p.model.as_deref()).is_none_or(|m| m == "standard"),
    };
    let season_year = season_year_for(on);

    Ok(HealthOverview {
        year,
        allowed_franchises: class.map(|c| params.franchises_for(c).to_vec()).unwrap_or_default(),
        policy,
        insured_label,
        birth_year,
        age_class: class,
        monthly_gross,
        notice_next_year,
        participation,
        findings,
        season_year,
        season_open: season_is_open(on),
        season: season_events(season_year, shape),
    })
}

#[tauri::command]
pub fn get_health_overview(state: State<'_, AppState>, engagement_id: String) -> Result<HealthOverview, String> {
    with_conn!(state, conn, overview_inner(&conn, &engagement_id, today()))
}

// ===========================================================================
// Changement de caisse
// ===========================================================================

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct SwitchInsurerInput {
    /// Police (assurance de base) que l'on quitte.
    pub engagement_id: String,
    /// Année à partir de laquelle la nouvelle caisse assure (1er janvier).
    pub year: i32,
    pub creditor_id: Option<String>,
    pub policy_number: Option<String>,
    pub monthly_premium: f64,
    pub franchise: Option<f64>,
    pub model: Option<String>,
    pub accident_covered: Option<bool>,
    pub subsidy_monthly: Option<f64>,
    /// Rattacher les complémentaires à la nouvelle police. Elles relèvent de
    /// la LCA et ne suivent pas la base : les garder chez l'ancienne caisse est
    /// courant, elles n'en restent pas moins celles de la même personne.
    pub move_supplementary: bool,
}

/// Quitte une caisse pour une autre au 1er janvier `year`, d'un seul geste :
///
/// - l'avis de prime `year` de l'ancienne police passe à « je change de
///   caisse » — sa révision disparaît, la prime de l'ancienne ne s'appliquera
///   jamais ;
/// - l'ancienne police finit le 31 décembre : le roll-forward cesse ses
///   échéances après cette date, puis la termine ;
/// - la nouvelle police naît au 1er janvier, avec la même personne, le même
///   compte et le même mode de paiement, et le lien vers l'ancienne — c'est
///   lui qui fait réclamer la confirmation d'affiliation (art. 7 al. 5 LAMal).
pub fn switch_insurer_inner(conn: &Connection, input: &SwitchInsurerInput) -> Result<String, String> {
    if !(input.monthly_premium.is_finite() && input.monthly_premium > 0.0) {
        return Err("Prime mensuelle de la nouvelle caisse requise".to_string());
    }
    let old = get_policy_inner(conn, &input.engagement_id)?.ok_or("Fiche santé introuvable")?;
    if old.kind != "basic" {
        return Err("Seule l'assurance de base se change ainsi ; une complémentaire se résilie selon sa police".to_string());
    }
    type OldRow = (String, String, i32, Option<String>, Option<String>, bool, String, Option<String>);
    let (name, cycle, interval, card_id, pay_method, auto_pay, currency, member): OldRow = conn
        .query_row(
            "SELECT name, billing_cycle, cycle_interval, payment_card_id, payment_method, auto_pay,
                    currency, attributed_to_member_id
             FROM engagements WHERE id = ?1",
            [&input.engagement_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)),
        )
        .map_err(|_| "Engagement introuvable".to_string())?;
    let new_insurer: Option<String> = match &input.creditor_id {
        Some(cid) => conn
            .query_row("SELECT name FROM creditors WHERE id = ?1", [cid], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?,
        None => None,
    };
    // « LAMal — Sophie (CSS) » devient « LAMal — Sophie (Helsana) ».
    let stem = name.rsplit_once(" (").map(|(a, _)| a).unwrap_or(&name);
    let new_name = match &new_insurer {
        Some(n) => format!("{stem} ({n})"),
        None => format!("{stem} (nouvelle caisse)"),
    };
    let months = months_per_cycle(&cycle, interval).unwrap_or(1.0);
    let subsidy = input.subsidy_monthly.or(old.subsidy_monthly).unwrap_or(0.0);
    let billed = ((input.monthly_premium - subsidy).max(0.0) * months * 100.0).round() / 100.0;
    let start = format!("{:04}-01-01", input.year);

    conn.execute_batch("SAVEPOINT switch_insurer").map_err(|e| e.to_string())?;
    let result = (|| -> Result<String, String> {
        let mut notice = notice_for_year(conn, &input.engagement_id, input.year)?.unwrap_or_default();
        notice.engagement_id = input.engagement_id.clone();
        notice.year = input.year;
        notice.decision = "switch_insurer".to_string();
        save_notice_inner(conn, &notice)?;

        conn.execute(
            "UPDATE engagements SET ended_on = ?1, updated_at = datetime('now') WHERE id = ?2",
            rusqlite::params![format!("{:04}-12-31", input.year - 1), input.engagement_id],
        )
        .map_err(|e| e.to_string())?;

        let new_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO engagements
                (id, name, engagement_type, creditor_id, payment_card_id, contract_reference,
                 contract_start_date, contract_end_date, notice_period_days, billing_cycle,
                 cycle_interval, next_due_date, current_amount, currency, payment_method, auto_pay,
                 status, attributed_to_member_id)
             VALUES (?1, ?2, 'insurance_health', ?3, ?4, ?5, ?6, ?7, 31, ?8, ?9, ?6, ?10, ?11, ?12,
                     ?13, 'active', ?14)",
            rusqlite::params![
                new_id, new_name, input.creditor_id, card_id, input.policy_number, start,
                format!("{:04}-12-31", input.year), cycle, interval, billed, currency, pay_method,
                auto_pay, member,
            ],
        )
        .map_err(|e| e.to_string())?;

        upsert_policy_inner(
            conn,
            &HealthPolicy {
                engagement_id: new_id.clone(),
                franchise: input.franchise.or(old.franchise),
                model: input.model.clone().or(old.model.clone()),
                accident_covered: input.accident_covered.or(old.accident_covered),
                subsidy_monthly: input.subsidy_monthly.or(old.subsidy_monthly),
                replaces_engagement_id: Some(input.engagement_id.clone()),
                affiliation_confirmed_on: None,
                ..old.clone()
            },
        )?;

        // Une complémentaire payée sur la facture de l'ancienne caisse reste
        // chez elle : la nouvelle caisse ne la facturera jamais. Elle reste
        // donc rattachée à l'ancienne police, qui la facture jusqu'au 31.12,
        // puis elle facture elle-même. Seules les autres suivent la personne.
        if input.move_supplementary {
            conn.execute(
                "UPDATE engagements SET parent_engagement_id = ?1, updated_at = datetime('now')
                 WHERE parent_engagement_id = ?2 AND billed_with_parent = 0",
                rusqlite::params![new_id, input.engagement_id],
            )
            .map_err(|e| e.to_string())?;
        }
        crate::commands::engagements::plan_next_charge_inner(conn, &new_id)?;
        Ok(new_id)
    })();
    match result {
        Ok(id) => {
            conn.execute_batch("RELEASE switch_insurer").map_err(|e| e.to_string())?;
            Ok(id)
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK TO switch_insurer; RELEASE switch_insurer").ok();
            Err(e)
        }
    }
}

#[tauri::command]
pub fn switch_health_insurer(state: State<'_, AppState>, input: SwitchInsurerInput) -> Result<String, String> {
    with_conn!(state, conn, switch_insurer_inner(&conn, &input))
}

// ===========================================================================
// Saison des primes, toutes polices confondues
// ===========================================================================

#[derive(Debug, Serialize)]
pub struct SeasonPolicy {
    pub engagement_id: String,
    pub parent_engagement_id: Option<String>,
    pub name: String,
    pub creditor_name: Option<String>,
    pub kind: Option<String>,
    pub insured_label: Option<String>,
    pub franchise: Option<f64>,
    pub model: Option<String>,
    /// Prime brute mensuelle en cours et réduction de primes en cours : de
    /// quoi chiffrer la hausse ligne par ligne sans ouvrir chaque fiche.
    pub monthly_gross: Option<f64>,
    pub subsidy_monthly: Option<f64>,
    /// Franchises permises l'année de l'avis — celles d'un enfant disparaissent
    /// l'année de ses 19 ans.
    pub next_year_franchises: Vec<f64>,
    pub notice: Option<PremiumNotice>,
}

#[derive(Debug, Serialize)]
pub struct HealthSeason {
    pub season_year: i32,
    pub open: bool,
    /// Échéances générales de la saison (sans la fenêtre de fin juin, qui
    /// dépend de chaque police).
    pub events: Vec<SeasonEvent>,
    pub policies: Vec<SeasonPolicy>,
    pub params: HealthParams,
}

pub fn season_inner(conn: &Connection, on: NaiveDate) -> Result<HealthSeason, String> {
    let season_year = season_year_for(on);
    let next_params = params_for_year(season_year + 1);
    // Une police qui ne commence que l'an prochain (la nouvelle caisse) n'a
    // pas d'avis à recevoir cet automne.
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.parent_engagement_id, e.name, cr.name
             FROM engagements e
             LEFT JOIN creditors cr ON cr.id = e.creditor_id
             LEFT JOIN health_policies hp ON hp.engagement_id = e.id
             LEFT JOIN household_members hm ON hm.id = hp.insured_member_id
             WHERE e.engagement_type = 'insurance_health' AND e.status = 'active'
               AND (e.contract_start_date IS NULL OR e.contract_start_date <= ?1)
             ORDER BY COALESCE(hm.name, hp.insured_name, e.name), COALESCE(hp.kind, 'basic')",
        )
        .map_err(|e| e.to_string())?;
    type Row = (String, Option<String>, String, Option<String>);
    let rows: Vec<Row> = stmt
        .query_map([on.format("%Y-%m-%d").to_string()], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut policies = Vec::with_capacity(rows.len());
    for (id, parent, name, creditor_name) in rows {
        let o = overview_inner(conn, &id, on)?;
        let next_year_franchises = o
            .birth_year
            .map(|b| next_params.franchises_for(age_class(&next_params, b, season_year + 1)).to_vec())
            .unwrap_or_else(|| next_params.adult_franchises.to_vec());
        policies.push(SeasonPolicy {
            engagement_id: id,
            parent_engagement_id: parent,
            name,
            creditor_name,
            kind: o.policy.as_ref().map(|p| p.kind.clone()),
            insured_label: o.insured_label,
            franchise: o.policy.as_ref().and_then(|p| p.franchise),
            model: o.policy.as_ref().and_then(|p| p.model.clone()),
            monthly_gross: o.monthly_gross,
            subsidy_monthly: o.policy.as_ref().and_then(|p| p.subsidy_monthly),
            next_year_franchises,
            notice: o.notice_next_year,
        });
    }
    let events = season_events(season_year, PolicyShape::default())
        .into_iter()
        .filter(|e| e.key != "mid_year_switch")
        .collect();
    Ok(HealthSeason { season_year, open: season_is_open(on), events, policies, params: params_for_year(season_year + 1) })
}

#[tauri::command]
pub fn get_health_season(state: State<'_, AppState>) -> Result<HealthSeason, String> {
    with_conn!(state, conn, season_inner(&conn, today()))
}

// ===========================================================================
// Comparaison des franchises
// ===========================================================================

#[tauri::command]
pub fn compare_health_franchises(
    year: i32,
    birth_year: Option<i32>,
    options: Vec<FranchiseOption>,
    expected_costs: f64,
) -> FranchiseComparison {
    let params = params_for_year(year);
    let class = birth_year.map(|b| age_class(&params, b, year)).unwrap_or(AgeClass::Adult);
    compare_franchises(&params, class, &options, expected_costs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::util::test_support::{test_key, TempDir};

    fn open_db() -> (TempDir, Database) {
        let tmp = TempDir::new();
        let db = Database::open(tmp.path(), &test_key()).unwrap();
        (tmp, db)
    }

    fn insert_health(conn: &Connection, id: &str, amount: f64) {
        conn.execute(
            "INSERT INTO engagements (id, name, engagement_type, billing_cycle, cycle_interval,
                current_amount, currency, auto_pay, status)
             VALUES (?1, 'LAMal', 'insurance_health', 'monthly', 1, ?2, 'CHF', 1, 'active')",
            rusqlite::params![id, amount],
        )
        .unwrap();
    }

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn fiche_refusee_hors_assurance_maladie() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO engagements (id, name, engagement_type, billing_cycle, cycle_interval, currency, auto_pay, status)
             VALUES ('r', 'Loyer', 'rent', 'monthly', 1, 'CHF', 0, 'active')",
            [],
        )
        .unwrap();
        let p = HealthPolicy { engagement_id: "r".into(), kind: "basic".into(), ..Default::default() };
        assert!(upsert_policy_inner(&conn, &p).is_err());
    }

    #[test]
    fn avis_de_prime_cree_une_revision_nette_de_subside() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_health(&conn, "e1", 350.0);
        upsert_policy_inner(
            &conn,
            &HealthPolicy {
                engagement_id: "e1".into(),
                kind: "basic".into(),
                franchise: Some(300.0),
                subsidy_monthly: Some(50.0),
                ..Default::default()
            },
        )
        .unwrap();

        let saved = save_notice_inner(
            &conn,
            &PremiumNotice {
                engagement_id: "e1".into(),
                year: 2027,
                monthly_premium: Some(420.0),
                decision: "keep".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let rid = saved.revision_id.clone().expect("révision créée");
        let (eff, amount, roll): (String, f64, bool) = conn
            .query_row(
                "SELECT effective_date, amount, applies_on_roll FROM engagement_revisions WHERE id = ?1",
                [&rid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(eff, "2027-01-01");
        assert_eq!(amount, 370.0, "420 de prime − 50 de subside");
        assert!(roll);

        // Réenregistrer met à jour la même révision, pas une deuxième.
        let again = save_notice_inner(
            &conn,
            &PremiumNotice { monthly_premium: Some(430.0), ..saved.clone() },
        )
        .unwrap();
        assert_eq!(again.revision_id.as_deref(), Some(rid.as_str()));
        assert_eq!(again.id, saved.id);
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM engagement_revisions", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);

        // Changer de caisse : la prime de l'ancienne ne s'appliquera jamais.
        let switched = save_notice_inner(&conn, &PremiumNotice { decision: "switch_insurer".into(), ..again }).unwrap();
        assert!(switched.revision_id.is_none());
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM engagement_revisions", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn vue_d_ensemble_participation_et_controles() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_health(&conn, "e1", 400.0);
        conn.execute(
            "INSERT INTO household_members (id, name, relation, birth_date) VALUES ('m1', 'Léa', 'child', '2010-05-01')",
            [],
        )
        .unwrap();
        upsert_policy_inner(
            &conn,
            &HealthPolicy {
                engagement_id: "e1".into(),
                kind: "basic".into(),
                insured_member_id: Some("m1".into()),
                franchise: Some(2500.0),
                accident_covered: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        add_claim_inner(
            &conn,
            &HealthClaim {
                engagement_id: "e1".into(),
                treatment_date: Some("2026-03-02".into()),
                invoiced: 200.0,
                quote_part: 20.0,
                ..Default::default()
            },
        )
        .unwrap();

        let o = overview_inner(&conn, "e1", date(2026, 11, 5)).unwrap();
        assert_eq!(o.insured_label.as_deref(), Some("Léa"));
        assert_eq!(o.age_class, Some(AgeClass::Child));
        assert_eq!(o.monthly_gross, Some(400.0));
        let p = o.participation.unwrap();
        assert_eq!(p.quote_part_cap, 350.0);
        assert_eq!(p.quote_part_remaining, 330.0);
        let ids: Vec<&str> = o.findings.iter().map(|f| f.id).collect();
        assert!(ids.contains(&"franchise_not_allowed"), "{ids:?}");
        assert!(ids.contains(&"notice_missing"), "{ids:?}");
        // Pas d'emploi attribué à l'enfant : pas de jugement sur les accidents.
        assert!(!ids.iter().any(|i| i.starts_with("accident")), "{ids:?}");
        assert!(o.allowed_franchises.contains(&600.0));
        assert_eq!(o.season_year, 2026);
    }

    #[test]
    fn vue_d_ensemble_lit_l_emploi_du_titulaire() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_health(&conn, "e1", 400.0);
        conn.execute_batch(
            "INSERT INTO incomes (id, name, income_type, billing_cycle, status)
                 VALUES ('i1', 'Salaire', 'salary', 'monthly', 'active');
             INSERT INTO employment_contracts (id, income_id, started_on, weekly_hours)
                 VALUES ('c1', 'i1', '2020-01-01', 42);",
        )
        .unwrap();
        upsert_policy_inner(
            &conn,
            &HealthPolicy {
                engagement_id: "e1".into(),
                kind: "basic".into(),
                insured_birth_date: Some("1985-01-01".into()),
                franchise: Some(300.0),
                accident_covered: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let o = overview_inner(&conn, "e1", date(2026, 10, 1)).unwrap();
        let ids: Vec<&str> = o.findings.iter().map(|f| f.id).collect();
        assert!(ids.contains(&"accident_double_cover"), "{ids:?}");
        // Franchise ordinaire et modèle standard : la fin juin est ouverte.
        assert!(o.season.iter().find(|e| e.key == "mid_year_switch").unwrap().applies);
    }

    #[test]
    fn saison_liste_les_polices_actives_et_leur_avis() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_health(&conn, "e1", 400.0);
        save_notice_inner(
            &conn,
            &PremiumNotice { engagement_id: "e1".into(), year: 2027, monthly_premium: Some(410.0), ..Default::default() },
        )
        .unwrap();
        let s = season_inner(&conn, date(2026, 10, 17)).unwrap();
        assert!(s.open);
        assert_eq!(s.policies.len(), 1);
        assert_eq!(s.policies[0].notice.as_ref().unwrap().decision, "pending");
        assert!(s.events.iter().all(|e| e.key != "mid_year_switch"));
    }

    #[test]
    fn decompte_rattache_a_l_annee_du_traitement() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_health(&conn, "e1", 400.0);
        let c = add_claim_inner(
            &conn,
            &HealthClaim {
                engagement_id: "e1".into(),
                year: 2027,
                statement_date: Some("2027-01-15".into()),
                treatment_date: Some("2026-12-20".into()),
                invoiced: 100.0,
                franchise: 100.0,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(c.year, 2026);
        assert!(add_claim_inner(&conn, &HealthClaim { engagement_id: "e1".into(), invoiced: -1.0, ..Default::default() }).is_err());
    }

    /// Une famille lausannoise de bout en bout : salariée, conjoint
    /// indépendant, une fille qui devient jeune adulte au 1.1.2027. Chaque
    /// constat ici est un faux pas qu'un vrai assuré aurait fait ou subi.
    #[test]
    fn parcours_d_une_famille_vaudoise() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        conn.execute_batch(
            "INSERT INTO household_members (id, name, relation, birth_date) VALUES
               ('sophie', 'Sophie', 'self', '1988-04-12'),
               ('marc', 'Marc', 'spouse', '1986-09-30'),
               ('lea', 'Léa', 'child', '2008-02-03');
             INSERT INTO incomes (id, name, income_type, billing_cycle, status)
                 VALUES ('i1', 'Salaire Sophie', 'salary', 'monthly', 'active');
             INSERT INTO employment_contracts (id, income_id, started_on, weekly_hours)
                 VALUES ('c1', 'i1', '2020-01-01', 42);",
        )
        .unwrap();
        for (id, who, amount, franchise, accident) in [
            ("e_sophie", "sophie", 389.40, 2500.0, true),
            ("e_marc", "marc", 455.10, 300.0, false),
            ("e_lea", "lea", 112.30, 0.0, true),
        ] {
            insert_health(&conn, id, amount);
            upsert_policy_inner(
                &conn,
                &HealthPolicy {
                    engagement_id: id.into(),
                    kind: "basic".into(),
                    insured_member_id: Some(who.into()),
                    franchise: Some(franchise),
                    accident_covered: Some(accident),
                    ..Default::default()
                },
            )
            .unwrap();
        }
        let ids = |id: &str, on: NaiveDate| -> Vec<&'static str> {
            overview_inner(&conn, id, on).unwrap().findings.iter().map(|f| f.id).collect()
        };
        let oct = date(2026, 10, 17);

        // Sophie paie les accidents deux fois ; Marc, sans employeur, n'est pas couvert.
        assert!(ids("e_sophie", oct).contains(&"accident_double_cover"));
        assert!(ids("e_marc", oct).contains(&"accident_suspended_no_job"));
        // Le salaire de Sophie ne vaut pas pour Marc.
        assert!(!ids("e_marc", oct).contains(&"accident_double_cover"));

        // Léa passe en jeune adulte : la hausse est expliquée, pas dénoncée.
        save_notice_inner(
            &conn,
            &PremiumNotice {
                engagement_id: "e_lea".into(),
                year: 2027,
                monthly_premium: Some(318.50),
                franchise: Some(300.0),
                decision: "keep".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let o = overview_inner(&conn, "e_lea", oct).unwrap();
        let change = o.findings.iter().find(|f| f.id == "notice_change").unwrap();
        assert_eq!(change.severity, crate::payroll::checks::Severity::Info, "{}", change.message);
        assert!(o.findings.iter().any(|f| f.id == "age_class_change"));

        // Sophie choisit 1000 CHF pour 2027.
        save_notice_inner(
            &conn,
            &PremiumNotice {
                engagement_id: "e_sophie".into(),
                year: 2027,
                monthly_premium: Some(421.60),
                franchise: Some(1000.0),
                decision: "change_franchise".into(),
                ..Default::default()
            },
        )
        .unwrap();

        // En janvier, les termes de l'avis sont ceux en vigueur.
        let jan = date(2027, 1, 15);
        let sophie = overview_inner(&conn, "e_sophie", jan).unwrap();
        assert_eq!(sophie.policy.unwrap().franchise, Some(1000.0));
        assert_eq!(sophie.participation.unwrap().franchise, 1000.0);
        let lea = ids("e_lea", jan);
        assert!(!lea.contains(&"franchise_not_allowed"), "franchise d'enfant quittée par l'avis : {lea:?}");
    }

    #[test]
    fn subside_de_l_avis_remplace_celui_de_la_fiche() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_health(&conn, "e1", 300.0);
        upsert_policy_inner(&conn, &HealthPolicy { engagement_id: "e1".into(), kind: "basic".into(), subsidy_monthly: Some(100.0), ..Default::default() }).unwrap();
        let n = save_notice_inner(&conn, &PremiumNotice {
            engagement_id: "e1".into(), year: 2027, monthly_premium: Some(420.0), subsidy_monthly: Some(60.0), decision: "keep".into(), ..Default::default()
        }).unwrap();
        let amount: f64 = conn.query_row("SELECT amount FROM engagement_revisions WHERE id = ?1", [n.revision_id.unwrap()], |r| r.get(0)).unwrap();
        assert_eq!(amount, 360.0, "420 − le NOUVEAU subside de 60");
        let o = overview_inner(&conn, "e1", date(2027, 2, 1)).unwrap();
        assert_eq!(o.policy.unwrap().subsidy_monthly, Some(60.0));
    }

    #[test]
    fn changement_de_caisse_de_bout_en_bout() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        conn.execute_batch(
            "INSERT INTO creditors (id, name) VALUES ('css', 'CSS'), ('hel', 'Helsana');
             INSERT INTO household_members (id, name, relation, birth_date) VALUES ('m1', 'Sophie', 'self', '1988-04-12');",
        ).unwrap();
        insert_health(&conn, "old", 389.40);
        conn.execute("UPDATE engagements SET name = 'LAMal — Sophie (CSS)', creditor_id = 'css', attributed_to_member_id = 'm1' WHERE id = 'old'", []).unwrap();
        upsert_policy_inner(&conn, &HealthPolicy {
            engagement_id: "old".into(), kind: "basic".into(), insured_member_id: Some("m1".into()),
            franchise: Some(2500.0), model: Some("telmed".into()), accident_covered: Some(false), ..Default::default()
        }).unwrap();
        // Une complémentaire rattachée, qui suit la personne.
        conn.execute(
            "INSERT INTO engagements (id, name, engagement_type, parent_engagement_id, billing_cycle, cycle_interval, current_amount, currency, auto_pay, status)
             VALUES ('lca', 'LCA — Sophie', 'insurance_health', 'old', 'monthly', 1, 38.5, 'CHF', 1, 'active')",
            [],
        ).unwrap();
        save_notice_inner(&conn, &PremiumNotice { engagement_id: "old".into(), year: 2027, monthly_premium: Some(421.6), decision: "pending".into(), ..Default::default() }).unwrap();

        let new_id = switch_insurer_inner(&conn, &SwitchInsurerInput {
            engagement_id: "old".into(), year: 2027, creditor_id: Some("hel".into()),
            policy_number: Some("H-77".into()), monthly_premium: 372.10, franchise: Some(2000.0),
            move_supplementary: true, ..Default::default()
        }).unwrap();

        // L'ancienne : avis « je change », sans révision, fin au 31.12.2026.
        let old_notice = notice_for_year(&conn, "old", 2027).unwrap().unwrap();
        assert_eq!(old_notice.decision, "switch_insurer");
        assert!(old_notice.revision_id.is_none());
        let ended: Option<String> = conn.query_row("SELECT ended_on FROM engagements WHERE id = 'old'", [], |r| r.get(0)).unwrap();
        assert_eq!(ended.as_deref(), Some("2026-12-31"));

        // La nouvelle : nom, montant, dates, personne, termes repris ou changés.
        let (name, amount, start, member, parent_of_lca): (String, f64, String, Option<String>, String) = conn.query_row(
            "SELECT e.name, e.current_amount, e.contract_start_date, e.attributed_to_member_id,
                    (SELECT parent_engagement_id FROM engagements WHERE id = 'lca')
             FROM engagements e WHERE e.id = ?1", [&new_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        ).unwrap();
        assert_eq!(name, "LAMal — Sophie (Helsana)");
        assert_eq!(amount, 372.10);
        assert_eq!(start, "2027-01-01");
        assert_eq!(member.as_deref(), Some("m1"));
        assert_eq!(parent_of_lca, new_id);
        let planned: (String, f64) = conn.query_row(
            "SELECT due_date, amount FROM engagement_charges WHERE engagement_id = ?1", [&new_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).unwrap();
        assert_eq!(planned, ("2027-01-01".to_string(), 372.10), "première facture de la nouvelle caisse planifiée");
        let p = get_policy_inner(&conn, &new_id).unwrap().unwrap();
        assert_eq!(p.franchise, Some(2000.0));
        assert_eq!(p.model.as_deref(), Some("telmed"), "repris de l'ancienne");
        assert_eq!(p.accident_covered, Some(false));

        // Les deux fiches disent où l'on en est.
        let nov = date(2026, 12, 5);
        let ids_new: Vec<&str> = overview_inner(&conn, &new_id, nov).unwrap().findings.iter().map(|f| f.id).collect();
        assert!(ids_new.contains(&"affiliation_pending"), "{ids_new:?}");
        let ids_old: Vec<&str> = overview_inner(&conn, "old", nov).unwrap().findings.iter().map(|f| f.id).collect();
        assert!(ids_old.contains(&"replaced"), "{ids_old:?}");
        // La nouvelle n'attend aucun avis cet automne.
        let season = season_inner(&conn, nov).unwrap();
        assert!(season.policies.iter().all(|p| p.engagement_id != new_id));

        // Confirmation reçue : le constat disparaît.
        upsert_policy_inner(&conn, &HealthPolicy { affiliation_confirmed_on: Some("2026-12-10".into()), ..p }).unwrap();
        let ids_new: Vec<&str> = overview_inner(&conn, &new_id, nov).unwrap().findings.iter().map(|f| f.id).collect();
        assert!(!ids_new.contains(&"affiliation_pending"));
    }

    #[test]
    fn tiers_garant_cree_un_remboursement_et_le_retire_avec_le_decompte() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        conn.execute("INSERT INTO creditors (id, name) VALUES ('css', 'CSS')", []).unwrap();
        insert_health(&conn, "e1", 400.0);
        conn.execute("UPDATE engagements SET creditor_id = 'css' WHERE id = 'e1'", []).unwrap();
        let claims = add_claims_inner(&conn, &[
            HealthClaim { engagement_id: "e1".into(), treatment_date: Some("2026-05-14".into()), provider: Some("Dr Favre".into()),
                invoiced: 500.0, insurer_paid: 420.0, quote_part: 50.0, franchise: 30.0, billing_mode: Some("tiers_garant".into()), ..Default::default() },
            HealthClaim { engagement_id: "e1".into(), treatment_date: Some("2026-05-20".into()), provider: Some("Hôpital".into()),
                invoiced: 3000.0, insurer_paid: 2700.0, quote_part: 300.0, billing_mode: Some("tiers_payant".into()), ..Default::default() },
        ]).unwrap();
        let rid = claims[0].reimbursement_id.clone().expect("remboursement créé");
        assert!(claims[1].reimbursement_id.is_none(), "tiers payant : la caisse a déjà payé");
        let (amount, kind, debtor): (f64, String, Option<String>) = conn.query_row(
            "SELECT expected_amount, reimbursement_type, debtor_creditor_id FROM pending_reimbursements WHERE id = ?1",
            [&rid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).unwrap();
        assert_eq!((amount, kind.as_str(), debtor.as_deref()), (420.0, "insurance_claim", Some("css")));

        delete_claim_inner(&conn, &claims[0].id).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM pending_reimbursements", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);

        // Un lot invalide n'écrit rien.
        let bad = add_claims_inner(&conn, &[
            HealthClaim { engagement_id: "e1".into(), invoiced: 10.0, ..Default::default() },
            HealthClaim { engagement_id: "e1".into(), invoiced: -1.0, ..Default::default() },
        ]);
        assert!(bad.is_err());
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM health_claims", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn complementaire_sur_la_facture_reste_chez_l_ancienne_caisse() {
        let (_tmp, db) = open_db();
        let conn = db.conn.lock().unwrap();
        insert_health(&conn, "old", 389.40);
        upsert_policy_inner(&conn, &HealthPolicy { engagement_id: "old".into(), kind: "basic".into(), franchise: Some(300.0), ..Default::default() }).unwrap();
        conn.execute(
            "INSERT INTO engagements (id, name, engagement_type, parent_engagement_id, billing_cycle, cycle_interval, current_amount, currency, auto_pay, status)
             VALUES ('lca', 'LCA', 'insurance_health', 'old', 'monthly', 1, 38.5, 'CHF', 1, 'active')",
            [],
        ).unwrap();
        crate::commands::engagements::set_billed_with_parent_inner(&conn, "lca", true).unwrap();
        let new_id = switch_insurer_inner(&conn, &SwitchInsurerInput {
            engagement_id: "old".into(), year: 2027, monthly_premium: 372.10, move_supplementary: true, ..Default::default()
        }).unwrap();
        let parent: String = conn.query_row("SELECT parent_engagement_id FROM engagements WHERE id = 'lca'", [], |r| r.get(0)).unwrap();
        assert_eq!(parent, "old");
        let planned: f64 = conn.query_row("SELECT amount FROM engagement_charges WHERE engagement_id = ?1", [&new_id], |r| r.get(0)).unwrap();
        assert_eq!(planned, 372.10, "la nouvelle caisse ne facture pas la LCA de l'ancienne");
    }
}

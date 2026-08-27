//! Contrôle de bulletins de salaire et consolidation fiscale annuelle.
//!
//! Ce module est la couche de traduction entre la base (lignes SQLite) et le
//! moteur `crate::payroll`, qui lui ne connaît que des structures pures. Il
//! porte en plus la logique qui a besoin de plusieurs lignes à la fois : le
//! cumul annuel (indispensable pour le plafond AC), la reconstitution d'un
//! certificat de salaire à partir des douze bulletins, et sa confrontation
//! avec le certificat reçu de l'employeur.
//!
//! Une nuance structurante du droit suisse traverse tout le fichier :
//! **l'assiette AVS et l'assiette fiscale ne sont pas la même chose**. Les
//! allocations familiales sont imposables mais pas soumises aux cotisations
//! (art. 6 RAVS) ; les frais remboursés ne sont ni l'un ni l'autre
//! (art. 327a CO). Les cotisations se calculent donc sur une base plus
//! étroite que le salaire brut du certificat.

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::commands::auth::AppState;
use crate::db::models::{EmploymentContract, IncomeReceipt, SalaryCertificate};
use crate::payroll::{
    self, check_payslip, known_years, params_for_year, EmploymentTerms, ExpectedDeductions,
    Finding, PayrollParams, PayslipInput, YtdContext,
};

// ===========================================================================
// Barèmes
// ===========================================================================

/// Barèmes d'une année, plus la liste des années effectivement publiées dans
/// l'application — le front s'en sert pour son sélecteur d'année sans coder
/// la liste une seconde fois.
#[derive(Debug, Serialize)]
pub struct PayrollParamsResponse {
    #[serde(flatten)]
    pub params: PayrollParams,
    pub known_years: Vec<i32>,
}

#[tauri::command]
pub fn get_payroll_params(year: i32) -> Result<PayrollParamsResponse, String> {
    Ok(PayrollParamsResponse {
        params: params_for_year(year),
        known_years: known_years(),
    })
}

// ===========================================================================
// Contrat de travail
// ===========================================================================

const CONTRACT_COLUMNS: &str = "id, income_id, employer_name, employer_uid, avs_number,
     birth_date, work_canton, activity_rate_pct, annual_gross_agreed,
     salary_periods_per_year, weekly_hours, hourly_paid, thirteenth_salary,
     lpp_fund_name, lpp_employee_share_pct, laa_insurer, laa_nonoccupational_pct,
     ijm_employee_pct, tax_at_source, tax_at_source_scale,
     company_car_purchase_price, subsidized_canteen, commute_km_per_day,
     commute_public_transport_cost_year, started_on, ended_on, notes,
     created_at, updated_at";

fn row_to_contract(row: &rusqlite::Row<'_>) -> rusqlite::Result<EmploymentContract> {
    Ok(EmploymentContract {
        id: row.get(0)?,
        income_id: row.get(1)?,
        employer_name: row.get(2)?,
        employer_uid: row.get(3)?,
        avs_number: row.get(4)?,
        birth_date: row.get(5)?,
        work_canton: row.get(6)?,
        activity_rate_pct: row.get(7)?,
        annual_gross_agreed: row.get(8)?,
        salary_periods_per_year: row.get(9)?,
        weekly_hours: row.get(10)?,
        hourly_paid: row.get::<_, i64>(11)? != 0,
        thirteenth_salary: row.get::<_, i64>(12)? != 0,
        lpp_fund_name: row.get(13)?,
        lpp_employee_share_pct: row.get(14)?,
        laa_insurer: row.get(15)?,
        laa_nonoccupational_pct: row.get(16)?,
        ijm_employee_pct: row.get(17)?,
        tax_at_source: row.get::<_, i64>(18)? != 0,
        tax_at_source_scale: row.get(19)?,
        company_car_purchase_price: row.get(20)?,
        subsidized_canteen: row.get::<_, i64>(21)? != 0,
        commute_km_per_day: row.get(22)?,
        commute_public_transport_cost_year: row.get(23)?,
        started_on: row.get(24)?,
        ended_on: row.get(25)?,
        notes: row.get(26)?,
        created_at: row.get(27)?,
        updated_at: row.get(28)?,
    })
}

#[tauri::command]
pub fn get_employment_contract(
    state: State<'_, AppState>,
    income_id: String,
) -> Result<Option<EmploymentContract>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    load_contract(&conn, &income_id)
}

fn load_contract(
    conn: &rusqlite::Connection,
    income_id: &str,
) -> Result<Option<EmploymentContract>, String> {
    let sql = format!(
        "SELECT {} FROM employment_contracts WHERE income_id = ?1",
        CONTRACT_COLUMNS
    );
    match conn.query_row(&sql, [income_id], row_to_contract) {
        Ok(c) => Ok(Some(c)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Crée ou remplace le contrat d'un revenu. Un revenu = un employeur, donc
/// `ON CONFLICT(income_id)` plutôt qu'un create/update séparés côté front.
#[tauri::command]
pub fn upsert_employment_contract(
    state: State<'_, AppState>,
    contract: EmploymentContract,
) -> Result<EmploymentContract, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = if contract.id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        contract.id.clone()
    };

    conn.execute(
        "INSERT INTO employment_contracts (
            id, income_id, employer_name, employer_uid, avs_number, birth_date,
            work_canton, activity_rate_pct, annual_gross_agreed,
            salary_periods_per_year, weekly_hours, hourly_paid, thirteenth_salary,
            lpp_fund_name, lpp_employee_share_pct, laa_insurer,
            laa_nonoccupational_pct, ijm_employee_pct, tax_at_source,
            tax_at_source_scale, company_car_purchase_price, subsidized_canteen,
            commute_km_per_day, commute_public_transport_cost_year,
            started_on, ended_on, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)
         ON CONFLICT(income_id) DO UPDATE SET
            employer_name = excluded.employer_name,
            employer_uid = excluded.employer_uid,
            avs_number = excluded.avs_number,
            birth_date = excluded.birth_date,
            work_canton = excluded.work_canton,
            activity_rate_pct = excluded.activity_rate_pct,
            annual_gross_agreed = excluded.annual_gross_agreed,
            salary_periods_per_year = excluded.salary_periods_per_year,
            weekly_hours = excluded.weekly_hours,
            hourly_paid = excluded.hourly_paid,
            thirteenth_salary = excluded.thirteenth_salary,
            lpp_fund_name = excluded.lpp_fund_name,
            lpp_employee_share_pct = excluded.lpp_employee_share_pct,
            laa_insurer = excluded.laa_insurer,
            laa_nonoccupational_pct = excluded.laa_nonoccupational_pct,
            ijm_employee_pct = excluded.ijm_employee_pct,
            tax_at_source = excluded.tax_at_source,
            tax_at_source_scale = excluded.tax_at_source_scale,
            company_car_purchase_price = excluded.company_car_purchase_price,
            subsidized_canteen = excluded.subsidized_canteen,
            commute_km_per_day = excluded.commute_km_per_day,
            commute_public_transport_cost_year = excluded.commute_public_transport_cost_year,
            started_on = excluded.started_on,
            ended_on = excluded.ended_on,
            notes = excluded.notes,
            updated_at = datetime('now')",
        rusqlite::params![
            id,
            contract.income_id,
            contract.employer_name,
            contract.employer_uid,
            contract.avs_number,
            contract.birth_date,
            contract.work_canton,
            contract.activity_rate_pct,
            contract.annual_gross_agreed,
            contract.salary_periods_per_year,
            contract.weekly_hours,
            contract.hourly_paid as i64,
            contract.thirteenth_salary as i64,
            contract.lpp_fund_name,
            contract.lpp_employee_share_pct,
            contract.laa_insurer,
            contract.laa_nonoccupational_pct,
            contract.ijm_employee_pct,
            contract.tax_at_source as i64,
            contract.tax_at_source_scale,
            contract.company_car_purchase_price,
            contract.subsidized_canteen as i64,
            contract.commute_km_per_day,
            contract.commute_public_transport_cost_year,
            contract.started_on,
            contract.ended_on,
            contract.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    load_contract(&conn, &contract.income_id)?
        .ok_or_else(|| "Contrat introuvable après enregistrement".to_string())
}

// ===========================================================================
// Traduction base → moteur
// ===========================================================================

impl From<&EmploymentContract> for EmploymentTerms {
    fn from(c: &EmploymentContract) -> Self {
        EmploymentTerms {
            birth_date: c.birth_date.clone(),
            activity_rate_pct: c.activity_rate_pct,
            weekly_hours: c.weekly_hours,
            annual_gross_agreed: c.annual_gross_agreed,
            salary_periods_per_year: c.salary_periods_per_year,
            hourly_paid: c.hourly_paid,
            lpp_employee_share_pct: c.lpp_employee_share_pct,
            laa_nonoccupational_pct: c.laa_nonoccupational_pct,
            ijm_employee_pct: c.ijm_employee_pct,
            tax_at_source: c.tax_at_source,
            company_car_purchase_price: c.company_car_purchase_price,
            subsidized_canteen: c.subsidized_canteen,
            thirteenth_salary: c.thirteenth_salary,
        }
    }
}

/// Année fiscale d'un versement : celle de la période couverte si elle est
/// connue, sinon celle de l'encaissement.
fn receipt_year(r: &IncomeReceipt) -> i32 {
    r.fiscal_year.unwrap_or_else(|| {
        r.period_end
            .as_deref()
            .or(r.period_start.as_deref())
            .unwrap_or(r.received_on.as_str())
            .get(0..4)
            .and_then(|y| y.parse().ok())
            .unwrap_or(0)
    })
}

/// Date servant à ordonner les versements dans l'année : la fin de période
/// prime sur l'encaissement, pour que le salaire de décembre versé en janvier
/// se range en décembre.
fn receipt_sort_key(r: &IncomeReceipt) -> String {
    r.period_end
        .clone()
        .or_else(|| r.period_start.clone())
        .unwrap_or_else(|| r.received_on.clone())
}

fn to_payslip_input(r: &IncomeReceipt) -> PayslipInput {
    PayslipInput {
        fiscal_year: receipt_year(r),
        net_paid: r.amount,
        base_salary: r.base_salary_amount,
        thirteenth: r.thirteenth_amount,
        overtime: r.overtime_amount,
        overtime_hours: r.overtime_hours,
        holiday_pay: r.holiday_pay_amount,
        bonus: r.bonus_amount,
        benefits_in_kind: r.benefits_in_kind_amount,
        company_car_private: r.company_car_private_amount,
        family_allowance: r.family_allowance_amount,
        other_gross: r.other_gross_amount,
        gross_total: r.gross_amount,
        avs_ai_apg: r.social_charges_amount,
        ac: r.ac_amount,
        ac_solidarity: r.ac_solidarity_amount,
        lpp: r.pension_amount,
        laa_nonoccupational: r.laa_nonoccupational_amount,
        ijm: r.ijm_amount,
        tax_at_source: r.tax_at_source_amount,
        other_deductions: r.other_deductions_amount,
        expense_reimbursement: r.expense_reimbursement_amount,
        expense_lump_sum: r.expense_lump_sum_amount,
    }
}

fn load_receipts(
    conn: &rusqlite::Connection,
    income_id: &str,
) -> Result<Vec<IncomeReceipt>, String> {
    let sql = format!(
        "SELECT {} FROM income_receipts WHERE income_id = ?1",
        crate::commands::incomes::RECEIPT_SELECT_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([income_id], crate::commands::incomes::row_to_receipt)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Salaire déterminant AVS déjà versé dans l'année AVANT une période donnée.
///
/// Le plafond de l'assurance-chômage est annuel : sans ce cumul, un haut
/// salaire se verrait réclamer des cotisations AC toute l'année alors qu'il
/// a franchi le plafond en septembre.
fn ytd_before(receipts: &[IncomeReceipt], year: i32, sort_key: &str, exclude_id: &str) -> f64 {
    receipts
        .iter()
        .filter(|r| receipt_year(r) == year && r.id != exclude_id)
        .filter(|r| receipt_sort_key(r).as_str() < sort_key)
        .map(|r| payroll::avs_subject_gross(&to_payslip_input(r)))
        .sum()
}

// ===========================================================================
// Contrôle d'un bulletin
// ===========================================================================

/// Résultat complet d'un contrôle : les constats, les montants attendus et
/// les barèmes utilisés — le front affiche les trois ensemble pour que
/// l'utilisateur puisse refaire le calcul à la main s'il le souhaite.
#[derive(Debug, Serialize)]
pub struct PayslipReport {
    pub findings: Vec<Finding>,
    pub expected: ExpectedDeductions,
    pub params: PayrollParams,
    /// Cumul annuel avant cette période, tel qu'utilisé pour le plafond AC.
    pub ytd_before: f64,
    /// `false` quand aucun contrat n'est enregistré : plusieurs contrôles
    /// sont alors impossibles, et l'UI doit inviter à le remplir.
    pub has_contract: bool,
}

fn build_report(
    conn: &rusqlite::Connection,
    income_id: &str,
    input: PayslipInput,
    sort_key: &str,
    exclude_id: &str,
) -> Result<PayslipReport, String> {
    let contract = load_contract(conn, income_id)?;
    let terms = contract
        .as_ref()
        .map(EmploymentTerms::from)
        .unwrap_or_default();

    let receipts = load_receipts(conn, income_id)?;
    let ytd = ytd_before(&receipts, input.fiscal_year, sort_key, exclude_id);

    let periods = terms.salary_periods_per_year.unwrap_or(12).max(1) as f64;
    let ctx = YtdContext {
        avs_gross_before: ytd,
        periods_per_year: periods,
    };

    let params = params_for_year(input.fiscal_year);
    let expected = payroll::expected_deductions(&input, &terms, &ctx, &params);
    let findings = check_payslip(&input, &terms, &ctx, &params);

    Ok(PayslipReport {
        findings,
        expected,
        params,
        ytd_before: ytd,
        has_contract: contract.is_some(),
    })
}

/// Contrôle un bulletin déjà enregistré.
#[tauri::command]
pub fn check_income_receipt(
    state: State<'_, AppState>,
    receipt_id: String,
) -> Result<PayslipReport, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sql = format!(
        "SELECT {} FROM income_receipts WHERE id = ?1",
        crate::commands::incomes::RECEIPT_SELECT_COLUMNS
    );
    let receipt: IncomeReceipt = conn
        .query_row(&sql, [&receipt_id], crate::commands::incomes::row_to_receipt)
        .map_err(|e| e.to_string())?;

    let income_id = receipt.income_id.clone();
    let sort_key = receipt_sort_key(&receipt);
    build_report(
        &conn,
        &income_id,
        to_payslip_input(&receipt),
        &sort_key,
        &receipt.id,
    )
}

/// Contrôle un bulletin en cours de saisie, avant enregistrement. Le front
/// appelle cette commande pendant que l'utilisateur remplit le formulaire.
#[tauri::command]
pub fn preview_payslip_check(
    state: State<'_, AppState>,
    income_id: String,
    draft: IncomeReceipt,
) -> Result<PayslipReport, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let sort_key = receipt_sort_key(&draft);
    let exclude = draft.id.clone();
    build_report(
        &conn,
        &income_id,
        to_payslip_input(&draft),
        &sort_key,
        &exclude,
    )
}

// ===========================================================================
// Certificat de salaire
// ===========================================================================

const CERTIFICATE_COLUMNS: &str = "id, income_id, fiscal_year,
     r1_salary, r2_1_benefits_in_kind, r2_2_company_car, r2_3_other_benefits,
     r3_irregular, r4_capital_shares, r5_board_fees, r6_other_benefits,
     r7_other_payments, r8_gross_total, r9_social_contributions,
     r10_1_lpp_ordinary, r10_2_lpp_buyback, r11_net_salary, r12_tax_at_source,
     r13_1_effective_expenses, r13_2_lump_sum_expenses, r14_other_disclosures,
     r15_remarks, box_f_employer_transport, box_g_free_meals, received_on,
     origin, notes, created_at, updated_at";

fn row_to_certificate(row: &rusqlite::Row<'_>) -> rusqlite::Result<SalaryCertificate> {
    Ok(SalaryCertificate {
        id: row.get(0)?,
        income_id: row.get(1)?,
        fiscal_year: row.get(2)?,
        r1_salary: row.get(3)?,
        r2_1_benefits_in_kind: row.get(4)?,
        r2_2_company_car: row.get(5)?,
        r2_3_other_benefits: row.get(6)?,
        r3_irregular: row.get(7)?,
        r4_capital_shares: row.get(8)?,
        r5_board_fees: row.get(9)?,
        r6_other_benefits: row.get(10)?,
        r7_other_payments: row.get(11)?,
        r8_gross_total: row.get(12)?,
        r9_social_contributions: row.get(13)?,
        r10_1_lpp_ordinary: row.get(14)?,
        r10_2_lpp_buyback: row.get(15)?,
        r11_net_salary: row.get(16)?,
        r12_tax_at_source: row.get(17)?,
        r13_1_effective_expenses: row.get(18)?,
        r13_2_lump_sum_expenses: row.get(19)?,
        r14_other_disclosures: row.get(20)?,
        r15_remarks: row.get(21)?,
        box_f_employer_transport: row.get::<_, i64>(22)? != 0,
        box_g_free_meals: row.get::<_, i64>(23)? != 0,
        received_on: row.get(24)?,
        origin: row.get(25)?,
        notes: row.get(26)?,
        created_at: row.get(27)?,
        updated_at: row.get(28)?,
    })
}

#[tauri::command]
pub fn get_salary_certificate(
    state: State<'_, AppState>,
    income_id: String,
    year: i32,
) -> Result<Option<SalaryCertificate>, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    load_certificate(&conn, &income_id, year)
}

fn load_certificate(
    conn: &rusqlite::Connection,
    income_id: &str,
    year: i32,
) -> Result<Option<SalaryCertificate>, String> {
    let sql = format!(
        "SELECT {} FROM annual_salary_certificates WHERE income_id = ?1 AND fiscal_year = ?2",
        CERTIFICATE_COLUMNS
    );
    match conn.query_row(&sql, rusqlite::params![income_id, year], row_to_certificate) {
        Ok(c) => Ok(Some(c)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn upsert_salary_certificate(
    state: State<'_, AppState>,
    certificate: SalaryCertificate,
) -> Result<SalaryCertificate, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let id = if certificate.id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        certificate.id.clone()
    };
    let origin = if certificate.origin.is_empty() {
        "manual".to_string()
    } else {
        certificate.origin.clone()
    };

    conn.execute(
        "INSERT INTO annual_salary_certificates (
            id, income_id, fiscal_year, r1_salary, r2_1_benefits_in_kind,
            r2_2_company_car, r2_3_other_benefits, r3_irregular, r4_capital_shares,
            r5_board_fees, r6_other_benefits, r7_other_payments, r8_gross_total,
            r9_social_contributions, r10_1_lpp_ordinary, r10_2_lpp_buyback,
            r11_net_salary, r12_tax_at_source, r13_1_effective_expenses,
            r13_2_lump_sum_expenses, r14_other_disclosures, r15_remarks,
            box_f_employer_transport, box_g_free_meals, received_on, origin, notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                 ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)
         ON CONFLICT(income_id, fiscal_year) DO UPDATE SET
            r1_salary = excluded.r1_salary,
            r2_1_benefits_in_kind = excluded.r2_1_benefits_in_kind,
            r2_2_company_car = excluded.r2_2_company_car,
            r2_3_other_benefits = excluded.r2_3_other_benefits,
            r3_irregular = excluded.r3_irregular,
            r4_capital_shares = excluded.r4_capital_shares,
            r5_board_fees = excluded.r5_board_fees,
            r6_other_benefits = excluded.r6_other_benefits,
            r7_other_payments = excluded.r7_other_payments,
            r8_gross_total = excluded.r8_gross_total,
            r9_social_contributions = excluded.r9_social_contributions,
            r10_1_lpp_ordinary = excluded.r10_1_lpp_ordinary,
            r10_2_lpp_buyback = excluded.r10_2_lpp_buyback,
            r11_net_salary = excluded.r11_net_salary,
            r12_tax_at_source = excluded.r12_tax_at_source,
            r13_1_effective_expenses = excluded.r13_1_effective_expenses,
            r13_2_lump_sum_expenses = excluded.r13_2_lump_sum_expenses,
            r14_other_disclosures = excluded.r14_other_disclosures,
            r15_remarks = excluded.r15_remarks,
            box_f_employer_transport = excluded.box_f_employer_transport,
            box_g_free_meals = excluded.box_g_free_meals,
            received_on = excluded.received_on,
            origin = excluded.origin,
            notes = excluded.notes,
            updated_at = datetime('now')",
        rusqlite::params![
            id,
            certificate.income_id,
            certificate.fiscal_year,
            certificate.r1_salary,
            certificate.r2_1_benefits_in_kind,
            certificate.r2_2_company_car,
            certificate.r2_3_other_benefits,
            certificate.r3_irregular,
            certificate.r4_capital_shares,
            certificate.r5_board_fees,
            certificate.r6_other_benefits,
            certificate.r7_other_payments,
            certificate.r8_gross_total,
            certificate.r9_social_contributions,
            certificate.r10_1_lpp_ordinary,
            certificate.r10_2_lpp_buyback,
            certificate.r11_net_salary,
            certificate.r12_tax_at_source,
            certificate.r13_1_effective_expenses,
            certificate.r13_2_lump_sum_expenses,
            certificate.r14_other_disclosures,
            certificate.r15_remarks,
            certificate.box_f_employer_transport as i64,
            certificate.box_g_free_meals as i64,
            certificate.received_on,
            origin,
            certificate.notes,
        ],
    )
    .map_err(|e| e.to_string())?;

    load_certificate(&conn, &certificate.income_id, certificate.fiscal_year)?
        .ok_or_else(|| "Certificat introuvable après enregistrement".to_string())
}

/// Reconstitue un certificat de salaire à partir des bulletins de l'année.
///
/// Le résultat n'est PAS enregistré : c'est la colonne « calculé » qu'on met
/// en regard du certificat reçu de l'employeur.
///
/// Correspondances retenues :
///   1    salaire en espèces — y compris allocations familiales, qui sont
///        imposables même si elles échappent aux cotisations (art. 6 RAVS)
///   2.1  prestations en nature
///   2.2  part privée du véhicule de service
///   3    prestations non périodiques (bonus)
///   8    total des rubriques 1 à 7
///   9    AVS/AI/APG + AC + solidarité + AANP. Les primes d'indemnités
///        journalières maladie n'y figurent pas : elles ne font pas partie
///        des cotisations sociales du certificat.
///   10.1 cotisations LPP ordinaires
///   11   8 − 9 − 10.1 − 10.2, soit le net qui part dans la déclaration
///   13.1 / 13.2  frais effectifs / forfaitaires (art. 327a CO)
fn compute_certificate(receipts: &[IncomeReceipt], income_id: &str, year: i32) -> SalaryCertificate {
    let of_year: Vec<&IncomeReceipt> = receipts
        .iter()
        .filter(|r| receipt_year(r) == year)
        .collect();

    let sum = |f: fn(&IncomeReceipt) -> Option<f64>| -> f64 {
        of_year.iter().filter_map(|r| f(r)).sum()
    };

    let cash = sum(|r| r.base_salary_amount)
        + sum(|r| r.thirteenth_amount)
        + sum(|r| r.overtime_amount)
        + sum(|r| r.holiday_pay_amount)
        + sum(|r| r.other_gross_amount)
        + sum(|r| r.family_allowance_amount);
    let benefits_in_kind = sum(|r| r.benefits_in_kind_amount);
    let company_car = sum(|r| r.company_car_private_amount);
    let irregular = sum(|r| r.bonus_amount);

    // Quand les composantes n'ont pas été détaillées, le brut imprimé sur les
    // bulletins reste la meilleure source pour la rubrique 8.
    let printed_gross = sum(|r| r.gross_amount);
    let composed_gross = cash + benefits_in_kind + company_car + irregular;
    let gross_total = if composed_gross > 0.0 {
        composed_gross
    } else {
        printed_gross
    };

    let social = sum(|r| r.social_charges_amount)
        + sum(|r| r.ac_amount)
        + sum(|r| r.ac_solidarity_amount)
        + sum(|r| r.laa_nonoccupational_amount);
    let lpp = sum(|r| r.pension_amount);
    let tax_at_source = sum(|r| r.tax_at_source_amount);
    let effective_expenses = sum(|r| r.expense_reimbursement_amount);
    let lump_sum_expenses = sum(|r| r.expense_lump_sum_amount);

    SalaryCertificate {
        id: String::new(),
        income_id: income_id.to_string(),
        fiscal_year: year,
        r1_salary: Some(if composed_gross > 0.0 { cash } else { printed_gross }),
        r2_1_benefits_in_kind: Some(benefits_in_kind),
        r2_2_company_car: Some(company_car),
        r2_3_other_benefits: Some(0.0),
        r3_irregular: Some(irregular),
        r4_capital_shares: Some(0.0),
        r5_board_fees: Some(0.0),
        r6_other_benefits: Some(0.0),
        r7_other_payments: Some(0.0),
        r8_gross_total: Some(gross_total),
        r9_social_contributions: Some(social),
        r10_1_lpp_ordinary: Some(lpp),
        r10_2_lpp_buyback: Some(0.0),
        r11_net_salary: Some(gross_total - social - lpp),
        r12_tax_at_source: Some(tax_at_source),
        r13_1_effective_expenses: Some(effective_expenses),
        r13_2_lump_sum_expenses: Some(lump_sum_expenses),
        r14_other_disclosures: Some(0.0),
        r15_remarks: None,
        box_f_employer_transport: company_car > 0.0,
        box_g_free_meals: false,
        received_on: None,
        origin: "computed".to_string(),
        notes: None,
        created_at: String::new(),
        updated_at: String::new(),
    }
}

#[tauri::command]
pub fn compute_salary_certificate(
    state: State<'_, AppState>,
    income_id: String,
    year: i32,
) -> Result<SalaryCertificate, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;
    let receipts = load_receipts(&conn, &income_id)?;
    Ok(compute_certificate(&receipts, &income_id, year))
}

/// Écart sur une rubrique entre le certificat calculé et celui reçu.
#[derive(Debug, Serialize)]
pub struct CertificateDiff {
    /// Numéro de rubrique tel qu'imprimé sur le formulaire ("8", "10.1"…).
    pub rubric: &'static str,
    pub label: &'static str,
    pub computed: Option<f64>,
    pub declared: Option<f64>,
    pub difference: Option<f64>,
    /// `true` quand l'écart dépasse la tolérance d'arrondi.
    pub mismatch: bool,
}

#[derive(Debug, Serialize)]
pub struct CertificateReconciliation {
    pub year: i32,
    pub computed: SalaryCertificate,
    pub declared: Option<SalaryCertificate>,
    pub diffs: Vec<CertificateDiff>,
    /// Nombre de bulletins de l'année pris en compte — un chiffre bas
    /// explique un écart bien mieux qu'une alerte sur chaque rubrique.
    pub receipt_count: usize,
}

/// Confronte le certificat reçu aux douze bulletins.
#[tauri::command]
pub fn reconcile_salary_certificate(
    state: State<'_, AppState>,
    income_id: String,
    year: i32,
) -> Result<CertificateReconciliation, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let receipts = load_receipts(&conn, &income_id)?;
    let receipt_count = receipts.iter().filter(|r| receipt_year(r) == year).count();
    let computed = compute_certificate(&receipts, &income_id, year);
    let declared = load_certificate(&conn, &income_id, year)?;

    // Un franc d'écart sur un total annuel, c'est de l'arrondi ; au-delà,
    // c'est une ligne oubliée d'un côté ou de l'autre.
    let rubrics: Vec<(&'static str, &'static str, Option<f64>, Option<f64>)> = match &declared {
        None => Vec::new(),
        Some(d) => vec![
            ("1", "Salaire brut", computed.r1_salary, d.r1_salary),
            (
                "2.1",
                "Prestations en nature",
                computed.r2_1_benefits_in_kind,
                d.r2_1_benefits_in_kind,
            ),
            (
                "2.2",
                "Part privée du véhicule",
                computed.r2_2_company_car,
                d.r2_2_company_car,
            ),
            (
                "3",
                "Prestations non périodiques",
                computed.r3_irregular,
                d.r3_irregular,
            ),
            (
                "8",
                "Salaire brut total",
                computed.r8_gross_total,
                d.r8_gross_total,
            ),
            (
                "9",
                "Cotisations AVS/AI/APG/AC/AANP",
                computed.r9_social_contributions,
                d.r9_social_contributions,
            ),
            (
                "10.1",
                "Cotisations LPP ordinaires",
                computed.r10_1_lpp_ordinary,
                d.r10_1_lpp_ordinary,
            ),
            (
                "11",
                "Salaire net",
                computed.r11_net_salary,
                d.r11_net_salary,
            ),
            (
                "12",
                "Impôt à la source",
                computed.r12_tax_at_source,
                d.r12_tax_at_source,
            ),
            (
                "13.1",
                "Frais effectifs",
                computed.r13_1_effective_expenses,
                d.r13_1_effective_expenses,
            ),
            (
                "13.2",
                "Frais forfaitaires",
                computed.r13_2_lump_sum_expenses,
                d.r13_2_lump_sum_expenses,
            ),
        ],
    };

    let diffs = rubrics
        .into_iter()
        .map(|(rubric, label, computed, declared)| {
            let difference = match (computed, declared) {
                (Some(c), Some(d)) => Some(d - c),
                _ => None,
            };
            let mismatch = difference.map(|d| d.abs() > 1.0).unwrap_or(false);
            CertificateDiff {
                rubric,
                label,
                computed,
                declared,
                difference,
                mismatch,
            }
        })
        .collect();

    Ok(CertificateReconciliation {
        year,
        computed,
        declared,
        diffs,
        receipt_count,
    })
}

// ===========================================================================
// Synthèse fiscale annuelle
// ===========================================================================

/// Comparatif forfait / frais effectifs pour les frais professionnels.
/// Les deux branches sont rendues : c'est au contribuable de retenir la plus
/// favorable, et il ne peut le décider qu'en les voyant côte à côte.
#[derive(Debug, Serialize)]
pub struct ProfessionalExpenses {
    /// 3 % du salaire net, encadré par un plancher et un plafond (IFD).
    pub lump_sum_other_expenses: f64,
    /// Transports : abonnement effectif, ou kilométrage si le véhicule privé
    /// est justifié. Plafonné pour l'IFD.
    pub commute_claimed: f64,
    pub commute_capped: f64,
    pub commute_cap: f64,
    /// Repas pris hors du domicile, réduit de moitié si la cantine est
    /// subventionnée par l'employeur.
    pub meals: f64,
    pub meals_reduced_by_employer: bool,
    /// Somme des trois postes, après plafonnement.
    pub total: f64,
    /// Ce que le calcul n'a pas pu établir, à afficher tel quel.
    pub notes: Vec<String>,
}

/// Base imposable et déductions liées au revenu, pour une année.
#[derive(Debug, Serialize)]
pub struct IncomeTaxSummary {
    pub year: i32,
    pub params: PayrollParams,
    /// Rubrique 8 cumulée sur tous les salaires.
    pub gross_total: f64,
    /// Rubrique 9 cumulée.
    pub social_contributions: f64,
    /// Rubrique 10 cumulée.
    pub lpp_contributions: f64,
    /// Rubrique 11 cumulée — c'est ce montant qui part dans la déclaration.
    pub net_salary: f64,
    pub tax_at_source: f64,
    /// Revenus non salariaux de l'année, par type (dividendes, loyers…).
    pub other_income_by_type: Vec<OtherIncomeLine>,
    pub professional_expenses: ProfessionalExpenses,
    /// Plafond 3a applicable, selon l'affiliation LPP constatée.
    pub pillar3a_cap: f64,
    pub affiliated_to_lpp: bool,
    /// Salaires pris en compte, pour que l'utilisateur voie ce qui est
    /// consolidé et repère un revenu oublié.
    pub salary_sources: Vec<SalarySource>,
}

#[derive(Debug, Serialize)]
pub struct OtherIncomeLine {
    pub income_type: String,
    pub total: f64,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct SalarySource {
    pub income_id: String,
    pub name: String,
    pub employer_name: Option<String>,
    pub receipt_count: usize,
    pub gross_total: f64,
    pub net_salary: f64,
    pub has_contract: bool,
    pub has_declared_certificate: bool,
}

#[derive(Debug, Deserialize)]
pub struct TaxSummaryOptions {
    /// Nombre de jours travaillés retenu pour les frais de repas et de
    /// transport. 220 est l'usage (5 jours × 44 semaines).
    pub working_days: Option<f64>,
}

#[tauri::command]
pub fn get_income_tax_summary(
    state: State<'_, AppState>,
    year: i32,
    options: Option<TaxSummaryOptions>,
) -> Result<IncomeTaxSummary, String> {
    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    let params = params_for_year(year);
    let working_days = options
        .as_ref()
        .and_then(|o| o.working_days)
        .filter(|d| *d > 0.0)
        .unwrap_or(220.0);

    // --- salaires ---
    let mut stmt = conn
        .prepare("SELECT id, name FROM incomes WHERE income_type = 'salary' ORDER BY name")
        .map_err(|e| e.to_string())?;
    let salaries: Vec<(String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut gross_total = 0.0;
    let mut social_contributions = 0.0;
    let mut lpp_contributions = 0.0;
    let mut net_salary = 0.0;
    let mut tax_at_source = 0.0;
    let mut sources = Vec::new();
    // Le contrat retenu pour les frais professionnels est celui du salaire
    // principal, c'est-à-dire du plus gros brut de l'année.
    let mut main_contract: Option<(f64, EmploymentContract)> = None;

    for (income_id, name) in salaries {
        let receipts = load_receipts(&conn, &income_id)?;
        let count = receipts.iter().filter(|r| receipt_year(r) == year).count();
        let computed = compute_certificate(&receipts, &income_id, year);
        let declared = load_certificate(&conn, &income_id, year)?;
        let contract = load_contract(&conn, &income_id)?;

        // Le certificat de l'employeur fait foi dès qu'il est enregistré :
        // c'est lui que l'administration fiscale recevra.
        let effective = declared.as_ref().unwrap_or(&computed);
        let g = effective.r8_gross_total.unwrap_or(0.0);
        let s = effective.r9_social_contributions.unwrap_or(0.0);
        let l = effective.r10_1_lpp_ordinary.unwrap_or(0.0)
            + effective.r10_2_lpp_buyback.unwrap_or(0.0);
        let n = effective.r11_net_salary.unwrap_or(g - s - l);

        if count == 0 && declared.is_none() {
            continue;
        }

        gross_total += g;
        social_contributions += s;
        lpp_contributions += l;
        net_salary += n;
        tax_at_source += effective.r12_tax_at_source.unwrap_or(0.0);

        if let Some(c) = contract.clone() {
            if main_contract.as_ref().map(|(gg, _)| g > *gg).unwrap_or(true) {
                main_contract = Some((g, c));
            }
        }

        sources.push(SalarySource {
            income_id,
            name,
            employer_name: contract.as_ref().and_then(|c| c.employer_name.clone()),
            receipt_count: count,
            gross_total: g,
            net_salary: n,
            has_contract: contract.is_some(),
            has_declared_certificate: declared.is_some(),
        });
    }

    // --- autres revenus de l'année ---
    let mut stmt = conn
        .prepare(
            "SELECT i.income_type, COALESCE(SUM(r.amount), 0), COUNT(r.id)
             FROM income_receipts r
             JOIN incomes i ON i.id = r.income_id
             WHERE i.income_type <> 'salary'
               AND COALESCE(r.fiscal_year, CAST(substr(r.received_on, 1, 4) AS INTEGER)) = ?1
               AND r.currency = 'CHF'
             GROUP BY i.income_type
             ORDER BY 2 DESC",
        )
        .map_err(|e| e.to_string())?;
    let other_income_by_type: Vec<OtherIncomeLine> = stmt
        .query_map([year], |r| {
            Ok(OtherIncomeLine {
                income_type: r.get(0)?,
                total: r.get(1)?,
                count: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // --- frais professionnels ---
    let contract = main_contract.map(|(_, c)| c);
    let mut notes = Vec::new();

    let commute_claimed = match &contract {
        Some(c) => match (c.commute_public_transport_cost_year, c.commute_km_per_day) {
            (Some(cost), _) if cost > 0.0 => cost,
            (_, Some(km)) if km > 0.0 => {
                notes.push(format!(
                    "Trajet estimé à {:.0} km/jour sur {:.0} jours, au tarif de {:.2} CHF/km. Le véhicule privé n'est admis que si les transports publics ne sont pas exigibles.",
                    km, working_days, params.commute_private_car_per_km
                ));
                km * working_days * params.commute_private_car_per_km
            }
            _ => {
                notes.push(
                    "Aucun trajet domicile-travail renseigné dans le contrat : les frais de transport ne sont pas calculés.".into(),
                );
                0.0
            }
        },
        None => {
            notes.push(
                "Aucun contrat de travail enregistré : forfait repas et frais de transport ne peuvent pas être établis.".into(),
            );
            0.0
        }
    };

    let subsidized = contract.as_ref().map(|c| c.subsidized_canteen).unwrap_or(false);
    let meals = if contract.is_none() {
        0.0
    } else if subsidized {
        params.meals_subsidized_year
    } else {
        params.meals_full_year
    };

    let commute_capped = commute_claimed.min(params.commute_cap_ifd);
    if commute_claimed > params.commute_cap_ifd {
        notes.push(format!(
            "Frais de transport ramenés de {:.0} à {:.0} CHF : l'impôt fédéral direct les plafonne. Les cantons appliquent leurs propres limites.",
            commute_claimed, params.commute_cap_ifd
        ));
    }

    let lump_sum_other_expenses = payroll::pro_expenses_lump_sum(net_salary, &params);
    let professional_expenses = ProfessionalExpenses {
        lump_sum_other_expenses,
        commute_claimed,
        commute_capped,
        commute_cap: params.commute_cap_ifd,
        meals,
        meals_reduced_by_employer: subsidized,
        total: lump_sum_other_expenses + commute_capped + meals,
        notes,
    };

    let affiliated_to_lpp = lpp_contributions > 0.0;
    let pillar3a_cap = payroll::pillar3a_cap(affiliated_to_lpp, net_salary, &params);

    Ok(IncomeTaxSummary {
        year,
        params,
        gross_total,
        social_contributions,
        lpp_contributions,
        net_salary,
        tax_at_source,
        other_income_by_type,
        professional_expenses,
        pillar3a_cap,
        affiliated_to_lpp,
        salary_sources: sources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt(id: &str, received: &str, period_end: Option<&str>, base: f64) -> IncomeReceipt {
        IncomeReceipt {
            id: id.into(),
            income_id: "inc1".into(),
            received_on: received.into(),
            amount: base * 0.85,
            currency: "CHF".into(),
            period_end: period_end.map(String::from),
            base_salary_amount: Some(base),
            ..Default::default()
        }
    }

    #[test]
    fn fiscal_year_follows_the_period_not_the_payment() {
        // Salaire de décembre 2025 versé le 5 janvier 2026 : il appartient
        // à l'exercice 2025.
        let r = receipt("r1", "2026-01-05", Some("2025-12-31"), 8_000.0);
        assert_eq!(receipt_year(&r), 2025);
    }

    #[test]
    fn fiscal_year_falls_back_to_the_payment_date() {
        let r = receipt("r1", "2025-03-25", None, 8_000.0);
        assert_eq!(receipt_year(&r), 2025);
    }

    #[test]
    fn ytd_sums_only_earlier_periods_of_the_same_year() {
        let receipts = vec![
            receipt("r1", "2026-01-25", Some("2026-01-31"), 10_000.0),
            receipt("r2", "2026-02-25", Some("2026-02-28"), 10_000.0),
            receipt("r3", "2026-03-25", Some("2026-03-31"), 10_000.0),
            // Année précédente : ne doit pas compter.
            receipt("r0", "2025-12-25", Some("2025-12-31"), 10_000.0),
        ];
        let ytd = ytd_before(&receipts, 2026, "2026-03-31", "r3");
        assert_eq!(ytd, 20_000.0, "janvier + février seulement");
    }

    #[test]
    fn ytd_excludes_the_receipt_being_checked() {
        let receipts = vec![receipt("r1", "2026-01-25", Some("2026-01-31"), 10_000.0)];
        // Même clé de tri : le versement contrôlé ne doit pas se compter lui-même.
        assert_eq!(ytd_before(&receipts, 2026, "2026-01-31", "r1"), 0.0);
    }

    #[test]
    fn ytd_ignores_family_allowances() {
        let mut r = receipt("r1", "2026-01-25", Some("2026-01-31"), 10_000.0);
        r.family_allowance_amount = Some(430.0);
        let receipts = vec![r];
        assert_eq!(
            ytd_before(&receipts, 2026, "2026-02-28", "r2"),
            10_000.0,
            "les allocations ne sont pas du salaire déterminant"
        );
    }

    /// Le certificat calculé doit refléter la distinction assiette AVS /
    /// assiette fiscale : les allocations familiales entrent dans le brut
    /// du certificat (rubrique 1) même si elles échappent aux cotisations.
    #[test]
    fn computed_certificate_maps_receipts_to_rubrics() {
        let mut r = receipt("r1", "2026-01-25", Some("2026-01-31"), 8_000.0);
        r.thirteenth_amount = Some(666.65);
        r.family_allowance_amount = Some(215.0);
        r.benefits_in_kind_amount = Some(100.0);
        r.company_car_private_amount = Some(360.0);
        r.bonus_amount = Some(1_000.0);
        r.social_charges_amount = Some(424.0);
        r.ac_amount = Some(88.0);
        r.laa_nonoccupational_amount = Some(80.0);
        r.pension_amount = Some(187.43);
        r.expense_lump_sum_amount = Some(300.0);

        let cert = compute_certificate(&[r], "inc1", 2026);

        assert_eq!(cert.r1_salary, Some(8_000.0 + 666.65 + 215.0));
        assert_eq!(cert.r2_1_benefits_in_kind, Some(100.0));
        assert_eq!(cert.r2_2_company_car, Some(360.0));
        assert_eq!(cert.r3_irregular, Some(1_000.0));
        assert_eq!(cert.r8_gross_total, Some(8_000.0 + 666.65 + 215.0 + 100.0 + 360.0 + 1_000.0));
        assert_eq!(
            cert.r9_social_contributions,
            Some(424.0 + 88.0 + 80.0),
            "AVS + AC + AANP, sans l'IJM"
        );
        assert_eq!(cert.r10_1_lpp_ordinary, Some(187.43));
        assert_eq!(cert.r13_2_lump_sum_expenses, Some(300.0));
        assert!(cert.box_f_employer_transport, "véhicule de service → case F");

        let net = cert.r8_gross_total.unwrap()
            - cert.r9_social_contributions.unwrap()
            - cert.r10_1_lpp_ordinary.unwrap();
        assert!((cert.r11_net_salary.unwrap() - net).abs() < 0.01);
    }

    #[test]
    fn ijm_stays_out_of_rubric_nine() {
        let mut r = receipt("r1", "2026-01-25", Some("2026-01-31"), 8_000.0);
        r.social_charges_amount = Some(424.0);
        r.ijm_amount = Some(40.0);
        let cert = compute_certificate(&[r], "inc1", 2026);
        assert_eq!(cert.r9_social_contributions, Some(424.0));
    }

    /// Bulletins saisis sans détail (colonnes v10 uniquement) : le brut
    /// imprimé reste utilisable pour la rubrique 8.
    #[test]
    fn computed_certificate_falls_back_to_the_printed_gross() {
        let r = IncomeReceipt {
            id: "r1".into(),
            income_id: "inc1".into(),
            received_on: "2026-01-25".into(),
            amount: 6_800.0,
            currency: "CHF".into(),
            gross_amount: Some(8_000.0),
            social_charges_amount: Some(424.0),
            ..Default::default()
        };
        let cert = compute_certificate(&[r], "inc1", 2026);
        assert_eq!(cert.r8_gross_total, Some(8_000.0));
        assert_eq!(cert.r1_salary, Some(8_000.0));
    }

    #[test]
    fn computed_certificate_only_counts_the_requested_year() {
        let receipts = vec![
            receipt("r1", "2025-06-25", Some("2025-06-30"), 8_000.0),
            receipt("r2", "2026-06-25", Some("2026-06-30"), 9_000.0),
        ];
        let cert = compute_certificate(&receipts, "inc1", 2026);
        assert_eq!(cert.r8_gross_total, Some(9_000.0));
    }

    #[test]
    fn a_year_without_receipts_yields_zeroes_not_garbage() {
        let cert = compute_certificate(&[], "inc1", 2026);
        assert_eq!(cert.r8_gross_total, Some(0.0));
        assert_eq!(cert.r11_net_salary, Some(0.0));
        assert_eq!(cert.fiscal_year, 2026);
    }
}

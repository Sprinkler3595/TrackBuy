//! Moteur de paie suisse : barèmes, calcul des retenues attendues et
//! contrôle de conformité d'un bulletin de salaire.
//!
//! Volontairement découplé de la base : l'entrée est `PayslipInput` /
//! `EmploymentTerms`, pas une ligne SQLite. La couche `commands::payroll`
//! fait la traduction. Le module est donc testable sans coffre déverrouillé.
//!
//! Trois classes de grandeurs, à ne jamais confondre :
//!
//!   1. **exactement calculables** — AVS/AI/APG, AC (avec plafond annuel et
//!      cumul), pour-cent de solidarité, salaire coordonné LPP, part privée
//!      d'un véhicule d'entreprise. Un écart est une anomalie.
//!   2. **bornées par la loi** — la bonification LPP est un TOTAL dont
//!      l'employeur finance au moins la moitié (art. 66 al. 1 LPP). On
//!      contrôle donc une borne, pas une égalité.
//!   3. **purement contractuelles** — taux AANP, taux IJM, plan de la caisse
//!      de pension. Le moteur ne les devine JAMAIS : ils viennent du contrat
//!      saisi par l'utilisateur, et en leur absence le contrôle est annoncé
//!      comme impossible plutôt que fabriqué.

pub mod checks;
pub mod params;

pub use checks::{check_payslip, Finding, Severity};
pub use params::{known_years, params_for_year, PayrollParams};

use serde::{Deserialize, Serialize};

/// Termes de l'emploi, saisis une fois par l'utilisateur. Tout est optionnel :
/// le moteur dégrade proprement et signale ce qu'il ne peut pas contrôler.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EmploymentTerms {
    /// Sert uniquement à choisir la tranche de bonification LPP.
    pub birth_date: Option<String>,
    pub activity_rate_pct: Option<f64>,
    pub weekly_hours: Option<f64>,
    /// Salaire annuel brut convenu. Sert de référence pour le salaire
    /// coordonné LPP quand il est connu (plus fiable que 12 × le brut du mois,
    /// qui varie avec les heures supplémentaires et le 13ᵉ).
    pub annual_gross_agreed: Option<f64>,
    /// 12 ou 13 selon que le 13ᵉ salaire est versé en une fois ou mensualisé.
    pub salary_periods_per_year: Option<i32>,
    pub hourly_paid: bool,
    /// Taux employé du règlement de la caisse de pension, en % du salaire
    /// coordonné. Contractuel : jamais déduit d'un barème.
    pub lpp_employee_share_pct: Option<f64>,
    /// Prime AANP à charge de l'employé, en % du salaire assuré. Contractuel.
    pub laa_nonoccupational_pct: Option<f64>,
    /// Part employé de l'assurance indemnités journalières maladie. Contractuel.
    pub ijm_employee_pct: Option<f64>,
    pub tax_at_source: bool,
    /// Prix d'achat HT du véhicule d'entreprise, pour la part privée.
    pub company_car_purchase_price: Option<f64>,
    pub subsidized_canteen: bool,
    pub thirteenth_salary: bool,
}

/// Un bulletin de salaire, décomposé. Tous les montants sont positifs :
/// les retenues sont des montants retenus, pas des nombres négatifs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PayslipInput {
    pub fiscal_year: i32,
    /// Net effectivement versé.
    pub net_paid: f64,

    // --- composantes du brut ---
    pub base_salary: Option<f64>,
    pub thirteenth: Option<f64>,
    pub overtime: Option<f64>,
    pub overtime_hours: Option<f64>,
    pub holiday_pay: Option<f64>,
    pub bonus: Option<f64>,
    pub benefits_in_kind: Option<f64>,
    /// Part privée du véhicule d'entreprise (ch. 2.2 du certificat).
    pub company_car_private: Option<f64>,
    /// Allocations familiales : versées avec le salaire mais NON soumises
    /// aux cotisations AVS (art. 6 RAVS).
    pub family_allowance: Option<f64>,
    pub other_gross: Option<f64>,
    /// Brut total tel qu'imprimé sur le bulletin, s'il est connu.
    pub gross_total: Option<f64>,

    // --- retenues ---
    pub avs_ai_apg: Option<f64>,
    pub ac: Option<f64>,
    pub ac_solidarity: Option<f64>,
    pub lpp: Option<f64>,
    pub laa_nonoccupational: Option<f64>,
    pub ijm: Option<f64>,
    pub tax_at_source: Option<f64>,
    pub other_deductions: Option<f64>,

    // --- frais (art. 327a CO) : remboursés, donc NON soumis et non imposables ---
    pub expense_reimbursement: Option<f64>,
    pub expense_lump_sum: Option<f64>,
}

/// Cumul de l'année AVANT la période contrôlée. Indispensable pour l'AC,
/// dont le plafond est annuel : la 11ᵉ période d'un haut salaire ne doit
/// plus rien retenir.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct YtdContext {
    /// Salaire déterminant AVS déjà versé cette année, hors période courante.
    pub avs_gross_before: f64,
    /// Nombre de périodes de paie dans l'année (12, 13, 24…). Défaut : 12.
    pub periods_per_year: f64,
}

impl YtdContext {
    pub fn periods(&self) -> f64 {
        if self.periods_per_year > 0.0 {
            self.periods_per_year
        } else {
            12.0
        }
    }
}

/// Retenues attendues pour une période. `None` = non calculable (taux
/// contractuel manquant), à distinguer de `Some(0.0)` = rien n'est dû.
#[derive(Debug, Clone, Serialize)]
pub struct ExpectedDeductions {
    /// Salaire déterminant AVS de la période (hors allocations et frais).
    pub avs_subject_gross: f64,
    pub avs_ai_apg: f64,
    /// Assiette AC après application du plafond annuel restant.
    pub ac_base: f64,
    pub ac: f64,
    pub ac_solidarity: f64,
    pub laa_nonoccupational: Option<f64>,
    pub ijm: Option<f64>,
    /// Salaire coordonné ANNUEL (0 si sous le seuil d'entrée).
    pub lpp_coordinated_salary: f64,
    /// Bonification légale minimale ANNUELLE (total employeur + employé).
    pub lpp_minimum_annual_credit: f64,
    /// Retenue LPP attendue sur la période d'après le règlement saisi.
    pub lpp_employee: Option<f64>,
    /// Plafond légal de la part employé sur la période : l'employeur doit
    /// financer au moins la moitié de la bonification (art. 66 al. 1 LPP).
    pub lpp_employee_legal_cap: f64,
}

/// Salaire déterminant AVS d'une période.
///
/// Inclut tout ce qui rémunère le travail — y compris 13ᵉ, heures
/// supplémentaires, bonus, prestations en nature et part privée du véhicule.
/// Exclut les allocations familiales (art. 6 RAVS) et les remboursements de
/// frais (art. 327a CO), qui transitent par le bulletin sans être du salaire.
pub fn avs_subject_gross(p: &PayslipInput) -> f64 {
    // Si le bulletin imprime un brut total, il fait foi pour les composantes
    // de salaire ; on en retire ce qui n'est pas soumis.
    if let Some(total) = p.gross_total {
        return (total - p.family_allowance.unwrap_or(0.0)).max(0.0);
    }
    [
        p.base_salary,
        p.thirteenth,
        p.overtime,
        p.holiday_pay,
        p.bonus,
        p.benefits_in_kind,
        p.company_car_private,
        p.other_gross,
    ]
    .iter()
    .filter_map(|v| *v)
    .sum()
}

/// Brut total figurant sur le bulletin : salaire déterminant + allocations.
/// (Les frais remboursés restent en dehors : ils ne sont pas du brut.)
pub fn total_gross(p: &PayslipInput) -> f64 {
    avs_subject_gross(p) + p.family_allowance.unwrap_or(0.0)
}

/// Somme des retenues saisies.
pub fn total_deductions(p: &PayslipInput) -> f64 {
    [
        p.avs_ai_apg,
        p.ac,
        p.ac_solidarity,
        p.lpp,
        p.laa_nonoccupational,
        p.ijm,
        p.tax_at_source,
        p.other_deductions,
    ]
    .iter()
    .filter_map(|v| *v)
    .sum()
}

/// Net attendu = brut − retenues + frais remboursés.
pub fn expected_net(p: &PayslipInput) -> f64 {
    total_gross(p) - total_deductions(p)
        + p.expense_reimbursement.unwrap_or(0.0)
        + p.expense_lump_sum.unwrap_or(0.0)
}

/// Salaire coordonné LPP annuel (art. 8 LPP).
///
/// Sous le seuil d'entrée → 0 (pas d'assujettissement obligatoire).
/// Au-dessus → salaire AVS plafonné, moins la déduction de coordination,
/// avec un plancher légal.
pub fn coordinated_salary(annual_avs_salary: f64, p: &PayrollParams) -> f64 {
    if annual_avs_salary < p.lpp_entry_threshold {
        return 0.0;
    }
    let capped = annual_avs_salary.min(p.lpp_avs_upper_limit);
    let coordinated = capped - p.lpp_coordination_deduction;
    if coordinated < p.lpp_min_coordinated {
        p.lpp_min_coordinated
    } else {
        coordinated
    }
}

/// Taux de bonification LPP applicable à un âge donné (total employeur +
/// employé). 0 avant 25 ans : seuls les risques décès/invalidité sont
/// couverts, sans épargne.
pub fn lpp_credit_rate(age: i32, p: &PayrollParams) -> f64 {
    p.lpp_credit_brackets
        .iter()
        .find(|(from, to, _)| age >= *from && age <= *to)
        .map(|(_, _, rate)| *rate)
        .unwrap_or(0.0)
}

/// Âge LPP au cours d'une année civile : la tranche change au 1er janvier
/// qui suit l'anniversaire, donc c'est bien `année − année de naissance`.
pub fn lpp_age(birth_date: &str, year: i32) -> Option<i32> {
    let birth_year: i32 = birth_date.get(0..4)?.parse().ok()?;
    Some(year - birth_year)
}

/// Part privée d'un véhicule d'entreprise pour un mois : 0.9 % du prix
/// d'achat HT, avec un minimum. Couvre aussi le trajet domicile-travail
/// depuis 2022 (d'où la case F du certificat de salaire).
pub fn private_car_monthly(purchase_price_excl_vat: f64, p: &PayrollParams) -> f64 {
    let pct = purchase_price_excl_vat * p.private_car_monthly_pct / 100.0;
    pct.max(p.private_car_monthly_min)
}

/// Plafond de déduction du pilier 3a pour l'année.
pub fn pillar3a_cap(affiliated_to_lpp: bool, annual_income: f64, p: &PayrollParams) -> f64 {
    if affiliated_to_lpp {
        p.pillar3a_with_lpp
    } else {
        (annual_income * p.pillar3a_without_lpp_pct / 100.0).min(p.pillar3a_without_lpp_cap)
    }
}

/// Déduction forfaitaire pour « autres frais professionnels » (IFD) :
/// 3 % du salaire net, encadrés par un minimum et un maximum.
pub fn pro_expenses_lump_sum(net_salary: f64, p: &PayrollParams) -> f64 {
    let raw = net_salary * p.pro_lump_sum_pct / 100.0;
    raw.clamp(p.pro_lump_sum_min, p.pro_lump_sum_max)
}

/// Retenues attendues pour la période décrite par `input`.
pub fn expected_deductions(
    input: &PayslipInput,
    terms: &EmploymentTerms,
    ytd: &YtdContext,
    p: &PayrollParams,
) -> ExpectedDeductions {
    let subject = avs_subject_gross(input);
    let periods = ytd.periods();

    let avs = subject * p.avs_ai_apg_employee_pct / 100.0;

    // Plafond AC : annuel, donc il faut savoir combien de marge reste.
    let remaining_ceiling = (p.ac_ceiling - ytd.avs_gross_before).max(0.0);
    let ac_base = subject.min(remaining_ceiling);
    let ac = ac_base * p.ac_employee_pct / 100.0;
    let above_ceiling = (subject - ac_base).max(0.0);
    let ac_solidarity = above_ceiling * p.ac_solidarity_employee_pct / 100.0;

    // LAA/AANP : plafonné comme l'AC, mais le taux est contractuel.
    let laa_remaining = (p.laa_max_insured - ytd.avs_gross_before).max(0.0);
    let laa_base = subject.min(laa_remaining);
    let laa_due = terms
        .weekly_hours
        .map(|h| h >= p.laa_nonoccupational_min_weekly_hours)
        .unwrap_or(true);
    let laa_nonoccupational = match (terms.laa_nonoccupational_pct, laa_due) {
        (Some(rate), true) => Some(laa_base * rate / 100.0),
        (Some(_), false) => Some(0.0),
        (None, _) => None,
    };

    let ijm = terms
        .ijm_employee_pct
        .map(|rate| subject * rate / 100.0);

    // LPP : le salaire coordonné est annuel. On préfère le salaire convenu
    // au brut du mois × périodes, qui est bruité par le 13ᵉ et les heures sup.
    let annual_reference = terms
        .annual_gross_agreed
        .unwrap_or_else(|| subject * periods);
    let coordinated = coordinated_salary(annual_reference, p);

    let age = terms
        .birth_date
        .as_deref()
        .and_then(|d| lpp_age(d, input.fiscal_year));
    let credit_rate = age.map(|a| lpp_credit_rate(a, p)).unwrap_or(0.0);
    let minimum_annual_credit = coordinated * credit_rate / 100.0;

    let lpp_employee = terms
        .lpp_employee_share_pct
        .map(|rate| coordinated * rate / 100.0 / periods);
    let lpp_employee_legal_cap = minimum_annual_credit / 2.0 / periods;

    ExpectedDeductions {
        avs_subject_gross: subject,
        avs_ai_apg: avs,
        ac_base,
        ac,
        ac_solidarity,
        laa_nonoccupational,
        ijm,
        lpp_coordinated_salary: coordinated,
        lpp_minimum_annual_credit: minimum_annual_credit,
        lpp_employee,
        lpp_employee_legal_cap,
    }
}

#[cfg(test)]
mod tests {
    use super::checks::Severity;
    use super::*;

    fn p2026() -> PayrollParams {
        params_for_year(2026)
    }

    /// Salarié type : 8'000 CHF/mois × 12, 42 h/semaine, né en 1985.
    fn terms() -> EmploymentTerms {
        EmploymentTerms {
            birth_date: Some("1985-06-15".into()),
            weekly_hours: Some(42.0),
            annual_gross_agreed: Some(96_000.0),
            salary_periods_per_year: Some(12),
            lpp_employee_share_pct: Some(3.5),
            laa_nonoccupational_pct: Some(1.0),
            ijm_employee_pct: Some(0.5),
            ..Default::default()
        }
    }

    fn ytd(before: f64) -> YtdContext {
        YtdContext {
            avs_gross_before: before,
            periods_per_year: 12.0,
        }
    }

    fn payslip(gross: f64, net: f64) -> PayslipInput {
        PayslipInput {
            fiscal_year: 2026,
            net_paid: net,
            base_salary: Some(gross),
            ..Default::default()
        }
    }

    fn finding<'a>(fs: &'a [Finding], id: &str) -> Option<&'a Finding> {
        fs.iter().find(|f| f.id == id)
    }

    // --- barèmes ---

    #[test]
    fn known_year_is_not_estimated() {
        let p = params_for_year(2026);
        assert!(!p.estimated);
        assert_eq!(p.effective_year, 2026);
        assert_eq!(p.avs_ai_apg_employee_pct, 5.3);
    }

    #[test]
    fn unknown_year_falls_back_and_is_flagged() {
        let p = params_for_year(2031);
        assert!(p.estimated, "une année inconnue doit être marquée estimée");
        assert_eq!(p.year, 2031);
        assert_eq!(p.effective_year, 2026, "l'année connue la plus proche");
    }

    #[test]
    fn solidarity_percent_exists_before_2023_and_not_after() {
        assert_eq!(params_for_year(2022).ac_solidarity_employee_pct, 0.5);
        assert_eq!(params_for_year(2026).ac_solidarity_employee_pct, 0.0);
    }

    // --- salaire coordonné LPP ---

    #[test]
    fn below_entry_threshold_no_coordinated_salary() {
        let p = p2026();
        assert_eq!(coordinated_salary(20_000.0, &p), 0.0);
    }

    #[test]
    fn coordinated_salary_uses_the_legal_floor() {
        let p = p2026();
        // 27'000 − 26'460 = 540, sous le plancher de 3'780.
        assert_eq!(coordinated_salary(27_000.0, &p), 3_780.0);
    }

    #[test]
    fn coordinated_salary_is_capped_at_the_upper_limit() {
        let p = p2026();
        // Au-delà de 90'720, le salaire coordonné plafonne à 64'260.
        assert_eq!(coordinated_salary(200_000.0, &p), 64_260.0);
        assert_eq!(coordinated_salary(96_000.0, &p), 64_260.0);
    }

    #[test]
    fn lpp_credit_rate_follows_age_brackets() {
        let p = p2026();
        assert_eq!(lpp_credit_rate(20, &p), 0.0);
        assert_eq!(lpp_credit_rate(30, &p), 7.0);
        assert_eq!(lpp_credit_rate(40, &p), 10.0);
        assert_eq!(lpp_credit_rate(50, &p), 15.0);
        assert_eq!(lpp_credit_rate(60, &p), 18.0);
    }

    #[test]
    fn lpp_age_changes_on_january_first() {
        // Né en décembre 1985 : en 2026 il est dans la tranche des 41 ans.
        assert_eq!(lpp_age("1985-12-31", 2026), Some(41));
    }

    // --- salaire déterminant ---

    #[test]
    fn family_allowance_is_excluded_from_avs_base() {
        let input = PayslipInput {
            fiscal_year: 2026,
            net_paid: 0.0,
            base_salary: Some(6_000.0),
            family_allowance: Some(215.0),
            ..Default::default()
        };
        assert_eq!(avs_subject_gross(&input), 6_000.0);
        assert_eq!(total_gross(&input), 6_215.0);
    }

    #[test]
    fn printed_gross_total_wins_over_components() {
        let input = PayslipInput {
            fiscal_year: 2026,
            net_paid: 0.0,
            base_salary: Some(6_000.0),
            family_allowance: Some(215.0),
            gross_total: Some(6_500.0),
            ..Default::default()
        };
        // 6'500 imprimés, moins les 215 d'allocations non soumises.
        assert_eq!(avs_subject_gross(&input), 6_285.0);
    }

    // --- retenues attendues ---

    #[test]
    fn avs_and_ac_on_a_plain_month() {
        let p = p2026();
        let e = expected_deductions(&payslip(8_000.0, 0.0), &terms(), &ytd(0.0), &p);
        assert!((e.avs_ai_apg - 424.0).abs() < 0.01, "8000 × 5.3 %");
        assert!((e.ac - 88.0).abs() < 0.01, "8000 × 1.1 %");
        assert_eq!(e.ac_solidarity, 0.0);
    }

    #[test]
    fn ac_stops_once_the_annual_ceiling_is_reached() {
        let p = p2026();
        // 148'200 déjà versés : plus rien n'est dû.
        let e = expected_deductions(&payslip(20_000.0, 0.0), &terms(), &ytd(148_200.0), &p);
        assert_eq!(e.ac_base, 0.0);
        assert_eq!(e.ac, 0.0);
        assert!((e.avs_ai_apg - 1_060.0).abs() < 0.01, "l'AVS n'est jamais plafonnée");
    }

    #[test]
    fn ac_is_prorated_on_the_period_that_crosses_the_ceiling() {
        let p = p2026();
        // 140'000 cumulés, 20'000 ce mois : seuls 8'200 restent soumis.
        let e = expected_deductions(&payslip(20_000.0, 0.0), &terms(), &ytd(140_000.0), &p);
        assert!((e.ac_base - 8_200.0).abs() < 0.01);
        assert!((e.ac - 90.2).abs() < 0.01);
    }

    #[test]
    fn lpp_employee_cap_is_half_the_minimum_credit() {
        let p = p2026();
        let e = expected_deductions(&payslip(8_000.0, 0.0), &terms(), &ytd(0.0), &p);
        // 64'260 coordonnés × 10 % (41 ans) = 6'426 annuels ; moitié / 12.
        assert!((e.lpp_minimum_annual_credit - 6_426.0).abs() < 0.01);
        assert!((e.lpp_employee_legal_cap - 267.75).abs() < 0.01);
    }

    // --- contrôles ---

    #[test]
    fn a_correct_payslip_raises_no_error() {
        let p = p2026();
        let input = PayslipInput {
            fiscal_year: 2026,
            base_salary: Some(8_000.0),
            avs_ai_apg: Some(424.0),
            ac: Some(88.0),
            lpp: Some(187.425), // 64'260 × 3.5 % / 12
            laa_nonoccupational: Some(80.0),
            ijm: Some(40.0),
            net_paid: 8_000.0 - 424.0 - 88.0 - 187.425 - 80.0 - 40.0,
            ..Default::default()
        };
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        let bad: Vec<_> = fs
            .iter()
            .filter(|f| matches!(f.severity, Severity::Error | Severity::Warn))
            .collect();
        assert!(bad.is_empty(), "constats inattendus : {:?}", bad);
        assert_eq!(finding(&fs, "avs_rate").unwrap().severity, Severity::Ok);
        assert_eq!(finding(&fs, "net_reconciliation").unwrap().severity, Severity::Ok);
    }

    #[test]
    fn a_wrong_avs_rate_is_flagged_as_an_error() {
        let p = p2026();
        let mut input = payslip(8_000.0, 7_000.0);
        input.avs_ai_apg = Some(480.0); // 6 % au lieu de 5.3 %
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        let f = finding(&fs, "avs_rate").unwrap();
        assert_eq!(f.severity, Severity::Error);
        assert!((f.expected.unwrap() - 424.0).abs() < 0.01);
    }

    #[test]
    fn rounding_differences_do_not_raise_anything() {
        let p = p2026();
        let mut input = payslip(8_000.0, 7_000.0);
        input.avs_ai_apg = Some(424.05);
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        assert_eq!(finding(&fs, "avs_rate").unwrap().severity, Severity::Ok);
    }

    #[test]
    fn missing_lpp_above_the_threshold_is_an_error() {
        let p = p2026();
        let mut input = payslip(8_000.0, 7_500.0);
        input.avs_ai_apg = Some(424.0);
        input.ac = Some(88.0);
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        assert_eq!(finding(&fs, "lpp_missing").unwrap().severity, Severity::Error);
    }

    #[test]
    fn no_lpp_alert_below_the_entry_threshold() {
        let p = p2026();
        let low_terms = EmploymentTerms {
            annual_gross_agreed: Some(18_000.0),
            ..terms()
        };
        let mut input = payslip(1_500.0, 1_400.0);
        input.avs_ai_apg = Some(79.5);
        input.ac = Some(16.5);
        let fs = check_payslip(&input, &low_terms, &ytd(0.0), &p);
        assert!(finding(&fs, "lpp_missing").is_none());
        assert_eq!(
            finding(&fs, "lpp_below_threshold").unwrap().severity,
            Severity::Info
        );
    }

    #[test]
    fn an_unknown_lpp_rate_is_reported_as_uncheckable_not_invented() {
        let p = p2026();
        let no_rate = EmploymentTerms {
            lpp_employee_share_pct: None,
            ..terms()
        };
        let mut input = payslip(8_000.0, 7_000.0);
        input.lpp = Some(500.0);
        let fs = check_payslip(&input, &no_rate, &ytd(0.0), &p);
        let f = finding(&fs, "lpp_rate_unknown").unwrap();
        assert_eq!(f.severity, Severity::Info);
        assert!(f.expected.is_none(), "aucun montant ne doit être inventé");
    }

    #[test]
    fn allowances_wrongly_subjected_to_avs_are_detected() {
        let p = p2026();
        let input = PayslipInput {
            fiscal_year: 2026,
            base_salary: Some(6_000.0),
            family_allowance: Some(400.0),
            // 5.3 % appliqués sur 6'400 au lieu de 6'000.
            avs_ai_apg: Some(339.2),
            net_paid: 0.0,
            ..Default::default()
        };
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        assert_eq!(
            finding(&fs, "allowance_in_avs_base").unwrap().severity,
            Severity::Error
        );
    }

    #[test]
    fn solidarity_withheld_after_its_abolition_is_an_error() {
        let p = p2026();
        let mut input = payslip(20_000.0, 18_000.0);
        input.ac_solidarity = Some(100.0);
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        assert_eq!(
            finding(&fs, "ac_solidarity_abolished").unwrap().severity,
            Severity::Error
        );
    }

    #[test]
    fn anp_withheld_under_eight_weekly_hours_is_flagged() {
        let p = p2026();
        let small = EmploymentTerms {
            weekly_hours: Some(4.0),
            ..terms()
        };
        let mut input = payslip(1_000.0, 900.0);
        input.laa_nonoccupational = Some(10.0);
        let fs = check_payslip(&input, &small, &ytd(0.0), &p);
        assert_eq!(
            finding(&fs, "laa_anp_not_due").unwrap().severity,
            Severity::Warn
        );
    }

    #[test]
    fn overtime_paid_without_the_premium_is_flagged() {
        let p = p2026();
        let input = PayslipInput {
            fiscal_year: 2026,
            base_salary: Some(8_000.0),
            overtime_hours: Some(10.0),
            // Tarif horaire ≈ 43.96 ; 10 h majorées = 549.45 attendus.
            overtime: Some(439.56),
            net_paid: 0.0,
            ..Default::default()
        };
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        let f = finding(&fs, "overtime_no_premium").unwrap();
        assert_eq!(f.severity, Severity::Warn);
        assert!((f.expected.unwrap() - 549.45).abs() < 0.5);
    }

    #[test]
    fn company_car_private_share_is_recomputed() {
        let p = p2026();
        let with_car = EmploymentTerms {
            company_car_purchase_price: Some(40_000.0),
            ..terms()
        };
        let mut input = payslip(8_000.0, 7_000.0);
        input.company_car_private = Some(200.0); // 360 attendus
        let fs = check_payslip(&input, &with_car, &ytd(0.0), &p);
        let f = finding(&fs, "company_car_private").unwrap();
        assert_eq!(f.severity, Severity::Error);
        assert!((f.expected.unwrap() - 360.0).abs() < 0.01);
    }

    #[test]
    fn company_car_uses_the_monthly_minimum_for_cheap_vehicles() {
        let p = p2026();
        // 0.9 % de 10'000 = 90, sous le minimum de 150.
        assert_eq!(private_car_monthly(10_000.0, &p), 150.0);
    }

    #[test]
    fn net_mismatch_is_reported_with_the_gap() {
        let p = p2026();
        let mut input = payslip(8_000.0, 6_000.0);
        input.avs_ai_apg = Some(424.0);
        input.ac = Some(88.0);
        input.lpp = Some(187.43);
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        let f = finding(&fs, "net_reconciliation").unwrap();
        assert_eq!(f.severity, Severity::Error);
        assert!((f.expected.unwrap() - 7_300.57).abs() < 0.05);
    }

    #[test]
    fn expense_reimbursements_are_added_back_to_the_net() {
        let p = p2026();
        let input = PayslipInput {
            fiscal_year: 2026,
            base_salary: Some(8_000.0),
            avs_ai_apg: Some(424.0),
            ac: Some(88.0),
            lpp: Some(187.43),
            expense_lump_sum: Some(300.0),
            net_paid: 8_000.0 - 424.0 - 88.0 - 187.43 + 300.0,
            ..Default::default()
        };
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        assert_eq!(
            finding(&fs, "net_reconciliation").unwrap().severity,
            Severity::Ok
        );
    }

    #[test]
    fn an_estimated_year_is_announced() {
        let p = params_for_year(2031);
        let fs = check_payslip(&payslip(8_000.0, 7_000.0), &terms(), &ytd(0.0), &p);
        assert_eq!(
            finding(&fs, "params_estimated").unwrap().severity,
            Severity::Info
        );
    }

    #[test]
    fn a_payslip_without_gross_stops_early() {
        let p = p2026();
        let input = PayslipInput {
            fiscal_year: 2026,
            net_paid: 5_000.0,
            ..Default::default()
        };
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        assert_eq!(fs.len(), 1);
        assert_eq!(fs[0].id, "no_gross");
    }

    // --- déductions fiscales ---

    #[test]
    fn pillar3a_cap_depends_on_lpp_affiliation() {
        let p = p2026();
        assert_eq!(pillar3a_cap(true, 96_000.0, &p), 7_258.0);
        // 20 % de 96'000 = 19'200, sous le plafond des 36'288.
        assert_eq!(pillar3a_cap(false, 96_000.0, &p), 19_200.0);
        assert_eq!(pillar3a_cap(false, 400_000.0, &p), 36_288.0);
    }

    #[test]
    fn pro_expenses_lump_sum_is_clamped_both_ways() {
        let p = p2026();
        assert_eq!(pro_expenses_lump_sum(30_000.0, &p), 2_000.0, "plancher");
        assert_eq!(pro_expenses_lump_sum(100_000.0, &p), 3_000.0, "3 %");
        assert_eq!(pro_expenses_lump_sum(200_000.0, &p), 4_000.0, "plafond");
    }
}

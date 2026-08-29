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
pub mod tax_at_source;

pub use checks::{check_payslip, Finding};
pub use params::{
    known_years, params_for_year, CantonalParams, LppCreditBracket, PayrollParams,
};

use serde::{Deserialize, Serialize};

/// Termes de l'emploi, saisis une fois par l'utilisateur. Tout est optionnel :
/// le moteur dégrade proprement et signale ce qu'il ne peut pas contrôler.
///
/// `#[serde(default)]` fait tenir cette promesse jusqu'au bout. Les champs
/// booléens ne sont pas des `Option`, donc sans lui serde les EXIGE : un écran
/// qui ne connaît pas encore `hourly_paid` voyait sa requête rejetée en bloc,
/// avec un « missing field » à la place du décompte. Un drapeau absent vaut
/// désormais « non », ce qui est exactement ce qu'il veut dire.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
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
    /// Payé à l'heure : le salaire de base d'une paie mesure les heures
    /// accomplies, pas un montant convenu.
    ///
    /// Conséquence pratique : le tarif horaire ne peut PAS s'en déduire
    /// (`base × périodes ÷ heures annuelles` supposerait un mois plein), donc
    /// le contrôle de la majoration de 25 % sur les heures supplémentaires est
    /// écarté. Reprocher une majoration manquante sur un tarif inventé serait
    /// une accusation sans fondement.
    pub hourly_paid: bool,
    /// Taux employé du règlement de la caisse de pension, en % du salaire
    /// coordonné. Contractuel : jamais déduit d'un barème.
    pub lpp_employee_share_pct: Option<f64>,
    /// `base` = seul le salaire contractuel est assuré ; toute autre valeur,
    /// dont l'absence, vaut `total` — le brut entier, suppléments compris.
    ///
    /// La réponse tient au règlement de la caisse de pension et ne se devine
    /// pas. Le signe est pourtant simple à lire sur une fiche : une retenue LPP
    /// identique tous les mois trahit un salaire assuré fixe.
    pub lpp_insured_scope: Option<String>,
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

    /// Tout autre versement qui rejoint le net APRÈS les retenues. Hors
    /// assiette AVS, comme les frais — mais ce n'en est pas un, et les
    /// confondre reviendrait à ranger en frais professionnels un montant qui
    /// n'a rien à y faire.
    pub net_addition: Option<f64>,
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
    /// Cotisation salariée aux allocations familiales (VD, VS). Zéro partout
    /// ailleurs, et zéro tant que le taux du canton n'est pas renseigné.
    pub cantonal_family_allowance: f64,
    /// Assurance maternité cantonale, part employé (GE).
    pub cantonal_maternity: f64,
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

/// Net attendu = brut − retenues + ce qui s'ajoute après la barre.
pub fn expected_net(p: &PayslipInput) -> f64 {
    total_gross(p) - total_deductions(p)
        + p.expense_reimbursement.unwrap_or(0.0)
        + p.expense_lump_sum.unwrap_or(0.0)
        + p.net_addition.unwrap_or(0.0)
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

    // Prélèvements cantonaux : même assiette que l'AVS. Ils valent zéro dans
    // la plupart des cantons, mais les ignorer là où ils existent fait
    // prendre une cotisation légitime pour une anomalie.
    let cantonal_family_allowance = subject * p.cantonal.family_allowance_employee_pct / 100.0;
    let cantonal_maternity = subject * p.cantonal.maternity_employee_pct / 100.0;

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
        cantonal_family_allowance,
        cantonal_maternity,
    }
}

// ===========================================================================
// Du brut au net
// ===========================================================================

/// Une période de paie projetée.
///
/// Les `Option` gardent la distinction qui traverse tout le module : `None` =
/// taux contractuel inconnu, donc RIEN n'a été retenu et le net est
/// surévalué d'autant ; `Some(0.0)` = le poste existe mais rien n'est dû.
#[derive(Debug, Clone, Serialize)]
pub struct ProjectedPeriod {
    /// 1 pour la première paie de l'année civile.
    pub index: i32,
    /// Brut total de la période, allocations comprises.
    pub gross: f64,
    /// Assiette des cotisations (le brut moins les allocations familiales).
    pub avs_subject_gross: f64,
    pub avs_ai_apg: f64,
    pub ac: f64,
    pub ac_solidarity: f64,
    pub laa_nonoccupational: Option<f64>,
    pub ijm: Option<f64>,
    pub lpp_employee: Option<f64>,
    pub tax_at_source: Option<f64>,
    /// Prélèvements propres au canton de travail (allocations familiales en
    /// VD/VS, assurance maternité en GE). Zéro ailleurs.
    pub cantonal: f64,
    /// Somme des seuls postes calculables.
    pub total_deductions: f64,
    pub net: f64,
}

/// Année de paie projetée à partir d'un brut par période.
#[derive(Debug, Clone, Serialize)]
pub struct NetProjection {
    pub periods: Vec<ProjectedPeriod>,
    pub periods_per_year: i32,
    pub annual_gross: f64,
    pub annual_net: f64,
    /// Postes qu'aucun taux connu ne permet de chiffrer. Tant que cette liste
    /// n'est pas vide, le net projeté est un MAJORANT et l'interface doit le
    /// présenter comme tel plutôt que comme un montant.
    pub uncomputable: Vec<&'static str>,
    /// Vrai quand toutes les périodes ne se valent pas — typiquement un haut
    /// salaire qui franchit le plafond annuel de l'assurance-chômage en cours
    /// d'année. L'interface doit alors montrer l'année, pas seulement le mois.
    pub varies_across_year: bool,
}

impl NetProjection {
    /// Net de la première paie de l'année : c'est ce qu'on enregistre comme
    /// montant du revenu, et ce que l'utilisateur reconnaît sur son décompte.
    pub fn representative_net(&self) -> f64 {
        self.periods.first().map(|p| p.net).unwrap_or(0.0)
    }
}

/// Projette une année de paie à partir d'un brut par période.
///
/// Le calcul boucle période par période au lieu de multiplier par douze, et
/// ce n'est pas un détail : le plafond de l'assurance-chômage et le maximum
/// assuré LAA sont ANNUELS. À 20 000 par mois, les cotisations AC s'arrêtent
/// en cours d'année, et une simple multiplication surestimerait les retenues
/// de plusieurs milliers de francs. Chaque tour réinjecte le cumul dans
/// `YtdContext`, dont `expected_deductions` sait déjà tirer les conséquences.
///
/// Le taux d'activité n'intervient PAS ici : le brut fourni est celui
/// effectivement versé, donc déjà proratisé. Il est conservé au contrat pour
/// le contrôle des bulletins. L'appliquer une seconde fois diviserait le
/// salaire deux fois.
///
/// `family_allowance` est versée avec le salaire mais échappe aux
/// cotisations (art. 6 RAVS) : elle grossit le brut et le net sans peser
/// sur l'assiette AVS.
///
/// `tax_at_source` reçoit la base déterminante de la période et rend l'impôt
/// retenu, ou `None` si aucun barème n'est disponible. Passer une fermeture
/// plutôt qu'une table garde ce module pur : c'est la couche `commands` qui
/// sait où sont rangés les tarifs cantonaux.
pub fn project_net(
    gross_per_period: f64,
    supplements_per_period: f64,
    family_allowance: Option<f64>,
    terms: &EmploymentTerms,
    p: &PayrollParams,
    fiscal_year: i32,
    tax_at_source: &dyn Fn(f64, f64) -> Option<f64>,
) -> NetProjection {
    let periods = terms.salary_periods_per_year.unwrap_or(12).clamp(1, 53);
    let supplements = supplements_per_period.max(0.0);
    // Une allocation à zéro n'est pas une allocation : la laisser à `None`
    // évite d'afficher une ligne vide sur le récapitulatif.
    let family_allowance = family_allowance.filter(|v| *v > 0.0);

    // Le salaire coordonné LPP se calcule sur l'ANNÉE, et l'ancrer sur le mois
    // courant × le nombre de périodes est un piège : un mois chargé
    // d'astreintes projetterait une retenue LPP de moitié supérieure à la
    // réalité, alors qu'aucune caisse ne recalcule le salaire assuré chaque
    // mois. Deux régimes, selon le règlement de la caisse :
    //
    //   - `base`  : seul le salaire contractuel est assuré. On garde le montant
    //               convenu, insensible aux suppléments ;
    //   - `total` : tout le brut l'est. On prend alors le total ANNUEL projeté,
    //               suppléments compris — et non le mois extrapolé.
    let insures_only_base = terms.lpp_insured_scope.as_deref() == Some("base");
    let mut terms = terms.clone();
    terms.annual_gross_agreed = if insures_only_base {
        terms
            .annual_gross_agreed
            .or(Some(gross_per_period * periods as f64))
    } else {
        Some((gross_per_period + supplements) * periods as f64)
    };
    terms.salary_periods_per_year = Some(periods);

    let mut projected = Vec::with_capacity(periods as usize);
    let mut avs_cumulative = 0.0_f64;

    for index in 1..=periods {
        let input = PayslipInput {
            fiscal_year,
            net_paid: 0.0,
            base_salary: Some(gross_per_period),
            // Astreintes et week-ends : du salaire déterminant comme le reste,
            // et une prestation PÉRIODIQUE — pas un bonus.
            other_gross: (supplements > 0.0).then_some(supplements),
            family_allowance,
            ..Default::default()
        };
        let ytd = YtdContext {
            avs_gross_before: avs_cumulative,
            periods_per_year: periods as f64,
        };
        let e = expected_deductions(&input, &terms, &ytd, p);

        let gross = total_gross(&input);

        // En modèle annuel (FR, GE, TI, VD, VS), le salaire qui détermine le
        // TAUX est la moyenne des salaires DÉJÀ VERSÉS dans l'année, ramenée à
        // l'année entière — pas le mois courant multiplié par le nombre de
        // périodes. Sur un salaire plat les deux coïncident ; dès que les mois
        // varient, non. La fermeture reçoit donc les deux.
        let annualised = (avs_cumulative + e.avs_subject_gross) / index as f64 * periods as f64;

        // Pas d'imposition à la source : le poste existe et vaut zéro, ce qui
        // n'est pas la même chose qu'un barème introuvable.
        let tax = if terms.tax_at_source {
            tax_at_source(gross, annualised)
        } else {
            Some(0.0)
        };

        let cantonal = e.cantonal_family_allowance + e.cantonal_maternity;
        let total_deductions = e.avs_ai_apg
            + e.ac
            + e.ac_solidarity
            + e.laa_nonoccupational.unwrap_or(0.0)
            + e.ijm.unwrap_or(0.0)
            + e.lpp_employee.unwrap_or(0.0)
            + cantonal
            + tax.unwrap_or(0.0);

        projected.push(ProjectedPeriod {
            index,
            gross,
            avs_subject_gross: e.avs_subject_gross,
            avs_ai_apg: e.avs_ai_apg,
            ac: e.ac,
            ac_solidarity: e.ac_solidarity,
            laa_nonoccupational: e.laa_nonoccupational,
            ijm: e.ijm,
            lpp_employee: e.lpp_employee,
            tax_at_source: tax,
            cantonal,
            total_deductions,
            net: gross - total_deductions,
        });

        avs_cumulative += e.avs_subject_gross;
    }

    let mut uncomputable = Vec::new();
    if let Some(first) = projected.first() {
        if first.lpp_employee.is_none() {
            uncomputable.push("lpp");
        }
        if first.laa_nonoccupational.is_none() {
            uncomputable.push("laa_nonoccupational");
        }
        if first.ijm.is_none() {
            uncomputable.push("ijm");
        }
        if first.tax_at_source.is_none() {
            uncomputable.push("tax_at_source");
        }
    }

    let annual_gross = projected.iter().map(|p| p.gross).sum();
    let annual_net = projected.iter().map(|p| p.net).sum();
    let varies_across_year = projected
        .windows(2)
        .any(|w| (w[0].net - w[1].net).abs() > 0.005);

    NetProjection {
        periods: projected,
        periods_per_year: periods,
        annual_gross,
        annual_net,
        uncomputable,
        varies_across_year,
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

    /// Un versement qui suit la barre des retenues rejoint le net sans passer
    /// par les cotisations — et sans gonfler l'assiette AVS, faute de quoi le
    /// contrôle réclamerait des retenues sur un montant qui n'y est pas soumis.
    #[test]
    fn a_payment_after_the_deductions_reaches_the_net_untouched() {
        let p = p2026();
        let input = PayslipInput {
            fiscal_year: 2026,
            base_salary: Some(8_000.0),
            avs_ai_apg: Some(424.0),
            ac: Some(88.0),
            lpp: Some(187.43),
            net_addition: Some(250.0),
            net_paid: 8_000.0 - 424.0 - 88.0 - 187.43 + 250.0,
            ..Default::default()
        };
        assert_eq!(
            avs_subject_gross(&input),
            8_000.0,
            "hors assiette AVS, comme les frais"
        );
        let fs = check_payslip(&input, &terms(), &ytd(0.0), &p);
        assert_eq!(
            finding(&fs, "net_reconciliation").unwrap().severity,
            Severity::Ok
        );

        // Oublier ce versement laisserait un écart de son montant exact.
        let without = PayslipInput { net_addition: None, ..input };
        let fs = check_payslip(&without, &terms(), &ytd(0.0), &p);
        let gap = finding(&fs, "net_reconciliation").unwrap();
        assert_ne!(gap.severity, Severity::Ok);
        assert!((gap.actual.unwrap() - gap.expected.unwrap() - 250.0).abs() < 0.01);
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

    // --- projection brut → net ---

    /// Aucune imposition à la source : la fermeture ne doit jamais être
    /// appelée, et le lui faire renvoyer une valeur absurde le prouve.
    fn no_tax(_: f64) -> Option<f64> {
        Some(999_999.0)
    }

    fn project(gross: f64, terms: &EmploymentTerms) -> NetProjection {
        project_net(gross, 0.0, None, terms, &p2026(), 2026, &|b, _| no_tax(b))
    }

    /// Le brut → net doit retomber exactement sur le bulletin que le
    /// contrôleur juge conforme : ce sont les deux sens d'un même calcul.
    #[test]
    fn a_projected_month_matches_the_payslip_the_checker_accepts() {
        let pr = project(8_000.0, &terms());
        let m = &pr.periods[0];
        assert!((m.avs_ai_apg - 424.0).abs() < 0.01);
        assert!((m.ac - 88.0).abs() < 0.01);
        assert!((m.lpp_employee.unwrap() - 187.425).abs() < 0.01);
        assert!((m.laa_nonoccupational.unwrap() - 80.0).abs() < 0.01);
        assert!((m.ijm.unwrap() - 40.0).abs() < 0.01);
        assert!((m.total_deductions - 819.425).abs() < 0.01);
        assert!((m.net - 7_180.575).abs() < 0.01, "net obtenu : {}", m.net);
        assert!(pr.uncomputable.is_empty());
        assert!(!pr.varies_across_year, "un salaire ordinaire ne varie pas");
        assert!((pr.annual_gross - 96_000.0).abs() < 0.01);
    }

    /// Le plafond de l'assurance-chômage est ANNUEL : à haut salaire, les
    /// cotisations s'arrêtent en cours d'année. C'est toute la raison de
    /// boucler sur les périodes au lieu de multiplier par douze.
    #[test]
    fn ac_contributions_stop_once_the_annual_ceiling_is_crossed() {
        let pr = project(20_000.0, &terms());
        // 148'200 / 20'000 = 7.41 : les sept premiers mois cotisent en plein,
        // le huitième sur le reliquat, les suivants sur rien.
        assert!((pr.periods[0].ac - 220.0).abs() < 0.01, "20'000 × 1.1 %");
        assert!((pr.periods[6].ac - 220.0).abs() < 0.01, "7e mois : encore plein");
        assert!((pr.periods[7].ac - 90.2).abs() < 0.01, "8e mois : 8'200 restants");
        assert_eq!(pr.periods[8].ac, 0.0, "9e mois : plafond atteint");
        // L'AVS, elle, n'est jamais plafonnée.
        assert!((pr.periods[11].avs_ai_apg - 1_060.0).abs() < 0.01);
        assert!(pr.varies_across_year, "le net change en cours d'année");
    }

    /// Un taux contractuel manquant ne s'invente pas : le poste reste vide,
    /// il est signalé, et le net annoncé est un majorant.
    #[test]
    fn a_missing_contractual_rate_leaves_the_net_as_an_upper_bound() {
        let bare = EmploymentTerms {
            lpp_employee_share_pct: None,
            laa_nonoccupational_pct: None,
            ijm_employee_pct: None,
            ..terms()
        };
        let pr = project(8_000.0, &bare);
        let m = &pr.periods[0];
        assert!(m.lpp_employee.is_none());
        assert!(m.laa_nonoccupational.is_none());
        assert!(m.ijm.is_none());
        assert_eq!(pr.uncomputable, vec!["lpp", "laa_nonoccupational", "ijm"]);
        // Seules l'AVS et l'AC ont pu être retenues.
        assert!((m.total_deductions - 512.0).abs() < 0.01);
        assert!(m.net > project(8_000.0, &terms()).periods[0].net);
    }

    /// Sous le seuil d'entrée LPP, rien n'est dû — ce qui est une réponse,
    /// pas une absence de réponse.
    #[test]
    fn below_the_lpp_entry_threshold_the_answer_is_zero_not_unknown() {
        let pr = project(1_500.0, &terms());
        assert_eq!(pr.periods[0].lpp_employee, Some(0.0));
        assert!(pr.uncomputable.is_empty());
    }

    /// Treize périodes : le 13ᵉ salaire est un mois de plus, pas un mois plus
    /// gros.
    #[test]
    fn thirteen_periods_stretch_the_year_without_changing_the_month() {
        let t = EmploymentTerms {
            salary_periods_per_year: Some(13),
            thirteenth_salary: true,
            ..terms()
        };
        let pr = project(8_000.0, &t);
        assert_eq!(pr.periods.len(), 13);
        assert!((pr.annual_gross - 104_000.0).abs() < 0.01);
        // Le salaire coordonné suit le brut annuel, donc la retenue LPP
        // mensuelle change : c'est bien 13 × le mois, pas 12.
        assert!((pr.periods[0].avs_ai_apg - 424.0).abs() < 0.01);
    }

    /// Les allocations familiales gonflent le brut et le net sans entrer dans
    /// l'assiette des cotisations (art. 6 RAVS).
    #[test]
    fn family_allowances_reach_the_net_untouched_by_contributions() {
        let plain = project(8_000.0, &terms());
        let withkids = project_net(8_000.0, 0.0, Some(430.0), &terms(), &p2026(), 2026, &|b, _| no_tax(b));
        let a = &plain.periods[0];
        let b = &withkids.periods[0];
        assert_eq!(b.avs_subject_gross, a.avs_subject_gross, "assiette inchangée");
        assert!((b.gross - a.gross - 430.0).abs() < 0.01);
        assert!((b.total_deductions - a.total_deductions).abs() < 0.01);
        assert!((b.net - a.net - 430.0).abs() < 0.01);
    }

    /// L'impôt à la source n'est retenu que si le contrat le prévoit, et il
    /// porte sur le brut TOTAL — allocations comprises, contrairement aux
    /// cotisations.
    #[test]
    fn tax_at_source_applies_to_the_total_gross_and_only_when_subject() {
        let taxed = EmploymentTerms { tax_at_source: true, ..terms() };
        let pr = project_net(8_000.0, 0.0, Some(430.0), &taxed, &p2026(), 2026, &|base, _| {
            Some(base * 10.0 / 100.0)
        });
        let m = &pr.periods[0];
        assert!((m.tax_at_source.unwrap() - 843.0).abs() < 0.01, "10 % de 8'430");

        // Non soumis : le poste vaut zéro, il n'est pas « inconnu ».
        let pr = project(8_000.0, &terms());
        assert_eq!(pr.periods[0].tax_at_source, Some(0.0));
        assert!(pr.uncomputable.is_empty());
    }

    /// Soumis mais sans barème disponible : l'impôt reste non chiffré et le
    /// net est annoncé comme majorant.
    #[test]
    fn a_subject_employee_without_any_tariff_leaves_the_tax_unknown() {
        let taxed = EmploymentTerms { tax_at_source: true, ..terms() };
        let pr = project_net(8_000.0, 0.0, None, &taxed, &p2026(), 2026, &|_, _| None);
        assert!(pr.periods[0].tax_at_source.is_none());
        assert!(pr.uncomputable.contains(&"tax_at_source"));
    }

    /// Le taux d'activité décrit le poste, pas le montant : le brut saisi est
    /// déjà celui qui est versé. L'appliquer ici le diviserait deux fois.
    #[test]
    fn the_activity_rate_does_not_shrink_the_gross_a_second_time() {
        let half = EmploymentTerms { activity_rate_pct: Some(50.0), ..terms() };
        let pr = project(4_000.0, &half);
        assert!((pr.periods[0].gross - 4_000.0).abs() < 0.01);
        assert!((pr.periods[0].avs_ai_apg - 212.0).abs() < 0.01, "4'000 × 5.3 %");
    }

    /// 2023 était absent de la table : l'année retombait sur 2024 en se
    /// déclarant estimée, alors que les deux portent les mêmes valeurs.
    #[test]
    fn twenty_twenty_three_is_a_published_year() {
        let p = params_for_year(2023);
        assert!(!p.estimated);
        assert_eq!(p.effective_year, 2023);
        assert_eq!(p.lpp_entry_threshold, 22_050.0);
        assert_eq!(p.ac_solidarity_employee_pct, 0.0, "aboli au 1.1.2023");
    }

    /// « Tout est optionnel » doit valoir jusqu'au décodage. Les drapeaux ne
    /// sont pas des `Option` : sans `#[serde(default)]`, un écran qui n'envoie
    /// que ce qu'il connaît se voyait refuser sa requête entière, avec un
    /// « missing field » à la place du décompte.
    #[test]
    fn partial_terms_decode_with_flags_defaulting_to_false() {
        let terms: EmploymentTerms = serde_json::from_str(
            r#"{"salary_periods_per_year": 13, "lpp_employee_share_pct": 3.5}"#,
        )
        .expect("une requête partielle doit être acceptée");
        assert_eq!(terms.salary_periods_per_year, Some(13));
        assert_eq!(terms.lpp_employee_share_pct, Some(3.5));
        assert!(!terms.hourly_paid);
        assert!(!terms.tax_at_source);
        assert!(!terms.thirteenth_salary);
        assert!(!terms.subsidized_canteen);
        assert_eq!(terms.birth_date, None, "absent veut dire inconnu");

        // Et l'objet vide reste valide : c'est le cas d'un revenu sans contrat.
        assert!(serde_json::from_str::<EmploymentTerms>("{}").is_ok());
    }


    // --- suppléments et salaire assuré ---

    fn project_with(gross: f64, supplements: f64, terms: &EmploymentTerms) -> NetProjection {
        project_net(gross, supplements, None, terms, &p2026(), 2026, &|b, _| no_tax(b))
    }

    /// Astreintes et week-ends sont du salaire déterminant comme le reste :
    /// l'AVS et l'AC les frappent, et ils gonflent le net d'autant moins.
    #[test]
    fn supplements_are_subject_to_contributions_like_any_salary() {
        let plain = project_with(8_000.0, 0.0, &terms());
        let busy = project_with(8_000.0, 500.0, &terms());

        assert!((busy.periods[0].gross - 8_500.0).abs() < 0.01);
        assert!((busy.periods[0].avs_ai_apg - 450.5).abs() < 0.01, "8'500 × 5.3 %");
        assert!((busy.periods[0].ac - 93.5).abs() < 0.01, "8'500 × 1.1 %");
        assert!(busy.periods[0].net > plain.periods[0].net);
    }

    /// Le vrai défaut corrigé : avec un salaire assuré limité au contrat, la
    /// retenue LPP ne bouge pas d'un mois chargé à l'autre. Aucune caisse ne
    /// recalcule le salaire coordonné chaque mois.
    #[test]
    fn a_base_only_pension_plan_ignores_the_supplements() {
        let base_only = EmploymentTerms {
            lpp_insured_scope: Some("base".into()),
            annual_gross_agreed: Some(50_000.0),
            salary_periods_per_year: Some(13),
            ..terms()
        };
        let quiet = project_with(3_846.15, 0.0, &base_only);
        let busy = project_with(3_846.15, 500.0, &base_only);
        assert!(
            (quiet.periods[0].lpp_employee.unwrap() - busy.periods[0].lpp_employee.unwrap()).abs()
                < 0.01,
            "le salaire assuré reste celui du contrat"
        );
    }

    /// Avec un salaire assuré portant sur tout le brut, la retenue suit — mais
    /// sur le total ANNUEL projeté, pas sur le mois extrapolé.
    #[test]
    fn a_total_pension_plan_follows_the_projected_annual_gross() {
        let total = EmploymentTerms {
            lpp_insured_scope: Some("total".into()),
            annual_gross_agreed: Some(50_000.0),
            salary_periods_per_year: Some(13),
            ..terms()
        };
        let quiet = project_with(3_846.15, 0.0, &total);
        let busy = project_with(3_846.15, 500.0, &total);
        assert!(
            busy.periods[0].lpp_employee.unwrap() > quiet.periods[0].lpp_employee.unwrap(),
            "les suppléments entrent dans le salaire assuré"
        );

        // 3'846.15 + 500 = 4'346.15 × 13 = 56'500 annuels.
        // Coordonné = 56'500 − 26'460 = 30'040 ; × 3.5 % = 1'051.40 par an,
        // soit 80.88 par paie. Sans les suppléments : 23'540 coordonnés, 63.38.
        assert!((quiet.periods[0].lpp_employee.unwrap() - 63.38).abs() < 0.01);
        assert!((busy.periods[0].lpp_employee.unwrap() - 80.88).abs() < 0.01);
    }

    /// En modèle annuel, le taux se prend sur la moyenne des salaires DÉJÀ
    /// versés ramenée à l'année, pas sur le mois courant × le nombre de
    /// périodes. Sur un salaire plat les deux coïncident ; c'est un mois
    /// inégal qui les sépare.
    #[test]
    fn the_annual_tax_base_is_the_running_average_not_the_current_month() {
        let taxed = EmploymentTerms { tax_at_source: true, ..terms() };
        let seen = std::cell::RefCell::new(Vec::new());
        let pr = project_net(8_000.0, 1_200.0, None, &taxed, &p2026(), 2026, &|_, annualised| {
            seen.borrow_mut().push(annualised);
            Some(0.0)
        });
        assert_eq!(pr.periods.len(), 12);

        // Chaque période vaut 9'200 : la moyenne cumulée reste 110'400 tout au
        // long de l'année, et c'est bien elle qui est interrogée.
        for v in seen.borrow().iter() {
            assert!((v - 110_400.0).abs() < 0.01, "base annualisée : {v}");
        }
    }

    /// Sur treize paies, le salaire d'une paie est plus petit d'un treizième :
    /// déduire le tarif horaire de « heures mensuelles moyennes » le
    /// sous-estimait d'autant, et la majoration de 25 % avec lui.
    #[test]
    fn the_hourly_rate_accounts_for_thirteen_pay_periods() {
        let p = p2026();
        let thirteen = EmploymentTerms {
            weekly_hours: Some(40.0),
            salary_periods_per_year: Some(13),
            ..terms()
        };
        // 4'000 × 13 = 52'000 par an, 40 h × 52 = 2'080 h → 25.00/h.
        // Dix heures majorées valent donc 312.50, pas 288.46.
        let input = PayslipInput {
            fiscal_year: 2026,
            base_salary: Some(4_000.0),
            overtime_hours: Some(10.0),
            overtime: Some(300.0),
            net_paid: 0.0,
            ..Default::default()
        };
        let fs = check_payslip(&input, &thirteen, &ytd(0.0), &p);
        let f = finding(&fs, "overtime_no_premium").unwrap();
        assert!(
            (f.expected.unwrap() - 312.5).abs() < 0.5,
            "attendu obtenu : {:?}",
            f.expected
        );
    }

    /// Payé à l'heure, le salaire de base d'une paie mesure les heures
    /// accomplies : en déduire un tarif horaire reviendrait à reprocher une
    /// majoration manquante sur un chiffre fabriqué.
    #[test]
    fn an_hourly_contract_does_not_get_a_fabricated_hourly_rate() {
        let p = p2026();
        let input = PayslipInput {
            fiscal_year: 2026,
            base_salary: Some(4_000.0),
            overtime_hours: Some(10.0),
            // 4'000 × 12 ÷ 2'080 h = 23.08/h, majorés : 288.46 attendus.
            overtime: Some(250.0),
            net_paid: 0.0,
            ..Default::default()
        };

        let monthly = EmploymentTerms {
            weekly_hours: Some(40.0),
            ..terms()
        };
        assert!(
            finding(&check_payslip(&input, &monthly, &ytd(0.0), &p), "overtime_no_premium")
                .is_some(),
            "sur un salaire mensuel le contrôle a bien lieu"
        );

        let hourly = EmploymentTerms {
            hourly_paid: true,
            ..monthly
        };
        assert!(
            finding(&check_payslip(&input, &hourly, &ytd(0.0), &p), "overtime_no_premium")
                .is_none(),
            "sur un contrat à l'heure il est écarté"
        );
    }
}

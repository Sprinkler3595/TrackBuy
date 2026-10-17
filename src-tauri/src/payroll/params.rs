//! Barèmes légaux suisses, versionnés par année civile.
//!
//! Toute valeur chiffrée du droit de la paie vit ici et NULLE PART ailleurs :
//! le front ne connaît aucun taux, il appelle `get_payroll_params(year)`.
//!
//! Chaque année porte sa `source` et sa date de vérification, parce que ces
//! montants sont republiés chaque automne par l'OFAS / l'AFC. Une année
//! inconnue retombe sur la dernière connue avec `estimated = true`, ce que
//! l'UI doit afficher — mieux vaut un calcul marqué « estimé » qu'un calcul
//! muet fondé sur des chiffres périmés.

use serde::Serialize;
use std::borrow::Cow;

/// Tranche de bonification LPP : `(âge_min, âge_max, taux_total_pct)`.
/// Le taux est le TOTAL employeur + employé (art. 16 LPP) ; l'employeur doit
/// en financer au moins la moitié (art. 66 al. 1 LPP).
pub type LppCreditBracket = (i32, i32, f64);

#[derive(Debug, Clone, Serialize)]
pub struct PayrollParams {
    pub year: i32,
    /// `true` quand l'année demandée n'est pas dans la table et qu'on a
    /// retenu les paramètres de l'année connue la plus proche.
    pub estimated: bool,
    /// Année dont les valeurs sont effectivement utilisées.
    pub effective_year: i32,
    pub source: &'static str,
    pub verified_on: &'static str,

    // --- AVS / AI / APG (LAVS) — pas de plafond ---
    /// Part salarié, en % du salaire déterminant. 5.30 = 4.35 AVS + 0.70 AI + 0.25 APG.
    pub avs_ai_apg_employee_pct: f64,
    /// Part employeur, identique par construction (cotisation paritaire).
    pub avs_ai_apg_employer_pct: f64,

    // --- Assurance-chômage (LACI) ---
    pub ac_employee_pct: f64,
    /// Salaire annuel au-delà duquel plus aucune cotisation AC n'est due.
    pub ac_ceiling: f64,
    /// « Pour-cent de solidarité » sur la part au-dessus du plafond.
    /// Supprimé au 1.1.2023 (fonds de compensation au-dessus de 2.5 Mia).
    pub ac_solidarity_employee_pct: f64,

    // --- LAA ---
    /// Salaire annuel maximum assuré (AAP et AANP).
    pub laa_max_insured: f64,
    /// Durée hebdomadaire minimale à partir de laquelle l'AANP est due par
    /// le salarié (art. 13 OLAA) — en dessous, seul l'AAP employeur court.
    pub laa_nonoccupational_min_weekly_hours: f64,

    // --- LPP / OPP2 ---
    pub lpp_entry_threshold: f64,
    pub lpp_coordination_deduction: f64,
    /// Limite supérieure du salaire AVS pris en compte dans le régime obligatoire.
    pub lpp_avs_upper_limit: f64,
    /// Plancher du salaire coordonné pour un assuré au-dessus du seuil d'entrée.
    pub lpp_min_coordinated: f64,
    /// `Cow` et non `&'static` : l'utilisateur peut redéfinir les tranches
    /// depuis Paramètres → Barèmes (la réforme LPP remplacerait ces quatre
    /// paliers par deux taux). Les années livrées restent empruntées, donc
    /// sans allocation.
    pub lpp_credit_brackets: Cow<'static, [LppCreditBracket]>,

    // --- Pilier 3a (OPP3) ---
    pub pillar3a_with_lpp: f64,
    pub pillar3a_without_lpp_pct: f64,
    pub pillar3a_without_lpp_cap: f64,

    // --- Frais professionnels déductibles, impôt fédéral direct (art. 26 LIFD) ---
    pub pro_lump_sum_pct: f64,
    pub pro_lump_sum_min: f64,
    pub pro_lump_sum_max: f64,
    /// Repas pris hors du domicile, forfait annuel plein.
    pub meals_full_year: f64,
    /// Idem, réduit de moitié quand l'employeur subventionne la cantine.
    pub meals_subsidized_year: f64,
    pub meals_full_day: f64,
    pub meals_subsidized_day: f64,
    /// Plafond des frais de déplacement domicile-travail pour l'IFD.
    pub commute_cap_ifd: f64,
    /// Tarif kilométrique admis pour le véhicule privé, quand les transports
    /// publics ne sont pas exigibles. Reste soumis au plafond ci-dessus.
    pub commute_private_car_per_km: f64,

    // --- Part privée d'un véhicule d'entreprise (directive AFC dès 2022) ---
    /// En % du prix d'achat HT, PAR MOIS. Couvre aussi le trajet domicile-travail.
    pub private_car_monthly_pct: f64,
    pub private_car_monthly_min: f64,

    // --- Allocations familiales (LAFam), minimums fédéraux ---
    pub family_allowance_min_child: f64,
    pub family_allowance_min_training: f64,

    /// Retenues salariales propres au canton de travail. Vides par défaut :
    /// le droit fédéral ne les connaît pas, elles se renseignent par canton et
    /// par année dans Paramètres → Barèmes.
    pub cantonal: CantonalParams,
}

/// Les prélèvements cantonaux qui tombent sur la fiche du SALARIÉ.
///
/// La plupart des cantons ne chargent que l'employeur. Trois font exception, et
/// les ignorer fausse deux fois : le net annoncé est trop élevé, et le contrôle
/// de bulletin prend une cotisation légitime pour une anomalie.
#[derive(Debug, Clone, Default, Serialize)]
pub struct CantonalParams {
    /// Canton de travail auquel ces taux se rapportent.
    pub canton: Option<String>,
    /// Cotisation salariée aux allocations familiales — Vaud et Valais.
    pub family_allowance_employee_pct: f64,
    /// Assurance maternité cantonale, part employé — Genève.
    pub maternity_employee_pct: f64,
}

impl CantonalParams {
    /// Aucun prélèvement cantonal. Utilisable en contexte `const`, ce que
    /// `Default::default()` ne permet pas dans la table des années.
    pub const EMPTY: CantonalParams = CantonalParams {
        canton: None,
        family_allowance_employee_pct: 0.0,
        maternity_employee_pct: 0.0,
    };
}

/// Tranches de bonification LPP — inchangées depuis l'entrée en vigueur de
/// la LPP, mais gardées par année pour survivre à la réforme LPP si elle
/// aboutit (elle remplace ces 4 paliers par 2 taux).
const LPP_BRACKETS_CLASSIC: &[LppCreditBracket] = &[
    (25, 34, 7.0),
    (35, 44, 10.0),
    (45, 54, 15.0),
    (55, 999, 18.0),
];

/// Table des années connues, de la plus récente à la plus ancienne.
/// Ajouter une année = ajouter une entrée en tête, rien d'autre.
const YEARS: &[PayrollParams] = &[
    PayrollParams {
        year: 2026,
        estimated: false,
        effective_year: 2026,
        source: "OFAS/AFC — chiffres clés assurances sociales 2026",
        verified_on: "2026-08-27",
        avs_ai_apg_employee_pct: 5.3,
        avs_ai_apg_employer_pct: 5.3,
        ac_employee_pct: 1.1,
        ac_ceiling: 148_200.0,
        ac_solidarity_employee_pct: 0.0,
        laa_max_insured: 148_200.0,
        laa_nonoccupational_min_weekly_hours: 8.0,
        lpp_entry_threshold: 22_680.0,
        lpp_coordination_deduction: 26_460.0,
        lpp_avs_upper_limit: 90_720.0,
        lpp_min_coordinated: 3_780.0,
        lpp_credit_brackets: Cow::Borrowed(LPP_BRACKETS_CLASSIC),
        pillar3a_with_lpp: 7_258.0,
        pillar3a_without_lpp_pct: 20.0,
        pillar3a_without_lpp_cap: 36_288.0,
        pro_lump_sum_pct: 3.0,
        pro_lump_sum_min: 2_000.0,
        pro_lump_sum_max: 4_000.0,
        meals_full_year: 3_200.0,
        meals_subsidized_year: 1_600.0,
        meals_full_day: 15.0,
        meals_subsidized_day: 7.5,
        commute_cap_ifd: 3_200.0,
        commute_private_car_per_km: 0.7,
        private_car_monthly_pct: 0.9,
        private_car_monthly_min: 150.0,
        family_allowance_min_child: 215.0,
        family_allowance_min_training: 268.0,
        cantonal: CantonalParams::EMPTY,
    },
    PayrollParams {
        year: 2025,
        estimated: false,
        effective_year: 2025,
        source: "OFAS/AFC — chiffres clés assurances sociales 2025",
        verified_on: "2026-08-27",
        avs_ai_apg_employee_pct: 5.3,
        avs_ai_apg_employer_pct: 5.3,
        ac_employee_pct: 1.1,
        ac_ceiling: 148_200.0,
        ac_solidarity_employee_pct: 0.0,
        laa_max_insured: 148_200.0,
        laa_nonoccupational_min_weekly_hours: 8.0,
        lpp_entry_threshold: 22_680.0,
        lpp_coordination_deduction: 26_460.0,
        lpp_avs_upper_limit: 90_720.0,
        lpp_min_coordinated: 3_780.0,
        lpp_credit_brackets: Cow::Borrowed(LPP_BRACKETS_CLASSIC),
        pillar3a_with_lpp: 7_258.0,
        pillar3a_without_lpp_pct: 20.0,
        pillar3a_without_lpp_cap: 36_288.0,
        pro_lump_sum_pct: 3.0,
        pro_lump_sum_min: 2_000.0,
        pro_lump_sum_max: 4_000.0,
        meals_full_year: 3_200.0,
        meals_subsidized_year: 1_600.0,
        meals_full_day: 15.0,
        meals_subsidized_day: 7.5,
        commute_cap_ifd: 3_200.0,
        commute_private_car_per_km: 0.7,
        private_car_monthly_pct: 0.9,
        private_car_monthly_min: 150.0,
        family_allowance_min_child: 215.0,
        family_allowance_min_training: 268.0,
        cantonal: CantonalParams::EMPTY,
    },
    PayrollParams {
        year: 2024,
        estimated: false,
        effective_year: 2024,
        source: "OFAS/AFC — chiffres clés assurances sociales 2024",
        verified_on: "2026-08-27",
        avs_ai_apg_employee_pct: 5.3,
        avs_ai_apg_employer_pct: 5.3,
        ac_employee_pct: 1.1,
        ac_ceiling: 148_200.0,
        ac_solidarity_employee_pct: 0.0,
        laa_max_insured: 148_200.0,
        laa_nonoccupational_min_weekly_hours: 8.0,
        lpp_entry_threshold: 22_050.0,
        lpp_coordination_deduction: 25_725.0,
        lpp_avs_upper_limit: 88_200.0,
        lpp_min_coordinated: 3_675.0,
        lpp_credit_brackets: Cow::Borrowed(LPP_BRACKETS_CLASSIC),
        pillar3a_with_lpp: 7_056.0,
        pillar3a_without_lpp_pct: 20.0,
        pillar3a_without_lpp_cap: 35_280.0,
        pro_lump_sum_pct: 3.0,
        pro_lump_sum_min: 2_000.0,
        pro_lump_sum_max: 4_000.0,
        meals_full_year: 3_200.0,
        meals_subsidized_year: 1_600.0,
        meals_full_day: 15.0,
        meals_subsidized_day: 7.5,
        commute_cap_ifd: 3_000.0,
        commute_private_car_per_km: 0.7,
        private_car_monthly_pct: 0.9,
        private_car_monthly_min: 150.0,
        family_allowance_min_child: 215.0,
        family_allowance_min_training: 268.0,
        cantonal: CantonalParams::EMPTY,
    },
    PayrollParams {
        year: 2023,
        estimated: false,
        effective_year: 2023,
        source: "OFAS/AFC — chiffres clés assurances sociales 2023",
        verified_on: "2026-08-27",
        avs_ai_apg_employee_pct: 5.3,
        avs_ai_apg_employer_pct: 5.3,
        ac_employee_pct: 1.1,
        ac_ceiling: 148_200.0,
        // Première année sans le pour-cent de solidarité (supprimé au 1.1.2023).
        ac_solidarity_employee_pct: 0.0,
        laa_max_insured: 148_200.0,
        laa_nonoccupational_min_weekly_hours: 8.0,
        lpp_entry_threshold: 22_050.0,
        lpp_coordination_deduction: 25_725.0,
        lpp_avs_upper_limit: 88_200.0,
        lpp_min_coordinated: 3_675.0,
        lpp_credit_brackets: Cow::Borrowed(LPP_BRACKETS_CLASSIC),
        pillar3a_with_lpp: 7_056.0,
        pillar3a_without_lpp_pct: 20.0,
        pillar3a_without_lpp_cap: 35_280.0,
        pro_lump_sum_pct: 3.0,
        pro_lump_sum_min: 2_000.0,
        pro_lump_sum_max: 4_000.0,
        meals_full_year: 3_200.0,
        meals_subsidized_year: 1_600.0,
        meals_full_day: 15.0,
        meals_subsidized_day: 7.5,
        commute_cap_ifd: 3_000.0,
        commute_private_car_per_km: 0.7,
        private_car_monthly_pct: 0.9,
        private_car_monthly_min: 150.0,
        family_allowance_min_child: 215.0,
        family_allowance_min_training: 268.0,
        cantonal: CantonalParams::EMPTY,
    },
    PayrollParams {
        year: 2022,
        estimated: false,
        effective_year: 2022,
        source: "OFAS/AFC — chiffres clés assurances sociales 2022",
        verified_on: "2026-08-27",
        avs_ai_apg_employee_pct: 5.3,
        avs_ai_apg_employer_pct: 5.3,
        ac_employee_pct: 1.1,
        ac_ceiling: 148_200.0,
        // Dernière année du pour-cent de solidarité (0.5 % employé sur la
        // part au-dessus du plafond) : supprimé au 1.1.2023.
        ac_solidarity_employee_pct: 0.5,
        laa_max_insured: 148_200.0,
        laa_nonoccupational_min_weekly_hours: 8.0,
        lpp_entry_threshold: 21_510.0,
        lpp_coordination_deduction: 25_095.0,
        lpp_avs_upper_limit: 86_040.0,
        lpp_min_coordinated: 3_585.0,
        lpp_credit_brackets: Cow::Borrowed(LPP_BRACKETS_CLASSIC),
        pillar3a_with_lpp: 6_883.0,
        pillar3a_without_lpp_pct: 20.0,
        pillar3a_without_lpp_cap: 34_416.0,
        pro_lump_sum_pct: 3.0,
        pro_lump_sum_min: 2_000.0,
        pro_lump_sum_max: 4_000.0,
        meals_full_year: 3_200.0,
        meals_subsidized_year: 1_600.0,
        meals_full_day: 15.0,
        meals_subsidized_day: 7.5,
        commute_cap_ifd: 3_000.0,
        commute_private_car_per_km: 0.7,
        private_car_monthly_pct: 0.9,
        private_car_monthly_min: 150.0,
        family_allowance_min_child: 200.0,
        family_allowance_min_training: 250.0,
        cantonal: CantonalParams::EMPTY,
    },
];

/// Paramètres applicables à une année civile.
///
/// Année connue → ses propres valeurs. Année inconnue → l'année connue la
/// plus proche, avec `estimated = true` et `effective_year` renseigné pour
/// que l'UI puisse dire « barèmes 2026 appliqués à 2027 ».
pub fn params_for_year(year: i32) -> PayrollParams {
    if let Some(exact) = YEARS.iter().find(|p| p.year == year) {
        return exact.clone();
    }
    // La table est triée du plus récent au plus ancien : la meilleure
    // approximation est l'année connue dont l'écart est le plus faible.
    let nearest = YEARS
        .iter()
        .min_by_key(|p| (p.year - year).abs())
        .expect("YEARS ne doit jamais être vide");
    let mut p = nearest.clone();
    p.year = year;
    p.estimated = true;
    p
}

/// Années présentes dans la table, du plus récent au plus ancien. Sert à
/// alimenter le sélecteur d'année du front sans coder la liste deux fois.
pub fn known_years() -> Vec<i32> {
    YEARS.iter().map(|p| p.year).collect()
}

//! Contrôles de conformité d'un bulletin de salaire suisse.
//!
//! Chaque constat porte sa base légale. Le but n'est pas de produire le plus
//! d'alertes possible mais des alertes *justes* : un contrôle qu'on ne peut
//! pas faire (taux contractuel inconnu) est annoncé comme tel — jamais
//! remplacé par une valeur inventée.
//!
//! Les constats `Ok` sont conservés : voir « AVS conforme, 5.30 % » vaut
//! autant que voir une erreur, et c'est ce qui rend le panneau lisible.

use serde::Serialize;

use super::params::PayrollParams;
use super::{
    expected_deductions, expected_net, private_car_monthly, total_deductions, total_gross,
    EmploymentTerms, PayslipInput, YtdContext,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Contrôlé, conforme.
    Ok,
    /// Rien d'anormal, mais l'utilisateur doit le savoir (plafond atteint,
    /// contrôle impossible faute de donnée contractuelle…).
    Info,
    /// Écart réel mais explicable (arrondis, méthode de décompte cumulée).
    Warn,
    /// Écart qui ne s'explique pas par un arrondi.
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    /// Identifiant stable, pour les tests et le filtrage côté UI.
    pub id: &'static str,
    pub severity: Severity,
    /// Poste concerné, tel qu'il apparaît sur un bulletin.
    pub label: &'static str,
    pub message: String,
    /// Référence légale, affichée sous le constat.
    pub legal_ref: &'static str,
    pub expected: Option<f64>,
    pub actual: Option<f64>,
}

/// Tolérance d'arrondi : les employeurs arrondissent au centime, certains
/// pratiquent le décompte cumulé annuel, ce qui décale de quelques francs.
/// En dessous de ce seuil, on ne dit rien.
fn tolerance(expected: f64) -> f64 {
    (expected.abs() * 0.005).max(1.0)
}

/// Classe un écart : conforme, écart explicable, ou anomalie.
fn severity_for(expected: f64, actual: f64) -> Severity {
    let diff = (expected - actual).abs();
    if diff <= tolerance(expected) {
        Severity::Ok
    } else if diff <= (tolerance(expected) * 5.0).max(expected.abs() * 0.05) {
        Severity::Warn
    } else {
        Severity::Error
    }
}

fn money(v: f64) -> String {
    format!("{:.2}", v)
}

/// Constat comparant un montant retenu à un montant attendu.
fn compare(
    id: &'static str,
    label: &'static str,
    legal_ref: &'static str,
    expected: f64,
    actual: Option<f64>,
    missing_message: String,
    missing_severity: Severity,
) -> Finding {
    match actual {
        None => Finding {
            id,
            severity: missing_severity,
            label,
            message: missing_message,
            legal_ref,
            expected: Some(expected),
            actual: None,
        },
        Some(a) => {
            let sev = severity_for(expected, a);
            let message = match sev {
                Severity::Ok => format!("Conforme : {} CHF retenus.", money(a)),
                _ => format!(
                    "Retenue de {} CHF, {} CHF attendus (écart {} CHF).",
                    money(a),
                    money(expected),
                    money(a - expected)
                ),
            };
            Finding {
                id,
                severity: sev,
                label,
                message,
                legal_ref,
                expected: Some(expected),
                actual: Some(a),
            }
        }
    }
}

/// Contrôle complet d'un bulletin.
pub fn check_payslip(
    input: &PayslipInput,
    terms: &EmploymentTerms,
    ytd: &YtdContext,
    p: &PayrollParams,
) -> Vec<Finding> {
    let mut out = Vec::new();
    let exp = expected_deductions(input, terms, ytd, p);
    let subject = exp.avs_subject_gross;
    let periods = ytd.periods();

    if p.estimated {
        out.push(Finding {
            id: "params_estimated",
            severity: Severity::Info,
            label: "Barèmes",
            message: format!(
                "Aucun barème publié pour {} dans l'application : les valeurs {} sont appliquées. Vérifiez auprès de l'OFAS.",
                input.fiscal_year, p.effective_year
            ),
            legal_ref: "—",
            expected: None,
            actual: None,
        });
    }

    if subject <= 0.0 {
        out.push(Finding {
            id: "no_gross",
            severity: Severity::Info,
            label: "Salaire brut",
            message: "Aucun montant brut saisi : le contrôle des retenues est impossible.".into(),
            legal_ref: "art. 323b al. 1 CO",
            expected: None,
            actual: None,
        });
        return out;
    }

    // --- AVS / AI / APG : exact, sans plafond ---
    out.push(compare(
        "avs_rate",
        "AVS / AI / APG",
        "art. 5 LAVS — taux employé 5.30 %",
        exp.avs_ai_apg,
        input.avs_ai_apg,
        format!(
            "Aucune retenue AVS saisie ; {} CHF attendus sur un salaire déterminant de {} CHF.",
            money(exp.avs_ai_apg),
            money(subject)
        ),
        Severity::Warn,
    ));

    // Erreur classique : soumettre les allocations familiales à l'AVS.
    if let (Some(actual_avs), Some(alloc)) = (input.avs_ai_apg, input.family_allowance) {
        if alloc > 0.0 {
            let wrong_base = total_gross(input) * p.avs_ai_apg_employee_pct / 100.0;
            let closer_to_wrong = (actual_avs - wrong_base).abs() < (actual_avs - exp.avs_ai_apg).abs();
            if closer_to_wrong && (actual_avs - wrong_base).abs() <= tolerance(wrong_base) {
                out.push(Finding {
                    id: "allowance_in_avs_base",
                    severity: Severity::Error,
                    label: "Allocations familiales",
                    message: format!(
                        "La retenue AVS semble calculée sur {} CHF, allocations familiales comprises. Les allocations ne font pas partie du salaire déterminant : la base correcte est {} CHF.",
                        money(total_gross(input)),
                        money(subject)
                    ),
                    legal_ref: "art. 6 al. 2 let. f RAVS",
                    expected: Some(exp.avs_ai_apg),
                    actual: Some(actual_avs),
                });
            }
        }
    }

    // --- Assurance-chômage : plafond ANNUEL, d'où le cumul ---
    if exp.ac_base <= 0.0 {
        out.push(Finding {
            id: "ac_ceiling_reached",
            severity: Severity::Info,
            label: "Assurance-chômage",
            message: format!(
                "Plafond annuel de {} CHF déjà atteint ({} CHF cumulés) : plus aucune cotisation AC n'est due sur cette période.",
                money(p.ac_ceiling),
                money(ytd.avs_gross_before)
            ),
            legal_ref: "art. 3 al. 2 LACI",
            expected: Some(0.0),
            actual: input.ac,
        });
    } else {
        out.push(compare(
            "ac_rate",
            "Assurance-chômage",
            "art. 3 LACI — taux employé 1.10 % jusqu'au plafond",
            exp.ac,
            input.ac,
            format!("Aucune retenue AC saisie ; {} CHF attendus.", money(exp.ac)),
            Severity::Warn,
        ));
        if exp.ac_base < subject {
            out.push(Finding {
                id: "ac_ceiling_crossed",
                severity: Severity::Info,
                label: "Assurance-chômage",
                message: format!(
                    "Le plafond annuel est franchi pendant cette période : seuls {} CHF sur {} CHF sont soumis à l'AC.",
                    money(exp.ac_base),
                    money(subject)
                ),
                legal_ref: "art. 3 al. 2 LACI",
                expected: Some(exp.ac_base),
                actual: None,
            });
        }
    }

    // Pour-cent de solidarité : supprimé au 1.1.2023.
    if p.ac_solidarity_employee_pct > 0.0 && exp.ac_solidarity > 0.0 {
        out.push(compare(
            "ac_solidarity",
            "Pour-cent de solidarité AC",
            "art. 90c LACI — supprimé au 1.1.2023",
            exp.ac_solidarity,
            input.ac_solidarity,
            format!(
                "Pour {}, un pour-cent de solidarité de {} CHF était dû sur la part au-dessus du plafond.",
                input.fiscal_year,
                money(exp.ac_solidarity)
            ),
            Severity::Warn,
        ));
    } else if let Some(sol) = input.ac_solidarity {
        if sol > 0.0 {
            out.push(Finding {
                id: "ac_solidarity_abolished",
                severity: Severity::Error,
                label: "Pour-cent de solidarité AC",
                message: format!(
                    "{} CHF retenus au titre du pour-cent de solidarité, alors qu'il est supprimé depuis le 1er janvier 2023.",
                    money(sol)
                ),
                legal_ref: "suppression au 1.1.2023 (art. 90c al. 4 LACI)",
                expected: Some(0.0),
                actual: Some(sol),
            });
        }
    }

    // --- LPP ---
    let annual_reference = terms
        .annual_gross_agreed
        .unwrap_or_else(|| subject * periods);
    if exp.lpp_coordinated_salary <= 0.0 {
        out.push(Finding {
            id: "lpp_below_threshold",
            severity: Severity::Info,
            label: "2ᵉ pilier (LPP)",
            message: format!(
                "Salaire annuel de référence {} CHF, sous le seuil d'entrée de {} CHF : aucune affiliation obligatoire.",
                money(annual_reference),
                money(p.lpp_entry_threshold)
            ),
            legal_ref: "art. 2 al. 1 LPP",
            expected: Some(0.0),
            actual: input.lpp,
        });
    } else {
        match input.lpp {
            None | Some(0.0) => out.push(Finding {
                id: "lpp_missing",
                severity: Severity::Error,
                label: "2ᵉ pilier (LPP)",
                message: format!(
                    "Aucune retenue LPP alors que le salaire annuel ({} CHF) dépasse le seuil d'entrée de {} CHF. Salaire coordonné : {} CHF.",
                    money(annual_reference),
                    money(p.lpp_entry_threshold),
                    money(exp.lpp_coordinated_salary)
                ),
                legal_ref: "art. 2 al. 1 et art. 8 LPP",
                expected: exp.lpp_employee,
                actual: input.lpp,
            }),
            Some(actual) => {
                match exp.lpp_employee {
                    Some(expected) => out.push(compare(
                        "lpp_rate",
                        "2ᵉ pilier (LPP)",
                        "règlement de la caisse — taux employé saisi au contrat",
                        expected,
                        Some(actual),
                        String::new(),
                        Severity::Info,
                    )),
                    None => out.push(Finding {
                        id: "lpp_rate_unknown",
                        severity: Severity::Info,
                        label: "2ᵉ pilier (LPP)",
                        message: format!(
                            "Taux employé de la caisse non renseigné dans le contrat : le montant retenu ({} CHF) ne peut pas être vérifié. Salaire coordonné : {} CHF.",
                            money(actual),
                            money(exp.lpp_coordinated_salary)
                        ),
                        legal_ref: "art. 8 LPP (salaire coordonné)",
                        expected: None,
                        actual: Some(actual),
                    }),
                }

                // Borne légale : l'employeur finance au moins la moitié.
                if exp.lpp_employee_legal_cap > 0.0
                    && actual > exp.lpp_employee_legal_cap + tolerance(exp.lpp_employee_legal_cap)
                {
                    out.push(Finding {
                        id: "lpp_employee_share_too_high",
                        severity: Severity::Warn,
                        label: "2ᵉ pilier (LPP)",
                        message: format!(
                            "La part employé ({} CHF) dépasse la moitié de la bonification légale minimale ({} CHF par période). L'employeur doit financer au moins autant que le salarié — sauf si le plan est surobligatoire.",
                            money(actual),
                            money(exp.lpp_employee_legal_cap)
                        ),
                        legal_ref: "art. 66 al. 1 LPP",
                        expected: Some(exp.lpp_employee_legal_cap),
                        actual: Some(actual),
                    });
                }
            }
        }
    }

    // --- LAA / AANP : taux contractuel ---
    let laa_due = terms
        .weekly_hours
        .map(|h| h >= p.laa_nonoccupational_min_weekly_hours)
        .unwrap_or(true);
    match (exp.laa_nonoccupational, input.laa_nonoccupational) {
        (Some(expected), actual) if laa_due => out.push(compare(
            "laa_anp",
            "LAA — accidents non professionnels",
            "art. 91 al. 2 LAA — prime AANP à charge du salarié",
            expected,
            actual,
            format!("Aucune prime AANP saisie ; {} CHF attendus.", money(expected)),
            Severity::Warn,
        )),
        (_, Some(actual)) if !laa_due && actual > 0.0 => out.push(Finding {
            id: "laa_anp_not_due",
            severity: Severity::Warn,
            label: "LAA — accidents non professionnels",
            message: format!(
                "{} CHF de prime AANP retenus alors que le temps de travail hebdomadaire ({} h) est inférieur à {} h : l'assurance accidents non professionnels n'est pas obligatoire.",
                money(actual),
                terms.weekly_hours.unwrap_or(0.0),
                p.laa_nonoccupational_min_weekly_hours
            ),
            legal_ref: "art. 7 al. 2 LAA et art. 13 OLAA",
            expected: Some(0.0),
            actual: Some(actual),
        }),
        (None, Some(actual)) => out.push(Finding {
            id: "laa_anp_rate_unknown",
            severity: Severity::Info,
            label: "LAA — accidents non professionnels",
            message: format!(
                "Taux AANP non renseigné dans le contrat : les {} CHF retenus ne peuvent pas être vérifiés.",
                money(actual)
            ),
            legal_ref: "art. 91 al. 2 LAA",
            expected: None,
            actual: Some(actual),
        }),
        _ => {}
    }

    // --- Indemnités journalières maladie : purement contractuel ---
    match (exp.ijm, input.ijm) {
        (Some(expected), actual) => out.push(compare(
            "ijm",
            "Indemnités journalières maladie",
            "assurance facultative — taux saisi au contrat",
            expected,
            actual,
            format!("Aucune prime IJM saisie ; {} CHF attendus.", money(expected)),
            Severity::Info,
        )),
        (None, Some(actual)) => out.push(Finding {
            id: "ijm_rate_unknown",
            severity: Severity::Info,
            label: "Indemnités journalières maladie",
            message: format!(
                "Taux IJM non renseigné dans le contrat : les {} CHF retenus ne peuvent pas être vérifiés.",
                money(actual)
            ),
            legal_ref: "art. 324a al. 4 CO (régime dérogatoire)",
            expected: None,
            actual: Some(actual),
        }),
        _ => {}
    }

    // --- Part privée du véhicule d'entreprise ---
    if let Some(price) = terms.company_car_purchase_price {
        if price > 0.0 {
            let monthly = private_car_monthly(price, p);
            let expected_for_period = monthly * 12.0 / periods;
            out.push(compare(
                "company_car_private",
                "Part privée du véhicule",
                "AFC — 0.9 %/mois du prix d'achat HT, min. 150 CHF (ch. 2.2, case F)",
                expected_for_period,
                input.company_car_private,
                format!(
                    "Un véhicule d'entreprise est déclaré au contrat mais aucune part privée n'apparaît sur le bulletin ; {} CHF attendus.",
                    money(expected_for_period)
                ),
                Severity::Warn,
            ));
        }
    }

    // --- Heures supplémentaires : majoration de 25 % ---
    if let (Some(hours), Some(paid), Some(base), Some(weekly)) = (
        input.overtime_hours,
        input.overtime,
        input.base_salary,
        terms.weekly_hours,
    ) {
        // Sur un contrat à l'heure, le salaire de base mesure les heures
        // accomplies : le tarif horaire ne s'en déduit pas, et l'inventer
        // reviendrait à reprocher une majoration manquante sur un chiffre
        // fabriqué. Le contrôle ne s'applique simplement pas.
        if hours > 0.0 && weekly > 0.0 && base > 0.0 && !terms.hourly_paid {
            // Tarif horaire = salaire ANNUEL ÷ heures annuelles. Passer par
            // des « heures mensuelles moyennes » suppose douze paies : sur
            // treize, le salaire de base d'une paie est plus petit d'un
            // treizième, et le tarif horaire — donc la majoration de 25 %
            // attendue — était sous-estimé d'autant.
            let periods = terms.salary_periods_per_year.unwrap_or(12).max(1) as f64;
            let hourly = base * periods / (weekly * 52.0);
            let expected_paid = hours * hourly * 1.25;
            if paid < expected_paid - tolerance(expected_paid) {
                out.push(Finding {
                    id: "overtime_no_premium",
                    severity: Severity::Warn,
                    label: "Heures supplémentaires",
                    message: format!(
                        "{:.2} h payées {} CHF, soit {} CHF/h. Au tarif horaire de base ({} CHF) majoré de 25 %, {} CHF étaient attendus — sauf accord écrit prévoyant la compensation en congé ou l'exclusion de la majoration.",
                        hours,
                        money(paid),
                        money(paid / hours),
                        money(hourly),
                        money(expected_paid)
                    ),
                    legal_ref: "art. 321c al. 3 CO",
                    expected: Some(expected_paid),
                    actual: Some(paid),
                });
            }
        }
    }

    // --- Allocations familiales : minimum fédéral ---
    if let Some(alloc) = input.family_allowance {
        if alloc > 0.0 && periods >= 12.0 {
            let monthly = alloc * periods / 12.0;
            if monthly < p.family_allowance_min_child - 0.01 {
                out.push(Finding {
                    id: "family_allowance_below_minimum",
                    severity: Severity::Warn,
                    label: "Allocations familiales",
                    message: format!(
                        "{} CHF pour la période, soit moins que le minimum fédéral de {} CHF par enfant et par mois ({} CHF en formation). Les cantons peuvent aller au-delà, jamais en dessous.",
                        money(alloc),
                        money(p.family_allowance_min_child),
                        money(p.family_allowance_min_training)
                    ),
                    legal_ref: "art. 5 LAFam",
                    expected: Some(p.family_allowance_min_child),
                    actual: Some(monthly),
                });
            }
        }
    }

    // --- Cohérence brut → net ---
    let net_expected = expected_net(input);
    let net_sev = severity_for(net_expected, input.net_paid);
    out.push(Finding {
        id: "net_reconciliation",
        severity: net_sev,
        label: "Net à payer",
        message: match net_sev {
            Severity::Ok => format!(
                "Cohérent : {} CHF de brut − {} CHF de retenues = {} CHF versés.",
                money(total_gross(input)),
                money(total_deductions(input)),
                money(input.net_paid)
            ),
            _ => format!(
                "{} CHF versés, {} CHF attendus (brut {} − retenues {} + frais {}). Écart de {} CHF : une ligne manque probablement.",
                money(input.net_paid),
                money(net_expected),
                money(total_gross(input)),
                money(total_deductions(input)),
                money(
                    input.expense_reimbursement.unwrap_or(0.0)
                        + input.expense_lump_sum.unwrap_or(0.0)
                ),
                money(input.net_paid - net_expected)
            ),
        },
        legal_ref: "art. 323b al. 1 CO",
        expected: Some(net_expected),
        actual: Some(input.net_paid),
    });

    // --- Mentions obligatoires du décompte ---
    let mut missing: Vec<&str> = Vec::new();
    if input.gross_total.is_none() && input.base_salary.is_none() {
        missing.push("salaire brut");
    }
    if input.avs_ai_apg.is_none() {
        missing.push("AVS/AI/APG");
    }
    if input.ac.is_none() && exp.ac_base > 0.0 {
        missing.push("assurance-chômage");
    }
    if input.lpp.is_none() && exp.lpp_coordinated_salary > 0.0 {
        missing.push("2ᵉ pilier");
    }
    if !missing.is_empty() {
        out.push(Finding {
            id: "payslip_incomplete",
            severity: Severity::Warn,
            label: "Décompte de salaire",
            message: format!(
                "Poste(s) absent(s) : {}. L'employeur doit remettre un décompte écrit détaillant chaque retenue ; si le bulletin les omet, vous pouvez en exiger le détail.",
                missing.join(", ")
            ),
            legal_ref: "art. 323b al. 1 CO",
            expected: None,
            actual: None,
        });
    }

    out
}

/// Rabat les constats produits avec un barème non confirmé.
///
/// Contrôler une fiche ancienne suppose les barèmes de son année. Quand ceux-ci
/// viennent d'une saisie que personne n'a vérifiée contre une source
/// officielle, un écart ne prouve RIEN sur l'employeur : il peut tout aussi
/// bien venir du barème. Annoncer une anomalie serait alors une accusation
/// fabriquée — la pire sortie possible pour cet écran.
///
/// L'écart reste montré, à sa valeur près ; seule sa gravité est ramenée à un
/// avertissement, et la raison est dite. Confirmer l'année dans
/// Paramètres → Barèmes lève le plafond.
pub fn soften_unconfirmed(findings: Vec<Finding>, year: i32) -> Vec<Finding> {
    findings
        .into_iter()
        .map(|mut f| {
            if f.severity == Severity::Error {
                f.severity = Severity::Warn;
                f.message = format!(
                    "{} À vérifier : le barème {} n'a pas été confirmé, l'écart peut venir de lui.",
                    f.message, year
                );
            }
            f
        })
        .collect()
}

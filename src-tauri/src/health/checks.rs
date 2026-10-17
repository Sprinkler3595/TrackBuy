//! Contrôles d'une police d'assurance maladie.
//!
//! Chaque constat porte sa base légale, comme pour la paie. Le moteur ne
//! connaît que ce que l'utilisateur a saisi : sans année de naissance, il ne
//! juge pas la franchise ; sans contrat de travail, il ne juge pas la
//! couverture accidents — il le dit.

use chrono::{Datelike, NaiveDate};
use serde::Serialize;

use super::params::{age_class, params_for_year, AgeClass};
use crate::payroll::checks::Severity;

#[derive(Debug, Clone, Serialize)]
pub struct HealthFinding {
    pub id: &'static str,
    pub severity: Severity,
    pub message: String,
    pub legal_ref: &'static str,
}

/// Les contrats de travail en cours de l'assuré, tels que la paie les
/// connaît. `None` dans `PolicyFacts` : l'assuré n'a pas d'emploi saisi.
#[derive(Debug, Clone, Default)]
pub struct EmploymentContext {
    /// Heures hebdomadaires de chaque contrat en cours, `None` quand le
    /// contrat ne les indique pas.
    pub weekly_hours: Vec<Option<f64>>,
}

/// Les termes de l'année suivante, lus sur l'avis de prime.
#[derive(Debug, Clone, Default)]
pub struct NoticeFacts {
    pub monthly_premium: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct PolicyFacts {
    /// `basic` (LAMal) ou `supplementary` (LCA).
    pub kind: String,
    pub birth_year: Option<i32>,
    pub franchise: Option<f64>,
    pub accident_covered: Option<bool>,
    /// Prime mensuelle brute (avant réduction de primes) de l'année en cours.
    pub monthly_premium: Option<f64>,
    pub next_year_notice: Option<NoticeFacts>,
    pub employment: Option<EmploymentContext>,
    /// Durée hebdomadaire dès laquelle l'employeur assure les accidents non
    /// professionnels (art. 13 OLAA), lue dans les barèmes de paie.
    pub laa_min_weekly_hours: f64,
    pub today: NaiveDate,
}

fn finding(id: &'static str, severity: Severity, message: String, legal_ref: &'static str) -> HealthFinding {
    HealthFinding { id, severity, message, legal_ref }
}

fn chf(v: f64) -> String {
    if v.fract() == 0.0 { format!("{v:.0}") } else { format!("{v:.2}") }
}

pub fn check_policy(f: &PolicyFacts) -> Vec<HealthFinding> {
    let mut out = Vec::new();
    let year = f.today.year();
    let params = params_for_year(year);

    if f.kind == "supplementary" {
        out.push(finding(
            "lca_switch_order",
            Severity::Info,
            "Assurance complémentaire (LCA) : l'assureur peut refuser une nouvelle demande ou \
             poser des réserves après questionnaire de santé. Ne résiliez une complémentaire \
             qu'une fois la nouvelle acceptée par écrit. Le délai de résiliation est celui de \
             la police, pas celui de la LAMal."
                .to_string(),
            "LCA ; conditions générales de la police",
        ));
        return out;
    }

    // --- Franchise admise pour la classe d'âge ---
    let class = f.birth_year.map(|b| age_class(&params, b, year));
    match (class, f.franchise) {
        (Some(class), Some(franchise)) => {
            let allowed = params.franchises_for(class);
            if !allowed.iter().any(|a| (a - franchise).abs() < 0.5) {
                let list: Vec<String> = allowed.iter().map(|a| chf(*a)).collect();
                out.push(finding(
                    "franchise_not_allowed",
                    Severity::Error,
                    format!(
                        "Une franchise de {} CHF n'existe pas pour {}. Franchises possibles : {} CHF.",
                        chf(franchise),
                        if class == AgeClass::Child { "un enfant" } else { "un adulte" },
                        list.join(", ")
                    ),
                    "art. 93 OAMal",
                ));
            }
        }
        (None, _) => out.push(finding(
            "birth_unknown",
            Severity::Info,
            "Année de naissance inconnue : la franchise et les changements de classe d'âge ne \
             peuvent pas être vérifiés."
                .to_string(),
            "art. 61 al. 3 LAMal",
        )),
        _ => {}
    }

    // --- Changement de classe d'âge au 1er janvier ---
    let mut class_changes = false;
    if let (Some(birth), Some(class)) = (f.birth_year, class) {
        let next_params = params_for_year(year + 1);
        let next_class = age_class(&next_params, birth, year + 1);
        if next_class != class {
            class_changes = true;
            let msg = match next_class {
                AgeClass::YoungAdult => format!(
                    "Au 1.1.{} l'assuré passe en catégorie « jeunes adultes » : la prime augmente \
                     nettement et les franchises d'enfant disparaissent. Sans choix de votre part, \
                     la caisse applique la franchise ordinaire de {} CHF.",
                    year + 1,
                    chf(next_params.adult_ordinary_franchise)
                ),
                _ => format!(
                    "Au 1.1.{} l'assuré passe en catégorie « adultes » : la prime de jeune adulte \
                     prend fin, attendez-vous à une hausse plus forte que la moyenne.",
                    year + 1
                ),
            };
            out.push(finding("age_class_change", Severity::Warn, msg, "art. 61 al. 3 LAMal"));
        }
    }

    // --- Couverture accidents ---
    match (&f.employment, f.accident_covered) {
        (Some(emp), Some(covered)) if !emp.weekly_hours.is_empty() => {
            let known: Vec<f64> = emp.weekly_hours.iter().flatten().copied().collect();
            let max = known.iter().copied().fold(None, |m: Option<f64>, h| Some(m.map_or(h, |m| m.max(h))));
            let all_known = known.len() == emp.weekly_hours.len();
            match max {
                Some(h) if h >= f.laa_min_weekly_hours && covered => out.push(finding(
                    "accident_double_cover",
                    Severity::Warn,
                    format!(
                        "Vous travaillez {} h par semaine chez un même employeur : son assurance \
                         LAA couvre déjà les accidents non professionnels. La couverture accidents \
                         de la caisse maladie peut être suspendue sur demande, avec une attestation \
                         de l'employeur — la prime baisse d'autant.",
                        chf(h)
                    ),
                    "art. 8 LAMal ; art. 13 OLAA",
                )),
                Some(h) if h < f.laa_min_weekly_hours && all_known && !covered => out.push(finding(
                    "accident_not_covered",
                    Severity::Error,
                    format!(
                        "Aucun emploi d'au moins {} h par semaine : les accidents non professionnels \
                         ne sont pas couverts par l'employeur, et la couverture accidents de la \
                         caisse maladie est suspendue. Demandez sa réactivation.",
                        chf(f.laa_min_weekly_hours)
                    ),
                    "art. 8 LAMal ; art. 13 OLAA",
                )),
                None => out.push(finding(
                    "accident_hours_unknown",
                    Severity::Info,
                    "Le contrat de travail n'indique pas les heures hebdomadaires : impossible de \
                     dire si l'employeur couvre les accidents non professionnels."
                        .to_string(),
                    "art. 13 OLAA",
                )),
                _ => {}
            }
        }
        (None, Some(false)) => out.push(finding(
            "accident_suspended_no_job",
            Severity::Warn,
            "Couverture accidents suspendue, et aucun emploi en cours n'est saisi pour cette \
             personne. Sans employeur, rien ne la couvre contre les accidents si la caisse maladie \
             ne le fait pas : indépendante, sans emploi ou en fin de contrat (la LAA ne couvre que \
             31 jours après la fin du droit au salaire), demandez la réactivation. Salariée, \
             saisissez son contrat dans Revenus pour que ce contrôle soit exact."
                .to_string(),
            "art. 8 LAMal ; art. 3 al. 2 LAA",
        )),
        _ => {}
    }

    // --- Avis de prime de l'année suivante ---
    let notice_due = NaiveDate::from_ymd_opt(year, 10, 31).expect("date valide");
    match &f.next_year_notice {
        None if f.today > notice_due => out.push(finding(
            "notice_missing",
            Severity::Warn,
            format!(
                "Aucun avis de prime {} saisi. La caisse devait l'envoyer avant le 31 octobre : \
                 retrouvez-le (courrier, portail client) et saisissez-le pour comparer à temps.",
                year + 1
            ),
            "art. 7 al. 2 LAMal",
        )),
        Some(NoticeFacts { monthly_premium: Some(new) }) => {
            if let Some(old) = f.monthly_premium.filter(|o| *o > 0.0) {
                let pct = (new - old) / old * 100.0;
                let avg = params_for_year(year + 1).ofsp_average_change_pct;
                let (severity, tail) = match avg {
                    // Le saut de classe d'âge explique la hausse : la comparer à
                    // la moyenne suisse ne ferait qu'alarmer à tort.
                    _ if class_changes => (
                        Severity::Info,
                        " — hausse due au changement de classe d'âge, pas à la caisse. Comparez \
                         tout de même les primes de jeune adulte ou d'adulte des autres caisses."
                            .to_string(),
                    ),
                    Some(a) if pct > a + 1.0 => (
                        Severity::Warn,
                        format!(" — au-dessus de la moyenne suisse annoncée par l'OFSP ({a:+.1} %). Comparez avant le 30 novembre."),
                    ),
                    Some(a) => (Severity::Info, format!(" (moyenne suisse OFSP : {a:+.1} %).")),
                    None => (Severity::Info, ".".to_string()),
                };
                out.push(finding(
                    "notice_change",
                    severity,
                    format!(
                        "Prime {} : {} CHF par mois contre {} CHF, soit {pct:+.1} %{tail}",
                        year + 1,
                        chf(*new),
                        chf(old)
                    ),
                    "art. 7 al. 2 LAMal",
                ));
            }
        }
        _ => {}
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PolicyFacts {
        PolicyFacts {
            kind: "basic".into(),
            birth_year: Some(1990),
            franchise: Some(2500.0),
            accident_covered: Some(true),
            monthly_premium: Some(400.0),
            next_year_notice: None,
            employment: None,
            laa_min_weekly_hours: 8.0,
            today: NaiveDate::from_ymd_opt(2026, 10, 17).unwrap(),
        }
    }

    fn ids(f: &PolicyFacts) -> Vec<&'static str> {
        check_policy(f).iter().map(|x| x.id).collect()
    }

    #[test]
    fn police_ordinaire_sans_remarque() {
        assert!(ids(&base()).is_empty());
    }

    #[test]
    fn franchise_d_enfant_sur_un_adulte() {
        let f = PolicyFacts { franchise: Some(600.0), ..base() };
        assert!(ids(&f).contains(&"franchise_not_allowed"));
    }

    #[test]
    fn passage_en_jeune_adulte_annonce() {
        // Né en 2008 : 18 ans en 2026, jeune adulte en 2027.
        let f = PolicyFacts { birth_year: Some(2008), franchise: Some(0.0), ..base() };
        let all = ids(&f);
        assert!(all.contains(&"age_class_change"));
        assert!(!all.contains(&"franchise_not_allowed"));
    }

    #[test]
    fn double_couverture_accidents() {
        let f = PolicyFacts {
            employment: Some(EmploymentContext { weekly_hours: vec![Some(42.0)] }),
            ..base()
        };
        assert!(ids(&f).contains(&"accident_double_cover"));
    }

    #[test]
    fn petit_temps_partiel_sans_couverture_accidents() {
        let f = PolicyFacts {
            accident_covered: Some(false),
            employment: Some(EmploymentContext { weekly_hours: vec![Some(6.0)] }),
            ..base()
        };
        assert!(ids(&f).contains(&"accident_not_covered"));
    }

    #[test]
    fn suspension_sans_emploi() {
        let f = PolicyFacts { accident_covered: Some(false), ..base() };
        assert!(ids(&f).contains(&"accident_suspended_no_job"));
    }

    #[test]
    fn avis_manquant_apres_octobre() {
        let f = PolicyFacts { today: NaiveDate::from_ymd_opt(2026, 11, 5).unwrap(), ..base() };
        assert!(ids(&f).contains(&"notice_missing"));
    }

    #[test]
    fn hausse_au_dessus_de_la_moyenne() {
        let f = PolicyFacts {
            next_year_notice: Some(NoticeFacts { monthly_premium: Some(440.0) }),
            ..base()
        };
        let all = check_policy(&f);
        let n = all.iter().find(|x| x.id == "notice_change").unwrap();
        assert_eq!(n.severity, Severity::Warn, "{}", n.message);
        assert!(n.message.contains("+10.0 %"));
    }

    #[test]
    fn complementaire_rappelle_l_ordre_des_operations() {
        let f = PolicyFacts { kind: "supplementary".into(), ..base() };
        assert_eq!(ids(&f), vec!["lca_switch_order"]);
    }
}

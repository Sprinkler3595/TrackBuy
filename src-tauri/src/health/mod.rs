//! Assurance maladie suisse : barèmes LAMal, participation aux coûts,
//! comparaison des franchises, calendrier de la saison des primes et
//! contrôles d'une police.
//!
//! Comme `payroll`, le module ignore la base : il prend des valeurs, rend des
//! valeurs, et se teste sans coffre. `commands::health` fait la traduction.
//!
//! Ce que le moteur sait calculer exactement, c'est la participation aux
//! coûts : franchise puis 10 % de quote-part plafonnée, des règles fédérales
//! identiques chez tous les assureurs. Ce qu'il ne devine jamais, ce sont les
//! primes : elles dépendent de l'assureur, de la région, du modèle et de la
//! franchise, et se lisent sur la police ou sur l'avis de prime. Sans prime
//! saisie pour une franchise, celle-ci n'entre pas dans la comparaison.

pub mod calendar;
pub mod checks;
pub mod params;
pub mod supplementary;

pub use params::{age_class, known_years, params_for_year, AgeClass, HealthParams};

use serde::{Deserialize, Serialize};

/// Participation aux coûts qu'entraînent `covered_costs` francs de
/// prestations LAMal sur une année, pour une franchise donnée.
///
/// Le calcul vaut pour une année CIVILE entière avec un seul assureur. La
/// contribution aux frais hospitaliers n'y entre pas : elle ne compte dans
/// aucun plafond et dépend du nombre de jours, pas des coûts.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Participation {
    pub franchise: f64,
    pub quote_part: f64,
    pub total: f64,
}

pub fn participation(params: &HealthParams, class: AgeClass, franchise: f64, covered_costs: f64) -> Participation {
    let costs = covered_costs.max(0.0);
    let f = costs.min(franchise.max(0.0));
    let q = ((costs - f) * params.quote_part_pct / 100.0).min(params.quote_part_cap_for(class));
    Participation { franchise: round2(f), quote_part: round2(q), total: round2(f + q) }
}

/// Une franchise et la prime mensuelle que l'assureur demande pour elle.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FranchiseOption {
    pub franchise: f64,
    pub monthly_premium: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FranchiseCost {
    pub franchise: f64,
    pub annual_premium: f64,
    pub participation: Participation,
    /// Prime annuelle + participation : ce que coûte réellement l'année.
    pub total: f64,
}

/// Seuil de coûts à partir duquel la franchise basse redevient la meilleure.
#[derive(Debug, Clone, Serialize)]
pub struct BreakEven {
    pub lower_franchise: f64,
    pub higher_franchise: f64,
    /// `None` quand la franchise haute l'emporte à tous les niveaux de coûts
    /// examinés, ou la basse partout (prime haute moins chère : rare, mais
    /// une saisie erronée le produit).
    pub costs_above: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FranchiseComparison {
    pub expected_costs: f64,
    pub options: Vec<FranchiseCost>,
    /// Franchise la moins chère au niveau de coûts attendu.
    pub best_franchise: Option<f64>,
    pub break_evens: Vec<BreakEven>,
    /// Coût total de chaque option sur une grille de coûts, pour tracer la
    /// courbe : `(coûts, [total par option, dans l'ordre de options])`.
    pub curve: Vec<(f64, Vec<f64>)>,
    /// Pire cas d'une option : prime + franchise + quote-part maximale.
    pub worst_cases: Vec<(f64, f64)>,
}

const CURVE_MAX: f64 = 10_000.0;
const CURVE_STEP: f64 = 250.0;
const BREAK_EVEN_STEP: f64 = 10.0;
const BREAK_EVEN_MAX: f64 = 30_000.0;

pub fn compare_franchises(
    params: &HealthParams,
    class: AgeClass,
    options: &[FranchiseOption],
    expected_costs: f64,
) -> FranchiseComparison {
    let mut opts: Vec<FranchiseOption> = options
        .iter()
        .filter(|o| o.monthly_premium.is_finite() && o.monthly_premium >= 0.0 && o.franchise >= 0.0)
        .cloned()
        .collect();
    opts.sort_by(|a, b| a.franchise.total_cmp(&b.franchise));
    opts.dedup_by(|a, b| a.franchise == b.franchise);

    let total_at = |o: &FranchiseOption, costs: f64| {
        o.monthly_premium * 12.0 + participation(params, class, o.franchise, costs).total
    };

    let costed: Vec<FranchiseCost> = opts
        .iter()
        .map(|o| {
            let p = participation(params, class, o.franchise, expected_costs);
            FranchiseCost {
                franchise: o.franchise,
                annual_premium: round2(o.monthly_premium * 12.0),
                participation: p,
                total: round2(o.monthly_premium * 12.0 + p.total),
            }
        })
        .collect();

    let best_franchise = costed
        .iter()
        .min_by(|a, b| a.total.total_cmp(&b.total).then(a.franchise.total_cmp(&b.franchise)))
        .map(|c| c.franchise);

    let mut break_evens = Vec::new();
    for pair in opts.windows(2) {
        let (low, high) = (&pair[0], &pair[1]);
        let mut costs = 0.0;
        let mut found = None;
        while costs <= BREAK_EVEN_MAX {
            if total_at(low, costs) < total_at(high, costs) {
                found = Some(costs);
                break;
            }
            costs += BREAK_EVEN_STEP;
        }
        // Une franchise basse gagnante dès zéro franc de coûts signale une
        // prime haute plus chère que la basse : pas un seuil, une anomalie.
        let costs_above = found.filter(|c| *c > 0.0);
        break_evens.push(BreakEven {
            lower_franchise: low.franchise,
            higher_franchise: high.franchise,
            costs_above,
        });
    }

    let mut curve = Vec::new();
    let mut c = 0.0;
    while c <= CURVE_MAX {
        curve.push((c, opts.iter().map(|o| round2(total_at(o, c))).collect()));
        c += CURVE_STEP;
    }

    let worst_cases = opts
        .iter()
        .map(|o| {
            (o.franchise, round2(o.monthly_premium * 12.0 + o.franchise + params.quote_part_cap_for(class)))
        })
        .collect();

    FranchiseComparison {
        expected_costs: round2(expected_costs.max(0.0)),
        options: costed,
        best_franchise,
        break_evens,
        curve,
        worst_cases,
    }
}

/// Une ligne de décompte de prestations, telle que l'assureur la présente.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct ClaimAmounts {
    pub invoiced: f64,
    pub insurer_paid: f64,
    pub franchise: f64,
    pub quote_part: f64,
    pub hospital: f64,
    pub not_covered: f64,
}

/// Où en est l'année : ce qui a déjà été pris en charge par l'assuré, et ce
/// qu'il peut encore avoir à payer au plus.
#[derive(Debug, Clone, Serialize)]
pub struct ParticipationStatus {
    pub franchise: f64,
    pub franchise_used: f64,
    pub franchise_remaining: f64,
    pub quote_part_cap: f64,
    pub quote_part_used: f64,
    pub quote_part_remaining: f64,
    pub hospital_paid: f64,
    pub not_covered: f64,
    pub invoiced: f64,
    pub insurer_paid: f64,
    /// Franchise restante + quote-part restante. Hors frais hospitaliers et
    /// prestations non couvertes, qui n'ont pas de plafond.
    pub max_remaining: f64,
    /// Les décomptes dépassent ce que la loi permet : franchise ou
    /// quote-part au-delà du plafond. Une erreur de saisie, ou une franchise
    /// qui n'est pas celle de la police.
    pub over_cap: bool,
}

pub fn participation_status(
    params: &HealthParams,
    class: AgeClass,
    franchise: f64,
    claims: &[ClaimAmounts],
) -> ParticipationStatus {
    let sum = |f: fn(&ClaimAmounts) -> f64| round2(claims.iter().map(f).sum());
    let franchise_used = sum(|c| c.franchise);
    let quote_part_used = sum(|c| c.quote_part);
    let cap = params.quote_part_cap_for(class);
    let franchise_remaining = round2((franchise - franchise_used).max(0.0));
    let quote_part_remaining = round2((cap - quote_part_used).max(0.0));
    ParticipationStatus {
        franchise,
        franchise_used,
        franchise_remaining,
        quote_part_cap: cap,
        quote_part_used,
        quote_part_remaining,
        hospital_paid: sum(|c| c.hospital),
        not_covered: sum(|c| c.not_covered),
        invoiced: sum(|c| c.invoiced),
        insurer_paid: sum(|c| c.insurer_paid),
        max_remaining: round2(franchise_remaining + quote_part_remaining),
        over_cap: franchise_used > franchise + 0.5 || quote_part_used > cap + 0.5,
    }
}

pub(crate) fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p() -> HealthParams {
        params_for_year(2027)
    }

    #[test]
    fn participation_franchise_puis_quote_part_plafonnee() {
        let p = p();
        // 2000 de coûts, franchise 300 : 300 + 10 % de 1700 = 470.
        let r = participation(&p, AgeClass::Adult, 300.0, 2000.0);
        assert_eq!(r, Participation { franchise: 300.0, quote_part: 170.0, total: 470.0 });
        // 50 000 de coûts : le plafond de 700 s'applique.
        let r = participation(&p, AgeClass::Adult, 2500.0, 50_000.0);
        assert_eq!(r.total, 3200.0);
        // Enfant : plafond de 350.
        let r = participation(&p, AgeClass::Child, 0.0, 50_000.0);
        assert_eq!(r.total, 350.0);
        // Pas de coûts, pas de participation.
        assert_eq!(participation(&p, AgeClass::Adult, 2500.0, 0.0).total, 0.0);
    }

    #[test]
    fn comparaison_designe_la_meilleure_et_le_seuil() {
        let p = p();
        // Primes réalistes : 2500 coûte 110 de moins par mois que 300.
        let opts = vec![
            FranchiseOption { franchise: 2500.0, monthly_premium: 380.0 },
            FranchiseOption { franchise: 300.0, monthly_premium: 490.0 },
        ];
        let low_costs = compare_franchises(&p, AgeClass::Adult, &opts, 200.0);
        assert_eq!(low_costs.best_franchise, Some(2500.0));
        assert_eq!(low_costs.options[0].franchise, 300.0, "triées par franchise");

        let high_costs = compare_franchises(&p, AgeClass::Adult, &opts, 8000.0);
        assert_eq!(high_costs.best_franchise, Some(300.0));

        // Écart de prime annuel 1320 ; au-delà de la franchise haute, la
        // basse paie 300 + 700 = 1000 contre 2500 + 700 = 3200 : 2200 d'écart.
        // Le seuil existe donc, quelque part entre 1320 et 2500 de coûts.
        let be = &low_costs.break_evens[0];
        let at = be.costs_above.expect("un seuil existe");
        assert!(at > 1300.0 && at < 2500.0, "seuil {at}");
    }

    #[test]
    fn prime_haute_plus_chere_n_a_pas_de_seuil() {
        let p = p();
        let opts = vec![
            FranchiseOption { franchise: 300.0, monthly_premium: 400.0 },
            FranchiseOption { franchise: 2500.0, monthly_premium: 420.0 },
        ];
        let c = compare_franchises(&p, AgeClass::Adult, &opts, 0.0);
        assert_eq!(c.best_franchise, Some(300.0));
        assert_eq!(c.break_evens[0].costs_above, None);
    }

    #[test]
    fn pire_cas_prime_plus_franchise_plus_plafond() {
        let p = p();
        let opts = vec![FranchiseOption { franchise: 1000.0, monthly_premium: 400.0 }];
        let c = compare_franchises(&p, AgeClass::Adult, &opts, 0.0);
        assert_eq!(c.worst_cases, vec![(1000.0, 4800.0 + 1000.0 + 700.0)]);
    }

    #[test]
    fn suivi_de_participation() {
        let p = p();
        let claims = vec![
            ClaimAmounts { invoiced: 400.0, franchise: 400.0, ..Default::default() },
            ClaimAmounts { invoiced: 1500.0, insurer_paid: 900.0, franchise: 100.0, quote_part: 140.0, ..Default::default() },
        ];
        let s = participation_status(&p, AgeClass::Adult, 500.0, &claims);
        assert_eq!(s.franchise_remaining, 0.0);
        assert_eq!(s.quote_part_remaining, 560.0);
        assert_eq!(s.max_remaining, 560.0);
        assert!(!s.over_cap);

        let too_much = vec![ClaimAmounts { franchise: 900.0, ..Default::default() }];
        assert!(participation_status(&p, AgeClass::Adult, 500.0, &too_much).over_cap);
    }
}

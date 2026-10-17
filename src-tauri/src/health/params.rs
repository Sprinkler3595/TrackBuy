//! Barèmes de l'assurance obligatoire des soins (LAMal / OAMal), versionnés
//! par année civile.
//!
//! Même règle que pour la paie : toute valeur chiffrée vit ici et NULLE PART
//! ailleurs. Le front appelle `get_health_params(year)` et ne connaît aucune
//! franchise ni aucun plafond.
//!
//! Ce qui change chaque automne, ce sont les PRIMES — propres à chaque
//! assureur, chaque région et chaque personne, elles se saisissent sur la
//! police et sur l'avis de prime, jamais ici. Ce qui est dans ce fichier est
//! le cadre légal, stable d'une année à l'autre mais pas figé : la franchise
//! ordinaire de 300 francs date de 2004, et le Conseil fédéral a mis en
//! consultation en mars 2026 son relèvement à 400 francs. Le jour où ce
//! relèvement entre en vigueur, une nouvelle ligne dans `YEARS` suffit.
//!
//! Une année inconnue retombe sur la dernière connue avec `estimated = true`,
//! ce que l'UI affiche.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct HealthParams {
    pub year: i32,
    pub estimated: bool,
    pub effective_year: i32,
    pub source: &'static str,
    pub verified_on: &'static str,

    // --- Franchises (art. 64 al. 2 let. a LAMal, art. 93 OAMal) ---
    /// Franchise ordinaire des adultes (dès 19 ans).
    pub adult_ordinary_franchise: f64,
    /// Franchises à option admises pour les adultes. L'assureur n'est pas
    /// tenu de toutes les proposer.
    pub adult_franchises: &'static [f64],
    /// Les enfants n'ont pas de franchise ordinaire : 0 franc.
    pub child_ordinary_franchise: f64,
    pub child_franchises: &'static [f64],

    // --- Quote-part (art. 64 al. 2 let. b LAMal, art. 103 OAMal) ---
    /// Part des coûts dépassant la franchise, en %.
    pub quote_part_pct: f64,
    /// Quote-part sur un médicament original quand un générique meilleur
    /// marché existe (art. 38a OPAS, 40 % depuis le 1.1.2024).
    pub quote_part_original_drug_pct: f64,
    pub quote_part_cap_adult: f64,
    pub quote_part_cap_child: f64,

    // --- Contribution aux frais de séjour hospitalier (art. 64 al. 5 LAMal) ---
    /// Par jour d'hospitalisation. Pas due par les enfants ni par les jeunes
    /// adultes en formation, ni pendant la maternité (art. 104 OAMal).
    pub hospital_daily_contribution: f64,

    // --- Classes d'âge des primes (art. 61 al. 3 LAMal) ---
    /// Enfant jusqu'à la fin de l'année de ses 18 ans.
    pub child_max_age: i32,
    /// Jeune adulte jusqu'à la fin de l'année de ses 25 ans.
    pub young_adult_max_age: i32,

    // --- Repères publiés par l'OFSP fin septembre ---
    /// Prime mensuelle moyenne, toutes classes d'âge, en CHF. Sert de repère
    /// pour situer la hausse d'un avis de prime, jamais de valeur de calcul.
    pub ofsp_average_monthly_premium: Option<f64>,
    /// Hausse moyenne annoncée par rapport à l'année précédente, en %.
    pub ofsp_average_change_pct: Option<f64>,
}

const ADULT_FRANCHISES: &[f64] = &[300.0, 500.0, 1000.0, 1500.0, 2000.0, 2500.0];
const CHILD_FRANCHISES: &[f64] = &[0.0, 100.0, 200.0, 300.0, 400.0, 500.0, 600.0];

const fn year(
    y: i32,
    avg: Option<f64>,
    change: Option<f64>,
    source: &'static str,
    verified_on: &'static str,
) -> HealthParams {
    HealthParams {
        year: y,
        estimated: false,
        effective_year: y,
        source,
        verified_on,
        adult_ordinary_franchise: 300.0,
        adult_franchises: ADULT_FRANCHISES,
        child_ordinary_franchise: 0.0,
        child_franchises: CHILD_FRANCHISES,
        quote_part_pct: 10.0,
        quote_part_original_drug_pct: 40.0,
        quote_part_cap_adult: 700.0,
        quote_part_cap_child: 350.0,
        hospital_daily_contribution: 15.0,
        child_max_age: 18,
        young_adult_max_age: 25,
        ofsp_average_monthly_premium: avg,
        ofsp_average_change_pct: change,
    }
}

/// Années livrées, de la plus ancienne à la plus récente.
const YEARS: &[HealthParams] = &[
    year(2024, Some(359.50), Some(8.7),
        "OFSP, primes 2024 ; LAMal art. 61-64 ; OAMal art. 93-104 ; OPAS art. 38a", "2026-10-17"),
    year(2025, Some(378.70), Some(6.0),
        "OFSP, primes 2025 ; LAMal art. 61-64 ; OAMal art. 93-104 ; OPAS art. 38a", "2026-10-17"),
    year(2026, Some(393.30), Some(4.4),
        "OFSP, primes 2026 ; LAMal art. 61-64 ; OAMal art. 93-104 ; OPAS art. 38a", "2026-10-17"),
    year(2027, Some(412.00), Some(5.0),
        "OFSP, communiqué du 29.09.2026 (primes 2027) ; LAMal art. 61-64 ; OAMal art. 93-104", "2026-10-17"),
];

pub fn known_years() -> Vec<i32> {
    YEARS.iter().map(|p| p.year).collect()
}

/// Barème de `year`, ou celui de l'année connue la plus proche marqué
/// `estimated`. Les repères OFSP ne sont pas extrapolés : une moyenne
/// d'une autre année n'a rien à dire sur celle-ci.
pub fn params_for_year(year: i32) -> HealthParams {
    if let Some(p) = YEARS.iter().find(|p| p.year == year) {
        return p.clone();
    }
    let nearest = if year < YEARS[0].year { &YEARS[0] } else { &YEARS[YEARS.len() - 1] };
    HealthParams {
        year,
        estimated: true,
        ofsp_average_monthly_premium: None,
        ofsp_average_change_pct: None,
        ..nearest.clone()
    }
}

/// Classe d'âge des primes et de la participation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgeClass {
    Child,
    YoungAdult,
    Adult,
}

/// La classe d'âge se lit sur l'ANNÉE de naissance, pas sur l'anniversaire :
/// on change de catégorie le 1er janvier qui suit ses 18 et ses 25 ans.
pub fn age_class(params: &HealthParams, birth_year: i32, year: i32) -> AgeClass {
    let age = year - birth_year;
    if age <= params.child_max_age {
        AgeClass::Child
    } else if age <= params.young_adult_max_age {
        AgeClass::YoungAdult
    } else {
        AgeClass::Adult
    }
}

impl HealthParams {
    pub fn franchises_for(&self, class: AgeClass) -> &'static [f64] {
        match class {
            AgeClass::Child => self.child_franchises,
            _ => self.adult_franchises,
        }
    }

    pub fn ordinary_franchise_for(&self, class: AgeClass) -> f64 {
        match class {
            AgeClass::Child => self.child_ordinary_franchise,
            _ => self.adult_ordinary_franchise,
        }
    }

    pub fn quote_part_cap_for(&self, class: AgeClass) -> f64 {
        match class {
            AgeClass::Child => self.quote_part_cap_child,
            _ => self.quote_part_cap_adult,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn annee_connue_non_estimee() {
        let p = params_for_year(2027);
        assert!(!p.estimated);
        assert_eq!(p.adult_ordinary_franchise, 300.0);
        assert_eq!(p.ofsp_average_change_pct, Some(5.0));
    }

    #[test]
    fn annee_future_estimee_sans_repere_ofsp() {
        let p = params_for_year(2031);
        assert!(p.estimated);
        assert_eq!(p.effective_year, 2027);
        assert_eq!(p.ofsp_average_change_pct, None);
        assert_eq!(p.quote_part_cap_adult, 700.0);
    }

    #[test]
    fn classe_d_age_suit_l_annee_de_naissance() {
        let p = params_for_year(2027);
        assert_eq!(age_class(&p, 2009, 2027), AgeClass::Child); // 18 ans dans l'année
        assert_eq!(age_class(&p, 2008, 2027), AgeClass::YoungAdult); // 19
        assert_eq!(age_class(&p, 2002, 2027), AgeClass::YoungAdult); // 25
        assert_eq!(age_class(&p, 2001, 2027), AgeClass::Adult); // 26
    }

    #[test]
    fn franchises_selon_classe() {
        let p = params_for_year(2026);
        assert!(p.franchises_for(AgeClass::Child).contains(&600.0));
        assert!(!p.franchises_for(AgeClass::Adult).contains(&600.0));
        assert_eq!(p.ordinary_franchise_for(AgeClass::YoungAdult), 300.0);
        assert_eq!(p.quote_part_cap_for(AgeClass::Child), 350.0);
    }
}

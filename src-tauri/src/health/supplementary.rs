//! Les complémentaires LCA, ligne par ligne.
//!
//! Une police LCA n'est pas une case cochée : c'est une liste de produits au
//! nom propre à chaque caisse (« Hospital Flex », « Myflex Silver »,
//! « Diversa Plus »…), chacun avec sa prime et souvent son rabais — rabais de
//! famille, de durée, de combinaison —, en pour-cent ou en francs. L'assuré
//! nomme chaque ligne comme sur sa police ; le moteur ne connaît que
//! l'arithmétique.

use serde::{Deserialize, Serialize};

use super::round2;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SupplementaryLine {
    /// Le nom du produit, tel que sur la police.
    pub name: String,
    /// Prime mensuelle avant rabais.
    pub monthly_premium: f64,
    /// `pct` (pour-cent de la prime) ou `chf` (francs par mois).
    pub discount_kind: String,
    pub discount_value: f64,
}

impl SupplementaryLine {
    /// Le rabais en francs par mois, jamais plus que la prime.
    pub fn discount(&self) -> f64 {
        let d = match self.discount_kind.as_str() {
            "pct" => self.monthly_premium * self.discount_value / 100.0,
            _ => self.discount_value,
        };
        round2(d.clamp(0.0, self.monthly_premium.max(0.0)))
    }

    pub fn net(&self) -> f64 {
        round2(self.monthly_premium - self.discount())
    }
}

/// Lit le JSON stocké ; une valeur illisible vaut « aucune ligne », jamais
/// une erreur à l'ouverture d'une fiche.
pub fn parse_lines(json: Option<&str>) -> Vec<SupplementaryLine> {
    json.and_then(|j| serde_json::from_str(j).ok()).unwrap_or_default()
}

/// Refuse ce qui ne peut pas figurer sur une police : un nom vide, une
/// prime négative, un rabais négatif ou au-delà de 100 %.
pub fn validate(lines: &[SupplementaryLine]) -> Result<(), String> {
    for l in lines {
        if l.name.trim().is_empty() {
            return Err("Chaque complémentaire doit avoir un nom".to_string());
        }
        if !l.monthly_premium.is_finite() || l.monthly_premium < 0.0 {
            return Err(format!("Prime invalide pour « {} »", l.name.trim()));
        }
        if !l.discount_value.is_finite() || l.discount_value < 0.0 {
            return Err(format!("Rabais invalide pour « {} »", l.name.trim()));
        }
        if l.discount_kind == "pct" && l.discount_value > 100.0 {
            return Err(format!("Rabais de plus de 100 % pour « {} »", l.name.trim()));
        }
        if !matches!(l.discount_kind.as_str(), "pct" | "chf" | "") {
            return Err(format!("Type de rabais inconnu pour « {} »", l.name.trim()));
        }
    }
    Ok(())
}

/// Prime mensuelle nette de toutes les lignes.
pub fn monthly_total(lines: &[SupplementaryLine]) -> f64 {
    round2(lines.iter().map(SupplementaryLine::net).sum())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(name: &str, premium: f64, kind: &str, value: f64) -> SupplementaryLine {
        SupplementaryLine { name: name.into(), monthly_premium: premium, discount_kind: kind.into(), discount_value: value }
    }

    #[test]
    fn rabais_en_pour_cent_et_en_francs() {
        let lines = vec![
            line("Hospital Flex", 89.10, "pct", 10.0),
            line("Myflex Silver", 32.40, "chf", 5.0),
            line("Dentaire", 12.00, "pct", 0.0),
        ];
        assert_eq!(lines[0].net(), 80.19);
        assert_eq!(lines[1].net(), 27.40);
        assert_eq!(monthly_total(&lines), 119.59);
    }

    #[test]
    fn rabais_jamais_au_dela_de_la_prime() {
        assert_eq!(line("X", 20.0, "chf", 50.0).net(), 0.0);
    }

    #[test]
    fn validation() {
        assert!(validate(&[line("", 10.0, "pct", 0.0)]).is_err());
        assert!(validate(&[line("A", -1.0, "pct", 0.0)]).is_err());
        assert!(validate(&[line("A", 10.0, "pct", 120.0)]).is_err());
        assert!(validate(&[line("A", 10.0, "chf", 2.0)]).is_ok());
        assert_eq!(parse_lines(Some("pas du json")), vec![]);
    }
}

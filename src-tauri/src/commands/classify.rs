//! Enrichissement post-extraction : à partir du libellé brut d'une
//! transaction bancaire suisse, deviner le marchand canonique, la
//! catégorie, et (si pertinent) la rubrique fiscale déductible.
//!
//! Pourquoi : sur un relevé PostFinance/UBS l'utilisateur ne voit que
//! « APPLE PAY ACHAT/SERVICE DU 21.04.2026 CARTE NO XXXX8750 MIGROS MARIN
//! CENTRE MARIN-EPAGNIER (CH) ». Toute l'info utile est là (Migros = un
//! achat alimentaire à Marin), mais noyée. Cette fonction extrait
//! l'essentiel et propose un classement, que l'UI affiche en chip et
//! que l'utilisateur valide d'un clic.
//!
//! Implémentation volontairement simple : une table statique de patterns
//! sous-chaînes (insensible à la casse) + une heuristique pour le mode de
//! paiement (Apple Pay / Twint / virement). Pas de regex coûteuses, pas
//! d'IA — c'est déterministe et instantané, donc sûr à appliquer en bloc
//! sur 200 transactions d'un coup.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::auth::AppState;

#[derive(Debug, Serialize, Clone)]
pub struct Classification {
    /// Nom propre du marchand quand on l'a reconnu, ex. "Migros",
    /// "Sunrise", "McDonald's". None si pas de match.
    pub merchant: Option<String>,
    /// Mode de paiement détecté depuis le libellé : "apple_pay",
    /// "twint", "lsv", "qr_bill", "withdrawal" (retrait), "credit_card".
    pub payment_method: Option<String>,
    /// Catégorie suggérée pour le suivi des dépenses du ménage.
    pub category: Option<String>,
    /// Suggestion de catégorie fiscale (cf. taxes.rs) quand le marchand
    /// la rend évidente — ex. une pharmacie → "medical". L'utilisateur
    /// confirme avant que ce soit appliqué.
    pub tax_category: Option<String>,
    /// Ville extraite du libellé quand un pattern de ville suisse y est
    /// présent en MAJUSCULES.
    pub city: Option<String>,
    /// Niveau de confiance entre 0.0 et 1.0. >0.8 = match strict d'un
    /// pattern marchand connu ; ~0.4 = juste détection du mode de
    /// paiement sans marchand identifié.
    pub confidence: f32,
}

struct Pattern {
    /// Sous-chaîne à chercher en majuscules dans le libellé. La recherche
    /// exige une frontière de mot de chaque côté (non-alphanumérique ou
    /// bord de chaîne), sinon « OBI » matcherait « MOBILE ».
    needle: &'static str,
    merchant: &'static str,
    category: &'static str,
    tax_category: Option<&'static str>,
}

/// True si `needle` apparaît dans `haystack` entouré de frontières de mot
/// (non-alphanumérique ou bord de chaîne de chaque côté). Évite que
/// "OBI" matche "MOBILE" ou "BP" matche "POSTOMAT".
fn contains_word(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let h = haystack.as_bytes();
    let n = needle.as_bytes();
    if n.len() > h.len() {
        return false;
    }
    let is_boundary = |c: u8| !c.is_ascii_alphanumeric();
    let mut i = 0;
    while i + n.len() <= h.len() {
        if &h[i..i + n.len()] == n {
            let before_ok = i == 0 || is_boundary(h[i - 1]);
            let after_ok = i + n.len() == h.len() || is_boundary(h[i + n.len()]);
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}

// Table des marchands fréquents en Suisse romande/alémanique. Ordre :
// le premier qui matche gagne, donc les patterns plus spécifiques en
// haut (ex. "MIGROL" avant "MIGROS" pour ne pas mismatcher la station-
// service de Migros sur la chaîne de supermarchés).
const PATTERNS: &[Pattern] = &[
    // === Stations-service & carburant (déductible si véhicule pro) ===
    Pattern { needle: "MIGROL",   merchant: "Migrol",         category: "carburant", tax_category: None },
    Pattern { needle: "AGROLA",   merchant: "Agrola",         category: "carburant", tax_category: None },
    Pattern { needle: "TAMOIL",   merchant: "Tamoil",         category: "carburant", tax_category: None },
    // « BP » est trop court pour matcher safely sans contexte
    // (collision avec abréviations de codes BV/BP des relevés).
    // Skipped intentionally — l'utilisateur l'ajoutera via ses règles
    // marchand s'il en a besoin.
    Pattern { needle: "SHELL",    merchant: "Shell",          category: "carburant", tax_category: None },
    Pattern { needle: "AVIA",     merchant: "Avia",           category: "carburant", tax_category: None },
    Pattern { needle: "COOP PRONTO", merchant: "Coop Pronto", category: "carburant", tax_category: None },
    Pattern { needle: "RIVIERA CARBURANT", merchant: "Riviera Carburant", category: "carburant", tax_category: None },

    // === Supermarchés & courses ===
    Pattern { needle: "MIGROS",   merchant: "Migros",         category: "courses",   tax_category: None },
    Pattern { needle: "COOP",     merchant: "Coop",           category: "courses",   tax_category: None },
    Pattern { needle: "DENNER",   merchant: "Denner",         category: "courses",   tax_category: None },
    Pattern { needle: "ALDI",     merchant: "Aldi",           category: "courses",   tax_category: None },
    Pattern { needle: "LIDL",     merchant: "Lidl",           category: "courses",   tax_category: None },
    Pattern { needle: "VOLG",     merchant: "Volg",           category: "courses",   tax_category: None },
    Pattern { needle: "MANOR FOOD", merchant: "Manor Food",   category: "courses",   tax_category: None },
    Pattern { needle: "SPAR",     merchant: "Spar",           category: "courses",   tax_category: None },

    // === Restaurants & take-away ===
    Pattern { needle: "MCDONALD", merchant: "McDonald's",     category: "restaurant", tax_category: None },
    Pattern { needle: "BURGER KING", merchant: "Burger King", category: "restaurant", tax_category: None },
    Pattern { needle: "KFC",      merchant: "KFC",            category: "restaurant", tax_category: None },
    Pattern { needle: "STARBUCKS", merchant: "Starbucks",     category: "restaurant", tax_category: None },
    Pattern { needle: "SUBWAY",   merchant: "Subway",         category: "restaurant", tax_category: None },
    Pattern { needle: "DOMINO",   merchant: "Domino's Pizza", category: "restaurant", tax_category: None },
    Pattern { needle: "HOLY COW", merchant: "Holy Cow!",      category: "restaurant", tax_category: None },
    Pattern { needle: "POULET RÔTI", merchant: "Poulet Rôti", category: "restaurant", tax_category: None },

    // === Pharmacies & santé (potentiellement déductibles) ===
    // Chaînes nommées avant le générique « PHARMACIE » pour qu'« AMAVITA »
    // ressorte le bon canonical_name plutôt que tomber sur le fallback.
    Pattern { needle: "AMAVITA",   merchant: "Pharmacie Amavita", category: "sante", tax_category: Some("medical") },
    Pattern { needle: "BENU",      merchant: "Pharmacie Benu", category: "sante",    tax_category: Some("medical") },
    Pattern { needle: "SUN STORE", merchant: "Sun Store",     category: "sante",     tax_category: Some("medical") },
    Pattern { needle: "TOPPHARM",  merchant: "TopPharm",      category: "sante",     tax_category: Some("medical") },
    Pattern { needle: "PHARMACIE", merchant: "Pharmacie",     category: "sante",     tax_category: Some("medical") },
    Pattern { needle: "DROGUERIE", merchant: "Droguerie",     category: "sante",     tax_category: None },
    Pattern { needle: "HOPITAL",   merchant: "Hôpital",       category: "sante",     tax_category: Some("medical") },
    Pattern { needle: "HÔPITAL",   merchant: "Hôpital",       category: "sante",     tax_category: Some("medical") },
    Pattern { needle: "CHUV",      merchant: "CHUV",          category: "sante",     tax_category: Some("medical") },
    Pattern { needle: "HUG",       merchant: "HUG",           category: "sante",     tax_category: Some("medical") },

    // === Transports ===
    Pattern { needle: "CFF",       merchant: "CFF",           category: "transport", tax_category: Some("pro") },
    Pattern { needle: "SBB",       merchant: "CFF (SBB)",     category: "transport", tax_category: Some("pro") },
    Pattern { needle: "TPG",       merchant: "TPG (Genève)",  category: "transport", tax_category: Some("pro") },
    // « TL » est trop court pour être safe — l'utilisateur l'ajoutera
    // dans ses règles s'il en a besoin.
    Pattern { needle: "MOBILITY",  merchant: "Mobility",      category: "transport", tax_category: None },
    Pattern { needle: "UBER",      merchant: "Uber",          category: "transport", tax_category: None },
    Pattern { needle: "FLIXBUS",   merchant: "FlixBus",       category: "transport", tax_category: None },

    // === Télécom & internet ===
    Pattern { needle: "SWISSCOM",  merchant: "Swisscom",      category: "telecom",   tax_category: None },
    Pattern { needle: "SUNRISE",   merchant: "Sunrise",       category: "telecom",   tax_category: None },
    Pattern { needle: "SALT",      merchant: "Salt",          category: "telecom",   tax_category: None },
    Pattern { needle: "YALLO",     merchant: "Yallo",         category: "telecom",   tax_category: None },
    Pattern { needle: "WINGO",     merchant: "Wingo",         category: "telecom",   tax_category: None },

    // === Streaming & services en ligne ===
    Pattern { needle: "NETFLIX",   merchant: "Netflix",       category: "streaming", tax_category: None },
    Pattern { needle: "SPOTIFY",   merchant: "Spotify",       category: "streaming", tax_category: None },
    Pattern { needle: "APPLE.COM", merchant: "Apple",         category: "streaming", tax_category: None },
    Pattern { needle: "GOOGLE",    merchant: "Google",        category: "streaming", tax_category: None },
    Pattern { needle: "MICROSOFT", merchant: "Microsoft",     category: "streaming", tax_category: None },
    Pattern { needle: "DISNEY",    merchant: "Disney+",       category: "streaming", tax_category: None },
    Pattern { needle: "PERPLEXITY", merchant: "Perplexity AI", category: "streaming", tax_category: None },
    Pattern { needle: "OPENAI",    merchant: "OpenAI",        category: "streaming", tax_category: None },
    Pattern { needle: "ANTHROPIC", merchant: "Anthropic",     category: "streaming", tax_category: None },
    Pattern { needle: "INFOMANIAK", merchant: "Infomaniak",   category: "streaming", tax_category: None },

    // === Shopping en ligne ===
    Pattern { needle: "DIGITEC",   merchant: "Digitec Galaxus", category: "shopping", tax_category: None },
    Pattern { needle: "GALAXUS",   merchant: "Digitec Galaxus", category: "shopping", tax_category: None },
    Pattern { needle: "REVOLUT",   merchant: "Revolut",       category: "shopping",  tax_category: None },
    Pattern { needle: "QOQA",      merchant: "QOQA",          category: "shopping",  tax_category: None },
    Pattern { needle: "AMAZON",    merchant: "Amazon",        category: "shopping",  tax_category: None },
    Pattern { needle: "ZALANDO",   merchant: "Zalando",       category: "shopping",  tax_category: None },
    Pattern { needle: "ALIEXPRESS", merchant: "AliExpress",   category: "shopping",  tax_category: None },
    Pattern { needle: "BLUE TICKET", merchant: "Blue Ticket", category: "loisirs",   tax_category: None },
    Pattern { needle: "TICKETCORNER", merchant: "Ticketcorner", category: "loisirs", tax_category: None },
    Pattern { needle: "PALEXPO",   merchant: "Palexpo",       category: "loisirs",   tax_category: None },

    // === Bricolage & équipement maison ===
    Pattern { needle: "JUMBO",     merchant: "Jumbo",         category: "maison",    tax_category: None },
    Pattern { needle: "HORNBACH",  merchant: "Hornbach",      category: "maison",    tax_category: None },
    Pattern { needle: "OBI",       merchant: "OBI",           category: "maison",    tax_category: None },
    Pattern { needle: "LANDI",     merchant: "Landi",         category: "maison",    tax_category: None },
    Pattern { needle: "IKEA",      merchant: "IKEA",          category: "maison",    tax_category: None },
    Pattern { needle: "FUST",      merchant: "Fust",          category: "maison",    tax_category: None },
    Pattern { needle: "INTERIO",   merchant: "Interio",       category: "maison",    tax_category: None },

    // === Habillement ===
    Pattern { needle: "H&M",       merchant: "H&M",           category: "habillement", tax_category: None },
    Pattern { needle: "ZARA",      merchant: "Zara",          category: "habillement", tax_category: None },
    Pattern { needle: "UNIQLO",    merchant: "Uniqlo",        category: "habillement", tax_category: None },
    Pattern { needle: "C&A",       merchant: "C&A",           category: "habillement", tax_category: None },
    Pattern { needle: "MANOR",     merchant: "Manor",         category: "habillement", tax_category: None },

    // === Banques / retrait d'espèces ===
    Pattern { needle: "POSTOMAT",  merchant: "PostFinance (retrait)", category: "retrait", tax_category: None },
    Pattern { needle: "BANCOMAT",  merchant: "Retrait DAB",   category: "retrait",   tax_category: None },
    Pattern { needle: "RETRAIT",   merchant: "Retrait DAB",   category: "retrait",   tax_category: None },
];

// Villes suisses fréquentes — détectées en MAJUSCULES dans le libellé,
// utile pour distinguer plusieurs Migros (Lausanne vs Genève vs Berne…).
const CITIES: &[&str] = &[
    "LAUSANNE", "GENÈVE", "GENEVE", "BERNE", "BERN", "ZURICH", "ZÜRICH",
    "BÂLE", "BASEL", "FRIBOURG", "FREIBURG", "NEUCHÂTEL", "NEUCHATEL",
    "MONTREUX", "VEVEY", "SION", "MARTIGNY", "YVERDON", "YVERDON-LES-BAINS",
    "MORGES", "NYON", "RENENS", "PRILLY", "ECUBLENS", "CRISSIER",
    "BUSSIGNY", "ST-LÉGIER", "MARIN-EPAGNIER", "MARIN", "DELÉMONT",
    "BIENNE", "BIEL", "THOUNE", "THUN", "LUCERNE", "LUZERN",
    "AARAU", "BADEN", "WINTERTHOUR", "WINTERTHUR", "ST-GALL", "ST GALLEN",
    "LUGANO", "BELLINZONE", "BELLINZONA", "LOCARNO", "PALEXPO",
    "GRAND-SACONNEX", "CAROUGE", "MEYRIN", "ONEX", "LANCY", "VERNIER",
];

pub(crate) fn classify_description(desc: &str) -> Classification {
    let upper = desc.to_uppercase();

    // 1) Mode de paiement (signaux courants des banques suisses).
    let payment_method = if upper.contains("APPLE PAY") {
        Some("apple_pay".to_string())
    } else if upper.contains("TWINT") {
        Some("twint".to_string())
    } else if upper.contains("BVR") || upper.contains("QR-FACTURE") || upper.contains("QR FACTURE") {
        Some("qr_bill".to_string())
    } else if upper.contains("LSV") || upper.contains("PRÉLÈVEMENT") || upper.contains("PRELEVEMENT") {
        Some("lsv".to_string())
    } else if upper.contains("RETRAIT") || upper.contains("BANCOMAT") || upper.contains("POSTOMAT") {
        Some("withdrawal".to_string())
    } else if upper.contains("CARTE") || upper.contains("KARTE") {
        Some("credit_card".to_string())
    } else {
        None
    };

    // 2) Match du marchand (premier pattern qui touche).
    let mut merchant: Option<String> = None;
    let mut category: Option<String> = None;
    let mut tax_category: Option<String> = None;
    let mut confidence = 0.0_f32;

    for p in PATTERNS {
        if contains_word(&upper, p.needle) {
            merchant = Some(p.merchant.to_string());
            category = Some(p.category.to_string());
            tax_category = p.tax_category.map(|s| s.to_string());
            confidence = 0.85;
            break;
        }
    }

    // 3) Ville (purement informatif, ne change pas la confidence).
    let city = CITIES
        .iter()
        .find(|c| upper.contains(*c))
        .map(|c| {
            // On capitalise pour l'affichage : "MARIN-EPAGNIER" → "Marin-Epagnier".
            let mut chars = c.chars();
            let mut out = String::new();
            let mut capitalize_next = true;
            while let Some(ch) = chars.next() {
                if capitalize_next {
                    out.extend(ch.to_uppercase());
                } else {
                    out.extend(ch.to_lowercase());
                }
                capitalize_next = ch == '-' || ch == ' ';
            }
            out
        });

    // 4) Si on n'a rien trouvé sur le marchand mais qu'on a au moins le
    // mode de paiement, on remonte une confiance basse — l'UI affichera
    // « Apple Pay · marchand inconnu » qui reste utile.
    if merchant.is_none() && payment_method.is_some() {
        confidence = 0.4;
    }

    Classification {
        merchant,
        payment_method,
        category,
        tax_category,
        city,
        confidence,
    }
}

#[derive(Debug, Deserialize)]
pub struct ClassifyRequest {
    pub id: String,
    pub description: String,
}

#[derive(Debug, Serialize)]
pub struct ClassifyResult {
    pub id: String,
    #[serde(flatten)]
    pub classification: Classification,
}

/// Classe un lot de transactions d'un coup (typiquement toutes les
/// lignes d'un relevé) — évite un round-trip par ligne.
#[tauri::command]
pub fn classify_transactions(
    _state: State<'_, AppState>,
    items: Vec<ClassifyRequest>,
) -> Result<Vec<ClassifyResult>, String> {
    Ok(items
        .into_iter()
        .map(|r| ClassifyResult {
            classification: classify_description(&r.description),
            id: r.id,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applepay_migros_yields_migros_courses() {
        let c = classify_description(
            "APPLE PAY ACHAT/SERVICE DU 21.04.2026 CARTE NO XXXX8750 MIGROS MARIN CENTRE MARIN-EPAGNIER (CH)",
        );
        assert_eq!(c.merchant.as_deref(), Some("Migros"));
        assert_eq!(c.category.as_deref(), Some("courses"));
        assert_eq!(c.payment_method.as_deref(), Some("apple_pay"));
        assert_eq!(c.city.as_deref(), Some("Marin-Epagnier"));
        assert!(c.confidence >= 0.8);
    }

    #[test]
    fn pharmacie_suggests_medical_tax_category() {
        let c = classify_description("APPLE PAY ACHAT/SERVICE PHARMACIE AMAVITA LAUSANNE");
        assert_eq!(c.tax_category.as_deref(), Some("medical"));
        assert_eq!(c.merchant.as_deref(), Some("Pharmacie Amavita"));
    }

    #[test]
    fn twint_only_low_confidence() {
        let c = classify_description("RÉCEPTION D'ARGENT TWINT DU 18.04.2026 DU NUMÉRO MOBILE +41791067157");
        assert_eq!(c.payment_method.as_deref(), Some("twint"));
        assert!(c.confidence < 0.5);
    }

    #[test]
    fn carburant_riviera_detected() {
        let c = classify_description(
            "APPLE PAY ACHAT/SERVICE CARTE NO XXXX8750 RIVIERA CARBURANT LAVAGE SA ST-LÉGIER-LA CHIÉSAZ",
        );
        assert_eq!(c.merchant.as_deref(), Some("Riviera Carburant"));
        assert_eq!(c.category.as_deref(), Some("carburant"));
    }

    #[test]
    fn unknown_merchant_no_match() {
        let c = classify_description("VIREMENT BANCAIRE INTERNE");
        assert!(c.merchant.is_none());
    }
}

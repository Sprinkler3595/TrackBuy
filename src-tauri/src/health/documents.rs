//! Reconnaître un document d'assurance maladie : quoi, quelle année, pour qui.
//!
//! Une famille reçoit chaque année une pile de courriers de sa caisse :
//! polices, avis de prime, décomptes de prestations, factures, décisions de
//! subside, confirmations d'affiliation, attestations fiscales. Les classer à
//! la main, c'est ouvrir chaque PDF. Ici, le texte du document suffit : des
//! mots-clés en français, allemand et italien — ceux que les caisses
//! impriment réellement en titre — décident du type, les années citées de
//! l'année, et les prénoms du ménage de la personne.
//!
//! Tout est local et déterministe : aucune IA, aucun envoi. Le résultat est
//! une proposition que l'écran montre et que l'utilisateur corrige d'un clic.

use serde::Serialize;

/// Les sortes de documents qu'une caisse envoie.
pub const KINDS: &[&str] = &[
    "policy",
    "premium_notice",
    "benefit_statement",
    "premium_invoice",
    "subsidy_decision",
    "affiliation",
    "cancellation",
    "tax_certificate",
    "other",
];

/// Mots-clés par sorte, du plus spécifique au plus général. Le premier type
/// dont un mot-clé apparaît l'emporte, d'où l'ordre : un avis de prime
/// contient souvent le mot « police », pas l'inverse.
const RULES: &[(&str, &[&str])] = &[
    ("benefit_statement", &[
        "décompte de prestations", "decompte de prestations", "décompte des prestations",
        "leistungsabrechnung", "conteggio delle prestazioni", "votre participation aux coûts",
        "participation aux coûts", "kostenbeteiligung",
    ]),
    ("tax_certificate", &[
        "attestation fiscale", "attestation pour la déclaration d'impôt", "attestation d'impôt",
        "steuerbescheinigung", "attestazione fiscale", "prämienbescheinigung",
    ]),
    ("subsidy_decision", &[
        "réduction individuelle des primes", "réduction de primes", "subside", "subsides",
        "prämienverbilligung", "riduzione dei premi", "rip ",
    ]),
    ("affiliation", &[
        "confirmation d'affiliation", "confirmation de l'affiliation", "attestation d'affiliation",
        "bienvenue", "aufnahmebestätigung", "willkommen", "conferma di affiliazione",
    ]),
    ("cancellation", &[
        "résiliation", "resiliation", "confirmation de résiliation", "kündigung",
        "kündigungsbestätigung", "disdetta",
    ]),
    ("premium_notice", &[
        "avis de prime", "nouvelle prime", "nouvelles primes", "adaptation des primes",
        "vos primes pour", "primes valables dès", "prämienänderung", "neue prämie",
        "prämien ab", "avviso di premio", "nuovo premio",
    ]),
    ("premium_invoice", &[
        "facture de primes", "facture de prime", "prämienrechnung", "fattura dei premi",
        "section paiement", "récépissé", "zahlteil", "empfangsschein", "sezione pagamento",
    ]),
    ("policy", &[
        "police d'assurance", "certificat d'assurance", "votre police", "police n°", "police no",
        "versicherungspolice", "versicherungsausweis", "polizza", "certificato d'assicurazione",
    ]),
];

/// Une police du ménage, telle que l'écran la connaît.
#[derive(Debug, Clone)]
pub struct KnownPolicy {
    pub engagement_id: String,
    /// Prénom et nom de la personne assurée.
    pub insured_label: Option<String>,
    /// `basic` | `supplementary`
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Classification {
    pub kind: String,
    pub year: Option<i32>,
    /// Polices concernées — plusieurs pour un courrier familial.
    pub engagement_ids: Vec<String>,
    /// Les personnes reconnues, pour l'affichage.
    pub people: Vec<String>,
    /// Le mot-clé qui a décidé du type, à montrer à l'utilisateur.
    pub matched: Option<String>,
}

fn norm(s: &str) -> String {
    s.to_lowercase()
        .replace(['é', 'è', 'ê'], "e")
        .replace(['à', 'â'], "a")
        .replace(['ü'], "u")
        .replace(['ö'], "o")
        .replace(['ä'], "a")
        .replace(['’'], "'")
}

/// L'année du document : l'année la plus citée entre `today_year - 3` et
/// `today_year + 1`. Pour un avis ou une police, l'année suivante l'emporte
/// à égalité : c'est celle pour laquelle ils valent.
fn detect_year(text: &str, today_year: i32, forward: bool) -> Option<i32> {
    let mut counts: Vec<(i32, usize)> = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        let w = &bytes[i..i + 4];
        let before_ok = i == 0 || !bytes[i - 1].is_ascii_digit();
        let after_ok = i + 4 == bytes.len() || !bytes[i + 4].is_ascii_digit();
        if w.iter().all(u8::is_ascii_digit) && before_ok && after_ok {
            if let Ok(y) = std::str::from_utf8(w).unwrap_or("").parse::<i32>()
                && (today_year - 3..=today_year + 1).contains(&y)
            {
                match counts.iter_mut().find(|(yy, _)| *yy == y) {
                    Some((_, c)) => *c += 1,
                    None => counts.push((y, 1)),
                }
            }
            i += 4;
        } else {
            i += 1;
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(if forward { b.0.cmp(&a.0) } else { a.0.cmp(&b.0) }));
    counts.first().map(|(y, _)| *y)
}

/// Les polices dont la personne est nommée dans le texte (prénom ET nom
/// quand le libellé en a deux, sinon le prénom seul). Un courrier sans nom
/// reconnu ne se rattache à personne : on ne devine pas.
fn detect_policies(text: &str, policies: &[KnownPolicy], kind: &str) -> (Vec<String>, Vec<String>) {
    let t = norm(text);
    let words: Vec<&str> = t.split(|c: char| !c.is_alphanumeric() && c != '-').filter(|w| !w.is_empty()).collect();
    let mut ids = Vec::new();
    let mut people: Vec<String> = Vec::new();
    for p in policies {
        let Some(label) = &p.insured_label else { continue };
        let first = norm(label.split_whitespace().next().unwrap_or(""));
        if first.len() < 2 || !words.contains(&first.as_str()) {
            continue;
        }
        // Un décompte, une facture ou une décision de subside concernent la
        // personne entière ; un avis ou une police, toutes ses polices. La
        // LCA n'est retenue que si le document parle de complémentaires ou
        // si la personne n'a pas d'autre police.
        let wants_lca = matches!(kind, "premium_notice" | "policy" | "premium_invoice" | "cancellation")
            || p.kind == "supplementary" && !policies.iter().any(|o| o.insured_label == p.insured_label && o.kind == "basic");
        if p.kind == "supplementary" && !wants_lca {
            continue;
        }
        ids.push(p.engagement_id.clone());
        if !people.contains(label) {
            people.push(label.clone());
        }
    }
    (ids, people)
}

pub fn classify(text: &str, policies: &[KnownPolicy], today_year: i32) -> Classification {
    let t = norm(text);
    let mut kind = "other";
    let mut matched = None;
    'rules: for (k, words) in RULES {
        for w in *words {
            if t.contains(&norm(w)) {
                kind = k;
                matched = Some((*w).to_string());
                break 'rules;
            }
        }
    }
    let forward = matches!(kind, "premium_notice" | "policy" | "affiliation");
    let year = detect_year(text, today_year, forward);
    let (engagement_ids, people) = detect_policies(text, policies, kind);
    Classification { kind: kind.to_string(), year, engagement_ids, people, matched }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn family() -> Vec<KnownPolicy> {
        let p = |id: &str, who: &str, kind: &str| KnownPolicy {
            engagement_id: id.into(),
            insured_label: Some(who.into()),
            kind: kind.into(),
        };
        vec![p("lamal_sophie", "Sophie Dubois", "basic"), p("lca_sophie", "Sophie Dubois", "supplementary"), p("lamal_lea", "Léa", "basic")]
    }

    #[test]
    fn avis_de_prime_familial() {
        let text = "CSS Assurance — Vos primes pour 2027\nAvis de prime valable dès le 01.01.2027\n\
                    Sophie Dubois, née le 12.04.1988 : 421.60\nLéa Dubois : 318.50\nRéférence 2026-ABC";
        let c = classify(text, &family(), 2026);
        assert_eq!(c.kind, "premium_notice");
        assert_eq!(c.year, Some(2027));
        assert_eq!(c.engagement_ids, vec!["lamal_sophie", "lca_sophie", "lamal_lea"]);
        assert_eq!(c.people.len(), 2);
    }

    #[test]
    fn decompte_rattache_a_la_lamal_seule() {
        let text = "Décompte de prestations du 12.10.2026 — assurée : Sophie Dubois\nDr Favre 180.00";
        let c = classify(text, &family(), 2026);
        assert_eq!(c.kind, "benefit_statement");
        assert_eq!(c.year, Some(2026));
        assert_eq!(c.engagement_ids, vec!["lamal_sophie"]);
    }

    #[test]
    fn allemand_et_inconnu() {
        let c = classify("Steuerbescheinigung 2025 für Lea", &family(), 2026);
        assert_eq!(c.kind, "tax_certificate");
        assert_eq!(c.year, Some(2025));
        assert_eq!(c.engagement_ids, vec!["lamal_lea"], "accents ignorés");
        let c = classify("Lettre sans rapport", &family(), 2026);
        assert_eq!(c.kind, "other");
        assert!(c.engagement_ids.is_empty(), "personne reconnue : aucune");
        assert_eq!(c.year, None);
    }

    #[test]
    fn annee_hors_plage_ignoree() {
        // Une date de naissance n'est pas l'année du document.
        let c = classify("Police d'assurance — née le 12.04.1988 — dès le 01.01.2027", &family(), 2026);
        assert_eq!(c.kind, "policy");
        assert_eq!(c.year, Some(2027));
    }
}

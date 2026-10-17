//! Barèmes cantonaux d'impôt à la source : lecture des fichiers officiels.
//!
//! Ces barèmes ne sont pas livrés avec l'application. L'AFC ne les publie pas
//! en libre accès — ce sont des fichiers réservés aux employeurs et aux
//! éditeurs de logiciels de paie, à télécharger par canton et par année.
//! L'utilisateur importe donc le sien, et tant qu'il ne l'a pas fait l'impôt
//! est annoncé comme non calculable. **Aucun montant d'impôt n'est jamais
//! estimé** : un barème fiscal inventé serait pire qu'une case vide.
//!
//! Format (document AFC « Aufbau und Recordformate der Quellensteuer-Tarife ») :
//! un fichier texte d'enregistrements identifiés par leurs deux premiers
//! caractères.
//!
//!   - `00` en-tête : canton, code canton, n° SSL, date de création (AAAAMMJJ)
//!   - `06` tarif progressif : canton, code de barème (A0N, B2Y, C1N…), date
//!     de validité (AAAAMMJJ), revenu déterminant de départ, pas du tarif,
//!     code sexe, nombre d'enfants (0-9), montant d'impôt
//!
//! Les autres types (barèmes spéciaux, enregistrements de fin) sont comptés
//! et ignorés plutôt que fatals : un canton peut en ajouter sans que l'import
//! doive échouer.
//!
//! Deux dispositions coexistent selon la source du fichier : à séparateurs
//! (`;`) ou à colonnes fixes. Le parseur reconnaît les deux et **rejette**
//! ce qu'il ne sait pas lire, au lieu d'importer des chiffres douteux.

use serde::Serialize;

/// Cantons appliquant le modèle ANNUEL : l'impôt se calcule sur le revenu
/// annualisé, puis se répartit sur les périodes. Ailleurs, le modèle est
/// mensuel et chaque paie est taxée pour elle-même. Confondre les deux fausse
/// le net de tout salarié romand.
pub const ANNUAL_MODEL_CANTONS: &[&str] = &["FR", "GE", "TI", "VD", "VS"];

pub fn uses_annual_model(canton: &str) -> bool {
    ANNUAL_MODEL_CANTONS.contains(&canton.to_uppercase().as_str())
}

/// Une tranche de barème : l'impôt dû pour un revenu compris entre
/// `income_from` et `income_from + income_step`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TariffRow {
    pub canton: String,
    pub tariff_code: String,
    /// AAAA-MM-JJ.
    pub valid_from: String,
    pub children: i32,
    pub income_from: f64,
    pub income_step: f64,
    pub tax_amount: Option<f64>,
    pub rate_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedTariff {
    pub canton: String,
    /// Date portée par l'en-tête, AAAA-MM-JJ.
    pub file_created_on: Option<String>,
    pub rows: Vec<TariffRow>,
    /// Enregistrements d'un type que nous n'exploitons pas.
    pub skipped_records: usize,
}

/// Nombre d'enfants encodé dans un code de barème : `B2N` → 2.
/// Le fichier porte aussi l'information, mais le contrat de l'utilisateur ne
/// contient que le code — c'est donc lui qui sert à interroger la table.
pub fn children_from_code(code: &str) -> Option<i32> {
    code.chars().find(|c| c.is_ascii_digit())?.to_digit(10).map(|d| d as i32)
}

/// `20260101` → `2026-01-01`. Toute autre forme est refusée : une date
/// mal découpée signale une disposition de colonnes erronée, et il vaut
/// infiniment mieux s'en apercevoir ici qu'en retenant un mauvais impôt.
fn iso_date(raw: &str) -> Option<String> {
    let d = raw.trim();
    if d.len() != 8 || !d.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let (y, m, day) = (&d[0..4], &d[4..6], &d[6..8]);
    let (yn, mn, dn): (i32, u32, u32) = (y.parse().ok()?, m.parse().ok()?, day.parse().ok()?);
    if !(1990..=2100).contains(&yn) || !(1..=12).contains(&mn) || !(1..=31).contains(&dn) {
        return None;
    }
    Some(format!("{y}-{m}-{day}"))
}

/// Montant du fichier → francs. Les fichiers AFC expriment les montants en
/// centimes sur des colonnes à zéros de tête ; un point décimal explicite est
/// accepté pour les variantes exportées par les cantons.
fn money(raw: &str) -> Option<f64> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if t.contains('.') || t.contains(',') {
        return t.replace(',', ".").parse::<f64>().ok();
    }
    if !t.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    t.parse::<f64>().ok().map(|v| v / 100.0)
}

/// Les fichiers officiels sont en ISO-8859-1, pas en UTF-8 : décoder octet à
/// octet évite qu'un « ü » de raison sociale fasse échouer tout l'import.
fn decode_latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|b| *b as char).collect()
}

/// Découpe une ligne en champs. `None` quand la ligne n'est pas délimitée :
/// l'appelant retombe alors sur la lecture en colonnes fixes.
fn split_delimited(line: &str) -> Option<Vec<&str>> {
    for sep in [';', '\t', '|'] {
        if line.contains(sep) {
            return Some(line.split(sep).collect());
        }
    }
    None
}

/// Colonnes fixes de l'enregistrement `06`, en (début, longueur) 0-indexé.
/// Rassemblées ici pour qu'une correction d'après le document officiel de
/// l'AFC tienne en un seul endroit.
mod fixed {
    pub const CANTON: (usize, usize) = (3, 2);
    pub const CODE: (usize, usize) = (5, 4);
    pub const VALID_FROM: (usize, usize) = (9, 8);
    pub const INCOME_FROM: (usize, usize) = (17, 9);
    pub const STEP: (usize, usize) = (26, 9);
    pub const CHILDREN: (usize, usize) = (36, 2);
    pub const TAX: (usize, usize) = (38, 9);
}

fn slice_at(line: &str, (start, len): (usize, usize)) -> Option<&str> {
    line.get(start..start + len)
}

fn parse_fixed_06(line: &str) -> Option<TariffRow> {
    let canton = slice_at(line, fixed::CANTON)?.trim().to_uppercase();
    let code = slice_at(line, fixed::CODE)?.trim().to_uppercase();
    let valid_from = iso_date(slice_at(line, fixed::VALID_FROM)?)?;
    let income_from = money(slice_at(line, fixed::INCOME_FROM)?)?;
    let income_step = money(slice_at(line, fixed::STEP)?)?;
    let children: i32 = slice_at(line, fixed::CHILDREN)?.trim().parse().ok()?;
    let tax_amount = money(slice_at(line, fixed::TAX)?);
    if canton.len() != 2 || code.is_empty() {
        return None;
    }
    Some(TariffRow {
        canton,
        tariff_code: code,
        valid_from,
        children,
        income_from,
        income_step,
        tax_amount,
        rate_pct: None,
    })
}

/// Enregistrement `06` délimité. Les champs suivent l'ordre du document
/// officiel ; le code sexe est traversé sans être retenu (il ne joue plus sur
/// le barème depuis la réforme de 2021).
fn parse_delimited_06(f: &[&str]) -> Option<TariffRow> {
    // 06 ; transaction ; canton ; code ; validité ; revenu ; pas ; sexe ; enfants ; impôt [; taux]
    if f.len() < 10 {
        return None;
    }
    let canton = f[2].trim().to_uppercase();
    let code = f[3].trim().to_uppercase();
    let valid_from = iso_date(f[4])?;
    let income_from = money(f[5])?;
    let income_step = money(f[6])?;
    let children: i32 = f[8].trim().parse().ok()?;
    let tax_amount = money(f[9]);
    let rate_pct = f.get(10).and_then(|v| v.trim().replace(',', ".").parse::<f64>().ok());
    if canton.len() != 2 || code.is_empty() {
        return None;
    }
    Some(TariffRow {
        canton,
        tariff_code: code,
        valid_from,
        children,
        income_from,
        income_step,
        tax_amount,
        rate_pct,
    })
}

/// Lit un fichier de tarifs.
///
/// Échoue plutôt que de rendre un résultat partiel douteux : si les lignes de
/// type `06` sont présentes mais illisibles, c'est que la disposition des
/// colonnes ne correspond pas, et importer quand même reviendrait à retenir
/// un impôt faux tous les mois.
pub fn parse_tariff_file(bytes: &[u8]) -> Result<ParsedTariff, String> {
    let text = decode_latin1(bytes);

    let mut canton = String::new();
    let mut file_created_on = None;
    let mut rows: Vec<TariffRow> = Vec::new();
    let mut skipped = 0usize;
    let mut malformed = 0usize;

    for line in text.lines() {
        let line = line.trim_end_matches(['\r', '\n']);
        if line.trim().is_empty() {
            continue;
        }
        let fields = split_delimited(line);
        let kind = match &fields {
            Some(f) => f.first().map(|v| v.trim().to_string()).unwrap_or_default(),
            None => line.chars().take(2).collect::<String>(),
        };

        match kind.as_str() {
            "00" => {
                let (c, date) = match &fields {
                    Some(f) => (
                        f.get(1).map(|v| v.trim().to_uppercase()).unwrap_or_default(),
                        f.get(4).and_then(|v| iso_date(v)),
                    ),
                    None => (
                        slice_at(line, (2, 2)).unwrap_or("").trim().to_uppercase(),
                        slice_at(line, (10, 8)).and_then(iso_date),
                    ),
                };
                if c.len() == 2 {
                    canton = c;
                }
                file_created_on = date.or(file_created_on);
            }
            "06" => {
                let parsed = match &fields {
                    Some(f) => parse_delimited_06(f),
                    None => parse_fixed_06(line),
                };
                match parsed {
                    Some(r) => rows.push(r),
                    None => malformed += 1,
                }
            }
            _ => skipped += 1,
        }
    }

    if rows.is_empty() {
        return Err(
            "Aucune tranche de barème lisible dans ce fichier. Vérifiez qu'il s'agit bien \
             d'un fichier de tarifs d'impôt à la source pour les salaires."
                .into(),
        );
    }
    // Quelques lignes illisibles sur des milliers restent tolérables ; une
    // majorité signale une disposition de colonnes qui n'est pas la nôtre.
    if malformed > rows.len() / 10 {
        return Err(format!(
            "{} lignes de tarif sur {} n'ont pas pu être lues : la disposition de ce fichier \
             ne correspond pas au format attendu. L'import est annulé pour ne pas enregistrer \
             des montants d'impôt erronés.",
            malformed,
            malformed + rows.len()
        ));
    }

    if canton.is_empty() {
        canton = rows[0].canton.clone();
    }

    Ok(ParsedTariff {
        canton,
        file_created_on,
        rows,
        skipped_records: skipped,
    })
}

/// Impôt d'une tranche, à partir de lignes déjà triées par `income_from`.
///
/// Rend `None` quand aucune tranche ne couvre la base : c'est « je ne sais
/// pas », pas « zéro ». Un revenu SOUS la première tranche, en revanche, est
/// bien exonéré — le barème commence là où l'impôt commence.
pub fn tax_for_base(rows: &[TariffRow], base: f64) -> Option<f64> {
    if rows.is_empty() {
        return None;
    }
    if base < rows[0].income_from {
        return Some(0.0);
    }
    let row = rows
        .iter()
        .filter(|r| r.income_from <= base)
        .max_by(|a, b| a.income_from.total_cmp(&b.income_from))?;
    match (row.tax_amount, row.rate_pct) {
        (Some(amount), _) => Some(amount),
        (None, Some(rate)) => Some(base * rate / 100.0),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixture synthétique au format délimité : un en-tête vaudois et quatre
    /// tranches du barème A0N. Les vrais fichiers ne peuvent pas être versés
    /// au dépôt (ils ne sont pas publics), d'où cette reconstitution.
    const SAMPLE: &str = "\
00;VD;22;001;20251201;1\n\
06;1;VD;A0N ;20260101;000600000;000010000;1;00;000054000\n\
06;1;VD;A0N ;20260101;000610000;000010000;1;00;000056500\n\
06;1;VD;A0N ;20260101;000620000;000010000;1;00;000059000\n\
06;1;VD;B2N ;20260101;000600000;000010000;1;02;000031000\n\
12;VD;ignoré\n";

    fn parsed() -> ParsedTariff {
        parse_tariff_file(SAMPLE.as_bytes()).unwrap()
    }

    #[test]
    fn header_gives_the_canton_and_the_creation_date() {
        let p = parsed();
        assert_eq!(p.canton, "VD");
        assert_eq!(p.file_created_on.as_deref(), Some("2025-12-01"));
        assert_eq!(p.skipped_records, 1, "le type 12 est ignoré, pas fatal");
    }

    #[test]
    fn progressive_records_are_read_with_amounts_in_francs() {
        let p = parsed();
        assert_eq!(p.rows.len(), 4);
        let first = &p.rows[0];
        assert_eq!(first.tariff_code, "A0N");
        assert_eq!(first.valid_from, "2026-01-01");
        assert_eq!(first.children, 0);
        assert_eq!(first.income_from, 6_000.0);
        assert_eq!(first.income_step, 100.0);
        assert_eq!(first.tax_amount, Some(540.0));
    }

    #[test]
    fn the_children_count_is_read_from_the_tariff_code() {
        assert_eq!(children_from_code("A0N"), Some(0));
        assert_eq!(children_from_code("B2Y"), Some(2));
        assert_eq!(children_from_code("C1N"), Some(1));
        assert_eq!(children_from_code("H"), None);
    }

    #[test]
    fn the_bracket_covering_the_base_is_the_one_applied() {
        let p = parsed();
        let a0n: Vec<TariffRow> = p.rows.iter().filter(|r| r.tariff_code == "A0N").cloned().collect();
        assert_eq!(tax_for_base(&a0n, 6_050.0), Some(540.0), "dans la 1re tranche");
        assert_eq!(tax_for_base(&a0n, 6_100.0), Some(565.0), "borne basse de la 2e");
        assert_eq!(tax_for_base(&a0n, 9_999.0), Some(590.0), "au-delà : dernière tranche");
    }

    #[test]
    fn a_base_below_the_first_bracket_is_exempt_not_unknown() {
        let p = parsed();
        let a0n: Vec<TariffRow> = p.rows.iter().filter(|r| r.tariff_code == "A0N").cloned().collect();
        assert_eq!(tax_for_base(&a0n, 1_000.0), Some(0.0));
    }

    #[test]
    fn an_unknown_tariff_yields_none_never_zero() {
        assert_eq!(tax_for_base(&[], 8_000.0), None);
    }

    #[test]
    fn a_file_without_any_readable_bracket_is_refused() {
        let err = parse_tariff_file(b"00;VD;22;001;20251201;1\n99;rien\n").unwrap_err();
        assert!(err.contains("Aucune tranche"), "message inattendu : {err}");
    }

    /// Une disposition de colonnes qui n'est pas la nôtre doit faire échouer
    /// l'import, jamais produire des montants d'impôt fantaisistes.
    #[test]
    fn a_mostly_unreadable_file_is_refused() {
        let bad = "\
00;VD;22;001;20251201;1\n\
06;1;VD;A0N ;20260101;000600000;000010000;1;00;000054000\n\
06;pas;du;tout;le;bon;format\n\
06;encore;moins;celui;attendu;ici;non\n\
06;ni;celui;la;non;plus;vraiment\n";
        let err = parse_tariff_file(bad.as_bytes()).unwrap_err();
        assert!(err.contains("disposition"), "message inattendu : {err}");
    }

    #[test]
    fn romandy_uses_the_annual_model() {
        assert!(uses_annual_model("VD"));
        assert!(uses_annual_model("ge"));
        assert!(!uses_annual_model("ZH"));
        assert!(!uses_annual_model("BE"));
    }
}

//! La « saison des primes » : les dates qui comptent, chaque automne, pour
//! changer de caisse, de franchise ou de modèle au 1er janvier suivant.
//!
//! Les dates suivent la loi, pas l'habitude :
//!
//! - l'assureur doit annoncer la nouvelle prime au moins deux mois avant
//!   qu'elle s'applique, donc au 31 octobre pour le 1er janvier
//!   (art. 7 al. 2 LAMal) ;
//! - l'assuré qui veut partir a alors un préavis d'un mois pour la fin du
//!   mois qui précède : sa lettre doit être REÇUE le 30 novembre ;
//! - avec une franchise à option ou un modèle à choix limité, on ne change
//!   d'assureur qu'en fin d'année (art. 94 al. 2 et 100 al. 3 OAMal) ; en
//!   franchise ordinaire et modèle standard, la fin juin est aussi possible,
//!   avec trois mois de préavis (art. 7 al. 1 LAMal) ;
//! - l'ancien assureur ne lâche l'assuré que lorsque le nouveau lui a
//!   annoncé l'affiliation (art. 7 al. 5 LAMal) : une résiliation sans
//!   nouvelle caisse ne fait rien.
//!
//! « Reçue » est le mot important : un recommandé posté le 30 novembre
//! arrive trop tard. Quand l'échéance tombe un week-end, le calendrier
//! propose aussi le dernier jour ouvrable qui précède, et toujours une date
//! d'envoi conseillée avec une marge postale.

use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::Serialize;

/// Marge conseillée entre l'envoi d'un recommandé et sa réception.
const POSTAL_MARGIN_DAYS: i64 = 10;

#[derive(Debug, Clone, Serialize)]
pub struct SeasonEvent {
    /// Identifiant stable : `premium_notice`, `switch_insurer`,
    /// `lower_franchise`, `raise_franchise`, `affiliation`, `mid_year_switch`.
    pub key: &'static str,
    /// Date légale (AAAA-MM-JJ).
    pub date: String,
    /// Dernier jour ouvrable au plus tard à cette date — la date qui compte
    /// quand l'échéance tombe un samedi ou un dimanche.
    pub working_date: String,
    /// Date d'envoi conseillée pour un recommandé, `None` pour un événement
    /// qui ne demande rien à l'assuré.
    pub send_by: Option<String>,
    pub title: &'static str,
    pub detail: String,
    pub legal_ref: &'static str,
    /// L'événement vaut-il pour cette police ? Faux pour la sortie de fin
    /// juin en franchise à option, par exemple.
    pub applies: bool,
}

/// Ce que le calendrier a besoin de savoir de la police.
#[derive(Debug, Clone, Copy, Default)]
pub struct PolicyShape {
    pub ordinary_franchise: bool,
    pub standard_model: bool,
}

fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).expect("date valide")
}

fn iso(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// Dernier jour du lundi au vendredi au plus tard à `d`. Les jours fériés
/// cantonaux ne sont pas connus ici : c'est une borne, pas une garantie.
pub fn last_working_day_on_or_before(d: NaiveDate) -> NaiveDate {
    match d.weekday() {
        Weekday::Sat => d - Duration::days(1),
        Weekday::Sun => d - Duration::days(2),
        _ => d,
    }
}

fn send_by(receipt: NaiveDate) -> String {
    iso(last_working_day_on_or_before(receipt - Duration::days(POSTAL_MARGIN_DAYS)))
}

fn event(
    key: &'static str,
    date: NaiveDate,
    needs_letter: bool,
    title: &'static str,
    detail: String,
    legal_ref: &'static str,
    applies: bool,
) -> SeasonEvent {
    let working = last_working_day_on_or_before(date);
    SeasonEvent {
        key,
        date: iso(date),
        working_date: iso(working),
        send_by: needs_letter.then(|| send_by(working)),
        title,
        detail,
        legal_ref,
        applies,
    }
}

/// Les échéances de la saison `season_year` — l'automne pendant lequel on
/// décide pour le 1er janvier `season_year + 1` — suivies de la fenêtre de fin
/// juin de l'année suivante.
pub fn season_events(season_year: i32, shape: PolicyShape) -> Vec<SeasonEvent> {
    let next = season_year + 1;
    let mid_year_ok = shape.ordinary_franchise && shape.standard_model;
    vec![
        event(
            "premium_notice",
            ymd(season_year, 10, 31),
            false,
            "Avis de prime de l'assureur",
            format!(
                "Votre caisse doit vous avoir communiqué la prime {next} et rappelé votre droit de \
                 changer d'assureur. Sans avis à cette date, la hausse ne vous est pas opposable."
            ),
            "art. 7 al. 2 LAMal",
            true,
        ),
        event(
            "switch_insurer",
            ymd(season_year, 11, 30),
            true,
            "Changer de caisse au 1er janvier",
            format!(
                "La résiliation de l'assurance de base doit être REÇUE par la caisse actuelle. \
                 Elle ne prend effet que lorsque la nouvelle caisse a annoncé votre affiliation \
                 pour le 1.1.{next} : inscrivez-vous chez elle avant ou en même temps."
            ),
            "art. 7 al. 2 et 5 LAMal",
            true,
        ),
        event(
            "lower_franchise",
            ymd(season_year, 11, 30),
            true,
            "Baisser la franchise, quitter un modèle alternatif",
            format!(
                "Passer à une franchise plus basse, ou revenir au modèle standard, au 1.1.{next} : \
                 demande à faire parvenir à la caisse dans le même délai qu'une résiliation."
            ),
            "art. 94 et 100 al. 3 OAMal",
            true,
        ),
        event(
            "raise_franchise",
            ymd(season_year, 12, 31),
            true,
            "Augmenter la franchise, entrer dans un modèle alternatif",
            format!(
                "Une franchise plus haute ou un modèle médecin de famille / HMO / Telmed au \
                 1.1.{next} s'annonce en général jusqu'au dernier jour ouvrable de l'année. \
                 Vérifiez le délai dans les conditions de votre caisse."
            ),
            "art. 94 OAMal ; conditions de l'assureur",
            true,
        ),
        event(
            "affiliation",
            ymd(season_year, 12, 31),
            false,
            "Confirmation de la nouvelle caisse",
            format!(
                "Si vous changez de caisse, la nouvelle doit vous confirmer l'affiliation au \
                 1.1.{next}. Sans elle, l'ancienne vous garde — et vous facture."
            ),
            "art. 7 al. 5 LAMal",
            true,
        ),
        event(
            "mid_year_switch",
            ymd(next, 3, 31),
            true,
            "Changer de caisse au 30 juin",
            if mid_year_ok {
                format!(
                    "Possible avec la franchise ordinaire et le modèle standard : résiliation \
                     reçue au 31 mars {next} pour le 30 juin."
                )
            } else {
                "Pas pour cette police : avec une franchise à option ou un modèle alternatif, on \
                 ne change de caisse qu'en fin d'année."
                    .to_string()
            },
            "art. 7 al. 1 LAMal ; art. 94 al. 2 et 100 al. 3 OAMal",
            mid_year_ok,
        ),
    ]
}

/// L'automne à surveiller à la date `today` : celui de l'année en cours
/// jusqu'au 31 décembre. Dès janvier, on regarde déjà l'automne qui vient.
pub fn season_year_for(today: NaiveDate) -> i32 {
    today.year()
}

/// La saison est « ouverte » de la publication des primes par l'OFSP (fin
/// septembre) à la fin de l'année : c'est la fenêtre où l'app la met en avant.
pub fn season_is_open(today: NaiveDate) -> bool {
    today >= ymd(today.year(), 9, 15)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echeances_2026() {
        let ev = season_events(2026, PolicyShape { ordinary_franchise: true, standard_model: true });
        let switch = ev.iter().find(|e| e.key == "switch_insurer").unwrap();
        assert_eq!(switch.date, "2026-11-30");
        // Le 30.11.2026 est un lundi : pas de décalage.
        assert_eq!(switch.working_date, "2026-11-30");
        assert_eq!(switch.send_by.as_deref(), Some("2026-11-20"));
        let notice = ev.iter().find(|e| e.key == "premium_notice").unwrap();
        assert!(notice.send_by.is_none());
        assert!(ev.iter().find(|e| e.key == "mid_year_switch").unwrap().applies);
    }

    #[test]
    fn echeance_un_week_end_recule_au_vendredi() {
        // Le 30.11.2025 est un dimanche.
        let ev = season_events(2025, PolicyShape::default());
        let switch = ev.iter().find(|e| e.key == "switch_insurer").unwrap();
        assert_eq!(switch.date, "2025-11-30");
        assert_eq!(switch.working_date, "2025-11-28");
    }

    #[test]
    fn fin_juin_reservee_a_la_franchise_ordinaire_et_au_modele_standard() {
        let option = season_events(2026, PolicyShape { ordinary_franchise: false, standard_model: true });
        assert!(!option.iter().find(|e| e.key == "mid_year_switch").unwrap().applies);
        let hmo = season_events(2026, PolicyShape { ordinary_franchise: true, standard_model: false });
        assert!(!hmo.iter().find(|e| e.key == "mid_year_switch").unwrap().applies);
    }

    #[test]
    fn saison_ouverte_des_mi_septembre() {
        assert!(!season_is_open(ymd(2026, 9, 1)));
        assert!(season_is_open(ymd(2026, 10, 17)));
        assert_eq!(season_year_for(ymd(2026, 12, 31)), 2026);
    }
}

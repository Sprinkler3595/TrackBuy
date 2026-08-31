use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::auth::AppState;

/// Le registre du commerce suisse (Zefix), interrogé par son API publique.
///
/// Saisir le nom d'une entreprise et recevoir son IDE et son adresse évite deux
/// erreurs que rien ne rattrape ensuite : un IDE mal recopié, et une adresse
/// qui n'est pas celle du SIÈGE — or c'est le siège qui commande les retenues
/// sociales cantonales.
///
/// Deux appels, parce que l'API est ainsi faite : la recherche par nom rend une
/// liste allégée (`CompanyShort`) qui ne porte PAS l'adresse, seulement la
/// commune du siège. L'adresse complète demande le détail par IDE.
///
/// ## Licence : OGD, source à citer
///
/// La spécification publiée (`/ZefixPublicREST/v3/api-docs`, OpenAPI 3.1)
/// porte : « OGD Open use. Must provide the source. » L'usage est donc libre,
/// à une condition qui n'est pas décorative : la SOURCE doit être indiquée.
/// L'écran de recherche la nomme — c'est une obligation, pas une politesse.
///
/// ## Identifiants : facultatifs
///
/// La même spécification déclare un schéma de sécurité sur chacun de ses
/// points d'entrée (le cadenas de Swagger). Mais elle ne dit pas si le serveur
/// l'exige réellement, et le registre est par ailleurs annoncé comme public.
///
/// Impossible de trancher sans appeler : d'où la règle ici. On appelle SANS
/// authentification tant qu'aucun identifiant n'est enregistré, et on n'en
/// ajoute un que s'il y en a un. Le cas ordinaire ne demande donc aucun
/// réglage ; et si le registre refuse l'appel anonyme, le 401 le dit et
/// renvoie vers les réglages, où l'accès nominatif — gratuit, obtenu auprès de
/// `zefix@bj.admin.ch` — se saisit.
///
/// Aucun identifiant n'est livré avec l'application : un compte nominatif
/// embarqué serait partagé entre tous ses utilisateurs, ce que les conditions
/// d'accès n'autorisent pas.

const ZEFIX_BASE: &str = "https://www.zefix.admin.ch/ZefixPublicREST/api/v1";

/// Vides quand l'utilisateur n'a rien saisi — le cas normal. `#[serde(default)]`
/// pour qu'une charge partielle, ou absente, décode au lieu d'échouer.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct ZefixCredentials {
    pub username: String,
    pub password: String,
}

/// Les identifiants à envoyer, ou `None` pour un appel anonyme.
///
/// Un mot de passe sans identifiant, ou l'inverse, ne vaut rien : une
/// authentification à moitié remplie serait refusée par le registre alors que
/// l'appel anonyme, lui, aurait abouti.
fn auth(c: &ZefixCredentials) -> Option<(&str, &str)> {
    let user = c.username.trim();
    (!user.is_empty() && !c.password.is_empty()).then_some((user, c.password.as_str()))
}

/// Pose l'authentification seulement s'il y en a une.
fn signed(rb: reqwest::RequestBuilder, c: &ZefixCredentials) -> reqwest::RequestBuilder {
    match auth(c) {
        Some((user, pass)) => rb.basic_auth(user, Some(pass)),
        None => rb,
    }
}

/// Une entreprise telle que la recherche la rend. `legal_seat` est la commune
/// du siège — pas une adresse : elle sert à distinguer deux homonymes avant de
/// demander le détail.
#[derive(Debug, Serialize, Default)]
pub struct ZefixMatch {
    pub name: String,
    pub uid: Option<String>,
    pub legal_seat: Option<String>,
    pub legal_form: Option<String>,
    /// `ACTIVE`, `CANCELLED`, `BEING_CANCELLED`. Une société radiée reste dans
    /// le registre : le dire évite de rattacher un salaire à une coquille.
    pub status: Option<String>,
}

/// Le détail, une fois l'entreprise choisie. L'adresse est reconstituée en une
/// ligne parce que c'est ainsi qu'elle est stockée et affichée côté revenu.
#[derive(Debug, Serialize, Default)]
pub struct ZefixCompany {
    pub name: String,
    pub uid: Option<String>,
    pub address: Option<String>,
    pub legal_seat: Option<String>,
    pub status: Option<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Client HTTP : {e}"))
}

/// Traduit un statut HTTP en cause compréhensible. Un « 401 » brut n'aide
/// personne ; savoir qu'il manque des identifiants, si.
/// Le message que le registre met lui-même dans son corps d'erreur
/// (`RestApiErrorResponse`). Il en dit plus que le statut — « name too short »,
/// « invalid uid » — et vaut mieux que deux cents caractères de JSON brut.
fn message_in(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    ["message", "error", "detail"]
        .iter()
        .find_map(|k| text_of(&v, k))
}

fn explain(status: reqwest::StatusCode, body: &str) -> String {
    match status.as_u16() {
        401 | 403 => "Zefix a refusé cette requête. Le registre demande ici des identifiants : ils sont gratuits et s'obtiennent auprès de zefix@bj.admin.ch, puis se saisissent dans Paramètres → Registre du commerce. Si vous en avez déjà saisi, vérifiez-les.".into(),
        404 => "Zefix ne connaît pas cette entreprise.".into(),
        429 => "Trop de requêtes envoyées à Zefix. Patientez un instant.".into(),
        500..=599 => format!("Zefix est momentanément indisponible ({status})."),
        _ => match message_in(body) {
            Some(m) => format!("Zefix a répondu {status} : {m}"),
            None => format!("Zefix a répondu {status} : {}", body.chars().take(200).collect::<String>()),
        },
    }
}

/// Le registre exprime certains libellés en quatre langues — son schéma les
/// type `DFIEString` : Deutsch, Français, Italiano, English. Le champ vaut
/// alors un OBJET, pas une chaîne, et un lecteur qui n'attend qu'une chaîne
/// n'y voit rien : la forme juridique disparaîtrait de la liste sans qu'aucune
/// erreur ne le signale.
///
/// Le français d'abord, l'application étant francophone, puis les autres
/// langues nationales : « Aktiengesellschaft » vaut mieux que rien.
const LANGS: [&str; 4] = ["fr", "de", "it", "en"];

fn flat_text(v: &serde_json::Value) -> Option<String> {
    let clean = |s: &str| {
        let t = s.trim();
        (!t.is_empty()).then(|| t.to_string())
    };
    match v {
        serde_json::Value::String(s) => clean(s.as_str()),
        serde_json::Value::Object(_) => LANGS
            .iter()
            .find_map(|lang| v.get(lang).and_then(|x| x.as_str()).and_then(clean)),
        _ => None,
    }
}

fn text_of(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(flat_text)
}

/// L'adresse du registre, mise en une ligne : « Route de Meyrin 12, 1217 Meyrin ».
///
/// Chaque morceau peut manquer — une case postale sans rue, un lieu-dit sans
/// numéro — donc rien n'est supposé présent. Une adresse vide rend `None`
/// plutôt qu'une chaîne de virgules.
fn format_address(a: &serde_json::Value) -> Option<String> {
    let street = [text_of(a, "street"), text_of(a, "houseNumber")]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let city = [text_of(a, "swissZipCode"), text_of(a, "city")]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ");
    let parts: Vec<String> = [
        text_of(a, "careOf"),
        (!street.is_empty()).then_some(street),
        text_of(a, "poBox"),
        (!city.is_empty()).then_some(city),
    ]
    .into_iter()
    .flatten()
    .collect();
    (!parts.is_empty()).then(|| parts.join(", "))
}

fn to_match(v: &serde_json::Value) -> Option<ZefixMatch> {
    let name = text_of(v, "name")?;
    Some(ZefixMatch {
        name,
        uid: text_of(v, "uid"),
        legal_seat: text_of(v, "legalSeat"),
        legal_form: v
            .get("legalForm")
            .and_then(|f| text_of(f, "shortName").or_else(|| text_of(f, "name"))),
        status: text_of(v, "status"),
    })
}

/// Cherche une entreprise par son nom. Le registre accepte un début de nom.
#[tauri::command]
pub async fn zefix_search(
    _state: State<'_, AppState>,
    credentials: ZefixCredentials,
    name: String,
    canton: Option<String>,
) -> Result<Vec<ZefixMatch>, String> {
    let query = name.trim();
    if query.len() < 3 {
        return Err("Donnez au moins trois lettres du nom.".into());
    }
    let mut body = serde_json::json!({ "name": query, "activeOnly": true });
    if let Some(c) = canton.as_deref().map(str::trim).filter(|c| c.len() == 2) {
        body["canton"] = serde_json::Value::String(c.to_uppercase());
    }

    let resp = signed(
        client()?.post(format!("{ZEFIX_BASE}/company/search")),
        &credentials,
    )
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Requête Zefix : {e}"))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(explain(status, &text));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Réponse Zefix illisible : {e}"))?;
    // La recherche rend un tableau. Refuser une forme inattendue plutôt que
    // de rendre une liste vide : « aucun résultat » et « je n'ai pas compris
    // la réponse » ne se soignent pas de la même façon.
    let list = parsed
        .as_array()
        .ok_or("Réponse Zefix inattendue : un tableau d'entreprises était attendu.")?;
    Ok(list.iter().filter_map(to_match).collect())
}

/// Le détail d'une entreprise, pour son adresse. C'est le seul endroit où
/// l'API la donne.
#[tauri::command]
pub async fn zefix_company(
    _state: State<'_, AppState>,
    credentials: ZefixCredentials,
    uid: String,
) -> Result<ZefixCompany, String> {
    // L'IDE se saisit avec ou sans ponctuation ; le registre l'attend nu.
    let id: String = uid.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if id.is_empty() {
        return Err("Numéro IDE vide.".into());
    }

    let resp = signed(
        client()?.get(format!("{ZEFIX_BASE}/company/uid/{id}")),
        &credentials,
    )
        .send()
        .await
        .map_err(|e| format!("Requête Zefix : {e}"))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(explain(status, &text));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Réponse Zefix illisible : {e}"))?;
    Ok(parse_company(&parsed)?)
}

/// Extrait l'entreprise d'une réponse de détail.
///
/// Le registre rend tantôt un objet, tantôt un tableau — un même IDE peut
/// porter plusieurs inscriptions. Accepter les deux formes évite un échec sur
/// une variation qui ne change rien pour l'utilisateur ; en revanche une forme
/// vraiment inconnue est refusée, pas devinée.
pub(crate) fn parse_company(parsed: &serde_json::Value) -> Result<ZefixCompany, String> {
    let obj = match parsed {
        serde_json::Value::Array(items) => items
            .first()
            .ok_or("Zefix ne connaît pas cette entreprise.")?,
        serde_json::Value::Object(_) => parsed,
        _ => return Err("Réponse Zefix inattendue.".into()),
    };
    let name = text_of(obj, "name")
        .ok_or("Réponse Zefix inattendue : entreprise sans nom.")?;
    Ok(ZefixCompany {
        name,
        uid: text_of(obj, "uid"),
        address: obj.get("address").and_then(format_address),
        legal_seat: text_of(obj, "legalSeat"),
        status: text_of(obj, "status"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// L'adresse du registre arrive en morceaux ; elle doit sortir lisible.
    #[test]
    fn an_address_is_assembled_from_its_parts() {
        let a = json!({
            "street": "Route de Meyrin",
            "houseNumber": "12",
            "swissZipCode": "1217",
            "city": "Meyrin",
        });
        assert_eq!(
            format_address(&a).as_deref(),
            Some("Route de Meyrin 12, 1217 Meyrin")
        );
    }

    /// Chaque morceau peut manquer sans que la ligne parte en virgules.
    #[test]
    fn missing_parts_never_produce_stray_commas() {
        // Case postale sans rue.
        let po = json!({ "poBox": "Case postale 300", "swissZipCode": "8401", "city": "Winterthur" });
        assert_eq!(
            format_address(&po).as_deref(),
            Some("Case postale 300, 8401 Winterthur")
        );

        // Lieu-dit sans numéro.
        let no_number = json!({ "street": "Les Grands Champs", "city": "Bulle" });
        assert_eq!(format_address(&no_number).as_deref(), Some("Les Grands Champs, Bulle"));

        // Rien d'exploitable : None, et surtout pas une chaîne vide.
        assert_eq!(format_address(&json!({})), None);
        assert_eq!(format_address(&json!({ "street": "  " })), None);
    }

    /// Le détail arrive tantôt en objet, tantôt en tableau : les deux passent.
    #[test]
    fn a_detail_response_is_read_in_both_shapes() {
        let body = json!({
            "name": "KaSy SA",
            "uid": "CHE123456789",
            "legalSeat": "Meyrin",
            "status": "ACTIVE",
            "address": { "street": "Route de Meyrin", "houseNumber": "12",
                         "swissZipCode": "1217", "city": "Meyrin" },
        });
        for shape in [body.clone(), json!([body])] {
            let c = parse_company(&shape).unwrap();
            assert_eq!(c.name, "KaSy SA");
            assert_eq!(c.uid.as_deref(), Some("CHE123456789"));
            assert_eq!(c.address.as_deref(), Some("Route de Meyrin 12, 1217 Meyrin"));
            assert_eq!(c.legal_seat.as_deref(), Some("Meyrin"));
        }
    }

    /// Une forme inconnue est refusée, pas devinée : rendre une entreprise
    /// vide ferait écrire des champs vides par-dessus une saisie correcte.
    #[test]
    fn an_unexpected_shape_is_refused() {
        assert!(parse_company(&json!("bonjour")).is_err());
        assert!(parse_company(&json!([])).is_err());
        assert!(parse_company(&json!({ "uid": "CHE123456789" })).is_err());
    }

    /// Un libellé multilingue ne doit pas disparaître : le champ vaut un objet
    /// de quatre langues, et le français est celui qu'on veut.
    #[test]
    fn a_multilingual_label_is_read_in_french_first() {
        let hit = json!({
            "name": "KaSy SA",
            "legalForm": {
                "shortName": { "de": "AG", "fr": "SA", "it": "SA", "en": "Ltd" },
            },
        });
        assert_eq!(to_match(&hit).unwrap().legal_form.as_deref(), Some("SA"));

        // Français absent : une autre langue nationale plutôt que rien.
        let de_only = json!({
            "name": "KaSy AG",
            "legalForm": { "shortName": { "de": "AG" } },
        });
        assert_eq!(to_match(&de_only).unwrap().legal_form.as_deref(), Some("AG"));

        // Et la forme simple continue de passer.
        let plain = json!({ "name": "KaSy SA", "legalForm": { "shortName": "SA" } });
        assert_eq!(to_match(&plain).unwrap().legal_form.as_deref(), Some("SA"));

        // Un objet sans aucune langue connue ne rend rien plutôt qu'un débris.
        let unknown = json!({ "name": "KaSy SA", "legalForm": { "shortName": { "rm": "SA" } } });
        assert_eq!(to_match(&unknown).unwrap().legal_form, None);
    }

    /// Le corps d'erreur du registre en dit plus que le statut seul.
    #[test]
    fn the_registry_own_error_message_is_surfaced() {
        let body = r#"{"status":400,"message":"name must be at least 3 characters"}"#;
        let msg = explain(reqwest::StatusCode::BAD_REQUEST, body);
        assert!(msg.contains("name must be at least 3 characters"), "{msg}");

        // Corps illisible : on retombe sur le texte brut, tronqué.
        let raw = explain(reqwest::StatusCode::BAD_REQUEST, "<html>oups</html>");
        assert!(raw.contains("oups"), "{raw}");
    }

    /// L'appel anonyme est le cas normal : rien de saisi, rien d'envoyé.
    /// Une authentification à moitié remplie est traitée comme absente — la
    /// poser ferait échouer un appel qui, sans elle, aboutissait.
    #[test]
    fn credentials_are_only_sent_when_they_are_complete() {
        let creds = |u: &str, p: &str| ZefixCredentials {
            username: u.into(),
            password: p.into(),
        };
        assert_eq!(auth(&ZefixCredentials::default()), None);
        assert_eq!(auth(&creds("  ", "secret")), None);
        assert_eq!(auth(&creds("moi", "")), None);
        assert_eq!(auth(&creds(" moi ", "secret")), Some(("moi", "secret")));
    }

    /// Une charge partielle décode : le front n'envoie pas toujours les deux
    /// champs, et un revenu ne doit pas se perdre sur un réglage absent.
    #[test]
    fn a_partial_payload_decodes_to_no_credentials() {
        let c: ZefixCredentials = serde_json::from_value(json!({})).unwrap();
        assert_eq!(auth(&c), None);
        let c: ZefixCredentials = serde_json::from_value(json!({ "username": "moi" })).unwrap();
        assert_eq!(auth(&c), None);
    }

    /// La liste de recherche : ce qui distingue deux homonymes doit survivre.
    #[test]
    fn a_search_hit_keeps_what_tells_namesakes_apart() {
        let hit = json!({
            "name": "KaSy SA",
            "uid": "CHE123456789",
            "legalSeat": "Meyrin",
            "status": "ACTIVE",
            "legalForm": { "shortName": "SA" },
        });
        let m = to_match(&hit).unwrap();
        assert_eq!(m.legal_seat.as_deref(), Some("Meyrin"));
        assert_eq!(m.legal_form.as_deref(), Some("SA"));
        assert_eq!(m.status.as_deref(), Some("ACTIVE"));

        // Sans nom, l'entrée n'est pas exploitable.
        assert!(to_match(&json!({ "uid": "CHE1" })).is_none());
    }
}

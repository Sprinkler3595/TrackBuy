use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SYSTEM_PROMPT: &str = "Tu es un extracteur de données pour un suivi d'achats. Réponds UNIQUEMENT en JSON valide (sans markdown, sans texte autour). Si un champ est introuvable, mets null. N'invente AUCUNE valeur — préfère null à une supposition.";

const EXTRACTION_PROMPT: &str = r#"Analyse le texte OCR ci-dessous (reçu ou facture) et extrais les champs structurés.

STRUCTURE TYPIQUE D'UN REÇU/FACTURE :
- En-tête (haut) : nom commercial du marchand, parfois adresse, téléphone, n° TVA
- Corps (milieu) : liste des articles, chacun avec une description et un prix unitaire (parfois quantité et total ligne)
- Pied (bas) : sous-totaux (HT, TVA, remise), TOTAL TTC final, mode de paiement (CB / VISA / CASH)

RÈGLES STRICTES :
1. `description` = libellé global de l'achat. Si plusieurs articles, prends le plus représentatif ou résume-les (ex: "iPhone 15 + coque"). Ne JAMAIS mettre "TOTAL", "TVA", une date, ou une ligne de paiement.
2. `purchase_price` = TOTAL TTC FINAL, celui que le client paie. Se trouve typiquement en bas, précédé de mots-clés : TOTAL, MONTANT, SOLDE, À PAYER, NET À PAYER, DUE, MONTANT TTC. Ne PAS confondre avec un prix d'article individuel ni un sous-total HT.
3. `items[]` ne contient QUE les produits/services achetés (un objet par article). EXCLURE absolument : sous-total, total, TVA, TPS, TPQ, TVH, GST, HST, PST, QST, espèces, carte, monnaie, rendu, change, points de fidélité.
   ⚠️ Les frais de livraison, l'installation, l'extension de garantie, les licences logicielles, les bons/coupons/remises font partie de `items[]` mais avec une `category` adaptée (voir règle 11).
4. `merchant` = raison sociale ou enseigne commerciale visible en haut. Pas l'adresse, pas le slogan, pas le nom du caissier, pas "Bienvenue chez...".
5. `purchase_date` = date d'émission du reçu (souvent en haut, parfois en pied). PAS une date de garantie, d'échéance ou de validité.
6. `tax_rate` = taux principal en pourcentage (ex: 20 pour 20%, 7.7 pour la TVA suisse). Si plusieurs taux, prends le plus élevé.
7. `price_excl_tax` = total HT (avant TVA). Doit être < `purchase_price`. Cohérence : `purchase_price ≈ price_excl_tax * (1 + tax_rate/100)`.
8. Si tu détectes "VISA ****1234" / "MASTERCARD XX5678" / "AMEX" → mets cette info dans `notes`.
9. `warranty_months` uniquement si une garantie est explicitement mentionnée sur le reçu (ex: "garantie 24 mois", "2 ans de garantie").
10. Si un champ est introuvable, AMBIGU, ou si tu hésites → mets null. N'invente RIEN.
11. CLASSIFICATION DES LIGNES (champ `category` obligatoire pour chaque item) :
    - `purchase` : produit physique acheté (par défaut si tu hésites entre purchase/license)
    - `license` : licence logicielle, abonnement, clé d'activation, plan SaaS, accès numérique (mots-clés : "licence", "license", "abonnement", "subscription", "clé", "key", "activation", "Office", "Adobe", "Microsoft 365", "renouvellement annuel", "1 an", "user/mois")
    - `service` : prestation non-physique livrée par le marchand (mots-clés : "installation", "configuration", "main d'œuvre", "service", "intervention", "support", "extension de garantie", "garantie+", "AppleCare")
    - `shipping` : frais de port, livraison, expédition, transport (mots-clés : "livraison", "port", "expédition", "shipping", "transport", "frais de port")
    - `voucher` : bon de réduction, coupon, code promo, remise commerciale, gift card utilisée, escompte, avoir (mots-clés : "remise", "rabais", "discount", "coupon", "bon", "code promo", "avoir", "escompte", "gift card", "carte cadeau"). ⚠️ Le `price` doit être NÉGATIF (ex: -10.00) car ça réduit le total.
    - `other` : ligne qui n'entre dans aucune catégorie ci-dessus
12. MIXTE : si la facture contient à la fois des achats et des licences (ou bons, ou services), CHACUNE doit apparaître dans `items[]` avec sa propre `category`. Ne JAMAIS regrouper.

FORMAT DE RÉPONSE (JSON strict, sans markdown) :
{
  "description": string,
  "purchase_date": "YYYY-MM-DD",
  "purchase_price": number,
  "currency": "CHF"|"EUR"|"USD"|"GBP"|"CAD",
  "merchant": string,
  "invoice_number": string|null,
  "product_reference": string|null,
  "quantity": number|null,
  "price_excl_tax": number|null,
  "tax_rate": number|null,
  "warranty_months": number|null,
  "warranty_start_date": "YYYY-MM-DD"|null,
  "notes": string|null,
  "items": [{"description": string, "price": number, "category": "purchase"|"license"|"service"|"shipping"|"voucher"|"other"}]
}

TEXTE OCR (entre <<<>>>) :
<<<{OCR}>>>"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Infomaniak,
    Ollama,
}

#[derive(Debug, Deserialize)]
pub struct AiConfig {
    pub provider: AiProvider,
    #[serde(default, rename = "apiKey", alias = "api_key")]
    pub api_key: String,
    #[serde(default, rename = "infomaniakProductId", alias = "infomaniak_product_id")]
    pub infomaniak_product_id: String,
    #[serde(default, rename = "ollamaUrl", alias = "ollama_url")]
    pub ollama_url: String,
    pub model: String,
}

#[derive(Debug, Serialize)]
pub struct ExtractedReceipt {
    pub description: Option<String>,
    pub purchase_date: Option<String>,
    pub purchase_price: Option<f64>,
    pub currency: Option<String>,
    pub merchant: Option<String>,
    pub invoice_number: Option<String>,
    pub product_reference: Option<String>,
    pub quantity: Option<i64>,
    pub price_excl_tax: Option<f64>,
    pub tax_rate: Option<f64>,
    pub warranty_months: Option<i64>,
    pub warranty_start_date: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<ExtractedItem>,
}

#[derive(Debug, Serialize)]
pub struct ExtractedItem {
    pub description: String,
    pub price: f64,
    pub category: String,
}

#[tauri::command]
pub async fn ai_extract_receipt(
    ocr_text: String,
    config: AiConfig,
) -> Result<ExtractedReceipt, String> {
    let prompt = EXTRACTION_PROMPT.replace("{OCR}", &ocr_text);
    let raw = call_provider(&config, SYSTEM_PROMPT, &prompt, None).await?;
    let cleaned = strip_code_fences(&raw);
    let value: Value = serde_json::from_str(&cleaned)
        .map_err(|e| format!("Réponse IA non-JSON: {} — contenu: {}", e, raw))?;
    Ok(parse_extracted(&value))
}

const BANK_SYSTEM_PROMPT: &str = "Tu es un parseur de relevés bancaires suisses. Tu DOIS répondre par un objet JSON unique respectant EXACTEMENT le schéma demandé. La clé racine est TOUJOURS \"transactions\" (un tableau). N'invente AUCUN autre nom de clé. Pas de markdown, pas de prose autour. Préfère omettre une transaction plutôt que d'en inventer une.";

const BANK_EXTRACTION_PROMPT: &str = r#"Tu reçois le contenu texte d'un relevé bancaire mensuel (UBS, PostFinance, Raiffeisen, Credit Suisse, banque cantonale…). Extrais CHAQUE ligne de transaction réelle PRÉSENTE DANS LE TEXTE.

ANTI-HALLUCINATION (CRITIQUE) :
- N'INVENTE JAMAIS une transaction. Si tu n'es pas sûr, omets.
- Les dates, montants et libellés DOIVENT venir littéralement du texte fourni — pas de paraphrase.
- Refuse les dates séquentielles factices (1, 2, 3, 4 avril…) si elles ne sont pas dans le texte.
- N'utilise PAS de montants ronds (1000, 500, 100…) sauf s'ils figurent textuellement.

CLÉ RACINE OBLIGATOIRE : "transactions" (un tableau JSON).

LECTURE DU TABLEAU (format typique PostFinance / UBS / Raiffeisen) :
Le tableau a généralement les colonnes : Date | Texte | Crédit | Débit | Valeur | Solde.
Une transaction occupe SOUVENT PLUSIEURS LIGNES :
  Ligne 1 : date + début de libellé + montant (dans colonne Crédit ou Débit) + date valeur + nouveau solde
  Lignes 2-N : suite du libellé (nom du marchand, IBAN contrepartie, ville…)
Toutes ces lignes appartiennent à UNE SEULE transaction. Concatène le libellé sur 2-5 lignes maximum.

RÈGLES :
1. `date` = date de la transaction au format YYYY-MM-DD. Les dates suisses sont écrites DD.MM.YY ou DD.MM.YYYY — convertis : "02.04.26" → "2026-04-02".
2. `description` = libellé concaténé sur toutes les lignes liées (marchand, type d'opération, contrepartie). Ne raccourcis pas.
3. `amount` = TOUJOURS positif, max 2 décimales. La direction est portée par `direction`.
4. `direction` = "debit" si le montant apparaît dans la colonne Débit OU si le libellé contient « ACHAT », « DÉBIT », « PAIEMENT » ; "credit" si colonne Crédit OU « CRÉDIT », « RÉCEPTION », « SALAIRE », « VERSEMENT ».
5. `currency` = "CHF" par défaut sur un relevé suisse.
6. `reference` = suite de 26-27 chiffres BVR / QR-bill si présente. null sinon.
7. `counterparty_iban` = IBAN visible (CH/LI commençant par "CH" ou "LI", 21 caractères). null sinon.
8. `balance` = null (sauf indication de profil banque ci-dessous). `opening_balance` (racine) = null également.
9. `location`, `original_amount`, `original_currency`, `exchange_rate` = null (sauf indication de profil banque ci-dessous).

IGNORE absolument :
- En-têtes (nom titulaire, adresse, IBAN du compte, période, BIC, numéro de compte)
- « Etat de compte » initial (solde d'ouverture)
- « Solde au … », « Saldo … », « Balance forward »
- Totaux mensuels et totaux de page
- Lignes purement de mise en page (numéros de page, « Page 1 / 4 »)

EXEMPLE DE RÉPONSE VALIDE (basée sur un vrai PostFinance) :
{"opening_balance":null,"transactions":[{"date":"2026-04-02","booking_date":"2026-04-01","description":"ACHAT/SHOPPING EN LIGNE DIGITEC GALAXUS ZÜRICH CARTE XXXX8750","amount":919.00,"currency":"CHF","direction":"debit","balance":null,"reference":null,"counterparty_iban":null,"location":null,"original_amount":null,"original_currency":null,"exchange_rate":null},{"date":"2026-04-02","booking_date":"2026-04-01","description":"CRÉDIT POSTFINANCE CARD DIGITEC GALAXUS ZÜRICH","amount":91.00,"currency":"CHF","direction":"credit","balance":null,"reference":null,"counterparty_iban":null,"location":null,"original_amount":null,"original_currency":null,"exchange_rate":null},{"date":"2026-04-08","booking_date":"2026-04-08","description":"DÉBIT SUNRISE GMBH POSTFACH 8050 ZURICH","amount":1.30,"currency":"CHF","direction":"debit","balance":null,"reference":null,"counterparty_iban":"CH6330000011875037700","location":null,"original_amount":null,"original_currency":null,"exchange_rate":null}]}

Réponds maintenant pour le relevé ci-dessous. JSON UNIQUEMENT. N'invente RIEN.
{BANK_HINT}
TEXTE DU RELEVÉ (entre <<<>>>) :
<<<{TEXT}>>>"#;

// ===========================================================================
// Registre de profils bancaires (reconnaissance adaptée par banque)
// ===========================================================================
//
// Le prompt générique ci-dessus couvre les banques suisses (PostFinance, UBS,
// Raiffeisen…). Certaines banques (Revolut, N26, Wise…) ont une mise en page
// très différente : colonnes nommées autrement, devise étrangère, format de
// date localisé, lignes de taux de change parasites, etc. Plutôt que de
// gonfler le prompt générique, on injecte un « profil banque » ciblé.
//
// COMMENT AJOUTER UNE BANQUE :
//   1. Ajoute une entrée `BankProfile` dans `BANK_PROFILES` ci-dessous.
//      - `id`            : identifiant court en minuscules (ex. "revolut").
//      - `display_name`  : nom lisible affiché/loggé (ex. "Revolut").
//      - `detect_keywords` : mots-clés en MINUSCULES cherchés dans le texte
//        du relevé pour l'auto-détection (ex. ["revolut", "revolt21"]).
//      - `prompt_hint`   : section en français injectée dans le prompt
//        décrivant la mise en page spécifique (colonnes, devise, format de
//        date, lignes à ignorer…). Laisser vide ("") pour ne rien injecter.
//   2. C'est tout. L'auto-détection et l'override par `bank_name` marchent
//      automatiquement. Le profil `generic` (id "generic") reste le défaut.

/// Profil de reconnaissance pour une banque donnée. Statique (`&'static`) :
/// tous les profils sont des constantes connues à la compilation.
pub struct BankProfile {
    pub id: &'static str,
    pub display_name: &'static str,
    pub detect_keywords: &'static [&'static str],
    pub prompt_hint: &'static str,
}

/// Profil par défaut : aucune indication spécifique, le prompt générique
/// (orienté banques suisses) s'applique tel quel.
const GENERIC_PROFILE: BankProfile = BankProfile {
    id: "generic",
    display_name: "Banque générique",
    detect_keywords: &[],
    prompt_hint: "",
};

/// Indication ciblée pour les relevés Revolut. Encode les règles dérivées
/// d'un vrai « Relevé CHF » Revolut (colonnes Argent sortant / entrant /
/// Solde, devise dans le titre, dates françaises, lignes de taux de change…).
const REVOLUT_HINT: &str = r#"
PROFIL BANQUE : REVOLUT
- Relevé Revolut (peut être en français ou en anglais). La devise du compte est indiquée dans le titre « Relevé CHF/EUR/USD … » et suffixe chaque montant (ex. « 9,95 CHF »). Utilise cette devise pour `currency`.
- Colonnes du tableau : Date | Description | « Argent sortant » | « Argent entrant » | « Solde » (en anglais : Date | Description | Money out | Money in | Balance).
- STRUCTURE DE LIGNE (capitale) : après le libellé, chaque ligne contient EXACTEMENT DEUX montants dans la devise du compte. Le PREMIER est le mouvement (soit Argent sortant, soit Argent entrant — l'AUTRE colonne est vide et a disparu du texte). Le SECOND est le SOLDE courant.
- CHAMP `amount` = le PREMIER montant (le mouvement) UNIQUEMENT, positif. N'y mets JAMAIS le solde.
- CHAMP `balance` = le SECOND montant (le solde courant après l'opération). REMPLIS-LE TOUJOURS — c'est obligatoire pour ce relevé : le code s'en sert pour calculer débit/crédit de façon fiable.
- CHAMP `opening_balance` (à la racine, une seule fois) = le « Solde d'ouverture » du tout premier « Résumé du solde » (ex. 67,00). C'est le solde AVANT la première transaction.
- `direction` : mets ta meilleure estimation (Argent sortant ⇒ "debit", Argent entrant ⇒ "credit"), mais ne t'inquiète pas si tu hésites : le code la recalcule à partir de `balance`/`opening_balance` (solde qui monte ⇒ credit, qui baisse ⇒ debit). L'essentiel est que `amount` et `balance` soient EXACTS.
- Montants au format européen : séparateur décimal = virgule (« 1062,65 CHF » = 1062.65). `amount` et `balance` doivent être des nombres positifs (le solde l'est toujours ici).
- Dates en français à convertir en ISO : « 1 mars 2026 » ⇒ 2026-03-01 (mois : janvier, février, mars, avril, mai, juin, juillet, août, septembre, octobre, novembre, décembre).
- La `description` est le nom du marchand de la première ligne (ex. « Holy Cow Steakhouse », « Migros », « OpenAI »). Les lignes « À : … » / « De : … » / « Carte : … » sont des détails : ne pas en faire des transactions (tu peux en tirer `counterparty_iban` seulement si un IBAN apparaît).
- CHAMP `location` = la VILLE / le lieu de l'opération, lu dans la ligne « À : … » (DERNIER segment après la virgule). Ex. « À : Ls Holy Cow Lausanne T, Lausanne » ⇒ "Lausanne" ; « À : Openai *chatgpt Subscr, Dublin » ⇒ "Dublin" ; « À : Shell Quai-perrier, Neuchatel » ⇒ "Neuchatel". Mets null si aucune ville n'est lisible (ex. paiement purement en ligne sans lieu).
- PAIEMENT EN DEVISE ÉTRANGÈRE — la ligne « Taux Revolut = 1,00 CHF = 1,10€ (taux ECB x 1,00 CHF = 1,11€) 23,00€ » N'EST PAS une transaction (ne crée jamais de transaction pour elle), MAIS elle décrit la transaction qui la précède. Reporte ses infos DANS cette transaction précédente :
    • `original_amount` = le montant en devise étrangère affiché en fin de ligne (ex. 23,00€ ⇒ 23.00).
    • `original_currency` = la devise d'origine (le symbole/■ code : € ⇒ "EUR", $ ⇒ "USD", £ ⇒ "GBP").
    • `exchange_rate` = le taux Revolut « 1,00 [devise compte] = N [devise origine] » (ex. 1.10). Prends le taux Revolut, PAS le taux ECB entre parenthèses.
  Le `amount` de la transaction reste le montant en devise du COMPTE (colonne Argent sortant/entrant, ex. 20,83 CHF) — jamais le montant étranger.
  Si la transaction n'a pas de ligne de taux (paiement dans la devise du compte), `original_amount`/`original_currency`/`exchange_rate` = null.
- Les lignes « Frais: 0,58 CHF » sont des frais déjà inclus dans le montant principal (colonne « Argent sortant ») : ne crée PAS de transaction séparée pour les frais ; le montant de la transaction est celui de la colonne « Argent sortant ».
- « Recharge sur Apple Pay via *XXXX » (et « De : *XXXX ») est un CRÉDIT (Argent entrant) : le solde MONTE.
- IGNORER : « Résumé du solde », « Solde d'ouverture », « Solde de clôture », « Total », les en-têtes de colonnes, les numéros de page (« Page sur … »), et tout le texte légal/footer (mentions « Revolut Bank UAB », garantie des dépôts, etc.).

EXEMPLE REVOLUT (lignes du relevé ⇒ JSON attendu). « Solde d'ouverture » = 60,00 CHF :
  « 2 mars 2026  BP  2,95 CHF  57,05 CHF / À : Bp Yverdon-les-bains, Yverdon-les-b »  (mouvement 2,95 ; solde 57,05 ; baisse ⇒ debit ; ville Yverdon-les-b)
  « 6 mars 2026  Recharge sur Apple Pay via *4828  650,00 CHF  707,05 CHF »  (mouvement 650,00 ; solde 707,05 ; hausse ⇒ credit ; pas de ville)
  « 11 mars 2026  OpenAI  20,83 CHF  540,04 CHF / Taux Revolut = 1,00 CHF = 1,10€ (taux ECB x 1,00 CHF = 1,11€) 23,00€ / À : Openai *chatgpt Subscr, Dublin »  (mouvement 20,83 CHF ; solde 540,04 ; devise étrangère 23,00€ au taux 1,10 ; ville Dublin)
  « 19 mars 2026  Shell  61,79 CHF  157,97 CHF / À : Shell Quai-perrier, Neuchatel »  (mouvement 61,79 ; solde 157,97 ; baisse ⇒ debit ; ville Neuchatel)
  « 20 mars 2026  TechSmith  De : Fs*techsmith  212,65 CHF  370,62 CHF »  (REMBOURSEMENT : « De : » et solde 157,97→370,62 qui MONTE ⇒ credit 212,65)
⇒ {"opening_balance":60.00,"transactions":[
  {"date":"2026-03-02","booking_date":null,"description":"BP","amount":2.95,"currency":"CHF","direction":"debit","balance":57.05,"reference":null,"counterparty_iban":null,"location":"Yverdon-les-b","original_amount":null,"original_currency":null,"exchange_rate":null},
  {"date":"2026-03-06","booking_date":null,"description":"Recharge sur Apple Pay via *4828","amount":650.00,"currency":"CHF","direction":"credit","balance":707.05,"reference":null,"counterparty_iban":null,"location":null,"original_amount":null,"original_currency":null,"exchange_rate":null},
  {"date":"2026-03-11","booking_date":null,"description":"OpenAI","amount":20.83,"currency":"CHF","direction":"debit","balance":540.04,"reference":null,"counterparty_iban":null,"location":"Dublin","original_amount":23.00,"original_currency":"EUR","exchange_rate":1.10},
  {"date":"2026-03-19","booking_date":null,"description":"Shell","amount":61.79,"currency":"CHF","direction":"debit","balance":157.97,"reference":null,"counterparty_iban":null,"location":"Neuchatel","original_amount":null,"original_currency":null,"exchange_rate":null},
  {"date":"2026-03-20","booking_date":null,"description":"TechSmith","amount":212.65,"currency":"CHF","direction":"credit","balance":370.62,"reference":null,"counterparty_iban":null,"location":null,"original_amount":null,"original_currency":null,"exchange_rate":null}
]}
Remarque : 57,05 / 707,05 / 540,04 / 157,97 / 370,62 vont dans `balance` (jamais dans `amount`) ; 23,00€ va dans `original_amount` (jamais dans `amount`). Le même marchand peut être un débit (achat, « À : ») un jour et un crédit (remboursement, « De : ») un autre — fie-toi au solde.
"#;

const N26_HINT: &str = r#"
PROFIL BANQUE : N26
- Relevé N26 (banque mobile, souvent en EUR). La devise figure à côté de chaque montant ; utilise-la pour `currency`.
- Les débits (paiements/retraits) sont négatifs, les crédits (entrées) positifs : déduis `direction` du signe et mets toujours `amount` positif.
- IGNORER les lignes de solde (« Solde », « Balance ») et les en-têtes/pieds de page.
"#;

const WISE_HINT: &str = r#"
PROFIL BANQUE : WISE
- Relevé Wise (multi-devises). Chaque transaction porte sa propre devise ; utilise-la pour `currency`, ne suppose pas CHF.
- Les frais Wise (« Fee », « Frais ») sont des lignes distinctes : ne les fusionne pas avec le montant principal sauf indication contraire.
- IGNORER les lignes de solde et les conversions de change qui ne sont pas des transactions réelles.
"#;

/// Liste exhaustive des profils bancaires connus. Ajoute une entrée ici pour
/// supporter une nouvelle banque (voir le commentaire « COMMENT AJOUTER UNE
/// BANQUE » plus haut). Le profil générique n'est PAS dans cette liste : il
/// sert de repli quand aucune entrée ne correspond.
const BANK_PROFILES: &[BankProfile] = &[
    BankProfile {
        id: "revolut",
        display_name: "Revolut",
        detect_keywords: &["revolut", "revolut bank uab", "revolt21"],
        prompt_hint: REVOLUT_HINT,
    },
    BankProfile {
        id: "n26",
        display_name: "N26",
        detect_keywords: &["n26", "ntsbdeb1"],
        prompt_hint: N26_HINT,
    },
    BankProfile {
        id: "wise",
        display_name: "Wise",
        detect_keywords: &["wise", "transferwise"],
        prompt_hint: WISE_HINT,
    },
];

/// Résout le profil bancaire à utiliser.
///
/// Priorité :
///   1. `bank` explicite (depuis `bank_name` côté JS) : match sur l'`id` ou le
///      `display_name`, insensible à la casse, avec correspondance « contient »
///      dans les deux sens (ex. "Compte Revolut" ⇒ profil "revolut").
///   2. Auto-détection : on scanne le texte du relevé (en minuscules) à la
///      recherche d'un `detect_keywords` de n'importe quel profil.
///   3. Repli sur le profil générique.
fn resolve_bank_profile(bank: &Option<String>, text: &str) -> &'static BankProfile {
    if let Some(name) = bank {
        let needle = name.trim().to_lowercase();
        if !needle.is_empty() {
            for p in BANK_PROFILES {
                let id = p.id.to_lowercase();
                let display = p.display_name.to_lowercase();
                if needle == id
                    || needle == display
                    || needle.contains(&id)
                    || id.contains(&needle)
                    || needle.contains(&display)
                    || display.contains(&needle)
                {
                    return p;
                }
            }
        }
    }

    let haystack = text.to_lowercase();
    for p in BANK_PROFILES {
        if p.detect_keywords.iter().any(|kw| haystack.contains(kw)) {
            return p;
        }
    }

    &GENERIC_PROFILE
}

#[derive(Debug, Serialize)]
pub struct ExtractedTransaction {
    pub date: String,
    pub booking_date: Option<String>,
    pub description: String,
    pub amount: f64,
    pub currency: String,
    pub direction: String,
    pub reference: Option<String>,
    pub counterparty_iban: Option<String>,
    /// Ville / lieu de la transaction (relevés Revolut : ligne « À : … »).
    pub location: Option<String>,
    /// Paiement en devise étrangère : montant d'origine, devise d'origine, et
    /// taux appliqué (1 [devise compte] = N [devise origine]).
    pub original_amount: Option<f64>,
    pub original_currency: Option<String>,
    pub exchange_rate: Option<f64>,
}

/// Schéma JSON strict pour structured outputs — interdit physiquement au
/// modèle d'émettre autre chose que cette forme (clé racine "transactions",
/// item shape précis, additionalProperties: false). C'est plus solide qu'un
/// json_object basique : avec un petit modèle (≤ 8B) qui aurait tendance à
/// inventer un nom de clé ou à renvoyer le schéma plutôt que les données,
/// le décodage contraint le force à respecter la forme.
fn bank_statement_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            // `opening_balance` : solde AVANT la première transaction (depuis le
            // « Résumé du solde » → « Solde d'ouverture »). null si absent. Sert
            // à dériver la direction de la 1re transaction par variation de solde.
            "opening_balance": {"type": ["number", "null"]},
            "transactions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "date": {"type": "string"},
                        "booking_date": {"type": ["string", "null"]},
                        "description": {"type": "string"},
                        "amount": {"type": "number"},
                        "currency": {"type": "string"},
                        "direction": {"type": "string", "enum": ["debit", "credit"]},
                        // `balance` : solde courant APRÈS la transaction (dernier
                        // montant de la ligne). null si la mise en page n'a pas de
                        // colonne solde. Quand il est présent et cohérent, le code
                        // recalcule amount+direction par delta de solde (déterministe).
                        "balance": {"type": ["number", "null"]},
                        "reference": {"type": ["string", "null"]},
                        "counterparty_iban": {"type": ["string", "null"]},
                        // Enrichissement (profils type Revolut). null si absent.
                        // `location` : ville/lieu de l'opération.
                        // `original_amount`/`original_currency` : montant et devise
                        // d'origine d'un paiement à l'étranger.
                        // `exchange_rate` : taux 1 [devise compte] = N [devise origine].
                        "location": {"type": ["string", "null"]},
                        "original_amount": {"type": ["number", "null"]},
                        "original_currency": {"type": ["string", "null"]},
                        "exchange_rate": {"type": ["number", "null"]}
                    },
                    "required": [
                        "date", "booking_date", "description", "amount",
                        "currency", "direction", "balance", "reference",
                        "counterparty_iban", "location", "original_amount",
                        "original_currency", "exchange_rate"
                    ],
                    "additionalProperties": false
                }
            }
        },
        "required": ["opening_balance", "transactions"],
        "additionalProperties": false
    })
}

#[tauri::command]
pub async fn ai_extract_bank_statement(
    text: String,
    config: AiConfig,
    bank: Option<String>,
) -> Result<Vec<ExtractedTransaction>, String> {
    // Choisit le profil banque (override `bank` explicite, sinon auto-détection
    // depuis le texte, sinon générique) et injecte son indication dans le prompt.
    let profile = resolve_bank_profile(&bank, &text);
    let bank_hint = if profile.prompt_hint.trim().is_empty() {
        String::from("\nPROFIL BANQUE : inconnu — déduis la mise en page à partir du texte.\n")
    } else {
        profile.prompt_hint.to_string()
    };
    let prompt = BANK_EXTRACTION_PROMPT
        .replace("{BANK_HINT}", &bank_hint)
        .replace("{TEXT}", &text);
    let schema = bank_statement_schema();
    let raw = call_provider(&config, BANK_SYSTEM_PROMPT, &prompt, Some(&schema)).await?;
    let cleaned = strip_code_fences(&raw);
    let value: Value = serde_json::from_str(&cleaned).map_err(|e| {
        // Tronque l'aperçu pour rester lisible si le modèle a généré
        // plusieurs milliers de caractères (cas de boucle infinie).
        let preview: String = raw.chars().take(300).collect();
        let suffix = if raw.chars().count() > 300 { "…" } else { "" };
        format!(
            "Le modèle n'a pas renvoyé de JSON valide ({}). Ton modèle est probablement trop petit ou mal configuré — essaye un modèle plus grand (≥ 7B), ou bascule sur Infomaniak/Mixtral. Début de réponse reçue : « {}{} »",
            e, preview, suffix
        )
    })?;

    // Le schéma demande "transactions" mais certains modèles inventent des
    // synonymes : on accepte ces fallbacks pour ne pas perdre une extraction
    // qui serait par ailleurs correcte. Ordre par décroissance de confiance.
    let arr = value
        .get("transactions")
        .or_else(|| value.get("Transactions"))
        .or_else(|| value.get("operations"))
        .or_else(|| value.get("Opérations"))
        .or_else(|| value.get("lines"))
        .or_else(|| value.get("entries"))
        // Dernier recours : si la valeur racine est elle-même un tableau,
        // l'utiliser directement.
        .or(if value.is_array() { Some(&value) } else { None })
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if arr.is_empty() {
        return Err(format!(
            "Le modèle n'a renvoyé aucune transaction. Vérifiez que la clé JSON racine est bien \"transactions\" — clés trouvées : {}",
            value.as_object()
                .map(|o| o.keys().cloned().collect::<Vec<_>>().join(", "))
                .unwrap_or_else(|| "(non-objet)".into())
        ));
    }

    let opening_balance = value.get("opening_balance").and_then(|v| v.as_f64());

    let mut out = Vec::with_capacity(arr.len());
    // Solde courant déclaré par le modèle pour chaque transaction (dernier
    // montant de la ligne). Parallèle à `out` ; sert à recalculer amount +
    // direction de façon déterministe (voir reconcile_with_balances).
    let mut balances: Vec<Option<f64>> = Vec::with_capacity(arr.len());
    for tx in arr {
        let date = tx.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let description = tx.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let amount = tx.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0).abs();
        let direction = tx
            .get("direction")
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_else(|| "debit".to_string());
        // Skip junk rows the model occasionally surfaces (empty date, empty
        // libellé, zero amount). Better to drop them than to litter the
        // review screen with phantom entries.
        if date.is_empty() || description.trim().is_empty() || amount <= 0.0 {
            continue;
        }
        balances.push(tx.get("balance").and_then(|v| v.as_f64()));
        out.push(ExtractedTransaction {
            date,
            booking_date: tx.get("booking_date").and_then(|v| v.as_str()).map(|s| s.to_string()),
            description,
            amount,
            currency: tx
                .get("currency")
                .and_then(|v| v.as_str())
                .unwrap_or("CHF")
                .to_string(),
            direction,
            reference: tx.get("reference").and_then(|v| v.as_str()).map(|s| s.to_string()),
            counterparty_iban: tx
                .get("counterparty_iban")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            location: tx
                .get("location")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            original_amount: tx.get("original_amount").and_then(|v| v.as_f64()).map(|v| v.abs()),
            original_currency: tx
                .get("original_currency")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_uppercase())
                .filter(|s| !s.is_empty()),
            exchange_rate: tx.get("exchange_rate").and_then(|v| v.as_f64()),
        });
    }

    // Correction déterministe par variation de solde (Revolut & toute banque
    // dont le modèle remonte la colonne solde). Le modèle n'a plus à DEVINER
    // débit/crédit (peu fiable quand la colonne vide a disparu du texte aplati) :
    // on le calcule à partir des soldes, qui eux sont sans ambiguïté.
    reconcile_with_balances(&mut out, &balances, opening_balance);

    Ok(out)
}

/// Recalcule `amount` et `direction` à partir des soldes courants, quand ils
/// sont disponibles. C'est la source de vérité la plus fiable : sur un relevé
/// au format « [mouvement] [solde] » (Revolut, etc.), le texte aplati perd la
/// colonne vide (Argent sortant OU Argent entrant), si bien que le modèle ne
/// peut pas distinguer un débit d'un crédit et confond parfois le solde avec le
/// montant. La variation de solde, elle, est sans ambiguïté :
///   solde_courant − solde_précédent = montant signé du mouvement.
///
/// Pour chaque transaction i (dans l'ordre du relevé) :
///   - solde précédent = solde[i-1], ou `opening_balance` pour la première ;
///   - signed = solde[i] − solde_précédent ;
///   - si |signed| > 0 : `amount` = |signed| (arrondi 2 déc.),
///     `direction` = "credit" si signed > 0 sinon "debit".
///
/// On ne touche RIEN si le solde de la ligne (ou le solde de référence) manque
/// — comportement générique (banques suisses) préservé : le modèle ne remplit
/// pas `balance`/`opening_balance` là-bas, donc `out` reste tel quel.
fn reconcile_with_balances(
    out: &mut [ExtractedTransaction],
    balances: &[Option<f64>],
    opening_balance: Option<f64>,
) {
    let mut prev_balance = opening_balance;
    for (i, tx) in out.iter_mut().enumerate() {
        let current = balances.get(i).copied().flatten();
        if let (Some(prev), Some(cur)) = (prev_balance, current) {
            let signed = cur - prev;
            // Arrondi au centime pour absorber les erreurs de virgule flottante.
            let amount = (signed.abs() * 100.0).round() / 100.0;
            if amount > 0.0 {
                tx.amount = amount;
                tx.direction = if signed > 0.0 { "credit" } else { "debit" }.to_string();
            }
        }
        // Avance le solde de référence dès qu'on a une valeur, même si on n'a
        // pas pu corriger cette ligne (ex. 1re ligne sans opening_balance).
        if current.is_some() {
            prev_balance = current;
        }
    }
}

#[tauri::command]
pub async fn ai_test_connection(config: AiConfig) -> Result<String, String> {
    let reply = call_provider(
        &config,
        "You are a connection test responder.",
        "Reply with the single word: OK",
        None,
    )
    .await?;
    Ok(reply)
}

async fn call_provider(
    config: &AiConfig,
    system_prompt: &str,
    user_prompt: &str,
    json_schema: Option<&Value>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Client init: {}", e))?;

    match config.provider {
        AiProvider::Infomaniak => call_infomaniak(&client, config, system_prompt, user_prompt, json_schema).await,
        AiProvider::Ollama => call_ollama(&client, config, system_prompt, user_prompt, json_schema).await,
    }
}

async fn call_infomaniak(
    client: &reqwest::Client,
    config: &AiConfig,
    system_prompt: &str,
    user_prompt: &str,
    json_schema: Option<&Value>,
) -> Result<String, String> {
    if config.api_key.trim().is_empty() {
        return Err("Clé API Infomaniak manquante".into());
    }
    if config.infomaniak_product_id.trim().is_empty() {
        return Err("Product ID Infomaniak manquant".into());
    }
    let url = format!(
        "https://api.infomaniak.com/2/ai/{}/openai/v1/chat/completions",
        config.infomaniak_product_id.trim()
    );
    // OpenAI structured outputs (json_schema + strict:true) contrainent la
    // décodage côté serveur — le modèle ne PEUT pas émettre de tokens hors
    // grammaire. C'est nettement plus solide qu'un json_object générique,
    // qui laisse encore au modèle la liberté d'inventer la forme de l'objet.
    // Si aucun schéma n'est fourni, on retombe sur json_object basique.
    let response_format = match json_schema {
        Some(schema) => json!({
            "type": "json_schema",
            "json_schema": {
                "name": "extraction",
                "strict": true,
                "schema": schema
            }
        }),
        None => json!({"type": "json_object"}),
    };
    let mut body = json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.0,
        "max_tokens": 8192,
        "response_format": response_format
    });

    let resp = client
        .post(&url)
        .bearer_auth(config.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let raw = e.to_string();
            if e.is_connect() {
                format!("Impossible de joindre api.infomaniak.com — vérifie ta connexion internet. Détail : {}", raw)
            } else if e.is_timeout() {
                format!("Infomaniak n'a pas répondu en 120 s. Détail : {}", raw)
            } else {
                format!("Requête Infomaniak : {}", raw)
            }
        })?;

    // Si le modèle ne supporte pas json_schema (modèles plus anciens),
    // Infomaniak renvoie un 400. On retombe alors automatiquement sur
    // json_object qui est universellement supporté — c'est mieux que de
    // jeter une erreur incompréhensible à l'utilisateur.
    let resp = if !resp.status().is_success() && json_schema.is_some() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status.as_u16() == 400 && text.contains("json_schema") {
            body["response_format"] = json!({"type": "json_object"});
            client
                .post(&url)
                .bearer_auth(config.api_key.trim())
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Requête Infomaniak (fallback json_object): {}", e))?
        } else {
            return Err(format!("Infomaniak {}: {}", status, text));
        }
    } else {
        resp
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Infomaniak {}: {}", status, text));
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON Infomaniak: {}", e))?;
    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Réponse Infomaniak inattendue: {}", json))
}

async fn call_ollama(
    client: &reqwest::Client,
    config: &AiConfig,
    system_prompt: &str,
    user_prompt: &str,
    json_schema: Option<&Value>,
) -> Result<String, String> {
    let base = if config.ollama_url.trim().is_empty() {
        "http://localhost:11434".to_string()
    } else {
        config.ollama_url.trim_end_matches('/').to_string()
    };
    let url = format!("{}/api/chat", base);
    // Ollama 0.5+ accepte un schéma JSON dans le champ `format` pour
    // contraindre la sortie (équivalent au json_schema d'OpenAI). Si pas
    // de schéma fourni, on garde la chaîne "json" qui force juste un JSON
    // bien formé sans contrainte de structure.
    let format_value = json_schema
        .cloned()
        .unwrap_or_else(|| Value::String("json".to_string()));
    let body = json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": false,
        "format": format_value,
        "options": {"temperature": 0.0, "num_predict": 8192}
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            // reqwest's send() error happens BEFORE the server sees the
            // request — connection refused / timed out / DNS failed. Turn
            // it into something actionable instead of the raw error.
            let raw = e.to_string();
            if e.is_connect() {
                format!(
                    "Impossible de joindre Ollama à {}. Vérifie qu'Ollama est bien lancé (commande `ollama serve` dans un terminal, ou ouvre l'app Ollama sur macOS). Détail : {}",
                    base, raw
                )
            } else if e.is_timeout() {
                format!(
                    "Ollama à {} n'a pas répondu en 120 s. Le modèle est peut-être trop gros pour ta machine, ou la première inférence est en train de charger le modèle en RAM — réessaie dans une minute. Détail : {}",
                    base, raw
                )
            } else {
                format!("Requête Ollama : {}", raw)
            }
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        // 404 sur /api/chat = modèle inconnu — message dédié plus utile.
        if status.as_u16() == 404 && text.contains("model") {
            return Err(format!(
                "Ollama ne connaît pas le modèle « {} ». Lance `ollama pull {}` dans un terminal pour le télécharger, ou choisis-en un autre dans Réglages → Général. Réponse brute : {}",
                config.model, config.model, text
            ));
        }
        return Err(format!("Ollama {}: {}", status, text));
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON Ollama: {}", e))?;
    json["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Réponse Ollama inattendue: {}", json))
}

fn strip_code_fences(s: &str) -> String {
    let trimmed = s.trim();
    if let Some(rest) = trimmed.strip_prefix("```json") {
        return rest.trim_end_matches("```").trim().to_string();
    }
    if let Some(rest) = trimmed.strip_prefix("```") {
        return rest.trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

fn parse_extracted(v: &Value) -> ExtractedReceipt {
    let items = v["items"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|it| {
                    let desc = it["description"].as_str()?.to_string();
                    let price = it["price"].as_f64()?;
                    let category = normalize_category(it["category"].as_str());
                    Some(ExtractedItem { description: desc, price, category })
                })
                .collect()
        })
        .unwrap_or_default();

    ExtractedReceipt {
        description: as_opt_string(&v["description"]),
        purchase_date: as_opt_string(&v["purchase_date"]),
        purchase_price: v["purchase_price"].as_f64(),
        currency: as_opt_string(&v["currency"]),
        merchant: as_opt_string(&v["merchant"]),
        invoice_number: as_opt_string(&v["invoice_number"]),
        product_reference: as_opt_string(&v["product_reference"]),
        quantity: as_opt_i64(&v["quantity"]),
        price_excl_tax: v["price_excl_tax"].as_f64(),
        tax_rate: v["tax_rate"].as_f64(),
        warranty_months: as_opt_i64(&v["warranty_months"]),
        warranty_start_date: as_opt_string(&v["warranty_start_date"]),
        notes: as_opt_string(&v["notes"]),
        items,
    }
}

fn as_opt_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

fn as_opt_i64(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))
}

/// Normalise la catégorie renvoyée par l'IA. Tout ce qui n'est pas dans la
/// liste blanche est rabattu sur "purchase" (comportement par défaut sûr —
/// l'item sera créé comme un achat normal).
fn normalize_category(raw: Option<&str>) -> String {
    match raw.map(|s| s.trim().to_lowercase()).as_deref() {
        Some("license") | Some("licence") | Some("subscription") | Some("abonnement") => "license".into(),
        Some("service") | Some("warranty") | Some("garantie") => "service".into(),
        Some("shipping") | Some("livraison") | Some("port") | Some("delivery") => "shipping".into(),
        Some("voucher") | Some("bon") | Some("coupon") | Some("discount") | Some("remise") | Some("rabais") => "voucher".into(),
        Some("other") | Some("autre") => "other".into(),
        _ => "purchase".into(),
    }
}

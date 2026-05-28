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

IGNORE absolument :
- En-têtes (nom titulaire, adresse, IBAN du compte, période, BIC, numéro de compte)
- « Etat de compte » initial (solde d'ouverture)
- « Solde au … », « Saldo … », « Balance forward »
- Totaux mensuels et totaux de page
- Lignes purement de mise en page (numéros de page, « Page 1 / 4 »)

EXEMPLE DE RÉPONSE VALIDE (basée sur un vrai PostFinance) :
{"transactions":[{"date":"2026-04-02","booking_date":"2026-04-01","description":"ACHAT/SHOPPING EN LIGNE DIGITEC GALAXUS ZÜRICH CARTE XXXX8750","amount":919.00,"currency":"CHF","direction":"debit","reference":null,"counterparty_iban":null},{"date":"2026-04-02","booking_date":"2026-04-01","description":"CRÉDIT POSTFINANCE CARD DIGITEC GALAXUS ZÜRICH","amount":91.00,"currency":"CHF","direction":"credit","reference":null,"counterparty_iban":null},{"date":"2026-04-08","booking_date":"2026-04-08","description":"DÉBIT SUNRISE GMBH POSTFACH 8050 ZURICH","amount":1.30,"currency":"CHF","direction":"debit","reference":null,"counterparty_iban":"CH6330000011875037700"}]}

Réponds maintenant pour le relevé ci-dessous. JSON UNIQUEMENT. N'invente RIEN.

TEXTE DU RELEVÉ (entre <<<>>>) :
<<<{TEXT}>>>"#;

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
                        "reference": {"type": ["string", "null"]},
                        "counterparty_iban": {"type": ["string", "null"]}
                    },
                    "required": [
                        "date", "booking_date", "description", "amount",
                        "currency", "direction", "reference", "counterparty_iban"
                    ],
                    "additionalProperties": false
                }
            }
        },
        "required": ["transactions"],
        "additionalProperties": false
    })
}

#[tauri::command]
pub async fn ai_extract_bank_statement(
    text: String,
    config: AiConfig,
) -> Result<Vec<ExtractedTransaction>, String> {
    let prompt = BANK_EXTRACTION_PROMPT.replace("{TEXT}", &text);
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

    let mut out = Vec::with_capacity(arr.len());
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
        });
    }

    Ok(out)
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

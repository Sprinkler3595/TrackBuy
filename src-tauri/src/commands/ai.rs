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
    let raw = call_provider(&config, SYSTEM_PROMPT, &prompt).await?;
    let cleaned = strip_code_fences(&raw);
    let value: Value = serde_json::from_str(&cleaned)
        .map_err(|e| format!("Réponse IA non-JSON: {} — contenu: {}", e, raw))?;
    Ok(parse_extracted(&value))
}

#[tauri::command]
pub async fn ai_test_connection(config: AiConfig) -> Result<String, String> {
    let reply = call_provider(
        &config,
        "You are a connection test responder.",
        "Reply with the single word: OK",
    )
    .await?;
    Ok(reply)
}

async fn call_provider(
    config: &AiConfig,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Client init: {}", e))?;

    match config.provider {
        AiProvider::Infomaniak => call_infomaniak(&client, config, system_prompt, user_prompt).await,
        AiProvider::Ollama => call_ollama(&client, config, system_prompt, user_prompt).await,
    }
}

async fn call_infomaniak(
    client: &reqwest::Client,
    config: &AiConfig,
    system_prompt: &str,
    user_prompt: &str,
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
    let body = json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.0
    });

    let resp = client
        .post(&url)
        .bearer_auth(config.api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Requête Infomaniak: {}", e))?;

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
) -> Result<String, String> {
    let base = if config.ollama_url.trim().is_empty() {
        "http://localhost:11434".to_string()
    } else {
        config.ollama_url.trim_end_matches('/').to_string()
    };
    let url = format!("{}/api/chat", base);
    let body = json!({
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": false,
        "format": "json",
        "options": {"temperature": 0.0}
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Requête Ollama: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
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

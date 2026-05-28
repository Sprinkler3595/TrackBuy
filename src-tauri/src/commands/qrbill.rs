//! Swiss QR-bill (SPC v0200) payload parser.
//!
//! Spec: SIX "Schweizer Implementation Guidelines QR-Rechnung" v2.x.
//! The QR-code on the bottom-right of a Swiss invoice encodes 30+ fields
//! separated by `\n`, in a fixed order. We don't render a QR-code here —
//! we accept the already-decoded payload string from a JS-side scanner
//! (camera) or PDF text extraction.
//!
//! Reference layout (positional, 1-indexed for readability):
//!    1  QRType            "SPC"
//!    2  Version           "0200"
//!    3  Coding            "1" (UTF-8)
//!    4  IBAN              CHxx / LIxx (21 chars)
//!    5  Creditor: addr type ("S" = structured, "K" = combined)
//!    6  Creditor: name
//!    7  Creditor: street / address line 1
//!    8  Creditor: house no / address line 2
//!    9  Creditor: postal code
//!    10 Creditor: city
//!    11 Creditor: country (2-letter ISO)
//!    12-18 Ultimate creditor (optional, often empty)
//!    19 Amount             (decimal, may be empty if no fixed amount)
//!    20 Currency           "CHF" or "EUR"
//!    21-27 Ultimate debtor (optional, the payer)
//!    28 Reference type     "QRR" | "SCOR" | "NON"
//!    29 Reference          27-digit QRR or RFxx SCOR
//!    30 Unstructured message
//!    31 Trailer            "EPD"
//!    32 Bill information   (S1/.../, optional)

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::auth::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QrBillCreditor {
    pub address_type: String,
    pub name: String,
    pub street_or_addr1: String,
    pub house_no_or_addr2: String,
    pub postal_code: String,
    pub city: String,
    pub country: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QrBillDecoded {
    pub iban: String,
    pub creditor: QrBillCreditor,
    pub amount: Option<f64>,
    pub currency: String,
    /// 'QRR' | 'SCOR' | 'NON'
    pub reference_type: String,
    pub reference: String,
    /// Free-text "communication" line printed under the amount.
    pub unstructured_message: String,
    pub bill_information: String,
    /// Suggested engagement id when we recognise the (IBAN, reference)
    /// pair against an existing creditor. NULL means the user should
    /// either pick a creditor or create one.
    pub suggested_creditor_id: Option<String>,
    pub suggested_engagement_id: Option<String>,
}

fn err(msg: &str) -> String {
    format!("Invalid Swiss QR-bill payload: {}", msg)
}

/// Parse a Swiss QR-bill text payload. The payload is the *decoded* QR-code
/// (a multi-line string), not raw image bytes — image scanning is done in
/// the frontend so the Rust side stays free of camera/wasm dependencies.
pub(crate) fn parse_qrbill_payload(payload: &str) -> Result<QrBillDecoded, String> {
    let lines: Vec<&str> = payload.split('\n').collect();

    if lines.len() < 28 {
        return Err(err("payload too short"));
    }
    if lines[0].trim() != "SPC" {
        return Err(err("missing SPC header"));
    }
    // Tolerate any 0xxx version — every Swiss bank emits 0200 or 0210.
    let version = lines[1].trim();
    if !version.starts_with('0') || version.len() != 4 {
        return Err(err("unexpected version"));
    }

    let iban = lines[3].trim().replace(' ', "").to_uppercase();
    if !(iban.starts_with("CH") || iban.starts_with("LI")) {
        return Err(err("IBAN must be Swiss (CH) or Liechtenstein (LI)"));
    }

    let creditor = QrBillCreditor {
        address_type: lines[4].trim().to_string(),
        name: lines[5].trim().to_string(),
        street_or_addr1: lines[6].trim().to_string(),
        house_no_or_addr2: lines[7].trim().to_string(),
        postal_code: lines[8].trim().to_string(),
        city: lines[9].trim().to_string(),
        country: lines[10].trim().to_uppercase(),
    };

    let amount = {
        let raw = lines[18].trim();
        if raw.is_empty() {
            None
        } else {
            Some(raw.parse::<f64>().map_err(|_| err("amount not a number"))?)
        }
    };
    let currency = lines[19].trim().to_uppercase();
    if currency != "CHF" && currency != "EUR" {
        return Err(err("currency must be CHF or EUR"));
    }

    let reference_type = lines[27].trim().to_uppercase();
    if !["QRR", "SCOR", "NON"].contains(&reference_type.as_str()) {
        return Err(err("invalid reference type"));
    }
    let reference = lines.get(28).map(|s| s.trim().to_string()).unwrap_or_default();
    let unstructured_message = lines.get(29).map(|s| s.trim().to_string()).unwrap_or_default();
    let _trailer = lines.get(30).map(|s| s.trim()).unwrap_or("EPD");
    let bill_information = lines.get(31).map(|s| s.trim().to_string()).unwrap_or_default();

    Ok(QrBillDecoded {
        iban,
        creditor,
        amount,
        currency,
        reference_type,
        reference,
        unstructured_message,
        bill_information,
        suggested_creditor_id: None,
        suggested_engagement_id: None,
    })
}

#[tauri::command]
pub fn decode_qrbill(
    state: State<'_, AppState>,
    payload: String,
) -> Result<QrBillDecoded, String> {
    let mut decoded = parse_qrbill_payload(&payload)?;

    let db_guard = state.db.lock().map_err(|_| "lock poisoned".to_string())?;
    let db = db_guard.as_ref().ok_or("Vault not unlocked")?;
    let conn = db.conn.lock().map_err(|_| "lock poisoned".to_string())?;

    // 1) Match by IBAN exact (best signal).
    let creditor_id: Option<String> = conn
        .query_row(
            "SELECT id FROM creditors WHERE REPLACE(iban, ' ', '') = ?1 LIMIT 1",
            [&decoded.iban],
            |row| row.get(0),
        )
        .ok();

    // 2) Match by reference prefix (utilities use a fixed prefix per client).
    let creditor_id = creditor_id.or_else(|| {
        if decoded.reference_type != "QRR" || decoded.reference.len() < 6 {
            return None;
        }
        let prefix = &decoded.reference[..6];
        conn.query_row(
            "SELECT id FROM creditors
             WHERE reference_prefix IS NOT NULL
               AND REPLACE(reference_prefix, ' ', '') LIKE ?1 || '%'
             LIMIT 1",
            [prefix],
            |row| row.get::<_, String>(0),
        )
        .ok()
    });

    // 3) Fuzzy fallback by name (case insensitive, prefix match).
    let creditor_id = creditor_id.or_else(|| {
        if decoded.creditor.name.is_empty() {
            return None;
        }
        conn.query_row(
            "SELECT id FROM creditors WHERE LOWER(name) = LOWER(?1) LIMIT 1",
            [&decoded.creditor.name],
            |row| row.get::<_, String>(0),
        )
        .ok()
    });

    decoded.suggested_creditor_id = creditor_id.clone();

    if let Some(cid) = creditor_id {
        decoded.suggested_engagement_id = conn
            .query_row(
                "SELECT id FROM engagements
                 WHERE creditor_id = ?1 AND status = 'active'
                 ORDER BY next_due_date ASC LIMIT 1",
                [&cid],
                |row| row.get(0),
            )
            .ok();
    }

    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_QRR: &str = "SPC\n0200\n1\nCH4431999123000889012\nS\nRobert Schneider AG\nRue du Lac\n1268\n2501\nBiel\nCH\n\n\n\n\n\n\n\n1949.75\nCHF\nS\nPia-Maria Rutschmann-Schnyder\nGrosse Marktgasse\n28\n9400\nRorschach\nCH\nQRR\n210000000003139471430009017\nFacture no 10201409\nEPD\n//S1/10/10201409/11/200512/20/1400.000-53/30/106017086";

    #[test]
    fn parses_swiss_qrr_sample() {
        let r = parse_qrbill_payload(SAMPLE_QRR).expect("parse");
        assert_eq!(r.iban, "CH4431999123000889012");
        assert_eq!(r.currency, "CHF");
        assert_eq!(r.amount, Some(1949.75));
        assert_eq!(r.reference_type, "QRR");
        assert!(r.reference.starts_with("210000000003139471430009017"));
        assert_eq!(r.creditor.city, "Biel");
    }

    #[test]
    fn rejects_non_chf_eur_currency() {
        let bad = SAMPLE_QRR.replace("CHF", "USD");
        assert!(parse_qrbill_payload(&bad).is_err());
    }

    #[test]
    fn rejects_non_ch_li_iban() {
        let bad = SAMPLE_QRR.replace("CH4431999123000889012", "FR1420041010050500013M02606");
        assert!(parse_qrbill_payload(&bad).is_err());
    }

    #[test]
    fn rejects_too_short_payload() {
        assert!(parse_qrbill_payload("SPC\n0200\n1\n").is_err());
    }
}

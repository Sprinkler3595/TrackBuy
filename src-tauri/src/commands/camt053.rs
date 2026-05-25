//! ISO 20022 camt.053 bank statement parser.
//!
//! Every Swiss e-banking (UBS, PostFinance, Raiffeisen, ZKB, BCV, …) lets the
//! customer download monthly statements in camt.053 XML format. That XML is
//! fully structured: no OCR, no LLM, no hallucinations. Always prefer this
//! path over the PDF + IA pipeline.
//!
//! Layout — we only read what we need (Entry-level data + reference):
//!
//! <Document>
//!   <BkToCstmrStmt>
//!     <Stmt>
//!       <Acct><Id><IBAN>CH...</IBAN></Id><Ccy>CHF</Ccy></Acct>
//!       <Ntry>
//!         <Amt Ccy="CHF">123.45</Amt>
//!         <CdtDbtInd>DBIT|CRDT</CdtDbtInd>
//!         <BookgDt><Dt>2025-05-12</Dt></BookgDt>
//!         <ValDt><Dt>2025-05-12</Dt></ValDt>
//!         <NtryDtls><TxDtls>
//!           <RmtInf><Strd><CdtrRefInf><Ref>QRR/SCOR</Ref></CdtrRefInf></Strd>
//!                   <Ustrd>Free text</Ustrd></RmtInf>
//!           <RltdPties><Cdtr><Nm>...</Nm></Cdtr>
//!                      <CdtrAcct><Id><IBAN>...</IBAN></Id></CdtrAcct></RltdPties>
//!         </TxDtls></NtryDtls>
//!       </Ntry>
//!       ...
//!     </Stmt>
//!   </BkToCstmrStmt>
//! </Document>

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct CamtTransaction {
    pub booking_date: Option<String>,
    pub value_date: Option<String>,
    pub amount: f64,
    pub currency: String,
    /// 'debit' | 'credit'
    pub direction: String,
    pub description: String,
    /// QRR (27 digits) or SCOR (RF + check + ref) if present.
    pub reference: Option<String>,
    /// IBAN of the counterparty (creditor for debits, debtor for credits).
    pub counterparty_iban: Option<String>,
    pub counterparty_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CamtStatement {
    pub account_iban: Option<String>,
    pub account_currency: Option<String>,
    pub transactions: Vec<CamtTransaction>,
}

/// Parse a camt.053 XML document. The implementation walks events linearly
/// and uses a small path-stack so we don't allocate a DOM. Order-sensitive
/// inside `<Ntry>`: we commit the running transaction on every `</Ntry>`.
pub(crate) fn parse_camt053(xml: &str) -> Result<CamtStatement, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut path: Vec<String> = Vec::new();

    let mut account_iban: Option<String> = None;
    let mut account_currency: Option<String> = None;
    let mut transactions: Vec<CamtTransaction> = Vec::new();

    let mut cur: Option<CamtTransaction> = None;
    let mut cur_amount_currency: Option<String> = None;
    let mut ustrd_parts: Vec<String> = Vec::new();
    let mut in_creditor = false;
    let mut in_debtor = false;
    let mut in_creditor_acct = false;
    let mut in_debtor_acct = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Err(e) => return Err(format!("camt.053 parse error at {}: {}", reader.buffer_position(), e)),
            Ok(Event::Eof) => break,
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                path.push(name.clone());
                match name.as_str() {
                    "Ntry" => {
                        cur = Some(CamtTransaction {
                            booking_date: None,
                            value_date: None,
                            amount: 0.0,
                            currency: "CHF".to_string(),
                            direction: "debit".to_string(),
                            description: String::new(),
                            reference: None,
                            counterparty_iban: None,
                            counterparty_name: None,
                        });
                        ustrd_parts.clear();
                    }
                    "Amt" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.local_name().as_ref() == b"Ccy" {
                                cur_amount_currency =
                                    Some(String::from_utf8_lossy(&attr.value).into_owned());
                            }
                        }
                    }
                    "Cdtr" => in_creditor = true,
                    "Dbtr" => in_debtor = true,
                    "CdtrAcct" => in_creditor_acct = true,
                    "DbtrAcct" => in_debtor_acct = true,
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.local_name().as_ref()).into_owned();
                match name.as_str() {
                    "Ntry" => {
                        if let Some(mut t) = cur.take() {
                            if t.description.is_empty() && !ustrd_parts.is_empty() {
                                t.description = ustrd_parts.join(" ").trim().to_string();
                            }
                            if t.counterparty_name.is_none()
                                && !ustrd_parts.is_empty()
                                && t.description.len() < 40
                            {
                                // Fall back to free text — most useful for cash
                                // withdrawals that have no creditor block.
                            }
                            transactions.push(t);
                        }
                    }
                    "Cdtr" => in_creditor = false,
                    "Dbtr" => in_debtor = false,
                    "CdtrAcct" => in_creditor_acct = false,
                    "DbtrAcct" => in_debtor_acct = false,
                    _ => {}
                }
                path.pop();
            }
            Ok(Event::Text(t)) => {
                let txt = t.unescape().unwrap_or_default().into_owned();
                if txt.is_empty() {
                    buf.clear();
                    continue;
                }
                if let Some(tag) = path.last().cloned() {
                    match tag.as_str() {
                        "IBAN" => {
                            if cur.is_none() {
                                // Top-level account IBAN (inside <Acct><Id>).
                                if account_iban.is_none() {
                                    account_iban = Some(txt.clone());
                                }
                            } else if in_creditor_acct {
                                if let Some(c) = cur.as_mut() {
                                    if c.direction == "debit" {
                                        c.counterparty_iban = Some(txt.clone());
                                    }
                                }
                            } else if in_debtor_acct {
                                if let Some(c) = cur.as_mut() {
                                    if c.direction == "credit" {
                                        c.counterparty_iban = Some(txt.clone());
                                    }
                                }
                            }
                        }
                        "Ccy" => {
                            if cur.is_none() && account_currency.is_none() {
                                account_currency = Some(txt.clone());
                            }
                        }
                        "Amt" => {
                            if let Some(c) = cur.as_mut() {
                                if let Ok(v) = txt.parse::<f64>() {
                                    c.amount = v;
                                }
                                if let Some(ccy) = cur_amount_currency.take() {
                                    c.currency = ccy;
                                }
                            }
                        }
                        "CdtDbtInd" => {
                            if let Some(c) = cur.as_mut() {
                                c.direction = if txt == "DBIT" { "debit" } else { "credit" }.to_string();
                            }
                        }
                        "Dt" => {
                            // Disambiguate BookgDt / ValDt via parent in path.
                            if let Some(c) = cur.as_mut() {
                                let parent = path.iter().rev().nth(1).cloned().unwrap_or_default();
                                if parent == "BookgDt" {
                                    c.booking_date = Some(txt.clone());
                                } else if parent == "ValDt" {
                                    c.value_date = Some(txt.clone());
                                }
                            }
                        }
                        "Ref" => {
                            if let Some(c) = cur.as_mut() {
                                c.reference = Some(txt.clone());
                            }
                        }
                        "Ustrd" => {
                            ustrd_parts.push(txt.clone());
                        }
                        "Nm" => {
                            if in_creditor {
                                if let Some(c) = cur.as_mut() {
                                    if c.direction == "debit" && c.counterparty_name.is_none() {
                                        c.counterparty_name = Some(txt.clone());
                                    }
                                }
                            } else if in_debtor {
                                if let Some(c) = cur.as_mut() {
                                    if c.direction == "credit" && c.counterparty_name.is_none() {
                                        c.counterparty_name = Some(txt.clone());
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(CamtStatement {
        account_iban,
        account_currency,
        transactions,
    })
}

#[tauri::command]
pub fn parse_camt053_text(xml: String) -> Result<CamtStatement, String> {
    parse_camt053(&xml)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">
  <BkToCstmrStmt>
    <Stmt>
      <Acct>
        <Id><IBAN>CH9300762011623852957</IBAN></Id>
        <Ccy>CHF</Ccy>
      </Acct>
      <Ntry>
        <Amt Ccy="CHF">450.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt><Dt>2025-05-10</Dt></BookgDt>
        <ValDt><Dt>2025-05-10</Dt></ValDt>
        <NtryDtls><TxDtls>
          <RmtInf>
            <Strd><CdtrRefInf><Ref>210000000003139471430009017</Ref></CdtrRefInf></Strd>
            <Ustrd>CSS Assurance prime mai</Ustrd>
          </RmtInf>
          <RltdPties>
            <Cdtr><Nm>CSS Assurance</Nm></Cdtr>
            <CdtrAcct><Id><IBAN>CH4431999123000889012</IBAN></Id></CdtrAcct>
          </RltdPties>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">7500.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt><Dt>2025-05-01</Dt></BookgDt>
        <NtryDtls><TxDtls>
          <RmtInf><Ustrd>Salaire mai</Ustrd></RmtInf>
          <RltdPties>
            <Dbtr><Nm>Mon Employeur SA</Nm></Dbtr>
          </RltdPties>
        </TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>"#;

    #[test]
    fn parses_account_iban() {
        let s = parse_camt053(SAMPLE).expect("parse");
        assert_eq!(s.account_iban.as_deref(), Some("CH9300762011623852957"));
        assert_eq!(s.account_currency.as_deref(), Some("CHF"));
    }

    #[test]
    fn parses_two_entries() {
        let s = parse_camt053(SAMPLE).expect("parse");
        assert_eq!(s.transactions.len(), 2);

        let css = &s.transactions[0];
        assert_eq!(css.direction, "debit");
        assert_eq!(css.amount, 450.0);
        assert_eq!(css.currency, "CHF");
        assert_eq!(css.booking_date.as_deref(), Some("2025-05-10"));
        assert_eq!(css.reference.as_deref(), Some("210000000003139471430009017"));
        assert_eq!(css.counterparty_name.as_deref(), Some("CSS Assurance"));
        assert_eq!(css.counterparty_iban.as_deref(), Some("CH4431999123000889012"));

        let salary = &s.transactions[1];
        assert_eq!(salary.direction, "credit");
        assert_eq!(salary.amount, 7500.0);
        assert_eq!(salary.counterparty_name.as_deref(), Some("Mon Employeur SA"));
    }
}

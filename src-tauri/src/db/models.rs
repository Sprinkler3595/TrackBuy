use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Item {
    pub id: String,
    pub description: String,
    pub purchase_date: String,
    pub purchase_price: f64,
    pub currency: String,
    pub status: String,
    pub merchant_id: String,
    pub location_id: String,
    pub payment_card_id: Option<String>,
    pub notes: Option<String>,
    pub invoice_number: Option<String>,
    pub product_reference: Option<String>,
    pub quantity: Option<i32>,
    pub price_excl_tax: Option<f64>,
    pub tax_rate: Option<f64>,
    pub order_id: Option<String>,
    // Digital items (tickets, vouchers, licenses). For physical items these
    // are all NULL and item_kind = "physical".
    pub item_kind: String,
    pub event_datetime: Option<String>,
    pub event_location: Option<String>,
    pub expiration_date: Option<String>,
    pub redemption_url: Option<String>,
    pub redeemed_at: Option<String>,
    /// Back-link to the bank line that paid this item, once the user has
    /// confirmed the match in the bank-statement review. NULL means the
    /// item has not been reconciled (or no statement was imported yet).
    pub bank_transaction_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    // Joined fields
    #[serde(skip_deserializing)]
    pub merchant_name: Option<String>,
    #[serde(skip_deserializing)]
    pub location_name: Option<String>,
    #[serde(skip_deserializing)]
    pub card_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Merchant {
    pub id: String,
    pub name: String,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub address: Option<String>,
    pub logo_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Location {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaymentCard {
    pub id: String,
    pub name: String,
    pub is_credit_card: bool,
    pub extended_warranty_months: i32,
    pub extended_warranty_description: Option<String>,
    /// 'card' | 'bank_account' | 'cash' | 'qr_bill' | 'other'.
    /// Lets a single table model both physical cards and bank accounts
    /// (used for LSV/SEPA/standing orders/QR-bills on engagements).
    pub account_kind: String,
    pub iban: Option<String>,
    pub bic: Option<String>,
    pub account_holder: Option<String>,
    pub institution: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Warranty {
    pub id: String,
    pub item_id: String,
    pub start_date: String,
    pub duration_months: i32,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    // Computed
    #[serde(skip_deserializing)]
    pub end_date: Option<String>,
    #[serde(skip_deserializing)]
    pub item_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Attachment {
    pub id: String,
    pub item_id: Option<String>,
    pub order_id: Option<String>,
    pub engagement_id: Option<String>,
    pub engagement_charge_id: Option<String>,
    pub engagement_revision_id: Option<String>,
    pub income_id: Option<String>,
    pub income_receipt_id: Option<String>,
    pub reimbursement_id: Option<String>,
    pub vehicle_expense_id: Option<String>,
    pub original_name: String,
    pub display_name: String,
    pub mime_type: String,
    pub file_path: String,
    pub size_bytes: i64,
    pub attachment_type: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingInvoice {
    pub id: String,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub original_name: String,
    pub mime_type: String,
    /// NULL when the row was created from an orphan bank transaction (no
    /// PDF/image yet — user will attach it later via the pending-invoices
    /// page). Populated for rows that came from a real file upload.
    pub file_path: Option<String>,
    pub size_bytes: i64,
    /// Set when the row was materialized from a bank-statement line that
    /// didn't match any item. Lets the UI show "facture à fournir pour
    /// cette transaction" and back-link to the originating statement.
    pub source_bank_tx_id: Option<String>,
    pub expected_amount: Option<f64>,
    pub expected_date: Option<String>,
    pub currency: Option<String>,
    /// Champs lus sur le ticket par l'OCR + extraction IA/regex. `expected_*`
    /// ci-dessus portent le montant/date/devise (clés de rapprochement) ; ces
    /// colonnes portent le reste. Voir migration v17.
    pub extracted_merchant: Option<String>,
    pub extracted_invoice_number: Option<String>,
    pub extracted_tax_rate: Option<f64>,
    pub extracted_price_excl_tax: Option<f64>,
    pub extracted_warranty_months: Option<i64>,
    /// NULL | 'pending' | 'extracted' | 'failed'
    pub extraction_status: Option<String>,
    pub extracted_at: Option<String>,
    /// `ExtractedReceipt` sérialisé (conserve les lignes multi-articles).
    pub extracted_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Payload de `set_pending_invoice_extraction` : résultat de la passe OCR +
/// extraction lancée au dépôt d'un ticket dans l'inbox.
#[derive(Debug, Serialize, Deserialize)]
pub struct PendingInvoiceExtraction {
    pub merchant: Option<String>,
    pub purchase_date: Option<String>,
    pub purchase_price: Option<f64>,
    pub currency: Option<String>,
    pub invoice_number: Option<String>,
    pub tax_rate: Option<f64>,
    pub price_excl_tax: Option<f64>,
    pub warranty_months: Option<i64>,
    pub extracted_json: Option<String>,
    /// 'extracted' | 'failed'
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilenameTemplate {
    pub attachment_type: String,
    pub template: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultInfo {
    pub name: String,
    pub path: String,
    pub is_active: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateItemRequest {
    pub description: String,
    pub purchase_date: String,
    pub purchase_price: f64,
    pub currency: Option<String>,
    pub status: Option<String>,
    pub merchant_id: String,
    pub location_id: String,
    pub payment_card_id: Option<String>,
    pub notes: Option<String>,
    pub invoice_number: Option<String>,
    pub product_reference: Option<String>,
    pub quantity: Option<i32>,
    pub price_excl_tax: Option<f64>,
    pub tax_rate: Option<f64>,
    pub order_id: Option<String>,
    // Digital items: caller can omit these (defaults to physical with all
    // optional fields NULL).
    pub item_kind: Option<String>,
    pub event_datetime: Option<String>,
    pub event_location: Option<String>,
    pub expiration_date: Option<String>,
    pub redemption_url: Option<String>,
    pub redeemed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Reminder {
    /// Source entity row id. Depends on `entity_type`:
    /// - 'item'         → items.id
    /// - 'engagement'   → engagements.id
    /// - 'charge'       → engagements.id (the parent of the scheduled
    ///                    charge, not the charge_id, so the dashboard can
    ///                    link to /engagements/:id without an extra hop)
    /// Kept as `item_id` for backward-compat with existing frontend code.
    pub item_id: String,
    pub entity_type: String,
    pub description: String,
    /// For items this is the item_kind ("ticket", "voucher", "license");
    /// for engagements/charges it carries the canonical engagement_type.
    pub item_kind: String,
    /// "event" | "expiration" | "due" | "charge_due" | "notice"
    pub reminder_type: String,
    pub target_date: String,
    pub days_until: i64,
    pub merchant_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OrderLineRequest {
    pub description: String,
    pub purchase_price: f64,
    pub quantity: Option<i32>,
    pub price_excl_tax: Option<f64>,
    pub tax_rate: Option<f64>,
    pub product_reference: Option<String>,
    pub notes: Option<String>,
    /// If provided, a warranty is auto-created for this line at the shared
    /// purchase_date with this duration in months.
    pub warranty_months: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateOrderRequest {
    pub purchase_date: String,
    pub currency: Option<String>,
    pub status: Option<String>,
    pub merchant_id: String,
    pub location_id: String,
    pub payment_card_id: Option<String>,
    pub invoice_number: Option<String>,
    pub notes: Option<String>,
    pub lines: Vec<OrderLineRequest>,
    /// Optional invoice file path (from a Tauri `open()` dialog). When set,
    /// it is encrypted and attached at the order level (visible from every
    /// line item).
    pub invoice_source_path: Option<String>,
    pub invoice_display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateOrderResult {
    pub order_id: String,
    pub items: Vec<Item>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateMerchantRequest {
    pub name: String,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateLocationRequest {
    pub name: String,
    pub icon: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateCardRequest {
    pub name: String,
    pub is_credit_card: bool,
    pub extended_warranty_months: Option<i32>,
    pub extended_warranty_description: Option<String>,
    pub account_kind: Option<String>,
    pub iban: Option<String>,
    pub bic: Option<String>,
    pub account_holder: Option<String>,
    pub institution: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWarrantyRequest {
    pub item_id: String,
    pub start_date: String,
    pub duration_months: i32,
    pub notes: Option<String>,
}

// =====================================================================
// Creditors & Engagements (recurring real-world charges)
// =====================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Creditor {
    pub id: String,
    pub name: String,
    /// 'insurer' | 'landlord' | 'utility' | 'telco' | 'tax_office'
    /// 'leasing_company' | 'employer' | 'bank' | 'other'
    pub creditor_type: String,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub address: Option<String>,
    pub iban: Option<String>,
    pub reference_prefix: Option<String>,
    pub notes: Option<String>,
    pub logo_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateCreditorRequest {
    pub name: String,
    pub creditor_type: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub address: Option<String>,
    pub iban: Option<String>,
    pub reference_prefix: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Engagement {
    pub id: String,
    pub name: String,
    /// One of the canonical engagement_type values (insurance_health, rent,
    /// electricity, tax_federal, …). See plan §3.1.d for the full list.
    pub engagement_type: String,
    pub parent_engagement_id: Option<String>,
    pub creditor_id: Option<String>,
    pub payment_card_id: Option<String>,
    pub contract_reference: Option<String>,
    pub contract_start_date: Option<String>,
    pub contract_end_date: Option<String>,
    pub notice_period_days: Option<i32>,
    /// 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'one_shot' | 'custom'
    pub billing_cycle: String,
    pub cycle_interval: i32,
    pub next_due_date: Option<String>,
    pub current_amount: Option<f64>,
    pub currency: String,
    /// 'direct_debit' | 'qr_bill' | 'bvr' | 'manual_transfer'
    /// 'standing_order' | 'cash' | 'card_auto' | 'other'
    pub payment_method: Option<String>,
    pub auto_pay: bool,
    /// 'active' | 'suspended' | 'ended'
    pub status: String,
    pub ended_on: Option<String>,
    pub notes: Option<String>,
    /// Free-form JSON for franchises, caps, options; not parsed by the
    /// backend.
    pub clauses_json: Option<String>,
    // Parking specifics (engagement_type='parking'); NULL otherwise. See v19.
    /// Spot label/number on the lease.
    pub parking_spot_number: Option<String>,
    /// 'outdoor' | 'collective_garage' | 'box'.
    pub parking_kind: Option<String>,
    // Vehicle leasing specifics (engagement_type='leasing'); NULL otherwise. v20.
    pub vehicle_make: Option<String>,
    pub vehicle_model: Option<String>,
    pub vehicle_plate: Option<String>,
    pub vehicle_vin: Option<String>,
    pub vehicle_first_registration: Option<String>,
    pub leasing_vehicle_price: Option<f64>,
    pub leasing_duration_months: Option<i32>,
    pub leasing_down_payment: Option<f64>,
    pub leasing_residual_value: Option<f64>,
    pub leasing_interest_rate_pct: Option<f64>,
    pub leasing_annual_mileage_km: Option<i32>,
    pub leasing_excess_km_cost: Option<f64>,
    /// Commercial discount / accepted offer, deducted from the down payment.
    pub leasing_discount: Option<f64>,
    // Car insurance specifics (engagement_type='insurance_car'); NULL otherwise. v22.
    /// 'rc' | 'partial_casco' | 'full_casco'.
    pub insurance_coverage: Option<String>,
    pub insurance_franchise_casco: Option<f64>,
    pub insurance_franchise_partial: Option<f64>,
    pub insurance_bonus_pct: Option<f64>,
    /// JSON array of extra-coverage slugs; stored opaque.
    pub insurance_options_json: Option<String>,
    /// JSON object with the per-coverage premium breakdown; stored opaque.
    pub insurance_premium_breakdown_json: Option<String>,
    // More vehicle/insurance details (v24).
    /// 'passenger_car' | 'motorcycle' | 'light_commercial' | 'motorhome' | 'other'.
    pub vehicle_category: Option<String>,
    /// Swiss registration number (n° de matricule / Stammnummer).
    pub vehicle_registration_number: Option<String>,
    /// The vehicle is leased (offer's "Leasing: Oui").
    pub vehicle_is_leasing: Option<bool>,
    /// Extra casco deductible applied to young drivers (CHF).
    pub insurance_young_driver_franchise: Option<f64>,
    pub created_at: String,
    pub updated_at: String,
    // Joined fields
    #[serde(skip_deserializing)]
    pub creditor_name: Option<String>,
    #[serde(skip_deserializing)]
    pub card_name: Option<String>,
    #[serde(skip_deserializing)]
    pub parent_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateEngagementRequest {
    pub name: String,
    pub engagement_type: String,
    pub parent_engagement_id: Option<String>,
    pub creditor_id: Option<String>,
    pub payment_card_id: Option<String>,
    pub contract_reference: Option<String>,
    pub contract_start_date: Option<String>,
    pub contract_end_date: Option<String>,
    pub notice_period_days: Option<i32>,
    pub billing_cycle: String,
    pub cycle_interval: Option<i32>,
    pub next_due_date: Option<String>,
    pub current_amount: Option<f64>,
    pub currency: Option<String>,
    pub payment_method: Option<String>,
    pub auto_pay: Option<bool>,
    pub status: Option<String>,
    pub notes: Option<String>,
    pub clauses_json: Option<String>,
    // Parking specifics (see Engagement). Optional on create/update.
    pub parking_spot_number: Option<String>,
    pub parking_kind: Option<String>,
    // Vehicle leasing specifics (see Engagement). Optional on create/update.
    pub vehicle_make: Option<String>,
    pub vehicle_model: Option<String>,
    pub vehicle_plate: Option<String>,
    pub vehicle_vin: Option<String>,
    pub vehicle_first_registration: Option<String>,
    pub leasing_vehicle_price: Option<f64>,
    pub leasing_duration_months: Option<i32>,
    pub leasing_down_payment: Option<f64>,
    pub leasing_residual_value: Option<f64>,
    pub leasing_interest_rate_pct: Option<f64>,
    pub leasing_annual_mileage_km: Option<i32>,
    pub leasing_excess_km_cost: Option<f64>,
    pub leasing_discount: Option<f64>,
    // Car insurance specifics (see Engagement). Optional on create/update.
    pub insurance_coverage: Option<String>,
    pub insurance_franchise_casco: Option<f64>,
    pub insurance_franchise_partial: Option<f64>,
    pub insurance_bonus_pct: Option<f64>,
    pub insurance_options_json: Option<String>,
    pub insurance_premium_breakdown_json: Option<String>,
    pub vehicle_category: Option<String>,
    pub vehicle_registration_number: Option<String>,
    pub vehicle_is_leasing: Option<bool>,
    pub insurance_young_driver_franchise: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EngagementCharge {
    pub id: String,
    pub engagement_id: String,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub due_date: String,
    pub amount: f64,
    pub currency: String,
    pub quantity: Option<f64>,
    pub unit: Option<String>,
    pub unit_price: Option<f64>,
    pub paid_on: Option<String>,
    /// 'scheduled' | 'paid' | 'late' | 'disputed' | 'waived'
    pub status: String,
    pub payment_card_id: Option<String>,
    pub reference_number: Option<String>,
    pub invoice_number: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// true = charge présumée générée par le roll-forward (auto_pay), en
    /// attente de confirmation : marquée 'paid' par commodité mais le débit
    /// n'est pas garanti tant que l'utilisateur ne l'a pas validée.
    #[serde(default)]
    pub is_presumed: bool,
    #[serde(skip_deserializing)]
    pub card_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateEngagementChargeRequest {
    pub engagement_id: String,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub due_date: String,
    pub amount: f64,
    pub currency: Option<String>,
    pub quantity: Option<f64>,
    pub unit: Option<String>,
    pub unit_price: Option<f64>,
    pub paid_on: Option<String>,
    pub status: Option<String>,
    pub payment_card_id: Option<String>,
    pub reference_number: Option<String>,
    pub invoice_number: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EngagementRevision {
    pub id: String,
    pub engagement_id: String,
    pub effective_date: String,
    pub amount: f64,
    pub currency: String,
    pub change_reason: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateEngagementRevisionRequest {
    pub engagement_id: String,
    pub effective_date: String,
    pub amount: f64,
    pub currency: Option<String>,
    pub change_reason: Option<String>,
    pub notes: Option<String>,
}

// =====================================================================
// Incomes (salaries, bonuses, allowances, dividends, …)
// =====================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Income {
    pub id: String,
    pub name: String,
    /// 'salary' | 'bonus' | 'thirteenth' | 'pension' | 'unemployment'
    /// 'family_allowance' | 'dividend' | 'rental' | 'gift' | 'reimbursement'
    /// 'other'
    pub income_type: String,
    pub source_name: Option<String>,
    pub payment_card_id: Option<String>,
    /// 'monthly' | 'quarterly' | 'yearly' | 'one_shot' | 'custom'
    pub billing_cycle: String,
    pub cycle_interval: i32,
    pub next_expected_date: Option<String>,
    pub current_amount: Option<f64>,
    pub currency: String,
    /// 'active' | 'ended'
    pub status: String,
    pub started_on: Option<String>,
    pub ended_on: Option<String>,
    /// Membre du ménage auquel le revenu est rattaché. NULL = le ménage.
    /// Aucune UI ne l'expose encore : la colonne existe pour qu'un second
    /// salaire puisse entrer sans migration cassante.
    pub attributed_to_member_id: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_deserializing)]
    pub card_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateIncomeRequest {
    pub name: String,
    pub income_type: String,
    pub source_name: Option<String>,
    pub payment_card_id: Option<String>,
    pub billing_cycle: String,
    pub cycle_interval: Option<i32>,
    pub next_expected_date: Option<String>,
    pub current_amount: Option<f64>,
    pub currency: Option<String>,
    pub status: Option<String>,
    pub started_on: Option<String>,
    /// Renseigné quand on saisit un emploi déjà terminé : c'est ce qui permet
    /// de reprendre une carrière employeur par employeur.
    pub ended_on: Option<String>,
    pub attributed_to_member_id: Option<String>,
    pub notes: Option<String>,
}

/// Un versement reçu. Pour un salaire, c'est un bulletin de paie complet ;
/// pour une allocation ou un dividende, seuls `amount` et la date comptent et
/// tout le détail reste `None`.
///
/// Deux distinctions du droit suisse justifient des champs séparés plutôt
/// qu'un fourre-tout : les allocations familiales transitent par le bulletin
/// sans être du salaire déterminant AVS (art. 6 RAVS), et les frais remboursés
/// ne sont ni du salaire ni du revenu imposable (art. 327a CO). Les agréger au
/// brut fausserait toutes les cotisations.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct IncomeReceipt {
    pub id: String,
    pub income_id: String,
    pub received_on: String,
    /// Net amount that actually landed in the account.
    pub amount: f64,
    pub currency: String,
    pub period_label: Option<String>,
    /// Période couverte par le bulletin, et année fiscale de rattachement —
    /// qui peut différer de l'année de `received_on` (salaire de décembre
    /// versé en janvier).
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub fiscal_year: Option<i32>,

    // --- composantes du brut ---
    /// Brut total tel qu'imprimé sur le bulletin. Fait foi quand il est
    /// renseigné ; sinon le brut est reconstitué depuis les composantes.
    pub gross_amount: Option<f64>,
    pub base_salary_amount: Option<f64>,
    pub thirteenth_amount: Option<f64>,
    pub overtime_amount: Option<f64>,
    pub overtime_hours: Option<f64>,
    pub holiday_pay_amount: Option<f64>,
    pub bonus_amount: Option<f64>,
    pub benefits_in_kind_amount: Option<f64>,
    /// Part privée d'un véhicule d'entreprise (ch. 2.2 du certificat).
    pub company_car_private_amount: Option<f64>,
    /// Allocations familiales : versées avec le salaire, non soumises AVS.
    pub family_allowance_amount: Option<f64>,
    pub other_gross_amount: Option<f64>,

    // --- retenues ---
    /// AVS / AI / APG. Nom hérité de la v10, conservé pour ne pas casser les
    /// coffres existants ni l'export CSV.
    pub social_charges_amount: Option<f64>,
    pub ac_amount: Option<f64>,
    pub ac_solidarity_amount: Option<f64>,
    /// 2ᵉ pilier (LPP).
    pub pension_amount: Option<f64>,
    pub laa_nonoccupational_amount: Option<f64>,
    pub ijm_amount: Option<f64>,
    pub tax_at_source_amount: Option<f64>,
    pub other_deductions_amount: Option<f64>,

    // --- frais (art. 327a CO), ch. 13 du certificat ---
    pub expense_reimbursement_amount: Option<f64>,
    pub expense_lump_sum_amount: Option<f64>,

    /// Ce qui s'ajoute au net APRÈS les retenues, sans être un remboursement
    /// de frais. Hors assiette AVS : le mettre dans une colonne de brut
    /// ferait réclamer des cotisations que l'employeur a eu raison de ne pas
    /// prélever.
    pub net_addition_amount: Option<f64>,

    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CreateIncomeReceiptRequest {
    pub income_id: String,
    pub received_on: String,
    pub amount: f64,
    pub currency: Option<String>,
    pub period_label: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub fiscal_year: Option<i32>,
    pub gross_amount: Option<f64>,
    pub base_salary_amount: Option<f64>,
    pub thirteenth_amount: Option<f64>,
    pub overtime_amount: Option<f64>,
    pub overtime_hours: Option<f64>,
    pub holiday_pay_amount: Option<f64>,
    pub bonus_amount: Option<f64>,
    pub benefits_in_kind_amount: Option<f64>,
    pub company_car_private_amount: Option<f64>,
    pub family_allowance_amount: Option<f64>,
    pub other_gross_amount: Option<f64>,
    pub social_charges_amount: Option<f64>,
    pub ac_amount: Option<f64>,
    pub ac_solidarity_amount: Option<f64>,
    pub pension_amount: Option<f64>,
    pub laa_nonoccupational_amount: Option<f64>,
    pub ijm_amount: Option<f64>,
    pub tax_at_source_amount: Option<f64>,
    pub other_deductions_amount: Option<f64>,
    pub expense_reimbursement_amount: Option<f64>,
    pub expense_lump_sum_amount: Option<f64>,
    pub net_addition_amount: Option<f64>,
    pub notes: Option<String>,
}

/// Les termes de l'emploi, saisis une fois par employeur.
///
/// `lpp_employee_share_pct`, `laa_nonoccupational_pct` et `ijm_employee_pct`
/// sont contractuels : aucun barème ne permet de les déduire. Sans eux, le
/// moteur de contrôle annonce qu'il ne peut pas vérifier la retenue
/// correspondante — il n'invente pas de montant.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct EmploymentContract {
    pub id: String,
    pub income_id: String,
    /// Ce qui distingue cette version des autres à l'écran : « Contrat
    /// initial », « Avenant 2021 — augmentation ».
    pub label: Option<String>,
    pub employer_name: Option<String>,
    /// IDE de l'employeur, format CHE-123.456.789.
    pub employer_uid: Option<String>,
    /// N° AVS du salarié, format 756.xxxx.xxxx.xx.
    pub avs_number: Option<String>,
    /// Sert uniquement à déterminer la tranche de bonification LPP.
    pub birth_date: Option<String>,
    /// Siège de l'employeur : retenues sociales cantonales et caisse
    /// d'allocations familiales.
    pub work_canton: Option<String>,
    /// Domicile du salarié : barème d'impôt à la source, qui suit le domicile
    /// et non le lieu de travail (art. 38 al. 4 let. a LHID).
    pub residence_canton: Option<String>,
    /// `residence` ou `work` — certains employeurs retiennent selon le canton
    /// de leur siège puis reversent. Seule la fiche de salaire tranche.
    pub tax_at_source_canton_source: String,
    pub activity_rate_pct: Option<f64>,
    pub annual_gross_agreed: Option<f64>,
    /// 12 ou 13 selon que le 13ᵉ salaire est versé séparément.
    pub salary_periods_per_year: Option<i32>,
    pub weekly_hours: Option<f64>,
    pub hourly_paid: bool,
    pub thirteenth_salary: bool,
    pub lpp_fund_name: Option<String>,
    pub lpp_employee_share_pct: Option<f64>,
    /// `total` = le brut entier est assuré, suppléments compris ; `base` = seul
    /// le salaire contractuel l'est. La réponse tient au règlement de la caisse
    /// de pension : elle ne se devine pas, elle se lit.
    pub lpp_insured_scope: String,
    /// La caisse réduit-elle la déduction de coordination au taux
    /// d'occupation ? La loi ne l'impose pas, beaucoup de caisses le
    /// pratiquent, et le règlement du plan le dit noir sur blanc.
    #[serde(default)]
    pub lpp_coordination_part_time: bool,
    pub laa_insurer: Option<String>,
    pub laa_nonoccupational_pct: Option<f64>,
    pub ijm_employee_pct: Option<f64>,
    pub tax_at_source: bool,
    pub tax_at_source_scale: Option<String>,
    /// Taux effectif d'impôt à la source, lu sur la fiche de salaire.
    /// Repli utilisé tant qu'aucun barème cantonal n'est importé.
    pub tax_at_source_rate_pct: Option<f64>,
    /// Prix d'achat HT du véhicule d'entreprise, pour la part privée.
    pub company_car_purchase_price: Option<f64>,
    pub subsidized_canteen: bool,
    pub commute_km_per_day: Option<f64>,
    pub commute_public_transport_cost_year: Option<f64>,
    pub started_on: Option<String>,
    pub ended_on: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Certificat de salaire annuel, rubrique par rubrique (formulaire 11).
/// L'employeur doit l'établir même sans demande du salarié (art. 127 LIFD).
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SalaryCertificate {
    pub id: String,
    pub income_id: String,
    pub fiscal_year: i32,
    /// 1. Salaire brut / rente
    pub r1_salary: Option<f64>,
    /// 2.1 Prestations en nature (repas, logement)
    pub r2_1_benefits_in_kind: Option<f64>,
    /// 2.2 Part privée du véhicule de service
    pub r2_2_company_car: Option<f64>,
    /// 2.3 Autres prestations salariales accessoires
    pub r2_3_other_benefits: Option<f64>,
    /// 3. Prestations non périodiques
    pub r3_irregular: Option<f64>,
    /// 4. Participations de collaborateur
    pub r4_capital_shares: Option<f64>,
    /// 5. Indemnités des membres de l'administration
    pub r5_board_fees: Option<f64>,
    /// 6. Autres prestations
    pub r6_other_benefits: Option<f64>,
    /// 7. Prestations en capital
    pub r7_other_payments: Option<f64>,
    /// 8. Salaire brut total
    pub r8_gross_total: Option<f64>,
    /// 9. Cotisations AVS/AI/APG/AC/AANP
    pub r9_social_contributions: Option<f64>,
    /// 10.1 Cotisations LPP ordinaires
    pub r10_1_lpp_ordinary: Option<f64>,
    /// 10.2 Cotisations LPP, rachats
    pub r10_2_lpp_buyback: Option<f64>,
    /// 11. Salaire net — c'est ce montant qui part dans la déclaration
    pub r11_net_salary: Option<f64>,
    /// 12. Impôt à la source retenu
    pub r12_tax_at_source: Option<f64>,
    /// 13.1 Frais effectifs
    pub r13_1_effective_expenses: Option<f64>,
    /// 13.2 Frais forfaitaires
    pub r13_2_lump_sum_expenses: Option<f64>,
    /// 14. Autres prestations de l'employeur
    pub r14_other_disclosures: Option<f64>,
    /// 15. Observations
    pub r15_remarks: Option<String>,
    /// Case F : transport domicile-travail payé par l'employeur.
    pub box_f_employer_transport: bool,
    /// Case G : repas gratuits (réduit le forfait repas déductible).
    pub box_g_free_meals: bool,
    pub received_on: Option<String>,
    /// 'manual' | 'ai_scan' — d'où viennent les montants.
    pub origin: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// =====================================================================
// Pending reimbursements (money to recover)
// =====================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingReimbursement {
    pub id: String,
    pub label: String,
    /// 'expense_report' | 'insurance_claim' | 'warranty_return'
    /// 'product_return' | 'deposit' | 'tax_refund' | 'other'
    pub reimbursement_type: String,
    pub expected_amount: Option<f64>,
    pub received_amount: Option<f64>,
    pub currency: String,
    pub debtor_name: Option<String>,
    pub debtor_creditor_id: Option<String>,
    pub item_id: Option<String>,
    pub engagement_charge_id: Option<String>,
    pub source_description: Option<String>,
    pub requested_on: Option<String>,
    pub expected_by: Option<String>,
    pub received_on: Option<String>,
    /// 'pending' | 'claimed' | 'partial' | 'settled' | 'rejected' | 'cancelled'
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_deserializing)]
    pub debtor_creditor_name: Option<String>,
    #[serde(skip_deserializing)]
    pub item_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateReimbursementRequest {
    pub label: String,
    pub reimbursement_type: Option<String>,
    pub expected_amount: Option<f64>,
    pub currency: Option<String>,
    pub debtor_name: Option<String>,
    pub debtor_creditor_id: Option<String>,
    pub item_id: Option<String>,
    pub engagement_charge_id: Option<String>,
    pub source_description: Option<String>,
    pub requested_on: Option<String>,
    pub expected_by: Option<String>,
    pub status: Option<String>,
    pub notes: Option<String>,
}

// =====================================================================
// Bank statements: monthly PDF imported, parsed by AI, then each line
// matched to an engagement_charge / item /
// income_receipt / reimbursement. Patterns learned during review live in
// `bank_match_rules` to auto-suggest matches on the next month.
// =====================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BankStatement {
    pub id: String,
    pub label: Option<String>,
    pub bank_name: Option<String>,
    pub account_iban: Option<String>,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub statement_date: Option<String>,
    pub opening_balance: Option<f64>,
    pub closing_balance: Option<f64>,
    pub currency: String,
    pub file_path: String,
    pub original_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    /// 'pending' | 'extracted' | 'reviewed' | 'archived'
    pub status: String,
    pub extracted_at: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BankStatementTransaction {
    pub id: String,
    pub statement_id: String,
    pub transaction_date: String,
    pub booking_date: Option<String>,
    pub raw_description: String,
    pub cleaned_description: Option<String>,
    /// Always positive — direction tells whether it's a debit or credit.
    pub amount: f64,
    pub currency: String,
    /// 'debit' | 'credit'
    pub direction: String,
    pub reference_number: Option<String>,
    pub counterparty_iban: Option<String>,
    /// 'engagement' | 'engagement_charge' | 'income' | 'income_receipt'
    /// | 'item' | 'item_group' | 'merchant' | 'reimbursement' | NULL
    pub match_target_kind: Option<String>,
    pub match_target_id: Option<String>,
    pub match_confidence: Option<f64>,
    pub match_rule_id: Option<String>,
    /// 'unmatched' | 'suggested' | 'confirmed' | 'created' | 'ignored'
    pub match_status: String,
    pub review_notes: Option<String>,
    /// CSV of item ids when the matcher detected a grouped match (single
    /// debit summing several same-day/same-merchant purchases). NULL for
    /// single matches. Materialized into a real `order_id` only when the
    /// user confirms the suggestion.
    pub match_group_ids: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Display name of the matched target, joined for the review screen.
    #[serde(skip_deserializing)]
    pub match_target_label: Option<String>,
    /// Ville / lieu de la transaction (ex. « Lausanne », « Dublin »), extrait
    /// surtout des relevés Revolut (ligne « À : … »). NULL si inconnu.
    pub location: Option<String>,
    /// Paiement en devise étrangère : montant d'origine, devise d'origine, et
    /// taux appliqué (1 [devise compte] = N [devise origine]). NULL sinon.
    pub original_amount: Option<f64>,
    pub original_currency: Option<String>,
    pub exchange_rate: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractedTransactionInput {
    pub transaction_date: String,
    pub booking_date: Option<String>,
    pub raw_description: String,
    pub amount: f64,
    pub currency: Option<String>,
    pub direction: String,
    pub reference_number: Option<String>,
    pub counterparty_iban: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub original_amount: Option<f64>,
    #[serde(default)]
    pub original_currency: Option<String>,
    #[serde(default)]
    pub exchange_rate: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BankMatchRule {
    pub id: String,
    pub pattern: String,
    /// 'substring' | 'regex'
    pub pattern_kind: String,
    /// 'debit' | 'credit' | NULL
    pub direction: Option<String>,
    pub amount_min: Option<f64>,
    pub amount_max: Option<f64>,
    /// 'engagement' | 'income' | 'merchant' | 'reimbursement'
    pub target_kind: String,
    pub target_id: String,
    pub learned: bool,
    pub enabled: bool,
    pub hit_count: i64,
    pub last_hit_at: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateBankMatchRuleRequest {
    pub pattern: String,
    pub pattern_kind: Option<String>,
    pub direction: Option<String>,
    pub amount_min: Option<f64>,
    pub amount_max: Option<f64>,
    pub target_kind: String,
    pub target_id: String,
    pub learned: Option<bool>,
    pub notes: Option<String>,
}

/// Une tranche du plan de prévoyance : « de 25 à 34 ans, 10 % au total dont
/// 5 % à ma charge ».
///
/// Rattachée à UNE version de contrat, comme le barème de suppléments : un
/// changement de plan se signe par un avenant, et une fiche de 2019 doit
/// rester lue avec le plan de 2019.
///
/// `age_from` et `age_to` s'entendent au sens LPP — `année civile − année de
/// naissance` — donc le passage d'un palier tombe au 1ᵉʳ janvier, pas le jour
/// de l'anniversaire.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LppPlanBracket {
    pub id: String,
    pub contract_id: String,
    /// Bornes incluses toutes les deux. Quand deux tranches se recouvrent sur
    /// une année — « 18 à 25 » puis « 25 à 40 », ce que tout le monde écrit —
    /// c'est celle qui commence le plus tard qui l'emporte : c'est ainsi qu'on
    /// lit un plan de prévoyance.
    pub age_from: i32,
    pub age_to: i32,
    /// Cotisation totale, employeur et salarié réunis. Sert au contrôle de
    /// l'art. 66 al. 1 LPP.
    pub total_pct: f64,
    /// La part à votre charge. La part patronale s'en déduit : deux champs
    /// indépendants finiraient par se contredire.
    pub employee_pct: f64,
    /// Sur QUEL salaire le taux porte : `coordinated` (le salaire coordonné,
    /// cas de loin le plus courant), `excess` (la part au-delà de la limite
    /// supérieure LPP) ou `full` (le salaire annuel entier, plafonné).
    ///
    /// Un plan réel empile des cotisations sur plusieurs assiettes — AXA
    /// prélève selon l'âge sur le salaire coordonné ET 4 % sur la part
    /// au-delà de la limite. Un modèle à une seule assiette sous-estime la
    /// retenue de qui gagne davantage.
    #[serde(default = "default_lpp_basis")]
    pub basis: String,
}

fn default_lpp_basis() -> String {
    "coordinated".to_string()
}

impl crate::payroll::AgeBracket for LppPlanBracket {
    fn age_from(&self) -> i32 {
        self.age_from
    }
    fn age_to(&self) -> i32 {
        self.age_to
    }
}

/// Une ligne du barème de suppléments d'une entreprise : astreinte à la
/// semaine, samedi travaillé, dimanche travaillé…
///
/// Rattachée à UNE version de contrat, parce qu'un avenant peut changer le
/// tarif du dimanche et que l'historique doit pouvoir dire ce qu'il valait en
/// 2019.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SupplementRate {
    pub id: String,
    pub contract_id: String,
    /// Identifiant stable dans le barème — c'est lui qui relie une quantité
    /// saisie sur un bulletin au tarif qui lui était applicable.
    pub code: String,
    pub label: String,
    /// `week` | `day` | `hour` | `flat`
    pub unit: String,
    pub amount: f64,
    pub sort_order: i32,
}

/// Ce qui a réellement été accompli sur un mois : 1 semaine d'astreinte,
/// 2 dimanches. Le MONTANT, lui, vit dans `income_receipts.other_gross_amount`,
/// colonne que le moteur sait déjà soumettre à l'AVS et ranger en rubrique 1
/// du certificat de salaire. Cette table ne fait qu'expliquer ce montant.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ReceiptSupplement {
    pub id: String,
    pub receipt_id: String,
    pub code: String,
    pub label: String,
    pub quantity: f64,
    /// Tarif appliqué, figé au moment de la saisie : un changement de barème
    /// ne doit pas réécrire le passé.
    pub unit_amount: f64,
    pub amount: f64,
}

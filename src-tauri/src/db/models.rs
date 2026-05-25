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
    pub subscription_id: Option<String>,
    pub engagement_id: Option<String>,
    pub engagement_charge_id: Option<String>,
    pub engagement_revision_id: Option<String>,
    pub income_id: Option<String>,
    pub income_receipt_id: Option<String>,
    pub reimbursement_id: Option<String>,
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
    pub created_at: String,
    pub updated_at: String,
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
    /// - 'subscription' → subscriptions.id
    /// - 'engagement'   → engagements.id
    /// - 'charge'       → engagements.id (the parent of the scheduled
    ///                    charge, not the charge_id, so the dashboard can
    ///                    link to /engagements/:id without an extra hop)
    /// Kept as `item_id` for backward-compat with existing frontend code.
    pub item_id: String,
    pub entity_type: String,
    pub description: String,
    /// For items this is the item_kind ("ticket", "voucher", "license"); for
    /// subscriptions it carries the billing_cycle so the UI can colour-code;
    /// for engagements/charges it carries the canonical engagement_type.
    pub item_kind: String,
    /// "event" | "expiration" | "renewal" | "due" | "charge_due" | "notice"
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Subscription {
    pub id: String,
    pub name: String,
    pub category: Option<String>,
    pub merchant_id: Option<String>,
    pub payment_card_id: Option<String>,
    pub start_date: String,
    pub next_renewal_date: String,
    /// 'monthly' | 'quarterly' | 'yearly' | 'custom'
    pub billing_cycle: String,
    /// Multiplier on the billing cycle unit (e.g. cycle='monthly', interval=3
    /// = every 3 months). Defaults to 1.
    pub cycle_interval: i32,
    pub price: f64,
    pub currency: String,
    pub auto_renewal: bool,
    pub trial_end_date: Option<String>,
    pub cancel_by_date: Option<String>,
    pub cancellation_url: Option<String>,
    /// 'active' | 'paused' | 'cancelled'
    pub status: String,
    pub notes: Option<String>,
    /// Discriminator for the subscription scope. 'online' covers streaming,
    /// SaaS, cloud, hosting, gaming. Real-world recurring charges (insurance,
    /// rent, utilities…) belong in the separate `engagements` domain.
    pub kind: String,
    pub created_at: String,
    pub updated_at: String,
    // Joined fields
    #[serde(skip_deserializing)]
    pub merchant_name: Option<String>,
    #[serde(skip_deserializing)]
    pub card_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSubscriptionRequest {
    pub name: String,
    pub category: Option<String>,
    pub merchant_id: Option<String>,
    pub payment_card_id: Option<String>,
    pub start_date: String,
    pub next_renewal_date: String,
    pub billing_cycle: String,
    pub cycle_interval: Option<i32>,
    pub price: f64,
    pub currency: Option<String>,
    pub auto_renewal: Option<bool>,
    pub trial_end_date: Option<String>,
    pub cancel_by_date: Option<String>,
    pub cancellation_url: Option<String>,
    pub status: Option<String>,
    pub notes: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubscriptionPayment {
    pub id: String,
    pub subscription_id: String,
    pub paid_on: String,
    pub amount: f64,
    pub currency: String,
    pub payment_card_id: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    #[serde(skip_deserializing)]
    pub card_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSubscriptionPaymentRequest {
    pub subscription_id: String,
    pub paid_on: String,
    pub amount: f64,
    pub currency: Option<String>,
    pub payment_card_id: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SubscriptionMember {
    pub id: String,
    pub subscription_id: String,
    pub name: String,
    pub share_amount: Option<f64>,
    pub share_percent: Option<f64>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSubscriptionMemberRequest {
    pub subscription_id: String,
    pub name: String,
    pub share_amount: Option<f64>,
    pub share_percent: Option<f64>,
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
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IncomeReceipt {
    pub id: String,
    pub income_id: String,
    pub received_on: String,
    /// Net amount that actually landed in the account.
    pub amount: f64,
    pub currency: String,
    pub period_label: Option<String>,
    // Optional payslip detail — populated for salaries, left NULL for
    // allocations / dividends / refunds.
    pub gross_amount: Option<f64>,
    pub social_charges_amount: Option<f64>,
    pub pension_amount: Option<f64>,
    pub tax_at_source_amount: Option<f64>,
    pub other_deductions_amount: Option<f64>,
    pub bonus_amount: Option<f64>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateIncomeReceiptRequest {
    pub income_id: String,
    pub received_on: String,
    pub amount: f64,
    pub currency: Option<String>,
    pub period_label: Option<String>,
    pub gross_amount: Option<f64>,
    pub social_charges_amount: Option<f64>,
    pub pension_amount: Option<f64>,
    pub tax_at_source_amount: Option<f64>,
    pub other_deductions_amount: Option<f64>,
    pub bonus_amount: Option<f64>,
    pub notes: Option<String>,
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
// matched to an engagement_charge / subscription_payment / item /
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
    /// 'engagement' | 'engagement_charge' | 'subscription'
    /// | 'subscription_payment' | 'income' | 'income_receipt'
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
    /// 'engagement' | 'subscription' | 'income' | 'merchant' | 'reimbursement'
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

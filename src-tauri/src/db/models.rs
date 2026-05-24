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
    pub file_path: String,
    pub size_bytes: i64,
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
    /// Source entity row id. Either an items.id or a subscriptions.id depending
    /// on `entity_type` — kept as `item_id` for backward-compat with existing
    /// frontend code that already keys on this field.
    pub item_id: String,
    /// "item" for purchase-derived reminders, "subscription" for renewals.
    pub entity_type: String,
    pub description: String,
    /// For items this is the item_kind ("ticket", "voucher", "license"); for
    /// subscriptions it carries the billing_cycle so the UI can colour-code.
    pub item_kind: String,
    pub reminder_type: String, // "event" | "expiration" | "renewal"
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

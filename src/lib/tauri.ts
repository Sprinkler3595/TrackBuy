import { invoke } from "@tauri-apps/api/core"

// Types
// Discriminator for digital items. Physical purchases use "physical" (default);
// the dedicated /tickets page handles the other three kinds.
export type ItemKind = "physical" | "ticket" | "voucher" | "license"

export interface Item {
  id: string
  description: string
  purchase_date: string
  purchase_price: number
  currency: string
  status: string
  merchant_id: string
  location_id: string
  payment_card_id: string | null
  notes: string | null
  invoice_number: string | null
  product_reference: string | null
  quantity: number | null
  price_excl_tax: number | null
  tax_rate: number | null
  order_id: string | null
  // Digital items (NULL for physical purchases).
  item_kind: ItemKind
  event_datetime: string | null
  event_location: string | null
  expiration_date: string | null
  redemption_url: string | null
  redeemed_at: string | null
  /// Set when the user has confirmed this item against a bank statement
  /// line. Drives the "rapproché bancairement" chip on the items list and
  /// excludes the item from future bank-matching suggestions.
  bank_transaction_id: string | null
  created_at: string
  updated_at: string
  merchant_name?: string
  location_name?: string
  card_name?: string
}

export interface Reminder {
  /// Source row id. items.id for 'item', subscriptions.id for 'subscription',
  /// engagements.id for both 'engagement' and 'charge' (parent, not charge_id).
  item_id: string
  entity_type: "item" | "subscription" | "engagement" | "charge"
  description: string
  /// item_kind for items, billing cycle for subscriptions, engagement_type
  /// for engagements/charges.
  item_kind: string
  reminder_type: "event" | "expiration" | "renewal" | "due" | "charge_due" | "notice"
  target_date: string
  days_until: number
  merchant_name: string | null
}

export interface Merchant {
  id: string
  name: string
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  logo_path: string | null
  created_at: string
  updated_at: string
}

export interface Location {
  id: string
  name: string
  icon: string
  created_at: string
  updated_at: string
}

export type AccountKind = "card" | "bank_account" | "cash" | "qr_bill" | "other"

export interface PaymentCard {
  id: string
  name: string
  is_credit_card: boolean
  extended_warranty_months: number
  extended_warranty_description: string | null
  account_kind: AccountKind
  iban: string | null
  bic: string | null
  account_holder: string | null
  institution: string | null
  created_at: string
  updated_at: string
}

export interface Warranty {
  id: string
  item_id: string
  start_date: string
  duration_months: number
  notes: string | null
  created_at: string
  updated_at: string
  end_date?: string
  item_description?: string
}

export interface Attachment {
  id: string
  item_id: string | null
  order_id: string | null
  subscription_id: string | null
  engagement_id: string | null
  engagement_charge_id: string | null
  engagement_revision_id: string | null
  income_id: string | null
  income_receipt_id: string | null
  reimbursement_id: string | null
  original_name: string
  display_name: string
  mime_type: string
  file_path: string
  size_bytes: number
  attachment_type: string
  created_at: string
}

export interface PendingInvoice {
  id: string
  label: string | null
  notes: string | null
  original_name: string
  mime_type: string
  /// NULL for rows materialized from an orphan bank transaction (no PDF
  /// uploaded yet); a real path once the user provides the file.
  file_path: string | null
  size_bytes: number
  /// Set when this pending invoice was created from a bank line that had
  /// no matching item — the user committed to providing the PDF later.
  source_bank_tx_id: string | null
  expected_amount: number | null
  expected_date: string | null
  currency: string | null
  created_at: string
  updated_at: string
}

export type BillingCycle = "monthly" | "quarterly" | "yearly" | "custom"
export type SubscriptionStatus = "active" | "paused" | "cancelled"
export type SubscriptionKind = "online"

export interface Subscription {
  id: string
  name: string
  category: string | null
  merchant_id: string | null
  payment_card_id: string | null
  start_date: string
  next_renewal_date: string
  billing_cycle: BillingCycle
  cycle_interval: number
  price: number
  currency: string
  auto_renewal: boolean
  trial_end_date: string | null
  cancel_by_date: string | null
  cancellation_url: string | null
  status: SubscriptionStatus
  notes: string | null
  kind: SubscriptionKind
  created_at: string
  updated_at: string
  merchant_name?: string | null
  card_name?: string | null
}

export interface SubscriptionPayment {
  id: string
  subscription_id: string
  paid_on: string
  amount: number
  currency: string
  payment_card_id: string | null
  notes: string | null
  created_at: string
  // true = paiement présumé généré par le roll-forward, en attente de confirmation.
  is_presumed: boolean
  card_name?: string | null
}

export interface SubscriptionMember {
  id: string
  subscription_id: string
  name: string
  share_amount: number | null
  share_percent: number | null
  notes: string | null
  created_at: string
}

export interface VaultInfo {
  name: string
  path: string
  is_active: boolean
  created_at: string | null
}

// Auth commands
export const checkVaultExists = (vaultName?: string) =>
  invoke<boolean>("check_vault_exists", { vaultName })

export const createVault = (vaultName: string, password: string) =>
  invoke<void>("create_vault", { vaultName, password })

export const unlockVault = (vaultName: string, password: string) =>
  invoke<void>("unlock_vault", { vaultName, password })

export const lockVault = () =>
  invoke<void>("lock_vault")

export const changeMasterPassword = (oldPassword: string, newPassword: string) =>
  invoke<void>("change_master_password", { oldPassword, newPassword })

export const listVaults = () =>
  invoke<VaultInfo[]>("list_vaults")

export const switchVault = (vaultName: string, password: string) =>
  invoke<void>("switch_vault", { vaultName, password })

export interface VaultLocation {
  vault_name: string
  vault_dir: string
  db_file: string
  attachments_dir: string
  db_size_bytes: number
}

export const getActiveVaultLocation = () =>
  invoke<VaultLocation>("get_active_vault_location")

export const openActiveVaultFolder = () =>
  invoke<void>("open_active_vault_folder")

// Item commands
export const getItems = (params?: {
  search?: string
  status?: string
  merchantId?: string
  locationId?: string
  // "physical" → only physical purchases (existing Items page)
  // "digital" → tickets + vouchers + licenses (Tickets page)
  // "ticket" | "voucher" | "license" → exact kind
  // undefined/"all" → everything
  kind?: ItemKind | "digital" | "all"
}) => invoke<Item[]>("get_items", params ?? {})

export const createItem = (item: {
  description: string
  purchase_date: string
  purchase_price: number
  currency?: string
  status?: string
  merchant_id: string
  location_id: string
  payment_card_id?: string
  notes?: string
  invoice_number?: string
  product_reference?: string
  quantity?: number
  price_excl_tax?: number
  tax_rate?: number
  order_id?: string
  item_kind?: ItemKind
  event_datetime?: string
  event_location?: string
  expiration_date?: string
  redemption_url?: string
  redeemed_at?: string
}) => invoke<Item>("create_item", { item })

export const updateItem = (item: Item) =>
  invoke<void>("update_item", { item })

export const deleteItem = (id: string) =>
  invoke<void>("delete_item", { id })

export interface OrderLine {
  description: string
  purchase_price: number
  quantity?: number
  price_excl_tax?: number
  tax_rate?: number
  product_reference?: string
  notes?: string
  warranty_months?: number
}

export interface CreateOrderRequest {
  purchase_date: string
  currency?: string
  status?: string
  merchant_id: string
  location_id: string
  payment_card_id?: string
  invoice_number?: string
  notes?: string
  lines: OrderLine[]
  invoice_source_path?: string
  invoice_display_name?: string
}

export interface CreateOrderResult {
  order_id: string
  items: Item[]
}

export const createOrderWithItems = (order: CreateOrderRequest) =>
  invoke<CreateOrderResult>("create_order_with_items", { order })

export const linkItemsToOrder = (itemIds: string[]) =>
  invoke<string>("link_items_to_order", { itemIds })

export const unlinkItemFromOrder = (itemId: string) =>
  invoke<void>("unlink_item_from_order", { itemId })

// Merchant commands
export const getMerchants = () => invoke<Merchant[]>("get_merchants")
export const createMerchant = (merchant: { name: string; contact_email?: string; contact_phone?: string; address?: string }) =>
  invoke<Merchant>("create_merchant", { merchant })
export const updateMerchant = (merchant: Merchant) => invoke<void>("update_merchant", { merchant })
export const deleteMerchant = (id: string) => invoke<void>("delete_merchant", { id })

// Location commands
export const getLocations = () => invoke<Location[]>("get_locations")
export const createLocation = (location: { name: string; icon?: string }) =>
  invoke<Location>("create_location", { location })
export const updateLocation = (location: Location) => invoke<void>("update_location", { location })
export const deleteLocation = (id: string) => invoke<void>("delete_location", { id })

// Card commands
export const getCards = () => invoke<PaymentCard[]>("get_cards")
export const createCard = (card: { name: string; is_credit_card: boolean; extended_warranty_months?: number; extended_warranty_description?: string }) =>
  invoke<PaymentCard>("create_card", { card })
export const updateCard = (card: PaymentCard) => invoke<void>("update_card", { card })
export const deleteCard = (id: string) => invoke<void>("delete_card", { id })

// Warranty commands
export const getWarranties = (itemId?: string) => invoke<Warranty[]>("get_warranties", { itemId })
export const getExpiringWarranties = (days?: number) => invoke<Warranty[]>("get_expiring_warranties", { days })

// Upcoming-events and expiration alerts for digital items.
export const getUpcomingReminders = (days?: number) =>
  invoke<Reminder[]>("get_upcoming_reminders", { days })
export const createWarranty = (warranty: { item_id: string; start_date: string; duration_months: number; notes?: string }) =>
  invoke<Warranty>("create_warranty", { warranty })
export const updateWarranty = (warranty: Warranty) => invoke<void>("update_warranty", { warranty })
export const deleteWarranty = (id: string) => invoke<void>("delete_warranty", { id })

// Attachment commands
export const getAttachments = (itemId: string) => invoke<Attachment[]>("get_attachments", { itemId })
export const getSubscriptionAttachments = (subscriptionId: string) =>
  invoke<Attachment[]>("get_subscription_attachments", { subscriptionId })
export const addAttachment = (
  itemId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string,
  shareWithOrder?: boolean,
) =>
  invoke<Attachment>("add_attachment", { itemId, sourcePath, displayName, attachmentType, shareWithOrder })

export const addSubscriptionAttachment = (
  subscriptionId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string,
) =>
  invoke<Attachment>("add_subscription_attachment", { subscriptionId, sourcePath, displayName, attachmentType })

// Save a code/key typed directly in the form (no file picker round-trip).
// The text is encrypted on disk via the same ChaCha20-Poly1305 pipeline as
// regular file attachments.
export const addTextAttachment = (
  itemId: string,
  content: string,
  displayName?: string,
  attachmentType?: string,
) =>
  invoke<Attachment>("add_text_attachment", { itemId, content, displayName, attachmentType })
export const deleteAttachment = (id: string) => invoke<void>("delete_attachment", { id })
export const exportAttachment = (id: string, destination: string) => invoke<void>("export_attachment", { id, destination })
export const getAttachmentData = (id: string) => invoke<string>("get_attachment_data", { id })

// Pending invoices: receipt files stored encrypted, awaiting OCR + creation.
export const listPendingInvoices = () =>
  invoke<PendingInvoice[]>("list_pending_invoices")
export const addPendingInvoice = (
  sourcePath: string,
  label?: string | null,
  notes?: string | null,
) =>
  invoke<PendingInvoice>("add_pending_invoice", { sourcePath, label, notes })
export const addPendingInvoicesBatch = (sourcePaths: string[]) =>
  invoke<PendingInvoice[]>("add_pending_invoices_batch", { sourcePaths })
export const updatePendingInvoice = (
  id: string,
  label: string | null,
  notes: string | null,
) =>
  invoke<PendingInvoice>("update_pending_invoice", { id, label, notes })
export const deletePendingInvoice = (id: string) =>
  invoke<void>("delete_pending_invoice", { id })
export const getPendingInvoiceData = (id: string) =>
  invoke<string>("get_pending_invoice_data", { id })
// Transfer a pending invoice into the attachments table for the given item
// (optionally shared at the order level). The encrypted file on disk is
// reused as-is — no decrypt/reencrypt round-trip.
export const attachPendingInvoiceToItem = (
  pendingInvoiceId: string,
  itemId: string,
  attachmentType?: string,
  displayName?: string,
  shareWithOrder?: boolean,
) =>
  invoke<Attachment>("attach_pending_invoice_to_item", {
    pendingInvoiceId,
    itemId,
    attachmentType,
    displayName,
    shareWithOrder,
  })

// Filename templates: user overrides for the harmonized display_name of
// attachments. Defaults live in src/lib/filename-template.ts.
export interface FilenameTemplate {
  attachment_type: string
  template: string
  updated_at: string
}
export const listFilenameTemplates = () =>
  invoke<FilenameTemplate[]>("list_filename_templates")
export const setFilenameTemplate = (attachmentType: string, template: string) =>
  invoke<FilenameTemplate>("set_filename_template", { attachmentType, template })
export const resetFilenameTemplate = (attachmentType: string) =>
  invoke<void>("reset_filename_template", { attachmentType })

// Backup & stats commands
export const backupVault = (destination: string) => invoke<string>("backup_vault", { destination })

export interface BackupInfo {
  vault_name: string
  created_at: string
  format_version: number
  exists_locally: boolean
}
export const inspectBackup = (source: string) =>
  invoke<BackupInfo>("inspect_backup", { source })
export const restoreBackup = (source: string, targetName: string | null, overwrite: boolean) =>
  invoke<string>("restore_backup", { source, targetName, overwrite })

export const exportItemsCsv = () => invoke<string>("export_items_csv")
export const exportEngagementsCsv = () => invoke<string>("export_engagements_csv")
export const exportEngagementChargesCsv = () => invoke<string>("export_engagement_charges_csv")
export const exportIncomesCsv = () => invoke<string>("export_incomes_csv")
export const exportIncomeReceiptsCsv = () => invoke<string>("export_income_receipts_csv")
export const exportReimbursementsCsv = () => invoke<string>("export_reimbursements_csv")

export interface YoyEngagement {
  engagement_id: string
  name: string
  series: Array<{ year: string; total: number; months: number }>
}

export interface Stats {
  total_items: number
  active_items: number
  total_value: number
  total_merchants: number
  total_warranties: number
  total_attachments: number
  monthly_spending: Array<{ month: string; total: number }>
  monthly_engagements: Array<{ month: string; total: number }>
  monthly_subscriptions: Array<{ month: string; total: number }>
  monthly_incomes: Array<{ month: string; total: number }>
  engagements_by_type: Array<{ type: string; total: number; count: number }>
  incomes_by_type: Array<{ type: string; total: number; count: number }>
  top_creditors: Array<{ name: string; total: number }>
  yoy_by_engagement: YoyEngagement[]
  window_months: number
  display_currency: string
}
export const getStats = (months?: number, currency?: string) =>
  invoke<Stats>("get_stats", { months, currency })

// File I/O commands (path-validated, replace direct plugin-fs usage)
export const writeTextFile = (destination: string, content: string) =>
  invoke<void>("write_text_file", { destination, content })

export const readTextFile = (source: string) =>
  invoke<string>("read_text_file", { source })

// Returns base64-encoded bytes; max 50 MB.
export const readBinaryFileBase64 = (source: string) =>
  invoke<string>("read_binary_file_base64", { source })

// AI extraction commands
export interface AiExtractionConfig {
  provider: "infomaniak" | "ollama"
  apiKey: string
  infomaniakProductId: string
  ollamaUrl: string
  model: string
}

export type LineCategory = "purchase" | "license" | "service" | "shipping" | "voucher" | "other"

export interface ExtractedLineItem {
  description: string
  price: number
  category: LineCategory
}

export interface ExtractedReceipt {
  description: string | null
  purchase_date: string | null
  purchase_price: number | null
  currency: string | null
  merchant: string | null
  invoice_number: string | null
  product_reference: string | null
  quantity: number | null
  price_excl_tax: number | null
  tax_rate: number | null
  warranty_months: number | null
  warranty_start_date: string | null
  notes: string | null
  items: ExtractedLineItem[]
}

export const aiExtractReceipt = (ocrText: string, config: AiExtractionConfig) =>
  invoke<ExtractedReceipt>("ai_extract_receipt", { ocrText, config })

export const aiTestConnection = (config: AiExtractionConfig) =>
  invoke<string>("ai_test_connection", { config })

// Subscription commands
export const getSubscriptions = (params?: { status?: string; category?: string }) =>
  invoke<Subscription[]>("get_subscriptions", params ?? {})

export const getSubscription = (id: string) =>
  invoke<Subscription>("get_subscription", { id })

export const createSubscription = (subscription: {
  name: string
  category?: string
  merchant_id?: string | null
  payment_card_id?: string | null
  start_date: string
  next_renewal_date: string
  billing_cycle: BillingCycle
  cycle_interval?: number
  price: number
  currency?: string
  auto_renewal?: boolean
  trial_end_date?: string | null
  cancel_by_date?: string | null
  cancellation_url?: string | null
  status?: SubscriptionStatus
  notes?: string | null
  kind?: SubscriptionKind
}) => invoke<Subscription>("create_subscription", { subscription })

export const updateSubscription = (subscription: Subscription) =>
  invoke<void>("update_subscription", { subscription })

export const deleteSubscription = (id: string) =>
  invoke<void>("delete_subscription", { id })

export const getUpcomingRenewals = (days?: number) =>
  invoke<Subscription[]>("get_upcoming_renewals", { days })

export const rollForwardDueSubscriptions = () =>
  invoke<number>("roll_forward_due_subscriptions")

export const markRenewed = (id: string) =>
  invoke<Subscription>("mark_renewed", { id })

export const getSubscriptionPayments = (subscriptionId: string) =>
  invoke<SubscriptionPayment[]>("get_subscription_payments", { subscriptionId })

export const logSubscriptionPayment = (payment: {
  subscription_id: string
  paid_on: string
  amount: number
  currency?: string
  payment_card_id?: string | null
  notes?: string | null
}) => invoke<SubscriptionPayment>("log_subscription_payment", { payment })

export const deleteSubscriptionPayment = (id: string) =>
  invoke<void>("delete_subscription_payment", { id })

// Confirme un paiement présumé (le débit a bien eu lieu) → is_presumed = false.
export const confirmSubscriptionPayment = (id: string) =>
  invoke<void>("confirm_subscription_payment", { id })

export const getSubscriptionMembers = (subscriptionId: string) =>
  invoke<SubscriptionMember[]>("get_subscription_members", { subscriptionId })

export const addSubscriptionMember = (member: {
  subscription_id: string
  name: string
  share_amount?: number | null
  share_percent?: number | null
  notes?: string | null
}) => invoke<SubscriptionMember>("add_subscription_member", { member })

export const updateSubscriptionMember = (member: SubscriptionMember) =>
  invoke<void>("update_subscription_member", { member })

export const deleteSubscriptionMember = (id: string) =>
  invoke<void>("delete_subscription_member", { id })

// ============================================================================
// Engagements & creditors (recurring real-world charges)
// ============================================================================

export type CreditorType =
  | "insurer" | "landlord" | "utility" | "telco" | "tax_office"
  | "leasing_company" | "employer" | "bank" | "other"

export interface Creditor {
  id: string
  name: string
  creditor_type: CreditorType
  contact_email: string | null
  contact_phone: string | null
  address: string | null
  iban: string | null
  reference_prefix: string | null
  notes: string | null
  logo_path: string | null
  created_at: string
  updated_at: string
}

export type EngagementType =
  | "insurance_health" | "insurance_household" | "insurance_car"
  | "insurance_life" | "insurance_legal" | "insurance_other"
  | "rent" | "parking" | "leasing" | "mortgage"
  | "electricity" | "gas" | "water" | "fuel" | "heating"
  | "phone" | "internet" | "tv_radio"
  | "tax_federal" | "tax_cantonal" | "tax_communal" | "tax_other"
  | "fine" | "fee" | "membership" | "other"

export type EngagementBillingCycle =
  | "monthly" | "quarterly" | "semiannual" | "yearly" | "one_shot" | "custom"

export type EngagementStatus = "active" | "suspended" | "ended"

export type EngagementPaymentMethod =
  | "direct_debit" | "qr_bill" | "bvr" | "manual_transfer"
  | "standing_order" | "cash" | "card_auto" | "other"

export type ChargeStatus = "scheduled" | "paid" | "late" | "disputed" | "waived"

export interface Engagement {
  id: string
  name: string
  engagement_type: EngagementType
  parent_engagement_id: string | null
  creditor_id: string | null
  payment_card_id: string | null
  contract_reference: string | null
  contract_start_date: string | null
  contract_end_date: string | null
  notice_period_days: number | null
  billing_cycle: EngagementBillingCycle
  cycle_interval: number
  next_due_date: string | null
  current_amount: number | null
  currency: string
  payment_method: EngagementPaymentMethod | null
  auto_pay: boolean
  status: EngagementStatus
  ended_on: string | null
  notes: string | null
  clauses_json: string | null
  created_at: string
  updated_at: string
  creditor_name?: string | null
  card_name?: string | null
  parent_name?: string | null
}

export interface EngagementCharge {
  id: string
  engagement_id: string
  period_start: string | null
  period_end: string | null
  due_date: string
  amount: number
  currency: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  paid_on: string | null
  status: ChargeStatus
  payment_card_id: string | null
  reference_number: string | null
  invoice_number: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // true = charge présumée (auto_pay générée par le roll-forward), à confirmer.
  is_presumed: boolean
  card_name?: string | null
}

export interface EngagementRevision {
  id: string
  engagement_id: string
  effective_date: string
  amount: number
  currency: string
  change_reason: string | null
  notes: string | null
  created_at: string
}

// Creditors CRUD
export const getCreditors = (params?: { creditor_type?: string }) =>
  invoke<Creditor[]>("get_creditors", params ?? {})

export const createCreditor = (creditor: {
  name: string
  creditor_type?: CreditorType
  contact_email?: string | null
  contact_phone?: string | null
  address?: string | null
  iban?: string | null
  reference_prefix?: string | null
  notes?: string | null
}) => invoke<Creditor>("create_creditor", { creditor })

export const updateCreditor = (creditor: Creditor) =>
  invoke<void>("update_creditor", { creditor })

export const deleteCreditor = (id: string) =>
  invoke<void>("delete_creditor", { id })

// Engagements CRUD
export const getEngagements = (params?: {
  status?: string
  engagement_type?: string
  parent_id?: string
}) => invoke<Engagement[]>("get_engagements", params ?? {})

export const getEngagement = (id: string) =>
  invoke<Engagement>("get_engagement", { id })

export const getEngagementChildren = (parentId: string) =>
  invoke<Engagement[]>("get_engagement_children", { parentId })

export const createEngagement = (engagement: {
  name: string
  engagement_type: EngagementType
  parent_engagement_id?: string | null
  creditor_id?: string | null
  payment_card_id?: string | null
  contract_reference?: string | null
  contract_start_date?: string | null
  contract_end_date?: string | null
  notice_period_days?: number | null
  billing_cycle: EngagementBillingCycle
  cycle_interval?: number
  next_due_date?: string | null
  current_amount?: number | null
  currency?: string
  payment_method?: EngagementPaymentMethod | null
  auto_pay?: boolean
  status?: EngagementStatus
  notes?: string | null
  clauses_json?: string | null
}) => invoke<Engagement>("create_engagement", { engagement })

export const updateEngagement = (engagement: Engagement) =>
  invoke<void>("update_engagement", { engagement })

export const deleteEngagement = (id: string) =>
  invoke<void>("delete_engagement", { id })

export const rollForwardDueEngagements = () =>
  invoke<number>("roll_forward_due_engagements")

export const getUpcomingEngagementCharges = (days?: number) =>
  invoke<EngagementCharge[]>("get_upcoming_engagement_charges", { days })

// Engagement charges (occurrences/factures)
export const getEngagementCharges = (engagementId: string) =>
  invoke<EngagementCharge[]>("get_engagement_charges", { engagementId })

export const addEngagementCharge = (charge: {
  engagement_id: string
  period_start?: string | null
  period_end?: string | null
  due_date: string
  amount: number
  currency?: string
  quantity?: number | null
  unit?: string | null
  unit_price?: number | null
  paid_on?: string | null
  status?: ChargeStatus
  payment_card_id?: string | null
  reference_number?: string | null
  invoice_number?: string | null
  notes?: string | null
}) => invoke<EngagementCharge>("add_engagement_charge", { charge })

export const updateEngagementCharge = (charge: EngagementCharge) =>
  invoke<void>("update_engagement_charge", { charge })

export const markChargePaid = (
  id: string,
  paidOn: string,
  paymentCardId?: string | null
) => invoke<EngagementCharge>("mark_charge_paid", { id, paidOn, paymentCardId })

export const deleteEngagementCharge = (id: string) =>
  invoke<void>("delete_engagement_charge", { id })

// Confirme une charge présumée (auto_pay générée par le roll-forward).
export const confirmEngagementCharge = (id: string) =>
  invoke<EngagementCharge>("confirm_engagement_charge", { id })

// Engagement revisions (contract amendments)
export const getEngagementRevisions = (engagementId: string) =>
  invoke<EngagementRevision[]>("get_engagement_revisions", { engagementId })

export const addEngagementRevision = (revision: {
  engagement_id: string
  effective_date: string
  amount: number
  currency?: string
  change_reason?: string | null
  notes?: string | null
}) => invoke<EngagementRevision>("add_engagement_revision", { revision })

export const deleteEngagementRevision = (id: string) =>
  invoke<void>("delete_engagement_revision", { id })

export const migrateSubscriptionToEngagement = (
  subscriptionId: string,
  engagementType: EngagementType,
  creditorId?: string | null
) =>
  invoke<Engagement>("migrate_subscription_to_engagement", {
    subscriptionId,
    engagementType,
    creditorId,
  })

// Polymorphic attachments
export const getEngagementAttachments = (engagementId: string) =>
  invoke<Attachment[]>("get_engagement_attachments", { engagementId })

export const getEngagementChargeAttachments = (chargeId: string) =>
  invoke<Attachment[]>("get_engagement_charge_attachments", { chargeId })

export const addEngagementAttachment = (
  engagementId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string
) =>
  invoke<Attachment>("add_engagement_attachment", {
    engagementId,
    sourcePath,
    displayName,
    attachmentType,
  })

export const addEngagementChargeAttachment = (
  chargeId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string
) =>
  invoke<Attachment>("add_engagement_charge_attachment", {
    chargeId,
    sourcePath,
    displayName,
    attachmentType,
  })

export const addEngagementRevisionAttachment = (
  revisionId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string
) =>
  invoke<Attachment>("add_engagement_revision_attachment", {
    revisionId,
    sourcePath,
    displayName,
    attachmentType,
  })

// ============================================================================
// Incomes (salaries, bonuses, allowances, dividends, …)
// ============================================================================

export type IncomeType =
  | "salary" | "bonus" | "thirteenth" | "pension"
  | "unemployment" | "family_allowance" | "dividend"
  | "rental" | "gift" | "reimbursement" | "other"

export type IncomeBillingCycle =
  | "monthly" | "quarterly" | "yearly" | "one_shot" | "custom"

export type IncomeStatus = "active" | "ended"

export interface Income {
  id: string
  name: string
  income_type: IncomeType
  source_name: string | null
  payment_card_id: string | null
  billing_cycle: IncomeBillingCycle
  cycle_interval: number
  next_expected_date: string | null
  current_amount: number | null
  currency: string
  status: IncomeStatus
  started_on: string | null
  ended_on: string | null
  notes: string | null
  created_at: string
  updated_at: string
  card_name?: string | null
}

export interface IncomeReceipt {
  id: string
  income_id: string
  received_on: string
  amount: number
  currency: string
  period_label: string | null
  gross_amount: number | null
  social_charges_amount: number | null
  pension_amount: number | null
  tax_at_source_amount: number | null
  other_deductions_amount: number | null
  bonus_amount: number | null
  notes: string | null
  created_at: string
}

// Incomes CRUD
export const getIncomes = (params?: { status?: string; income_type?: string }) =>
  invoke<Income[]>("get_incomes", params ?? {})

export const getIncome = (id: string) =>
  invoke<Income>("get_income", { id })

export const createIncome = (income: {
  name: string
  income_type: IncomeType
  source_name?: string | null
  payment_card_id?: string | null
  billing_cycle: IncomeBillingCycle
  cycle_interval?: number
  next_expected_date?: string | null
  current_amount?: number | null
  currency?: string
  status?: IncomeStatus
  started_on?: string | null
  notes?: string | null
}) => invoke<Income>("create_income", { income })

export const updateIncome = (income: Income) =>
  invoke<void>("update_income", { income })

export const deleteIncome = (id: string) =>
  invoke<void>("delete_income", { id })

// Income receipts (each reception, with optional payslip detail)
export const getIncomeReceipts = (incomeId: string) =>
  invoke<IncomeReceipt[]>("get_income_receipts", { incomeId })

export const logIncomeReceipt = (receipt: {
  income_id: string
  received_on: string
  amount: number
  currency?: string
  period_label?: string | null
  gross_amount?: number | null
  social_charges_amount?: number | null
  pension_amount?: number | null
  tax_at_source_amount?: number | null
  other_deductions_amount?: number | null
  bonus_amount?: number | null
  notes?: string | null
}) => invoke<IncomeReceipt>("log_income_receipt", { receipt })

export const updateIncomeReceipt = (receipt: IncomeReceipt) =>
  invoke<void>("update_income_receipt", { receipt })

export const deleteIncomeReceipt = (id: string) =>
  invoke<void>("delete_income_receipt", { id })

// Polymorphic attachments
export const getIncomeAttachments = (incomeId: string) =>
  invoke<Attachment[]>("get_income_attachments", { incomeId })

export const getIncomeReceiptAttachments = (receiptId: string) =>
  invoke<Attachment[]>("get_income_receipt_attachments", { receiptId })

export const addIncomeAttachment = (
  incomeId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string
) =>
  invoke<Attachment>("add_income_attachment", {
    incomeId,
    sourcePath,
    displayName,
    attachmentType,
  })

export const addIncomeReceiptAttachment = (
  receiptId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string
) =>
  invoke<Attachment>("add_income_receipt_attachment", {
    receiptId,
    sourcePath,
    displayName,
    attachmentType,
  })

// ============================================================================
// Pending reimbursements (money to recover)
// ============================================================================

export type ReimbursementType =
  | "expense_report" | "insurance_claim" | "warranty_return"
  | "product_return" | "deposit" | "tax_refund" | "other"

export type ReimbursementStatus =
  | "pending" | "claimed" | "partial" | "settled" | "rejected" | "cancelled"

export interface PendingReimbursement {
  id: string
  label: string
  reimbursement_type: ReimbursementType
  expected_amount: number | null
  received_amount: number | null
  currency: string
  debtor_name: string | null
  debtor_creditor_id: string | null
  item_id: string | null
  engagement_charge_id: string | null
  source_description: string | null
  requested_on: string | null
  expected_by: string | null
  received_on: string | null
  status: ReimbursementStatus
  notes: string | null
  created_at: string
  updated_at: string
  debtor_creditor_name?: string | null
  item_description?: string | null
}

export const listPendingReimbursements = (params?: { status?: string }) =>
  invoke<PendingReimbursement[]>("list_pending_reimbursements", params ?? {})

export const getPendingReimbursement = (id: string) =>
  invoke<PendingReimbursement>("get_pending_reimbursement", { id })

export const createPendingReimbursement = (reimb: {
  label: string
  reimbursement_type?: ReimbursementType
  expected_amount?: number | null
  currency?: string
  debtor_name?: string | null
  debtor_creditor_id?: string | null
  item_id?: string | null
  engagement_charge_id?: string | null
  source_description?: string | null
  requested_on?: string | null
  expected_by?: string | null
  status?: ReimbursementStatus
  notes?: string | null
}) => invoke<PendingReimbursement>("create_pending_reimbursement", { reimb })

export const updatePendingReimbursement = (reimb: PendingReimbursement) =>
  invoke<void>("update_pending_reimbursement", { reimb })

export const markReimbursementClaimed = (id: string, requestedOn?: string) =>
  invoke<PendingReimbursement>("mark_reimbursement_claimed", { id, requestedOn })

export const markReimbursementSettled = (
  id: string,
  receivedOn: string,
  receivedAmount: number
) =>
  invoke<PendingReimbursement>("mark_reimbursement_settled", {
    id,
    receivedOn,
    receivedAmount,
  })

export const deletePendingReimbursement = (id: string) =>
  invoke<void>("delete_pending_reimbursement", { id })

export const getReimbursementAttachments = (reimbursementId: string) =>
  invoke<Attachment[]>("get_reimbursement_attachments", { reimbursementId })

export const addReimbursementAttachment = (
  reimbursementId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string
) =>
  invoke<Attachment>("add_reimbursement_attachment", {
    reimbursementId,
    sourcePath,
    displayName,
    attachmentType,
  })

// ============================================================================
// Bank statements: PDF/image import → AI extraction → match review →
// learned rules. Companion of `ai_extract_bank_statement` on the Rust side.
// ============================================================================

export type BankStatementStatus = "pending" | "extracted" | "reviewed" | "archived"

export interface BankStatement {
  id: string
  label: string | null
  bank_name: string | null
  account_iban: string | null
  period_start: string | null
  period_end: string | null
  statement_date: string | null
  opening_balance: number | null
  closing_balance: number | null
  currency: string
  file_path: string
  original_name: string
  mime_type: string
  size_bytes: number
  status: BankStatementStatus
  extracted_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type BankTxDirection = "debit" | "credit"
export type BankTxMatchStatus = "unmatched" | "suggested" | "confirmed" | "created" | "ignored"
export type BankTxTargetKind =
  | "engagement" | "engagement_charge"
  | "subscription" | "subscription_payment"
  | "income" | "income_receipt"
  | "item" | "item_group" | "merchant" | "reimbursement"

export interface BankStatementTransaction {
  id: string
  statement_id: string
  transaction_date: string
  booking_date: string | null
  raw_description: string
  cleaned_description: string | null
  amount: number
  currency: string
  direction: BankTxDirection
  reference_number: string | null
  counterparty_iban: string | null
  match_target_kind: BankTxTargetKind | null
  match_target_id: string | null
  match_confidence: number | null
  match_rule_id: string | null
  match_status: BankTxMatchStatus
  review_notes: string | null
  /// CSV of item ids for `match_target_kind === "item_group"` at the
  /// suggestion stage. Materialized into a real order_id (and dropped)
  /// once the user confirms.
  match_group_ids: string | null
  created_at: string
  updated_at: string
  match_target_label?: string | null
}

export interface ExtractedTransactionInput {
  transaction_date: string
  booking_date?: string | null
  raw_description: string
  amount: number
  currency?: string
  direction: BankTxDirection
  reference_number?: string | null
  counterparty_iban?: string | null
}

export interface BankMatchRule {
  id: string
  pattern: string
  pattern_kind: "substring" | "regex"
  direction: BankTxDirection | null
  amount_min: number | null
  amount_max: number | null
  target_kind: BankTxTargetKind
  target_id: string
  learned: boolean
  enabled: boolean
  hit_count: number
  last_hit_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ExtractedTransaction {
  date: string
  booking_date: string | null
  description: string
  amount: number
  currency: string
  direction: BankTxDirection
  reference: string | null
  counterparty_iban: string | null
}

export const addBankStatement = (
  sourcePath: string,
  label?: string,
  bankName?: string
) => invoke<BankStatement>("add_bank_statement", { sourcePath, label, bankName })

export const listBankStatements = (params?: { status?: string }) =>
  invoke<BankStatement[]>("list_bank_statements", params ?? {})

export const getBankStatement = (id: string) =>
  invoke<BankStatement>("get_bank_statement", { id })

export const deleteBankStatement = (id: string) =>
  invoke<void>("delete_bank_statement", { id })

export const getBankStatementData = (id: string) =>
  invoke<string>("get_bank_statement_data", { id })

export const saveExtractedTransactions = (
  statementId: string,
  transactions: ExtractedTransactionInput[]
) =>
  invoke<number>("save_extracted_transactions", { statementId, transactions })

export const listStatementTransactions = (statementId: string) =>
  invoke<BankStatementTransaction[]>("list_statement_transactions", { statementId })

export const suggestMatchesForStatement = (statementId: string) =>
  invoke<number>("suggest_matches_for_statement", { statementId })

export const applyTransactionMatch = (
  txId: string,
  targetKind: BankTxTargetKind,
  targetId: string,
  learnRule?: boolean
) =>
  invoke<BankStatementTransaction>("apply_transaction_match", {
    txId,
    targetKind,
    targetId,
    learnRule,
  })

export const ignoreTransaction = (txId: string) =>
  invoke<void>("ignore_transaction", { txId })

/// Orphan-tx flow: create a new item pre-filled from a bank line and
/// stamp the transaction as `created` with a back-link to it.
export const createItemFromTransaction = (
  txId: string,
  item: {
    description: string
    purchase_date: string
    purchase_price: number
    currency?: string
    status?: string
    merchant_id: string
    location_id: string
    payment_card_id?: string
    notes?: string
    invoice_number?: string
    product_reference?: string
    quantity?: number
    price_excl_tax?: number
    tax_rate?: number
    order_id?: string
    item_kind?: ItemKind
    event_datetime?: string
    event_location?: string
    expiration_date?: string
    redemption_url?: string
    redeemed_at?: string
  },
  // Quand un article très proche existe déjà, l'appel échoue avec un message
  // préfixé « DUPLICATE: ». Relancer avec force=true pour créer malgré tout.
  force?: boolean,
) => invoke<Item>("create_item_from_transaction", { txId, item, force })

/// Orphan-tx flow: enqueue a "facture à fournir plus tard" carrying the
/// bank line's amount/date/currency. The user uploads the actual PDF
/// from the pending-invoices page when it arrives.
export const createPendingInvoiceFromTransaction = (
  txId: string,
  label?: string
) =>
  invoke<PendingInvoice>("create_pending_invoice_from_transaction", { txId, label })

export const listMatchRules = (enabled?: boolean) =>
  invoke<BankMatchRule[]>("list_match_rules", { enabled })

export const createMatchRule = (rule: {
  pattern: string
  pattern_kind?: "substring" | "regex"
  direction?: BankTxDirection | null
  amount_min?: number | null
  amount_max?: number | null
  target_kind: BankTxTargetKind
  target_id: string
  learned?: boolean
  notes?: string | null
}) => invoke<BankMatchRule>("create_match_rule", { rule })

export const updateMatchRule = (rule: BankMatchRule) =>
  invoke<void>("update_match_rule", { rule })

export const deleteMatchRule = (id: string) =>
  invoke<void>("delete_match_rule", { id })

export const aiExtractBankStatement = (text: string, config: unknown) =>
  invoke<ExtractedTransaction[]>("ai_extract_bank_statement", { text, config })

// ===========================================================================
// Swiss workflow (v14): household members, tax categories, QR-bill / CamT.053
// ===========================================================================

export type HouseholdRelation = "self" | "spouse" | "child" | "parent" | "other"

export interface HouseholdMember {
  id: string
  name: string
  relation: HouseholdRelation
  birth_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export const listHouseholdMembers = () =>
  invoke<HouseholdMember[]>("list_household_members")

export const createHouseholdMember = (member: {
  name: string
  relation?: HouseholdRelation
  birth_date?: string | null
  notes?: string | null
}) => invoke<HouseholdMember>("create_household_member", { member })

export const updateHouseholdMember = (member: HouseholdMember) =>
  invoke<void>("update_household_member", { member })

export const deleteHouseholdMember = (id: string) =>
  invoke<void>("delete_household_member", { id })

export const setItemAttribution = (itemId: string, memberId: string | null) =>
  invoke<void>("set_item_attribution", { itemId, memberId })

export const setEngagementAttribution = (engagementId: string, memberId: string | null) =>
  invoke<void>("set_engagement_attribution", { engagementId, memberId })

// Tax categories used by the annual declaration view.
export type TaxCategory =
  | "pro"
  | "medical"
  | "don"
  | "entretien"
  | "3a"
  | "formation"
  | "garde_enfant"

export interface TaxBucket {
  category: TaxCategory
  total_chf: number
  count: number
  total_other_currencies: number
}

export interface TaxLine {
  source: "item" | "charge"
  source_id: string
  category: TaxCategory
  date: string
  amount: number
  currency: string
  label: string
  member_id: string | null
  member_name: string | null
}

export const setItemTaxCategory = (itemId: string, category: TaxCategory | null) =>
  invoke<void>("set_item_tax_category", { itemId, category })

export const setChargeTaxCategory = (chargeId: string, category: TaxCategory | null) =>
  invoke<void>("set_charge_tax_category", { chargeId, category })

export const getTaxBuckets = (year: number) =>
  invoke<TaxBucket[]>("get_tax_buckets", { year })

export const listTaxLines = (year: number, category: TaxCategory) =>
  invoke<TaxLine[]>("list_tax_lines", { year, category })

// Swiss QR-bill decoder. Payload is the raw decoded QR text (multi-line SPC).
export interface QrBillCreditor {
  address_type: string
  name: string
  street_or_addr1: string
  house_no_or_addr2: string
  postal_code: string
  city: string
  country: string
}

export interface QrBillDecoded {
  iban: string
  creditor: QrBillCreditor
  amount: number | null
  currency: "CHF" | "EUR"
  reference_type: "QRR" | "SCOR" | "NON"
  reference: string
  unstructured_message: string
  bill_information: string
  suggested_creditor_id: string | null
  suggested_engagement_id: string | null
}

export const decodeQrbill = (payload: string) =>
  invoke<QrBillDecoded>("decode_qrbill", { payload })

// CamT.053 (ISO 20022) bank statement parser.
export interface CamtTransaction {
  booking_date: string | null
  value_date: string | null
  amount: number
  currency: string
  direction: "debit" | "credit"
  description: string
  reference: string | null
  counterparty_iban: string | null
  counterparty_name: string | null
}

export interface CamtStatement {
  account_iban: string | null
  account_currency: string | null
  transactions: CamtTransaction[]
}

export const parseCamt053 = (xml: string) =>
  invoke<CamtStatement>("parse_camt053_text", { xml })

// Bulk seed common Swiss creditors into the active vault.
export interface SeedSummary {
  inserted: number
  skipped: number
}

export const seedSwissCreditors = () =>
  invoke<SeedSummary>("seed_swiss_creditors")

// "Ce mois" landing aggregation.
export interface ToPayLine {
  charge_id: string
  engagement_id: string
  engagement_name: string
  engagement_type: string
  creditor_name: string | null
  due_date: string
  amount: number
  currency: string
  payment_method: string | null
  reference_number: string | null
  days_until: number
}

export interface ToReceiveLine {
  income_id: string
  name: string
  income_type: string
  source: string | null
  next_expected: string
  amount: number
  currency: string
  days_until: number
}

export interface CurrencyTotal {
  currency: string
  amount: number
}

export interface ThisMonthSummary {
  to_pay_lines: ToPayLine[]
  to_receive_lines: ToReceiveLine[]
  // Sous-totaux par devise, sans conversion : aucune devise n'est masquée.
  to_pay_totals: CurrencyTotal[]
  to_receive_totals: CurrencyTotal[]
  net_estimate_totals: CurrencyTotal[]
  inbox_pending_transactions: number
  inbox_pending_invoices: number
}

export const getThisMonth = () =>
  invoke<ThisMonthSummary>("get_this_month")

// ===========================================================================
// Bank transaction classifier — enrichit chaque ligne d'un relevé avec
// marchand reconnu, catégorie de dépense, ville et hint fiscal.
// ===========================================================================

export interface Classification {
  merchant: string | null
  payment_method:
    | "apple_pay"
    | "twint"
    | "qr_bill"
    | "lsv"
    | "withdrawal"
    | "credit_card"
    | null
  category: string | null
  tax_category: TaxCategory | null
  city: string | null
  confidence: number
}

export interface ClassifyResult extends Classification {
  id: string
}

export const classifyTransactions = (
  items: Array<{ id: string; description: string }>,
) => invoke<ClassifyResult[]>("classify_transactions", { items })

// Règles de classification marchand définies par l'utilisateur (extensibles).
export interface MerchantRule {
  id: string
  needle: string
  merchant: string
  category: string | null
  tax_category: string | null
  created_at: string
  updated_at: string
}

export interface MerchantRuleInput {
  needle: string
  merchant: string
  category?: string | null
  tax_category?: string | null
}

export const listMerchantRules = () =>
  invoke<MerchantRule[]>("list_merchant_rules")

export const createMerchantRule = (rule: MerchantRuleInput) =>
  invoke<MerchantRule>("create_merchant_rule", { rule })

export const updateMerchantRule = (id: string, rule: MerchantRuleInput) =>
  invoke<MerchantRule>("update_merchant_rule", { id, rule })

export const deleteMerchantRule = (id: string) =>
  invoke<void>("delete_merchant_rule", { id })

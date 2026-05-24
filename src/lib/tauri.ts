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
  created_at: string
  updated_at: string
  merchant_name?: string
  location_name?: string
  card_name?: string
}

export interface Reminder {
  /// Source row id — items.id for entity_type='item', subscriptions.id for 'subscription'.
  item_id: string
  entity_type: "item" | "subscription"
  description: string
  /// Item kind for items, billing cycle for subscriptions.
  item_kind: string
  reminder_type: "event" | "expiration" | "renewal"
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
  file_path: string
  size_bytes: number
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

export interface Stats {
  total_items: number
  active_items: number
  total_value: number
  total_merchants: number
  total_warranties: number
  total_attachments: number
  monthly_spending: Array<{ month: string; total: number }>
}
export const getStats = () => invoke<Stats>("get_stats")

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

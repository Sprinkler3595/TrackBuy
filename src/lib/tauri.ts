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
  /// Source row id. items.id for 'item',
  /// engagements.id for both 'engagement' and 'charge' (parent, not charge_id).
  item_id: string
  entity_type: "item" | "engagement" | "charge"
  description: string
  /// item_kind for items, engagement_type for engagements/charges.
  item_kind: string
  reminder_type: "event" | "expiration" | "due" | "charge_due" | "notice"
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
  engagement_id: string | null
  engagement_charge_id: string | null
  engagement_revision_id: string | null
  vehicle_expense_id: string | null
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
  /// Données lues sur le ticket par l'OCR + extraction (voir migration v17).
  /// `expected_*` ci-dessus portent montant/date/devise (clés de rapprochement).
  extracted_merchant: string | null
  extracted_invoice_number: string | null
  extracted_tax_rate: number | null
  extracted_price_excl_tax: number | null
  extracted_warranty_months: number | null
  /// null | 'pending' | 'extracted' | 'failed'
  extraction_status: string | null
  extracted_at: string | null
  /// ExtractedReceipt sérialisé (conserve les lignes multi-articles).
  extracted_json: string | null
  created_at: string
  updated_at: string
}

/// Payload de `set_pending_invoice_extraction` : résultat de la passe OCR +
/// extraction lancée au dépôt d'un ticket dans l'inbox.
export interface PendingInvoiceExtraction {
  merchant: string | null
  purchase_date: string | null
  purchase_price: number | null
  currency: string | null
  invoice_number: string | null
  tax_rate: number | null
  price_excl_tax: number | null
  warranty_months: number | null
  extracted_json: string | null
  /// 'extracted' | 'failed'
  status: string
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
export const addAttachment = (
  itemId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string,
  shareWithOrder?: boolean,
) =>
  invoke<Attachment>("add_attachment", { itemId, sourcePath, displayName, attachmentType, shareWithOrder })

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
// Persist the OCR + extraction result onto a stored receipt so it can be
// matched to a bank line (writes expected_amount/date/currency + extracted_*).
export const setPendingInvoiceExtraction = (
  id: string,
  extraction: PendingInvoiceExtraction,
) =>
  invoke<PendingInvoice>("set_pending_invoice_extraction", { id, extraction })
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
export const exportSalaryCertificatesCsv = () =>
  invoke<string>("export_salary_certificates_csv")
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

/// Nature of the scanned document. Drives how the purchase assistant files it
/// (offre / bon de commande / facture / ticket) — the user can always override.
export type DocumentKind = "offer" | "purchase_order" | "invoice" | "receipt"

export interface ExtractedReceipt {
  document_kind: DocumentKind | null
  description: string | null
  purchase_date: string | null
  /// Payment due date (échéance) for a bill — distinct from purchase_date.
  due_date: string | null
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

/// Structured fields extracted from a Swiss car-insurance policy/offer/contract
/// (text layer or OCR). Feeds the car-insurance assistant's auto-fill. Every
/// field is optional — the model returns null for anything it can't find.
export interface ExtractedCarInsurance {
  name: string | null
  insurer_name: string | null
  policy_number: string | null
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_plate: string | null
  vehicle_vin: string | null
  vehicle_registration_number: string | null
  vehicle_category: VehicleCategory | null
  coverage: CarInsuranceCoverage | null
  premium: number | null
  billing_cycle: EngagementBillingCycle | null
  franchise_casco: number | null
  franchise_partial: number | null
  young_driver_franchise: number | null
  bonus_pct: number | null
  contract_start_date: string | null
  contract_end_date: string | null
  next_due_date: string | null
  notice_period_days: number | null
  payment_method: EngagementPaymentMethod | null
  /// Whitelisted extra-coverage slugs (mirror of CAR_INSURANCE_OPTIONS).
  options: string[]
  /// Per-coverage premium breakdown (rc, collision, partial, extras,
  /// passengers, taxes). null when the policy doesn't itemise premiums.
  premium_breakdown: Record<string, number> | null
}

/// Extract a Swiss car-insurance policy's fields from its text (PDF text layer
/// or OCR) so the assistant can pre-fill every step. Uses a strict JSON schema.
export const aiExtractCarInsurance = (ocrText: string, config: AiExtractionConfig) =>
  invoke<ExtractedCarInsurance>("ai_extract_car_insurance", { ocrText, config })

/// Fields extracted from a Swiss car-leasing contract/offer (text or OCR).
export interface ExtractedLeasing {
  name: string | null
  leasing_company: string | null
  contract_reference: string | null
  make: string | null
  model: string | null
  plate: string | null
  vin: string | null
  first_registration: string | null
  monthly_payment: number | null
  vehicle_price: number | null
  down_payment: number | null
  discount: number | null
  residual_value: number | null
  interest_rate_pct: number | null
  duration_months: number | null
  annual_mileage_km: number | null
  excess_km_cost: number | null
  contract_start_date: string | null
  payment_method: EngagementPaymentMethod | null
  currency: string | null
}

export const aiExtractLeasing = (ocrText: string, config: AiExtractionConfig) =>
  invoke<ExtractedLeasing>("ai_extract_leasing", { ocrText, config })

/// Vehicle identity extracted from a Swiss registration document (permis de
/// circulation / Fahrzeugausweis).
export interface ExtractedVehicle {
  name: string | null
  make: string | null
  model: string | null
  plate: string | null
  vin: string | null
  registration_number: string | null
  category: VehicleCategory | null
  energy_type: VehicleEnergyType | null
  first_registration: string | null
  power_kw: number | null
  displacement_cc: number | null
  weight_kg: number | null
  color: string | null
  canton: string | null
}

export const aiExtractVehicle = (ocrText: string, config: AiExtractionConfig) =>
  invoke<ExtractedVehicle>("ai_extract_vehicle", { ocrText, config })

/// Postes d'un bulletin de salaire suisse extraits de son texte (couche PDF ou
/// OCR). Tous les montants reviennent POSITIFS, retenues comprises : le signe
/// dépend de la mise en page de l'employeur, pas du sens du poste.
export interface ExtractedPayslip {
  employer_name: string | null
  period_label: string | null
  period_start: string | null
  period_end: string | null
  received_on: string | null
  net_paid: number | null
  gross_amount: number | null
  base_salary: number | null
  thirteenth: number | null
  overtime: number | null
  overtime_hours: number | null
  holiday_pay: number | null
  bonus: number | null
  benefits_in_kind: number | null
  company_car_private: number | null
  family_allowance: number | null
  other_gross: number | null
  avs_ai_apg: number | null
  ac: number | null
  ac_solidarity: number | null
  lpp: number | null
  laa_nonoccupational: number | null
  ijm: number | null
  tax_at_source: number | null
  other_deductions: number | null
  expense_reimbursement: number | null
  expense_lump_sum: number | null
  currency: string | null
}

export const aiExtractPayslip = (ocrText: string, config: AiExtractionConfig) =>
  invoke<ExtractedPayslip>("ai_extract_payslip", { ocrText, config })

/// Rubriques d'un certificat de salaire suisse (formulaire 11).
export interface ExtractedSalaryCertificate {
  employer_name: string | null
  employee_name: string | null
  fiscal_year: number | null
  r1_salary: number | null
  r2_1_benefits_in_kind: number | null
  r2_2_company_car: number | null
  r2_3_other_benefits: number | null
  r3_irregular: number | null
  r4_capital_shares: number | null
  r5_board_fees: number | null
  r6_other_benefits: number | null
  r7_other_payments: number | null
  r8_gross_total: number | null
  r9_social_contributions: number | null
  r10_1_lpp_ordinary: number | null
  r10_2_lpp_buyback: number | null
  r11_net_salary: number | null
  r12_tax_at_source: number | null
  r13_1_effective_expenses: number | null
  r13_2_lump_sum_expenses: number | null
  r14_other_disclosures: number | null
  r15_remarks: string | null
  box_f_employer_transport: boolean | null
  box_g_free_meals: boolean | null
}

export const aiExtractSalaryCertificate = (
  ocrText: string,
  config: AiExtractionConfig,
) =>
  invoke<ExtractedSalaryCertificate>("ai_extract_salary_certificate", {
    ocrText,
    config,
  })

/// Focused, schema-constrained extraction of just the payment due date —
/// reliable even with a small local model (e.g. Ministral 8B). Returns an ISO
/// date or null.
export const aiExtractDueDate = (ocrText: string, config: AiExtractionConfig) =>
  invoke<string | null>("ai_extract_due_date", { ocrText, config })

/// Vision variant: reads the due date off a rendered invoice image (base64
/// data URL), no OCR needed. Infomaniak (cloud vision) only. Returns ISO or null.
export const aiExtractDueDateFromImage = (imageDataUrl: string, config: AiExtractionConfig) =>
  invoke<string | null>("ai_extract_due_date_image", { imageDataUrl, config })

export const aiTestConnection = (config: AiExtractionConfig) =>
  invoke<string>("ai_test_connection", { config })

/// One calendar month of accumulated AI token usage (this vault). `promptTokens`
/// = tokens sent (input), `completionTokens` = tokens received (output).
export interface AiUsageMonth {
  month: string
  prompt_tokens: number
  completion_tokens: number
  calls: number
}

/// Monthly AI token usage (sent/received) for the active vault, newest first.
export const getAiUsage = () => invoke<AiUsageMonth[]>("get_ai_usage")

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
  | "electricity" | "gas" | "water" | "fuel" | "vehicle_tax" | "heating"
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
  // Parking specifics (engagement_type 'parking'); null otherwise.
  parking_spot_number: string | null
  parking_kind: ParkingKind | null
  // Vehicle leasing specifics (engagement_type 'leasing'); null otherwise.
  vehicle_make: string | null
  vehicle_model: string | null
  vehicle_plate: string | null
  vehicle_vin: string | null
  vehicle_first_registration: string | null
  leasing_vehicle_price: number | null
  leasing_duration_months: number | null
  leasing_down_payment: number | null
  leasing_residual_value: number | null
  leasing_interest_rate_pct: number | null
  leasing_annual_mileage_km: number | null
  leasing_excess_km_cost: number | null
  leasing_discount: number | null
  // Car insurance specifics (engagement_type 'insurance_car'); null otherwise.
  insurance_coverage: CarInsuranceCoverage | null
  insurance_franchise_casco: number | null
  insurance_franchise_partial: number | null
  insurance_bonus_pct: number | null
  /// JSON array of extra-coverage slugs (see CAR_INSURANCE_OPTIONS).
  insurance_options_json: string | null
  /// JSON object: per-coverage premium breakdown (rc, collision, partial,
  /// extras, passengers, taxes).
  insurance_premium_breakdown_json: string | null
  vehicle_category: VehicleCategory | null
  vehicle_registration_number: string | null
  vehicle_is_leasing: boolean | null
  insurance_young_driver_franchise: number | null
  created_at: string
  updated_at: string
  creditor_name?: string | null
  card_name?: string | null
  parent_name?: string | null
}

// Parking spot location, for parking engagements (usually a child of a rent).
export type ParkingKind = "outdoor" | "collective_garage" | "box"

// Car insurance coverage level: RC only, RC + partial casco, RC + full casco.
export type CarInsuranceCoverage = "rc" | "partial_casco" | "full_casco"

// Vehicle category (Swiss vehicle types).
export type VehicleCategory =
  | "passenger_car" | "motorcycle" | "light_commercial" | "motorhome" | "other"

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
  parking_spot_number?: string | null
  parking_kind?: ParkingKind | null
  vehicle_make?: string | null
  vehicle_model?: string | null
  vehicle_plate?: string | null
  vehicle_vin?: string | null
  vehicle_first_registration?: string | null
  leasing_vehicle_price?: number | null
  leasing_duration_months?: number | null
  leasing_down_payment?: number | null
  leasing_residual_value?: number | null
  leasing_interest_rate_pct?: number | null
  leasing_annual_mileage_km?: number | null
  leasing_excess_km_cost?: number | null
  leasing_discount?: number | null
  insurance_coverage?: CarInsuranceCoverage | null
  insurance_franchise_casco?: number | null
  insurance_franchise_partial?: number | null
  insurance_bonus_pct?: number | null
  insurance_options_json?: string | null
  insurance_premium_breakdown_json?: string | null
  vehicle_category?: VehicleCategory | null
  vehicle_registration_number?: string | null
  vehicle_is_leasing?: boolean | null
  insurance_young_driver_franchise?: number | null
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
// Vehicles (the "espace véhicule" hub: groups leasing / insurance / tax /
// expenses for one car)
// ============================================================================

export type VehicleEnergyType =
  | "electric" | "gasoline" | "diesel" | "hybrid" | "phev" | "other"

export type VehicleStatus = "active" | "sold" | "scrapped"

export interface Vehicle {
  id: string
  name: string
  make: string | null
  model: string | null
  plate: string | null
  vin: string | null
  registration_number: string | null
  category: VehicleCategory | null
  energy_type: VehicleEnergyType | null
  first_registration: string | null
  canton: string | null
  color: string | null
  power_kw: number | null
  displacement_cc: number | null
  weight_kg: number | null
  battery_kwh: number | null
  purchase_date: string | null
  purchase_price: number | null
  odometer_km: number | null
  status: VehicleStatus
  sold_on: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/// Lightweight view of an engagement attached (or attachable) to a vehicle.
export interface VehicleEngagementSummary {
  id: string
  name: string
  engagement_type: EngagementType
  current_amount: number | null
  currency: string
  billing_cycle: EngagementBillingCycle
  cycle_interval: number
  status: EngagementStatus
  next_due_date: string | null
  contract_end_date: string | null
  vehicle_plate: string | null
  vehicle_id: string | null
}

export const getVehicles = () => invoke<Vehicle[]>("get_vehicles")
export const getVehicle = (id: string) => invoke<Vehicle>("get_vehicle", { id })
export const createVehicle = (vehicle: {
  name: string
  make?: string | null
  model?: string | null
  plate?: string | null
  vin?: string | null
  registration_number?: string | null
  category?: VehicleCategory | null
  energy_type?: VehicleEnergyType | null
  first_registration?: string | null
  canton?: string | null
  color?: string | null
  power_kw?: number | null
  displacement_cc?: number | null
  weight_kg?: number | null
  battery_kwh?: number | null
  purchase_date?: string | null
  purchase_price?: number | null
  odometer_km?: number | null
  notes?: string | null
}) => invoke<Vehicle>("create_vehicle", { vehicle })
export const updateVehicle = (vehicle: Vehicle) => invoke<void>("update_vehicle", { vehicle })
export const deleteVehicle = (id: string) => invoke<void>("delete_vehicle", { id })
export const getVehicleEngagements = (vehicleId: string) =>
  invoke<VehicleEngagementSummary[]>("get_vehicle_engagements", { vehicleId })
export const getLinkableVehicleEngagements = () =>
  invoke<VehicleEngagementSummary[]>("get_linkable_vehicle_engagements")
export const setEngagementVehicle = (engagementId: string, vehicleId: string | null) =>
  invoke<void>("set_engagement_vehicle", { engagementId, vehicleId })

// --- Vehicle expense ledger (charging, fuel, tires, maintenance…) ---

export type VehicleExpenseCategory =
  | "charging" | "fuel" | "tires" | "maintenance" | "repair" | "cleaning"
  | "accessories" | "inspection" | "vignette" | "parking" | "fine" | "toll" | "tax" | "other"

export interface VehicleExpense {
  id: string
  vehicle_id: string
  expense_date: string
  category: VehicleExpenseCategory
  description: string | null
  amount: number
  currency: string
  odometer_km: number | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  location: string | null
  merchant: string | null
  payment_card_id: string | null
  next_due_km: number | null
  next_due_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
  card_name?: string | null
}

export interface VehicleExpenseCategoryTotal {
  category: VehicleExpenseCategory
  total: number
  count: number
}

export interface VehicleExpenseSummary {
  total: number
  total_year: number
  count: number
  by_category: VehicleExpenseCategoryTotal[]
}

export const getVehicleExpenses = (vehicleId: string) =>
  invoke<VehicleExpense[]>("get_vehicle_expenses", { vehicleId })
export const createVehicleExpense = (expense: {
  vehicle_id: string
  expense_date: string
  category: VehicleExpenseCategory
  amount: number
  currency?: string | null
  description?: string | null
  odometer_km?: number | null
  quantity?: number | null
  unit?: string | null
  unit_price?: number | null
  location?: string | null
  merchant?: string | null
  payment_card_id?: string | null
  next_due_km?: number | null
  next_due_date?: string | null
  notes?: string | null
}) => invoke<VehicleExpense>("create_vehicle_expense", { expense })
export const updateVehicleExpense = (expense: VehicleExpense) =>
  invoke<void>("update_vehicle_expense", { expense })
export const deleteVehicleExpense = (id: string) =>
  invoke<void>("delete_vehicle_expense", { id })
export const getVehicleExpenseSummary = (vehicleId: string) =>
  invoke<VehicleExpenseSummary>("get_vehicle_expense_summary", { vehicleId })
export const getVehicleExpenseAttachments = (expenseId: string) =>
  invoke<Attachment[]>("get_vehicle_expense_attachments", { expenseId })
export const addVehicleExpenseAttachment = (
  expenseId: string,
  sourcePath: string,
  displayName?: string,
  attachmentType?: string,
) => invoke<Attachment>("add_vehicle_expense_attachment", { expenseId, sourcePath, displayName, attachmentType })

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
  /// Membre du ménage. Aucune UI ne l'expose encore : la colonne existe pour
  /// qu'un second revenu puisse entrer sans migration cassante.
  attributed_to_member_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  card_name?: string | null
}

/// Un versement. Pour un salaire c'est un bulletin complet ; pour une
/// allocation ou un dividende seuls `amount` et la date comptent.
///
/// Deux distinctions du droit suisse expliquent les champs séparés : les
/// allocations familiales sont imposables mais pas soumises aux cotisations
/// (art. 6 RAVS), et les frais remboursés ne sont ni l'un ni l'autre
/// (art. 327a CO).
export interface IncomeReceipt {
  id: string
  income_id: string
  received_on: string
  /// Net effectivement versé.
  amount: number
  currency: string
  period_label: string | null
  period_start: string | null
  period_end: string | null
  /// Peut différer de l'année de `received_on` : un salaire de décembre versé
  /// en janvier appartient à l'exercice précédent.
  fiscal_year: number | null

  // Brut
  gross_amount: number | null
  base_salary_amount: number | null
  thirteenth_amount: number | null
  overtime_amount: number | null
  overtime_hours: number | null
  holiday_pay_amount: number | null
  bonus_amount: number | null
  benefits_in_kind_amount: number | null
  company_car_private_amount: number | null
  family_allowance_amount: number | null
  other_gross_amount: number | null

  // Retenues. `social_charges_amount` = AVS/AI/APG, `pension_amount` = LPP
  // (noms hérités du schéma v10, conservés pour les coffres existants).
  social_charges_amount: number | null
  ac_amount: number | null
  ac_solidarity_amount: number | null
  pension_amount: number | null
  laa_nonoccupational_amount: number | null
  ijm_amount: number | null
  tax_at_source_amount: number | null
  other_deductions_amount: number | null

  // Frais remboursés (ch. 13 du certificat)
  expense_reimbursement_amount: number | null
  expense_lump_sum_amount: number | null

  notes: string | null
  created_at: string
}

/// Termes de l'emploi. `lpp_employee_share_pct`, `laa_nonoccupational_pct` et
/// `ijm_employee_pct` sont contractuels : sans eux le moteur annonce qu'il ne
/// peut pas vérifier la retenue correspondante plutôt que d'inventer.
export interface EmploymentContract {
  id: string
  income_id: string
  /// Ce qui distingue cette version des autres : « Contrat initial »,
  /// « Avenant 2021 — augmentation ».
  label: string | null
  employer_name: string | null
  /// IDE, format CHE-123.456.789
  employer_uid: string | null
  /// N° AVS, format 756.xxxx.xxxx.xx
  avs_number: string | null
  /// Sert uniquement à la tranche de bonification LPP.
  birth_date: string | null
  /// Canton de travail — c'est lui qui fixe le barème des allocations
  /// familiales, pas le canton de domicile.
  /// Siège de l'employeur : retenues sociales cantonales et caisse
  /// d'allocations familiales.
  work_canton: string | null
  /// Domicile du salarié : barème d'impôt à la source, qui suit le domicile et
  /// non le lieu de travail.
  residence_canton: string | null
  /// `residence` (la règle) ou `work` (l'employeur retient selon son canton).
  tax_at_source_canton_source: string
  activity_rate_pct: number | null
  annual_gross_agreed: number | null
  salary_periods_per_year: number | null
  weekly_hours: number | null
  hourly_paid: boolean
  thirteenth_salary: boolean
  lpp_fund_name: string | null
  lpp_employee_share_pct: number | null
  /// `total` = tout le brut est assuré, suppléments compris ; `base` = seul le
  /// salaire contractuel l'est.
  lpp_insured_scope: string
  laa_insurer: string | null
  laa_nonoccupational_pct: number | null
  ijm_employee_pct: number | null
  tax_at_source: boolean
  tax_at_source_scale: string | null
  /// Taux effectif lu sur la fiche de salaire, utilisé tant qu'aucun
  /// barème cantonal n'est importé.
  tax_at_source_rate_pct: number | null
  /// Prix d'achat HT : la part privée vaut 0.9 %/mois de ce montant.
  company_car_purchase_price: number | null
  subsidized_canteen: boolean
  commute_km_per_day: number | null
  commute_public_transport_cost_year: number | null
  started_on: string | null
  ended_on: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/// Certificat de salaire annuel (formulaire 11). L'employeur doit l'établir
/// même sans demande du salarié (art. 127 LIFD).
export interface SalaryCertificate {
  id: string
  income_id: string
  fiscal_year: number
  r1_salary: number | null
  r2_1_benefits_in_kind: number | null
  r2_2_company_car: number | null
  r2_3_other_benefits: number | null
  r3_irregular: number | null
  r4_capital_shares: number | null
  r5_board_fees: number | null
  r6_other_benefits: number | null
  r7_other_payments: number | null
  r8_gross_total: number | null
  r9_social_contributions: number | null
  r10_1_lpp_ordinary: number | null
  r10_2_lpp_buyback: number | null
  r11_net_salary: number | null
  r12_tax_at_source: number | null
  r13_1_effective_expenses: number | null
  r13_2_lump_sum_expenses: number | null
  r14_other_disclosures: number | null
  r15_remarks: string | null
  /// Case F : transport domicile-travail payé par l'employeur.
  box_f_employer_transport: boolean
  /// Case G : repas gratuits — réduit le forfait repas déductible.
  box_g_free_meals: boolean
  received_on: string | null
  origin: "manual" | "ai_scan" | "computed"
  notes: string | null
  created_at: string
  updated_at: string
}

/// Barèmes légaux d'une année. Aucune de ces valeurs n'est codée côté front :
/// elles viennent toutes de `getPayrollParams`.
export interface PayrollParams {
  year: number
  /// `true` quand aucun barème n'est publié pour l'année demandée et que
  /// ceux de `effective_year` sont appliqués à la place.
  estimated: boolean
  effective_year: number
  source: string
  verified_on: string
  avs_ai_apg_employee_pct: number
  avs_ai_apg_employer_pct: number
  ac_employee_pct: number
  ac_ceiling: number
  /// Supprimé au 1.1.2023, non nul pour les années antérieures.
  ac_solidarity_employee_pct: number
  laa_max_insured: number
  laa_nonoccupational_min_weekly_hours: number
  lpp_entry_threshold: number
  lpp_coordination_deduction: number
  lpp_avs_upper_limit: number
  lpp_min_coordinated: number
  lpp_credit_brackets: Array<[number, number, number]>
  pillar3a_with_lpp: number
  pillar3a_without_lpp_pct: number
  pillar3a_without_lpp_cap: number
  pro_lump_sum_pct: number
  pro_lump_sum_min: number
  pro_lump_sum_max: number
  meals_full_year: number
  meals_subsidized_year: number
  meals_full_day: number
  meals_subsidized_day: number
  commute_cap_ifd: number
  commute_private_car_per_km: number
  private_car_monthly_pct: number
  private_car_monthly_min: number
  family_allowance_min_child: number
  family_allowance_min_training: number
  /// Retenues propres au canton de travail. Vides tant qu'aucun taux n'est
  /// saisi — ce qui est exact dans la plupart des cantons.
  cantonal: {
    canton: string | null
    /// Cotisation salariée aux allocations familiales (VD, VS).
    family_allowance_employee_pct: number
    /// Assurance maternité cantonale, part employé (GE).
    maternity_employee_pct: number
  }
}

/// Taux salariés d'un canton pour une année.
export interface CantonalRates {
  canton: string
  year: number
  family_allowance_employee_pct: number | null
  maternity_employee_pct: number | null
  note: string | null
}

/// Ce que rend `getPayrollParams` : le barème, plus de quoi le situer.
///
/// Distinct de `PayrollParams` parce que le contrôle d'un bulletin ne reçoit
/// que le barème nu (`PayslipReport.params`) : déclarer ces champs sur le type
/// de base ferait croire à leur présence là où ils n'existent pas.
export interface PayrollParamsResponse extends PayrollParams {
  /// Années publiées dans le code.
  known_years: number[]
  /// Champs que l'utilisateur a redéfinis pour cette année dans
  /// Paramètres → Barèmes. Le reste vient des valeurs livrées.
  overridden_fields: string[]
  /// Années pour lesquelles une saisie existe — elles s'ajoutent au
  /// sélecteur, sinon une année créée à la main serait invisible.
  edited_years: number[]
  /// Années où des bulletins ou des certificats existent réellement. C'est ce
  /// qui rend une carrière ancienne atteignable dans les sélecteurs d'année.
  data_years: number[]
  /// L'utilisateur a déclaré avoir vérifié cette année auprès d'une source.
  confirmed: boolean
  /// L'année est livrée avec l'application.
  published: boolean
  /// Ni publiée ni confirmée : les contrôles de conformité plafonnent en
  /// avertissement, car un écart pourrait venir du barème lui-même.
  provisional: boolean
}

/// Un taux tel que les bulletins d'une année le révèlent.
export interface InferredRate {
  field: string
  label: string
  value: number
  /// Bulletins qui appliquent ce taux.
  agreeing: number
  total: number
  /// Périodes qui s'en écartent — le mois à regarder de près.
  outliers: string[]
}

export interface InferredParams {
  year: number
  rates: InferredRate[]
  receipt_count: number
}

/// Valeurs surchargeables d'une année. `null` = « garder la valeur livrée ».
export type PayrollOverrideInput = Partial<
  Record<
    | "avs_ai_apg_employee_pct" | "avs_ai_apg_employer_pct"
    | "ac_employee_pct" | "ac_ceiling" | "ac_solidarity_employee_pct"
    | "laa_max_insured" | "laa_nonoccupational_min_weekly_hours"
    | "lpp_entry_threshold" | "lpp_coordination_deduction"
    | "lpp_avs_upper_limit" | "lpp_min_coordinated"
    | "pillar3a_with_lpp" | "pillar3a_without_lpp_pct" | "pillar3a_without_lpp_cap"
    | "pro_lump_sum_pct" | "pro_lump_sum_min" | "pro_lump_sum_max"
    | "meals_full_year" | "meals_subsidized_year" | "meals_full_day" | "meals_subsidized_day"
    | "commute_cap_ifd" | "commute_private_car_per_km"
    | "private_car_monthly_pct" | "private_car_monthly_min"
    | "family_allowance_min_child" | "family_allowance_min_training",
    number | null
  >
> & {
  lpp_credit_brackets?: Array<[number, number, number]> | null
  note?: string | null
  /// « J'ai vérifié ces chiffres auprès de la source. »
  confirmed?: boolean | null
}

/// Termes de l'emploi tels que le moteur de paie les attend.
export interface EmploymentTerms {
  birth_date?: string | null
  activity_rate_pct?: number | null
  weekly_hours?: number | null
  annual_gross_agreed?: number | null
  salary_periods_per_year?: number | null
  hourly_paid?: boolean
  lpp_employee_share_pct?: number | null
  laa_nonoccupational_pct?: number | null
  ijm_employee_pct?: number | null
  /// `base` = seul le salaire contractuel est assuré ; sinon tout le brut.
  lpp_insured_scope?: string | null
  tax_at_source?: boolean
  company_car_purchase_price?: number | null
  subsidized_canteen?: boolean
  thirteenth_salary?: boolean
}

/// Une période de paie projetée. `null` sur une retenue = taux inconnu, donc
/// RIEN n'a été retenu et le net est surévalué d'autant. À ne pas confondre
/// avec `0`, qui veut dire « rien n'est dû ».
export interface ProjectedPeriod {
  index: number
  gross: number
  avs_subject_gross: number
  avs_ai_apg: number
  ac: number
  ac_solidarity: number
  laa_nonoccupational: number | null
  ijm: number | null
  lpp_employee: number | null
  tax_at_source: number | null
  /// Prélèvements propres au canton de travail (allocations familiales en
  /// VD/VS, assurance maternité en GE). Zéro ailleurs.
  cantonal: number
  total_deductions: number
  net: number
}

export interface NetProjection {
  periods: ProjectedPeriod[]
  periods_per_year: number
  annual_gross: number
  annual_net: number
  /// Tant que ce n'est pas vide, le net est un MAJORANT.
  uncomputable: string[]
  /// Vrai quand le plafond annuel de l'AC est franchi en cours d'année.
  varies_across_year: boolean
}

/// D'où vient le montant d'impôt à la source affiché.
export type TaxSource = "tariff" | "manual_rate" | "not_subject" | "unavailable"

export interface NetFromGrossRequest {
  year: number
  gross_per_period: number
  family_allowance?: number | null
  /// Suppléments d'une période type — astreinte, week-ends.
  supplements_per_period?: number | null
  terms: EmploymentTerms
  work_canton?: string | null
  residence_canton?: string | null
  tax_at_source_scale?: string | null
  tax_at_source_rate_pct?: number | null
  income_id?: string | null
}

export interface NetFromGrossResponse {
  projection: NetProjection
  params: PayrollParams
  overridden_fields: string[]
  tax_source: TaxSource
  tax_tariff_code: string | null
  tax_annual_model: boolean
  /// Les deux cantons retenus, pour que l'écran dise lequel a servi à quoi.
  tax_canton: string | null
  social_canton: string | null
  /// Net d'une période type — le montant à enregistrer pour le revenu.
  net_per_period: number
}

/// Un barème cantonal d'impôt à la source importé par l'utilisateur.
export interface TariffImport {
  id: string
  canton: string
  fiscal_year: number
  source_file: string
  file_created_on: string | null
  row_count: number
  imported_at: string
  /// FR, GE, TI, VD, VS taxent le revenu annualisé, pas le mois.
  annual_model: boolean
}

/// Une année de cotisations chez un employeur.
///
/// Les postes détaillés sont `null` quand l'année n'est connue que par son
/// certificat de salaire : celui-ci ne publie qu'un total (rubrique 9), pas la
/// répartition. `null` veut donc dire « inconnu », jamais « zéro ».
export interface ContributionYear {
  year: number
  income_id: string
  income_name: string
  employer_name: string | null
  gross_total: number
  /// Total des cotisations sociales (rubrique 9). Toujours connu.
  social_total: number
  avs_ai_apg: number | null
  ac: number | null
  ac_solidarity: number | null
  laa_nonoccupational: number | null
  lpp: number
  /// Retenue réelle du bulletin, absente du certificat de salaire.
  ijm: number | null
  other_deductions: number | null
  tax_at_source: number
  net: number
  receipt_count: number
  /// `payslips` = reconstituée depuis les bulletins, avec le détail.
  /// `certificate` = seul le certificat annuel subsiste.
  source: "payslips" | "certificate"
  /// Écart de brut entre le certificat reçu et la somme des bulletins :
  /// le signal qu'un bulletin manque à l'année.
  certificate_gap: number | null
}

export interface ContributionTotals {
  gross_total: number
  social_total: number
  lpp: number
  tax_at_source: number
  net: number
  avs_ai_apg: number
  ac: number
  /// Postes dont au moins une année n'a pas livré le détail : leur total est
  /// donc incomplet, et l'écran doit le dire.
  partial_fields: string[]
  years_covered: number
  receipt_count: number
}

export interface ContributionsHistory {
  rows: ContributionYear[]
  first_year: number | null
  last_year: number | null
  totals: ContributionTotals
}

/// Une ligne du barème de suppléments d'une entreprise : astreinte à la
/// semaine, samedi travaillé, dimanche travaillé…
///
/// Rattachée à UNE version de contrat : un avenant peut changer le tarif du
/// dimanche, et l'historique doit dire ce qu'il valait en 2019.
export interface SupplementRate {
  id: string
  contract_id: string
  /// Identifiant stable dans le barème, dérivé du libellé si on ne le fournit
  /// pas. C'est lui qui relie une quantité saisie au tarif applicable.
  code: string
  label: string
  /// `week` | `day` | `hour` | `flat`
  unit: string
  amount: number
  sort_order: number
}

/// Ce qui a réellement été accompli sur un mois : 1 semaine d'astreinte,
/// 2 dimanches. Le montant, lui, est reporté dans `other_gross_amount`.
export interface ReceiptSupplement {
  id: string
  receipt_id: string
  code: string
  label: string
  quantity: number
  /// Tarif figé au moment de la saisie : changer le barème ne réécrit pas le
  /// passé.
  unit_amount: number
  amount: number
}

export interface SupplementYearTotal {
  code: string
  label: string
  quantity: number
  amount: number
}

export type FindingSeverity = "ok" | "info" | "warn" | "error"

/// Un constat du contrôle de conformité. `expected: null` signale un contrôle
/// impossible (taux contractuel manquant) — pas un montant nul.
export interface PayslipFinding {
  id: string
  severity: FindingSeverity
  label: string
  message: string
  legal_ref: string
  expected: number | null
  actual: number | null
}

export interface ExpectedDeductions {
  avs_subject_gross: number
  avs_ai_apg: number
  ac_base: number
  ac: number
  ac_solidarity: number
  laa_nonoccupational: number | null
  ijm: number | null
  lpp_coordinated_salary: number
  lpp_minimum_annual_credit: number
  lpp_employee: number | null
  /// L'employeur doit financer au moins la moitié de la bonification.
  lpp_employee_legal_cap: number
  cantonal_family_allowance: number
  cantonal_maternity: number
}

export interface PayslipReport {
  findings: PayslipFinding[]
  expected: ExpectedDeductions
  params: PayrollParams
  /// Cumul annuel avant cette période, utilisé pour le plafond AC.
  ytd_before: number
  has_contract: boolean
  /// Barème ni livré ni confirmé : les constats ont été rabattus en
  /// avertissements, car un écart pourrait venir du barème lui-même.
  params_provisional: boolean
}

export interface CertificateDiff {
  rubric: string
  label: string
  computed: number | null
  declared: number | null
  difference: number | null
  mismatch: boolean
}

export interface CertificateReconciliation {
  year: number
  computed: SalaryCertificate
  declared: SalaryCertificate | null
  diffs: CertificateDiff[]
  receipt_count: number
}

/// Comparatif forfait / frais effectifs. Les deux branches sont rendues :
/// c'est au contribuable de retenir la plus favorable.
export interface ProfessionalExpenses {
  lump_sum_other_expenses: number
  commute_claimed: number
  commute_capped: number
  commute_cap: number
  meals: number
  meals_reduced_by_employer: boolean
  total: number
  /// Ce que le calcul n'a pas pu établir, à afficher tel quel.
  notes: string[]
}

export interface SalarySource {
  income_id: string
  name: string
  employer_name: string | null
  receipt_count: number
  gross_total: number
  net_salary: number
  has_contract: boolean
  has_declared_certificate: boolean
}

export interface IncomeTaxSummary {
  year: number
  /// Le barème de l'année, et de quoi alimenter le sélecteur d'année.
  params: PayrollParamsResponse
  gross_total: number
  social_contributions: number
  lpp_contributions: number
  net_salary: number
  tax_at_source: number
  other_income_by_type: Array<{ income_type: string; total: number; count: number }>
  professional_expenses: ProfessionalExpenses
  pillar3a_cap: number
  affiliated_to_lpp: boolean
  salary_sources: SalarySource[]
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
  /// Emploi déjà terminé : date de fin.
  ended_on?: string | null
  attributed_to_member_id?: string | null
  notes?: string | null
}) => invoke<Income>("create_income", { income })

export const updateIncome = (income: Income) =>
  invoke<void>("update_income", { income })

export const deleteIncome = (id: string) =>
  invoke<void>("delete_income", { id })

// Income receipts (each reception, with optional payslip detail)
export const getIncomeReceipts = (incomeId: string) =>
  invoke<IncomeReceipt[]>("get_income_receipts", { incomeId })

/// Tous les postes du bulletin sont optionnels : un dividende ne remplit que
/// `amount`, un salaire remplit tout. `fiscal_year` est déduit de la période
/// (ou de la date d'encaissement) quand il n'est pas fourni.
export type CreateIncomeReceipt = {
  income_id: string
  received_on: string
  amount: number
  currency?: string
  period_label?: string | null
  period_start?: string | null
  period_end?: string | null
  fiscal_year?: number | null
} & Partial<
  Pick<
    IncomeReceipt,
    | "gross_amount"
    | "base_salary_amount"
    | "thirteenth_amount"
    | "overtime_amount"
    | "overtime_hours"
    | "holiday_pay_amount"
    | "bonus_amount"
    | "benefits_in_kind_amount"
    | "company_car_private_amount"
    | "family_allowance_amount"
    | "other_gross_amount"
    | "social_charges_amount"
    | "ac_amount"
    | "ac_solidarity_amount"
    | "pension_amount"
    | "laa_nonoccupational_amount"
    | "ijm_amount"
    | "tax_at_source_amount"
    | "other_deductions_amount"
    | "expense_reimbursement_amount"
    | "expense_lump_sum_amount"
    | "notes"
  >
>

/// Verdict d'une ligne d'un import en lot. Un lot de deux cents fiches ne
/// peut pas échouer en bloc pour un doublon : chaque ligne a son verdict.
export interface BulkReceiptResult {
  /// Position dans le lot envoyé — à utiliser pour recoller le verdict à sa
  /// ligne, plutôt que l'ordre de retour.
  index: number
  status: "created" | "replaced" | "duplicate" | "rejected"
  receipt_id: string | null
  existing_id: string | null
  message: string | null
}

/// Enregistre plusieurs bulletins en une transaction. Tout est validé avant
/// la moindre écriture : un lot à moitié importé serait pire que rien.
export const logIncomeReceiptsBulk = (
  receipts: CreateIncomeReceipt[],
  replaceDuplicates = false,
) =>
  invoke<BulkReceiptResult[]>("log_income_receipts_bulk", {
    receipts,
    replaceDuplicates,
  })

export const logIncomeReceipt = (receipt: CreateIncomeReceipt) =>
  invoke<IncomeReceipt>("log_income_receipt", { receipt })

export const updateIncomeReceipt = (receipt: IncomeReceipt) =>
  invoke<void>("update_income_receipt", { receipt })

export const deleteIncomeReceipt = (id: string) =>
  invoke<void>("delete_income_receipt", { id })

// ---------------------------------------------------------------------------
// Paie suisse : barèmes, contrat de travail, contrôle, certificat de salaire
// ---------------------------------------------------------------------------

/// Barèmes légaux de l'année. Le front ne code aucun taux : il les lit ici.
export const getPayrollParams = (year: number) =>
  invoke<PayrollParamsResponse>("get_payroll_params", { year })

/// Enregistre les corrections de barème d'une année. L'envoi est un
/// remplacement complet : un champ omis redevient la valeur livrée.
export const upsertPayrollOverrides = (year: number, values: PayrollOverrideInput) =>
  invoke<PayrollParamsResponse>("upsert_payroll_overrides", { year, values })

/// Rend une année à ses valeurs livrées.
export const resetPayrollOverrides = (year: number) =>
  invoke<PayrollParamsResponse>("reset_payroll_overrides", { year })

/// Recopie une année sur une autre, corrections comprises — le geste du
/// 1er janvier.
export const duplicatePayrollYear = (fromYear: number, toYear: number) =>
  invoke<PayrollParamsResponse>("duplicate_payroll_year", { fromYear, toYear })

/// Propose les taux que les bulletins d'une année révèlent. Ne démontre pas
/// que l'employeur avait raison — démontre qu'il a été cohérent, et désigne le
/// mois qui sort du lot.
/// Taux salariés cantonaux saisis pour une année.
export const getCantonalRates = (year: number) =>
  invoke<CantonalRates[]>("get_cantonal_rates", { year })

/// Enregistre les taux d'un canton. Deux taux vides retirent le canton.
export const upsertCantonalRates = (rates: CantonalRates) =>
  invoke<CantonalRates[]>("upsert_cantonal_rates", { rates })

export const inferPayrollParams = (year: number) =>
  invoke<InferredParams>("infer_payroll_params", { year })

/// Projette une année de paie à partir d'un brut par période.
export const computeNetFromGross = (req: NetFromGrossRequest) =>
  invoke<NetFromGrossResponse>("compute_net_from_gross", { req })

export const listTaxAtSourceImports = () =>
  invoke<TariffImport[]>("list_tax_at_source_imports")

/// Importe un fichier de barèmes cantonal (TXT ou ZIP officiel).
export const importTaxAtSourceTariff = (canton: string, fiscalYear: number, filePath: string) =>
  invoke<TariffImport>("import_tax_at_source_tariff", { canton, fiscalYear, filePath })

export const deleteTaxAtSourceImport = (canton: string, fiscalYear: number) =>
  invoke<void>("delete_tax_at_source_import", { canton, fiscalYear })

export const getEmploymentContract = (incomeId: string) =>
  invoke<EmploymentContract | null>("get_employment_contract", { incomeId })

export const upsertEmploymentContract = (contract: EmploymentContract) =>
  invoke<EmploymentContract>("upsert_employment_contract", { contract })

/// Toutes les versions d'un contrat, de la plus récente à la plus ancienne.
/// Un avenant est une version ; il n'écrase pas la précédente, il lui succède.
export const getEmploymentContractVersions = (incomeId: string) =>
  invoke<EmploymentContract[]>("get_employment_contract_versions", { incomeId })

export const deleteEmploymentContractVersion = (id: string) =>
  invoke<void>("delete_employment_contract_version", { id })

/// Barème de suppléments d'une version de contrat.
export const getSupplementRates = (contractId: string) =>
  invoke<SupplementRate[]>("get_supplement_rates", { contractId })

export const upsertSupplementRate = (rate: SupplementRate) =>
  invoke<SupplementRate[]>("upsert_supplement_rate", { rate })

export const deleteSupplementRate = (id: string) =>
  invoke<void>("delete_supplement_rate", { id })

/// Ce qui a été accompli sur un bulletin donné.
export const getReceiptSupplements = (receiptId: string) =>
  invoke<ReceiptSupplement[]>("get_receipt_supplements", { receiptId })

/// Remplace les suppléments d'un bulletin et reporte leur total dans le brut.
/// Rend le total enregistré.
export const setReceiptSupplements = (receiptId: string, items: ReceiptSupplement[]) =>
  invoke<number>("set_receipt_supplements", { receiptId, items })

/// Combien d'astreintes cette année, et pour quel montant.
export const getSupplementTotals = (incomeId: string, year: number) =>
  invoke<SupplementYearTotal[]>("get_supplement_totals", { incomeId, year })

/// Contrôle un bulletin déjà enregistré.
export const checkIncomeReceipt = (receiptId: string) =>
  invoke<PayslipReport>("check_income_receipt", { receiptId })

/// Contrôle tous les bulletins d'une année en un seul aller-retour. Un appel
/// par bulletin rendait l'onglet inutilisable sur une carrière reprise.
export const checkIncomeReceipts = (incomeId: string, year?: number) =>
  invoke<Record<string, PayslipReport>>("check_income_receipts", {
    incomeId,
    year: year ?? null,
  })

/// Contrôle un bulletin en cours de saisie, avant enregistrement.
export const previewPayslipCheck = (incomeId: string, draft: IncomeReceipt) =>
  invoke<PayslipReport>("preview_payslip_check", { incomeId, draft })

export const getSalaryCertificate = (incomeId: string, year: number) =>
  invoke<SalaryCertificate | null>("get_salary_certificate", { incomeId, year })

export const upsertSalaryCertificate = (certificate: SalaryCertificate) =>
  invoke<SalaryCertificate>("upsert_salary_certificate", { certificate })

/// Reconstitue le certificat depuis les bulletins de l'année, sans l'enregistrer.
export const computeSalaryCertificate = (incomeId: string, year: number) =>
  invoke<SalaryCertificate>("compute_salary_certificate", { incomeId, year })

/// Confronte le certificat reçu de l'employeur aux bulletins de l'année.
export const reconcileSalaryCertificate = (incomeId: string, year: number) =>
  invoke<CertificateReconciliation>("reconcile_salary_certificate", { incomeId, year })

/// Base imposable et déductions liées au revenu, pour une année fiscale.
export const getIncomeTaxSummary = (year: number, options?: { working_days?: number }) =>
  invoke<IncomeTaxSummary>("get_income_tax_summary", { year, options: options ?? null })

/// Cotisations de toute la carrière, une ligne par année et par employeur.
/// Les employeurs quittés y figurent : c'est tout l'objet de l'écran.
export const getContributionsHistory = () =>
  invoke<ContributionsHistory>("get_contributions_history")

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
  | "income" | "income_receipt"
  | "item" | "item_group" | "merchant" | "reimbursement"
  | "pending_invoice"

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
  location: string | null
  original_amount: number | null
  original_currency: string | null
  exchange_rate: number | null
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
  location?: string | null
  original_amount?: number | null
  original_currency?: string | null
  exchange_rate?: number | null
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
  location: string | null
  original_amount: number | null
  original_currency: string | null
  exchange_rate: number | null
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

/// Reçu stocké ↔ transaction : comptabilise l'achat à partir d'un ticket de
/// l'inbox rapproché à une ligne bancaire. Crée l'article (champs déjà fusionnés
/// côté frontend), pose `bank_transaction_id`, promeut la pièce du ticket en
/// pièce jointe, marque la transaction `confirmed` et supprime la ligne pending.
/// Échec préfixé « DUPLICATE: » si un article proche existe ; relancer force=true.
export const bookItemFromReceiptMatch = (
  txId: string,
  pendingInvoiceId: string,
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
  },
  attachmentDisplayName?: string,
  force?: boolean,
) =>
  invoke<Item>("book_item_from_receipt_match", {
    txId,
    pendingInvoiceId,
    item,
    attachmentDisplayName,
    force,
  })

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

export const aiExtractBankStatement = (text: string, config: unknown, bank?: string | null) =>
  invoke<ExtractedTransaction[]>("ai_extract_bank_statement", { text, config, bank })

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

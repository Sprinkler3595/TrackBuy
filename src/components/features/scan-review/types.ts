import type { ItemKind } from "@/lib/tauri"
import type { PickedFileValue } from "@/components/features/doc-slot"

/**
 * Shared types for the scan-review wizard. Kept in a dedicated file so each
 * step component can import only what it needs without circular imports.
 */

/** Per-invoice fields fixed once on the Header step. */
export interface SharedState {
  merchant_id: string
  location_id: string
  payment_card_id: string
  purchase_date: string
  currency: string
  invoice_number: string
  notes: string
  invoiceFile: PickedFileValue
  purchaseOrderFile: PickedFileValue
  /** Pre-detected merchant name from the OCR — used to hint the user when no
   *  existing merchant matched, so they can create it inline. */
  merchantHint: string
  /** Lines detected as voucher with a negative price (= commercial discount).
   *  Displayed for context, never created as items. */
  discounts: Array<{ description: string; price: number }>
}

/**
 * One editable draft item. Holds every field any kind might use; the form only
 * shows the relevant subset based on `item_kind`. Persisted to sessionStorage
 * during the wizard so a refresh doesn't blow it away.
 */
export interface ItemDraft {
  // Identification
  item_kind: ItemKind
  description: string
  price: string // string in the form, parsed to number on submit
  // Physical-specific
  warranty_months: string
  product_reference: string
  quantity: string
  price_excl_tax: string
  tax_rate: string
  photo: PickedFileValue
  // Digital-specific
  code: string
  expiration_date: string
  redemption_url: string
  // Ticket-specific
  event_datetime: string
  event_location: string
  // Common
  notes: string
}

/** Empty draft used when the user clicks "Ajouter un article". */
export function emptyDraft(currency = "CHF"): ItemDraft {
  void currency // reserved for future use (currency-per-line)
  return {
    item_kind: "physical",
    description: "",
    price: "",
    warranty_months: "",
    product_reference: "",
    quantity: "",
    price_excl_tax: "",
    tax_rate: "",
    photo: null,
    code: "",
    expiration_date: "",
    redemption_url: "",
    event_datetime: "",
    event_location: "",
    notes: "",
  }
}

/** Payload pushed by scan.tsx into sessionStorage; consumed by ScanReviewPage. */
export interface PendingReceipt {
  shared: Pick<SharedState, "purchase_date" | "currency" | "invoice_number" | "notes" | "merchantHint" | "discounts">
  drafts: ItemDraft[]
  /** Original receipt file (attached as the invoice if no override). */
  attachFile: string
  attachName: string
  /** When set, the user resumed a pending invoice. Deleted from the queue
   *  once the wizard creates the items successfully. */
  pending_invoice_id?: string
}

export const PENDING_RECEIPT_KEY = "trackbuy.pendingReceipt"

/**
 * attachment_type used when saving the secret code for a digital item.
 * Mirrors the constant in tickets.tsx so the Billets & Codes page picks the
 * code up via the same filter.
 */
export const KIND_CODE_TYPE: Record<"ticket" | "voucher" | "license", string> = {
  ticket: "ticket_code",
  voucher: "voucher_code",
  license: "license_key",
}

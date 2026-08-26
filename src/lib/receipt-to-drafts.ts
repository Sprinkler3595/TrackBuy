import type { ExtractedReceipt, ItemKind, LineCategory } from "@/lib/tauri"
import { emptyDraft, type ItemDraft, type PendingReceipt } from "@/components/features/scan-review/types"

/// Turn what the AI read off a purchase document into the assistant's editable
/// drafts. Nothing is written to the database here — the user reviews every
/// line first.

/** Map an OCR line category to the DB `item_kind`. */
export function categoryToKind(c: LineCategory): ItemKind {
  if (c === "license") return "license"
  if (c === "voucher") return "voucher"
  // purchase / service / shipping / other → physical (a service or shipping
  // line is still tracked as a regular line item; "ticket" is never detected
  // from the text, the user picks it by hand).
  return "physical"
}

/// Build the payload handed to the purchase assistant.
///
/// A `voucher` line with a NEGATIVE price is a commercial discount applied to
/// the invoice, not something you own: it is surfaced read-only on the header
/// step instead of becoming an item. A voucher with a positive price is a gift
/// card actually bought, so it stays a real item.
export function receiptToPendingPurchase(
  x: ExtractedReceipt,
  attach: { path: string; name: string } | null,
): PendingReceipt {
  const discounts = x.items
    .filter((it) => it.category === "voucher" && it.price < 0)
    .map((it) => ({ description: it.description, price: it.price }))

  const lines = x.items.filter((it) => !(it.category === "voucher" && it.price < 0))

  // Header-level details (reference, quantity, tax…) only describe the whole
  // document. Applying them to each line of a multi-line invoice would be
  // wrong, so they are only pushed down when there is exactly one line.
  const single = lines.length === 1
  const drafts: ItemDraft[] = lines.map((it) => ({
    ...emptyDraft(),
    item_kind: categoryToKind(it.category),
    description: it.description,
    price: String(Math.abs(it.price)),
    warranty_months: single && x.warranty_months != null ? String(x.warranty_months) : "",
    product_reference: single && x.product_reference ? x.product_reference : "",
    quantity: single && x.quantity != null && x.quantity > 1 ? String(x.quantity) : "",
    price_excl_tax: single && x.price_excl_tax != null ? String(x.price_excl_tax) : "",
    tax_rate: single && x.tax_rate != null ? String(x.tax_rate) : "",
  }))

  // No line could be read (a terse offer, a poor scan): start from the totals
  // so the user lands on a pre-filled draft instead of an empty wizard.
  if (drafts.length === 0 && (x.purchase_price != null || x.description)) {
    drafts.push({
      ...emptyDraft(),
      description: x.description ?? "",
      price: x.purchase_price != null ? String(x.purchase_price) : "",
      warranty_months: x.warranty_months != null ? String(x.warranty_months) : "",
      product_reference: x.product_reference ?? "",
      quantity: x.quantity != null && x.quantity > 1 ? String(x.quantity) : "",
      price_excl_tax: x.price_excl_tax != null ? String(x.price_excl_tax) : "",
      tax_rate: x.tax_rate != null ? String(x.tax_rate) : "",
    })
  }

  return {
    shared: {
      // No fallback to today: a wrong purchase date would skew the warranty
      // end date, so an unreadable date stays empty and must be confirmed.
      purchase_date: x.purchase_date ?? "",
      currency: x.currency ?? "CHF",
      invoice_number: x.invoice_number ?? "",
      notes: x.notes ?? "",
      merchantHint: x.merchant ?? "",
      discounts,
    },
    drafts,
    document_kind: x.document_kind,
    attachFile: attach?.path ?? "",
    attachName: attach?.name ?? "",
  }
}

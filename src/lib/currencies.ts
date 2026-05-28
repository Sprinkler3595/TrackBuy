/**
 * Supported currencies — kept in one place so every form (items, engagements,
 * incomes, reimbursements) offers the same set. Previously each page had its
 * own hard-coded list, causing the same item-in-CAD vs engagement-in-4-only
 * mismatch the audit flagged.
 */
export const SUPPORTED_CURRENCIES = ["CHF", "EUR", "USD", "GBP", "CAD"] as const

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

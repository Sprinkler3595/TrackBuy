import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const DEFAULT_CURRENCY = "CHF"
export const SUPPORTED_CURRENCIES = ["CHF", "EUR", "USD", "GBP", "CAD"] as const

function localeForCurrency(currency: string): string {
  switch (currency) {
    case "CHF": return "fr-CH"
    case "EUR": return "fr-FR"
    case "USD": return "en-US"
    case "GBP": return "en-GB"
    case "CAD": return "fr-CA"
    default:    return "fr-CH"
  }
}

export function formatPrice(price: number, currency: string = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat(localeForCurrency(currency), {
    style: "currency",
    currency,
  }).format(price)
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("fr-CH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date))
}

export function daysUntil(dateStr: string): number {
  // Parse as local midnight (not UTC) so the comparison is in the user's
  // calendar — otherwise "2025-06-15" is read as midnight UTC, which sits
  // on June 14 in UTC-5 zones and yields off-by-one warranty/renewal alerts.
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return 0
  const target = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // Round (not ceil): both ends are local midnights so the diff is a whole
  // number of days modulo DST — round absorbs the ±1h DST drift cleanly.
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

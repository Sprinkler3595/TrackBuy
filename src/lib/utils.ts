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
  const target = new Date(dateStr)
  const now = new Date()
  const diff = target.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

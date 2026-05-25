import type { EngagementBillingCycle, IncomeBillingCycle } from "@/lib/tauri"

/// Superset of cycle strings used across engagements and incomes — keeps
/// the calculator working for both domains without duplicate switches.
/// Income cycles ('monthly' | 'quarterly' | 'yearly' | 'one_shot' | 'custom')
/// are a subset of engagement cycles, so any income cycle is accepted.
type AnyCycle = EngagementBillingCycle | IncomeBillingCycle

/// Normalize an amount + billing cycle + interval to a monthly equivalent.
/// `one_shot` returns 0 (a one-time payment doesn't recur). `custom` is
/// treated as "N days" and converted using the average month length
/// (30.44 days = 365.25 / 12).
export function monthlyEquivalent(
  amount: number,
  cycle: AnyCycle,
  interval: number
): number {
  const n = Math.max(1, interval)
  switch (cycle) {
    case "monthly":    return amount / n
    case "quarterly":  return amount / (3 * n)
    case "semiannual": return amount / (6 * n)
    case "yearly":     return amount / (12 * n)
    case "one_shot":   return 0
    case "custom":     return (amount / n) * (30.44 / 1)
  }
}

export function annualEquivalent(
  amount: number,
  cycle: AnyCycle,
  interval: number
): number {
  return monthlyEquivalent(amount, cycle, interval) * 12
}

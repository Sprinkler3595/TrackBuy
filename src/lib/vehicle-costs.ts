import type {
  EngagementCharge,
  VehicleEngagementSummary,
  VehicleExpense,
} from "@/lib/tauri"
import { monthlyEquivalent } from "@/lib/finance"

/// Cost aggregation for the vehicle hub.
///
/// Two readings of the same car coexist here, on purpose:
///   • what actually leaves the account in a given month (contract instalments
///     falling due that month + expense-book entries dated that month);
///   • what the car really costs per month once yearly contracts are spread
///     out (leasing + insurance/12 + tax/12 + the recent average of the
///     expense book).
/// A yearly insurance makes those two numbers differ by a lot, which is
/// exactly why both are shown side by side.

/** `YYYY-MM`, sortable as a plain string. */
export type MonthKey = string

export const monthKeyOf = (iso: string): MonthKey => iso.slice(0, 7)

/** The `n` months ending with `from`'s month, oldest first. */
export function lastMonths(n: number, from: Date = new Date()): MonthKey[] {
  const out: MonthKey[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  return out
}

/** "2026-08" → "août 26" / "Aug 26". */
export function monthLabel(month: MonthKey, fr: boolean): string {
  const [y, m] = month.split("-").map(Number)
  if (!y || !m) return month
  const d = new Date(y, m - 1, 1)
  const name = d.toLocaleDateString(fr ? "fr-CH" : "en-GB", { month: "short" })
  return `${name} ${String(y).slice(2)}`
}

export interface MonthBucket {
  month: MonthKey
  label: string
  /** Expense-book total for the month (charging, fuel, tires, tax…). */
  ledger: number
  /** Contract instalments due that month (leasing, insurance…). */
  contracts: number
  total: number
  /** Energy quantities, from the quantity-based expense categories. */
  kwh: number
  liters: number
  /** CHF spent on energy alone — used to derive the average price per unit. */
  energyCost: number
}

/// A waived charge is explicitly "not to be paid", so it never counts. Every
/// other status (scheduled, paid, late, disputed) is money the month owes.
const chargeCounts = (c: EngagementCharge): boolean => c.status !== "waived"

/// Build the per-month series over `months`. Anything dated outside the window
/// is ignored, so callers can pass the full ledger without pre-filtering.
export function buildMonthlySeries(
  months: MonthKey[],
  expenses: VehicleExpense[],
  charges: EngagementCharge[],
  fr: boolean,
): MonthBucket[] {
  const byMonth = new Map<MonthKey, MonthBucket>(
    months.map((month) => [
      month,
      { month, label: monthLabel(month, fr), ledger: 0, contracts: 0, total: 0, kwh: 0, liters: 0, energyCost: 0 },
    ]),
  )

  for (const e of expenses) {
    const b = byMonth.get(monthKeyOf(e.expense_date))
    if (!b) continue
    b.ledger += e.amount
    if (e.category === "charging") {
      b.kwh += e.quantity ?? 0
      b.energyCost += e.amount
    } else if (e.category === "fuel") {
      b.liters += e.quantity ?? 0
      b.energyCost += e.amount
    }
  }

  for (const c of charges) {
    if (!chargeCounts(c)) continue
    const b = byMonth.get(monthKeyOf(c.due_date))
    if (!b) continue
    b.contracts += c.amount
  }

  const out = months.map((m) => byMonth.get(m) as MonthBucket)
  for (const b of out) b.total = b.ledger + b.contracts
  return out
}

export interface SmoothedContract {
  id: string
  name: string
  /** Amount normalised to one month (yearly premium / 12, etc.). */
  monthly: number
}

/// Active recurring contracts, each normalised to a monthly amount. One-shot
/// contracts and contracts without an amount are dropped — they can't be
/// spread over a month.
export function smoothedContracts(
  engagements: VehicleEngagementSummary[],
): SmoothedContract[] {
  return engagements
    .filter((e) => e.status === "active" && e.current_amount != null && e.billing_cycle !== "one_shot")
    .map((e) => ({
      id: e.id,
      name: e.name,
      monthly: monthlyEquivalent(e.current_amount as number, e.billing_cycle, e.cycle_interval),
    }))
    .sort((a, b) => b.monthly - a.monthly)
}

export const sumMonthly = (rows: SmoothedContract[]): number =>
  rows.reduce((acc, r) => acc + r.monthly, 0)

/// Average expense-book spend over the last `n` COMPLETED months (the current
/// month is still running, so including it would drag the average down).
export function averageLedger(buckets: MonthBucket[], n = 3): number {
  const completed = buckets.slice(0, -1)
  if (completed.length === 0) return 0
  const window = completed.slice(-n)
  return window.reduce((acc, b) => acc + b.ledger, 0) / window.length
}

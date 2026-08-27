import type * as api from "@/lib/tauri"

const today = () => new Date().toISOString().slice(0, 10)

/// Champs monétaires du bulletin, groupés comme sur un décompte suisse.
/// L'ordre compte : c'est celui dans lequel l'utilisateur lit son papier.
export const GROSS_FIELDS = [
  { key: "base_salary_amount", label: "Salaire de base" },
  { key: "thirteenth_amount", label: "13ᵉ salaire" },
  { key: "overtime_amount", label: "Heures supplémentaires" },
  { key: "holiday_pay_amount", label: "Indemnité vacances" },
  { key: "bonus_amount", label: "Bonus / gratification" },
  { key: "benefits_in_kind_amount", label: "Prestations en nature" },
  { key: "company_car_private_amount", label: "Part privée du véhicule" },
  { key: "other_gross_amount", label: "Autre élément de salaire" },
] as const

export const DEDUCTION_FIELDS = [
  { key: "social_charges_amount", label: "AVS / AI / APG" },
  { key: "ac_amount", label: "Assurance-chômage" },
  { key: "pension_amount", label: "2ᵉ pilier (LPP)" },
  { key: "laa_nonoccupational_amount", label: "LAA — accidents non prof." },
  { key: "ijm_amount", label: "Indemnités journalières maladie" },
  { key: "ac_solidarity_amount", label: "Pour-cent de solidarité AC" },
  { key: "tax_at_source_amount", label: "Impôt à la source" },
  { key: "other_deductions_amount", label: "Autres retenues" },
] as const

export const EXPENSE_FIELDS = [
  { key: "expense_reimbursement_amount", label: "Frais effectifs remboursés" },
  { key: "expense_lump_sum_amount", label: "Frais forfaitaires" },
] as const

export type MoneyKey =
  | (typeof GROSS_FIELDS)[number]["key"]
  | (typeof DEDUCTION_FIELDS)[number]["key"]
  | (typeof EXPENSE_FIELDS)[number]["key"]

export type PayslipFormState = {
  id: string
  received_on: string
  period_start: string
  period_end: string
  period_label: string
  amount: string
  family_allowance_amount: string
  overtime_hours: string
  gross_amount: string
  notes: string
} & Record<MoneyKey, string>

const MONEY_KEYS: MoneyKey[] = [
  ...GROSS_FIELDS.map((f) => f.key),
  ...DEDUCTION_FIELDS.map((f) => f.key),
  ...EXPENSE_FIELDS.map((f) => f.key),
]

export function emptyPayslipForm(defaultAmount = ""): PayslipFormState {
  const base = {
    id: "",
    received_on: today(),
    period_start: "",
    period_end: "",
    period_label: "",
    amount: defaultAmount,
    family_allowance_amount: "",
    overtime_hours: "",
    gross_amount: "",
    notes: "",
  }
  const money = Object.fromEntries(MONEY_KEYS.map((k) => [k, ""]))
  return { ...base, ...money } as PayslipFormState
}

export function receiptToForm(r: api.IncomeReceipt): PayslipFormState {
  const str = (v: number | string | null) => (v == null ? "" : String(v))
  const money = Object.fromEntries(MONEY_KEYS.map((k) => [k, str(r[k])]))
  return {
    ...(money as Record<MoneyKey, string>),
    id: r.id,
    received_on: r.received_on,
    period_start: str(r.period_start),
    period_end: str(r.period_end),
    period_label: str(r.period_label),
    amount: String(r.amount),
    family_allowance_amount: str(r.family_allowance_amount),
    overtime_hours: str(r.overtime_hours),
    gross_amount: str(r.gross_amount),
    notes: str(r.notes),
  }
}

/// Parse une saisie monétaire : vide ou illisible → null, jamais 0.
/// La nuance compte : un poste absent du bulletin n'est pas un poste à zéro.
export const parseMoney = (v: string): number | null => {
  if (!v.trim()) return null
  const n = parseFloat(v)
  return Number.isNaN(n) ? null : n
}

/// Construit un `IncomeReceipt` complet à partir du formulaire. Sert à la
/// fois pour l'enregistrement et pour le contrôle en direct — un seul chemin
/// de conversion, donc ce qui est contrôlé est exactement ce qui est écrit.
export function formToReceipt(
  form: PayslipFormState,
  incomeId: string,
  currency: string,
): api.IncomeReceipt {
  const money = Object.fromEntries(MONEY_KEYS.map((k) => [k, parseMoney(form[k])]))
  const periodDate = form.period_end || form.period_start || form.received_on
  return {
    ...(money as Record<MoneyKey, number | null>),
    id: form.id,
    income_id: incomeId,
    received_on: form.received_on,
    amount: parseMoney(form.amount) ?? 0,
    currency,
    period_label: form.period_label || null,
    period_start: form.period_start || null,
    period_end: form.period_end || null,
    fiscal_year: parseInt(periodDate.slice(0, 4), 10) || null,
    gross_amount: parseMoney(form.gross_amount),
    family_allowance_amount: parseMoney(form.family_allowance_amount),
    overtime_hours: parseMoney(form.overtime_hours),
    notes: form.notes || null,
    created_at: "",
  }
}

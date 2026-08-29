import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, ChevronRight, Paperclip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { useModalKeyboard } from "@/hooks/use-modal-keyboard"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { useNetFromGross } from "@/hooks/use-net-from-gross"
import { contractInForce } from "@/lib/contracts"
import { unitLabel } from "@/lib/supplements"
import { cn, formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// « J'ai reçu mon salaire. »
///
/// C'est le geste que l'on répète douze fois par an, et il passait par un
/// formulaire de vingt-cinq champs VIDES — alors que le contrat sait déjà
/// répondre à vingt-trois d'entre eux. Ici le décompte est calculé d'avance :
/// il ne reste qu'à le confronter à la fiche reçue.
///
/// Deux principes le gouvernent.
///
/// **Chaque ligne reste corrigible.** Un écran qui se contenterait d'entériner
/// le calcul ne vérifierait rien : le contrôle de conformité compare le
/// bulletin ENREGISTRÉ à ce qui était attendu, et enregistrer l'attendu le
/// ferait passer à tous les coups. Les montants sont donc pré-remplis, pas
/// figés — corriger une ligne qui diffère est le geste utile.
///
/// **Le brut se compose avant, le reste s'ajoute après.** Une astreinte est du
/// salaire : elle entre dans le brut, donc dans les cotisations. Un
/// remboursement de frais n'en est pas : il rejoint le net sans les traverser.
/// Confondre les deux fait réclamer des cotisations sur un montant qui n'y est
/// pas soumis, ou l'inverse.

const lastOfMonth = (iso: string): string => {
  const d = new Date(iso)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
}

const firstOfMonth = (iso: string): string => `${iso.slice(0, 7)}-01`

const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
]

const monthLabel = (iso: string): string => {
  const m = parseInt(iso.slice(5, 7), 10)
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${iso.slice(0, 4)}` : iso
}

const num = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const n = parseFloat(t)
  return Number.isNaN(n) ? null : n
}

const money = (n: number | null | undefined): string =>
  n == null ? "" : String(Math.round(n * 100) / 100)

/// Une ligne du décompte : ce qui était attendu à gauche, ce qui a été retenu
/// à droite, corrigible. Un poste que le moteur n'a pas pu chiffrer reste
/// saisissable — mais il est signalé, parce que le net affiché est alors trop
/// élevé et non pas juste.
function Line({
  label,
  expected,
  value,
  onChange,
  currency,
  negative,
  uncomputable,
}: {
  label: string
  expected: number | null
  value: string
  onChange: (v: string) => void
  currency: string
  negative?: boolean
  uncomputable?: boolean
}) {
  const actual = num(value)
  const differs =
    expected != null && actual != null && Math.abs(actual - expected) >= 0.05
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="min-w-0 flex-1 text-sm">
        {label}
        {uncomputable && (
          <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-500">
            taux inconnu — à saisir
          </span>
        )}
        {differs && (
          <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-500">
            attendu {formatPrice(expected as number, currency)}
          </span>
        )}
      </span>
      <span className="flex items-center gap-1.5">
        {negative && <span className="text-sm text-muted-foreground">−</span>}
        <Input
          type="number"
          step="0.05"
          min="0"
          className={cn("h-9 w-32 text-right tabular-nums", differs && "border-amber-500")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
        />
      </span>
    </li>
  )
}

export function PayslipConfirm({
  income,
  contracts,
  onClose,
  onSaved,
}: {
  income: api.Income
  contracts: api.EmploymentContract[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const currency = income.currency
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  useModalKeyboard(!saving, onClose)

  const [receivedOn, setReceivedOn] = useState(
    () => income.next_expected_date ?? new Date().toISOString().slice(0, 10),
  )
  const [periodOpen, setPeriodOpen] = useState(false)
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")

  /// La période couverte se déduit du mois du versement, et n'est demandée que
  /// si elle ne colle pas — un salaire de mars versé le 25 mars couvre mars.
  const start = periodStart || firstOfMonth(receivedOn)
  const end = periodEnd || lastOfMonth(receivedOn)

  const contract = useMemo(() => contractInForce(contracts, end), [contracts, end])
  const periods =
    contract?.salary_periods_per_year && contract.salary_periods_per_year > 0
      ? contract.salary_periods_per_year
      : 12
  const baseGross =
    contract?.annual_gross_agreed != null ? contract.annual_gross_agreed / periods : null

  // --- ce qui s'ajoute au brut ---
  const [rates, setRates] = useState<api.SupplementRate[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [bonus, setBonus] = useState("")
  const [overtime, setOvertime] = useState("")
  const [overtimeHours, setOvertimeHours] = useState("")
  const [familyAllowance, setFamilyAllowance] = useState("")

  // --- ce qui s'ajoute après les retenues ---
  const [expenses, setExpenses] = useState("")
  const [netAddition, setNetAddition] = useState("")

  const [extrasOpen, setExtrasOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const id = contract?.id
    if (!id) {
      setRates([])
      return
    }
    ;(async () => {
      try {
        const list = await api.getSupplementRates(id)
        if (!cancelled) setRates(list)
      } catch {
        if (!cancelled) setRates([])
      }
    })()
    return () => { cancelled = true }
  }, [contract?.id])

  const supplementItems = useMemo(
    () =>
      rates
        .map((r) => {
          const q = parseFloat(quantities[r.code] ?? "")
          const quantity = Number.isNaN(q) || q <= 0 ? 0 : q
          return {
            id: "",
            receipt_id: "",
            code: r.code,
            label: r.label,
            quantity,
            unit_amount: r.amount,
            amount: quantity * r.amount,
          }
        })
        .filter((x) => x.quantity > 0),
    [rates, quantities],
  )
  const supplements = supplementItems.reduce((s, x) => s + x.amount, 0)

  /// Le brut soumis aux cotisations : le fixe, plus tout ce qui est du salaire.
  /// Les allocations familiales n'y sont PAS — elles s'ajoutent au brut versé
  /// mais restent hors assiette AVS (art. 6 RAVS).
  const bonusValue = num(bonus) ?? 0
  const overtimeValue = num(overtime) ?? 0
  const subjectExtras = supplements + bonusValue + overtimeValue
  const grossSubject = (baseGross ?? 0) + subjectExtras

  const year = parseInt(end.slice(0, 4), 10) || new Date().getFullYear()

  const { result, loading, error } = useNetFromGross(
    baseGross != null
      ? {
          year,
          gross_per_period: baseGross,
          supplements_per_period: subjectExtras,
          family_allowance: num(familyAllowance),
          income_id: income.id,
          terms: {
            birth_date: contract?.birth_date ?? null,
            activity_rate_pct: contract?.activity_rate_pct ?? null,
            weekly_hours: contract?.weekly_hours ?? null,
            salary_periods_per_year: periods,
            thirteenth_salary: contract?.thirteenth_salary ?? false,
            hourly_paid: contract?.hourly_paid ?? false,
            lpp_employee_share_pct: contract?.lpp_employee_share_pct ?? null,
            laa_nonoccupational_pct: contract?.laa_nonoccupational_pct ?? null,
            ijm_employee_pct: contract?.ijm_employee_pct ?? null,
            lpp_insured_scope: contract?.lpp_insured_scope ?? null,
            tax_at_source: contract?.tax_at_source ?? false,
          },
          work_canton: contract?.work_canton ?? null,
          residence_canton: contract?.residence_canton ?? null,
          tax_at_source_scale: contract?.tax_at_source_scale ?? null,
          tax_at_source_rate_pct: contract?.tax_at_source_rate_pct ?? null,
        }
      : null,
  )

  const period = result?.projection.periods[0] ?? null
  const uncomputable = new Set(result?.projection.uncomputable ?? [])

  // --- les retenues, pré-remplies puis corrigibles ---
  const [deductions, setDeductions] = useState<Record<string, string>>({})
  /// Une ligne touchée à la main ne doit plus bouger quand le calcul se
  /// rafraîchit : sinon corriger l'impôt à la source ferait perdre la
  /// correction dès qu'on ajoute une astreinte.
  const [touched, setTouched] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!period) return
    setDeductions((prev) => {
      const next = { ...prev }
      let changed = false
      const put = (k: string, v: number | null) => {
        if (touched.has(k)) return
        const text = v == null ? "" : money(v)
        if (next[k] === text) return
        next[k] = text
        changed = true
      }
      put("social_charges_amount", period.avs_ai_apg)
      put("ac_amount", period.ac)
      put("ac_solidarity_amount", period.ac_solidarity || null)
      put("pension_amount", period.lpp_employee)
      put("laa_nonoccupational_amount", period.laa_nonoccupational)
      put("ijm_amount", period.ijm)
      put("tax_at_source_amount", period.tax_at_source)
      put("other_deductions_amount", period.cantonal || null)
      // Rendre `prev` tel quel évite un rendu pour rien à chaque frappe.
      return changed ? next : prev
    })
  }, [period, touched])

  const setDeduction = (key: string, v: string) => {
    setTouched((prev) => new Set(prev).add(key))
    setDeductions((prev) => ({ ...prev, [key]: v }))
  }

  const DEDUCTION_LINES: Array<{
    key: string
    label: string
    expected: number | null
    uncomputable?: boolean
  }> = [
    { key: "social_charges_amount", label: "AVS / AI / APG", expected: period?.avs_ai_apg ?? null },
    { key: "ac_amount", label: "Assurance-chômage", expected: period?.ac ?? null },
    ...(period && period.ac_solidarity > 0
      ? [{ key: "ac_solidarity_amount", label: "Pour-cent de solidarité AC", expected: period.ac_solidarity }]
      : []),
    {
      key: "pension_amount",
      label: "2ᵉ pilier (LPP)",
      expected: period?.lpp_employee ?? null,
      uncomputable: uncomputable.has("lpp"),
    },
    {
      key: "laa_nonoccupational_amount",
      label: "LAA — accidents non professionnels",
      expected: period?.laa_nonoccupational ?? null,
      uncomputable: uncomputable.has("laa_nonoccupational"),
    },
    {
      key: "ijm_amount",
      label: "Indemnités journalières maladie",
      expected: period?.ijm ?? null,
      uncomputable: uncomputable.has("ijm"),
    },
    ...(contract?.tax_at_source
      ? [{
          key: "tax_at_source_amount",
          label: "Impôt à la source",
          expected: period?.tax_at_source ?? null,
          uncomputable: uncomputable.has("tax_at_source"),
        }]
      : []),
    ...(period && period.cantonal > 0
      ? [{ key: "other_deductions_amount", label: "Retenues cantonales", expected: period.cantonal }]
      : []),
  ]

  const totalDeductions = DEDUCTION_LINES.reduce(
    (s, l) => s + (num(deductions[l.key] ?? "") ?? 0),
    0,
  )
  const grossPaid = grossSubject + (num(familyAllowance) ?? 0)
  const afterDeductions = (num(expenses) ?? 0) + (num(netAddition) ?? 0)
  const computedNet = grossPaid - totalDeductions + afterDeductions

  /// Le net effectivement reçu. Il suit le calcul tant qu'on n'y touche pas :
  /// c'est le chiffre qu'on lit en premier sur son relevé bancaire, et c'est
  /// lui qui tranche si tout le reste concorde.
  const [netPaid, setNetPaid] = useState("")
  const [netTouched, setNetTouched] = useState(false)
  useEffect(() => {
    if (netTouched) return
    setNetPaid(computedNet > 0 ? money(computedNet) : "")
  }, [computedNet, netTouched])

  const netValue = num(netPaid)
  const netGap = netValue == null ? null : netValue - computedNet
  const netMatches = netGap != null && Math.abs(netGap) < 0.05

  const save = async () => {
    if (netValue == null) {
      toast("Indiquez le net que vous avez reçu.", "error")
      return
    }
    setSaving(true)
    try {
      const created = await api.logIncomeReceipt({
        income_id: income.id,
        received_on: receivedOn,
        amount: netValue,
        currency,
        period_label: monthLabel(end),
        period_start: start,
        period_end: end,
        fiscal_year: year,
        gross_amount: grossPaid > 0 ? grossPaid : null,
        base_salary_amount: baseGross,
        thirteenth_amount: null,
        overtime_amount: num(overtime),
        overtime_hours: num(overtimeHours),
        holiday_pay_amount: null,
        bonus_amount: num(bonus),
        benefits_in_kind_amount: null,
        company_car_private_amount: null,
        family_allowance_amount: num(familyAllowance),
        other_gross_amount: supplements > 0 ? supplements : null,
        social_charges_amount: num(deductions.social_charges_amount ?? ""),
        ac_amount: num(deductions.ac_amount ?? ""),
        ac_solidarity_amount: num(deductions.ac_solidarity_amount ?? ""),
        pension_amount: num(deductions.pension_amount ?? ""),
        laa_nonoccupational_amount: num(deductions.laa_nonoccupational_amount ?? ""),
        ijm_amount: num(deductions.ijm_amount ?? ""),
        tax_at_source_amount: num(deductions.tax_at_source_amount ?? ""),
        other_deductions_amount: num(deductions.other_deductions_amount ?? ""),
        expense_reimbursement_amount: num(expenses),
        expense_lump_sum_amount: null,
        net_addition_amount: num(netAddition),
        notes: null,
      })
      if (supplementItems.length > 0) {
        await api.setReceiptSupplements(created.id, supplementItems)
      }
      setSavedId(created.id)
      toast("Versement enregistré.", "success")
      onSaved()
    } catch (e) {
      toast(`Erreur : ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const Chevron = extrasOpen ? ChevronDown : ChevronRight

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div>
            <h2 className="text-lg font-semibold">
              {savedId ? "Versement enregistré" : "J'ai reçu mon salaire"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {savedId
                ? "Joignez la fiche de salaire originale — elle restera attachée à ce versement."
                : `${monthLabel(end)} · ${contract?.employer_name ?? income.source_name ?? income.name}`}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {savedId ? (
            <>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{monthLabel(end)}</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatPrice(netValue ?? 0, currency)}
                  </span>
                </div>
              </div>
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Paperclip className="h-4 w-4" />
                  La fiche de salaire
                </p>
                <AttachmentsPanel
                  incomeId={income.id}
                  incomeReceiptId={savedId}
                  itemDescription={`${income.name} — ${monthLabel(end)}`}
                />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Versé le</label>
                  <Input
                    type="date"
                    value={receivedOn}
                    onChange={(e) => setReceivedOn(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Période couverte</label>
                  <button
                    type="button"
                    onClick={() => setPeriodOpen((v) => !v)}
                    className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm"
                  >
                    {monthLabel(end)}
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
                {periodOpen && (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Du</label>
                      <Input type="date" value={start} onChange={(e) => setPeriodStart(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Au</label>
                      <Input type="date" value={end} onChange={(e) => setPeriodEnd(e.target.value)} />
                    </div>
                  </>
                )}
              </div>

              {baseGross == null ? (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  Aucun salaire annuel n'est enregistré au contrat : le décompte ne peut pas être
                  calculé. Complétez le contrat, ou saisissez ce bulletin en détail depuis
                  l'onglet Bulletins.
                </p>
              ) : (
                <>
                  {/* ---------- le brut ---------- */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Le brut</p>
                    <ul className="divide-y rounded-lg border px-3">
                      <li className="flex items-baseline justify-between gap-3 py-2">
                        <span className="text-sm">Salaire de base</span>
                        <span className="text-sm tabular-nums">
                          {formatPrice(baseGross, currency)}
                        </span>
                      </li>
                      {supplementItems.map((s) => (
                        <li key={s.code} className="flex items-baseline justify-between gap-3 py-2">
                          <span className="text-sm">
                            {s.label}
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {s.quantity} × {formatPrice(s.unit_amount, currency)}
                            </span>
                          </span>
                          <span className="text-sm tabular-nums">
                            {formatPrice(s.amount, currency)}
                          </span>
                        </li>
                      ))}
                      {bonusValue > 0 && (
                        <li className="flex items-baseline justify-between gap-3 py-2">
                          <span className="text-sm">Bonus / gratification</span>
                          <span className="text-sm tabular-nums">{formatPrice(bonusValue, currency)}</span>
                        </li>
                      )}
                      {overtimeValue > 0 && (
                        <li className="flex items-baseline justify-between gap-3 py-2">
                          <span className="text-sm">Heures supplémentaires</span>
                          <span className="text-sm tabular-nums">{formatPrice(overtimeValue, currency)}</span>
                        </li>
                      )}
                      {(num(familyAllowance) ?? 0) > 0 && (
                        <li className="flex items-baseline justify-between gap-3 py-2">
                          <span className="text-sm">
                            Allocations familiales
                            <span className="ml-1.5 text-xs text-muted-foreground">hors AVS</span>
                          </span>
                          <span className="text-sm tabular-nums">
                            {formatPrice(num(familyAllowance) as number, currency)}
                          </span>
                        </li>
                      )}
                      <li className="flex items-baseline justify-between gap-3 py-2 font-medium">
                        <span className="text-sm">Brut total</span>
                        <span className="text-sm tabular-nums">{formatPrice(grossPaid, currency)}</span>
                      </li>
                    </ul>

                    <button
                      type="button"
                      onClick={() => setExtrasOpen((v) => !v)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      <Chevron className="h-3.5 w-3.5" />
                      Ce mois-ci, j'ai eu quelque chose en plus
                    </button>

                    {extrasOpen && (
                      <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                        {rates.length > 0 && (
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {rates.map((r) => (
                              <div key={r.id} className="space-y-1.5">
                                <label className="text-xs font-medium">
                                  {r.label}{" "}
                                  <span className="text-muted-foreground">
                                    {formatPrice(r.amount, currency)} {unitLabel(r.unit)}
                                  </span>
                                </label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  value={quantities[r.code] ?? ""}
                                  onChange={(e) =>
                                    setQuantities((q) => ({ ...q, [r.code]: e.target.value }))
                                  }
                                  placeholder="0"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">Bonus ({currency})</label>
                            <Input type="number" min="0" step="0.05" value={bonus}
                              onChange={(e) => setBonus(e.target.value)} placeholder="0.00" />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">Heures sup. ({currency})</label>
                            <Input type="number" min="0" step="0.05" value={overtime}
                              onChange={(e) => setOvertime(e.target.value)} placeholder="0.00" />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">dont heures</label>
                            <Input type="number" min="0" step="0.25" value={overtimeHours}
                              onChange={(e) => setOvertimeHours(e.target.value)} placeholder="0" />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium">Alloc. familiales</label>
                            <Input type="number" min="0" step="0.05" value={familyAllowance}
                              onChange={(e) => setFamilyAllowance(e.target.value)} placeholder="0.00" />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Astreintes, bonus et heures supplémentaires sont du salaire : ils entrent
                          dans le brut et supportent les cotisations. Les allocations familiales
                          s'ajoutent au brut versé mais en sont exemptes (art. 6 RAVS).
                        </p>
                      </div>
                    )}
                  </div>

                  {/* ---------- les retenues ---------- */}
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium">Les retenues</p>
                      {loading && <span className="text-xs text-muted-foreground">calcul…</span>}
                    </div>
                    {error ? (
                      <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        {error}
                      </p>
                    ) : (
                      <>
                        <ul className="divide-y rounded-lg border px-3">
                          {DEDUCTION_LINES.map((l) => (
                            <Line
                              key={l.key}
                              label={l.label}
                              expected={l.expected}
                              value={deductions[l.key] ?? ""}
                              onChange={(v) => setDeduction(l.key, v)}
                              currency={currency}
                              negative
                              uncomputable={l.uncomputable}
                            />
                          ))}
                        </ul>
                        <p className="text-xs text-muted-foreground">
                          Pré-remplies avec ce que votre contrat prévoit. Corrigez toute ligne qui
                          diffère de votre fiche : c'est cet écart qui vaut d'être vu.
                        </p>
                      </>
                    )}
                  </div>

                  {/* ---------- après les retenues ---------- */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Frais remboursés</label>
                      <Input type="number" min="0" step="0.05" value={expenses}
                        onChange={(e) => setExpenses(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Autre versement</label>
                      <Input type="number" min="0" step="0.05" value={netAddition}
                        onChange={(e) => setNetAddition(e.target.value)} placeholder="0.00" />
                      <p className="text-xs text-muted-foreground">
                        S'ajoute au net sans passer par les cotisations.
                      </p>
                    </div>
                  </div>

                  {/* ---------- le net ---------- */}
                  <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Net effectivement reçu</p>
                        <p className="text-xs text-muted-foreground">
                          Le montant crédité sur votre compte.
                        </p>
                      </div>
                      <Input
                        type="number"
                        step="0.05"
                        className="h-10 w-40 text-right text-base tabular-nums"
                        value={netPaid}
                        onChange={(e) => { setNetTouched(true); setNetPaid(e.target.value) }}
                      />
                    </div>
                    {netValue != null && !netMatches && (
                      <p className="border-t pt-2 text-xs text-amber-700 dark:text-amber-500">
                        Le décompte ci-dessus donne {formatPrice(computedNet, currency)} :{" "}
                        {(netGap as number) > 0 ? "+" : "−"}
                        {formatPrice(Math.abs(netGap as number), currency)} d'écart. Corrigez une
                        ligne, ou enregistrez tel quel — le contrôle de conformité le signalera.
                      </p>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t p-4">
          {savedId ? (
            <>
              <span />
              <Button onClick={onClose}>
                <Check className="mr-1 h-4 w-4" />
                Terminer
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Annuler
              </Button>
              <Button onClick={save} disabled={saving || netValue == null || baseGross == null}>
                {saving ? "Enregistrement…" : "Confirmer le versement"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

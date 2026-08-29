import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { cn, formatPrice } from "@/lib/utils"
import { PayslipCheckPanel } from "@/components/features/payslip-check-panel"
import { AiScanPanel } from "@/components/features/ai-scan-panel"
import { ReceiptSupplements } from "@/components/features/receipt-supplements"
import { getAiSettings } from "@/lib/ai-settings"
import { contractInForce } from "@/lib/contracts"
import {
  DEDUCTION_FIELDS,
  EXPENSE_FIELDS,
  GROSS_FIELDS,
  emptyPayslipForm,
  formToReceipt,
  parseMoney,
  type MoneyKey,
  type PayslipFormState,
  applyExtractionToForm,
  extractionSummary,
} from "@/components/features/payslip-form-state"
import * as api from "@/lib/tauri"

function Section({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string
  subtitle?: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <Chevron className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </button>
      {open && <div className="border-t p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>}
    </div>
  )
}

function MoneyInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Input type="number" step="0.01" value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/// Saisie d'un bulletin, avec contrôle de conformité recalculé en direct.
///
/// Le contrôle passe par le backend (`preview_payslip_check`) : les barèmes et
/// les règles y vivent, et le front n'en duplique aucun. L'appel est débounced
/// — c'est un IPC local, mais recalculer à chaque frappe reste du gaspillage.
export function PayslipForm({
  incomeId,
  currency,
  contracts = [],
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  incomeId: string
  currency: string
  /// Toutes les versions du contrat. La version en vigueur à la date du
  /// bulletin fournit le barème des suppléments — celui de 2019 sur un
  /// bulletin de 2019, pas celui d'aujourd'hui.
  contracts?: api.EmploymentContract[]
  initial?: PayslipFormState
  onSubmit: (
    receipt: api.IncomeReceipt,
    supplements: api.ReceiptSupplement[],
  ) => Promise<void>
  onCancel: () => void
  submitting?: boolean
}) {
  const [form, setForm] = useState<PayslipFormState>(() => initial ?? emptyPayslipForm())
  const [openSections, setOpenSections] = useState({
    gross: true,
    supplements: true,
    deductions: true,
    expenses: false,
  })
  const [report, setReport] = useState<api.PayslipReport | null>(null)
  const [checking, setChecking] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const set = (k: keyof PayslipFormState, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const receipt = useMemo(
    () => formToReceipt(form, incomeId, currency),
    [form, incomeId, currency],
  )

  /// Astreintes et week-ends du mois. La date du bulletin choisit la version
  /// de contrat, donc le barème : changer « fin de période » recharge le tarif
  /// applicable, ce qui est exactement ce qu'on veut en reprenant un historique.
  const periodDate = form.period_end || form.period_start || form.received_on
  const activeContract = useMemo(
    () => contractInForce(contracts, periodDate),
    [contracts, periodDate],
  )
  const [rates, setRates] = useState<api.SupplementRate[]>([])
  const [saved, setSaved] = useState<api.ReceiptSupplement[]>([])
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const contractId = activeContract?.id
    if (!contractId) {
      setRates([])
      return
    }
    ;(async () => {
      try {
        const list = await api.getSupplementRates(contractId)
        if (!cancelled) setRates(list)
      } catch {
        if (!cancelled) setRates([])
      }
    })()
    return () => { cancelled = true }
  }, [activeContract?.id])

  // Quantités déjà enregistrées, à la réouverture d'un bulletin.
  useEffect(() => {
    let cancelled = false
    const receiptId = initial?.id
    if (!receiptId) {
      setSaved([])
      setQuantities({})
      return
    }
    ;(async () => {
      try {
        const list = await api.getReceiptSupplements(receiptId)
        if (cancelled) return
        setSaved(list)
        setQuantities(Object.fromEntries(list.map((s) => [s.code, String(s.quantity)])))
      } catch {
        if (!cancelled) setSaved([])
      }
    })()
    return () => { cancelled = true }
  }, [initial?.id])

  /// Le barème affiché, augmenté des postes déjà saisis qui n'y figurent plus.
  /// Supprimer une ligne du barème ne doit pas faire disparaître les astreintes
  /// de 2019 d'un bulletin déjà enregistré.
  const supplementRates = useMemo(() => {
    const extra = saved
      .filter((s) => !rates.some((r) => r.code === s.code))
      .map((s, idx) => ({
        id: `saved-${s.code}`,
        contract_id: activeContract?.id ?? "",
        code: s.code,
        label: s.label,
        unit: "",
        amount: s.unit_amount,
        sort_order: rates.length + idx,
      }))
    return [...rates, ...extra]
  }, [rates, saved, activeContract?.id])

  const supplementTotal = (q: Record<string, string>): number =>
    supplementRates.reduce((sum, r) => {
      const n = parseFloat(q[r.code] ?? "")
      return sum + (Number.isNaN(n) || n <= 0 ? 0 : n * r.amount)
    }, 0)

  const round2 = (n: number) => Math.round(n * 100) / 100

  /// Le montant suit le barème tant que l'utilisateur ne l'a pas corrigé à la
  /// main. Sur une fiche importée où l'employeur a versé autre chose, écraser
  /// ce qui a été lu détruirait la seule information qui compte : l'écart.
  const setQuantity = (code: string, value: string) => {
    const next = { ...quantities, [code]: value }
    const before = round2(supplementTotal(quantities))
    const after = round2(supplementTotal(next))
    setQuantities(next)
    setForm((f) => {
      const current = parseMoney(f.other_gross_amount)
      const follows = current == null || Math.abs(current - before) < 0.005
      if (!follows || after === before) return f
      return { ...f, other_gross_amount: after > 0 ? String(after) : "" }
    })
  }

  const supplementItems = useMemo(
    () =>
      supplementRates
        .map((r) => {
          const n = parseFloat(quantities[r.code] ?? "")
          const quantity = Number.isNaN(n) || n <= 0 ? 0 : n
          return {
            id: "",
            receipt_id: form.id,
            code: r.code,
            label: r.label,
            quantity,
            unit_amount: r.amount,
            amount: quantity * r.amount,
          }
        })
        .filter((x) => x.quantity > 0),
    [supplementRates, quantities, form.id],
  )

  const runCheck = useCallback(async () => {
    // Sans brut ni net, il n'y a rien à contrôler : inutile d'afficher un
    // panneau vide dès l'ouverture du formulaire.
    const hasSomething =
      receipt.amount > 0 ||
      receipt.gross_amount != null ||
      receipt.base_salary_amount != null
    if (!hasSomething) {
      setReport(null)
      return
    }
    setChecking(true)
    try {
      setReport(await api.previewPayslipCheck(incomeId, receipt))
    } catch {
      // Le contrôle est un confort : son échec ne doit pas bloquer la saisie.
      setReport(null)
    } finally {
      setChecking(false)
    }
  }, [incomeId, receipt])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void runCheck() }, 400)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [runCheck])

  // Net attendu, calculé localement pour un retour immédiat pendant la frappe.
  // Le contrôle qui fait foi reste celui du backend.
  const netPreview = useMemo(() => {
    const sum = (keys: readonly { key: MoneyKey }[]) =>
      keys.reduce((acc, f) => acc + (parseMoney(form[f.key]) ?? 0), 0)
    const gross =
      parseMoney(form.gross_amount) ??
      sum(GROSS_FIELDS) + (parseMoney(form.family_allowance_amount) ?? 0)
    return gross - sum(DEDUCTION_FIELDS) + sum(EXPENSE_FIELDS)
  }, [form])

  const declaredNet = parseMoney(form.amount) ?? 0
  const netGap = declaredNet - netPreview
  const netMatches = Math.abs(netGap) < 1

  /// Pré-remplit le formulaire depuis un bulletin scanné. Rien n'est
  /// enregistré : l'utilisateur relit, corrige, et c'est le contrôle de
  /// conformité qui se déclenche derrière — c'est là que se voient les
  /// erreurs de lecture de l'IA autant que celles de l'employeur.
  const applyExtraction = (x: api.ExtractedPayslip): string => {
    let filled: string[] = []
    setForm((f) => {
      const applied = applyExtractionToForm(f, x)
      filled = applied.filled
      return applied.form
    })
    // Les sections repliées cacheraient les champs remplis.
    setOpenSections({ gross: true, supplements: true, deductions: true, expenses: true })
    return extractionSummary(filled)
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form.received_on || parseMoney(form.amount) == null) return
    await onSubmit(receipt, supplementItems)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <AiScanPanel
        fr
        title="Scanner le bulletin"
        subtitle="PDF ou photo. L'IA pré-remplit les postes ; le contrôle de conformité tourne ensuite sur ce qu'elle a lu."
        disabled={submitting}
        onExtract={async (text) =>
          applyExtraction(await api.aiExtractPayslip(text, getAiSettings()))
        }
      />

      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Versé le *</label>
              <Input
                type="date"
                value={form.received_on}
                onChange={(e) => set("received_on", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Début de période</label>
              <Input
                type="date"
                value={form.period_start}
                onChange={(e) => set("period_start", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fin de période</label>
              <Input
                type="date"
                value={form.period_end}
                onChange={(e) => set("period_end", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Détermine l'année fiscale : un salaire de décembre versé en
                janvier reste sur l'exercice précédent.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Libellé</label>
              <Input
                value={form.period_label}
                onChange={(e) => set("period_label", e.target.value)}
                placeholder="ex : Mars 2026"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Net versé *</label>
              <Input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Brut total imprimé</label>
              <Input
                type="number"
                step="0.01"
                value={form.gross_amount}
                onChange={(e) => set("gross_amount", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Facultatif. S'il est renseigné, il fait foi sur le détail ci-dessous.
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Net attendu</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatPrice(netPreview, currency)}
              </p>
              {declaredNet > 0 && (
                <p
                  className={cn(
                    "text-xs mt-0.5",
                    netMatches
                      ? "text-emerald-600 dark:text-emerald-500"
                      : "text-amber-600 dark:text-amber-500",
                  )}
                >
                  {netMatches
                    ? "✓ cohérent avec le net versé"
                    : `écart de ${formatPrice(netGap, currency)}`}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Section
        title="Éléments du brut"
        subtitle="Les allocations familiales sont à part : elles s'ajoutent au brut sans être soumises aux cotisations."
        open={openSections.gross}
        onToggle={() => setOpenSections((s) => ({ ...s, gross: !s.gross }))}
      >
        {GROSS_FIELDS.map((f) => (
          <MoneyInput
            key={f.key}
            label={f.label}
            value={form[f.key]}
            onChange={(v) => set(f.key, v)}
            hint={
              f.key === "other_gross_amount" && supplementRates.length > 0
                ? "Rempli par les suppléments ci-dessous ; corrigez-le si votre bulletin porte autre chose."
                : undefined
            }
          />
        ))}
        <MoneyInput
          label="Allocations familiales"
          value={form.family_allowance_amount}
          onChange={(v) => set("family_allowance_amount", v)}
          hint="Imposables, mais hors assiette AVS (art. 6 RAVS)."
        />
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Heures supplémentaires (h)</label>
          <Input
            type="number"
            step="0.25"
            value={form.overtime_hours}
            onChange={(e) => set("overtime_hours", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Permet de vérifier la majoration de 25 % (art. 321c al. 3 CO).
          </p>
        </div>
      </Section>

      {supplementRates.length > 0 && (
        <Section
          title="Astreintes, week-ends et autres suppléments"
          subtitle="Indiquez les quantités : le montant se calcule au barème de votre contrat et alimente « Autre élément de salaire »."
          open={openSections.supplements}
          onToggle={() => setOpenSections((s) => ({ ...s, supplements: !s.supplements }))}
        >
          <ReceiptSupplements
            rates={supplementRates}
            quantities={quantities}
            onQuantity={setQuantity}
            paidAmount={parseMoney(form.other_gross_amount)}
            onUseComputed={(amount) => set("other_gross_amount", String(amount))}
            currency={currency}
            contractLabel={contracts.length > 1 ? activeContract?.label ?? null : null}
          />
        </Section>
      )}

      <Section
        title="Retenues"
        subtitle="Chaque poste doit figurer séparément sur votre décompte (art. 323b al. 1 CO)."
        open={openSections.deductions}
        onToggle={() => setOpenSections((s) => ({ ...s, deductions: !s.deductions }))}
      >
        {DEDUCTION_FIELDS.map((f) => (
          <MoneyInput
            key={f.key}
            label={f.label}
            value={form[f.key]}
            onChange={(v) => set(f.key, v)}
          />
        ))}
      </Section>

      <Section
        title="Frais remboursés"
        subtitle="Ni salaire, ni revenu imposable (art. 327a CO) — rubrique 13 du certificat."
        open={openSections.expenses}
        onToggle={() => setOpenSections((s) => ({ ...s, expenses: !s.expenses }))}
      >
        {EXPENSE_FIELDS.map((f) => (
          <MoneyInput
            key={f.key}
            label={f.label}
            value={form[f.key]}
            onChange={(v) => set(f.key, v)}
          />
        ))}
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
          <label className="text-sm font-medium">Notes</label>
          <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </Section>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Enregistrement…" : form.id ? "Enregistrer" : "Ajouter le bulletin"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        {checking && (
          <span className="text-xs text-muted-foreground">Contrôle en cours…</span>
        )}
      </div>

      <PayslipCheckPanel report={report} currency={currency} />
    </form>
  )
}

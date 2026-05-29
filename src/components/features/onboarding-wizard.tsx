import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Sparkles, Wand2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import * as api from "@/lib/tauri"

/// First-run "set up my budget" assistant.
///
/// Aimed at the ordinary Swiss household, not power users: instead of dropping
/// the user on an empty "Ce mois" screen, we ask a handful of plain-language
/// questions (rent, LAMal, insurances…) and create the matching recurring
/// engagements in one shot. The app is then useful from the first minute.
///
/// Consistency note: we only create engagements (same as the manual form in
/// engagements.tsx). We do NOT pre-materialise charges — those are generated
/// lazily by `roll_forward_due_engagements` once a due date passes, so the
/// immediate payoff is the populated Engagements list + monthly budget total,
/// while "Ce mois" fills in as cycles mature. This avoids double-charging.

type Cycle = api.EngagementBillingCycle
type PayMethod = api.EngagementPaymentMethod

interface Suggestion {
  type: api.EngagementType
  label: string
  hint: string
  cycle: Cycle
  paymentMethod: PayMethod
}

// The most common recurring obligations of a Swiss household. Cycles reflect
// how each is typically billed (LAMal monthly, RC/ménage & Serafe yearly,
// electricity quarterly…). The user fills in only what applies to them.
const SUGGESTIONS: Suggestion[] = [
  { type: "rent", label: "Loyer", hint: "Mensuel", cycle: "monthly", paymentMethod: "standing_order" },
  { type: "insurance_health", label: "Assurance maladie (LAMal)", hint: "Mensuel", cycle: "monthly", paymentMethod: "direct_debit" },
  { type: "insurance_household", label: "Assurance ménage / RC", hint: "Annuel", cycle: "yearly", paymentMethod: "qr_bill" },
  { type: "insurance_car", label: "Assurance véhicule", hint: "Annuel", cycle: "yearly", paymentMethod: "qr_bill" },
  { type: "phone", label: "Téléphone mobile", hint: "Mensuel", cycle: "monthly", paymentMethod: "direct_debit" },
  { type: "internet", label: "Internet / TV", hint: "Mensuel", cycle: "monthly", paymentMethod: "direct_debit" },
  { type: "tv_radio", label: "Redevance Serafe (TV/radio)", hint: "Annuel", cycle: "yearly", paymentMethod: "qr_bill" },
  { type: "electricity", label: "Électricité", hint: "Trimestriel", cycle: "quarterly", paymentMethod: "qr_bill" },
  { type: "tax_cantonal", label: "Impôts (acomptes)", hint: "Mensuel", cycle: "monthly", paymentMethod: "qr_bill" },
  { type: "leasing", label: "Leasing / crédit auto", hint: "Mensuel", cycle: "monthly", paymentMethod: "direct_debit" },
]

function onboardingKey(vaultName: string) {
  return `trackbuy-onboarding-${vaultName}`
}

/// First day of next month, as YYYY-MM-DD. A clean, predictable "next due"
/// anchor for freshly created engagements regardless of their cycle.
function firstOfNextMonth(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}-01`
}

export function OnboardingWizard({ vaultName }: { vaultName: string }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  // Amounts keyed by engagement type; empty string = "I don't have this one".
  const [amounts, setAmounts] = useState<Record<string, string>>({})

  // Decide whether to show: only on a fresh vault (no engagements yet) that
  // hasn't already dismissed the assistant. Any failure (browser mode, locked
  // vault) silently keeps it hidden.
  useEffect(() => {
    let cancelled = false
    async function decide() {
      if (localStorage.getItem(onboardingKey(vaultName))) return
      try {
        const existing = await api.getEngagements()
        if (cancelled) return
        if (existing.length > 0) {
          // Established vault — never prompt, and remember that.
          localStorage.setItem(onboardingKey(vaultName), "skipped")
          return
        }
        setVisible(true)
      } catch {
        /* not available (browser mode / locked) — stay hidden */
      }
    }
    setVisible(false)
    setAmounts({})
    decide()
    return () => {
      cancelled = true
    }
  }, [vaultName])

  function dismiss() {
    localStorage.setItem(onboardingKey(vaultName), "skipped")
    setVisible(false)
  }

  const filledCount = SUGGESTIONS.filter((s) => {
    const v = parseFloat(amounts[s.type])
    return !Number.isNaN(v) && v > 0
  }).length

  async function handleCreate() {
    const chosen = SUGGESTIONS.map((s) => ({ s, amount: parseFloat(amounts[s.type]) }))
      .filter(({ amount }) => !Number.isNaN(amount) && amount > 0)

    if (chosen.length === 0) {
      dismiss()
      return
    }

    setSaving(true)
    const nextDue = firstOfNextMonth()
    let created = 0
    try {
      for (const { s, amount } of chosen) {
        await api.createEngagement({
          name: s.label,
          engagement_type: s.type,
          billing_cycle: s.cycle,
          cycle_interval: 1,
          next_due_date: nextDue,
          current_amount: amount,
          currency: "CHF",
          payment_method: s.paymentMethod,
          // Direct debit (LSV) is collected automatically by the creditor.
          auto_pay: s.paymentMethod === "direct_debit",
          status: "active",
        })
        created++
      }
      localStorage.setItem(onboardingKey(vaultName), "completed")
      setVisible(false)
      toast(
        `${created} engagement${created > 1 ? "s" : ""} créé${created > 1 ? "s" : ""} — voici votre budget.`,
        "success",
      )
      navigate("/engagements")
    } catch (e) {
      // Partial success is fine: whatever was created stays. Surface the error
      // so the user knows the rest didn't go through, but don't re-prompt the
      // whole wizard on next unlock if we got at least one in.
      if (created > 0) localStorage.setItem(onboardingKey(vaultName), "completed")
      toast(String(e), "error")
    } finally {
      setSaving(false)
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Mettons en place votre budget</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Indiquez ce que vous payez régulièrement. On crée le reste pour
                vous. Laissez vide ce qui ne vous concerne pas — vous pourrez
                tout ajuster plus tard.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Questions */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-2">
            {SUGGESTIONS.map((s) => (
              <label
                key={s.type}
                className="flex items-center justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-accent/40"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.hint}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="w-28 text-right tabular-nums"
                    value={amounts[s.type] ?? ""}
                    onChange={(e) =>
                      setAmounts((prev) => ({ ...prev, [s.type]: e.target.value }))
                    }
                  />
                  <span className="w-8 text-xs text-muted-foreground">CHF</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t p-4">
          <Button variant="ghost" onClick={dismiss} disabled={saving}>
            Plus tard
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            <Wand2 className="mr-2 h-4 w-4" />
            {filledCount > 0
              ? `Créer mon budget (${filledCount})`
              : "Créer mon budget"}
          </Button>
        </div>
      </div>
    </div>
  )
}

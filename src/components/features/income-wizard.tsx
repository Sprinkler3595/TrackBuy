import { useContext, useEffect, useState } from "react"
import { Award, Briefcase, Check, ChevronLeft, ChevronRight, FileText, HandCoins, Wallet, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { useModalKeyboard } from "@/hooks/use-modal-keyboard"
import { I18nContext } from "@/lib/i18n"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { InlineCreateSelect, type InlineOption } from "@/components/ui/inline-create-select"
import * as api from "@/lib/tauri"

/// Guided creation of an income.
///
/// Three shapes cover what actually lands on a Swiss account: a recurring
/// salary, an extra payment from an employer already known (bonus, 13th
/// salary), and a one-off from someone else. The point of the split is the
/// EMPLOYER: a salary registers the company as a creditor of type "employer",
/// and every later payment from it — a bonus here, an expense claim in
/// Remboursements — reuses that same entry instead of a re-typed name.
///
/// Records are created when entering the final "documents" step (the id is
/// needed to attach files), so Back is hidden there.

type Path = "salary" | "bonus" | "other"
type Step = 1 | 2 | 3

const CYCLES: api.IncomeBillingCycle[] = ["monthly", "quarterly", "yearly"]

const cycleLabel = (c: api.IncomeBillingCycle, fr: boolean): string =>
  c === "monthly"   ? (fr ? "Mensuel" : "Monthly") :
  c === "quarterly" ? (fr ? "Trimestriel" : "Quarterly") :
                      (fr ? "Annuel" : "Yearly")

/// Extra payments an employer makes on top of the salary.
const BONUS_TYPES: api.IncomeType[] = ["bonus", "thirteenth"]

const bonusLabel = (t: api.IncomeType, fr: boolean): string =>
  t === "thirteenth" ? (fr ? "13e salaire" : "13th salary") : (fr ? "Prime / bonus" : "Bonus")

const today = () => new Date().toISOString().slice(0, 10)

function firstOfNextMonth(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

interface IncomeWizardProps {
  /// Existing incomes — used to surface employers already typed in before the
  /// creditor registry existed.
  incomes: api.Income[]
  cards: api.PaymentCard[]
  onClose: () => void
}

export function IncomeWizard({ incomes, cards, onClose }: IncomeWizardProps) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()

  const [step, setStep] = useState<Step>(1)
  const [path, setPath] = useState<Path>("salary")
  const [saving, setSaving] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdName, setCreatedName] = useState("")

  // id is a real creditor id, or "legacy:<name>" for an employer that only
  // exists as free text on an older income (promoted on first use).
  const [employers, setEmployers] = useState<InlineOption[]>([])
  const [cardList, setCardList] = useState<api.PaymentCard[]>(cards)

  useModalKeyboard(!saving, onClose)

  // Employers already registered as creditors, plus the ones that only exist
  // as a free-text source on an older income (migrated on the fly the first
  // time they're picked here).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const known = await api.getCreditors({ creditor_type: "employer" })
        if (cancelled) return
        const names = new Set(known.map((c) => c.name.trim().toLowerCase()))
        const legacy = incomes
          .filter((i) => i.income_type === "salary" && i.source_name?.trim())
          .map((i) => (i.source_name as string).trim())
          .filter((n) => !names.has(n.toLowerCase()))
        const uniqueLegacy = Array.from(new Set(legacy)).map((name) => ({ id: `legacy:${name}`, name }))
        setEmployers([...known, ...uniqueLegacy].sort((a, b) => a.name.localeCompare(b.name)))
      } catch {
        if (!cancelled) setEmployers([])
      }
    })()
    return () => { cancelled = true }
  }, [incomes])

  async function createEmployer(name: string): Promise<api.Creditor | null> {
    try {
      const c = await api.createCreditor({ name: name.trim(), creditor_type: "employer" })
      setEmployers((prev) => [...prev.filter((e) => e.name !== c.name), c].sort((a, b) => a.name.localeCompare(b.name)))
      return c
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
      return null
    }
  }

  async function createAccount(name: string): Promise<api.PaymentCard | null> {
    try {
      const c = await api.createCard({ name, is_credit_card: false })
      setCardList((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      return c
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
      return null
    }
  }

  // --- shared fields ---
  const [employerId, setEmployerId] = useState("")
  const [amount, setAmount] = useState("")
  const [cardId, setCardId] = useState("")
  const [notes, setNotes] = useState("")

  // --- salary ---
  const [cycle, setCycle] = useState<api.IncomeBillingCycle>("monthly")
  const [nextDate, setNextDate] = useState(firstOfNextMonth())
  const [startedOn, setStartedOn] = useState("")
  const [workload, setWorkload] = useState("100")

  // --- bonus ---
  const [bonusType, setBonusType] = useState<api.IncomeType>("bonus")
  const [bonusLabelText, setBonusLabelText] = useState("")
  const [bonusDate, setBonusDate] = useState(today())

  // --- other ---
  const [otherName, setOtherName] = useState("")
  const [otherSource, setOtherSource] = useState("")
  const [otherDate, setOtherDate] = useState(today())

  const employerName = employers.find((e) => e.id === employerId)?.name ?? ""
  const amountValue = parseFloat(amount)
  const amountValid = !Number.isNaN(amountValue) && amountValue > 0

  const step2Valid =
    path === "salary" ? !!employerName && amountValid :
    path === "bonus"  ? !!employerName && amountValid :
                        otherName.trim().length > 0 && amountValid

  /// A "legacy:" option is an employer that only existed as free text on an
  /// old income — promote it to a real creditor the first time it's used, so
  /// the reimbursement assistant finds it too.
  async function resolveEmployer(): Promise<string> {
    if (!employerId.startsWith("legacy:")) return employerName
    const name = employerId.slice("legacy:".length)
    const created = await createEmployer(name)
    if (created) setEmployerId(created.id)
    return name
  }

  async function create() {
    setSaving(true)
    try {
      let income: api.Income
      if (path === "salary") {
        const source = await resolveEmployer()
        const workloadNote = workload.trim() && workload.trim() !== "100"
          ? `${fr ? "Taux d'activité" : "Workload"} : ${workload.trim()}%`
          : ""
        income = await api.createIncome({
          name: fr ? `Salaire ${source}` : `${source} salary`,
          income_type: "salary",
          source_name: source,
          payment_card_id: cardId || null,
          billing_cycle: cycle,
          cycle_interval: 1,
          next_expected_date: nextDate || null,
          current_amount: amountValue,
          currency: "CHF",
          status: "active",
          started_on: startedOn || null,
          notes: [workloadNote, notes.trim()].filter(Boolean).join(" · ") || null,
        })
      } else if (path === "bonus") {
        const source = await resolveEmployer()
        const label = bonusLabelText.trim() || `${bonusLabel(bonusType, fr)} ${source}`
        income = await api.createIncome({
          name: label,
          income_type: bonusType,
          source_name: source,
          payment_card_id: cardId || null,
          // A bonus is paid once: it must not roll forward like a salary.
          billing_cycle: "one_shot",
          cycle_interval: 1,
          next_expected_date: bonusDate || null,
          current_amount: amountValue,
          currency: "CHF",
          status: "active",
          notes: notes.trim() || null,
        })
      } else {
        income = await api.createIncome({
          name: otherName.trim(),
          income_type: "other",
          source_name: otherSource.trim() || null,
          payment_card_id: cardId || null,
          billing_cycle: "one_shot",
          cycle_interval: 1,
          next_expected_date: otherDate || null,
          current_amount: amountValue,
          currency: "CHF",
          status: "active",
          notes: notes.trim() || null,
        })
      }
      setCreatedId(income.id)
      setCreatedName(income.name)
      setStep(3)
      toast(fr ? "Revenu créé. Ajoutez vos documents." : "Income created. Now add documents.", "success")
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  const stepTitle =
    step === 1 ? (fr ? "De quoi s'agit-il ?" : "What kind of income?") :
    step === 2 ? (path === "salary" ? (fr ? "L'employeur et le salaire" : "Employer and salary")
                : path === "bonus" ? (fr ? "La prime" : "The bonus")
                : (fr ? "Le versement" : "The payment")) :
                 (fr ? "Documents" : "Documents")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {step === 3 ? <FileText className="h-5 w-5" /> : <HandCoins className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fr ? "Nouveau revenu" : "New income"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {fr ? "Étape" : "Step"} {step}/3 — {stepTitle}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving} aria-label={fr ? "Fermer" : "Close"}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-2">
              <PathButton
                active={path === "salary"}
                icon={Briefcase}
                title={fr ? "Salaire régulier" : "Recurring salary"}
                hint={fr
                  ? "Versé chaque mois par une entreprise — l'employeur est enregistré et réutilisé partout"
                  : "Paid monthly by a company — the employer is registered and reused everywhere"}
                onClick={() => setPath("salary")}
              />
              <PathButton
                active={path === "bonus"}
                icon={Award}
                title={fr ? "Prime, bonus ou 13e" : "Bonus or 13th salary"}
                hint={fr
                  ? "Versement en plus, de l'un de vos employeurs déjà connus"
                  : "An extra payment from one of your known employers"}
                onClick={() => setPath("bonus")}
              />
              <PathButton
                active={path === "other"}
                icon={Wallet}
                title={fr ? "Autre revenu ponctuel" : "Other one-off income"}
                hint={fr
                  ? "Loyer encaissé, dividende, allocation, cadeau…"
                  : "Rent received, dividend, allowance, gift…"}
                onClick={() => setPath("other")}
              />
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {(path === "salary" || path === "bonus") && (
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">{fr ? "Employeur" : "Employer"} *</label>
                  <InlineCreateSelect
                    value={employerId}
                    onChange={setEmployerId}
                    options={employers}
                    onCreate={createEmployer}
                    placeholder={fr ? "Nom de l'entreprise" : "Company name"}
                    createTitle={fr ? "Nouvel employeur" : "New employer"}
                    fr={fr}
                  />
                  <p className="text-xs text-muted-foreground">
                    {fr
                      ? "Cette entreprise sera proposée automatiquement pour vos primes et vos notes de frais."
                      : "This company is then offered automatically for bonuses and expense claims."}
                  </p>
                </div>
              )}

              {path === "bonus" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Nature" : "Kind"}</label>
                    <select className={fieldCls} value={bonusType}
                      onChange={(e) => setBonusType(e.target.value as api.IncomeType)}>
                      {BONUS_TYPES.map((t) => <option key={t} value={t}>{bonusLabel(t, fr)}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Désignation" : "Label"}</label>
                    <Input value={bonusLabelText} onChange={(e) => setBonusLabelText(e.target.value)}
                      placeholder={fr ? "Ex : Bonus 2026" : "e.g. 2026 bonus"} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Date de versement" : "Payment date"}</label>
                    <Input type="date" value={bonusDate} onChange={(e) => setBonusDate(e.target.value)} />
                  </div>
                </>
              )}

              {path === "other" && (
                <>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{fr ? "Désignation" : "Label"} *</label>
                    <Input value={otherName} onChange={(e) => setOtherName(e.target.value)} autoFocus
                      placeholder={fr ? "Ex : Loyer sous-location août" : "e.g. August sublet rent"} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Provenance" : "Source"}</label>
                    <Input value={otherSource} onChange={(e) => setOtherSource(e.target.value)}
                      placeholder={fr ? "Ex : AVS, locataire…" : "e.g. pension fund, tenant…"} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Date attendue" : "Expected date"}</label>
                    <Input type="date" value={otherDate} onChange={(e) => setOtherDate(e.target.value)} />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {path === "salary" ? (fr ? "Salaire net (CHF)" : "Net salary (CHF)") : (fr ? "Montant (CHF)" : "Amount (CHF)")} *
                </label>
                <Input type="number" min="0" step="0.01" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>

              {path === "salary" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Périodicité" : "Frequency"}</label>
                    <select className={fieldCls} value={cycle}
                      onChange={(e) => setCycle(e.target.value as api.IncomeBillingCycle)}>
                      {CYCLES.map((c) => <option key={c} value={c}>{cycleLabel(c, fr)}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Prochain versement" : "Next payment"}</label>
                    <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Date d'entrée" : "Start date"}</label>
                    <Input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Taux d'activité (%)" : "Workload (%)"}</label>
                    <Input type="number" min="1" max="100" value={workload}
                      onChange={(e) => setWorkload(e.target.value)} placeholder="100" />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Compte crédité" : "Credited account"}</label>
                <InlineCreateSelect
                  value={cardId}
                  onChange={setCardId}
                  options={cardList}
                  onCreate={createAccount}
                  placeholder={fr ? "Nom du compte" : "Account name"}
                  createTitle={fr ? "Nouveau compte" : "New account"}
                  fr={fr}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Notes" : "Notes"}</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          )}

          {step === 3 && createdId && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {fr
                  ? "Ajoutez le contrat de travail, une fiche de salaire ou le décompte de la prime. Vous pourrez en ajouter d'autres depuis la fiche."
                  : "Attach the employment contract, a payslip or the bonus statement. You can add more later from the income page."}
              </p>
              <AttachmentsPanel incomeId={createdId} itemDescription={createdName} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t p-4">
          {step === 1 && <Button variant="ghost" onClick={onClose} disabled={saving}>{fr ? "Annuler" : "Cancel"}</Button>}
          {step === 2 && (
            <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>
              <ChevronLeft className="mr-1 h-4 w-4" />{fr ? "Retour" : "Back"}
            </Button>
          )}
          {step === 3 && <span />}

          {step === 1 && (
            <Button onClick={() => setStep(2)}>
              {fr ? "Suivant" : "Next"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={create} disabled={saving || !step2Valid}>
              {fr ? "Créer le revenu" : "Create income"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={onClose}><Check className="mr-1 h-4 w-4" />{fr ? "Terminer" : "Finish"}</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function PathButton({
  active, icon: Icon, title, hint, onClick,
}: {
  active: boolean
  icon: typeof Briefcase
  title: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
        active ? "border-primary bg-primary/5" : "hover:bg-accent/40"
      }`}
    >
      <span className={`rounded-lg p-2 ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}

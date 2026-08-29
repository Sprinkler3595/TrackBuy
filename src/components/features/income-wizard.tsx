import { useContext, useEffect, useState } from "react"
import { Award, Briefcase, Check, ChevronLeft, ChevronRight, FileText, HandCoins, Wallet, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { useModalKeyboard } from "@/hooks/use-modal-keyboard"
import { I18nContext } from "@/lib/i18n"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { InlineCreateSelect, type InlineOption } from "@/components/ui/inline-create-select"
import { GrossToNetSummary } from "@/components/features/gross-to-net-summary"
import { RateField } from "@/components/features/rate-field"
import { useNetFromGross } from "@/hooks/use-net-from-gross"
import { formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"
import { CANTONS, WORK_CANTON_HINT } from "@/lib/cantons"

/// Guided creation of an income.
///
/// Three shapes cover what actually lands on a Swiss account: a recurring
/// salary, an extra payment from an employer already known (bonus, 13th
/// salary), and a one-off from someone else. The point of the split is the
/// EMPLOYER: a salary registers the company as a creditor of type "employer",
/// and every later payment from it — a bonus here, an expense claim in
/// Remboursements — reuses that same entry instead of a re-typed name.
///
/// Le salaire passe par TROIS écrans courts plutôt qu'un seul très long.
/// L'écran unique demandait d'un coup l'employeur, le montant, la périodicité,
/// trois dates, le taux d'activité, la clôture de l'emploi, huit taux dans un
/// volet dépliable et le compte crédité : on ne savait plus ce qui était
/// indispensable ni ce qui pouvait attendre. Le découpage répond à trois
/// questions distinctes, dans l'ordre où on les connaît — QUI vous emploie, à
/// QUELLES conditions, et avec QUELLES retenues.
///
/// Records are created when entering the final "documents" step (the id is
/// needed to attach files), so Back is hidden there.

type Path = "salary" | "bonus" | "other"

/// 1 nature · 2 entreprise (ou versement, hors salaire) · 3 contrat ·
/// 4 cotisations · 5 documents.
type Step = 1 | 2 | 3 | 4 | 5

/// Extra payments an employer makes on top of the salary.
const BONUS_TYPES: api.IncomeType[] = ["bonus", "thirteenth"]

const bonusLabel = (t: api.IncomeType, fr: boolean): string =>
  t === "thirteenth" ? (fr ? "13e salaire" : "13th salary") : (fr ? "Prime / bonus" : "Bonus")

/// Saisie numérique optionnelle : vide ou illisible → `null`, jamais 0.
/// Un taux absent n'est pas un taux nul — le moteur refuse d'ailleurs de
/// retenir quoi que ce soit sur un taux qu'il ne connaît pas.
const optionalNumber = (v: string): number | null => {
  const t = v.trim()
  if (!t) return null
  const n = parseFloat(t)
  return Number.isNaN(n) ? null : n
}

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
  /// Les employeurs déjà enregistrés, entiers. `employers` n'en garde que le
  /// nom et l'identifiant pour la liste déroulante ; l'adresse vit ici.
  const [knownEmployers, setKnownEmployers] = useState<api.Creditor[]>([])
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
        setKnownEmployers(known)
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
      setKnownEmployers((prev) => [...prev.filter((e) => e.id !== c.id), c])
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

  // --- écran 2 : l'entreprise ---
  const [employerUid, setEmployerUid] = useState("")
  const [employerAddress, setEmployerAddress] = useState("")

  // --- écran 3 : le contrat ---
  /// Le brut ANNUEL, parce que c'est lui qui est écrit au contrat : « 50 000
  /// sur 13 paies » se lit sur la page signée, pas « 3 846.15 par mois ».
  const [annualGross, setAnnualGross] = useState("")
  /// 12 ou 13 : le 13ᵉ salaire versé à part est une période de plus, pas un
  /// mois plus gros — c'est ce qui fait le salaire coordonné LPP.
  const [payPeriods, setPayPeriods] = useState("12")
  const [weeklyHours, setWeeklyHours] = useState("")
  const [nextDate, setNextDate] = useState(firstOfNextMonth())
  const [startedOn, setStartedOn] = useState("")
  const [workload, setWorkload] = useState("100")
  /// Emploi passé : c'est ce qui permet de reprendre une carrière, employeur
  /// par employeur. Un revenu terminé n'attend plus de versement — sa date
  /// devient celle du DERNIER, pas du prochain.
  const [ended, setEnded] = useState(false)
  const [endedOn, setEndedOn] = useState("")

  // --- écran 4 : les cotisations ---
  /// Le brut est le mode normal. La bascule vers le net existe pour qui n'a
  /// pas sa fiche de salaire sous les yeux : sans elle, un utilisateur qui
  /// ignore ses taux ne pourrait plus rien créer. Elle saute l'écran 4.
  const [grossMode, setGrossMode] = useState(true)
  const [birthDate, setBirthDate] = useState("")
  const [canton, setCanton] = useState("")
  const [lppPct, setLppPct] = useState("")
  const [laaPct, setLaaPct] = useState("")
  const [ijmPct, setIjmPct] = useState("")
  const [taxAtSource, setTaxAtSource] = useState(false)
  const [taxScale, setTaxScale] = useState("")
  const [taxRate, setTaxRate] = useState("")

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

  const periodsPerYear = parseInt(payPeriods, 10) === 13 ? 13 : 12
  const thirteenth = periodsPerYear === 13

  /// Le brut d'une paie se déduit de l'annuel : c'est l'annuel qui est écrit
  /// au contrat, et le déduire évite de faire calculer une division à
  /// quelqu'un qui a mieux à faire.
  const annualGrossValue = parseFloat(annualGross)
  const annualGrossValid = !Number.isNaN(annualGrossValue) && annualGrossValue > 0
  const grossPerPeriod = annualGrossValid ? annualGrossValue / periodsPerYear : null

  /// Les barèmes changent au 1er janvier : c'est l'année du VERSEMENT qui
  /// compte, pas celle où l'on remplit le formulaire.
  const payYear = parseInt((nextDate || today()).slice(0, 4), 10) || new Date().getFullYear()

  const netRequest: api.NetFromGrossRequest | null =
    path === "salary" && grossMode && grossPerPeriod != null
      ? {
          year: payYear,
          gross_per_period: grossPerPeriod,
          terms: {
            birth_date: birthDate || null,
            activity_rate_pct: optionalNumber(workload),
            weekly_hours: optionalNumber(weeklyHours),
            salary_periods_per_year: periodsPerYear,
            thirteenth_salary: thirteenth,
            lpp_employee_share_pct: optionalNumber(lppPct),
            laa_nonoccupational_pct: optionalNumber(laaPct),
            ijm_employee_pct: optionalNumber(ijmPct),
            tax_at_source: taxAtSource,
          },
          work_canton: canton || null,
          tax_at_source_scale: taxScale.trim() || null,
          tax_at_source_rate_pct: optionalNumber(taxRate),
        }
      : null

  const { result: netResult, loading: netLoading, error: netError } = useNetFromGross(netRequest)

  /// Ce qui sera enregistré comme montant du revenu : toujours le NET, c'est
  /// lui qui arrive sur le compte et que « Ce mois » additionne.
  const netAmount = grossMode ? (netResult?.net_per_period ?? null) : amountValue

  /// Un recalcul en cours veut dire que `netResult` porte encore le net du
  /// brut PRÉCÉDENT. Enregistrer maintenant sauverait un montant qui ne
  /// correspond plus à ce qui est affiché : on attend.
  const salaryReady = grossMode ? netAmount != null && !netLoading : amountValid

  /// Ce qu'il faut avoir renseigné pour quitter l'écran courant. Une seule
  /// règle par écran, plutôt qu'un bouton grisé dont on ignore la raison.
  const canLeaveStep =
    step === 1 ? true :
    step === 2 ? (path === "salary" ? !!employerName
                : path === "bonus"  ? !!employerName && amountValid
                :                     otherName.trim().length > 0 && amountValid) :
    step === 3 ? (grossMode ? annualGrossValid : amountValid) :
    step === 4 ? salaryReady :
                 true

  /// L'enchaînement des écrans dépend du chemin, et du mode brut/net : qui
  /// saisit son net directement n'a aucun taux à donner, donc rien à faire sur
  /// l'écran des cotisations.
  const sequence: Step[] =
    path !== "salary" ? [1, 2] : grossMode ? [1, 2, 3, 4] : [1, 2, 3]
  const seqIndex = sequence.indexOf(step)
  const isLastInput = seqIndex === sequence.length - 1

  /// Deuxième salaire chez le même employeur : ses taux sont déjà connus.
  /// Les redemander serait leur faire dire deux fois la même chose, avec le
  /// risque qu'ils divergent.
  useEffect(() => {
    if (path !== "salary" || !employerName) return
    let cancelled = false
    ;(async () => {
      const sibling = incomes.find(
        (i) =>
          i.income_type === "salary" &&
          i.source_name?.trim().toLowerCase() === employerName.trim().toLowerCase(),
      )
      if (!sibling) return
      try {
        const c = await api.getEmploymentContract(sibling.id)
        if (cancelled || !c) return
        const str = (v: number | null) => (v == null ? "" : String(v))
        // Ne jamais écraser ce que l'utilisateur a déjà tapé.
        setBirthDate((v) => v || c.birth_date || "")
        setCanton((v) => v || c.work_canton || "")
        setLppPct((v) => v || str(c.lpp_employee_share_pct))
        setLaaPct((v) => v || str(c.laa_nonoccupational_pct))
        setIjmPct((v) => v || str(c.ijm_employee_pct))
        setTaxScale((v) => v || c.tax_at_source_scale || "")
        setTaxRate((v) => v || str(c.tax_at_source_rate_pct))
        setEmployerUid((v) => v || c.employer_uid || "")
        setWeeklyHours((v) => v || str(c.weekly_hours))
        setPayPeriods((v) => (v !== "12" ? v : String(c.salary_periods_per_year ?? 12)))
        setTaxAtSource(c.tax_at_source)
      } catch {
        // Pas de contrat lisible : l'utilisateur saisira ses taux.
      }
    })()
    return () => { cancelled = true }
  }, [employerName, incomes, path])

  /// L'adresse d'une entreprise déjà connue est déjà enregistrée : la
  /// redemander donnerait deux versions de la même adresse, et rien ne dirait
  /// laquelle fait foi.
  useEffect(() => {
    const known = knownEmployers.find((e) => e.id === employerId)
    if (known?.address) setEmployerAddress((v) => v || (known.address as string))
  }, [employerId, knownEmployers])

  /// A "legacy:" option is an employer that only existed as free text on an
  /// old income — promote it to a real creditor the first time it's used, so
  /// the reimbursement assistant finds it too.
  ///
  /// L'adresse saisie à l'écran 2 est enregistrée sur l'ENTREPRISE, pas sur le
  /// contrat : elle ne change pas quand on signe un avenant, et elle sert
  /// ailleurs — les notes de frais s'adressent au même destinataire.
  async function resolveEmployer(): Promise<string> {
    let creditor = knownEmployers.find((c) => c.id === employerId) ?? null
    let name = employerName
    if (employerId.startsWith("legacy:")) {
      name = employerId.slice("legacy:".length)
      creditor = await createEmployer(name)
      if (creditor) setEmployerId(creditor.id)
    }
    const address = employerAddress.trim()
    if (creditor && address && (creditor.address ?? "") !== address) {
      try {
        await api.updateCreditor({ ...creditor, address })
      } catch {
        // L'adresse est un confort : son échec ne doit pas perdre le revenu.
      }
    }
    return name
  }

  async function create() {
    setSaving(true)
    try {
      let income: api.Income
      if (path === "salary") {
        const source = await resolveEmployer()
        income = await api.createIncome({
          name: fr ? `Salaire ${source}` : `${source} salary`,
          income_type: "salary",
          source_name: source,
          payment_card_id: cardId || null,
          billing_cycle: "monthly",
          cycle_interval: 1,
          next_expected_date: nextDate || null,
          // Le NET : c'est ce qui arrive sur le compte, donc ce que « Ce mois »
          // et les prévisions doivent compter. Le brut vit au contrat.
          current_amount: netAmount ?? amountValue,
          currency: "CHF",
          status: ended ? "ended" : "active",
          started_on: startedOn || null,
          ended_on: ended ? endedOn || null : null,
          notes: notes.trim() || null,
        })
        // Le contrat garde ce que l'assistant vient d'apprendre : sans lui, le
        // taux d'activité et les taux de l'employeur seraient perdus, et le
        // recalcul du net au 1er janvier repartirait de zéro. Il vient APRÈS le
        // revenu : sa clé étrangère l'exige.
        try {
          await api.upsertEmploymentContract({
            id: "",
            income_id: income.id,
            label: "Contrat initial",
            employer_name: source,
            employer_uid: employerUid.trim() || null,
            avs_number: null,
            birth_date: birthDate || null,
            work_canton: canton || null,
            // L'assistant ne demande qu'un canton : le cas courant est d'y
            // vivre et d'y travailler. Qui habite ailleurs le précisera sur la
            // fiche du revenu, où la question est posée explicitement.
            residence_canton: canton || null,
            tax_at_source_canton_source: "residence",
            activity_rate_pct: optionalNumber(workload),
            annual_gross_agreed: grossMode ? annualGrossValue : null,
            salary_periods_per_year: periodsPerYear,
            weekly_hours: optionalNumber(weeklyHours),
            hourly_paid: false,
            thirteenth_salary: thirteenth,
            lpp_fund_name: null,
            lpp_employee_share_pct: optionalNumber(lppPct),
            // Le règlement de caisse décide si les suppléments sont assurés.
            // « total » est le cas le plus répandu ; la fiche du revenu permet
            // de le corriger si votre caisse n'assure que le salaire de base.
            lpp_insured_scope: "total",
            laa_insurer: null,
            laa_nonoccupational_pct: optionalNumber(laaPct),
            ijm_employee_pct: optionalNumber(ijmPct),
            tax_at_source: taxAtSource,
            tax_at_source_scale: taxScale.trim() || null,
            tax_at_source_rate_pct: optionalNumber(taxRate),
            company_car_purchase_price: null,
            subsidized_canteen: false,
            commute_km_per_day: null,
            commute_public_transport_cost_year: null,
            started_on: startedOn || null,
            ended_on: ended ? endedOn || null : null,
            notes: null,
            created_at: "",
            updated_at: "",
          })
        } catch (e) {
          // Le revenu existe : on ne perd pas la saisie pour autant.
          toast(
            fr
              ? `Revenu créé, mais le contrat n'a pas pu être enregistré (${e}). Complétez-le depuis la fiche.`
              : `Income created, but the contract could not be saved (${e}). Fill it in from the income page.`,
            "info",
          )
        }
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
      setStep(5)
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
    step === 2 ? (path === "salary" ? (fr ? "L'entreprise" : "The company")
                : path === "bonus" ? (fr ? "La prime" : "The bonus")
                : (fr ? "Le versement" : "The payment")) :
    step === 3 ? (fr ? "Le contrat" : "The contract") :
    step === 4 ? (fr ? `Les cotisations ${payYear}` : `${payYear} contributions`) :
                 (fr ? "Documents" : "Documents")

  // Numérotation sur le parcours réel : annoncer « étape 2/5 » à quelqu'un qui
  // n'en verra que trois lui ferait croire qu'il en reste deux à subir.
  const stepNumber = step === 5 ? sequence.length + 1 : seqIndex + 1
  const stepCount = sequence.length + 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {step === 5 ? <FileText className="h-5 w-5" /> : <HandCoins className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fr ? "Nouveau revenu" : "New income"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {fr ? "Étape" : "Step"} {stepNumber}/{stepCount} — {stepTitle}
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

          {/* ---------- Écran 2 · l'entreprise (salaire) ---------- */}
          {step === 2 && path === "salary" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Nom de l'entreprise" : "Company name"} *</label>
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

              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Numéro IDE" : "Company UID"}</label>
                <Input
                  value={employerUid}
                  onChange={(e) => setEmployerUid(e.target.value)}
                  placeholder="CHE-123.456.789"
                />
                <p className="text-xs text-muted-foreground">
                  {fr
                    ? "Il figure en tête de votre fiche de salaire et identifie l'entreprise sans ambiguïté."
                    : "It appears at the top of your payslip and identifies the company unambiguously."}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Adresse" : "Address"}</label>
                <Input
                  value={employerAddress}
                  onChange={(e) => setEmployerAddress(e.target.value)}
                  placeholder={fr ? "Rue, NPA, localité" : "Street, postcode, town"}
                />
              </div>

              <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {fr
                  ? "L'IDE et l'adresse sont facultatifs. Ils ne servent à aucun calcul — seulement à retrouver l'entreprise et à adresser un courrier."
                  : "The UID and address are optional. No calculation uses them — they only help identify the company and address a letter."}
              </p>
            </div>
          )}

          {/* ---------- Écran 2 · prime ou revenu ponctuel ---------- */}
          {step === 2 && path !== "salary" && (
            <div className="grid gap-4 sm:grid-cols-2">
              {path === "bonus" && (
                <>
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
                  </div>
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
                <label className="text-sm font-medium">{fr ? "Montant (CHF)" : "Amount (CHF)"} *</label>
                <Input type="number" min="0" step="0.01" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>

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

          {/* ---------- Écran 3 · le contrat ---------- */}
          {step === 3 && (
            <div className="space-y-4">
              {grossMode ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {fr ? "Salaire brut annuel (CHF)" : "Annual gross salary (CHF)"} *
                  </label>
                  <Input type="number" min="0" step="0.01" value={annualGross} autoFocus
                    onChange={(e) => setAnnualGross(e.target.value)} placeholder="50000.00" />
                  <p className="text-xs text-muted-foreground">
                    {grossPerPeriod != null
                      ? (fr
                          ? `Soit ${formatPrice(grossPerPeriod, "CHF")} brut par paie, sur ${periodsPerYear} paies.`
                          : `That is ${formatPrice(grossPerPeriod, "CHF")} gross per pay, over ${periodsPerYear} pays.`)
                      : (fr
                          ? "Le montant convenu au contrat, avant toute retenue."
                          : "The amount agreed in the contract, before any deduction.")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {fr ? "Salaire net reçu, par paie (CHF)" : "Net salary received, per pay (CHF)"} *
                  </label>
                  <Input type="number" min="0" step="0.01" value={amount} autoFocus
                    onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                  <p className="text-xs text-muted-foreground">
                    {fr
                      ? "Ce qui arrive réellement sur votre compte. Aucune retenue ne sera calculée."
                      : "What actually reaches your account. No deduction will be computed."}
                  </p>
                </div>
              )}

              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setGrossMode((v) => !v)}
              >
                {grossMode
                  ? (fr ? "Je ne connais pas mes taux — saisir directement le net que je reçois" : "I don't know my rates — enter the net I receive")
                  : (fr ? "Saisir le brut annuel et calculer les retenues" : "Enter the annual gross and compute deductions")}
              </button>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Nombre de paies par an" : "Pays per year"}</label>
                  <select className={fieldCls} value={payPeriods}
                    onChange={(e) => setPayPeriods(e.target.value)}>
                    <option value="12">{fr ? "12 — pas de 13ᵉ salaire" : "12 — no 13th salary"}</option>
                    <option value="13">{fr ? "13 — avec 13ᵉ salaire" : "13 — with a 13th salary"}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Heures par semaine" : "Hours per week"}</label>
                  <Input type="number" min="0" step="0.5" value={weeklyHours}
                    onChange={(e) => setWeeklyHours(e.target.value)} placeholder="42" />
                  <p className="text-xs text-muted-foreground">
                    {fr
                      ? "Sert à contrôler la majoration de 25 % sur vos heures supplémentaires."
                      : "Used to check the 25 % premium on your overtime."}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Date de début du contrat" : "Contract start date"}</label>
                  <Input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {ended
                      ? (fr ? "Dernier versement" : "Last payment")
                      : (fr ? "Prochain versement" : "Next payment")}
                  </label>
                  <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Taux d'activité (%)" : "Workload (%)"}</label>
                  <Input type="number" min="1" max="100" value={workload}
                    onChange={(e) => setWorkload(e.target.value)} placeholder="100" />
                </div>
              </div>

              <div className="space-y-2 border-t pt-4">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input accent-primary"
                    checked={ended}
                    onChange={(e) => {
                      setEnded(e.target.checked)
                      // Un emploi clos sans date de fin n'a pas de place
                      // dans la chronologie : on en propose une.
                      if (e.target.checked && !endedOn) setEndedOn(today())
                    }}
                  />
                  {fr ? "Cet emploi est déjà terminé" : "This job has already ended"}
                </label>
                {ended && (
                  <div className="space-y-2 pl-6">
                    <label className="text-sm font-medium">{fr ? "Date de fin" : "End date"}</label>
                    <Input type="date" value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />
                    <p className="text-xs text-muted-foreground">
                      {fr
                        ? "Le revenu est enregistré comme terminé : il ne compte plus dans « Ce mois », mais ses bulletins restent dans votre historique de cotisations."
                        : "The income is recorded as ended: it no longer counts in \"This month\", but its payslips stay in your contribution history."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------- Écran 4 · les cotisations ---------- */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Canton" : "Canton"}</label>
                  <select className={fieldCls} value={canton} onChange={(e) => setCanton(e.target.value)}>
                    <option value="">—</option>
                    {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground">{WORK_CANTON_HINT}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Date de naissance" : "Date of birth"}</label>
                  <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    {fr ? "Détermine la tranche de bonification LPP." : "Sets the LPP contribution bracket."}
                  </p>
                </div>
              </div>

              {/* Les taux légaux ne se saisissent pas : ils sont la loi, pas un
                  choix. Les montrer évite pourtant de laisser croire que
                  l'AVS a été oubliée, et ils viennent du calcul lui-même —
                  donc ce sont exactement ceux qui sont appliqués. */}
              <LegalRates
                params={netResult?.params ?? null}
                year={payYear}
                fr={fr}
                loading={netLoading}
                error={netError}
              />

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">
                    {fr ? "Les taux de votre entreprise" : "Your employer's rates"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fr
                      ? "Ceux-là dépendent de votre caisse de pension et de vos assurances : ils se lisent sur votre fiche de salaire. Laissez vide ce que vous ne savez pas — rien ne sera inventé."
                      : "These depend on your pension fund and insurers: read them off your payslip. Leave blank what you don't know — nothing will be invented."}
                  </p>
                </div>
                <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-3">
                  <RateField kind="lpp" value={lppPct} onChange={setLppPct} />
                  <RateField kind="laa" value={laaPct} onChange={setLaaPct} />
                  <RateField kind="ijm" value={ijmPct} onChange={setIjmPct} />
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="h-4 w-4 rounded border-input accent-primary"
                    checked={taxAtSource} onChange={(e) => setTaxAtSource(e.target.checked)} />
                  {fr ? "Je suis imposé à la source" : "I am taxed at source"}
                </label>
                {taxAtSource && (
                  <div className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{fr ? "Barème" : "Tariff code"}</label>
                      <Input value={taxScale} onChange={(e) => setTaxScale(e.target.value)} placeholder="A0N" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{fr ? "Taux effectif (%)" : "Effective rate (%)"}</label>
                      <Input type="number" min="0" max="100" step="0.01" value={taxRate}
                        onChange={(e) => setTaxRate(e.target.value)} placeholder="0.00" />
                      <p className="text-xs text-muted-foreground">
                        {fr
                          ? "Utilisé tant que le barème de votre canton n'est pas importé dans Paramètres → Barèmes."
                          : "Used until your canton's tariff is imported in Settings → Rates."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <GrossToNetSummary
                result={netResult}
                loading={netLoading}
                error={netError}
                currency="CHF"
              />
            </div>
          )}

          {step === 5 && createdId && (
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
          {step !== 1 && step !== 5 && (
            <Button
              variant="ghost"
              onClick={() => setStep(sequence[seqIndex - 1] ?? 1)}
              disabled={saving}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />{fr ? "Retour" : "Back"}
            </Button>
          )}
          {step === 5 && <span />}

          {step !== 5 && !isLastInput && (
            <Button onClick={() => setStep(sequence[seqIndex + 1] as Step)} disabled={!canLeaveStep}>
              {fr ? "Suivant" : "Next"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step !== 5 && isLastInput && (
            <Button onClick={create} disabled={saving || !canLeaveStep}>
              {/* Tant que le net n'est pas calculé, on ne sait pas quoi
                  enregistrer : le dire vaut mieux qu'un bouton grisé muet. */}
              {path === "salary" && grossMode && annualGrossValid && !salaryReady
                ? (fr ? "Calcul du net…" : "Computing net…")
                : (fr ? "Créer le revenu" : "Create income")}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 5 && (
            <Button onClick={onClose}><Check className="mr-1 h-4 w-4" />{fr ? "Terminer" : "Finish"}</Button>
          )}
        </div>
      </div>
    </div>
  )
}

/// Les retenues que la loi fixe, pour l'année et le canton choisis.
///
/// Elles ne se saisissent pas : ce sont des taux légaux, pas un choix. Les
/// afficher répond quand même à une inquiétude légitime — « et l'AVS, elle est
/// où ? » — et elles viennent du calcul lui-même, donc ce sont exactement
/// celles qui seront appliquées, pas une liste recopiée à côté.
function LegalRates({
  params,
  year,
  fr,
  loading,
  error,
}: {
  params: api.PayrollParams | null
  year: number
  fr: boolean
  loading: boolean
  error: string | null
}) {
  // Un calcul en échec n'est pas un brut manquant. Annoncer « dès que le
  // salaire brut sera saisi » à quelqu'un qui vient de le saisir l'envoie
  // chercher son erreur là où elle n'est pas.
  if (!params) {
    return (
      <div
        className={`rounded-lg border p-3 text-xs ${
          error
            ? "border-destructive/40 bg-destructive/5"
            : "border-dashed text-muted-foreground"
        }`}
      >
        {error
          ? (fr
              ? `Les retenues légales n'ont pas pu être chargées : ${error}`
              : `Statutory deductions could not be loaded: ${error}`)
          : loading
            ? (fr ? "Chargement des retenues légales…" : "Loading statutory deductions…")
            : (fr
                ? "Les retenues légales s'afficheront dès que le salaire brut sera saisi."
                : "Statutory deductions appear once the gross salary is entered.")}
      </div>
    )
  }

  const lines: Array<[string, string]> = [
    [fr ? "AVS / AI / APG" : "OASI / DI / EO", `${params.avs_ai_apg_employee_pct} %`],
    [
      fr ? "Assurance-chômage" : "Unemployment",
      `${params.ac_employee_pct} %${fr ? ` jusqu'à ${formatPrice(params.ac_ceiling, "CHF")}/an` : ` up to ${formatPrice(params.ac_ceiling, "CHF")}/yr`}`,
    ],
  ]
  if (params.ac_solidarity_employee_pct > 0) {
    lines.push([
      fr ? "Pour-cent de solidarité AC" : "Solidarity percent",
      `${params.ac_solidarity_employee_pct} %`,
    ])
  }
  if (params.cantonal.family_allowance_employee_pct > 0) {
    lines.push([
      fr ? "Allocations familiales (part salariée)" : "Family allowances (employee share)",
      `${params.cantonal.family_allowance_employee_pct} %`,
    ])
  }
  if (params.cantonal.maternity_employee_pct > 0) {
    lines.push([
      fr ? "Assurance maternité" : "Maternity insurance",
      `${params.cantonal.maternity_employee_pct} %`,
    ])
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">
          {fr ? `Les retenues légales ${year}` : `Statutory deductions, ${year}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {fr
            ? "Identiques pour tout le monde : rien à saisir. Elles changent au 1ᵉʳ janvier et se corrigent dans Paramètres → Barèmes."
            : "The same for everyone: nothing to enter. They change on 1 January and can be corrected in Settings → Rates."}
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {lines.map(([label, value]) => (
          <li key={label} className="flex items-baseline justify-between gap-3 px-3 py-2">
            <span className="text-sm">{label}</span>
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{value}</span>
          </li>
        ))}
      </ul>
      {params.estimated && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          {fr
            ? `Aucun barème publié pour ${year} : ceux de ${params.effective_year} sont appliqués en attendant.`
            : `No published rates for ${year}: those of ${params.effective_year} are used meanwhile.`}
        </p>
      )}
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

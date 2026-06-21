import { useContext, useState } from "react"
import { Car, ShieldCheck, ListChecks, FileText, Check, X, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { InlineCreateSelect } from "@/components/ui/inline-create-select"
import * as api from "@/lib/tauri"

/// Guided, step-by-step creation of a Swiss car-insurance position.
///
/// Swiss car insurance is built from a mandatory liability cover (RC) plus
/// optional partial/full casco, each with its own deductible (franchise), a
/// no-claims bonus level, and a set of à-la-carte extra coverages (parking
/// damage, bonus protection, passenger cover, legal protection, assistance…).
/// The assistant collects them step by step and stores the extra coverages as
/// a JSON slug array. It can optionally be linked to an existing leasing.

type Coverage = api.CarInsuranceCoverage

const COVERAGES: Coverage[] = ["rc", "partial_casco", "full_casco"]
const coverageLabel = (c: Coverage, fr: boolean): string =>
  c === "rc"           ? (fr ? "RC seule (obligatoire)" : "Liability only (mandatory)") :
  c === "partial_casco"? (fr ? "RC + casco partielle" : "Liability + partial casco") :
                         (fr ? "RC + casco complète" : "Liability + full casco")

const CAR_INSURANCE_OPTIONS = [
  { slug: "parking_damage", fr: "Dommages de parking", en: "Parking damage" },
  { slug: "bonus_protection", fr: "Protection du bonus", en: "Bonus protection" },
  { slug: "gross_negligence", fr: "Renonciation négligence grave", en: "Gross-negligence waiver" },
  { slug: "passengers", fr: "Assurance occupants / accident", en: "Passenger / accident cover" },
  { slug: "new_value", fr: "Casco neuf (valeur à neuf)", en: "New-value cover" },
  { slug: "replacement_vehicle", fr: "Véhicule de remplacement", en: "Replacement vehicle" },
  { slug: "legal_protection", fr: "Protection juridique circulation", en: "Traffic legal protection" },
  { slug: "assistance", fr: "Dépannage / assistance", en: "Breakdown assistance" },
  { slug: "personal_effects", fr: "Effets personnels", en: "Personal belongings" },
] as const

const PAY_METHODS: api.EngagementPaymentMethod[] = ["qr_bill", "direct_debit", "standing_order"]
const payMethodLabel = (m: api.EngagementPaymentMethod, fr: boolean): string =>
  m === "qr_bill"        ? (fr ? "QR-facture" : "QR-bill") :
  m === "direct_debit"   ? (fr ? "Prélèvement (LSV/SEPA)" : "Direct debit (LSV/SEPA)") :
                           (fr ? "Ordre permanent" : "Standing order")

function firstOfNextMonth(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

const numOrNull = (s: string): number | null => (s.trim() ? parseFloat(s) : null)

interface CarInsuranceWizardProps {
  creditors: api.Creditor[]
  cards: api.PaymentCard[]
  /// Existing engagements, used to optionally link the policy to a leasing.
  engagements: api.Engagement[]
  onClose: () => void
}

export function CarInsuranceWizard({ creditors, cards, engagements, onClose }: CarInsuranceWizardProps) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [saving, setSaving] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdName, setCreatedName] = useState("")

  const [creditorList, setCreditorList] = useState<api.Creditor[]>(creditors)
  const [cardList, setCardList] = useState<api.PaymentCard[]>(cards)

  async function createInsurer(name: string): Promise<api.Creditor | null> {
    try {
      const c = await api.createCreditor({ name, creditor_type: "insurer" })
      setCreditorList((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
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

  // Step 1 — insured vehicle + policy identity.
  const [name, setName] = useState(fr ? "Assurance voiture" : "Car insurance")
  const [make, setMake] = useState("")
  const [model, setModel] = useState("")
  const [plate, setPlate] = useState("")
  const [vin, setVin] = useState("")
  const [policyNo, setPolicyNo] = useState("")
  const [parentId, setParentId] = useState("")

  // Step 2 — coverage + financials.
  const [insurerId, setInsurerId] = useState("")
  const [cardId, setCardId] = useState("")
  const [coverage, setCoverage] = useState<Coverage>("full_casco")
  const [premium, setPremium] = useState("")
  const [cycle, setCycle] = useState<api.EngagementBillingCycle>("yearly")
  const [franchiseCasco, setFranchiseCasco] = useState("")
  const [franchisePartial, setFranchisePartial] = useState("")
  const [bonus, setBonus] = useState("")
  const [payMethod, setPayMethod] = useState<api.EngagementPaymentMethod>("qr_bill")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [noticeDays, setNoticeDays] = useState("90")
  const [nextDue, setNextDue] = useState(firstOfNextMonth())

  // Step 3 — extra coverages.
  const [options, setOptions] = useState<Record<string, boolean>>({})
  const toggleOption = (slug: string) => setOptions((p) => ({ ...p, [slug]: !p[slug] }))

  const leasings = engagements.filter((e) => e.engagement_type === "leasing")
  const premiumValue = parseFloat(premium)
  const step1Valid = name.trim().length > 0
  const step2Valid = !Number.isNaN(premiumValue) && premiumValue > 0

  const hasPartial = coverage === "partial_casco" || coverage === "full_casco"
  const hasFull = coverage === "full_casco"

  async function createPosition() {
    setSaving(true)
    try {
      const selected = CAR_INSURANCE_OPTIONS.filter((o) => options[o.slug]).map((o) => o.slug)
      const eng = await api.createEngagement({
        name: name.trim(),
        engagement_type: "insurance_car",
        parent_engagement_id: parentId || null,
        creditor_id: insurerId || null,
        payment_card_id: cardId || null,
        contract_reference: policyNo.trim() || null,
        contract_start_date: startDate || null,
        contract_end_date: endDate || null,
        notice_period_days: noticeDays.trim() ? parseInt(noticeDays, 10) : null,
        billing_cycle: cycle,
        cycle_interval: 1,
        next_due_date: nextDue || null,
        current_amount: premiumValue,
        currency: "CHF",
        payment_method: payMethod,
        auto_pay: payMethod === "direct_debit" || payMethod === "standing_order",
        status: "active",
        vehicle_make: make.trim() || null,
        vehicle_model: model.trim() || null,
        vehicle_plate: plate.trim() || null,
        vehicle_vin: vin.trim() || null,
        insurance_coverage: coverage,
        insurance_franchise_casco: hasFull ? numOrNull(franchiseCasco) : null,
        insurance_franchise_partial: hasPartial ? numOrNull(franchisePartial) : null,
        insurance_bonus_pct: numOrNull(bonus),
        insurance_options_json: selected.length > 0 ? JSON.stringify(selected) : null,
      })
      setCreatedId(eng.id)
      setCreatedName(eng.name)
      setStep(4)
      toast(fr ? "Assurance créée. Ajoutez la police." : "Insurance created. Add the policy.", "success")
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const stepTitle =
    step === 1 ? (fr ? "Le véhicule assuré" : "The insured vehicle") :
    step === 2 ? (fr ? "La couverture" : "Coverage") :
    step === 3 ? (fr ? "Couvertures complémentaires" : "Extra coverages") :
                 (fr ? "Documents" : "Documents")

  const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {step === 1 ? <Car className="h-5 w-5" /> : step === 2 ? <ShieldCheck className="h-5 w-5" /> :
               step === 3 ? <ListChecks className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fr ? "Nouvelle assurance voiture" : "New car insurance"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{fr ? "Étape" : "Step"} {step}/4 — {stepTitle}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={fr ? "Fermer" : "Close"}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Désignation" : "Label"} *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Marque" : "Make"}</label>
                <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder={fr ? "Ex : Volkswagen" : "e.g. Volkswagen"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Modèle" : "Model"}</label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={fr ? "Ex : Golf" : "e.g. Golf"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Plaque d'immatriculation" : "License plate"}</label>
                <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder={fr ? "Ex : VD 123456" : "e.g. VD 123456"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "N° de châssis (VIN)" : "Chassis no. (VIN)"}</label>
                <Input value={vin} onChange={(e) => setVin(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "N° de police" : "Policy number"}</label>
                <Input value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} />
              </div>
              {leasings.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Rattacher au leasing (optionnel)" : "Link to leasing (optional)"}</label>
                  <select className={fieldCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    <option value="">—</option>
                    {leasings.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Type de couverture" : "Coverage level"}</label>
                <select className={fieldCls} value={coverage} onChange={(e) => setCoverage(e.target.value as Coverage)}>
                  {COVERAGES.map((c) => <option key={c} value={c}>{coverageLabel(c, fr)}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prime (CHF)" : "Premium (CHF)"} *</label>
                <Input type="number" min="0" step="0.01" value={premium} onChange={(e) => setPremium(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Périodicité" : "Frequency"}</label>
                <select className={fieldCls} value={cycle} onChange={(e) => setCycle(e.target.value as api.EngagementBillingCycle)}>
                  <option value="yearly">{fr ? "Annuel" : "Yearly"}</option>
                  <option value="semiannual">{fr ? "Semestriel" : "Half-yearly"}</option>
                  <option value="quarterly">{fr ? "Trimestriel" : "Quarterly"}</option>
                  <option value="monthly">{fr ? "Mensuel" : "Monthly"}</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Compagnie d'assurance" : "Insurer"}</label>
                <InlineCreateSelect value={insurerId} onChange={setInsurerId} options={creditorList}
                  onCreate={createInsurer}
                  placeholder={fr ? "Nom (ex : AXA, Mobilière)" : "Name (e.g. AXA, Zurich)"}
                  createTitle={fr ? "Nouvel assureur" : "New insurer"} fr={fr} />
              </div>
              {hasFull && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Franchise casco complète (CHF)" : "Full-casco deductible (CHF)"}</label>
                  <Input type="number" min="0" step="0.01" value={franchiseCasco} onChange={(e) => setFranchiseCasco(e.target.value)} placeholder="1000" />
                </div>
              )}
              {hasPartial && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{fr ? "Franchise casco partielle (CHF)" : "Partial-casco deductible (CHF)"}</label>
                  <Input type="number" min="0" step="0.01" value={franchisePartial} onChange={(e) => setFranchisePartial(e.target.value)} placeholder="200" />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Degré de bonus (%)" : "Bonus level (%)"}</label>
                <Input type="number" min="0" step="1" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="45" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Compte / carte" : "Account / card"}</label>
                <InlineCreateSelect value={cardId} onChange={setCardId} options={cardList}
                  onCreate={createAccount}
                  placeholder={fr ? "Nom du compte / carte" : "Account / card name"}
                  createTitle={fr ? "Nouveau compte / carte" : "New account / card"} fr={fr} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Paiement" : "Payment"}</label>
                <select className={fieldCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value as api.EngagementPaymentMethod)}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{payMethodLabel(m, fr)}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prochaine échéance" : "Next due"}</label>
                <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Début du contrat" : "Contract start"}</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Échéance / fin de contrat" : "Renewal / contract end"}</label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Délai de résiliation (jours)" : "Notice period (days)"}</label>
                <Input type="number" min="0" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} placeholder="90" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {fr ? "Cochez les couvertures complémentaires incluses dans votre contrat." : "Tick the extra coverages included in your policy."}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {CAR_INSURANCE_OPTIONS.map((o) => (
                  <label key={o.slug} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/40">
                    <input type="checkbox" checked={!!options[o.slug]} onChange={() => toggleOption(o.slug)} />
                    <span className="text-sm font-medium">{fr ? o.fr : o.en}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 4 && createdId && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {fr
                  ? "Ajoutez la police d'assurance et les éventuelles factures."
                  : "Attach the insurance policy and any invoices."}
              </p>
              <AttachmentsPanel engagementId={createdId} itemDescription={createdName} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t p-4">
          {step === 1 && <Button variant="ghost" onClick={onClose} disabled={saving}>{fr ? "Annuler" : "Cancel"}</Button>}
          {(step === 2 || step === 3) && (
            <Button variant="ghost" onClick={() => setStep((step - 1) as 1 | 2 | 3)} disabled={saving}>
              <ChevronLeft className="mr-1 h-4 w-4" />{fr ? "Retour" : "Back"}
            </Button>
          )}
          {step === 4 && <span />}

          {step === 1 && (
            <Button onClick={() => setStep(2)} disabled={!step1Valid}>
              {fr ? "Suivant" : "Next"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!step2Valid}>
              {fr ? "Suivant" : "Next"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={createPosition} disabled={saving}>
              {fr ? "Créer" : "Create"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 4 && (
            <Button onClick={onClose}><Check className="mr-1 h-4 w-4" />{fr ? "Terminer" : "Finish"}</Button>
          )}
        </div>
      </div>
    </div>
  )
}

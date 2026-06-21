import { useContext, useState } from "react"
import { Car, FileText, Check, X, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { InlineCreateSelect } from "@/components/ui/inline-create-select"
import * as api from "@/lib/tauri"

/// Guided, step-by-step creation of a Swiss car-leasing position.
///
/// Car leasing in Switzerland is driven by a handful of structured terms
/// (vehicle identity + financial terms: down payment ~10-20%, residual value
/// ~20-40%, effective rate (TAEG) ~3.5-5.5%, included annual mileage and the
/// cost of each extra km). The assistant collects them one step at a time,
/// computes the contract end date from start + duration, and reminds the user
/// that full comprehensive insurance (casco complète) is mandatory.
///
/// Like the rent assistant, the records are created on entering the final
/// "documents" step (we need the new engagement id to attach files), so Back
/// is hidden there.

const PAY_METHODS: api.EngagementPaymentMethod[] = ["direct_debit", "standing_order", "qr_bill"]

const payMethodLabel = (m: api.EngagementPaymentMethod, fr: boolean): string =>
  m === "direct_debit"   ? (fr ? "Prélèvement (LSV/SEPA)" : "Direct debit (LSV/SEPA)") :
  m === "standing_order" ? (fr ? "Ordre permanent" : "Standing order") :
                           (fr ? "QR-facture" : "QR-bill")

function firstOfNextMonth(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

/// start date + N months, as YYYY-MM-DD. Used to derive the contract end.
function addMonths(iso: string, months: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  d.setMonth(d.getMonth() + months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const numOrNull = (s: string): number | null => (s.trim() ? parseFloat(s) : null)
const intOrNull = (s: string): number | null => (s.trim() ? parseInt(s, 10) : null)

interface LeasingWizardProps {
  creditors: api.Creditor[]
  cards: api.PaymentCard[]
  onClose: () => void
}

export function LeasingWizard({ creditors, cards, onClose }: LeasingWizardProps) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdName, setCreatedName] = useState("")

  const [creditorList, setCreditorList] = useState<api.Creditor[]>(creditors)
  const [cardList, setCardList] = useState<api.PaymentCard[]>(cards)

  async function createLeasingCompany(name: string): Promise<api.Creditor | null> {
    try {
      const c = await api.createCreditor({ name, creditor_type: "leasing_company" })
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

  // Step 1 — vehicle identity.
  const [name, setName] = useState(fr ? "Leasing voiture" : "Car leasing")
  const [make, setMake] = useState("")
  const [model, setModel] = useState("")
  const [plate, setPlate] = useState("")
  const [vin, setVin] = useState("")
  const [firstReg, setFirstReg] = useState("")

  // Step 2 — leasing contract.
  const [creditorId, setCreditorId] = useState("")
  const [cardId, setCardId] = useState("")
  const [contractRef, setContractRef] = useState("")
  const [monthly, setMonthly] = useState("")
  const [nextDue, setNextDue] = useState(firstOfNextMonth())
  const [startDate, setStartDate] = useState("")
  const [duration, setDuration] = useState("48")
  const [vehiclePrice, setVehiclePrice] = useState("")
  const [downPayment, setDownPayment] = useState("")
  const [discount, setDiscount] = useState("")
  const [residual, setResidual] = useState("")
  const [rate, setRate] = useState("")
  const [annualKm, setAnnualKm] = useState("")
  const [excessKm, setExcessKm] = useState("")
  const [payMethod, setPayMethod] = useState<api.EngagementPaymentMethod>("direct_debit")

  const monthlyValue = parseFloat(monthly)
  const step1Valid = name.trim().length > 0
  const step2Valid = !Number.isNaN(monthlyValue) && monthlyValue > 0

  // Net up-front payment once an accepted offer/discount (e.g. a Tesla rebate)
  // is deducted from the gross down payment.
  const dpNum = parseFloat(downPayment)
  const discNum = parseFloat(discount)
  const netDownPayment = !Number.isNaN(dpNum) && !Number.isNaN(discNum) ? dpNum - discNum : null

  async function createPosition() {
    setSaving(true)
    try {
      const dur = intOrNull(duration)
      const endDate = startDate && dur ? addMonths(startDate, dur) : null
      const eng = await api.createEngagement({
        name: name.trim(),
        engagement_type: "leasing",
        creditor_id: creditorId || null,
        payment_card_id: cardId || null,
        contract_reference: contractRef.trim() || null,
        contract_start_date: startDate || null,
        contract_end_date: endDate,
        billing_cycle: "monthly",
        cycle_interval: 1,
        next_due_date: nextDue || null,
        current_amount: monthlyValue,
        currency: "CHF",
        payment_method: payMethod,
        auto_pay: payMethod === "direct_debit" || payMethod === "standing_order",
        status: "active",
        vehicle_make: make.trim() || null,
        vehicle_model: model.trim() || null,
        vehicle_plate: plate.trim() || null,
        vehicle_vin: vin.trim() || null,
        vehicle_first_registration: firstReg || null,
        leasing_vehicle_price: numOrNull(vehiclePrice),
        leasing_duration_months: dur,
        leasing_down_payment: numOrNull(downPayment),
        leasing_residual_value: numOrNull(residual),
        leasing_interest_rate_pct: numOrNull(rate),
        leasing_annual_mileage_km: intOrNull(annualKm),
        leasing_excess_km_cost: numOrNull(excessKm),
        leasing_discount: numOrNull(discount),
      })
      setCreatedId(eng.id)
      setCreatedName(eng.name)
      setStep(3)
      toast(fr ? "Leasing créé. Ajoutez maintenant vos documents." : "Leasing created. Now add your documents.", "success")
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const stepTitle =
    step === 1 ? (fr ? "Le véhicule" : "The vehicle") :
    step === 2 ? (fr ? "Le contrat de leasing" : "The leasing contract") :
                 (fr ? "Documents" : "Documents")

  const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        {/* Header + stepper */}
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {step === 3 ? <FileText className="h-5 w-5" /> : <Car className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fr ? "Nouveau leasing" : "New leasing"}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {fr ? "Étape" : "Step"} {step}/3 — {stepTitle}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={fr ? "Fermer" : "Close"}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Désignation" : "Label"} *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                  placeholder={fr ? "Ex : Leasing VW Golf" : "e.g. VW Golf leasing"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Marque" : "Make"}</label>
                <Input value={make} onChange={(e) => setMake(e.target.value)} placeholder={fr ? "Ex : Volkswagen" : "e.g. Volkswagen"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Modèle" : "Model"}</label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={fr ? "Ex : Golf 1.5 TSI" : "e.g. Golf 1.5 TSI"} />
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
                <label className="text-sm font-medium">{fr ? "Première mise en circulation" : "First registration"}</label>
                <Input type="date" value={firstReg} onChange={(e) => setFirstReg(e.target.value)} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Mensualité (CHF)" : "Monthly payment (CHF)"} *</label>
                <Input type="number" min="0" step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prochaine échéance" : "Next due"}</label>
                <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Société de leasing" : "Leasing company"}</label>
                <InlineCreateSelect value={creditorId} onChange={setCreditorId} options={creditorList}
                  onCreate={createLeasingCompany}
                  placeholder={fr ? "Nom (ex : AMAG Leasing)" : "Name (e.g. AMAG Leasing)"}
                  createTitle={fr ? "Nouvelle société de leasing" : "New leasing company"} fr={fr} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Compte / carte" : "Account / card"}</label>
                <InlineCreateSelect value={cardId} onChange={setCardId} options={cardList}
                  onCreate={createAccount}
                  placeholder={fr ? "Nom du compte / carte" : "Account / card name"}
                  createTitle={fr ? "Nouveau compte / carte" : "New account / card"} fr={fr} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Référence du contrat" : "Contract reference"}</label>
                <Input value={contractRef} onChange={(e) => setContractRef(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Paiement" : "Payment"}</label>
                <select className={fieldCls} value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as api.EngagementPaymentMethod)}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{payMethodLabel(m, fr)}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Début du contrat" : "Contract start"}</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Durée (mois)" : "Duration (months)"}</label>
                <Input type="number" min="1" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="48" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prix du véhicule (CHF)" : "Vehicle price (CHF)"}</label>
                <Input type="number" min="0" step="0.01" value={vehiclePrice} onChange={(e) => setVehiclePrice(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Acompte / 1er loyer (CHF)" : "Down payment (CHF)"}</label>
                <Input type="number" min="0" step="0.01" value={downPayment} onChange={(e) => setDownPayment(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Remise / offre acceptée (CHF)" : "Discount / accepted offer (CHF)"}</label>
                <Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)}
                  placeholder={fr ? "Ex : offre Tesla" : "e.g. Tesla offer"} />
                {netDownPayment !== null && (
                  <p className="text-xs text-muted-foreground">
                    {fr ? "Acompte net : " : "Net down payment: "}
                    <span className="font-medium">{netDownPayment.toLocaleString("fr-CH", { style: "currency", currency: "CHF" })}</span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Valeur résiduelle (CHF)" : "Residual value (CHF)"}</label>
                <Input type="number" min="0" step="0.01" value={residual} onChange={(e) => setResidual(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Taux d'intérêt TAEG (%)" : "Effective rate APR (%)"}</label>
                <Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="4.5" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Km/an inclus" : "Included km/year"}</label>
                <Input type="number" min="0" value={annualKm} onChange={(e) => setAnnualKm(e.target.value)} placeholder="15000" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prix du km supplémentaire (CHF)" : "Extra km cost (CHF)"}</label>
                <Input type="number" min="0" step="0.01" value={excessKm} onChange={(e) => setExcessKm(e.target.value)} placeholder="0.25" />
              </div>
            </div>
          )}

          {step === 3 && createdId && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {fr
                    ? "Rappel : l'assurance casco complète est obligatoire pendant toute la durée du leasing. Vous pourrez la créer comme « assurance véhicule » séparée."
                    : "Reminder: full comprehensive insurance (casco) is mandatory for the whole leasing term. You can add it as a separate “vehicle insurance”."}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {fr
                  ? "Ajoutez le contrat de leasing et les éventuelles factures. Vous pourrez en ajouter d'autres plus tard depuis la fiche."
                  : "Attach the leasing contract and any invoices. You can add more later from the engagement page."}
              </p>
              <AttachmentsPanel engagementId={createdId} itemDescription={createdName} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t p-4">
          {step === 1 && <Button variant="ghost" onClick={onClose} disabled={saving}>{fr ? "Annuler" : "Cancel"}</Button>}
          {step === 2 && (
            <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>
              <ChevronLeft className="mr-1 h-4 w-4" />{fr ? "Retour" : "Back"}
            </Button>
          )}
          {step === 3 && <span />}

          {step === 1 && (
            <Button onClick={() => setStep(2)} disabled={!step1Valid}>
              {fr ? "Suivant" : "Next"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={createPosition} disabled={saving || !step2Valid}>
              {fr ? "Créer" : "Create"}<ChevronRight className="ml-1 h-4 w-4" />
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

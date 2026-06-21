import { useContext, useState } from "react"
import { Home, Car, FileText, X, ChevronLeft, ChevronRight, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { InlineCreateSelect } from "@/components/ui/inline-create-select"
import * as api from "@/lib/tauri"

/// Guided, step-by-step creation of a Swiss tenant's housing position.
///
/// A "rent position" is more than one engagement: the apartment lease, an
/// optional parking spot (its own monthly rent, modelled as a CHILD engagement
/// of the apartment), and the documents (lease contract + invoices). Rather
/// than dropping the user on the generic engagement form with 15 fields, the
/// assistant asks for exactly what a lease needs, one step at a time, and wires
/// the parent/child relationship automatically.
///
/// Creation happens on the transition into the final "documents" step (we need
/// the freshly-created engagement id to attach files), so the Back button is
/// hidden there — the records already exist.

const PARKING_KINDS: api.ParkingKind[] = ["outdoor", "collective_garage", "box"]

const parkingKindLabel = (k: api.ParkingKind, fr: boolean): string =>
  k === "outdoor"           ? (fr ? "Extérieure" : "Outdoor") :
  k === "collective_garage" ? (fr ? "Garage collectif" : "Collective garage") :
                              (fr ? "Box / garage individuel" : "Box / individual garage")

// Most Swiss leases are paid monthly by standing order; default to that but let
// the user switch to LSV (direct debit) or QR-bill.
const PAY_METHODS: api.EngagementPaymentMethod[] = ["standing_order", "direct_debit", "qr_bill"]

const payMethodLabel = (m: api.EngagementPaymentMethod, fr: boolean): string =>
  m === "standing_order" ? (fr ? "Ordre permanent" : "Standing order") :
  m === "direct_debit"   ? (fr ? "Prélèvement (LSV/SEPA)" : "Direct debit (LSV/SEPA)") :
                           (fr ? "QR-facture" : "QR-bill")

/// First day of next month as YYYY-MM-DD — a clean "next due" anchor.
function firstOfNextMonth(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

interface RentWizardProps {
  creditors: api.Creditor[]
  cards: api.PaymentCard[]
  /// Called once the user finishes (or closes after creating). The parent
  /// should reload its engagement list and hide the wizard.
  onClose: () => void
}

export function RentWizard({ creditors, cards, onClose }: RentWizardProps) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [createdRentId, setCreatedRentId] = useState<string | null>(null)
  const [createdRentName, setCreatedRentName] = useState("")

  // Local copies so an entity created inline shows up immediately in its select.
  const [creditorList, setCreditorList] = useState<api.Creditor[]>(creditors)
  const [cardList, setCardList] = useState<api.PaymentCard[]>(cards)

  // Inline-create a landlord (creditor) from just a name; surface errors here.
  async function createLandlord(name: string): Promise<api.Creditor | null> {
    try {
      const c = await api.createCreditor({ name, creditor_type: "landlord" })
      setCreditorList((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      return c
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
      return null
    }
  }

  // Inline-create a payment account/card from just a name.
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

  // Step 1 — apartment lease.
  const [name, setName] = useState(fr ? "Loyer appartement" : "Apartment rent")
  const [creditorId, setCreditorId] = useState("")
  const [cardId, setCardId] = useState("")
  const [contractRef, setContractRef] = useState("")
  const [rent, setRent] = useState("")
  const [startDate, setStartDate] = useState("")
  const [nextDue, setNextDue] = useState(firstOfNextMonth())
  const [payMethod, setPayMethod] = useState<api.EngagementPaymentMethod>("standing_order")

  // Step 2 — optional parking spot.
  const [hasParking, setHasParking] = useState(false)
  const [parkingKind, setParkingKind] = useState<api.ParkingKind>("outdoor")
  const [parkingSpot, setParkingSpot] = useState("")
  const [parkingRent, setParkingRent] = useState("")

  const rentValue = parseFloat(rent)
  const rentValid = name.trim().length > 0 && !Number.isNaN(rentValue) && rentValue > 0
  const parkingValue = parseFloat(parkingRent)
  const parkingValid = !hasParking || (!Number.isNaN(parkingValue) && parkingValue > 0)

  const autoPay = payMethod === "standing_order" || payMethod === "direct_debit"

  async function createPosition() {
    setSaving(true)
    try {
      const rentEng = await api.createEngagement({
        name: name.trim(),
        engagement_type: "rent",
        creditor_id: creditorId || null,
        payment_card_id: cardId || null,
        contract_reference: contractRef.trim() || null,
        contract_start_date: startDate || null,
        billing_cycle: "monthly",
        cycle_interval: 1,
        next_due_date: nextDue || null,
        current_amount: rentValue,
        currency: "CHF",
        payment_method: payMethod,
        auto_pay: autoPay,
        status: "active",
      })

      if (hasParking) {
        const spotSuffix = parkingSpot.trim() ? ` n°${parkingSpot.trim()}` : ""
        await api.createEngagement({
          name: (fr ? "Place de parc" : "Parking spot") + spotSuffix,
          engagement_type: "parking",
          parent_engagement_id: rentEng.id,
          creditor_id: creditorId || null,
          payment_card_id: cardId || null,
          billing_cycle: "monthly",
          cycle_interval: 1,
          next_due_date: nextDue || null,
          current_amount: parkingValue,
          currency: "CHF",
          payment_method: payMethod,
          auto_pay: autoPay,
          status: "active",
          parking_spot_number: parkingSpot.trim() || null,
          parking_kind: parkingKind,
        })
      }

      setCreatedRentId(rentEng.id)
      setCreatedRentName(rentEng.name)
      setStep(3)
      toast(
        fr ? "Logement créé. Ajoutez maintenant vos documents." : "Housing created. Now add your documents.",
        "success",
      )
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  const stepTitle =
    step === 1 ? (fr ? "Le logement" : "The home") :
    step === 2 ? (fr ? "Place de parc" : "Parking spot") :
                 (fr ? "Documents" : "Documents")

  const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        {/* Header + stepper */}
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {step === 1 ? <Home className="h-5 w-5" /> : step === 2 ? <Car className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fr ? "Nouveau loyer" : "New rent"}</h2>
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
                  placeholder={fr ? "Ex : Loyer Rue de Lausanne 12" : "e.g. Rent, 12 Main Street"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Loyer mensuel (CHF)" : "Monthly rent (CHF)"} *</label>
                <Input type="number" min="0" step="0.01" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prochaine échéance" : "Next due"}</label>
                <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Bailleur / régie" : "Landlord / agency"}</label>
                <InlineCreateSelect
                  value={creditorId}
                  onChange={setCreditorId}
                  options={creditorList}
                  onCreate={createLandlord}
                  placeholder={fr ? "Nom du bailleur" : "Landlord name"}
                  createTitle={fr ? "Nouveau bailleur" : "New landlord"}
                  fr={fr}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Compte / carte" : "Account / card"}</label>
                <InlineCreateSelect
                  value={cardId}
                  onChange={setCardId}
                  options={cardList}
                  onCreate={createAccount}
                  placeholder={fr ? "Nom du compte / carte" : "Account / card name"}
                  createTitle={fr ? "Nouveau compte / carte" : "New account / card"}
                  fr={fr}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Référence du bail" : "Lease reference"}</label>
                <Input value={contractRef} onChange={(e) => setContractRef(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Début du bail" : "Lease start"}</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Paiement" : "Payment"}</label>
                <select className={fieldCls} value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as api.EngagementPaymentMethod)}>
                  {PAY_METHODS.map((m) => <option key={m} value={m}>{payMethodLabel(m, fr)}</option>)}
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <label className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/40">
                <input type="checkbox" checked={hasParking} onChange={(e) => setHasParking(e.target.checked)} />
                <span className="text-sm font-medium">
                  {fr ? "Ce logement a une place de parc (loyer en plus)" : "This home has a parking spot (extra rent)"}
                </span>
              </label>

              {hasParking ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Type de place" : "Spot type"}</label>
                    <select className={fieldCls} value={parkingKind}
                      onChange={(e) => setParkingKind(e.target.value as api.ParkingKind)}>
                      {PARKING_KINDS.map((k) => <option key={k} value={k}>{parkingKindLabel(k, fr)}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Numéro de place" : "Spot number"}</label>
                    <Input value={parkingSpot} onChange={(e) => setParkingSpot(e.target.value)} placeholder={fr ? "Ex : 42" : "e.g. 42"} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Loyer mensuel de la place (CHF)" : "Monthly parking rent (CHF)"} *</label>
                    <Input type="number" min="0" step="0.01" value={parkingRent}
                      onChange={(e) => setParkingRent(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {fr
                    ? "Pas de place de parc ? Passez simplement à l'étape suivante."
                    : "No parking spot? Just continue to the next step."}
                </p>
              )}
            </div>
          )}

          {step === 3 && createdRentId && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {fr
                  ? "Ajoutez le contrat de bail et les éventuelles factures. Vous pourrez en ajouter d'autres plus tard depuis la fiche du logement."
                  : "Attach the lease contract and any invoices. You can add more later from the home's page."}
              </p>
              <AttachmentsPanel engagementId={createdRentId} itemDescription={createdRentName} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t p-4">
          {step === 1 && (
            <Button variant="ghost" onClick={onClose} disabled={saving}>{fr ? "Annuler" : "Cancel"}</Button>
          )}
          {step === 2 && (
            <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>
              <ChevronLeft className="mr-1 h-4 w-4" />{fr ? "Retour" : "Back"}
            </Button>
          )}
          {step === 3 && <span />}

          {step === 1 && (
            <Button onClick={() => setStep(2)} disabled={!rentValid}>
              {fr ? "Suivant" : "Next"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 2 && (
            <Button onClick={createPosition} disabled={saving || !parkingValid}>
              {fr ? "Créer" : "Create"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={onClose}>
              <Check className="mr-1 h-4 w-4" />{fr ? "Terminer" : "Finish"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

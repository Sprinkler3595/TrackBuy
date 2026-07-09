import { useContext, useRef, useState } from "react"
import { Car, ShieldCheck, ListChecks, FileText, Check, X, ChevronLeft, ChevronRight, Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { InlineCreateSelect } from "@/components/ui/inline-create-select"
import { getAiSettings } from "@/lib/ai-settings"
import { documentToText } from "@/lib/document-scan"
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

const VEHICLE_CATEGORIES: { slug: api.VehicleCategory; fr: string; en: string }[] = [
  { slug: "passenger_car", fr: "Voiture de tourisme", en: "Passenger car" },
  { slug: "motorcycle", fr: "Motocycle", en: "Motorcycle" },
  { slug: "light_commercial", fr: "Véhicule utilitaire léger", en: "Light commercial vehicle" },
  { slug: "motorhome", fr: "Camping-car", en: "Motorhome" },
  { slug: "other", fr: "Autre", en: "Other" },
]

// Extra coverages, aligned with a real Swiss offer (TCS/Baloise) plus the
// common à-la-carte options.
const CAR_INSURANCE_OPTIONS = [
  { slug: "parking_damage", fr: "Dommage de stationnement", en: "Parking damage" },
  { slug: "assistance_systems", fr: "Feux & systèmes d'assistance", en: "Lights & assistance systems" },
  { slug: "interior", fr: "Habitacle", en: "Interior" },
  { slug: "replacement_vehicle", fr: "Véhicule de remplacement / location", en: "Replacement vehicle" },
  { slug: "personal_effects", fr: "Effets personnels emportés", en: "Personal belongings" },
  { slug: "ev_battery", fr: "Électrique (batterie / Electra)", en: "Electric (battery / Electra)" },
  { slug: "security_module", fr: "Module de sécurité", en: "Security module" },
  { slug: "passengers", fr: "Accident occupants", en: "Passenger accident cover" },
  { slug: "bonus_protection", fr: "Protection du bonus", en: "Bonus protection" },
  { slug: "new_value", fr: "Valeur vénale majorée (casco neuf)", en: "Enhanced market value (new-value)" },
  { slug: "gross_negligence", fr: "Renonciation négligence grave", en: "Gross-negligence waiver" },
  { slug: "legal_protection", fr: "Protection juridique circulation", en: "Traffic legal protection" },
  { slug: "assistance", fr: "Dépannage / assistance", en: "Breakdown assistance" },
] as const

// Per-coverage premium lines mirroring the offer's "Détails sur les prestations
// et primes". Each maps to a key in insurance_premium_breakdown_json.
const PREMIUM_LINES = [
  { key: "rc", fr: "RC", en: "Liability" },
  { key: "collision", fr: "Casco collision", en: "Collision casco" },
  { key: "partial", fr: "Casco partielle", en: "Partial casco" },
  { key: "extras", fr: "Couvertures complémentaires", en: "Extra coverages" },
  { key: "passengers", fr: "Accident occupants", en: "Passenger accident" },
  { key: "taxes", fr: "Taxes (timbre, contributions)", en: "Taxes (stamp, contributions)" },
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
  const [vehicleCategory, setVehicleCategory] = useState<api.VehicleCategory>("passenger_car")
  const [regNumber, setRegNumber] = useState("")
  const [isLeasing, setIsLeasing] = useState(false)

  // Step 2 — coverage + financials.
  const [insurerId, setInsurerId] = useState("")
  const [cardId, setCardId] = useState("")
  const [coverage, setCoverage] = useState<Coverage>("full_casco")
  const [premium, setPremium] = useState("")
  const [cycle, setCycle] = useState<api.EngagementBillingCycle>("yearly")
  const [franchiseCasco, setFranchiseCasco] = useState("")
  const [franchisePartial, setFranchisePartial] = useState("")
  const [youngDriverFranchise, setYoungDriverFranchise] = useState("")
  const [bonus, setBonus] = useState("")
  const [payMethod, setPayMethod] = useState<api.EngagementPaymentMethod>("qr_bill")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [noticeDays, setNoticeDays] = useState("90")
  const [nextDue, setNextDue] = useState(firstOfNextMonth())

  // Optional per-coverage premium breakdown (mirrors the offer). Keyed by
  // PREMIUM_LINES.key, values as raw strings.
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [breakdown, setBreakdown] = useState<Record<string, string>>({})
  const breakdownTotal = PREMIUM_LINES.reduce((sum, l) => {
    const v = parseFloat(breakdown[l.key] ?? "")
    return Number.isNaN(v) ? sum : sum + v
  }, 0)

  // Step 3 — extra coverages.
  const [options, setOptions] = useState<Record<string, boolean>>({})
  const toggleOption = (slug: string) => setOptions((p) => ({ ...p, [slug]: !p[slug] }))

  // Scan + IA — auto-fill the whole wizard from a policy/contract document.
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const leasings = engagements.filter((e) => e.engagement_type === "leasing")

  /// Pre-fill every field the AI could read off the contract. Values stay
  /// editable — the assistant is a head start, not a lock-in. Only sets a field
  /// when the model returned a value, so a partial extraction never wipes a
  /// value the user already typed.
  async function applyExtraction(x: api.ExtractedCarInsurance) {
    const filled: string[] = []
    if (x.name) { setName(x.name); filled.push(fr ? "désignation" : "label") }
    if (x.vehicle_make) { setMake(x.vehicle_make); filled.push(fr ? "marque" : "make") }
    if (x.vehicle_model) { setModel(x.vehicle_model); filled.push(fr ? "modèle" : "model") }
    if (x.vehicle_plate) { setPlate(x.vehicle_plate); filled.push(fr ? "plaque" : "plate") }
    if (x.vehicle_vin) { setVin(x.vehicle_vin); filled.push("VIN") }
    if (x.vehicle_registration_number) { setRegNumber(x.vehicle_registration_number); filled.push(fr ? "matricule" : "reg. no.") }
    if (x.vehicle_category) { setVehicleCategory(x.vehicle_category); filled.push(fr ? "genre" : "category") }
    if (x.policy_number) { setPolicyNo(x.policy_number); filled.push(fr ? "n° police" : "policy no.") }
    if (x.coverage) { setCoverage(x.coverage); filled.push(fr ? "couverture" : "coverage") }
    if (x.premium != null) { setPremium(String(x.premium)); filled.push(fr ? "prime" : "premium") }
    if (x.billing_cycle) { setCycle(x.billing_cycle); filled.push(fr ? "périodicité" : "frequency") }
    if (x.franchise_casco != null) { setFranchiseCasco(String(x.franchise_casco)); filled.push(fr ? "franchise casco" : "casco deductible") }
    if (x.franchise_partial != null) { setFranchisePartial(String(x.franchise_partial)); filled.push(fr ? "franchise partielle" : "partial deductible") }
    if (x.young_driver_franchise != null) { setYoungDriverFranchise(String(x.young_driver_franchise)); filled.push(fr ? "franchise jeune" : "young-driver deductible") }
    if (x.bonus_pct != null) { setBonus(String(x.bonus_pct)); filled.push(fr ? "bonus" : "bonus") }
    if (x.contract_start_date) { setStartDate(x.contract_start_date); filled.push(fr ? "début" : "start") }
    if (x.contract_end_date) { setEndDate(x.contract_end_date); filled.push(fr ? "échéance" : "end") }
    if (x.next_due_date) { setNextDue(x.next_due_date); filled.push(fr ? "prochaine échéance" : "next due") }
    if (x.notice_period_days != null) { setNoticeDays(String(x.notice_period_days)); filled.push(fr ? "délai résiliation" : "notice") }
    if (x.payment_method) { setPayMethod(x.payment_method); filled.push(fr ? "paiement" : "payment") }
    if (x.options.length > 0) {
      const rec: Record<string, boolean> = {}
      for (const slug of x.options) rec[slug] = true
      setOptions(rec)
      filled.push(fr ? `${x.options.length} option(s)` : `${x.options.length} option(s)`)
    }
    if (x.premium_breakdown && Object.keys(x.premium_breakdown).length > 0) {
      const b: Record<string, string> = {}
      for (const [k, v] of Object.entries(x.premium_breakdown)) b[k] = String(v)
      setBreakdown(b)
      setShowBreakdown(true)
      filled.push(fr ? "détail des primes" : "premium breakdown")
    }
    // Insurer: match an existing creditor by name, else create it so the
    // policy is linked to a real insurer straight away.
    if (x.insurer_name) {
      const needle = x.insurer_name.trim().toLowerCase()
      const existing = creditorList.find((c) => c.name.trim().toLowerCase() === needle)
      if (existing) { setInsurerId(existing.id); filled.push(fr ? "assureur" : "insurer") }
      else {
        const created = await createInsurer(x.insurer_name.trim())
        if (created) { setInsurerId(created.id); filled.push(fr ? "assureur (créé)" : "insurer (created)") }
      }
    }
    setScanned(filled.length > 0 ? filled.join(" · ") : null)
    return filled.length
  }

  /// Read the picked contract (PDF text layer or OCR), run the AI extraction,
  /// then pre-fill the form. A plain <input type=file> is used so this works
  /// identically in the Tauri webview and in browser/dev mode (we only need the
  /// bytes here — attachments are added later at step 4).
  async function handleScanFile(file: File) {
    const ai = getAiSettings()
    if (!ai.enabled) {
      toast(fr
        ? "Activez l'IA dans Réglages → IA pour le remplissage automatique."
        : "Enable AI in Settings → AI to use auto-fill.", "error")
      return
    }
    setScanning(true)
    setScanned(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const text = await documentToText(bytes, file.type, file.name)
      if (!text.trim()) {
        toast(fr
          ? "Impossible de lire le document (texte introuvable). Pour une image, installez l'OCR (npm run fetch-tessdata)."
          : "Couldn't read the document (no text found). For an image, install OCR (npm run fetch-tessdata).", "error")
        return
      }
      const extracted = await api.aiExtractCarInsurance(text, ai)
      const count = await applyExtraction(extracted)
      if (count > 0) {
        toast(fr
          ? "Champs pré-remplis depuis le contrat — vérifiez puis complétez."
          : "Fields pre-filled from the contract — review and complete.", "success")
      } else {
        toast(fr
          ? "Aucun champ exploitable trouvé dans ce document."
          : "No usable field found in this document.", "error")
      }
    } catch (e) {
      toast(`${fr ? "Échec du scan" : "Scan failed"}: ${e}`, "error")
    } finally {
      setScanning(false)
    }
  }

  // "Véhicule en leasing": pre-select the (only/most recent) leasing to link to.
  function toggleLeasing(checked: boolean) {
    setIsLeasing(checked)
    if (checked && !parentId && leasings.length > 0) setParentId(leasings[0].id)
    if (!checked) setParentId("")
  }

  const premiumValue = parseFloat(premium)
  const step1Valid = name.trim().length > 0
  const step2Valid = !Number.isNaN(premiumValue) && premiumValue > 0

  const hasPartial = coverage === "partial_casco" || coverage === "full_casco"
  const hasFull = coverage === "full_casco"

  async function createPosition() {
    setSaving(true)
    try {
      const selected = CAR_INSURANCE_OPTIONS.filter((o) => options[o.slug]).map((o) => o.slug)
      // Keep only the filled breakdown lines, as numbers.
      const breakdownObj: Record<string, number> = {}
      for (const l of PREMIUM_LINES) {
        const v = parseFloat(breakdown[l.key] ?? "")
        if (!Number.isNaN(v)) breakdownObj[l.key] = v
      }
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
        vehicle_category: vehicleCategory,
        vehicle_registration_number: regNumber.trim() || null,
        vehicle_is_leasing: isLeasing,
        insurance_coverage: coverage,
        insurance_franchise_casco: hasFull ? numOrNull(franchiseCasco) : null,
        insurance_franchise_partial: hasPartial ? numOrNull(franchisePartial) : null,
        insurance_young_driver_franchise: numOrNull(youngDriverFranchise),
        insurance_bonus_pct: numOrNull(bonus),
        insurance_options_json: selected.length > 0 ? JSON.stringify(selected) : null,
        insurance_premium_breakdown_json: Object.keys(breakdownObj).length > 0 ? JSON.stringify(breakdownObj) : null,
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
              {/* Scan + IA — auto-fill from the policy/contract. Manual entry
                  below stays fully available. */}
              <div className="sm:col-span-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void handleScanFile(f)
                    e.target.value = ""
                  }}
                />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {fr ? "Remplissage automatique (scan + IA)" : "Auto-fill (scan + AI)"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fr
                          ? "Scannez votre police / contrat (PDF ou photo) : l'IA remplit les champs. Vous pouvez aussi tout saisir à la main ci-dessous."
                          : "Scan your policy / contract (PDF or photo): the AI fills in the fields. You can also enter everything manually below."}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={scanning || saving}
                    className="shrink-0"
                  >
                    {scanning
                      ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />{fr ? "Analyse…" : "Analyzing…"}</>
                      : <><Sparkles className="mr-1 h-4 w-4" />{fr ? "Scanner le contrat" : "Scan the contract"}</>}
                  </Button>
                </div>
                {scanned && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                    <Check className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      {fr ? "Pré-rempli : " : "Pre-filled: "}{scanned}
                    </span>
                  </div>
                )}
              </div>

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
                <label className="text-sm font-medium">{fr ? "Genre de véhicule" : "Vehicle category"}</label>
                <select className={fieldCls} value={vehicleCategory}
                  onChange={(e) => setVehicleCategory(e.target.value as api.VehicleCategory)}>
                  {VEHICLE_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{fr ? c.fr : c.en}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Plaque d'immatriculation" : "License plate"}</label>
                <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder={fr ? "Ex : VD 123456" : "e.g. VD 123456"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "N° de matricule" : "Registration no."}</label>
                <Input value={regNumber} onChange={(e) => setRegNumber(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "N° de châssis (VIN)" : "Chassis no. (VIN)"}</label>
                <Input value={vin} onChange={(e) => setVin(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "N° de police" : "Policy number"}</label>
                <Input value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={isLeasing} onChange={(e) => toggleLeasing(e.target.checked)} />
                  {fr ? "Véhicule en leasing" : "Vehicle is leased"}
                </label>
                {isLeasing && (
                  leasings.length > 0 ? (
                    <select className={fieldCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                      <option value="">{fr ? "— Ne pas rattacher —" : "— Don't link —"}</option>
                      {leasings.map((l) => <option key={l.id} value={l.id}>{fr ? "Rattacher à : " : "Link to: "}{l.name}</option>)}
                    </select>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {fr ? "Aucun leasing enregistré à rattacher." : "No leasing on record to link to."}
                    </p>
                  )
                )}
              </div>
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
                <label className="text-sm font-medium">{fr ? "Prime (taxes incl.) (CHF)" : "Premium (incl. taxes) (CHF)"} *</label>
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
                <label className="text-sm font-medium">{fr ? "Franchise jeunes conducteurs (CHF)" : "Young-driver deductible (CHF)"}</label>
                <Input type="number" min="0" step="0.01" value={youngDriverFranchise} onChange={(e) => setYoungDriverFranchise(e.target.value)} placeholder="1000" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Degré de prime / bonus (%)" : "Premium level / bonus (%)"}</label>
                <Input type="number" min="0" step="1" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="35" />
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

              <div className="space-y-3 rounded-md border border-dashed border-input p-3 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={showBreakdown} onChange={(e) => setShowBreakdown(e.target.checked)} />
                  {fr ? "Détailler les primes par couverture (comme sur l'offre)" : "Break down premiums per coverage (as on the offer)"}
                </label>
                {showBreakdown && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {PREMIUM_LINES.map((l) => (
                        <div key={l.key} className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">{fr ? l.fr : l.en}</label>
                          <Input type="number" min="0" step="0.01" value={breakdown[l.key] ?? ""}
                            onChange={(e) => setBreakdown((p) => ({ ...p, [l.key]: e.target.value }))} placeholder="0.00" />
                        </div>
                      ))}
                    </div>
                    {breakdownTotal > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{fr ? "Total détaillé" : "Detailed total"} : <span className="font-medium text-foreground">{breakdownTotal.toLocaleString("fr-CH", { style: "currency", currency: "CHF" })}</span></span>
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                          onClick={() => setPremium(breakdownTotal.toFixed(2))}>
                          {fr ? "Utiliser comme prime" : "Use as premium"}
                        </Button>
                      </div>
                    )}
                  </>
                )}
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

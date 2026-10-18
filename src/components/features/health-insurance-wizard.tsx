import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { HeartPulse, User, ShieldCheck, ListChecks, FileText, Check, X, ChevronLeft, ChevronRight, Sparkles, Loader2, UserPlus, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { InlineCreateSelect } from "@/components/ui/inline-create-select"
import { getAiSettings } from "@/lib/ai-settings"
import { documentToText } from "@/lib/document-scan"
import { CANTONS } from "@/lib/cantons"
import { formatPrice, formatDate, cn } from "@/lib/utils"
import {
  HEALTH_MODELS, HEALTH_SUPPLEMENTARY_OPTIONS, ageClassFor, ageClassLabel, healthModelLabel, linesTotal, yearOf,
  type SupplementaryLine,
} from "@/lib/health"
import { SupplementaryLinesEditor, emptyLine } from "@/components/features/supplementary-lines-editor"
import * as api from "@/lib/tauri"

/// Guided creation of a Swiss health-insurance position, one person at a time.
///
/// Swiss health insurance is per PERSON: the mandatory basic cover (LAMal) —
/// same benefits everywhere, the price depends on insurer, region, age class,
/// model and deductible — plus optional supplementary covers (LCA), often with
/// the same insurer but under a different law and different notice rules.
/// The basic cover becomes the engagement; the supplementaries, when present,
/// a child engagement, so their own notice period drives their own reminder.
/// Legal values (allowed deductibles per age class) come from the backend.

const PAY_METHODS: api.EngagementPaymentMethod[] = ["direct_debit", "qr_bill", "standing_order"]
const payMethodLabel = (m: api.EngagementPaymentMethod, fr: boolean): string =>
  m === "qr_bill"      ? (fr ? "QR-facture" : "QR-bill") :
  m === "direct_debit" ? (fr ? "Prélèvement (LSV/SEPA)" : "Direct debit (LSV/SEPA)") :
                         (fr ? "Ordre permanent" : "Standing order")

const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }

const MODEL_HINT: Record<api.HealthModel, { fr: string; en: string }> = {
  standard: { fr: "Libre choix du médecin et des spécialistes.", en: "Free choice of doctor and specialists." },
  family_doctor: { fr: "Toujours passer d'abord par votre médecin de famille.", en: "Always see your family doctor first." },
  hmo: { fr: "Premier recours dans un cabinet HMO du réseau.", en: "First go to an HMO practice in the network." },
  telmed: { fr: "Appeler la hotline médicale avant toute consultation.", en: "Call the medical hotline before any visit." },
  other: { fr: "Autre modèle à choix limité (pharmacie, réseau…).", en: "Other managed-care model (pharmacy, network…)." },
}

function firstOfNextMonth(): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

const numOrNull = (s: string): number | null => {
  const v = parseFloat(s)
  return s.trim() && !Number.isNaN(v) ? v : null
}

/// "Who" choice of step 1: a household member, the vault owner, or someone
/// typed by hand.
const OWNER = "__owner__"
const OTHER = "__other__"

interface HealthInsuranceWizardProps {
  creditors: api.Creditor[]
  cards: api.PaymentCard[]
  onClose: () => void
}

export function HealthInsuranceWizard({ creditors, cards, onClose }: HealthInsuranceWizardProps) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()
  const thisYear = new Date().getFullYear()

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [saving, setSaving] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdName, setCreatedName] = useState("")
  const [createdCount, setCreatedCount] = useState(0)

  const [creditorList, setCreditorList] = useState<api.Creditor[]>(creditors)
  const [cardList, setCardList] = useState<api.PaymentCard[]>(cards)
  const [members, setMembers] = useState<api.HouseholdMember[]>([])
  const [params, setParams] = useState<api.HealthParams | null>(null)

  useEffect(() => {
    api.listHouseholdMembers().then(setMembers).catch(() => setMembers([]))
    api.getHealthParams(thisYear).then((r) => setParams(r.params)).catch(() => setParams(null))
  }, [thisYear])

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

  // Step 1 — the insured person.
  const [who, setWho] = useState<string>(OWNER)
  const [otherName, setOtherName] = useState("")
  const [addToHousehold, setAddToHousehold] = useState(true)
  const [birthDate, setBirthDate] = useState("")
  const [canton, setCanton] = useState("")
  const [region, setRegion] = useState("")

  const member = members.find((m) => m.id === who) ?? null
  const ownerMember = members.find((m) => m.relation === "self") ?? null
  // Picking a member pre-fills the birth date the household already knows.
  function pickWho(id: string) {
    setWho(id)
    const m = members.find((x) => x.id === id) ?? (id === OWNER ? ownerMember : null)
    if (m?.birth_date) setBirthDate(m.birth_date)
  }
  const personLabel =
    who === OTHER ? otherName.trim() :
    who === OWNER ? (ownerMember?.name ?? (fr ? "Moi" : "Me")) :
    member?.name ?? ""
  const ageClass = ageClassFor(yearOf(birthDate), thisYear)

  // Step 2 — the basic cover.
  const [insurerId, setInsurerId] = useState("")
  const [policyNo, setPolicyNo] = useState("")
  const [model, setModel] = useState<api.HealthModel>("standard")
  const [franchise, setFranchise] = useState<number | null>(null)
  const [accident, setAccident] = useState(true)
  const [premium, setPremium] = useState("")
  const [subsidy, setSubsidy] = useState("")
  const [cardId, setCardId] = useState("")
  const [payMethod, setPayMethod] = useState<api.EngagementPaymentMethod>("direct_debit")
  const [cycle, setCycle] = useState<api.EngagementBillingCycle>("monthly")
  const [nextDue, setNextDue] = useState(firstOfNextMonth())
  const [startDate, setStartDate] = useState("")

  const franchises = useMemo(
    () => (params ? (ageClass === "child" ? params.child_franchises : params.adult_franchises) : []),
    [params, ageClass],
  )
  const ordinary = params
    ? (ageClass === "child" ? params.child_ordinary_franchise : params.adult_ordinary_franchise)
    : null
  // A deductible typed for an adult no longer exists once the birth date says
  // "child" (and vice versa): drop it rather than submit an illegal value.
  useEffect(() => {
    if (franchise != null && franchises.length > 0 && !franchises.includes(franchise)) setFranchise(null)
  }, [franchises, franchise])

  // Step 3 — supplementary covers (LCA).
  const [hasLca, setHasLca] = useState(false)
  const [lcaSameInsurer, setLcaSameInsurer] = useState(true)
  // Same insurer → one bill for both covers, by default. A different insurer
  // bills on its own, possibly at another rhythm.
  const [lcaOneBill, setLcaOneBill] = useState(true)
  const [lcaCycle, setLcaCycle] = useState<api.EngagementBillingCycle>("monthly")
  const [firstBill, setFirstBill] = useState<{ due: string; total: number; parts: string } | null>(null)
  const [lcaInsurerId, setLcaInsurerId] = useState("")
  const [lcaPolicyNo, setLcaPolicyNo] = useState("")
  // One line per supplementary product, named as on the policy.
  const [lcaLines, setLcaLines] = useState<SupplementaryLine[]>([emptyLine()])
  const [lcaEnd, setLcaEnd] = useState(`${thisYear}-12-31`)
  const [lcaNotice, setLcaNotice] = useState("90")

  // Scan + IA.
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function applyExtraction(x: api.ExtractedHealthInsurance) {
    const filled: string[] = []
    if (x.insured_name) {
      const needle = x.insured_name.trim().toLowerCase()
      const m = members.find((mm) => mm.name.trim().toLowerCase() === needle)
      if (m) { pickWho(m.id) } else { setWho(OTHER); setOtherName(x.insured_name.trim()) }
      filled.push(fr ? "assuré" : "insured")
    }
    if (x.insured_birth_date) { setBirthDate(x.insured_birth_date); filled.push(fr ? "naissance" : "birth date") }
    if (x.canton) { setCanton(x.canton); filled.push("canton") }
    if (x.premium_region) { setRegion(x.premium_region); filled.push(fr ? "région" : "region") }
    if (x.policy_number) { setPolicyNo(x.policy_number); filled.push(fr ? "n° police" : "policy no.") }
    if (x.model) { setModel(x.model); filled.push(fr ? "modèle" : "model") }
    if (x.franchise != null) { setFranchise(x.franchise); filled.push("franchise") }
    if (x.accident_covered != null) { setAccident(x.accident_covered); filled.push(fr ? "accidents" : "accident") }
    if (x.basic_monthly_premium != null) { setPremium(String(x.basic_monthly_premium)); filled.push(fr ? "prime" : "premium") }
    if (x.subsidy_monthly != null) { setSubsidy(String(x.subsidy_monthly)); filled.push(fr ? "subside" : "subsidy") }
    if (x.payment_method && PAY_METHODS.includes(x.payment_method)) { setPayMethod(x.payment_method); filled.push(fr ? "paiement" : "payment") }
    if (x.billing_cycle) { setCycle(x.billing_cycle); filled.push(fr ? "périodicité" : "frequency") }
    if (x.valid_from) { setStartDate(x.valid_from); filled.push(fr ? "début" : "start") }
    if (x.supplementary_lines.length > 0) {
      setHasLca(true)
      setLcaLines(x.supplementary_lines)
      filled.push(fr ? `${x.supplementary_lines.length} complémentaire(s)` : `${x.supplementary_lines.length} supplementary cover(s)`)
    } else if (x.supplementary_monthly_premium != null) {
      // Only a total on the policy: one line to rename, rather than nothing.
      setHasLca(true)
      const named = x.supplementary_options.map((slug) => HEALTH_SUPPLEMENTARY_OPTIONS.find((o) => o.slug === slug)).filter(Boolean)
      setLcaLines([{
        name: named.length > 0 ? named.map((o) => (fr ? o!.fr : o!.en)).join(", ") : (fr ? "Complémentaires" : "Supplementary"),
        monthly_premium: x.supplementary_monthly_premium, discount_kind: "pct", discount_value: 0,
      }])
      filled.push(fr ? "complémentaires" : "supplementary")
    }
    if (x.insurer_name) {
      const needle = x.insurer_name.trim().toLowerCase()
      const existing = creditorList.find((c) => c.name.trim().toLowerCase() === needle)
      if (existing) { setInsurerId(existing.id); filled.push(fr ? "caisse" : "insurer") }
      else {
        const created = await createInsurer(x.insurer_name.trim())
        if (created) { setInsurerId(created.id); filled.push(fr ? "caisse (créée)" : "insurer (created)") }
      }
    }
    setScanned(filled.length > 0 ? filled.join(" · ") : null)
    return filled.length
  }

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
      const extracted = await api.aiExtractHealthInsurance(text, ai)
      const count = await applyExtraction(extracted)
      toast(count > 0
        ? (fr ? "Champs pré-remplis depuis la police — vérifiez puis complétez." : "Fields pre-filled from the policy — review and complete.")
        : (fr ? "Aucun champ exploitable trouvé dans ce document." : "No usable field found in this document."),
        count > 0 ? "success" : "error")
    } catch (e) {
      toast(`${fr ? "Échec du scan" : "Scan failed"}: ${e}`, "error")
    } finally {
      setScanning(false)
    }
  }

  const premiumValue = parseFloat(premium)
  const subsidyValue = numOrNull(subsidy) ?? 0
  const step1Valid = (who !== OTHER || otherName.trim().length > 0) && birthDate.length === 10
  const step2Valid = !Number.isNaN(premiumValue) && premiumValue > 0 && franchise != null && subsidyValue <= premiumValue
  const lcaFilled = lcaLines.filter((l) => l.name.trim() || l.monthly_premium > 0)
  const lcaPremiumValue = linesTotal(lcaFilled)
  const step3Valid = !hasLca || (lcaFilled.length > 0 && lcaFilled.every((l) => l.name.trim() && l.monthly_premium > 0))
  const months = CYCLE_MONTHS[cycle] ?? 1
  const billedPerCycle = Number.isNaN(premiumValue) ? 0 : Math.max(0, premiumValue - subsidyValue) * months

  /// Resolve the insured into (member id, free-text name). Typing a new person
  /// can also register them in the household, so the next policy, the tax
  /// split and the age check all know them.
  async function resolvePerson(): Promise<{ memberId: string | null; name: string | null }> {
    if (who === OWNER) return { memberId: ownerMember?.id ?? null, name: null }
    if (who !== OTHER) return { memberId: who, name: null }
    if (!addToHousehold) return { memberId: null, name: otherName.trim() }
    const m = await api.createHouseholdMember({ name: otherName.trim(), relation: "other", birth_date: birthDate || null })
    setMembers((prev) => [...prev, m])
    return { memberId: m.id, name: null }
  }

  async function createPosition() {
    if (franchise == null) return
    setSaving(true)
    try {
      const person = await resolvePerson()
      const insurerName = creditorList.find((c) => c.id === insurerId)?.name
      const name = `LAMal — ${personLabel}${insurerName ? ` (${insurerName})` : ""}`
      const auto = payMethod === "direct_debit" || payMethod === "standing_order"
      // LAMal renews every 1st of January; a notice of 31 days before the
      // 31 December puts the cancellation deadline on the 30 November, which
      // the "Résiliations à anticiper" card then surfaces on its own.
      const base = await api.createEngagement({
        name,
        engagement_type: "insurance_health",
        creditor_id: insurerId || null,
        payment_card_id: cardId || null,
        contract_reference: policyNo.trim() || null,
        contract_start_date: startDate || null,
        contract_end_date: `${thisYear}-12-31`,
        notice_period_days: 31,
        billing_cycle: cycle,
        cycle_interval: 1,
        next_due_date: nextDue || null,
        current_amount: Math.round(billedPerCycle * 100) / 100,
        currency: "CHF",
        payment_method: payMethod,
        auto_pay: auto,
        status: "active",
      })
      await api.upsertHealthPolicy({
        engagement_id: base.id,
        kind: "basic",
        insured_member_id: person.memberId,
        insured_name: person.name,
        insured_birth_date: birthDate || null,
        canton: canton || null,
        premium_region: region || null,
        model,
        franchise,
        accident_covered: accident,
        subsidy_monthly: subsidyValue > 0 ? subsidyValue : null,
        options_json: null,
      })

      let count = 1
      const oneBill = hasLca && lcaSameInsurer && lcaOneBill
      const lcaMonths = oneBill ? months : (CYCLE_MONTHS[lcaCycle] ?? 1)
      if (hasLca) {
        const lcaInsurer = lcaSameInsurer ? insurerId : lcaInsurerId
        const lcaInsurerName = creditorList.find((c) => c.id === lcaInsurer)?.name
        const lca = await api.createEngagement({
          name: `LCA — ${personLabel}${lcaInsurerName ? ` (${lcaInsurerName})` : ""}`,
          engagement_type: "insurance_health",
          parent_engagement_id: base.id,
          creditor_id: lcaInsurer || null,
          payment_card_id: cardId || null,
          contract_reference: (lcaSameInsurer ? policyNo : lcaPolicyNo).trim() || null,
          contract_end_date: lcaEnd || null,
          notice_period_days: lcaNotice.trim() ? parseInt(lcaNotice, 10) : null,
          billing_cycle: oneBill ? cycle : lcaCycle,
          cycle_interval: 1,
          next_due_date: nextDue || null,
          current_amount: Math.round(lcaPremiumValue * lcaMonths * 100) / 100,
          currency: "CHF",
          payment_method: payMethod,
          auto_pay: auto,
          status: "active",
        })
        await api.upsertHealthPolicy({
          engagement_id: lca.id,
          kind: "supplementary",
          insured_member_id: person.memberId,
          insured_name: person.name,
          insured_birth_date: birthDate || null,
          canton: canton || null,
          premium_region: region || null,
          model: null,
          franchise: null,
          accident_covered: null,
          subsidy_monthly: null,
          options_json: null,
          supplementary_lines_json: JSON.stringify(lcaFilled.map((l) => ({ ...l, name: l.name.trim() }))),
        })
        if (oneBill) await api.setBilledWithParent(lca.id, true)
        else await api.planNextEngagementCharge(lca.id)
        count += 1
      }
      // The first bill appears right away in the charges, at the date and
      // rhythm chosen — with the supplementary on it when it is one bill.
      await api.planNextEngagementCharge(base.id)
      const baseBilled = Math.round(billedPerCycle * 100) / 100
      const lcaBilled = hasLca ? Math.round(lcaPremiumValue * months * 100) / 100 : 0
      setFirstBill(nextDue ? {
        due: nextDue,
        total: oneBill ? baseBilled + lcaBilled : baseBilled,
        parts: oneBill ? `LAMal ${formatPrice(baseBilled)} + LCA ${formatPrice(lcaBilled)}` : "",
      } : null)
      setCreatedId(base.id)
      setCreatedName(base.name)
      setCreatedCount((c) => c + count)
      setStep(4)
      toast(fr ? "Assurance créée. Ajoutez la police." : "Insurance created. Add the policy.", "success")
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  /// A family is insured person by person: start over for the next one, keeping
  /// what is usually shared (insurer, account, payment, canton, region).
  function nextPerson() {
    setWho(OTHER)
    setOtherName("")
    setBirthDate("")
    setPolicyNo("")
    setFranchise(null)
    setPremium("")
    setSubsidy("")
    setAccident(true)
    setHasLca(false)
    setLcaLines([emptyLine()])
    setLcaPolicyNo("")
    setScanned(null)
    setFirstBill(null)
    setCreatedId(null)
    setStep(1)
  }

  const stepTitle =
    step === 1 ? (fr ? "La personne assurée" : "The insured person") :
    step === 2 ? (fr ? "Assurance de base (LAMal)" : "Basic cover (LAMal)") :
    step === 3 ? (fr ? "Complémentaires (LCA)" : "Supplementary (LCA)") :
                 (fr ? "Documents" : "Documents")

  const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              {step === 1 ? <User className="h-5 w-5" /> : step === 2 ? <ShieldCheck className="h-5 w-5" /> :
               step === 3 ? <ListChecks className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{fr ? "Nouvelle assurance maladie" : "New health insurance"}</h2>
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
                      <p className="text-sm font-medium">{fr ? "Remplissage automatique (scan + IA)" : "Auto-fill (scan + AI)"}</p>
                      <p className="text-xs text-muted-foreground">
                        {fr
                          ? "Scannez la police ou l'avis de prime (PDF ou photo). Une police familiale se saisit une personne à la fois : l'IA lit la première."
                          : "Scan the policy or premium notice (PDF or photo). A family policy is entered one person at a time: the AI reads the first one."}
                      </p>
                    </div>
                  </div>
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={scanning || saving} className="shrink-0">
                    {scanning
                      ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />{fr ? "Analyse…" : "Analyzing…"}</>
                      : <><Sparkles className="mr-1 h-4 w-4" />{fr ? "Scanner la police" : "Scan the policy"}</>}
                  </Button>
                </div>
                {scanned && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                    <Check className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{fr ? "Pré-rempli : " : "Pre-filled: "}{scanned}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Qui est assuré ?" : "Who is insured?"} *</label>
                <select className={fieldCls} value={who} onChange={(e) => pickWho(e.target.value)}>
                  <option value={OWNER}>{ownerMember ? ownerMember.name : (fr ? "Moi" : "Me")}</option>
                  {members.filter((m) => m.relation !== "self").map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                  <option value={OTHER}>{fr ? "Une autre personne…" : "Someone else…"}</option>
                </select>
              </div>
              {who === OTHER && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Prénom et nom" : "Full name"} *</label>
                    <Input value={otherName} onChange={(e) => setOtherName(e.target.value)} autoFocus />
                  </div>
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <input type="checkbox" checked={addToHousehold} onChange={(e) => setAddToHousehold(e.target.checked)} />
                    <span className="flex items-center gap-1"><UserPlus className="h-4 w-4" />{fr ? "L'ajouter au ménage" : "Add to household"}</span>
                  </label>
                </>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Date de naissance" : "Birth date"} *</label>
                <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  {ageClass
                    ? `${ageClassLabel(ageClass, fr)} ${fr ? "en" : "in"} ${thisYear}`
                    : (fr ? "Elle décide de la classe d'âge, donc des franchises possibles." : "It sets the age class, hence the allowed deductibles.")}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Canton de domicile" : "Canton of residence"}</label>
                <select className={fieldCls} value={canton} onChange={(e) => setCanton(e.target.value)}>
                  <option value="">—</option>
                  {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Région de primes" : "Premium region"}</label>
                <select className={fieldCls} value={region} onChange={(e) => setRegion(e.target.value)}>
                  <option value="">—</option>
                  {["0", "1", "2", "3"].map((r) => <option key={r} value={r}>{fr ? "Région" : "Region"} {r}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">
                  {fr ? "Fixée par la commune, indiquée sur la police. Sert à comparer à prime égale." : "Set by the municipality, shown on the policy."}
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Caisse maladie" : "Health insurer"}</label>
                <InlineCreateSelect value={insurerId} onChange={setInsurerId} options={creditorList}
                  onCreate={createInsurer}
                  placeholder={fr ? "Nom (ex : CSS, Helsana, Groupe Mutuel)" : "Name (e.g. CSS, Helsana)"}
                  createTitle={fr ? "Nouvelle caisse" : "New insurer"} fr={fr} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "N° de police / d'assuré" : "Policy / member no."}</label>
                <Input value={policyNo} onChange={(e) => setPolicyNo(e.target.value)} />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Modèle d'assurance" : "Insurance model"}</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {HEALTH_MODELS.map((m) => (
                    <button key={m} type="button" onClick={() => setModel(m)}
                      className={cn("rounded-lg border p-3 text-left transition-colors",
                        model === m ? "border-primary bg-primary/5" : "hover:bg-accent/40")}>
                      <span className="block text-sm font-medium">{healthModelLabel(m, fr)}</span>
                      <span className="block text-xs text-muted-foreground">{fr ? MODEL_HINT[m].fr : MODEL_HINT[m].en}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{fr ? "Franchise annuelle" : "Annual deductible"} *</label>
                <div className="flex flex-wrap gap-2">
                  {franchises.map((f) => (
                    <Button key={f} type="button" size="sm" variant={franchise === f ? "default" : "outline"} onClick={() => setFranchise(f)}>
                      {f.toLocaleString("fr-CH")} CHF{f === ordinary ? (fr ? " · ordinaire" : " · ordinary") : ""}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {ageClass === "child"
                    ? (fr ? "Franchises d'enfant. Quote-part de 10 % plafonnée à " : "Child deductibles. 10% co-payment capped at ")
                    : (fr ? "Après la franchise, 10 % de quote-part plafonnée à " : "After the deductible, 10% co-payment capped at ")}
                  {params ? formatPrice(ageClass === "child" ? params.quote_part_cap_child : params.quote_part_cap_adult) : "—"}
                  {fr ? " par an." : " a year."}
                </p>
              </div>

              <div className="space-y-2 sm:col-span-2 rounded-md border border-dashed border-input p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={accident} onChange={(e) => setAccident(e.target.checked)} />
                  {fr ? "Couverture accidents incluse" : "Accident cover included"}
                </label>
                <p className="text-xs text-muted-foreground">
                  {fr
                    ? "Qui travaille au moins 8 h par semaine chez un même employeur est assuré contre les accidents non professionnels par son employeur (LAA) et peut la faire suspendre ici (art. 8 LAMal). La fiche Santé le vérifie avec votre contrat de travail."
                    : "Anyone working at least 8 h a week for one employer is covered for non-occupational accidents by the employer (LAA) and can suspend it here (art. 8 LAMal)."}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prime mensuelle (CHF)" : "Monthly premium (CHF)"} *</label>
                <Input type="number" min="0" step="0.05" value={premium} onChange={(e) => setPremium(e.target.value)} placeholder="0.00" />
                <p className="text-xs text-muted-foreground">{fr ? "Avant réduction de primes." : "Before premium subsidy."}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Réduction de primes / subside (CHF/mois)" : "Premium subsidy (CHF/month)"}</label>
                <Input type="number" min="0" step="0.05" value={subsidy} onChange={(e) => setSubsidy(e.target.value)} placeholder="0.00" />
                <p className="text-xs text-muted-foreground">{fr ? "Versée par le canton, déduite de la facture." : "Paid by the canton, deducted from the bill."}</p>
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
                <label className="text-sm font-medium">{fr ? "Périodicité de paiement" : "Payment frequency"}</label>
                <select className={fieldCls} value={cycle} onChange={(e) => setCycle(e.target.value as api.EngagementBillingCycle)}>
                  <option value="monthly">{fr ? "Mensuelle" : "Monthly"}</option>
                  <option value="quarterly">{fr ? "Trimestrielle" : "Quarterly"}</option>
                  <option value="semiannual">{fr ? "Semestrielle" : "Half-yearly"}</option>
                  <option value="yearly">{fr ? "Annuelle" : "Yearly"}</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prochaine échéance" : "Next due"}</label>
                <Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Assuré(e) chez cette caisse depuis" : "Insured with this insurer since"}</label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              {billedPerCycle > 0 && (
                <div className="sm:col-span-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
                  {fr ? "Montant facturé" : "Billed amount"} : <span className="font-semibold">{formatPrice(billedPerCycle)}</span>
                  {" "}/ {cycle === "monthly" ? (fr ? "mois" : "month") : cycle === "quarterly" ? (fr ? "trimestre" : "quarter") : cycle === "semiannual" ? (fr ? "semestre" : "half-year") : (fr ? "an" : "year")}
                </div>
              )}
              {subsidyValue > premiumValue && (
                <p className="sm:col-span-2 text-xs text-destructive">{fr ? "Le subside dépasse la prime." : "The subsidy exceeds the premium."}</p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={hasLca} onChange={(e) => setHasLca(e.target.checked)} />
                {fr ? `${personLabel || "Cette personne"} a des assurances complémentaires` : `${personLabel || "This person"} has supplementary covers`}
              </label>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {fr
                    ? "Les complémentaires relèvent de la LCA, pas de la LAMal : leur propre délai de résiliation (souvent 3 mois avant la fin de l'année), et l'assureur peut refuser ou poser des réserves. On peut garder ses complémentaires en changeant de caisse de base."
                    : "Supplementary covers fall under the LCA, not the LAMal: their own notice period (often 3 months before year end), and the insurer may refuse or add exclusions."}
                </span>
              </div>
              {hasLca && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" checked={lcaSameInsurer} onChange={(e) => setLcaSameInsurer(e.target.checked)} />
                    {fr ? "Chez la même caisse que l'assurance de base" : "With the same insurer as the basic cover"}
                  </label>
                  {lcaSameInsurer ? (
                    <label className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm sm:col-span-2">
                      <input type="checkbox" className="mt-1" checked={lcaOneBill} onChange={(e) => setLcaOneBill(e.target.checked)} />
                      <span>
                        <span className="font-medium">{fr ? "Une seule facture LAMal + LCA" : "One bill for LAMal + LCA"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {fr
                            ? "Une échéance par période, du montant total, comme le bulletin de la caisse. Chaque part garde sa prime : leurs hausses du 1er janvier s'additionnent d'elles-mêmes."
                            : "One charge per period for the total, like the insurer's bill. Each part keeps its own premium."}
                        </span>
                      </span>
                    </label>
                  ) : (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{fr ? "Périodicité de la facture LCA" : "LCA billing frequency"}</label>
                      <select className={fieldCls} value={lcaCycle} onChange={(e) => setLcaCycle(e.target.value as api.EngagementBillingCycle)}>
                        <option value="monthly">{fr ? "Mensuelle" : "Monthly"}</option>
                        <option value="quarterly">{fr ? "Trimestrielle" : "Quarterly"}</option>
                        <option value="semiannual">{fr ? "Semestrielle" : "Half-yearly"}</option>
                        <option value="yearly">{fr ? "Annuelle" : "Yearly"}</option>
                      </select>
                    </div>
                  )}
                  {!lcaSameInsurer && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{fr ? "Assureur" : "Insurer"}</label>
                        <InlineCreateSelect value={lcaInsurerId} onChange={setLcaInsurerId} options={creditorList}
                          onCreate={createInsurer} placeholder={fr ? "Nom" : "Name"}
                          createTitle={fr ? "Nouvel assureur" : "New insurer"} fr={fr} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{fr ? "N° de police" : "Policy no."}</label>
                        <Input value={lcaPolicyNo} onChange={(e) => setLcaPolicyNo(e.target.value)} />
                      </div>
                    </>
                  )}
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{fr ? "Vos complémentaires" : "Your supplementary covers"} *</label>
                    <SupplementaryLinesEditor lines={lcaLines} onChange={setLcaLines} fr={fr} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Échéance du contrat" : "Contract term end"}</label>
                    <Input type="date" value={lcaEnd} onChange={(e) => setLcaEnd(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Délai de résiliation (jours)" : "Notice period (days)"}</label>
                    <Input type="number" min="0" value={lcaNotice} onChange={(e) => setLcaNotice(e.target.value)} placeholder="90" />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && createdId && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-800 dark:text-green-300">
                <HeartPulse className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {fr
                    ? "Chaque automne, la fiche Santé vous rappellera de saisir l'avis de prime et les échéances du 30 novembre."
                    : "Each autumn, the Health tab will remind you to enter the premium notice and the 30 November deadlines."}
                </span>
              </div>
              {firstBill && (
                <div className="rounded-md border px-3 py-2 text-sm">
                  {fr ? "Première échéance planifiée : " : "First charge scheduled: "}
                  <span className="font-semibold">{formatPrice(firstBill.total)}</span>
                  {" "}{fr ? "le" : "on"} {formatDate(firstBill.due)}
                  {firstBill.parts && <span className="block text-xs text-muted-foreground">{fr ? "Facture commune" : "Shared bill"} : {firstBill.parts}</span>}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {fr ? "Ajoutez la police d'assurance et, si vous l'avez, l'avis de prime." : "Attach the policy and, if you have it, the premium notice."}
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
          {step === 4 && (
            <Button variant="outline" onClick={nextPerson}>
              <UserPlus className="mr-1 h-4 w-4" />{fr ? "Assurer une autre personne" : "Insure another person"}
            </Button>
          )}

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
            <Button onClick={createPosition} disabled={saving || !step3Valid}>
              {fr ? "Créer" : "Create"}<ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 4 && (
            <Button onClick={onClose}>
              <Check className="mr-1 h-4 w-4" />{fr ? "Terminer" : "Finish"}{createdCount > 1 ? ` (${createdCount})` : ""}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

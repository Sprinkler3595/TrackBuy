import { useEffect, useState, useContext } from "react"
import { Link2, Plus, Sparkles, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { formatPrice } from "@/lib/utils"
import { useToast } from "@/components/ui/toast"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import { InlineCreateSelect } from "@/components/ui/inline-create-select"
import { getAiSettings } from "@/lib/ai-settings"
import * as api from "@/lib/tauri"

/// Engagement types grouped by category, so creating a new engagement from a
/// QR-bill lets the user say what it actually is. Mirrors the grouping on the
/// Engagements page.
const TYPE_GROUPS: { label: string; types: api.EngagementType[] }[] = [
  { label: "Assurances", types: ["insurance_health", "insurance_household", "insurance_car", "insurance_life", "insurance_legal", "insurance_other"] },
  { label: "Logement", types: ["rent", "parking", "mortgage"] },
  { label: "Véhicule", types: ["leasing", "fuel"] },
  { label: "Fluides", types: ["electricity", "gas", "water", "heating"] },
  { label: "Télécom", types: ["phone", "internet", "tv_radio"] },
  { label: "Impôts & taxes", types: ["tax_federal", "tax_cantonal", "tax_communal", "tax_other", "fine", "fee"] },
  { label: "Autre", types: ["membership", "other"] },
]

/// The Swiss QR-bill carries no due date. When the biller filled the Swico S1
/// "billing information" field, we can derive it: `/11/` is the invoice date
/// (YYMMDD) and `/40/` the payment terms (e.g. "0:30" = net 30 days, or
/// "2:10;0:30" = 2% within 10 days, net within 30). Due = invoice date + net
/// days (the 0%-discount term, else the longest). Returns ISO dates or null.
/// (Escaped slashes in values aren't handled — rare in practice.)
function parseSwicoDueDate(billInfo: string): { invoiceDate: string | null; dueDate: string | null } {
  if (!billInfo || !billInfo.startsWith("//S1/")) return { invoiceDate: null, dueDate: null }
  const parts = billInfo.slice(5).split("/")
  const map: Record<string, string> = {}
  for (let i = 0; i + 1 < parts.length; i += 2) map[parts[i]] = parts[i + 1]

  let invoiceDate: string | null = null
  const yymmdd = map["11"]
  if (yymmdd && /^\d{6}$/.test(yymmdd)) {
    invoiceDate = `20${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`
  }

  let dueDate: string | null = null
  const terms = map["40"]
  if (invoiceDate && terms) {
    let netDays: number | null = null
    for (const term of terms.split(";")) {
      const [disc, days] = term.split(":")
      const d = parseInt(days, 10)
      if (Number.isNaN(d)) continue
      if (parseFloat(disc) === 0) { netDays = d; break }
      netDays = Math.max(netDays ?? 0, d)
    }
    if (netDays != null) {
      const dt = new Date(`${invoiceDate}T00:00:00`)
      dt.setDate(dt.getDate() + netDays)
      dueDate = dt.toISOString().slice(0, 10)
    }
  }
  return { invoiceDate, dueDate }
}

/// Modal that opens after the user has decoded a QR-bill payload elsewhere.
/// Picks up the decoded payload from sessionStorage (set by the inbox), so
/// it can be re-used from any page without prop-drilling.
export function QrBillReview() {
  const { t } = useContext(I18nContext)
  const { toast } = useToast()
  const [decoded, setDecoded] = useState<api.QrBillDecoded | null>(null)
  const [creditors, setCreditors] = useState<api.Creditor[]>([])
  const [engagements, setEngagements] = useState<api.Engagement[]>([])
  const [selectedEngagement, setSelectedEngagement] = useState<string>("")
  const [creating, setCreating] = useState(false)
  // Payment due date: derived from the QR-bill's Swico billing info when
  // present, otherwise the user sets it (defaults to today).
  const [dueDate, setDueDate] = useState("")
  const [dueSource, setDueSource] = useState<"swico" | "pdf" | "ia" | "manual">("manual")
  // Invoice text layer (kept from the scan) so the AI can find the due date.
  const [pdfText, setPdfText] = useState("")
  const [aiBusy, setAiBusy] = useState(false)

  // "Create a new engagement" inline form.
  const [showCreate, setShowCreate] = useState(false)
  const [newType, setNewType] = useState<api.EngagementType>("other")
  const [newName, setNewName] = useState("")
  const [newCreditorId, setNewCreditorId] = useState("")
  const [newCycle, setNewCycle] = useState<api.EngagementBillingCycle>("monthly")

  useEffect(() => {
    function pick() {
      const raw = sessionStorage.getItem("qrbill-pending")
      if (!raw) return
      sessionStorage.removeItem("qrbill-pending")
      try {
        const d = JSON.parse(raw) as api.QrBillDecoded
        setDecoded(d)
        setSelectedEngagement(d.suggested_engagement_id ?? "")
        setShowCreate(false)
        setNewName(d.creditor.name || "")
        setNewCreditorId(d.suggested_creditor_id ?? "")
        const { dueDate: swico } = parseSwicoDueDate(d.bill_information)
        const pdfHint = sessionStorage.getItem("qrbill-due-hint")
        sessionStorage.removeItem("qrbill-due-hint")
        setDueDate(swico ?? pdfHint ?? new Date().toISOString().slice(0, 10))
        setDueSource(swico ? "swico" : pdfHint ? "pdf" : "manual")
        setPdfText(sessionStorage.getItem("qrbill-text") ?? "")
        sessionStorage.removeItem("qrbill-text")
        Promise.all([api.getCreditors(), api.getEngagements({ status: "active" })])
          .then(([c, e]) => {
            setCreditors(c)
            setEngagements(e)
          })
          .catch(() => undefined)
      } catch {
        // ignore parsing errors
      }
    }
    pick()
    window.addEventListener("qrbill-decoded", pick)
    return () => window.removeEventListener("qrbill-decoded", pick)
  }, [])

  if (!decoded) return null

  const matchedEngagement = engagements.find((e) => e.id === selectedEngagement)
  const matchedCreditor = creditors.find((c) => c.id === decoded.suggested_creditor_id)
  const typeKey = (typ: api.EngagementType): keyof TranslationKeys =>
    `engagements.type.${typ}` as keyof TranslationKeys
  const dueNote =
    dueSource === "swico" ? "Déduite de la QR-facture (date de facture + délai)." :
    dueSource === "pdf"   ? "Lue sur le PDF de la facture — à vérifier." :
    dueSource === "ia"    ? "Trouvée par l'IA sur la facture — à vérifier." :
                            "Non indiquée sur la QR-facture — à saisir."

  /// Ask the configured AI to read the payment due date off the invoice text.
  async function detectDueDateWithAi() {
    const ai = getAiSettings()
    if (!ai.enabled) {
      toast("Activez l'IA dans Réglages → IA pour utiliser cette fonction.", "error")
      return
    }
    if (!pdfText.trim()) {
      toast("Aucun texte lisible sur ce document (photo/scan ?).", "error")
      return
    }
    setAiBusy(true)
    try {
      const r = await api.aiExtractReceipt(pdfText, ai)
      if (r.due_date) {
        setDueDate(r.due_date)
        setDueSource("ia")
        toast("Échéance détectée par l'IA.", "success")
      } else {
        toast("L'IA n'a pas trouvé d'échéance sur ce document.", "error")
      }
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setAiBusy(false)
    }
  }

  async function linkToEngagement() {
    if (!decoded || !selectedEngagement) return
    setCreating(true)
    try {
      await api.addEngagementCharge({
        engagement_id: selectedEngagement,
        due_date: dueDate || new Date().toISOString().slice(0, 10),
        amount: decoded.amount ?? 0,
        currency: decoded.currency,
        status: "scheduled",
        reference_number: decoded.reference,
        notes: decoded.unstructured_message || null,
      })
      toast("Facture ajoutée à l'engagement", "success")
      setDecoded(null)
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setCreating(false)
    }
  }

  /// Create a creditor from the QR-bill payload (carries the IBAN so future
  /// bills from the same beneficiary match automatically).
  async function createCreditorFromQr(name: string): Promise<api.Creditor | null> {
    if (!decoded) return null
    try {
      const c = await api.createCreditor({ name, iban: decoded.iban })
      setCreditors((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      return c
    } catch (e) {
      toast(String(e), "error")
      return null
    }
  }

  /// Create a new engagement of the chosen category, then record this QR-bill
  /// as its first scheduled charge.
  async function createNewEngagement() {
    if (!decoded || !newName.trim()) return
    setCreating(true)
    try {
      const due = dueDate || new Date().toISOString().slice(0, 10)
      const eng = await api.createEngagement({
        name: newName.trim(),
        engagement_type: newType,
        creditor_id: newCreditorId || null,
        billing_cycle: newCycle,
        cycle_interval: 1,
        next_due_date: due,
        current_amount: decoded.amount ?? null,
        currency: decoded.currency,
        payment_method: "qr_bill",
        contract_reference: decoded.reference || null,
        status: "active",
      })
      // Record the scanned bill as the first charge. Roll-forward de-dups on
      // (engagement, due_date), so it won't be duplicated later.
      await api.addEngagementCharge({
        engagement_id: eng.id,
        due_date: due,
        amount: decoded.amount ?? 0,
        currency: decoded.currency,
        status: "scheduled",
        reference_number: decoded.reference,
        notes: decoded.unstructured_message || null,
      })
      toast(`Engagement « ${eng.name} » créé et facture ajoutée`, "success")
      setDecoded(null)
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">QR-facture décodée</h2>
          <Button variant="ghost" size="sm" onClick={() => setDecoded(null)}>
            ✕
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-4 text-sm">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Bénéficiaire</div>
                <div className="font-medium">{decoded.creditor.name}</div>
                <div className="text-xs text-muted-foreground">
                  {decoded.creditor.postal_code} {decoded.creditor.city},{" "}
                  {decoded.creditor.country}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">IBAN</div>
                <div className="font-mono text-xs">{decoded.iban}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Montant</div>
                <div className="text-lg font-semibold tabular-nums">
                  {decoded.amount != null
                    ? formatPrice(decoded.amount, decoded.currency)
                    : "—"}
                </div>
              </div>
              {decoded.reference && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground">
                    Référence ({decoded.reference_type})
                  </div>
                  <div className="break-all font-mono text-xs">{decoded.reference}</div>
                </div>
              )}
              {decoded.unstructured_message && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Communication</div>
                  <div className="text-xs">{decoded.unstructured_message}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            {!showCreate ? (
              <>
                <div className="rounded-lg border p-3 text-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    <span className="font-medium">Rapprochement</span>
                  </div>
                  {matchedCreditor ? (
                    <p className="text-xs text-muted-foreground">
                      Créancier reconnu : <strong>{matchedCreditor.name}</strong>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Aucun créancier connu pour cet IBAN.
                    </p>
                  )}

                  <label className="mt-3 block text-xs font-medium">Engagement</label>
                  <select
                    className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                    value={selectedEngagement}
                    onChange={(e) => setSelectedEngagement(e.target.value)}
                  >
                    <option value="">— Sélectionner un engagement —</option>
                    {engagements
                      .filter((e) => !matchedCreditor || e.creditor_id === matchedCreditor.id)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    <option disabled>──────────</option>
                    {engagements
                      .filter((e) => matchedCreditor && e.creditor_id !== matchedCreditor.id)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                  {matchedEngagement && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Sera ajoutée comme charge programmée à{" "}
                      <strong>{matchedEngagement.name}</strong>.
                    </p>
                  )}

                  <label className="mt-3 block text-xs font-medium">Échéance de paiement</label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1" />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dueNote}
                  </p>
                  {pdfText && (
                    <Button type="button" variant="outline" size="sm" className="mt-2 h-7 text-xs"
                      onClick={detectDueDateWithAi} disabled={aiBusy}>
                      {aiBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                      Détecter l'échéance avec l'IA
                    </Button>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    onClick={linkToEngagement}
                    disabled={!selectedEngagement || creating}
                    className="w-full"
                  >
                    <Link2 className="mr-2 h-4 w-4" />
                    Lier à l'engagement
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => setShowCreate(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Créer un nouvel engagement
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Plus className="h-4 w-4" />
                    Nouvel engagement
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium">Catégorie / type</label>
                      <select
                        className="w-full rounded-md border bg-background p-2 text-sm"
                        value={newType}
                        onChange={(e) => setNewType(e.target.value as api.EngagementType)}
                      >
                        {TYPE_GROUPS.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.types.map((typ) => (
                              <option key={typ} value={typ}>{t(typeKey(typ))}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium">Nom</label>
                      <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium">Créancier</label>
                      <InlineCreateSelect
                        value={newCreditorId}
                        onChange={setNewCreditorId}
                        options={creditors}
                        onCreate={createCreditorFromQr}
                        placeholder={decoded.creditor.name || "Nom du créancier"}
                        createTitle="Créer depuis la QR-facture (avec IBAN)"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium">Périodicité</label>
                      <select
                        className="w-full rounded-md border bg-background p-2 text-sm"
                        value={newCycle}
                        onChange={(e) => setNewCycle(e.target.value as api.EngagementBillingCycle)}
                      >
                        <option value="monthly">Mensuel</option>
                        <option value="quarterly">Trimestriel</option>
                        <option value="semiannual">Semestriel</option>
                        <option value="yearly">Annuel</option>
                        <option value="one_shot">Ponctuel (une fois)</option>
                        <option value="custom">Personnalisé</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium">Échéance de paiement</label>
                      <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                      <p className="text-xs text-muted-foreground">
                        {dueNote}
                      </p>
                      {pdfText && (
                        <Button type="button" variant="outline" size="sm" className="mt-1 h-7 text-xs"
                          onClick={detectDueDateWithAi} disabled={aiBusy}>
                          {aiBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                          Détecter l'échéance avec l'IA
                        </Button>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Montant{" "}
                      <strong>
                        {decoded.amount != null ? formatPrice(decoded.amount, decoded.currency) : "—"}
                      </strong>{" "}
                      repris de la QR-facture et ajouté comme 1re charge.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Button onClick={createNewEngagement} disabled={!newName.trim() || creating} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    Créer et ajouter la facture
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => setShowCreate(false)}>
                    Retour
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

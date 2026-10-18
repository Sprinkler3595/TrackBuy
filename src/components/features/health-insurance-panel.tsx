import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Info, Loader2, Pencil, Plus, Scale, Sparkles,
  Stethoscope, Trash2, XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { SupplementaryLinesEditor } from "@/components/features/supplementary-lines-editor"
import { getAiSettings } from "@/lib/ai-settings"
import { documentToText } from "@/lib/document-scan"
import { formatDate, formatPrice, cn } from "@/lib/utils"
import { CANTONS } from "@/lib/cantons"
import {
  HEALTH_MODELS, ageClassLabel, decisionLabel, healthModelLabel, lineDiscount, lineNet, linesTotal, parseLines, parseOptions,
  supplementaryLabel, type SupplementaryLine,
} from "@/lib/health"
import * as api from "@/lib/tauri"

/// "Santé" tab of a health-insurance engagement.
///
/// Everything the year of a Swiss health policy asks for, in the order it is
/// asked: what the policy is (and whether it is legal for this person), a link
/// to the premium-season module when it is open, how much of the deductible is
/// already spent,
/// and which deductible would have been cheaper. Legal amounts and deadlines
/// come from the backend engine (`src-tauri/src/health/`), never from here.

const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
const today = () => new Date().toISOString().slice(0, 10)

const numOrNull = (s: string): number | null => {
  const v = parseFloat(s)
  return s.trim() && !Number.isNaN(v) ? v : null
}

export function HealthInsurancePanel({ engagement, onChanged }: { engagement: api.Engagement; onChanged?: () => void }) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()
  const [overview, setOverview] = useState<api.HealthOverview | null>(null)
  const [params, setParams] = useState<api.HealthParams | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const o = await api.getHealthOverview(engagement.id)
      setOverview(o)
      const p = await api.getHealthParams(o.year)
      setParams(p.params)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }
  useEffect(() => { void load() }, [engagement.id, engagement.current_amount])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!overview) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>

  const isBasic = (overview.policy?.kind ?? (engagement.parent_engagement_id ? "supplementary" : "basic")) === "basic"
  const reload = async () => { await load(); onChanged?.() }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <PolicyCard engagement={engagement} overview={overview} params={params} fr={fr} onSaved={reload} toast={toast} />
        <FindingsCard findings={overview.findings} hasPolicy={!!overview.policy} fr={fr} />
      </div>
      {overview.policy && (
        <SeasonLinkCard overview={overview} fr={fr} />
      )}
      {isBasic && overview.policy && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ParticipationCard engagement={engagement} overview={overview} params={params} fr={fr} onSaved={reload} toast={toast} />
          <FranchiseComparator overview={overview} fr={fr} />
        </div>
      )}
    </div>
  )
}

type Toast = ReturnType<typeof useToast>["toast"]

// ---------------------------------------------------------------------------
// La fiche
// ---------------------------------------------------------------------------

function PolicyCard({ engagement, overview, params, fr, onSaved, toast }: {
  engagement: api.Engagement; overview: api.HealthOverview; params: api.HealthParams | null
  fr: boolean; onSaved: () => Promise<void>; toast: Toast
}) {
  const p = overview.policy
  const [editing, setEditing] = useState(false)
  const [members, setMembers] = useState<api.HouseholdMember[]>([])
  const blank: api.HealthPolicy = {
    engagement_id: engagement.id,
    kind: engagement.parent_engagement_id ? "supplementary" : "basic",
    insured_member_id: null, insured_name: null, insured_birth_date: null, canton: null,
    premium_region: null, model: "standard", franchise: null, accident_covered: true,
    subsidy_monthly: null, options_json: null,
  }
  const [form, setForm] = useState<api.HealthPolicy>(p ?? blank)
  const [subsidy, setSubsidy] = useState(p?.subsidy_monthly?.toString() ?? "")

  useEffect(() => {
    if (editing) api.listHouseholdMembers().then(setMembers).catch(() => setMembers([]))
  }, [editing])

  const startEdit = () => {
    setForm(p ?? blank)
    setSubsidy(p?.subsidy_monthly?.toString() ?? "")
    setLines(linesFrom(p))
    setEditing(true)
  }

  // The shared bill: children paid on this policy's invoice (basic), or the
  // switch that puts this supplementary on its parent's invoice.
  const [billParts, setBillParts] = useState<api.Engagement[]>([])
  useEffect(() => {
    if (p?.kind !== "basic") return
    api.getEngagementChildren(engagement.id)
      .then((kids) => setBillParts(kids.filter((k) => k.billed_with_parent && k.status === "active")))
      .catch(() => setBillParts([]))
  }, [engagement.id, p?.kind])

  async function toggleOneBill(combined: boolean) {
    try {
      await api.setBilledWithParent(engagement.id, combined)
      if (!combined) await api.planNextEngagementCharge(engagement.id)
      toast(combined
        ? (fr ? "Payée désormais sur la facture de l'assurance de base." : "Now paid on the basic cover's bill.")
        : (fr ? "Facturée séparément dès la prochaine échéance." : "Billed separately from the next charge."), "success")
      await onSaved()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  async function confirmAffiliation() {
    if (!p) return
    try {
      await api.upsertHealthPolicy({ ...p, affiliation_confirmed_on: today() })
      toast(fr ? "Affiliation confirmée : le changement de caisse est acquis." : "Affiliation confirmed.", "success")
      await onSaved()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const allFranchises = params ? [...new Set([...params.child_franchises, ...params.adult_franchises])].sort((a, b) => a - b) : []
  // Legacy ticked covers (before named lines) become lines to price, so an
  // old record is completed rather than lost.
  const [lines, setLines] = useState<SupplementaryLine[]>([])
  const linesFrom = (pol: api.HealthPolicy | null): SupplementaryLine[] => {
    const named = parseLines(pol?.supplementary_lines_json)
    if (named.length > 0) return named
    return parseOptions(pol?.options_json).map((slug) => ({ name: supplementaryLabel(slug, fr), monthly_premium: 0, discount_kind: "pct", discount_value: 0 }))
  }

  async function save() {
    try {
      const kept = lines.filter((l) => l.name.trim() || l.monthly_premium > 0).map((l) => ({ ...l, name: l.name.trim() }))
      await api.upsertHealthPolicy({
        ...form,
        subsidy_monthly: numOrNull(subsidy),
        ...(form.kind === "supplementary" ? { supplementary_lines_json: kept.length ? JSON.stringify(kept) : null, options_json: kept.length ? null : form.options_json } : {}),
      })
      toast(fr ? "Fiche santé enregistrée." : "Health record saved.", "success")
      setEditing(false)
      await onSaved()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  if (editing) {
    return (
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-lg">{fr ? "Fiche santé" : "Health record"}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{fr ? "Type" : "Type"}</label>
            <select className={fieldCls} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as api.HealthKind })}>
              <option value="basic">{fr ? "Assurance de base (LAMal)" : "Basic cover (LAMal)"}</option>
              <option value="supplementary">{fr ? "Complémentaire (LCA)" : "Supplementary (LCA)"}</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{fr ? "Personne assurée" : "Insured person"}</label>
            <select className={fieldCls} value={form.insured_member_id ?? ""}
              onChange={(e) => {
                const m = members.find((x) => x.id === e.target.value)
                setForm({ ...form, insured_member_id: e.target.value || null, insured_birth_date: m?.birth_date ?? form.insured_birth_date })
              }}>
              <option value="">{fr ? "— Hors ménage / moi —" : "— Not in household / me —"}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {!form.insured_member_id && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{fr ? "Nom (si hors ménage)" : "Name (if not in household)"}</label>
              <Input value={form.insured_name ?? ""} onChange={(e) => setForm({ ...form, insured_name: e.target.value || null })} />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">{fr ? "Date de naissance" : "Birth date"}</label>
            <Input type="date" value={form.insured_birth_date ?? ""} onChange={(e) => setForm({ ...form, insured_birth_date: e.target.value || null })} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Canton</label>
            <select className={fieldCls} value={form.canton ?? ""} onChange={(e) => setForm({ ...form, canton: e.target.value || null })}>
              <option value="">—</option>
              {CANTONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{fr ? "Région de primes" : "Premium region"}</label>
            <select className={fieldCls} value={form.premium_region ?? ""} onChange={(e) => setForm({ ...form, premium_region: e.target.value || null })}>
              <option value="">—</option>
              {["0", "1", "2", "3"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {form.kind === "basic" ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Modèle" : "Model"}</label>
                <select className={fieldCls} value={form.model ?? ""} onChange={(e) => setForm({ ...form, model: (e.target.value || null) as api.HealthModel | null })}>
                  {HEALTH_MODELS.map((m) => <option key={m} value={m}>{healthModelLabel(m, fr)}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Franchise (CHF)</label>
                <select className={fieldCls} value={form.franchise ?? ""} onChange={(e) => setForm({ ...form, franchise: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">—</option>
                  {allFranchises.map((f) => <option key={f} value={f}>{f.toLocaleString("fr-CH")}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Subside (CHF/mois)" : "Subsidy (CHF/month)"}</label>
                <Input type="number" min="0" step="0.05" value={subsidy} onChange={(e) => setSubsidy(e.target.value)} />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input type="checkbox" checked={form.accident_covered ?? false} onChange={(e) => setForm({ ...form, accident_covered: e.target.checked })} />
                {fr ? "Couverture accidents incluse" : "Accident cover included"}
              </label>
            </>
          ) : (
            <div className="sm:col-span-2 space-y-1">
              <SupplementaryLinesEditor lines={lines} onChange={setLines} fr={fr} />
              <p className="text-xs text-muted-foreground">
                {fr ? "Le total net devient le montant facturé de cette complémentaire, à sa périodicité." : "The net total becomes this cover's billed amount."}
              </p>
            </div>
          )}
          <div className="sm:col-span-2 flex gap-2">
            <Button onClick={save}>{fr ? "Enregistrer" : "Save"}</Button>
            <Button variant="outline" onClick={() => setEditing(false)}>{fr ? "Annuler" : "Cancel"}</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!p) {
    return (
      <Card className="lg:col-span-2">
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-muted-foreground">
            {fr
              ? "Cette assurance n'a pas encore de fiche santé : sans la personne assurée, sa franchise et son modèle, ni les échéances ni les contrôles ne peuvent être calculés."
              : "This policy has no health record yet: without the insured person, deductible and model, deadlines and checks can't be computed."}
          </p>
          <Button onClick={startEdit}><Plus className="mr-1 h-4 w-4" />{fr ? "Compléter la fiche santé" : "Complete the health record"}</Button>
        </CardContent>
      </Card>
    )
  }

  const row = (label: string, value: React.ReactNode) => (
    <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>
  )
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg flex items-center gap-2">
          <Stethoscope className="h-5 w-5" />
          {p.kind === "basic" ? (fr ? "Assurance de base (LAMal)" : "Basic cover (LAMal)") : (fr ? "Complémentaires (LCA)" : "Supplementary (LCA)")}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={startEdit}><Pencil className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
        {row(fr ? "Personne assurée" : "Insured person", overview.insured_label ?? "—")}
        {row(fr ? "Classe d'âge" : "Age class", `${ageClassLabel(overview.age_class, fr)}${overview.birth_year ? ` · ${overview.birth_year}` : ""}`)}
        {row(fr ? "Canton · région" : "Canton · region", `${p.canton ?? "—"} · ${p.premium_region ?? "—"}`)}
        {p.kind === "basic" ? (
          <>
            {row(fr ? "Modèle" : "Model", healthModelLabel(p.model, fr))}
            {row("Franchise", p.franchise != null ? formatPrice(p.franchise) : "—")}
            {row(fr ? "Accidents" : "Accidents", p.accident_covered == null ? "—" : p.accident_covered ? (fr ? "Inclus" : "Included") : (fr ? "Suspendus (LAA)" : "Suspended (LAA)"))}
            {row(fr ? "Prime mensuelle brute" : "Gross monthly premium", overview.monthly_gross != null ? formatPrice(overview.monthly_gross) : "—")}
            {row(fr ? "Subside" : "Subsidy", p.subsidy_monthly ? `− ${formatPrice(p.subsidy_monthly)}` : "—")}
            {row(fr ? "Coût maximal de l'année" : "Worst-case year",
              overview.monthly_gross != null && p.franchise != null && params
                ? formatPrice((overview.monthly_gross - (p.subsidy_monthly ?? 0)) * 12 + p.franchise
                    + (overview.age_class === "child" ? params.quote_part_cap_child : params.quote_part_cap_adult))
                : "—")}
          </>
        ) : (
          <div className="sm:col-span-3">
            <p className="text-xs text-muted-foreground">{fr ? "Couvertures" : "Covers"}</p>
            {parseLines(p.supplementary_lines_json).length > 0 ? (
              <table className="mt-1 w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-normal">{fr ? "Complémentaire" : "Cover"}</th>
                    <th className="text-right font-normal">{fr ? "Prime" : "Premium"}</th>
                    <th className="text-right font-normal">{fr ? "Rabais" : "Discount"}</th>
                    <th className="text-right font-normal">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {parseLines(p.supplementary_lines_json).map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1">{l.name}</td>
                      <td className="py-1 text-right">{formatPrice(l.monthly_premium)}</td>
                      <td className="py-1 text-right text-muted-foreground">
                        {lineDiscount(l) > 0 ? `− ${formatPrice(lineDiscount(l))}${l.discount_kind === "pct" ? ` (${l.discount_value} %)` : ""}` : "—"}
                      </td>
                      <td className="py-1 text-right">{formatPrice(lineNet(l))}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold">
                    <td className="py-1" colSpan={3}>{fr ? "Total par mois" : "Total per month"}</td>
                    <td className="py-1 text-right">{formatPrice(linesTotal(parseLines(p.supplementary_lines_json)))}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">
                {parseOptions(p.options_json).length === 0 ? "—" : parseOptions(p.options_json).map((o) => (
                  <Badge key={o} variant="secondary">{supplementaryLabel(o, fr)}</Badge>
                ))}
                <span className="text-xs text-muted-foreground">{fr ? "· crayon : nommer et chiffrer chaque complémentaire" : "· pencil: name and price each cover"}</span>
              </div>
            )}
          </div>
        )}
        {p.kind === "basic" && billParts.length > 0 && engagement.current_amount != null && (
          <div className="sm:col-span-3 rounded-md bg-muted/50 px-3 py-2">
            <p className="text-xs text-muted-foreground">{fr ? "Facture commune (une échéance)" : "Shared bill (one charge)"}</p>
            <p className="font-medium">
              {formatPrice(engagement.current_amount + billParts.reduce((sum, k) => sum + (k.current_amount ?? 0), 0))}
              <span className="font-normal text-muted-foreground">
                {" "}= LAMal {formatPrice(engagement.current_amount)}
                {billParts.map((k) => ` + ${k.name} ${formatPrice(k.current_amount ?? 0)}`).join("")}
              </span>
            </p>
          </div>
        )}
        {p.kind === "supplementary" && engagement.parent_engagement_id && (
          <label className="sm:col-span-3 flex items-start gap-2 rounded-md border border-dashed p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={!!engagement.billed_with_parent} onChange={(e) => void toggleOneBill(e.target.checked)} />
            <span>
              <span className="font-medium">{fr ? `Payée sur la facture de « ${engagement.parent_name ?? "l'assurance de base"} »` : `Paid on the bill of "${engagement.parent_name ?? "the basic cover"}"`}</span>
              <span className="block text-xs text-muted-foreground">
                {fr ? "Une seule échéance par période pour les deux, du montant total — cochez-le si la caisse vous envoie un seul bulletin." : "One charge per period for both — tick if the insurer sends a single bill."}
              </span>
            </span>
          </label>
        )}
        {p.replaces_engagement_id && (
          <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3">
            <span className="text-sm">
              {p.affiliation_confirmed_on
                ? (fr ? `Affiliation confirmée par la caisse le ${formatDate(p.affiliation_confirmed_on)}.` : `Affiliation confirmed on ${formatDate(p.affiliation_confirmed_on)}.`)
                : (fr ? "Nouvelle caisse : en attente de sa confirmation d'affiliation." : "New insurer: awaiting the affiliation confirmation.")}
            </span>
            {!p.affiliation_confirmed_on && (
              <Button size="sm" variant="outline" onClick={confirmAffiliation}>
                <CheckCircle2 className="mr-1 h-4 w-4" />{fr ? "Confirmation reçue" : "Confirmation received"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Les contrôles
// ---------------------------------------------------------------------------

function FindingsCard({ findings, hasPolicy, fr }: { findings: api.HealthFinding[]; hasPolicy: boolean; fr: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">{fr ? "Contrôles" : "Checks"}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!hasPolicy ? (
          <p className="text-sm text-muted-foreground">{fr ? "En attente de la fiche santé." : "Waiting for the health record."}</p>
        ) : findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />{fr ? "Rien à signaler." : "Nothing to report."}
          </p>
        ) : findings.map((f) => (
          <div key={f.id} className="flex items-start gap-2 text-sm">
            {f.severity === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> :
             f.severity === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> :
             <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            <div>
              <p>{f.message}</p>
              <p className="text-xs text-muted-foreground">{f.legal_ref}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// La saison des primes : un module à part, ouvert d'ici
// ---------------------------------------------------------------------------

/// The new conditions are entered in the dedicated "Saison des primes" module,
/// not here: this card only says where things stand and opens it.
function SeasonLinkCard({ overview, fr }: { overview: api.HealthOverview; fr: boolean }) {
  const navigate = useNavigate()
  const next = overview.season_year + 1
  const n = overview.notice_next_year
  return (
    <Card className={cn(overview.season_open && "border-primary/40 bg-primary/5")}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <p className="font-medium">{fr ? `Saison des primes ${overview.season_year} → ${next}` : `Premium season ${overview.season_year} → ${next}`}</p>
            <p className="text-sm text-muted-foreground">
              {n
                ? `${fr ? "Conditions" : "Terms"} ${next} : ${n.monthly_premium != null ? `${formatPrice(n.monthly_premium)} / ${fr ? "mois" : "month"}` : "—"} · ${decisionLabel(n.decision, fr)}`
                : overview.season_open
                  ? (fr ? `Conditions ${next} pas encore saisies.` : `${next} terms not entered yet.`)
                  : (fr ? "Le module s'ouvre à la publication des nouvelles primes (fin septembre)." : "Opens when the new premiums are published.")}
            </p>
          </div>
        </div>
        {overview.season_open && (
          <Button onClick={() => navigate("/saison-primes")}>
            {fr ? "Ouvrir la saison des primes" : "Open the premium season"}<ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Franchise et quote-part consommées
// ---------------------------------------------------------------------------

function Bar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 100
  return (
    <div className="h-2 w-full rounded-full bg-muted">
      <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  )
}

type ClaimDraft = {
  treatment_date: string; statement_date: string; provider: string; invoiced: string; insurer_paid: string
  franchise: string; quote_part: string; hospital: string; not_covered: string
}
const CLAIM_AMOUNTS: { key: keyof ClaimDraft; fr: string; en: string }[] = [
  { key: "invoiced", fr: "Montant facturé", en: "Invoiced" },
  { key: "insurer_paid", fr: "Pris en charge par la caisse", en: "Paid by insurer" },
  { key: "franchise", fr: "Dont franchise", en: "Of which deductible" },
  { key: "quote_part", fr: "Dont quote-part", en: "Of which co-payment" },
  { key: "hospital", fr: "Contribution hospitalière", en: "Hospital contribution" },
  { key: "not_covered", fr: "Non couvert", en: "Not covered" },
]

function ParticipationCard({ engagement, overview, params, fr, onSaved, toast }: {
  engagement: api.Engagement; overview: api.HealthOverview; params: api.HealthParams | null
  fr: boolean; onSaved: () => Promise<void>; toast: Toast
}) {
  const year = overview.year
  const s = overview.participation
  const [claims, setClaims] = useState<api.HealthClaim[]>([])
  const empty = (): ClaimDraft => ({ treatment_date: "", statement_date: today(), provider: "", invoiced: "", insurer_paid: "", franchise: "", quote_part: "", hospital: "", not_covered: "" })
  // Lines being reviewed before saving: one when typed by hand, several when
  // a statement was scanned. Nothing is written until "Ajouter".
  const [drafts, setDrafts] = useState<ClaimDraft[] | null>(null)
  const [mode, setMode] = useState<api.HealthBillingMode | "">("")
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadClaims = () => api.listHealthClaims(engagement.id, year).then(setClaims).catch(() => setClaims([]))
  useEffect(() => { void loadClaims() }, [engagement.id, year])

  async function scan(file: File) {
    const ai = getAiSettings()
    if (!ai.enabled) {
      toast(fr ? "Activez l'IA dans Réglages → IA pour lire le décompte." : "Enable AI in Settings → AI.", "error")
      return
    }
    setScanning(true)
    try {
      const text = await documentToText(new Uint8Array(await file.arrayBuffer()), file.type, file.name)
      if (!text.trim()) throw new Error(fr ? "texte introuvable dans le document" : "no text found")
      const x = await api.aiExtractHealthClaims(text, ai)
      if (x.lines.length === 0) {
        toast(fr ? "Aucune ligne de traitement trouvée dans ce document." : "No treatment line found.", "error")
        return
      }
      const str = (v: number) => (v > 0 ? String(v) : "")
      setDrafts(x.lines.map((l) => ({
        treatment_date: l.treatment_date ?? "", statement_date: x.statement_date ?? today(), provider: l.provider ?? "",
        invoiced: str(l.invoiced), insurer_paid: str(l.insurer_paid), franchise: str(l.franchise),
        quote_part: str(l.quote_part), hospital: str(l.hospital), not_covered: str(l.not_covered),
      })))
      setMode(x.billing_mode ?? "")
      if (x.insured_name && overview.insured_label && !x.insured_name.toLowerCase().includes(overview.insured_label.toLowerCase().split(" ")[0])) {
        toast(fr ? `Ce décompte semble concerner ${x.insured_name}, pas ${overview.insured_label}.` : `This statement seems to be for ${x.insured_name}.`, "error")
      }
    } catch (e) {
      toast(`${fr ? "Échec du scan" : "Scan failed"}: ${e}`, "error")
    } finally {
      setScanning(false)
    }
  }

  async function add() {
    if (!drafts) return
    const n = (v: string) => numOrNull(v) ?? 0
    setSaving(true)
    try {
      const saved = await api.addHealthClaims(drafts.map((d) => ({
        engagement_id: engagement.id, year,
        statement_date: d.statement_date || null, treatment_date: d.treatment_date || null,
        provider: d.provider.trim() || null,
        invoiced: n(d.invoiced), insurer_paid: n(d.insurer_paid), franchise: n(d.franchise),
        quote_part: n(d.quote_part), hospital: n(d.hospital), not_covered: n(d.not_covered), notes: null,
        billing_mode: mode || null,
      })))
      const refunds = saved.filter((c) => c.reimbursement_id)
      const due = refunds.reduce((sum, c) => sum + c.insurer_paid, 0)
      toast(refunds.length > 0
        ? (fr ? `${saved.length} ligne(s) ajoutée(s). Remboursement attendu de ${formatPrice(due)} ajouté aux Remboursements.` : `${saved.length} line(s) added; ${formatPrice(due)} reimbursement expected.`)
        : (fr ? `${saved.length} ligne(s) ajoutée(s).` : `${saved.length} line(s) added.`),
        "success")
      setDrafts(null)
      setMode("")
      await loadClaims()
      await onSaved()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteHealthClaim(id)
      await loadClaims()
      await onSaved()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const setDraft = (i: number, patch: Partial<ClaimDraft>) =>
    setDrafts((ds) => ds && ds.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const toPay = claims.filter((c) => c.billing_mode === "tiers_payant").reduce((sum, c) => sum + c.franchise + c.quote_part + c.hospital + c.not_covered, 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-lg">{fr ? `Participation ${year}` : `${year} cost sharing`}</CardTitle>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void scan(f); e.target.value = "" }} />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={scanning}>
            {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}{fr ? "Scanner" : "Scan"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDrafts((d) => (d ? null : [empty()]))}><Plus className="mr-1 h-4 w-4" />{fr ? "Décompte" : "Statement"}</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {s ? (
          <div className="space-y-3 text-sm">
            <div>
              <div className="flex justify-between"><span>Franchise</span><span>{formatPrice(s.franchise_used)} / {formatPrice(s.franchise)}</span></div>
              <Bar used={s.franchise_used} total={s.franchise} />
            </div>
            <div>
              <div className="flex justify-between"><span>{fr ? "Quote-part (10 %)" : "Co-payment (10%)"}</span><span>{formatPrice(s.quote_part_used)} / {formatPrice(s.quote_part_cap)}</span></div>
              <Bar used={s.quote_part_used} total={s.quote_part_cap} />
            </div>
            <p className="rounded-md bg-muted/50 px-3 py-2">
              {fr ? "Reste au plus à votre charge cette année : " : "At most left to pay this year: "}
              <span className="font-semibold">{formatPrice(s.max_remaining)}</span>
              <span className="block text-xs text-muted-foreground">
                {fr
                  ? `Hors frais hospitaliers (${params ? formatPrice(params.hospital_daily_contribution) : "15 CHF"}/jour) et prestations non couvertes par la LAMal.`
                  : "Excluding hospital contribution and non-covered services."}
              </span>
            </p>
            {toPay > 0 && (
              <p className="text-xs text-muted-foreground">
                {fr ? `Tiers payant : la caisse vous facture ${formatPrice(toPay)} de participation pour ces décomptes.` : `Third-party payer: the insurer bills you ${formatPrice(toPay)}.`}
              </p>
            )}
            {s.over_cap && (
              <p className="text-xs text-destructive">
                {fr ? "Les décomptes dépassent la franchise ou le plafond légal : vérifiez la saisie, ou contestez auprès de la caisse." : "Statements exceed the deductible or legal cap."}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{fr ? "Indiquez la franchise dans la fiche pour suivre la participation." : "Set the deductible to track cost sharing."}</p>
        )}

        {drafts && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">{fr ? "Qui a payé le prestataire ?" : "Who paid the provider?"}</label>
              <select className={fieldCls} value={mode} onChange={(e) => setMode(e.target.value as api.HealthBillingMode | "")}>
                <option value="">—</option>
                <option value="tiers_garant">{fr ? "Moi — la caisse me rembourse (tiers garant)" : "Me — the insurer reimburses (tiers garant)"}</option>
                <option value="tiers_payant">{fr ? "La caisse — elle me facture ma part (tiers payant)" : "The insurer — it bills my share (tiers payant)"}</option>
              </select>
              {mode === "tiers_garant" && (
                <p className="text-xs text-muted-foreground">{fr ? "Le montant pris en charge sera ajouté aux Remboursements en attente." : "The covered amount will be added to pending reimbursements."}</p>
              )}
            </div>
            {drafts.map((d, i) => (
              <div key={i} className="grid gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium">{fr ? "Date du traitement" : "Treatment date"}</label>
                  <Input type="date" value={d.treatment_date} onChange={(e) => setDraft(i, { treatment_date: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">{fr ? "Date du décompte" : "Statement date"}</label>
                  <Input type="date" value={d.statement_date} onChange={(e) => setDraft(i, { statement_date: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium">{fr ? "Prestataire" : "Provider"}</label>
                  <div className="flex gap-2">
                    <Input value={d.provider} onChange={(e) => setDraft(i, { provider: e.target.value })} placeholder={fr ? "Médecin, pharmacie, hôpital…" : "Doctor, pharmacy…"} />
                    {drafts.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => setDrafts((ds) => ds && ds.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    )}
                  </div>
                </div>
                {CLAIM_AMOUNTS.map((a) => (
                  <div key={a.key} className="space-y-1">
                    <label className="text-xs font-medium">{fr ? a.fr : a.en}</label>
                    <Input type="number" min="0" step="0.05" value={d[a.key]} onChange={(e) => setDraft(i, { [a.key]: e.target.value })} />
                  </div>
                ))}
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" onClick={add} disabled={saving}>
                {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{fr ? `Ajouter ${drafts.length > 1 ? `${drafts.length} lignes` : ""}` : "Add"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDrafts(null)}>{fr ? "Annuler" : "Cancel"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {fr ? "Vérifiez chaque montant avec le décompte de la caisse avant d'ajouter." : "Check every amount against the statement."}
            </p>
          </div>
        )}

        {claims.length > 0 && (
          <ul className="divide-y text-sm">
            {claims.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {c.provider ?? (fr ? "Décompte" : "Statement")}
                    {c.reimbursement_id && (
                      <Link to="/reimbursements" className="ml-2"><Badge variant="secondary">{fr ? "Remboursement attendu" : "Reimbursement due"} {formatPrice(c.insurer_paid)}</Badge></Link>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.treatment_date ? formatDate(c.treatment_date) : c.statement_date ? formatDate(c.statement_date) : ""}
                    {" · "}{fr ? "facturé" : "invoiced"} {formatPrice(c.invoiced)}
                    {c.franchise > 0 && ` · franchise ${formatPrice(c.franchise)}`}
                    {c.quote_part > 0 && ` · QP ${formatPrice(c.quote_part)}`}
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Quelle franchise ?
// ---------------------------------------------------------------------------

function FranchiseComparator({ overview, fr }: { overview: api.HealthOverview; fr: boolean }) {
  const policy = overview.policy
  const franchises = overview.allowed_franchises
  const [premiums, setPremiums] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    if (policy?.franchise != null && overview.monthly_gross != null) init[policy.franchise] = overview.monthly_gross.toFixed(2)
    return init
  })
  const [costs, setCosts] = useState(() => (overview.participation ? String(Math.round(overview.participation.invoiced)) : "1000"))
  const [result, setResult] = useState<api.FranchiseComparison | null>(null)

  const options = useMemo(() => franchises
    .map((f) => ({ franchise: f, monthly_premium: numOrNull(premiums[f] ?? "") }))
    .filter((o): o is api.FranchiseOption => o.monthly_premium != null && o.monthly_premium > 0),
  [franchises, premiums])

  useEffect(() => {
    const c = numOrNull(costs)
    if (options.length < 2 || c == null) { setResult(null); return }
    api.compareHealthFranchises(overview.year, overview.birth_year, options, c).then(setResult).catch(() => setResult(null))
  }, [options, costs, overview.year, overview.birth_year])

  if (franchises.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-lg">{fr ? "Quelle franchise ?" : "Which deductible?"}</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">{fr ? "Indiquez la date de naissance dans la fiche." : "Set the birth date in the record."}</p></CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Scale className="h-5 w-5" />
        <CardTitle className="text-lg">{fr ? "Quelle franchise ?" : "Which deductible?"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {fr
            ? "Saisissez la prime mensuelle de chaque franchise (avis de prime, offre ou priminfo.admin.ch) et vos frais médicaux probables. Le calcul — prime + franchise + 10 % de quote-part plafonnée — est le même chez toutes les caisses."
            : "Enter the monthly premium for each deductible and your likely medical costs."}
        </p>
        <div className="space-y-1">
          <label className="text-xs font-medium">{fr ? "Frais médicaux attendus sur l'année (CHF)" : "Expected yearly medical costs (CHF)"}</label>
          <Input type="number" min="0" step="50" value={costs} onChange={(e) => setCosts(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {franchises.map((f) => (
            <div key={f} className="space-y-1">
              <label className="text-xs text-muted-foreground">{f.toLocaleString("fr-CH")} CHF</label>
              <Input type="number" min="0" step="0.05" placeholder={fr ? "prime/mois" : "premium/mo"}
                value={premiums[f] ?? ""} onChange={(e) => setPremiums((p) => ({ ...p, [f]: e.target.value }))} />
            </div>
          ))}
        </div>
        {options.length < 2 ? (
          <p className="text-xs text-muted-foreground">{fr ? "Il faut au moins deux primes pour comparer." : "At least two premiums are needed."}</p>
        ) : result && (
          <div className="space-y-2">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr><th className="text-left font-normal">Franchise</th><th className="text-right font-normal">{fr ? "Primes/an" : "Premiums/yr"}</th><th className="text-right font-normal">{fr ? "Participation" : "Cost sharing"}</th><th className="text-right font-normal">Total</th></tr>
              </thead>
              <tbody>
                {result.options.map((o) => (
                  <tr key={o.franchise} className={cn(o.franchise === result.best_franchise && "font-semibold text-primary")}>
                    <td>{o.franchise.toLocaleString("fr-CH")}</td>
                    <td className="text-right">{formatPrice(o.annual_premium)}</td>
                    <td className="text-right">{formatPrice(o.participation.total)}</td>
                    <td className="text-right">{formatPrice(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.break_evens.filter((b) => b.costs_above != null).map((b) => (
              <p key={`${b.lower_franchise}-${b.higher_franchise}`} className="text-xs text-muted-foreground">
                {fr
                  ? `${b.lower_franchise.toLocaleString("fr-CH")} devient plus avantageuse que ${b.higher_franchise.toLocaleString("fr-CH")} au-delà d'environ ${formatPrice(b.costs_above as number)} de frais.`
                  : `${b.lower_franchise} beats ${b.higher_franchise} above about ${formatPrice(b.costs_above as number)} of costs.`}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              {fr ? "Pire cas (frais très élevés) : " : "Worst case: "}
              {result.worst_cases.map(([f, t]) => `${f.toLocaleString("fr-CH")} → ${formatPrice(t)}`).join(" · ")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

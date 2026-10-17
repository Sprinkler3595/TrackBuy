import { useContext, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, FileText, Info, Loader2, Pencil, Plus, Scale, Stethoscope, Trash2, XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { CancellationLetterModal } from "@/components/features/cancellation-letter"
import { formatDate, formatPrice, daysUntil, cn } from "@/lib/utils"
import { CANTONS } from "@/lib/cantons"
import {
  HEALTH_MODELS, HEALTH_SUPPLEMENTARY_OPTIONS, ageClassLabel, decisionLabel, healthModelLabel, parseOptions, supplementaryLabel,
} from "@/lib/health"
import * as api from "@/lib/tauri"

/// "Santé" tab of a health-insurance engagement.
///
/// Everything the year of a Swiss health policy asks for, in the order it is
/// asked: what the policy is (and whether it is legal for this person), what
/// to do before the 30 November, how much of the deductible is already spent,
/// and which deductible would have been cheaper. Legal amounts and deadlines
/// come from the backend engine (`src-tauri/src/health/`), never from here.

const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
const DECISIONS: api.HealthDecision[] = ["pending", "keep", "change_franchise", "change_model", "switch_insurer"]
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
      {isBasic && (
        <SeasonCard engagement={engagement} overview={overview} params={params} fr={fr} onSaved={reload} toast={toast} />
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
    setEditing(true)
  }

  const allFranchises = params ? [...new Set([...params.child_franchises, ...params.adult_franchises])].sort((a, b) => a - b) : []
  const options = parseOptions(form.options_json)

  async function save() {
    try {
      await api.upsertHealthPolicy({ ...form, subsidy_monthly: numOrNull(subsidy) })
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
            <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
              {HEALTH_SUPPLEMENTARY_OPTIONS.map((o) => (
                <label key={o.slug} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={options.includes(o.slug)}
                    onChange={() => {
                      const next = options.includes(o.slug) ? options.filter((x) => x !== o.slug) : [...options, o.slug]
                      setForm({ ...form, options_json: next.length ? JSON.stringify(next) : null })
                    }} />
                  {fr ? o.fr : o.en}
                </label>
              ))}
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
            <div className="mt-1 flex flex-wrap gap-1">
              {parseOptions(p.options_json).length === 0 ? "—" : parseOptions(p.options_json).map((o) => (
                <Badge key={o} variant="secondary">{supplementaryLabel(o, fr)}</Badge>
              ))}
            </div>
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
// La saison des primes et l'avis de l'année suivante
// ---------------------------------------------------------------------------

function SeasonCard({ engagement, overview, params, fr, onSaved, toast }: {
  engagement: api.Engagement; overview: api.HealthOverview; params: api.HealthParams | null
  fr: boolean; onSaved: () => Promise<void>; toast: Toast
}) {
  const next = overview.season_year + 1
  const n = overview.notice_next_year
  const [premium, setPremium] = useState(n?.monthly_premium?.toString() ?? "")
  const [franchise, setFranchise] = useState(n?.franchise?.toString() ?? overview.policy?.franchise?.toString() ?? "")
  const [model, setModel] = useState<api.HealthModel | "">(n?.model ?? overview.policy?.model ?? "")
  const [receivedOn, setReceivedOn] = useState(n?.received_on ?? today())
  const [decision, setDecision] = useState<api.HealthDecision>(n?.decision ?? "pending")
  const [notes, setNotes] = useState(n?.notes ?? "")
  const [saving, setSaving] = useState(false)
  const [letter, setLetter] = useState(false)
  const [creditor, setCreditor] = useState<api.Creditor | null>(null)
  const [nextParams, setNextParams] = useState<api.HealthParams | null>(null)

  useEffect(() => { api.getHealthParams(next).then((r) => setNextParams(r.params)).catch(() => setNextParams(null)) }, [next])

  const newPremium = numOrNull(premium)
  const change = newPremium != null && overview.monthly_gross ? (newPremium - overview.monthly_gross) / overview.monthly_gross * 100 : null
  const avg = nextParams?.ofsp_average_change_pct ?? null

  async function save() {
    setSaving(true)
    try {
      await api.saveHealthPremiumNotice({
        engagement_id: engagement.id,
        year: next,
        monthly_premium: newPremium,
        franchise: numOrNull(franchise),
        model: model || null,
        accident_covered: overview.policy?.accident_covered ?? null,
        received_on: receivedOn || null,
        decision,
        notes: notes.trim() || null,
      })
      toast(decision === "switch_insurer"
        ? (fr ? "Avis enregistré. Pensez à la lettre et à l'inscription chez la nouvelle caisse." : "Notice saved. Remember the letter and the new insurer.")
        : (fr ? `Avis enregistré : les échéances passeront à la nouvelle prime le 1.1.${next}.` : `Notice saved: charges switch to the new premium on 1 Jan ${next}.`),
        "success")
      await onSaved()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  async function openLetter() {
    try {
      const all = await api.getCreditors()
      setCreditor(all.find((c) => c.id === engagement.creditor_id) ?? null)
    } catch {
      setCreditor(null)
    }
    setLetter(true)
  }

  const events = overview.season.filter((e) => e.key !== "mid_year_switch" || e.applies)
  return (
    <Card className={cn(overview.season_open && "border-primary/40")}>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <CalendarClock className="h-5 w-5" />
        <CardTitle className="text-lg">{fr ? `Saison des primes ${overview.season_year} → ${next}` : `Premium season ${overview.season_year} → ${next}`}</CardTitle>
        {overview.season_open && <Badge className="ml-auto">{fr ? "En cours" : "Open"}</Badge>}
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <ol className="space-y-3">
          {events.map((e) => {
            const d = daysUntil(e.working_date)
            return (
              <li key={e.key} className={cn("rounded-md border p-3", d < 0 && "opacity-60")}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{e.title}</p>
                  <span className={cn("text-xs whitespace-nowrap", d >= 0 && d <= 14 ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {formatDate(e.working_date)}{d >= 0 ? ` · J-${d}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{e.detail}</p>
                {e.working_date !== e.date && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {fr ? `Le ${formatDate(e.date)} tombe un week-end : visez le ${formatDate(e.working_date)}.` : `${formatDate(e.date)} is a weekend: aim for ${formatDate(e.working_date)}.`}
                  </p>
                )}
                {e.send_by && d >= 0 && (
                  <p className="mt-1 text-xs">{fr ? "Recommandé à poster au plus tard le " : "Post registered mail by "}<span className="font-medium">{formatDate(e.send_by)}</span></p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">{e.legal_ref}</p>
              </li>
            )
          })}
        </ol>

        <div className="space-y-3">
          <p className="text-sm font-medium">{fr ? `Avis de prime ${next}` : `${next} premium notice`}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">{fr ? "Nouvelle prime mensuelle (CHF)" : "New monthly premium (CHF)"}</label>
              <Input type="number" min="0" step="0.05" value={premium} onChange={(e) => setPremium(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">{fr ? "Reçu le" : "Received on"}</label>
              <Input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">{fr ? `Franchise ${next}` : `${next} deductible`}</label>
              <select className={fieldCls} value={franchise} onChange={(e) => setFranchise(e.target.value)}>
                <option value="">—</option>
                {(overview.allowed_franchises.length ? overview.allowed_franchises : params?.adult_franchises ?? []).map((f) => (
                  <option key={f} value={f}>{f.toLocaleString("fr-CH")}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">{fr ? `Modèle ${next}` : `${next} model`}</label>
              <select className={fieldCls} value={model} onChange={(e) => setModel(e.target.value as api.HealthModel | "")}>
                <option value="">—</option>
                {HEALTH_MODELS.map((m) => <option key={m} value={m}>{healthModelLabel(m, fr)}</option>)}
              </select>
            </div>
          </div>
          {change != null && (
            <div className={cn("rounded-md px-3 py-2 text-sm",
              avg != null && change > avg + 1 ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted/50")}>
              {formatPrice(overview.monthly_gross ?? 0)} → <span className="font-semibold">{formatPrice(newPremium ?? 0)}</span>
              {" "}({change >= 0 ? "+" : ""}{change.toFixed(1)} %)
              {avg != null && <span className="text-muted-foreground"> · {fr ? "moyenne suisse OFSP" : "Swiss average (FOPH)"} {avg >= 0 ? "+" : ""}{avg.toFixed(1)} %</span>}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium">{fr ? "Décision" : "Decision"}</label>
            <div className="flex flex-wrap gap-2">
              {DECISIONS.map((d) => (
                <Button key={d} type="button" size="sm" variant={decision === d ? "default" : "outline"} onClick={() => setDecision(d)}>
                  {decisionLabel(d, fr)}
                </Button>
              ))}
            </div>
          </div>
          <textarea className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={fr ? "Notes (offre concurrente, prime trouvée sur priminfo…)" : "Notes (competing offer…)"}
            value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{fr ? "Enregistrer l'avis" : "Save notice"}</Button>
            {decision === "switch_insurer" && (
              <Button variant="outline" onClick={openLetter}><FileText className="mr-1 h-4 w-4" />{fr ? "Lettre de résiliation" : "Cancellation letter"}</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {fr ? "Comparer les primes de toutes les caisses pour votre région : " : "Compare every insurer's premium for your region: "}
            <a href="https://www.priminfo.admin.ch" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
              priminfo.admin.ch<ExternalLink className="h-3 w-3" />
            </a>
            {fr ? " (comparateur officiel de l'OFSP)." : " (official FOPH comparator)."}
          </p>
        </div>
      </CardContent>
      {letter && <CancellationLetterModal engagement={engagement} creditor={creditor} onClose={() => setLetter(false)} />}
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

function ParticipationCard({ engagement, overview, params, fr, onSaved, toast }: {
  engagement: api.Engagement; overview: api.HealthOverview; params: api.HealthParams | null
  fr: boolean; onSaved: () => Promise<void>; toast: Toast
}) {
  const year = overview.year
  const s = overview.participation
  const [claims, setClaims] = useState<api.HealthClaim[]>([])
  const [show, setShow] = useState(false)
  const empty = { treatment_date: "", statement_date: today(), provider: "", invoiced: "", insurer_paid: "", franchise: "", quote_part: "", hospital: "", not_covered: "" }
  const [form, setForm] = useState(empty)

  const loadClaims = () => api.listHealthClaims(engagement.id, year).then(setClaims).catch(() => setClaims([]))
  useEffect(() => { void loadClaims() }, [engagement.id, year])

  async function add() {
    const n = (v: string) => numOrNull(v) ?? 0
    try {
      await api.addHealthClaim({
        engagement_id: engagement.id, year,
        statement_date: form.statement_date || null, treatment_date: form.treatment_date || null,
        provider: form.provider.trim() || null,
        invoiced: n(form.invoiced), insurer_paid: n(form.insurer_paid), franchise: n(form.franchise),
        quote_part: n(form.quote_part), hospital: n(form.hospital), not_covered: n(form.not_covered), notes: null,
      })
      setForm(empty)
      setShow(false)
      await loadClaims()
      await onSaved()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
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

  const f = (k: keyof typeof empty, label: string, type = "number") => (
    <div className="space-y-1">
      <label className="text-xs font-medium">{label}</label>
      <Input type={type} min="0" step="0.05" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">{fr ? `Participation ${year}` : `${year} cost sharing`}</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setShow((v) => !v)}><Plus className="mr-1 h-4 w-4" />{fr ? "Décompte" : "Statement"}</Button>
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
            {s.over_cap && (
              <p className="text-xs text-destructive">
                {fr ? "Les décomptes dépassent la franchise ou le plafond légal : vérifiez la saisie, ou contestez auprès de la caisse." : "Statements exceed the deductible or legal cap."}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{fr ? "Indiquez la franchise dans la fiche pour suivre la participation." : "Set the deductible to track cost sharing."}</p>
        )}

        {show && (
          <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
            {f("treatment_date", fr ? "Date du traitement" : "Treatment date", "date")}
            {f("statement_date", fr ? "Date du décompte" : "Statement date", "date")}
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium">{fr ? "Prestataire" : "Provider"}</label>
              <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder={fr ? "Médecin, pharmacie, hôpital…" : "Doctor, pharmacy…"} />
            </div>
            {f("invoiced", fr ? "Montant facturé" : "Invoiced")}
            {f("insurer_paid", fr ? "Pris en charge par la caisse" : "Paid by insurer")}
            {f("franchise", fr ? "Dont franchise" : "Of which deductible")}
            {f("quote_part", fr ? "Dont quote-part" : "Of which co-payment")}
            {f("hospital", fr ? "Contribution hospitalière" : "Hospital contribution")}
            {f("not_covered", fr ? "Non couvert" : "Not covered")}
            <div className="sm:col-span-2 flex gap-2">
              <Button size="sm" onClick={add}>{fr ? "Ajouter" : "Add"}</Button>
              <Button size="sm" variant="outline" onClick={() => setShow(false)}>{fr ? "Annuler" : "Cancel"}</Button>
            </div>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              {fr ? "Reprenez les montants du décompte de prestations de la caisse. Les frais à votre charge sont aussi déductibles des impôts au-delà d'un seuil cantonal." : "Copy the amounts from the insurer's statement."}
            </p>
          </div>
        )}

        {claims.length > 0 && (
          <ul className="divide-y text-sm">
            {claims.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.provider ?? (fr ? "Décompte" : "Statement")}</p>
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

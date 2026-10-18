import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle, ArrowRightLeft, CalendarClock, Check, FileText, FolderOpen, HeartPulse, Info, Loader2, Plus, Sparkles, Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { CancellationLetterModal } from "@/components/features/cancellation-letter"
import { SwitchInsurerDialog } from "@/components/features/switch-insurer-dialog"
import { getCancellationInfo } from "@/lib/cancellation"
import { getAiSettings } from "@/lib/ai-settings"
import { documentToText } from "@/lib/document-scan"
import { formatDate, formatPrice, daysUntil, cn } from "@/lib/utils"
import {
  HEALTH_MODELS, ageClassLabel, healthModelLabel, lineDiscount, lineNet, linesTotal, parseLines, round2,
  type SupplementaryLine,
} from "@/lib/health"
import * as api from "@/lib/tauri"

/// The premium season, as a module of its own.
///
/// Every autumn the insurer announces next year's conditions, and the insured
/// decides: keep them, change deductible or model, or leave. This page is
/// where that happens, person by person — the basic cover (LAMal) with its
/// new premium, deductible, model, accident cover and subsidy, next to this
/// year's; each supplementary cover (LCA) product by product, with its new
/// premium and discount. It is listed in the navigation only while the
/// season is open (from the publication of the premiums to 31 December).
///
/// Nothing here is a computation of its own: amounts are typed from the
/// insurer's letter, deadlines come from the backend calendar, and saving
/// records one notice per policy — which the backend turns into the
/// 1 January revision of the charges.

type Detail = { policy: api.HealthSeasonPolicy; overview: api.HealthOverview; engagement: api.Engagement }

type BasicDraft = {
  kind: "basic"
  premium: string
  subsidy: string
  franchise: string
  model: api.HealthModel | ""
  accident: boolean
  decision: api.HealthDecision
}
type LcaDraft = { kind: "lca"; lines: SupplementaryLine[]; decision: api.HealthDecision }
type Draft = BasicDraft | LcaDraft

/// Two choices only: the new terms are validated as typed — a different
/// deductible or model in the fields IS the change — or the insurer is left.
const VALIDATED: api.HealthDecision[] = ["keep", "change_franchise", "change_model"]

const numOrNull = (s: string): number | null => {
  const v = parseFloat(s)
  return s.trim() && !Number.isNaN(v) ? v : null
}
const num = (s: string) => numOrNull(s) ?? 0
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

/// Does a name read on the letter designate this insured person? A match on
/// the first name is enough — households share it least.
function samePerson(extracted: string, label: string | null): boolean {
  if (!label) return false
  const a = norm(extracted)
  const first = norm(label).split(/\s+/)[0]
  return first.length > 1 && (a.split(/\s+/).includes(first) || a.startsWith(first))
}

const isLca = (d: Detail) => (d.overview.policy?.kind ?? (d.engagement.parent_engagement_id ? "supplementary" : "basic")) === "supplementary"

/// What one policy costs per month, this year and with the new terms —
/// premium minus subsidy, discounts included. A policy being left counts for
/// nothing next year; an empty new premium keeps this year's figure.
function nowNext(d: Detail, draft: Draft): { now: number; next: number } {
  const lcaNow = parseLines(d.overview.policy?.supplementary_lines_json)
  const now = draft.kind === "lca" && lcaNow.length > 0
    ? linesTotal(lcaNow)
    : (d.policy.monthly_gross ?? 0) - (d.policy.subsidy_monthly ?? 0)
  if (draft.decision === "switch_insurer") return { now, next: 0 }
  if (draft.kind === "basic") {
    const p = numOrNull(draft.premium)
    return { now, next: p != null ? Math.max(0, p - num(draft.subsidy)) : now }
  }
  return { now, next: linesTotal(draft.lines) }
}

const pct = (now: number, next: number): number | null => (now > 0 ? (next - now) / now * 100 : null)

function Change({ now, next, className }: { now: number; next: number; className?: string }) {
  const p = pct(now, next)
  if (p == null) return null
  return (
    <span className={cn("whitespace-nowrap text-xs", p > 0 ? "text-amber-700 dark:text-amber-400" : p < 0 ? "text-green-700 dark:text-green-400" : "text-muted-foreground", className)}>
      {p >= 0 ? "+" : ""}{p.toFixed(1)} %
    </span>
  )
}

function initialDraft(d: Detail): Draft {
  const n = d.policy.notice
  const p = d.overview.policy
  if (isLca(d)) {
    // Start from the notice's lines if any, else from this year's products,
    // their premiums to be updated from the letter.
    const lines = parseLines(n?.supplementary_lines_json) .length > 0
      ? parseLines(n?.supplementary_lines_json)
      : parseLines(p?.supplementary_lines_json)
    return {
      kind: "lca",
      lines: lines.length > 0 ? lines : [{ name: d.engagement.name, monthly_premium: n?.monthly_premium ?? d.policy.monthly_gross ?? 0, discount_kind: "pct", discount_value: 0 }],
      decision: n?.decision ?? "pending",
    }
  }
  return {
    kind: "basic",
    premium: n?.monthly_premium?.toString() ?? "",
    subsidy: (n?.subsidy_monthly ?? p?.subsidy_monthly)?.toString() ?? "",
    franchise: (n?.franchise ?? p?.franchise)?.toString() ?? "",
    model: (n?.model ?? p?.model ?? "") as api.HealthModel | "",
    accident: n?.accident_covered ?? p?.accident_covered ?? true,
    decision: n?.decision ?? "pending",
  }
}

export function HealthSeasonPage() {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()
  const [season, setSeason] = useState<api.HealthSeason | null>(null)
  const [details, setDetails] = useState<Detail[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanReport, setScanReport] = useState<string | null>(null)
  const [switching, setSwitching] = useState<Detail | null>(null)
  const [letter, setLetter] = useState<{ engagement: api.Engagement; creditor: api.Creditor | null } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await api.getHealthSeason()
      const ds = await Promise.all(s.policies.map(async (p) => {
        const [overview, engagement] = await Promise.all([api.getHealthOverview(p.engagement_id), api.getEngagement(p.engagement_id)])
        return { policy: p, overview, engagement }
      }))
      setSeason(s)
      setDetails(ds)
      setDrafts(Object.fromEntries(ds.map((d) => [d.policy.engagement_id, initialDraft(d)])))
      setDirty(new Set())
      const received = s.policies.find((p) => p.notice?.received_on)?.notice?.received_on
      if (received) setReceivedOn(received)
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setLoading(false)
    }
  }, [toast])
  useEffect(() => { void load() }, [load])

  const update = (id: string, patch: Partial<BasicDraft> | Partial<LcaDraft>) => {
    setDrafts((ds) => ({ ...ds, [id]: { ...ds[id], ...patch } as Draft }))
    setDirty((s) => new Set(s).add(id))
  }

  // People in order, each with their basic cover first, then supplementaries.
  const people = useMemo(() => {
    const groups = new Map<string, Detail[]>()
    for (const d of details) {
      const key = d.policy.insured_label ?? d.policy.name
      groups.set(key, [...(groups.get(key) ?? []), d])
    }
    return [...groups.entries()].map(([name, ds]) => ({ name, ds: ds.sort((a, b) => Number(isLca(a)) - Number(isLca(b))) }))
  }, [details])

  // Household per month, this year vs the new conditions (what is actually
  // billed: premium minus subsidy, discounts included).
  const sum = useCallback((ds: Detail[]) => {
    let now = 0
    let next = 0
    for (const d of ds) {
      const draft = drafts[d.policy.engagement_id]
      if (!draft) continue
      const x = nowNext(d, draft)
      now += x.now
      next += x.next
    }
    return { now: round2(now), next: round2(next) }
  }, [drafts])
  const totals = useMemo(() => sum(details), [sum, details])

  async function scan(file: File) {
    const ai = getAiSettings()
    if (!ai.enabled) {
      toast(fr ? "Activez l'IA dans Réglages → IA pour lire la lettre." : "Enable AI in Settings → AI.", "error")
      return
    }
    setScanning(true)
    setScanReport(null)
    try {
      const text = await documentToText(new Uint8Array(await file.arrayBuffer()), file.type, file.name)
      if (!text.trim()) throw new Error(fr ? "texte introuvable dans le document" : "no text found")
      const x = await api.aiExtractPremiumNotice(text, ai)
      const matched: string[] = []
      const unmatched: string[] = []
      for (const person of x.persons) {
        const name = person.insured_name ?? ""
        const mine = details.filter((d) => samePerson(name, d.policy.insured_label))
        if (mine.length === 0) { unmatched.push(name || "?"); continue }
        const basic = mine.find((d) => !isLca(d))
        if (basic) {
          update(basic.policy.engagement_id, {
            ...(person.basic_monthly_premium != null ? { premium: String(person.basic_monthly_premium) } : {}),
            ...(person.franchise != null ? { franchise: String(person.franchise) } : {}),
            ...(person.subsidy_monthly != null ? { subsidy: String(person.subsidy_monthly) } : {}),
            ...(person.model ? { model: person.model } : {}),
          })
        }
        const lca = mine.find((d) => isLca(d))
        const lcaDraft = lca ? drafts[lca.policy.engagement_id] : null
        if (lca && lcaDraft?.kind === "lca" && person.supplementary_monthly_premium != null && lcaDraft.lines.length === 1) {
          // One product: the letter's total is its premium. Several: the
          // letter's total cannot be split for you — it is shown instead.
          update(lca.policy.engagement_id, { lines: [{ ...lcaDraft.lines[0], monthly_premium: person.supplementary_monthly_premium, discount_value: 0 }] })
        } else if (lca && person.supplementary_monthly_premium != null) {
          toast(fr ? `Complémentaires de ${name} : ${formatPrice(person.supplementary_monthly_premium)}/mois au total sur la lettre — reportez-les ligne par ligne.` : `Supplementary total for ${name}: ${formatPrice(person.supplementary_monthly_premium)}/month.`, "success")
        }
        matched.push(basic?.policy.insured_label ?? name)
      }
      if (x.year != null && season && x.year !== season.season_year + 1) {
        toast(fr ? `Attention : la lettre porte sur ${x.year}.` : `Warning: the letter is for ${x.year}.`, "error")
      }
      setScanReport(
        (matched.length ? `${fr ? "Rempli" : "Filled"} : ${matched.join(", ")}` : "") +
        (unmatched.length ? ` · ${fr ? "non reconnu" : "not matched"} : ${unmatched.join(", ")}` : ""),
      )
    } catch (e) {
      toast(`${fr ? "Échec du scan" : "Scan failed"}: ${e}`, "error")
    } finally {
      setScanning(false)
    }
  }

  async function save() {
    if (!season) return
    setSaving(true)
    let count = 0
    try {
      for (const d of details) {
        const id = d.policy.engagement_id
        if (!dirty.has(id)) continue
        const draft = drafts[id]
        const base = {
          engagement_id: id,
          year: season.season_year + 1,
          received_on: receivedOn || null,
          decision: draft.decision,
          notes: d.policy.notice?.notes ?? null,
        }
        if (draft.kind === "basic") {
          // "Valider" records what the fields say: a new model, else a new
          // deductible, else the same terms.
          const p = d.overview.policy
          const decision: api.HealthDecision = !VALIDATED.includes(draft.decision) ? draft.decision
            : draft.model && draft.model !== (p?.model ?? "") ? "change_model"
            : numOrNull(draft.franchise) != null && numOrNull(draft.franchise) !== (p?.franchise ?? null) ? "change_franchise"
            : "keep"
          await api.saveHealthPremiumNotice({
            ...base,
            decision,
            monthly_premium: numOrNull(draft.premium),
            franchise: numOrNull(draft.franchise),
            model: draft.model || null,
            accident_covered: draft.accident,
            subsidy_monthly: numOrNull(draft.subsidy),
          })
        } else {
          const kept = draft.lines.filter((l) => l.name.trim() || l.monthly_premium > 0).map((l) => ({ ...l, name: l.name.trim() }))
          await api.saveHealthPremiumNotice({
            ...base,
            monthly_premium: kept.length ? linesTotal(kept) : null,
            franchise: null,
            model: null,
            accident_covered: null,
            supplementary_lines_json: kept.length ? JSON.stringify(kept) : null,
          })
        }
        count += 1
      }
      toast(fr ? `${count} police(s) enregistrée(s). Les échéances suivront au 1.1.${season.season_year + 1}.` : `${count} policy(ies) saved.`, "success")
      await load()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  async function openLetter(engagement: api.Engagement) {
    let creditor: api.Creditor | null = null
    try {
      creditor = (await api.getCreditors()).find((c) => c.id === engagement.creditor_id) ?? null
    } catch { /* the letter keeps a placeholder */ }
    setLetter({ engagement, creditor })
  }

  if (loading && !season) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }
  if (!season) return null

  const next = season.season_year + 1
  const avg = season.params.ofsp_average_change_pct
  const diff = totals.next - totals.now

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <CalendarClock className="h-7 w-7 text-primary" />
            {fr ? `Saison des primes ${season.season_year} → ${next}` : `Premium season ${season.season_year} → ${next}`}
          </h2>
          <p className="text-muted-foreground">
            {fr ? "Reportez ici les nouvelles conditions de votre caisse et ce que vous avez décidé, personne par personne." : "Enter your insurer's new terms and your decision, person by person."}
            {avg != null && <> {fr ? "Hausse moyenne annoncée par l'OFSP" : "FOPH average increase"} : <span className="font-medium text-foreground">{avg >= 0 ? "+" : ""}{avg.toFixed(1)} %</span>.</>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void scan(f); e.target.value = "" }} />
          <div className="space-y-1">
            <label className="text-xs font-medium">{fr ? "Lettre reçue le" : "Letter received on"}</label>
            <Input type="date" className="h-9" value={receivedOn} onChange={(e) => { setReceivedOn(e.target.value); setDirty(new Set(details.map((d) => d.policy.engagement_id))) }} />
          </div>
          <Link to="/documents-sante"><Button variant="outline"><FolderOpen className="mr-1 h-4 w-4" />Documents</Button></Link>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={scanning}>
            {scanning ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
            {fr ? "Scanner la lettre" : "Scan the letter"}
          </Button>
        </div>
      </div>
      {scanReport && <p className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400"><Check className="h-4 w-4" />{scanReport}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {season.events.map((e) => {
          const d = daysUntil(e.working_date)
          return (
            <div key={e.key} className={cn("rounded-lg border p-3", d < 0 && "opacity-50")}>
              <p className={cn("text-xs", d >= 0 && d <= 14 ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {formatDate(e.working_date)}{d >= 0 ? ` · J-${d}` : ` · ${fr ? "passé" : "passed"}`}
              </p>
              <p className="text-sm font-medium">{e.title}</p>
              {e.send_by && d >= 0 && <p className="text-xs text-muted-foreground">{fr ? "Recommandé avant le" : "Post by"} {formatDate(e.send_by)}</p>}
            </div>
          )
        })}
      </div>

      {details.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">{fr ? "Aucune assurance maladie active." : "No active health insurance."}</CardContent></Card>
      ) : people.map(({ name, ds }) => {
        const t = sum(ds)
        const hasLca = ds.some((d) => isLca(d))
        return (
        <section key={name} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="flex items-center gap-2 text-lg font-semibold"><HeartPulse className="h-5 w-5 text-primary" />{name}</h3>
            <p className="text-sm">
              <span className="text-muted-foreground">{hasLca ? "LAMal + LCA" : "LAMal"} : </span>
              {formatPrice(t.now)} → <span className="font-semibold">{formatPrice(t.next)}</span> / {fr ? "mois" : "month"}{" "}
              <Change now={t.now} next={t.next} className="text-sm" />
            </p>
          </div>
          {ds.map((d) => {
            const draft = drafts[d.policy.engagement_id]
            if (!draft) return null
            return draft.kind === "basic"
              ? <BasicCard key={d.policy.engagement_id} d={d} draft={draft} next={next} fr={fr} avg={avg}
                  onChange={(patch) => update(d.policy.engagement_id, patch)}
                  onSwitch={() => setSwitching(d)} onLetter={() => void openLetter(d.engagement)} />
              : <LcaCard key={d.policy.engagement_id} d={d} draft={draft} next={next} fr={fr}
                  onChange={(patch) => update(d.policy.engagement_id, patch)} onLetter={() => void openLetter(d.engagement)} />
          })}
        </section>
        )
      })}

      <div className="sticky bottom-0 z-30 rounded-lg border bg-background/95 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm">
            {fr ? "Ménage par mois" : "Household per month"} : {formatPrice(totals.now)} → <span className="font-semibold">{formatPrice(totals.next)}</span>
            <span className={cn("ml-2", diff > 0 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400")}>
              {diff >= 0 ? "+" : ""}{formatPrice(diff)}
            </span>
          </p>
          <div className="flex items-center gap-2">
            {dirty.size > 0 && <span className="text-xs text-muted-foreground">{dirty.size} {fr ? "police(s) modifiée(s)" : "policy(ies) changed"}</span>}
            <Button onClick={save} disabled={saving || dirty.size === 0}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{fr ? `Enregistrer les conditions ${next}` : `Save ${next} terms`}
            </Button>
          </div>
        </div>
      </div>

      {switching && (
        <SwitchInsurerDialog engagement={switching.engagement} overview={switching.overview} year={next} fr={fr} toast={toast}
          onClose={() => setSwitching(null)}
          onDone={() => { setSwitching(null); void load() }} />
      )}
      {letter && <CancellationLetterModal engagement={letter.engagement} creditor={letter.creditor} onClose={() => setLetter(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assurance de base : cette année à gauche, l'an prochain à droite
// ---------------------------------------------------------------------------

function BasicCard({ d, draft, next, fr, avg, onChange, onSwitch, onLetter }: {
  d: Detail; draft: BasicDraft; next: number; fr: boolean; avg: number | null
  onChange: (patch: Partial<BasicDraft>) => void; onSwitch: () => void; onLetter: () => void
}) {
  const p = d.overview.policy
  const gross = d.policy.monthly_gross
  const subsidyNow = p?.subsidy_monthly ?? 0
  const netNow = gross != null ? gross - subsidyNow : null
  const premium = numOrNull(draft.premium)
  const netNext = premium != null ? Math.max(0, premium - num(draft.subsidy)) : null
  const change = premium != null && gross ? (premium - gross) / gross * 100 : null
  const ageChange = d.overview.findings.find((f) => f.id === "age_class_change")
  const switched = !!d.engagement.ended_on
  const fieldCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm"

  const row = (label: string, now: React.ReactNode, input: React.ReactNode) => (
    <div className="grid grid-cols-[9rem_1fr_1fr] items-center gap-3 border-t py-2 text-sm first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span>{now}</span>
      <div>{input}</div>
    </div>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0 pb-2">
        <Badge variant="secondary">LAMal</Badge>
        <CardTitle className="text-base"><Link to={`/engagements/${d.engagement.id}?tab=health`} className="hover:underline">{d.policy.creditor_name ?? d.policy.name}</Link></CardTitle>
        {switched && <Badge variant="outline">{fr ? `Quittée au ${formatDate(d.engagement.ended_on as string)}` : `Left on ${formatDate(d.engagement.ended_on as string)}`}</Badge>}
        {d.policy.notice && <Badge variant="success" className="ml-auto">{fr ? "Enregistré" : "Saved"}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {ageChange && (
          <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{ageChange.message}
          </p>
        )}
        <div className="grid grid-cols-[9rem_1fr_1fr] gap-3 text-xs font-medium text-muted-foreground">
          <span />
          <span>{fr ? `${d.overview.season_year} (actuel)` : `${d.overview.season_year} (current)`}</span>
          <span>{fr ? `${next} (nouveau)` : `${next} (new)`}</span>
        </div>
        <div>
          {row(fr ? "Prime mensuelle" : "Monthly premium", gross != null ? formatPrice(gross) : "—",
            <div className="flex items-center gap-2">
              <Input type="number" min="0" step="0.05" className="h-9" value={draft.premium} placeholder={fr ? "selon la lettre" : "from the letter"}
                onChange={(e) => onChange({ premium: e.target.value })} />
              {change != null && (
                <span className={cn("whitespace-nowrap text-xs", avg != null && change > avg + 1 && !ageChange ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                  {change >= 0 ? "+" : ""}{change.toFixed(1)} %
                </span>
              )}
            </div>)}
          {row(fr ? "Subside" : "Subsidy", subsidyNow ? `− ${formatPrice(subsidyNow)}` : "—",
            <Input type="number" min="0" step="0.05" className="h-9" value={draft.subsidy} onChange={(e) => onChange({ subsidy: e.target.value })} />)}
          {row("Franchise", p?.franchise != null ? formatPrice(p.franchise) : "—",
            <select className={fieldCls} value={draft.franchise} onChange={(e) => onChange({ franchise: e.target.value })}>
              <option value="">—</option>
              {d.policy.next_year_franchises.map((f) => <option key={f} value={f}>{f.toLocaleString("fr-CH")} CHF</option>)}
            </select>)}
          {row(fr ? "Modèle" : "Model", healthModelLabel(p?.model, fr),
            <select className={fieldCls} value={draft.model} onChange={(e) => onChange({ model: e.target.value as api.HealthModel | "" })}>
              <option value="">—</option>
              {HEALTH_MODELS.map((m) => <option key={m} value={m}>{healthModelLabel(m, fr)}</option>)}
            </select>)}
          {row(fr ? "Accidents" : "Accidents", p?.accident_covered == null ? "—" : p.accident_covered ? (fr ? "Inclus" : "Included") : (fr ? "Suspendus" : "Suspended"),
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.accident} onChange={(e) => onChange({ accident: e.target.checked })} />{fr ? "Inclus" : "Included"}</label>)}
          {row(fr ? "À payer / mois" : "To pay / month", <span className="font-medium">{netNow != null ? formatPrice(netNow) : "—"}</span>,
            <span className="font-semibold">{netNext != null ? formatPrice(netNext) : "—"}</span>)}
        </div>
        {d.overview.age_class && (
          <p className="text-xs text-muted-foreground">{fr ? "Classe d'âge actuelle" : "Current age class"} : {ageClassLabel(d.overview.age_class, fr)}</p>
        )}
        <Decisions fr={fr} value={draft.decision} onChange={(decision) => onChange({ decision })} />
        {draft.decision === "switch_insurer" && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm">
            <Info className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">
              {switched
                ? (fr ? "Nouvelle police créée. Envoyez la lettre à l'ancienne caisse et attendez la confirmation d'affiliation." : "New policy created.")
                : (fr ? "Résiliation reçue au plus tard le 30 novembre, et inscription chez la nouvelle caisse." : "Cancellation received by 30 November, and sign up with the new insurer.")}
            </span>
            <Button size="sm" variant="outline" onClick={onLetter}><FileText className="mr-1 h-4 w-4" />{fr ? "Lettre" : "Letter"}</Button>
            {!switched && <Button size="sm" onClick={onSwitch}><ArrowRightLeft className="mr-1 h-4 w-4" />{fr ? "Nouvelle caisse" : "New insurer"}</Button>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Complémentaires : produit par produit
// ---------------------------------------------------------------------------

function LcaCard({ d, draft, next, fr, onChange, onLetter }: {
  d: Detail; draft: LcaDraft; next: number; fr: boolean
  onChange: (patch: Partial<LcaDraft>) => void; onLetter: () => void
}) {
  const nowLines = parseLines(d.overview.policy?.supplementary_lines_json)
  const nowTotal = nowLines.length ? linesTotal(nowLines) : (d.policy.monthly_gross ?? 0)
  const nextTotal = linesTotal(draft.lines)
  const deadline = getCancellationInfo(d.engagement)
  const setLine = (i: number, patch: Partial<SupplementaryLine>) =>
    onChange({ lines: draft.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })
  const nowFor = (name: string) => nowLines.find((l) => norm(l.name) === norm(name))

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0 pb-2">
        <Badge variant="secondary">LCA</Badge>
        <CardTitle className="text-base"><Link to={`/engagements/${d.engagement.id}?tab=health`} className="hover:underline">{d.policy.creditor_name ?? d.policy.name}</Link></CardTitle>
        {d.engagement.billed_with_parent && <Badge variant="outline">{fr ? "même facture que la LAMal" : "same bill as LAMal"}</Badge>}
        {d.policy.notice && <Badge variant="success" className="ml-auto">{fr ? "Enregistré" : "Saved"}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="hidden gap-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_6rem_7rem_9rem_7.5rem_2.25rem]">
          <span>{fr ? "Complémentaire" : "Cover"}</span>
          <span className="text-right">{fr ? `Net ${d.overview.season_year}` : `${d.overview.season_year} net`}</span>
          <span>{fr ? `Prime ${next}` : `${next} premium`}</span>
          <span>{fr ? "Rabais" : "Discount"}</span>
          <span className="text-right">{fr ? `Net ${next}` : `${next} net`}</span>
          <span />
        </div>
        {draft.lines.map((l, i) => {
          const before = nowFor(l.name)
          return (
            <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-[1fr_6rem_7rem_9rem_7.5rem_2.25rem] sm:bg-transparent sm:p-0">
              <Input className="col-span-2 h-9 sm:col-span-1" value={l.name} placeholder={fr ? "Nom sur la police" : "Name on the policy"}
                onChange={(e) => setLine(i, { name: e.target.value })} />
              <span className="text-right text-sm text-muted-foreground">{before ? formatPrice(lineNet(before)) : (fr ? "nouvelle" : "new")}</span>
              <Input type="number" min="0" step="0.05" className="h-9" value={l.monthly_premium || ""}
                onChange={(e) => setLine(i, { monthly_premium: num(e.target.value) })} />
              <div className="flex gap-1">
                <Input type="number" min="0" step="0.05" className="h-9" value={l.discount_value || ""}
                  onChange={(e) => setLine(i, { discount_value: num(e.target.value) })} placeholder="0" />
                <select className="h-9 rounded-md border border-input bg-background px-1 text-sm" value={l.discount_kind}
                  onChange={(e) => setLine(i, { discount_kind: e.target.value as "pct" | "chf" })}>
                  <option value="pct">%</option>
                  <option value="chf">CHF</option>
                </select>
              </div>
              <span className="text-right text-sm font-medium">
                {formatPrice(lineNet(l))}
                {before && <span className="block text-xs font-normal"><Change now={lineNet(before)} next={lineNet(l)} /></span>}
                {lineDiscount(l) > 0 && <span className="block whitespace-nowrap text-xs font-normal text-muted-foreground">{fr ? "rabais" : "discount"} − {formatPrice(lineDiscount(l))}</span>}
              </span>
              <Button variant="ghost" size="icon" onClick={() => onChange({ lines: draft.lines.filter((_, j) => j !== i) })}
                aria-label={fr ? "Retirer ce produit" : "Remove this product"}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          )
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="outline" onClick={() => onChange({ lines: [...draft.lines, { name: "", monthly_premium: 0, discount_kind: "pct", discount_value: 0 }] })}>
            <Plus className="mr-1 h-4 w-4" />{fr ? "Ajouter un produit" : "Add a product"}
          </Button>
          <span className="text-sm">
            {fr ? "Total LCA" : "LCA total"} : {formatPrice(nowTotal)} → <span className="font-semibold">{formatPrice(nextTotal)}</span> / {fr ? "mois" : "month"}{" "}
            <Change now={nowTotal} next={nextTotal} className="text-sm" />
          </span>
        </div>
        <Decisions fr={fr} value={draft.decision} onChange={(decision) => onChange({ decision })} lca />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-4 w-4" />
          <span className="flex-1">
            {deadline
              ? <>{fr ? "Dernier jour pour résilier selon la police : " : "Last day to cancel: "}
                  <span className={cn("font-medium", deadline.severity !== "upcoming" ? "text-destructive" : "text-foreground")}>{formatDate(deadline.deadlineISO)}</span>
                  {" "}({deadline.noticeDays} {fr ? "j de préavis" : "days notice"}). </>
              : null}
            {fr ? "Ne résiliez une complémentaire qu'après l'acceptation écrite d'un autre assureur." : "Only cancel after written acceptance elsewhere."}
          </span>
          {draft.decision === "switch_insurer" && (
            <Button size="sm" variant="outline" onClick={onLetter}><FileText className="mr-1 h-4 w-4" />{fr ? "Lettre" : "Letter"}</Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Decisions({ fr, value, onChange, lca = false }: {
  fr: boolean; value: api.HealthDecision; onChange: (d: api.HealthDecision) => void; lca?: boolean
}) {
  const validated = VALIDATED.includes(value)
  const leaving = value === "switch_insurer"
  // Clicking the active choice again undoes it.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={validated ? "default" : "outline"}
        className={cn(validated && "bg-green-600 text-white hover:bg-green-600/90")}
        onClick={() => onChange(validated ? "pending" : "keep")}>
        <Check className="mr-1 h-4 w-4" />{validated ? (fr ? "Validé" : "Validated") : (fr ? "Valider" : "Validate")}
      </Button>
      <Button type="button" size="sm" variant={leaving ? "destructive" : "outline"}
        onClick={() => onChange(leaving ? "pending" : "switch_insurer")}>
        {lca ? (fr ? "Je résilie" : "I cancel") : (fr ? "Je change de caisse" : "I switch insurer")}
      </Button>
    </div>
  )
}

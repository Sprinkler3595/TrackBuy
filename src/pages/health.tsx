import { useCallback, useContext, useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Eye, FileText, FolderOpen, HeartPulse, Info, LayoutGrid,
  Loader2, Plus, Receipt, Scale, Sparkles, Stethoscope, Undo2, X, XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { I18nContext } from "@/lib/i18n"
import { AttachmentViewer } from "@/components/features/attachment-viewer"
import { FranchiseComparator, ParticipationCard } from "@/components/features/health-insurance-panel"
import { HealthInsuranceWizard } from "@/components/features/health-insurance-wizard"
import { ClaimsReview } from "@/components/features/health-claims-review"
import { draftsFromExtraction, emptyClaimDraft, saveClaimDrafts, type ClaimDraft } from "@/lib/health-claims"
import { HealthSeasonPage } from "@/pages/health-season"
import { HealthDocumentsPage } from "@/pages/health-documents"
import { getAiSettings } from "@/lib/ai-settings"
import { docAttachmentType, filedDocumentText, noticesToCarry, statementsToEnter } from "@/lib/health-docs"
import { ageClassLabel, healthModelLabel, lineNet, linesTotal, parseLines } from "@/lib/health"
import { formatDate, formatPrice, daysUntil, cn } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// The health module: everything that touches the household's health, in
/// one place.
///
/// - Aperçu: what each person is insured for and pays, what is left of the
///   deductible, and the list of things to do (decisions of the premium
///   season, statements to enter, checks that failed, refunds awaited).
/// - Frais médicaux: the year's statements per person; a statement already
///   filed in the documents is read again and its lines proposed.
/// - Primes: the premium-season module, while it is open.
/// - Documents: the household's insurance mail, filed by year and person.
/// - Franchise: which deductible would have been cheaper.
///
/// The pages below are the same components as elsewhere in the app; this
/// module only gathers them and the household-level figures.

type Tab = "apercu" | "frais" | "primes" | "documents" | "franchise"

type Policy = {
  season: api.HealthSeasonPolicy
  overview: api.HealthOverview
  engagement: api.Engagement
}

const isBasic = (p: Policy) => (p.overview.policy?.kind ?? p.season.kind ?? (p.engagement.parent_engagement_id ? "supplementary" : "basic")) === "basic"

/// What a policy costs per month today: premium minus subsidy for the basic
/// cover, the products' net total for a supplementary one.
function monthlyNet(p: Policy): number {
  if (!isBasic(p)) {
    const lines = parseLines(p.overview.policy?.supplementary_lines_json)
    return lines.length > 0 ? linesTotal(lines) : p.season.monthly_gross ?? p.engagement.current_amount ?? 0
  }
  return Math.max(0, (p.overview.monthly_gross ?? 0) - (p.overview.policy?.subsidy_monthly ?? 0))
}

const outOfPocket = (c: api.HealthClaim) => c.franchise + c.quote_part + c.hospital + c.not_covered

export function HealthPage() {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()
  const [params, setParams] = useSearchParams()
  const tab = (params.get("tab") as Tab | null) ?? "apercu"
  const setTab = (t: Tab) => setParams(t === "apercu" ? {} : { tab: t })
  const year = new Date().getFullYear()

  const [season, setSeason] = useState<api.HealthSeason | null>(null)
  const [policies, setPolicies] = useState<Policy[]>([])
  const [docs, setDocs] = useState<api.HealthDocument[]>([])
  const [claims, setClaims] = useState<api.HealthClaim[]>([])
  const [refunds, setRefunds] = useState<api.PendingReimbursement[]>([])
  const [healthParams, setHealthParams] = useState<api.HealthParams | null>(null)
  const [loading, setLoading] = useState(true)
  const [wizard, setWizard] = useState<{ creditors: api.Creditor[]; cards: api.PaymentCard[] } | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await api.getHealthSeason()
      const ps = await Promise.all(s.policies.map(async (p) => {
        const [overview, engagement] = await Promise.all([api.getHealthOverview(p.engagement_id), api.getEngagement(p.engagement_id)])
        return { season: p, overview, engagement }
      }))
      const basics = ps.filter(isBasic)
      const [d, cl, r, hp] = await Promise.all([
        api.listHealthDocuments().catch(() => []),
        Promise.all(basics.map((p) => api.listHealthClaims(p.engagement.id, year).catch(() => []))).then((x) => x.flat()),
        api.listPendingReimbursements().catch(() => []),
        api.getHealthParams(year).then((x) => x.params).catch(() => null),
      ])
      setSeason(s)
      setPolicies(ps)
      setDocs(d)
      setClaims(cl)
      setRefunds(r.filter((x) => x.reimbursement_type === "insurance_claim" && ["pending", "claimed", "partial"].includes(x.status)))
      setHealthParams(hp)
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setLoading(false)
    }
  }, [toast, year])
  useEffect(() => { void load() }, [load])

  async function openWizard() {
    try {
      const [creditors, cards] = await Promise.all([api.getCreditors(), api.getCards()])
      setWizard({ creditors, cards })
    } catch (e) {
      toast(String(e), "error")
    }
  }

  // People in order, the basic cover first.
  const people = useMemo(() => {
    const groups = new Map<string, Policy[]>()
    for (const p of policies) {
      const key = p.overview.insured_label ?? p.season.insured_label ?? p.engagement.name
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    return [...groups.entries()].map(([name, ps]) => ({ name, ps: ps.sort((a, b) => Number(!isBasic(a)) - Number(!isBasic(b))) }))
  }, [policies])

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }

  const tabs: { key: Tab; label: string; icon: typeof HeartPulse; badge?: number }[] = [
    { key: "apercu", label: fr ? "Aperçu" : "Overview", icon: LayoutGrid },
    { key: "frais", label: fr ? "Frais médicaux" : "Medical costs", icon: Stethoscope, badge: statementsToEnter(docs).length },
    ...(season?.open ? [{
      key: "primes" as Tab,
      label: fr ? `Primes ${season.season_year + 1}` : `${season.season_year + 1} premiums`,
      icon: CalendarClock,
      badge: season.policies.filter((p) => !p.notice || p.notice.decision === "pending").length,
    }] : []),
    { key: "documents", label: "Documents", icon: FolderOpen },
    { key: "franchise", label: "Franchise", icon: Scale },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight"><HeartPulse className="h-7 w-7 text-primary" />{fr ? "Santé" : "Health"}</h2>
          <p className="text-muted-foreground">
            {fr ? "Assurances maladie, frais médicaux, primes et documents du ménage." : "The household's health insurance, medical costs, premiums and documents."}
          </p>
        </div>
        <Button variant="outline" onClick={() => void openWizard()}><Plus className="mr-1 h-4 w-4" />{fr ? "Ajouter une assurance maladie" : "Add health insurance"}</Button>
      </div>

      {policies.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-muted-foreground">
              {fr
                ? "Aucune assurance maladie pour l'instant. Ajoutez celle de chaque personne du ménage (LAMal et complémentaires) : primes, franchise, échéances et documents suivront ici."
                : "No health insurance yet. Add each household member's cover to follow premiums, deductible, charges and documents here."}
            </p>
            <Button onClick={() => void openWizard()}><Plus className="mr-1 h-4 w-4" />{fr ? "Ajouter une assurance maladie" : "Add health insurance"}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 border-b">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cn("-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                <t.icon className="h-4 w-4" />{t.label}
                {!!t.badge && <span className="rounded-full bg-amber-500/15 px-2 text-xs text-amber-700 dark:text-amber-400">{t.badge}</span>}
              </button>
            ))}
          </div>

          {tab === "apercu" && season && (
            <Overview fr={fr} year={year} season={season} people={people} docs={docs} claims={claims} refunds={refunds} setTab={setTab} />
          )}
          {tab === "frais" && (
            <Costs fr={fr} year={year} people={people} docs={docs} params={healthParams} toast={toast} onChanged={load}
              docToEnter={params.get("doc")} clearDoc={() => setParams({ tab: "frais" })} />
          )}
          {tab === "primes" && (season?.open
            ? <HealthSeasonPage embedded />
            : <Card><CardContent className="p-6 text-sm text-muted-foreground">
                {fr ? "La saison des primes s'ouvre à la publication des nouvelles primes, fin septembre." : "The premium season opens when the new premiums are published, late September."}
              </CardContent></Card>)}
          {tab === "documents" && <HealthDocumentsPage embedded seasonOpen={!!season?.open} />}
          {tab === "franchise" && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                {fr
                  ? "Pour chaque personne : la franchise qui coûte le moins, primes et participation comprises, selon vos frais médicaux probables."
                  : "For each person: the deductible that costs least, premiums and cost sharing included."}
              </p>
              {people.map(({ name, ps }) => ps.filter(isBasic).map((p) => (
                <section key={p.engagement.id} className="space-y-2">
                  <h3 className="flex items-center gap-2 text-lg font-semibold"><HeartPulse className="h-5 w-5 text-primary" />{name}</h3>
                  <FranchiseComparator overview={p.overview} fr={fr} />
                </section>
              )))}
            </div>
          )}
        </>
      )}

      {wizard && (
        <HealthInsuranceWizard creditors={wizard.creditors} cards={wizard.cards} onClose={() => { setWizard(null); void load() }} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aperçu
// ---------------------------------------------------------------------------

type Person = { name: string; ps: Policy[] }

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function Bar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 100
  return (
    <div className="h-1.5 w-full rounded-full bg-muted">
      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Overview({ fr, year, season, people, docs, claims, refunds, setTab }: {
  fr: boolean; year: number; season: api.HealthSeason; people: Person[]; docs: api.HealthDocument[]
  claims: api.HealthClaim[]; refunds: api.PendingReimbursement[]; setTab: (t: Tab) => void
}) {
  const all = people.flatMap((p) => p.ps)
  const monthly = all.reduce((s, p) => s + monthlyNet(p), 0)
  const paidShare = claims.reduce((s, c) => s + outOfPocket(c), 0)
  const awaited = refunds.reduce((s, r) => s + (r.expected_amount ?? 0) - (r.received_amount ?? 0), 0)
  const toEnter = statementsToEnter(docs)
  const next = season.season_year + 1
  const toCarry = season.open ? noticesToCarry(docs, next) : []
  const unfiled = docs.filter((d) => !d.filed).length
  const pending = season.policies.filter((p) => !p.notice || p.notice.decision === "pending").length
  const switchEvent = season.events.find((e) => e.key === "switch_insurer")
  const taxCert = docs.some((d) => d.kind === "tax_certificate" && d.year === year - 1)

  type Todo = { key: string; severity: "error" | "warn" | "info"; text: string; action?: { label: string; onClick?: () => void; to?: string } }
  const todos: Todo[] = []
  if (season.open && pending > 0) {
    const days = switchEvent ? daysUntil(switchEvent.working_date) : null
    todos.push({
      key: "season", severity: days != null && days <= 14 ? "error" : "warn",
      text: fr
        ? `Primes ${next} : ${pending} police(s) sans décision${switchEvent && days != null && days >= 0 ? ` — changement de caisse possible jusqu'au ${formatDate(switchEvent.working_date)} (J-${days})` : ""}.`
        : `${next} premiums: ${pending} policy(ies) undecided.`,
      action: { label: fr ? "Ouvrir" : "Open", onClick: () => setTab("primes") },
    })
  }
  if (toCarry.length > 0) {
    todos.push({ key: "carry", severity: "info", text: fr ? `${toCarry.length} avis de prime ${next} classé(s) à reporter dans la saison.` : `${toCarry.length} filed notice(s) to carry over.`, action: { label: fr ? "Pré-remplir" : "Pre-fill", onClick: () => setTab("primes") } })
  }
  if (toEnter.length > 0) {
    todos.push({ key: "claims", severity: "info", text: fr ? `${toEnter.length} décompte(s) classé(s) dont les frais ne sont pas encore saisis.` : `${toEnter.length} filed statement(s) to enter.`, action: { label: fr ? "Saisir" : "Enter", onClick: () => setTab("frais") } })
  }
  if (unfiled > 0) {
    todos.push({ key: "unfiled", severity: "info", text: fr ? `${unfiled} pièce(s) jointe(s) d'assurance maladie pas encore classée(s).` : `${unfiled} attachment(s) not filed yet.`, action: { label: fr ? "Classer" : "File", onClick: () => setTab("documents") } })
  }
  if (refunds.length > 0) {
    todos.push({ key: "refunds", severity: "info", text: fr ? `${refunds.length} remboursement(s) de la caisse attendu(s) : ${formatPrice(awaited)}.` : `${refunds.length} refund(s) awaited.`, action: { label: fr ? "Voir" : "View", to: "/reimbursements" } })
  }
  if (!taxCert && new Date().getMonth() < 5) {
    todos.push({ key: "tax", severity: "info", text: fr ? `Attestation fiscale ${year - 1} de la caisse pas encore classée (déclaration d'impôt).` : `${year - 1} tax certificate not filed yet.`, action: { label: fr ? "Documents" : "Documents", onClick: () => setTab("documents") } })
  }
  for (const { name, ps } of people) {
    for (const p of ps) {
      for (const f of p.overview.findings.filter((x) => x.severity !== "info")) {
        todos.push({ key: `${p.engagement.id}-${f.id}`, severity: f.severity === "error" ? "error" : "warn", text: `${name} — ${f.message}`, action: { label: fr ? "Police" : "Policy", to: `/engagements/${p.engagement.id}?tab=health` } })
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={fr ? "Primes du ménage / mois" : "Household premiums / month"} value={formatPrice(monthly)} hint={fr ? `${formatPrice(monthly * 12)} par an, subsides déduits` : `${formatPrice(monthly * 12)} per year`} />
        <Stat label={fr ? `Franchises et quote-parts ${year}` : `${year} cost sharing`} value={formatPrice(paidShare)} hint={fr ? `${claims.length} ligne(s) de décompte` : `${claims.length} statement line(s)`} />
        <Stat label={fr ? "Remboursements attendus" : "Refunds awaited"} value={formatPrice(awaited)} hint={fr ? "tiers garant" : "tiers garant"} />
        <Stat label={fr ? "Coût santé estimé de l'année" : "Estimated yearly health cost"} value={formatPrice(monthly * 12 + paidShare)} hint={fr ? "primes + participation : pour la déclaration d'impôt" : "premiums + cost sharing"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">{fr ? "À faire" : "To do"}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {todos.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />{fr ? "Tout est à jour." : "All up to date."}</p>
          ) : todos.map((t) => (
            <div key={t.key} className="flex items-center gap-3 rounded-md border p-2 text-sm">
              {t.severity === "error" ? <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                : t.severity === "warn" ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                : <Info className="h-4 w-4 shrink-0 text-primary" />}
              <span className="flex-1">{t.text}</span>
              {t.action && (t.action.to
                ? <Link to={t.action.to}><Button size="sm" variant="outline">{t.action.label}<ChevronRight className="ml-1 h-4 w-4" /></Button></Link>
                : <Button size="sm" variant="outline" onClick={t.action.onClick}>{t.action.label}<ChevronRight className="ml-1 h-4 w-4" /></Button>)}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {people.map(({ name, ps }) => {
          const basic = ps.find(isBasic)
          const s = basic?.overview.participation
          const total = ps.reduce((sum, p) => sum + monthlyNet(p), 0)
          return (
            <Card key={name}>
              <CardHeader className="flex flex-row items-baseline justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-base"><HeartPulse className="h-4 w-4 text-primary" />{name}</CardTitle>
                <span className="text-sm"><span className="font-semibold">{formatPrice(total)}</span> / {fr ? "mois" : "month"}</span>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {basic?.overview.age_class && <p className="text-xs text-muted-foreground">{ageClassLabel(basic.overview.age_class, fr)}{basic.overview.birth_year ? ` · ${basic.overview.birth_year}` : ""}</p>}
                {ps.map((p) => (
                  <Link key={p.engagement.id} to={`/engagements/${p.engagement.id}?tab=health`} className="flex items-start justify-between gap-2 rounded-md border p-2 hover:bg-accent/40">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {isBasic(p) ? "LAMal" : "LCA"} · {p.season.creditor_name ?? p.engagement.name}
                        {p.engagement.status !== "active" && <Badge variant="outline" className="ml-2">{fr ? "terminée" : "ended"}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {isBasic(p)
                          ? `${healthModelLabel(p.overview.policy?.model ?? null, fr)}${p.overview.policy?.franchise != null ? ` · franchise ${p.overview.policy.franchise.toLocaleString("fr-CH")}` : ""}${p.overview.policy?.subsidy_monthly ? ` · ${fr ? "subside" : "subsidy"} ${formatPrice(p.overview.policy.subsidy_monthly)}` : ""}`
                          : parseLines(p.overview.policy?.supplementary_lines_json).map((l) => `${l.name} ${formatPrice(lineNet(l))}`).join(" · ") || "—"}
                      </p>
                    </div>
                    <span className="shrink-0">{formatPrice(monthlyNet(p))}</span>
                  </Link>
                ))}
                {s && (
                  <div className="space-y-2">
                    <div>
                      <div className="flex justify-between text-xs"><span>Franchise {year}</span><span>{formatPrice(s.franchise_used)} / {formatPrice(s.franchise)}</span></div>
                      <Bar used={s.franchise_used} total={s.franchise} />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs"><span>{fr ? "Quote-part" : "Co-payment"}</span><span>{formatPrice(s.quote_part_used)} / {formatPrice(s.quote_part_cap)}</span></div>
                      <Bar used={s.quote_part_used} total={s.quote_part_cap} />
                    </div>
                    <p className="text-xs text-muted-foreground">{fr ? "Reste au plus à charge cette année" : "At most left this year"} : <span className="font-medium text-foreground">{formatPrice(s.max_remaining)}</span></p>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Frais médicaux
// ---------------------------------------------------------------------------

type Toast = ReturnType<typeof useToast>["toast"]

function Costs({ fr, year, people, docs, params, toast, onChanged, docToEnter, clearDoc }: {
  fr: boolean; year: number; people: Person[]; docs: api.HealthDocument[]; params: api.HealthParams | null
  toast: Toast; onChanged: () => Promise<void>; docToEnter: string | null; clearDoc: () => void
}) {
  const basics = people.flatMap(({ name, ps }) => ps.filter(isBasic).map((p) => ({ name, p })))
  const toEnter = statementsToEnter(docs)
  const [entry, setEntry] = useState<{ doc: api.HealthDocument; reading: boolean; drafts: ClaimDraft[]; mode: api.HealthBillingMode | ""; policyId: string; note: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [viewing, setViewing] = useState<api.Attachment | null>(null)

  async function start(doc: api.HealthDocument) {
    // The person: the statement's own basic policy, else the first one.
    const guess = doc.engagement_ids.find((id) => basics.some((b) => b.p.engagement.id === id)) ?? basics[0]?.p.engagement.id ?? ""
    setEntry({ doc, reading: true, drafts: [], mode: "", policyId: guess, note: null })
    const ai = getAiSettings()
    if (!ai.enabled) {
      setEntry({ doc, reading: false, drafts: [emptyClaimDraft()], mode: "", policyId: guess, note: fr ? "IA désactivée (Réglages → IA) : reportez les lignes à la main en regardant le document." : "AI disabled: enter the lines by hand." })
      return
    }
    try {
      const text = await filedDocumentText(doc)
      if (!text.trim()) throw new Error(fr ? "texte illisible" : "unreadable text")
      const x = await api.aiExtractHealthClaims(text, ai)
      const first = (x.insured_name ?? "").toLowerCase().split(/\s+/)[0]
      const byName = first.length > 1 ? basics.find((b) => b.name.toLowerCase().split(/\s+/)[0] === first)?.p.engagement.id : undefined
      setEntry({
        doc, reading: false,
        drafts: x.lines.length > 0 ? draftsFromExtraction(x) : [emptyClaimDraft()],
        mode: x.billing_mode ?? "", policyId: byName ?? guess,
        note: x.lines.length === 0 ? (fr ? "Aucune ligne de traitement reconnue : saisissez-les à la main." : "No line recognised.") : null,
      })
    } catch (e) {
      setEntry({ doc, reading: false, drafts: [emptyClaimDraft()], mode: "", policyId: guess, note: `${fr ? "Lecture impossible" : "Reading failed"} : ${e}` })
    }
  }

  // Arriving from the documents ("Saisir les frais"): open that statement.
  useEffect(() => {
    if (!docToEnter) return
    const d = docs.find((x) => x.attachment_id === docToEnter)
    clearDoc()
    if (d) void start(d)
  }, [docToEnter]) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!entry) return
    setSaving(true)
    try {
      toast(await saveClaimDrafts(entry.policyId, entry.doc.year || year, entry.drafts, entry.mode, fr), "success")
      await api.markHealthDocumentProcessed(entry.doc.attachment_id, "benefit_statement", entry.doc.year)
      setEntry(null)
      await onChanged()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  async function dismiss(doc: api.HealthDocument) {
    try {
      await api.markHealthDocumentProcessed(doc.attachment_id, "benefit_statement", doc.year)
      await onChanged()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const view = (d: api.HealthDocument) => setViewing({
    id: d.attachment_id, item_id: null, order_id: null, engagement_id: d.engagement_ids[0] ?? null, engagement_charge_id: null,
    engagement_revision_id: null, vehicle_expense_id: null, income_id: null, income_receipt_id: null, reimbursement_id: null,
    original_name: d.display_name, display_name: d.display_name, mime_type: d.mime_type, file_path: "",
    size_bytes: d.size_bytes, attachment_type: docAttachmentType(d.kind), created_at: d.created_at,
  })

  return (
    <div className="space-y-6">
      {toEnter.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Receipt className="h-5 w-5 text-primary" />{fr ? "Décomptes classés à saisir" : "Filed statements to enter"}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {toEnter.map((d) => (
              <div key={d.attachment_id} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{d.display_name}</span>
                <Button size="sm" variant="ghost" onClick={() => view(d)}><Eye className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" title={fr ? "Déjà saisi" : "Already entered"} onClick={() => void dismiss(d)}><X className="h-4 w-4" /></Button>
                <Button size="sm" onClick={() => void start(d)}><Sparkles className="mr-1 h-4 w-4" />{fr ? "Saisir les frais" : "Enter claims"}</Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              {fr ? "Le décompte est relu et ses lignes proposées ; rien n'est enregistré avant votre vérification. La croix le retire de la liste s'il est déjà saisi." : "The statement is read again and its lines proposed; nothing is saved before you check."}
            </p>
          </CardContent>
        </Card>
      )}

      {basics.map(({ name, p }) => (
        <section key={p.engagement.id} className="space-y-2">
          <h3 className="flex items-center gap-2 text-lg font-semibold"><HeartPulse className="h-5 w-5 text-primary" />{name}</h3>
          <ParticipationCard engagement={p.engagement} overview={p.overview} params={params} fr={fr} onSaved={onChanged} toast={toast} />
        </section>
      ))}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Undo2 className="h-4 w-4" />
        {fr ? "Les décomptes en tiers garant créent un remboursement attendu, suivi dans " : "Tiers garant statements create an expected refund, tracked in "}
        <Link to="/reimbursements" className="text-primary underline">{fr ? "Remboursements" : "Reimbursements"}</Link>.
      </p>

      {entry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
            <div className="flex items-start justify-between gap-4 border-b p-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{fr ? "Saisir les frais du décompte" : "Enter the statement's claims"}</h2>
                <p className="truncate text-sm text-muted-foreground">{entry.doc.display_name}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => view(entry.doc)}><Eye className="mr-1 h-4 w-4" />{fr ? "Voir" : "View"}</Button>
                <Button variant="ghost" size="sm" onClick={() => setEntry(null)}><X className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {entry.reading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{fr ? "Lecture du décompte…" : "Reading the statement…"}</p>
              ) : (
                <>
                  {entry.note && <p className="text-sm text-amber-700 dark:text-amber-400">{entry.note}</p>}
                  <ClaimsReview fr={fr} drafts={entry.drafts} setDrafts={(drafts) => setEntry({ ...entry, drafts })}
                    mode={entry.mode} setMode={(mode) => setEntry({ ...entry, mode })}
                    policies={basics.map((b) => ({ id: b.p.engagement.id, label: `${b.name} · ${b.p.season.creditor_name ?? b.p.engagement.name}` }))}
                    policyId={entry.policyId} setPolicyId={(policyId) => setEntry({ ...entry, policyId })}
                    saving={saving} onAdd={() => void add()} onCancel={() => setEntry(null)} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <AttachmentViewer attachment={viewing} onClose={() => setViewing(null)} onExport={async (att) => {
        try {
          const { save } = await import("@tauri-apps/plugin-dialog")
          const destination = await save({ defaultPath: att.display_name })
          if (destination) await api.exportAttachment(att.id, destination)
        } catch (e) {
          toast(String(e), "error")
        }
      }} />
    </div>
  )
}

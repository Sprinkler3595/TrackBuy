import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Plus, Trash2, Edit, Repeat, RefreshCw, ExternalLink, Search, ArrowRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatPrice, formatDate, daysUntil, cn } from "@/lib/utils"
import { I18nContext } from "@/lib/i18n"
import { useContext } from "react"
import * as api from "@/lib/tauri"

const DISMISSED_KEY = "trackbuy-subscription-migration-dismissed"

/// Heuristics to spot subscriptions that are actually real-world recurring
/// charges (telecom, insurance, gym, leasing, utilities…). Returns the
/// canonical engagement_type to use as default in the migration dialog,
/// or null if the row looks like a genuine online subscription.
function detectEngagementType(s: api.Subscription): api.EngagementType | null {
  const haystack = `${s.name} ${s.category ?? ""} ${s.merchant_name ?? ""}`.toLowerCase()
  const map: Array<[RegExp, api.EngagementType]> = [
    [/\b(salt|sunrise|swisscom|orange|free mobile|bouygues|sfr|mobile|téléphon)\b/i, "phone"],
    [/\b(internet|fibre|adsl|vdsl|fttb|fai|box internet)\b/i, "internet"],
    [/\b(tv|radio|serafe|billag|redevance)\b/i, "tv_radio"],
    [/\b(assurance|insurance|css|helvetia|axa|zurich|mobilière|allianz|groupama|maaf|matmut|swica|sanitas|concordia|visana|atupri|kpt)\b/i, "insurance_other"],
    [/\b(loyer|rent|bail|locataire|bailleur)\b/i, "rent"],
    [/\b(parking|garage|box|place de parc)\b/i, "parking"],
    [/\b(leasing|location longue durée|lld)\b/i, "leasing"],
    [/\b(electricit|electric|romande énergie|sig|groupe e|swisspower|edf|engie)\b/i, "electricity"],
    [/\b(gaz natural|gaznat|gas)\b/i, "gas"],
    [/\b(eau|water|sigge)\b/i, "water"],
    [/\b(carburant|essence|diesel|fuel|recharge|borne)\b/i, "fuel"],
    [/\b(gym|fitness|basic-fit|crossfit|salle de sport|abonnement sport)\b/i, "membership"],
    [/\b(impôts|tax|fiscal)\b/i, "tax_other"],
  ]
  for (const [re, typ] of map) {
    if (re.test(haystack)) return typ
  }
  return null
}

type FormState = {
  name: string
  category: string
  merchant_id: string
  payment_card_id: string
  start_date: string
  next_renewal_date: string
  billing_cycle: api.BillingCycle
  cycle_interval: string
  price: string
  currency: string
  auto_renewal: boolean
  trial_end_date: string
  cancel_by_date: string
  cancellation_url: string
  status: api.SubscriptionStatus
  notes: string
}

const today = () => new Date().toISOString().slice(0, 10)

const emptyForm = (): FormState => ({
  name: "",
  category: "",
  merchant_id: "",
  payment_card_id: "",
  start_date: today(),
  next_renewal_date: today(),
  billing_cycle: "monthly",
  cycle_interval: "1",
  price: "",
  currency: "CHF",
  auto_renewal: true,
  trial_end_date: "",
  cancel_by_date: "",
  cancellation_url: "",
  status: "active",
  notes: "",
})

/// Convert a subscription's price to a per-month equivalent for the "monthly
/// cost" KPI. `custom` cycles are treated as N days and normalized to 30.44
/// days/month (the average year/12).
function monthlyEquivalent(s: api.Subscription): number {
  const interval = Math.max(1, s.cycle_interval)
  switch (s.billing_cycle) {
    case "monthly":
      return s.price / interval
    case "quarterly":
      return s.price / (3 * interval)
    case "yearly":
      return s.price / (12 * interval)
    case "custom":
      return (s.price / interval) * 30.44
  }
}

export function SubscriptionsPage() {
  const { t } = useContext(I18nContext)
  const [subs, setSubs] = useState<api.Subscription[]>([])
  const [merchants, setMerchants] = useState<api.Merchant[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [creditors, setCreditors] = useState<api.Creditor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.Subscription | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [statusFilter, setStatusFilter] = useState<"all" | api.SubscriptionStatus>("active")
  const [search, setSearch] = useState("")
  const [migrationDismissed, setMigrationDismissed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")) }
    catch { return new Set() }
  })
  const [migrationTarget, setMigrationTarget] = useState<api.Subscription | null>(null)
  const [migrationType, setMigrationType] = useState<api.EngagementType>("other")
  const [migrationCreditorId, setMigrationCreditorId] = useState<string>("")
  const { toast } = useToast()

  const load = async () => {
    try {
      const [subsData, merchantsData, cardsData, creditorsData] = await Promise.all([
        api.getSubscriptions(),
        api.getMerchants(),
        api.getCards(),
        api.getCreditors(),
      ])
      setSubs(subsData)
      setMerchants(merchantsData)
      setCards(cardsData)
      setCreditors(creditorsData)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const resetForm = () => {
    setForm(emptyForm())
    setEditing(null)
    setShowForm(false)
  }

  const handleEdit = (s: api.Subscription) => {
    setEditing(s)
    setForm({
      name: s.name,
      category: s.category ?? "",
      merchant_id: s.merchant_id ?? "",
      payment_card_id: s.payment_card_id ?? "",
      start_date: s.start_date,
      next_renewal_date: s.next_renewal_date,
      billing_cycle: s.billing_cycle,
      cycle_interval: String(s.cycle_interval),
      price: String(s.price),
      currency: s.currency,
      auto_renewal: s.auto_renewal,
      trial_end_date: s.trial_end_date ?? "",
      cancel_by_date: s.cancel_by_date ?? "",
      cancellation_url: s.cancellation_url ?? "",
      status: s.status,
      notes: s.notes ?? "",
    })
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const price = parseFloat(form.price)
    if (!form.name.trim() || isNaN(price) || price < 0) {
      toast("Nom et prix requis", "error")
      return
    }
    const interval = Math.max(1, parseInt(form.cycle_interval) || 1)
    try {
      if (editing) {
        await api.updateSubscription({
          ...editing,
          name: form.name.trim(),
          category: form.category.trim() || null,
          merchant_id: form.merchant_id || null,
          payment_card_id: form.payment_card_id || null,
          start_date: form.start_date,
          next_renewal_date: form.next_renewal_date,
          billing_cycle: form.billing_cycle,
          cycle_interval: interval,
          price,
          currency: form.currency,
          auto_renewal: form.auto_renewal,
          trial_end_date: form.trial_end_date || null,
          cancel_by_date: form.cancel_by_date || null,
          cancellation_url: form.cancellation_url.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
        })
        toast(t("subscriptions.updated"), "success")
      } else {
        await api.createSubscription({
          name: form.name.trim(),
          category: form.category.trim() || undefined,
          merchant_id: form.merchant_id || null,
          payment_card_id: form.payment_card_id || null,
          start_date: form.start_date,
          next_renewal_date: form.next_renewal_date,
          billing_cycle: form.billing_cycle,
          cycle_interval: interval,
          price,
          currency: form.currency,
          auto_renewal: form.auto_renewal,
          trial_end_date: form.trial_end_date || null,
          cancel_by_date: form.cancel_by_date || null,
          cancellation_url: form.cancellation_url.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
        })
        toast(t("subscriptions.created"), "success")
      }
      resetForm()
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteSubscription(deleteTarget)
      toast(t("subscriptions.deleted"), "success")
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const openMigration = (s: api.Subscription) => {
    setMigrationTarget(s)
    setMigrationType(detectEngagementType(s) ?? "other")
    setMigrationCreditorId("")
  }

  const dismissMigrationHint = (id: string) => {
    const next = new Set(migrationDismissed)
    next.add(id)
    setMigrationDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
  }

  const confirmMigration = async () => {
    if (!migrationTarget) return
    try {
      const created = await api.migrateSubscriptionToEngagement(
        migrationTarget.id,
        migrationType,
        migrationCreditorId || null,
      )
      toast(`Migré vers Engagements : « ${created.name} »`, "success")
      setMigrationTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleMarkRenewed = async (id: string) => {
    try {
      await api.markRenewed(id)
      toast(t("subscriptions.markedRenewed"), "success")
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return subs.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q) ||
        (s.merchant_name ?? "").toLowerCase().includes(q)
      )
    })
  }, [subs, statusFilter, search])

  const totalMonthly = useMemo(
    () => subs.filter((s) => s.status === "active").reduce((acc, s) => acc + monthlyEquivalent(s), 0),
    [subs],
  )

  const cycleLabel = (s: api.Subscription) => {
    const base =
      s.billing_cycle === "monthly" ? t("subscriptions.cycleMonthly") :
      s.billing_cycle === "quarterly" ? t("subscriptions.cycleQuarterly") :
      s.billing_cycle === "yearly" ? t("subscriptions.cycleYearly") :
      t("subscriptions.cycleCustom")
    return s.cycle_interval > 1 ? `${base} ×${s.cycle_interval}` : base
  }

  const statusBadge = (s: api.SubscriptionStatus) => {
    if (s === "active") return <Badge variant="success">{t("subscriptions.statusActive")}</Badge>
    if (s === "paused") return <Badge variant="warning">{t("subscriptions.statusPaused")}</Badge>
    return <Badge variant="secondary">{t("subscriptions.statusCancelled")}</Badge>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("subscriptions.title")}</h2>
          <p className="text-muted-foreground">
            {subs.length} · {t("subscriptions.monthlyCost")} : <span className="font-medium">{formatPrice(totalMonthly)}</span>
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus className="h-4 w-4" />{t("subscriptions.new")}
        </Button>
      </div>

      {/* Migration hint banner: surfaces subscriptions that look like
          real-world engagements (téléphone, internet, assurance, gym…).
          Each row carries a one-click migrate button + a dismiss cross. */}
      {(() => {
        const candidates = subs
          .filter((s) => s.status === "active" && !migrationDismissed.has(s.id))
          .map((s) => ({ sub: s, target: detectEngagementType(s) }))
          .filter((c): c is { sub: api.Subscription; target: api.EngagementType } => c.target !== null)
        if (candidates.length === 0) return null
        return (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <ArrowRight className="h-5 w-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">
                    {candidates.length === 1
                      ? "1 abonnement ressemble plutôt à un engagement (charge récurrente du monde réel)."
                      : `${candidates.length} abonnements ressemblent plutôt à des engagements (charges récurrentes du monde réel).`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Les migrer vers Engagements préserve l'historique de paiements et les pièces jointes,
                    et débloque le suivi par catégorie + l'analyse YoY dans Finances.
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                {candidates.slice(0, 5).map((c) => (
                  <div key={c.sub.id} className="flex items-center justify-between gap-2 rounded-md bg-background/60 border px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{c.sub.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Cible suggérée : {t(`engagements.type.${c.target}` as never)}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openMigration(c.sub)}>
                      Migrer →
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dismissMigrationHint(c.sub.id)} title="Ignorer cette suggestion">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {candidates.length > 5 && (
                  <p className="text-xs text-muted-foreground italic pt-1">
                    Et {candidates.length - 5} de plus…
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "active", "paused", "cancelled"] as const).map((k) => (
          <Button
            key={k}
            variant={statusFilter === k ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(k)}
          >
            {k === "all" ? t("common.all") :
              k === "active" ? t("subscriptions.statusActive") :
              k === "paused" ? t("subscriptions.statusPaused") :
              t("subscriptions.statusCancelled")}
          </Button>
        ))}
        <div className="ml-auto relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("common.search")}
            className="pl-8 w-64"
          />
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{editing ? t("subscriptions.edit") : t("subscriptions.new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("subscriptions.name")} *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.category")}</label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="streaming, cloud, SaaS…" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.merchant")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.merchant_id}
                  onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}
                >
                  <option value="">—</option>
                  {merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.card")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.payment_card_id}
                  onChange={(e) => setForm({ ...form, payment_card_id: e.target.value })}
                >
                  <option value="">—</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.status")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as api.SubscriptionStatus })}
                >
                  <option value="active">{t("subscriptions.statusActive")}</option>
                  <option value="paused">{t("subscriptions.statusPaused")}</option>
                  <option value="cancelled">{t("subscriptions.statusCancelled")}</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.startDate")} *</label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.nextRenewal")} *</label>
                <Input type="date" value={form.next_renewal_date} onChange={(e) => setForm({ ...form, next_renewal_date: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.trialEnd")}</label>
                <Input type="date" value={form.trial_end_date} onChange={(e) => setForm({ ...form, trial_end_date: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.billingCycle")} *</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.billing_cycle}
                  onChange={(e) => setForm({ ...form, billing_cycle: e.target.value as api.BillingCycle })}
                >
                  <option value="monthly">{t("subscriptions.cycleMonthly")}</option>
                  <option value="quarterly">{t("subscriptions.cycleQuarterly")}</option>
                  <option value="yearly">{t("subscriptions.cycleYearly")}</option>
                  <option value="custom">{t("subscriptions.cycleCustom")}</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.cycleInterval")}</label>
                <Input type="number" min="1" value={form.cycle_interval} onChange={(e) => setForm({ ...form, cycle_interval: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.price")} *</label>
                <Input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.currency")}</label>
                <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={3} />
              </div>

              <div className="flex items-center gap-3 pt-6">
                <input
                  type="checkbox"
                  id="auto_renewal"
                  checked={form.auto_renewal}
                  onChange={(e) => setForm({ ...form, auto_renewal: e.target.checked })}
                  className="h-4 w-4 rounded border"
                />
                <label htmlFor="auto_renewal" className="text-sm font-medium">{t("subscriptions.autoRenewal")}</label>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("subscriptions.cancelBy")}</label>
                <Input type="date" value={form.cancel_by_date} onChange={(e) => setForm({ ...form, cancel_by_date: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("subscriptions.cancellationUrl")}</label>
                <Input type="url" value={form.cancellation_url} onChange={(e) => setForm({ ...form, cancellation_url: e.target.value })} placeholder="https://…" />
              </div>

              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">{t("subscriptions.notes")}</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>

              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit">{editing ? t("common.save") : t("common.add")}</Button>
                <Button type="button" variant="outline" onClick={resetForm}>{t("common.cancel")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
              <Repeat className="h-12 w-12 mb-4 opacity-20" />
              <p>{t("subscriptions.noSubs")}</p>
            </CardContent>
          </Card>
        ) : filtered.map((s) => {
          const days = daysUntil(s.next_renewal_date)
          const inTrial = !!s.trial_end_date && new Date(s.trial_end_date) >= new Date()
          return (
            <Card key={s.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/subscriptions/${s.id}`} className="flex-1 min-w-0">
                    <p className="font-semibold truncate hover:text-primary transition-colors">{s.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {s.category && <Badge variant="outline" className="text-[10px]">{s.category}</Badge>}
                      {statusBadge(s.status)}
                      {inTrial && <Badge variant="warning" className="text-[10px]">{t("subscriptions.inTrial")}</Badge>}
                    </div>
                  </Link>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(s)} title={t("common.edit")}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(s.id)} title={t("common.delete")}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold">{formatPrice(s.price, s.currency)}</span>
                  <span className="text-xs text-muted-foreground">{cycleLabel(s)}</span>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <div>
                    {t("subscriptions.nextRenewal")} : <span className="font-medium text-foreground">{formatDate(s.next_renewal_date)}</span>
                    <span className={cn("ml-2", days <= 7 ? "text-destructive" : days <= 30 ? "text-amber-600" : "")}>
                      ({days === 0 ? "aujourd'hui" : `${days}j`})
                    </span>
                  </div>
                  {s.merchant_name && <div>{s.merchant_name}{s.card_name && ` · ${s.card_name}`}</div>}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => handleMarkRenewed(s.id)}>
                    <RefreshCw className="h-3 w-3" />
                    {t("subscriptions.markRenewed")}
                  </Button>
                  {s.cancellation_url && (
                    <a
                      href={s.cancellation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t("subscriptions.cancellationUrl")}
                      className="inline-flex items-center justify-center h-9 w-9 rounded-md hover:bg-accent text-muted-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("common.delete")}
        message={t("subscriptions.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {migrationTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMigrationTarget(null)}>
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Migrer vers Engagements</h3>
            <p className="text-sm text-muted-foreground mt-1">{migrationTarget.name}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {formatPrice(migrationTarget.price, migrationTarget.currency)} · {cycleLabel(migrationTarget)}
            </p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Type d'engagement</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={migrationType}
                  onChange={(e) => setMigrationType(e.target.value as api.EngagementType)}
                >
                  <option value="insurance_health">Assurance maladie</option>
                  <option value="insurance_household">Assurance RC ménage</option>
                  <option value="insurance_car">Assurance auto</option>
                  <option value="insurance_other">Autre assurance</option>
                  <option value="rent">Loyer</option>
                  <option value="parking">Place de parc</option>
                  <option value="leasing">Leasing</option>
                  <option value="electricity">Électricité</option>
                  <option value="gas">Gaz</option>
                  <option value="water">Eau</option>
                  <option value="phone">Téléphone</option>
                  <option value="internet">Internet</option>
                  <option value="tv_radio">Redevance TV / radio</option>
                  <option value="fuel">Carburant / recharge</option>
                  <option value="membership">Cotisation / gym</option>
                  <option value="tax_other">Autre taxe</option>
                  <option value="other">Autre</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Créancier (optionnel)</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={migrationCreditorId}
                  onChange={(e) => setMigrationCreditorId(e.target.value)}
                >
                  <option value="">—</option>
                  {creditors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">
                  Tu peux créer un créancier maintenant dans Paramètres → Créanciers, ou laisser vide et le renseigner après.
                </p>
              </div>
              <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                L'historique des paiements ({"≈"} chaque versement) sera converti en charges payées, les pièces jointes seront ré-attachées, et l'abonnement source sera supprimé. Action atomique : si elle échoue, rien ne change.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setMigrationTarget(null)}>Annuler</Button>
                <Button size="sm" onClick={confirmMigration}>Migrer</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

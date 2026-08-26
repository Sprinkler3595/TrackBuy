import { useEffect, useMemo, useState, useContext } from "react"
import { Link } from "react-router-dom"
import { Plus, Trash2, Edit, FileText, Search, Download, Home, Car, ShieldCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatPrice, daysUntil, formatDate, cn } from "@/lib/utils"
import { SUPPORTED_CURRENCIES } from "@/lib/currencies"
import { monthlyEquivalent } from "@/lib/finance"
import { downloadExport } from "@/lib/export"
import { upcomingCancellations } from "@/lib/cancellation"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import { ClausesEditor } from "@/components/features/clauses-editor"
import { CancellationLetterModal } from "@/components/features/cancellation-letter"
import { RentWizard } from "@/components/features/rent-wizard"
import { LeasingWizard } from "@/components/features/leasing-wizard"
import { CarInsuranceWizard } from "@/components/features/car-insurance-wizard"
import { InlineCreateSelect } from "@/components/ui/inline-create-select"
import { AlarmClock } from "lucide-react"
import * as api from "@/lib/tauri"

/// Groupings used for the category chips on the list page. Each maps to a
/// subset of canonical engagement_type values so users can filter to e.g.
/// "Assurances" without selecting 6 individual types.
const CATEGORY_GROUPS: Record<string, api.EngagementType[]> = {
  insurance: ["insurance_health", "insurance_household", "insurance_car", "insurance_life", "insurance_legal", "insurance_other"],
  housing:   ["rent", "parking", "mortgage"],
  vehicle:   ["leasing", "fuel", "vehicle_tax"],
  utilities: ["electricity", "gas", "water", "heating"],
  telecom:   ["phone", "internet", "tv_radio"],
  taxes:     ["tax_federal", "tax_cantonal", "tax_communal", "tax_other", "fine", "fee"],
  other:     ["membership", "other"],
}
type CategoryGroup = keyof typeof CATEGORY_GROUPS | "all"

const ALL_TYPES: api.EngagementType[] = [
  "insurance_health", "insurance_household", "insurance_car", "insurance_life",
  "insurance_legal", "insurance_other",
  "rent", "parking", "leasing", "mortgage",
  "electricity", "gas", "water", "fuel", "vehicle_tax", "heating",
  "phone", "internet", "tv_radio",
  "tax_federal", "tax_cantonal", "tax_communal", "tax_other",
  "fine", "fee", "membership", "other",
]

const CYCLES: api.EngagementBillingCycle[] = [
  "monthly", "quarterly", "semiannual", "yearly", "one_shot", "custom",
]

const PAYMENT_METHODS: api.EngagementPaymentMethod[] = [
  "direct_debit", "qr_bill", "bvr", "manual_transfer",
  "standing_order", "cash", "card_auto", "other",
]

const PARKING_KINDS: api.ParkingKind[] = ["outdoor", "collective_garage", "box"]

const parkingKindLabel = (k: api.ParkingKind, locale: string): string =>
  k === "outdoor"           ? (locale === "fr" ? "Extérieure" : "Outdoor") :
  k === "collective_garage" ? (locale === "fr" ? "Garage collectif" : "Collective garage") :
                              (locale === "fr" ? "Box / garage individuel" : "Box / individual garage")

const today = () => new Date().toISOString().slice(0, 10)

type FormState = {
  name: string
  engagement_type: api.EngagementType
  parent_engagement_id: string
  creditor_id: string
  payment_card_id: string
  contract_reference: string
  contract_start_date: string
  contract_end_date: string
  notice_period_days: string
  billing_cycle: api.EngagementBillingCycle
  cycle_interval: string
  next_due_date: string
  current_amount: string
  currency: string
  payment_method: api.EngagementPaymentMethod | ""
  auto_pay: boolean
  status: api.EngagementStatus
  notes: string
  clauses_json: string | null
  // Parking specifics (only submitted when engagement_type === "parking").
  parking_spot_number: string
  parking_kind: api.ParkingKind | ""
}

const emptyForm = (): FormState => ({
  name: "",
  engagement_type: "insurance_health",
  parent_engagement_id: "",
  creditor_id: "",
  payment_card_id: "",
  contract_reference: "",
  contract_start_date: "",
  contract_end_date: "",
  notice_period_days: "",
  billing_cycle: "monthly",
  cycle_interval: "1",
  next_due_date: today(),
  current_amount: "",
  currency: "CHF",
  payment_method: "",
  auto_pay: false,
  status: "active",
  notes: "",
  clauses_json: null,
  parking_spot_number: "",
  parking_kind: "",
})

export function EngagementsPage() {
  const { t, locale } = useContext(I18nContext)
  const [engagements, setEngagements] = useState<api.Engagement[]>([])
  const [creditors, setCreditors] = useState<api.Creditor[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.Engagement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [category, setCategory] = useState<CategoryGroup>("all")
  const [search, setSearch] = useState("")
  const [letterTarget, setLetterTarget] = useState<api.Engagement | null>(null)
  // Creation happens only through a guided assistant — the chooser lists the
  // three domains the app actually supports. The full form below is reachable
  // from the pencil button only, to fix an existing position.
  const [showChooser, setShowChooser] = useState(false)
  const [showRentWizard, setShowRentWizard] = useState(false)
  const [showLeasingWizard, setShowLeasingWizard] = useState(false)
  const [showCarInsuranceWizard, setShowCarInsuranceWizard] = useState(false)
  const { toast } = useToast()

  // Parking number/type only make sense for the "parking" type.
  const isParking = form.engagement_type === "parking"

  // Inline creation of a creditor / payment account from the form's selects.
  const createCreditorInline = async (name: string): Promise<api.Creditor | null> => {
    try {
      const c = await api.createCreditor({ name })
      setCreditors((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      return c
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
      return null
    }
  }
  const createCardInline = async (name: string): Promise<api.PaymentCard | null> => {
    try {
      const c = await api.createCard({ name, is_credit_card: false })
      setCards((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))
      return c
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
      return null
    }
  }

  const load = async () => {
    try {
      const [engData, credData, cardData] = await Promise.all([
        api.getEngagements(),
        api.getCreditors(),
        api.getCards(),
      ])
      setEngagements(engData)
      setCreditors(credData)
      setCards(cardData)
    } catch (e) {
      console.error(e)
      toast(`Erreur: ${e}`, "error")
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

  const handleEdit = (e: api.Engagement) => {
    setForm({
      name: e.name,
      engagement_type: e.engagement_type,
      parent_engagement_id: e.parent_engagement_id || "",
      creditor_id: e.creditor_id || "",
      payment_card_id: e.payment_card_id || "",
      contract_reference: e.contract_reference || "",
      contract_start_date: e.contract_start_date || "",
      contract_end_date: e.contract_end_date || "",
      notice_period_days: e.notice_period_days?.toString() || "",
      billing_cycle: e.billing_cycle,
      cycle_interval: e.cycle_interval.toString(),
      next_due_date: e.next_due_date || today(),
      current_amount: e.current_amount?.toString() || "",
      currency: e.currency,
      payment_method: e.payment_method || "",
      auto_pay: e.auto_pay,
      status: e.status,
      notes: e.notes || "",
      clauses_json: e.clauses_json,
      parking_spot_number: e.parking_spot_number || "",
      parking_kind: e.parking_kind || "",
    })
    setEditing(e)
    setShowForm(true)
  }

  // Edit-only: new engagements come from the guided assistants (rent, leasing,
  // car insurance), never from this form.
  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!editing || !form.name.trim()) return
    const amount = form.current_amount ? parseFloat(form.current_amount) : null
    if (form.current_amount && (Number.isNaN(amount as number) || (amount as number) < 0)) {
      toast("Montant invalide", "error")
      return
    }
    const interval = Math.max(1, parseInt(form.cycle_interval) || 1)
    const notice = form.notice_period_days ? parseInt(form.notice_period_days) : null
    // Parking specifics are only persisted for the parking type; nulled
    // otherwise so switching type doesn't leave stale values behind.
    const parkingFields = {
      parking_spot_number: isParking ? (form.parking_spot_number.trim() || null) : null,
      parking_kind: isParking ? (form.parking_kind || null) : null,
    }
    try {
      await api.updateEngagement({
        ...editing,
        name: form.name.trim(),
        engagement_type: form.engagement_type,
        parent_engagement_id: form.parent_engagement_id || null,
        creditor_id: form.creditor_id || null,
        payment_card_id: form.payment_card_id || null,
        contract_reference: form.contract_reference || null,
        contract_start_date: form.contract_start_date || null,
        contract_end_date: form.contract_end_date || null,
        notice_period_days: notice,
        billing_cycle: form.billing_cycle,
        cycle_interval: interval,
        next_due_date: form.next_due_date || null,
        current_amount: amount,
        currency: form.currency,
        payment_method: form.payment_method || null,
        auto_pay: form.auto_pay,
        status: form.status,
        notes: form.notes || null,
        clauses_json: form.clauses_json,
        ...parkingFields,
      })
      toast(t("engagements.updated"), "success")
      resetForm()
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteEngagement(deleteTarget)
      toast(t("engagements.deleted"), "success")
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const typeKey = (typ: api.EngagementType): keyof TranslationKeys =>
    `engagements.type.${typ}` as keyof TranslationKeys

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const typeFilter: Set<string> | null = category === "all"
      ? null
      : new Set(CATEGORY_GROUPS[category])
    return engagements.filter((e) => {
      if (typeFilter && !typeFilter.has(e.engagement_type)) return false
      if (!q) return true
      return (
        e.name.toLowerCase().includes(q) ||
        (e.contract_reference ?? "").toLowerCase().includes(q) ||
        (e.creditor_name ?? "").toLowerCase().includes(q)
      )
    })
  }, [engagements, category, search])

  const totalMonthly = useMemo(() => {
    return engagements
      .filter((e) => e.status === "active" && e.current_amount != null && e.billing_cycle !== "one_shot")
      .reduce((acc, e) => acc + monthlyEquivalent(e.current_amount as number, e.billing_cycle, e.cycle_interval), 0)
  }, [engagements])

  // Engagements whose cancellation deadline (contract end − notice period) is
  // approaching or just missed — the "résiliez au bon moment" reminder.
  const cancellations = useMemo(() => upcomingCancellations(engagements), [engagements])

  const cycleLabel = (e: api.Engagement): string => {
    const base =
      e.billing_cycle === "monthly" ? t("engagements.cycleMonthly") :
      e.billing_cycle === "quarterly" ? t("engagements.cycleQuarterly") :
      e.billing_cycle === "semiannual" ? t("engagements.cycleSemiannual") :
      e.billing_cycle === "yearly" ? t("engagements.cycleYearly") :
      e.billing_cycle === "one_shot" ? t("engagements.cycleOneShot") :
      t("engagements.cycleCustom")
    return e.cycle_interval > 1 ? `${base} ×${e.cycle_interval}` : base
  }

  const statusBadge = (s: api.EngagementStatus) => {
    if (s === "active") return <Badge variant="success">{t("engagements.statusActive")}</Badge>
    if (s === "suspended") return <Badge variant="warning">{t("engagements.statusSuspended")}</Badge>
    return <Badge variant="secondary">{t("engagements.statusEnded")}</Badge>
  }

  const dueBadge = (e: api.Engagement) => {
    if (!e.next_due_date) return null
    const d = daysUntil(e.next_due_date)
    if (d < 0) return <span className="text-xs text-destructive">{`${-d}j de retard`}</span>
    if (d <= 7) return <span className="text-xs text-destructive">{t("engagements.dueIn")} {d}j</span>
    if (d <= 30) return <span className="text-xs text-amber-600 dark:text-amber-500">{t("engagements.dueIn")} {d}j</span>
    return <span className="text-xs text-muted-foreground">{t("engagements.dueIn")} {d}j</span>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const catKey = (k: CategoryGroup): keyof TranslationKeys => {
    switch (k) {
      case "all":       return "engagements.allCategories"
      case "insurance": return "engagements.catInsurance"
      case "housing":   return "engagements.catHousing"
      case "vehicle":   return "engagements.catVehicle"
      case "utilities": return "engagements.catUtilities"
      case "telecom":   return "engagements.catTelecom"
      case "taxes":     return "engagements.catTaxes"
      default:          return "engagements.catOther"
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("engagements.title")}</h2>
          <p className="text-muted-foreground">
            {engagements.length} · {t("engagements.totalMonthlyCost")} :{" "}
            <span className="font-medium">{formatPrice(totalMonthly)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const [eng, charges] = await Promise.all([
                  api.exportEngagementsCsv(),
                  api.exportEngagementChargesCsv(),
                ])
                await downloadExport(eng, `engagements-${today().slice(0, 7)}.csv`)
                await downloadExport(charges, `engagements-echeances-${today().slice(0, 7)}.csv`)
              } catch (e) {
                toast(`Erreur export: ${e}`, "error")
              }
            }}
            title="Exporter en CSV (engagements + échéances)"
          >
            <Download className="h-4 w-4" />
            Exporter CSV
          </Button>
          <Button onClick={() => setShowChooser(true)}>
            <Plus className="h-4 w-4" />{t("engagements.new")}
          </Button>
        </div>
      </div>

      {cancellations.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
            <AlarmClock className="h-5 w-5 text-amber-600 dark:text-amber-500" />
            <CardTitle className="text-base">Résiliations à anticiper</CardTitle>
            <Badge variant="secondary" className="ml-auto">{cancellations.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {cancellations.map(({ engagement, info }) => {
              const missed = info.severity === "missed"
              const urgent = info.severity === "urgent"
              const deadlineLabel = missed
                ? `Délai dépassé le ${formatDate(info.deadlineISO)}`
                : info.daysUntilDeadline === 0
                  ? "Dernier jour pour résilier : aujourd'hui"
                  : `Résiliez avant le ${formatDate(info.deadlineISO)} (dans ${info.daysUntilDeadline} j)`
              return (
                <div
                  key={engagement.id}
                  className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"
                >
                  <div className="min-w-0">
                    <Link to={`/engagements/${engagement.id}`} className="font-medium hover:underline">
                      {engagement.name}
                    </Link>
                    <div
                      className={cn(
                        "text-xs",
                        missed || urgent
                          ? "font-medium text-destructive"
                          : "text-amber-600 dark:text-amber-500",
                      )}
                    >
                      {deadlineLabel}
                      <span className="text-muted-foreground">
                        {" "}· échéance du contrat le {formatDate(info.contractEndISO)}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={missed ? "outline" : "default"}
                    onClick={() => setLetterTarget(engagement)}
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" />
                    Lettre
                  </Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "housing", "vehicle", "insurance"] as const).map((k) => (
          <Button
            key={k}
            variant={category === k ? "default" : "outline"}
            size="sm"
            onClick={() => setCategory(k)}
          >
            {t(catKey(k))}
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
            <CardTitle className="text-lg">{t("engagements.edit")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("engagements.name")} *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.type")} *</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.engagement_type}
                  onChange={(e) => setForm({ ...form, engagement_type: e.target.value as api.EngagementType })}
                >
                  {ALL_TYPES.map((typ) => (
                    <option key={typ} value={typ}>{t(typeKey(typ))}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.creditor")}</label>
                <InlineCreateSelect
                  value={form.creditor_id}
                  onChange={(id) => setForm({ ...form, creditor_id: id })}
                  options={creditors}
                  onCreate={createCreditorInline}
                  placeholder={locale === "fr" ? "Nom du créancier" : "Creditor name"}
                  createTitle={locale === "fr" ? "Nouveau créancier" : "New creditor"}
                  fr={locale === "fr"}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.card")}</label>
                <InlineCreateSelect
                  value={form.payment_card_id}
                  onChange={(id) => setForm({ ...form, payment_card_id: id })}
                  options={cards}
                  onCreate={createCardInline}
                  placeholder={locale === "fr" ? "Nom du compte / carte" : "Account / card name"}
                  createTitle={locale === "fr" ? "Nouveau compte / carte" : "New account / card"}
                  fr={locale === "fr"}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.parent")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.parent_engagement_id}
                  onChange={(e) => setForm({ ...form, parent_engagement_id: e.target.value })}
                >
                  <option value="">—</option>
                  {engagements
                    .filter((e) => !editing || e.id !== editing.id)
                    .map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              {isParking && (
                <div className="space-y-3 rounded-md border border-dashed border-input p-3 sm:col-span-2 lg:col-span-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    {locale === "fr" ? "Place de parc" : "Parking spot"}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{locale === "fr" ? "Type de place" : "Spot type"}</label>
                      <select
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                        value={form.parking_kind}
                        onChange={(e) => setForm({ ...form, parking_kind: e.target.value as api.ParkingKind | "" })}
                      >
                        <option value="">—</option>
                        {PARKING_KINDS.map((k) => <option key={k} value={k}>{parkingKindLabel(k, locale)}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{locale === "fr" ? "Numéro de place" : "Spot number"}</label>
                      <Input value={form.parking_spot_number}
                        onChange={(e) => setForm({ ...form, parking_spot_number: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.contractRef")}</label>
                <Input value={form.contract_reference} onChange={(e) => setForm({ ...form, contract_reference: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.contractStart")}</label>
                <Input type="date" value={form.contract_start_date} onChange={(e) => setForm({ ...form, contract_start_date: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.contractEnd")}</label>
                <Input type="date" value={form.contract_end_date} onChange={(e) => setForm({ ...form, contract_end_date: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.billingCycle")} *</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.billing_cycle}
                  onChange={(e) => setForm({ ...form, billing_cycle: e.target.value as api.EngagementBillingCycle })}
                >
                  {CYCLES.map((c) => <option key={c} value={c}>
                    {c === "monthly"   ? t("engagements.cycleMonthly") :
                     c === "quarterly" ? t("engagements.cycleQuarterly") :
                     c === "semiannual"? t("engagements.cycleSemiannual") :
                     c === "yearly"    ? t("engagements.cycleYearly") :
                     c === "one_shot"  ? t("engagements.cycleOneShot") :
                                         t("engagements.cycleCustom")}
                  </option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.cycleInterval")}</label>
                <Input type="number" min="1" value={form.cycle_interval} onChange={(e) => setForm({ ...form, cycle_interval: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.nextDue")}</label>
                <Input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.currentAmount")}</label>
                <div className="flex gap-2">
                  <Input type="number" step="0.01" min="0" value={form.current_amount}
                    onChange={(e) => setForm({ ...form, current_amount: e.target.value })}
                    className="flex-1" />
                  <select
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="w-24 rounded-md border border-input bg-background px-2 py-2 text-sm"
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.paymentMethod")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.payment_method}
                  onChange={(e) => setForm({ ...form, payment_method: e.target.value as api.EngagementPaymentMethod | "" })}
                >
                  <option value="">—</option>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>
                    {m === "direct_debit"   ? t("engagements.methodDirectDebit") :
                     m === "qr_bill"        ? t("engagements.methodQrBill") :
                     m === "bvr"            ? t("engagements.methodBvr") :
                     m === "manual_transfer"? t("engagements.methodManualTransfer") :
                     m === "standing_order" ? t("engagements.methodStandingOrder") :
                     m === "cash"           ? t("engagements.methodCash") :
                     m === "card_auto"      ? t("engagements.methodCardAuto") :
                                              t("engagements.methodOther")}
                  </option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.noticePeriod")}</label>
                <Input type="number" min="0" value={form.notice_period_days} onChange={(e) => setForm({ ...form, notice_period_days: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.status")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as api.EngagementStatus })}
                >
                  <option value="active">{t("engagements.statusActive")}</option>
                  <option value="suspended">{t("engagements.statusSuspended")}</option>
                  <option value="ended">{t("engagements.statusEnded")}</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-2 flex items-end">
                <label className="inline-flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={form.auto_pay}
                    onChange={(e) => setForm({ ...form, auto_pay: e.target.checked })}
                  />
                  {t("engagements.autoPay")}
                </label>
              </div>

              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">{t("engagements.notes")}</label>
                <textarea
                  className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">{t("engagements.clauses")}</label>
                <ClausesEditor
                  value={form.clauses_json}
                  onChange={(raw) => setForm({ ...form, clauses_json: raw })}
                />
              </div>

              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit">{t("common.save")}</Button>
                <Button type="button" variant="outline" onClick={resetForm}>{t("common.cancel")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mb-4 opacity-20" />
              <p>{t("engagements.noEngagements")}</p>
            </CardContent>
          </Card>
        ) : filtered.map((e) => (
          <Card key={e.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <Link to={`/engagements/${e.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{e.name}</p>
                    {statusBadge(e.status)}
                    {e.parent_name && <Badge variant="secondary">↳ {e.parent_name}</Badge>}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span>{t(typeKey(e.engagement_type))}</span>
                    {e.creditor_name && <span>· {e.creditor_name}</span>}
                    {e.contract_reference && <span className="font-mono">· {e.contract_reference}</span>}
                  </div>
                </Link>
                <div className="text-right shrink-0">
                  {e.current_amount != null && (
                    <p className={cn("font-semibold", e.billing_cycle === "one_shot" && "text-muted-foreground")}>
                      {formatPrice(e.current_amount, e.currency)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{cycleLabel(e)}</p>
                  {dueBadge(e)}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(e)}><Edit className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("engagements.deleteTitle")}
        message={t("engagements.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {letterTarget && (
        <CancellationLetterModal
          engagement={letterTarget}
          creditor={creditors.find((c) => c.id === letterTarget.creditor_id) ?? null}
          onClose={() => setLetterTarget(null)}
        />
      )}

      {showChooser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border bg-card shadow-lg">
            <div className="flex items-center justify-between gap-4 border-b p-5">
              <h2 className="text-lg font-semibold">
                {locale === "fr" ? "Que voulez-vous ajouter ?" : "What do you want to add?"}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setShowChooser(false)} aria-label={t("common.cancel")}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 p-5">
              <button
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40"
                onClick={() => { setShowChooser(false); setShowRentWizard(true) }}
              >
                <span className="rounded-lg bg-primary/10 p-2 text-primary"><Home className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{locale === "fr" ? "Logement (loyer)" : "Housing (rent)"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {locale === "fr" ? "Assistant guidé : appartement, place de parc, documents" : "Guided assistant: apartment, parking, documents"}
                  </span>
                </span>
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40"
                onClick={() => { setShowChooser(false); setShowLeasingWizard(true) }}
              >
                <span className="rounded-lg bg-primary/10 p-2 text-primary"><Car className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{locale === "fr" ? "Véhicule (leasing)" : "Vehicle (leasing)"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {locale === "fr" ? "Assistant guidé : véhicule, contrat, documents" : "Guided assistant: vehicle, contract, documents"}
                  </span>
                </span>
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40"
                onClick={() => { setShowChooser(false); setShowCarInsuranceWizard(true) }}
              >
                <span className="rounded-lg bg-primary/10 p-2 text-primary"><ShieldCheck className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{locale === "fr" ? "Assurance véhicule" : "Vehicle insurance"}</span>
                  <span className="block text-xs text-muted-foreground">
                    {locale === "fr" ? "Assistant guidé : RC/casco, franchises, options" : "Guided assistant: liability/casco, deductibles, options"}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showRentWizard && (
        <RentWizard
          creditors={creditors}
          cards={cards}
          onClose={() => { setShowRentWizard(false); load() }}
        />
      )}

      {showLeasingWizard && (
        <LeasingWizard
          creditors={creditors}
          cards={cards}
          onClose={() => { setShowLeasingWizard(false); load() }}
        />
      )}

      {showCarInsuranceWizard && (
        <CarInsuranceWizard
          creditors={creditors}
          cards={cards}
          engagements={engagements}
          onClose={() => { setShowCarInsuranceWizard(false); load() }}
        />
      )}
    </div>
  )
}

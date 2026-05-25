import { useEffect, useMemo, useState, useContext } from "react"
import { Link } from "react-router-dom"
import { Plus, Trash2, Edit, FileText, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatPrice, daysUntil, cn } from "@/lib/utils"
import { monthlyEquivalent } from "@/lib/finance"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import { ClausesEditor } from "@/components/features/clauses-editor"
import * as api from "@/lib/tauri"

/// Groupings used for the category chips on the list page. Each maps to a
/// subset of canonical engagement_type values so users can filter to e.g.
/// "Assurances" without selecting 6 individual types.
const CATEGORY_GROUPS: Record<string, api.EngagementType[]> = {
  insurance: ["insurance_health", "insurance_household", "insurance_car", "insurance_life", "insurance_legal", "insurance_other"],
  housing:   ["rent", "parking", "mortgage"],
  vehicle:   ["leasing", "fuel"],
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
  "electricity", "gas", "water", "fuel", "heating",
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
})

export function EngagementsPage() {
  const { t } = useContext(I18nContext)
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
  const { toast } = useToast()

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
    })
    setEditing(e)
    setShowForm(true)
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form.name.trim()) return
    const amount = form.current_amount ? parseFloat(form.current_amount) : null
    if (form.current_amount && (Number.isNaN(amount as number) || (amount as number) < 0)) {
      toast("Montant invalide", "error")
      return
    }
    const interval = Math.max(1, parseInt(form.cycle_interval) || 1)
    const notice = form.notice_period_days ? parseInt(form.notice_period_days) : null
    try {
      if (editing) {
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
        })
        toast(t("engagements.updated"), "success")
      } else {
        await api.createEngagement({
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
        })
        toast(t("engagements.created"), "success")
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
        <Button onClick={() => { resetForm(); setShowForm(true) }}>
          <Plus className="h-4 w-4" />{t("engagements.new")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "insurance", "housing", "vehicle", "utilities", "telecom", "taxes", "other"] as const).map((k) => (
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
            <CardTitle className="text-lg">{editing ? t("engagements.edit") : t("engagements.new")}</CardTitle>
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
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.creditor_id}
                  onChange={(e) => setForm({ ...form, creditor_id: e.target.value })}
                >
                  <option value="">—</option>
                  {creditors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("engagements.card")}</label>
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
                    <option value="CHF">CHF</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
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
                <Button type="submit">{editing ? t("common.save") : t("common.add")}</Button>
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
        title={t("engagements.deleted")}
        message={t("engagements.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

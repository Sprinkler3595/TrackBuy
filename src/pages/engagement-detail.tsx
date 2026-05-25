import { useContext, useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Plus, Trash2, CheckCircle2, FileText, History, ListChecks, Paperclip, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { formatPrice, formatDate, daysUntil, cn } from "@/lib/utils"
import { monthlyEquivalent } from "@/lib/finance"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import { ClausesEditor } from "@/components/features/clauses-editor"
import * as api from "@/lib/tauri"

const today = () => new Date().toISOString().slice(0, 10)

type Tab = "overview" | "charges" | "revisions" | "attachments" | "children"

export function EngagementDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useContext(I18nContext)
  const { toast } = useToast()

  const [engagement, setEngagement] = useState<api.Engagement | null>(null)
  const [children, setChildren] = useState<api.Engagement[]>([])
  const [charges, setCharges] = useState<api.EngagementCharge[]>([])
  const [revisions, setRevisions] = useState<api.EngagementRevision[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("overview")
  const [deleteEngagementOpen, setDeleteEngagementOpen] = useState(false)
  const [deleteChargeTarget, setDeleteChargeTarget] = useState<string | null>(null)
  const [deleteRevisionTarget, setDeleteRevisionTarget] = useState<string | null>(null)

  // Charge form
  const [chargeForm, setChargeForm] = useState({
    due_date: today(), amount: "", reference_number: "", invoice_number: "",
    paid_on: "", payment_card_id: "", notes: "",
  })
  const [showChargeForm, setShowChargeForm] = useState(false)

  // Revision form
  const [revForm, setRevForm] = useState({
    effective_date: today(), amount: "", change_reason: "", notes: "",
  })
  const [showRevForm, setShowRevForm] = useState(false)

  // Child engagement form (creates a sub-engagement attached to this parent).
  // Most fields inherit from the parent so the user only has to fill name +
  // amount in the common case (rent + parking spot).
  const [childForm, setChildForm] = useState({
    name: "", engagement_type: "parking" as api.EngagementType,
    amount: "", billing_cycle: "monthly" as api.EngagementBillingCycle,
    contract_reference: "",
  })
  const [showChildForm, setShowChildForm] = useState(false)

  const load = async () => {
    if (!id) return
    try {
      const [e, ch, rev, kids, cs] = await Promise.all([
        api.getEngagement(id),
        api.getEngagementCharges(id),
        api.getEngagementRevisions(id),
        api.getEngagementChildren(id),
        api.getCards(),
      ])
      setEngagement(e)
      setCharges(ch)
      setRevisions(rev)
      setChildren(kids)
      setCards(cs)
      setChargeForm((f) => ({
        ...f,
        amount: e.current_amount?.toString() || "",
        payment_card_id: e.payment_card_id ?? "",
      }))
      setRevForm((f) => ({ ...f, amount: e.current_amount?.toString() || "" }))
      // Default a child to "parking" when the parent is rent/leasing/mortgage
      // (the dominant real-world use case), otherwise mirror the parent type.
      const housingParents = new Set<api.EngagementType>(["rent", "leasing", "mortgage"])
      setChildForm((f) => ({
        ...f,
        engagement_type: housingParents.has(e.engagement_type) ? "parking" : e.engagement_type,
        billing_cycle: e.billing_cycle,
      }))
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  if (loading || !engagement) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const e = engagement
  const typeKey = `engagements.type.${e.engagement_type}` as keyof TranslationKeys
  const cycleKey = (
    e.billing_cycle === "monthly"   ? "engagements.cycleMonthly" :
    e.billing_cycle === "quarterly" ? "engagements.cycleQuarterly" :
    e.billing_cycle === "semiannual"? "engagements.cycleSemiannual" :
    e.billing_cycle === "yearly"    ? "engagements.cycleYearly" :
    e.billing_cycle === "one_shot"  ? "engagements.cycleOneShot" :
                                       "engagements.cycleCustom"
  ) as keyof TranslationKeys

  const monthly = e.current_amount != null && e.billing_cycle !== "one_shot"
    ? monthlyEquivalent(e.current_amount, e.billing_cycle, e.cycle_interval)
    : 0
  const yearly = monthly * 12

  const days = e.next_due_date ? daysUntil(e.next_due_date) : null
  const dueColor =
    days == null ? "" :
    days < 0 ? "text-destructive" :
    days <= 7 ? "text-destructive" :
    days <= 30 ? "text-amber-600 dark:text-amber-500" :
    "text-muted-foreground"

  const totalPaidYTD = charges
    .filter((c) => c.paid_on && c.paid_on.slice(0, 4) === today().slice(0, 4))
    .reduce((acc, c) => acc + c.amount, 0)

  const handleDeleteEngagement = async () => {
    try {
      await api.deleteEngagement(e.id)
      toast(t("engagements.deleted"), "success")
      navigate("/engagements")
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const submitCharge = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const amount = parseFloat(chargeForm.amount)
    if (!chargeForm.due_date || Number.isNaN(amount)) {
      toast("Date et montant requis", "error")
      return
    }
    try {
      await api.addEngagementCharge({
        engagement_id: e.id,
        due_date: chargeForm.due_date,
        amount,
        currency: e.currency,
        paid_on: chargeForm.paid_on || null,
        status: chargeForm.paid_on ? "paid" : "scheduled",
        payment_card_id: chargeForm.payment_card_id || null,
        reference_number: chargeForm.reference_number || null,
        invoice_number: chargeForm.invoice_number || null,
        notes: chargeForm.notes || null,
      })
      toast("Échéance ajoutée", "success")
      setShowChargeForm(false)
      setChargeForm({
        due_date: today(), amount: e.current_amount?.toString() || "",
        reference_number: "", invoice_number: "", paid_on: "",
        payment_card_id: e.payment_card_id ?? "", notes: "",
      })
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleMarkPaid = async (chargeId: string) => {
    try {
      await api.markChargePaid(chargeId, today(), e.payment_card_id)
      toast("Marquée payée", "success")
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleDeleteCharge = async () => {
    if (!deleteChargeTarget) return
    try {
      await api.deleteEngagementCharge(deleteChargeTarget)
      toast("Échéance supprimée", "success")
      setDeleteChargeTarget(null)
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const submitRevision = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const amount = parseFloat(revForm.amount)
    if (!revForm.effective_date || Number.isNaN(amount)) {
      toast("Date et montant requis", "error")
      return
    }
    try {
      await api.addEngagementRevision({
        engagement_id: e.id,
        effective_date: revForm.effective_date,
        amount,
        currency: e.currency,
        change_reason: revForm.change_reason || null,
        notes: revForm.notes || null,
      })
      toast("Révision ajoutée", "success")
      setShowRevForm(false)
      setRevForm({ effective_date: today(), amount: "", change_reason: "", notes: "" })
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const submitChild = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!childForm.name.trim()) return
    const amount = childForm.amount ? parseFloat(childForm.amount) : null
    if (childForm.amount && (Number.isNaN(amount as number) || (amount as number) < 0)) {
      toast("Montant invalide", "error")
      return
    }
    try {
      // Inherit creditor/payment card/method from parent so quick-adds (a
      // parking spot under a rent) match the parent without extra clicks.
      // The user can refine on the child's detail page if needed.
      await api.createEngagement({
        name: childForm.name.trim(),
        engagement_type: childForm.engagement_type,
        parent_engagement_id: e.id,
        creditor_id: e.creditor_id,
        payment_card_id: e.payment_card_id,
        contract_reference: childForm.contract_reference || null,
        billing_cycle: childForm.billing_cycle,
        cycle_interval: 1,
        next_due_date: e.next_due_date,
        current_amount: amount,
        currency: e.currency,
        payment_method: e.payment_method,
        auto_pay: e.auto_pay,
        status: "active",
      })
      toast(t("engagements.created"), "success")
      setShowChildForm(false)
      setChildForm((f) => ({ ...f, name: "", amount: "", contract_reference: "" }))
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleDeleteRevision = async () => {
    if (!deleteRevisionTarget) return
    try {
      await api.deleteEngagementRevision(deleteRevisionTarget)
      toast("Révision supprimée", "success")
      setDeleteRevisionTarget(null)
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const chargeStatusLabel = (s: api.ChargeStatus): string => {
    switch (s) {
      case "scheduled": return t("charges.statusScheduled")
      case "paid":      return t("charges.statusPaid")
      case "late":      return t("charges.statusLate")
      case "disputed":  return t("charges.statusDisputed")
      case "waived":    return t("charges.statusWaived")
    }
  }
  const chargeStatusBadge = (s: api.ChargeStatus) => {
    if (s === "paid") return <Badge variant="success">{chargeStatusLabel(s)}</Badge>
    if (s === "scheduled") return <Badge variant="secondary">{chargeStatusLabel(s)}</Badge>
    if (s === "late") return <Badge variant="destructive">{chargeStatusLabel(s)}</Badge>
    return <Badge variant="warning">{chargeStatusLabel(s)}</Badge>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/engagements")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-bold truncate">{e.name}</h2>
              <Badge variant={e.status === "active" ? "success" : e.status === "suspended" ? "warning" : "secondary"}>
                {e.status === "active" ? t("engagements.statusActive") :
                 e.status === "suspended" ? t("engagements.statusSuspended") :
                 t("engagements.statusEnded")}
              </Badge>
              {e.parent_name && (
                <Badge variant="secondary">
                  ↳ {e.parent_name}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {t(typeKey)}{e.creditor_name ? ` · ${e.creditor_name}` : ""}{e.contract_reference ? ` · ${e.contract_reference}` : ""}
            </p>
          </div>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setDeleteEngagementOpen(true)}>
          <Trash2 className="h-4 w-4" />{t("common.delete")}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b">
        {([
          ["overview", ListChecks, t("engagements.tabOverview")],
          ["charges", History, `${t("engagements.tabCharges")} (${charges.length})`],
          ["revisions", FileText, `${t("engagements.tabRevisions")} (${revisions.length})`],
          ["attachments", Paperclip, t("engagements.tabAttachments")],
          ["children", Layers, `${t("engagements.tabChildren")} (${children.length})`],
        ] as const).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-lg">{t("engagements.currentAmount")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {e.current_amount != null && (
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("engagements.currentAmount")}</p>
                    <p className="text-2xl font-semibold">{formatPrice(e.current_amount, e.currency)}</p>
                    <p className="text-xs text-muted-foreground">{t(cycleKey)}{e.cycle_interval > 1 ? ` ×${e.cycle_interval}` : ""}</p>
                  </div>
                  {e.billing_cycle !== "one_shot" && (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">{t("engagements.monthlyEquivalent")}</p>
                        <p className="text-2xl font-semibold">{formatPrice(monthly, e.currency)}</p>
                        <p className="text-xs text-muted-foreground">/ mois</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Équivalent annuel</p>
                        <p className="text-2xl font-semibold">{formatPrice(yearly, e.currency)}</p>
                        <p className="text-xs text-muted-foreground">/ an</p>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3 text-sm pt-2">
                {e.next_due_date && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("engagements.nextDue")}</p>
                    <p className={cn("font-medium", dueColor)}>
                      {formatDate(e.next_due_date)} {days != null && (days < 0 ? `(retard ${-days}j)` : `(dans ${days}j)`)}
                    </p>
                  </div>
                )}
                {e.payment_method && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("engagements.paymentMethod")}</p>
                    <p className="font-medium">
                      {e.payment_method === "direct_debit" ? t("engagements.methodDirectDebit") :
                       e.payment_method === "qr_bill" ? t("engagements.methodQrBill") :
                       e.payment_method === "bvr" ? t("engagements.methodBvr") :
                       e.payment_method === "manual_transfer" ? t("engagements.methodManualTransfer") :
                       e.payment_method === "standing_order" ? t("engagements.methodStandingOrder") :
                       e.payment_method === "cash" ? t("engagements.methodCash") :
                       e.payment_method === "card_auto" ? t("engagements.methodCardAuto") :
                       t("engagements.methodOther")}
                      {e.auto_pay && " · auto"}
                    </p>
                  </div>
                )}
                {e.card_name && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("engagements.card")}</p>
                    <p className="font-medium">{e.card_name}</p>
                  </div>
                )}
                {e.contract_start_date && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("engagements.contractStart")}</p>
                    <p className="font-medium">{formatDate(e.contract_start_date)}</p>
                  </div>
                )}
                {e.contract_end_date && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("engagements.contractEnd")}</p>
                    <p className="font-medium">{formatDate(e.contract_end_date)}{e.notice_period_days ? ` (préavis ${e.notice_period_days}j)` : ""}</p>
                  </div>
                )}
              </div>
              {e.notes && (
                <div className="pt-2 border-t text-sm">
                  <p className="text-xs text-muted-foreground">{t("engagements.notes")}</p>
                  <p className="whitespace-pre-wrap">{e.notes}</p>
                </div>
              )}
              {e.clauses_json && (
                <div className="pt-2 border-t space-y-2">
                  <p className="text-xs text-muted-foreground">{t("engagements.clauses")}</p>
                  <ClausesEditor value={e.clauses_json} onChange={() => {}} readOnly />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">Cumul {today().slice(0, 4)}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">Total payé YTD</p>
              <p className="text-3xl font-bold">{formatPrice(totalPaidYTD, e.currency)}</p>
              <p className="text-xs text-muted-foreground pt-2">{charges.length} échéance{charges.length > 1 ? "s" : ""} enregistrée{charges.length > 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "charges" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowChargeForm((v) => !v)}>
              <Plus className="h-4 w-4" />{t("engagements.addCharge")}
            </Button>
          </div>
          {showChargeForm && (
            <Card>
              <CardContent className="pt-4">
                <form onSubmit={submitCharge} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("charges.dueDate")} *</label>
                    <Input type="date" value={chargeForm.due_date} onChange={(ev) => setChargeForm({ ...chargeForm, due_date: ev.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("charges.amount")} *</label>
                    <Input type="number" step="0.01" value={chargeForm.amount} onChange={(ev) => setChargeForm({ ...chargeForm, amount: ev.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("charges.reference")}</label>
                    <Input value={chargeForm.reference_number} onChange={(ev) => setChargeForm({ ...chargeForm, reference_number: ev.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("charges.invoiceNumber")}</label>
                    <Input value={chargeForm.invoice_number} onChange={(ev) => setChargeForm({ ...chargeForm, invoice_number: ev.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("charges.paidOn")}</label>
                    <Input type="date" value={chargeForm.paid_on} onChange={(ev) => setChargeForm({ ...chargeForm, paid_on: ev.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("engagements.card")}</label>
                    <select
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={chargeForm.payment_card_id}
                      onChange={(ev) => setChargeForm({ ...chargeForm, payment_card_id: ev.target.value })}
                    >
                      <option value="">—</option>
                      {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{t("engagements.notes")}</label>
                    <Input value={chargeForm.notes} onChange={(ev) => setChargeForm({ ...chargeForm, notes: ev.target.value })} />
                  </div>
                  <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                    <Button type="submit" size="sm">{t("common.add")}</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowChargeForm(false)}>{t("common.cancel")}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
          {charges.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">{t("charges.noCharges")}</CardContent></Card>
          ) : charges.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{formatDate(c.due_date)}</p>
                    {chargeStatusBadge(c.status)}
                    {c.paid_on && <span className="text-xs text-muted-foreground">→ payée {formatDate(c.paid_on)}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                    {c.reference_number && <span className="font-mono">{c.reference_number}</span>}
                    {c.invoice_number && <span>n° {c.invoice_number}</span>}
                    {c.card_name && <span>{c.card_name}</span>}
                  </div>
                </div>
                <p className="font-semibold shrink-0">{formatPrice(c.amount, c.currency)}</p>
                <div className="flex gap-1 shrink-0">
                  {c.status !== "paid" && (
                    <Button variant="ghost" size="icon" onClick={() => handleMarkPaid(c.id)} title={t("engagements.markPaid")}>
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => setDeleteChargeTarget(c.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "revisions" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowRevForm((v) => !v)}>
              <Plus className="h-4 w-4" />{t("engagements.addRevision")}
            </Button>
          </div>
          {showRevForm && (
            <Card>
              <CardContent className="pt-4">
                <form onSubmit={submitRevision} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("revisions.effectiveDate")} *</label>
                    <Input type="date" value={revForm.effective_date} onChange={(ev) => setRevForm({ ...revForm, effective_date: ev.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("revisions.amount")} *</label>
                    <Input type="number" step="0.01" value={revForm.amount} onChange={(ev) => setRevForm({ ...revForm, amount: ev.target.value })} required />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{t("revisions.changeReason")}</label>
                    <Input value={revForm.change_reason} onChange={(ev) => setRevForm({ ...revForm, change_reason: ev.target.value })} placeholder="Avenant 2026, indexation…" />
                  </div>
                  <div className="space-y-2 sm:col-span-2 lg:col-span-4">
                    <label className="text-sm font-medium">{t("engagements.notes")}</label>
                    <Input value={revForm.notes} onChange={(ev) => setRevForm({ ...revForm, notes: ev.target.value })} />
                  </div>
                  <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                    <Button type="submit" size="sm">{t("common.add")}</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowRevForm(false)}>{t("common.cancel")}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
          {revisions.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">{t("revisions.noRevisions")}</CardContent></Card>
          ) : revisions.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{formatDate(r.effective_date)}</p>
                  {r.change_reason && <p className="text-xs text-muted-foreground">{r.change_reason}</p>}
                  {r.notes && <p className="text-xs mt-1">{r.notes}</p>}
                </div>
                <p className="font-semibold shrink-0">{formatPrice(r.amount, r.currency)}</p>
                <Button variant="ghost" size="icon" onClick={() => setDeleteRevisionTarget(r.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "attachments" && (
        <AttachmentsPanel
          engagementId={e.id}
          itemDescription={e.name}
        />
      )}

      {tab === "children" && (() => {
        const childMonthly = children
          .filter((c) => c.current_amount != null && c.billing_cycle !== "one_shot")
          .reduce((acc, c) => acc + monthlyEquivalent(c.current_amount as number, c.billing_cycle, c.cycle_interval), 0)
        const aggregated = monthly + childMonthly
        return (
        <div className="space-y-3">
          {children.length > 0 && (
            <Card className="bg-muted/30">
              <CardContent className="p-4 grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Parent /mois</p>
                  <p className="text-xl font-semibold">{formatPrice(monthly, e.currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Sous-engagements /mois</p>
                  <p className="text-xl font-semibold">{formatPrice(childMonthly, e.currency)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total /mois</p>
                  <p className="text-2xl font-bold text-primary">{formatPrice(aggregated, e.currency)}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowChildForm((v) => !v)}>
              <Plus className="h-4 w-4" />{t("engagements.addChild")}
            </Button>
          </div>

          {showChildForm && (
            <Card>
              <CardContent className="pt-4">
                <form onSubmit={submitChild} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{t("engagements.name")} *</label>
                    <Input
                      value={childForm.name}
                      onChange={(ev) => setChildForm({ ...childForm, name: ev.target.value })}
                      placeholder="ex: Place de parc n°12"
                      required
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("engagements.type")}</label>
                    <select
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={childForm.engagement_type}
                      onChange={(ev) => setChildForm({ ...childForm, engagement_type: ev.target.value as api.EngagementType })}
                    >
                      <option value="parking">{t("engagements.type.parking")}</option>
                      <option value="rent">{t("engagements.type.rent")}</option>
                      <option value="leasing">{t("engagements.type.leasing")}</option>
                      <option value="electricity">{t("engagements.type.electricity")}</option>
                      <option value="gas">{t("engagements.type.gas")}</option>
                      <option value="water">{t("engagements.type.water")}</option>
                      <option value="heating">{t("engagements.type.heating")}</option>
                      <option value="fee">{t("engagements.type.fee")}</option>
                      <option value="other">{t("engagements.type.other")}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("engagements.currentAmount")} *</label>
                    <Input
                      type="number" step="0.01" min="0"
                      value={childForm.amount}
                      onChange={(ev) => setChildForm({ ...childForm, amount: ev.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("engagements.billingCycle")}</label>
                    <select
                      className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={childForm.billing_cycle}
                      onChange={(ev) => setChildForm({ ...childForm, billing_cycle: ev.target.value as api.EngagementBillingCycle })}
                    >
                      <option value="monthly">{t("engagements.cycleMonthly")}</option>
                      <option value="quarterly">{t("engagements.cycleQuarterly")}</option>
                      <option value="semiannual">{t("engagements.cycleSemiannual")}</option>
                      <option value="yearly">{t("engagements.cycleYearly")}</option>
                      <option value="one_shot">{t("engagements.cycleOneShot")}</option>
                    </select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{t("engagements.contractRef")}</label>
                    <Input
                      value={childForm.contract_reference}
                      onChange={(ev) => setChildForm({ ...childForm, contract_reference: ev.target.value })}
                      placeholder="ex: Box 17 - sous-sol B"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
                    Créancier, moyen de paiement, prochaine échéance et auto-paiement sont hérités du parent. Modifiable ensuite depuis le sous-engagement.
                  </p>
                  <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                    <Button type="submit" size="sm">{t("common.add")}</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowChildForm(false)}>{t("common.cancel")}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {children.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Aucun sous-engagement. Ajoutez par exemple une place de parc rattachée à ce loyer.</CardContent></Card>
          ) : children.map((c) => {
            const cMonthly = c.current_amount != null && c.billing_cycle !== "one_shot"
              ? monthlyEquivalent(c.current_amount, c.billing_cycle, c.cycle_interval)
              : 0
            return (
              <Card key={c.id}>
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <Link to={`/engagements/${c.id}`} className="min-w-0 flex-1">
                    <p className="font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`engagements.type.${c.engagement_type}` as keyof TranslationKeys)}
                      {c.contract_reference && ` · ${c.contract_reference}`}
                    </p>
                  </Link>
                  <div className="text-right shrink-0">
                    {c.current_amount != null && (
                      <p className="font-semibold">{formatPrice(c.current_amount, c.currency)}</p>
                    )}
                    {cMonthly > 0 && cMonthly !== c.current_amount && (
                      <p className="text-xs text-muted-foreground">≈ {formatPrice(cMonthly, c.currency)}/mois</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
        )
      })()}

      <ConfirmDialog
        open={deleteEngagementOpen}
        title={t("engagements.deleted")}
        message={t("engagements.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDeleteEngagement}
        onCancel={() => setDeleteEngagementOpen(false)}
      />
      <ConfirmDialog
        open={deleteChargeTarget !== null}
        title="Supprimer l'échéance"
        message="Cette échéance sera supprimée définitivement."
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDeleteCharge}
        onCancel={() => setDeleteChargeTarget(null)}
      />
      <ConfirmDialog
        open={deleteRevisionTarget !== null}
        title="Supprimer la révision"
        message="Cette révision sera supprimée définitivement."
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDeleteRevision}
        onCancel={() => setDeleteRevisionTarget(null)}
      />
    </div>
  )
}

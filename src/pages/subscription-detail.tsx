import { useContext, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Plus, Trash2, RefreshCw, Users, Receipt, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { formatPrice, formatDate, daysUntil } from "@/lib/utils"
import { I18nContext } from "@/lib/i18n"
import * as api from "@/lib/tauri"

const today = () => new Date().toISOString().slice(0, 10)

export function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useContext(I18nContext)
  const { toast } = useToast()

  const [sub, setSub] = useState<api.Subscription | null>(null)
  const [members, setMembers] = useState<api.SubscriptionMember[]>([])
  const [payments, setPayments] = useState<api.SubscriptionPayment[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteSubOpen, setDeleteSubOpen] = useState(false)
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<string | null>(null)
  const [deleteMemberTarget, setDeleteMemberTarget] = useState<string | null>(null)

  const [memberForm, setMemberForm] = useState({ name: "", share_amount: "", share_percent: "", notes: "" })
  const [showMemberForm, setShowMemberForm] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ paid_on: today(), amount: "", payment_card_id: "", notes: "" })
  const [showPaymentForm, setShowPaymentForm] = useState(false)

  const load = async () => {
    if (!id) return
    try {
      const [s, mem, pay, cs] = await Promise.all([
        api.getSubscription(id),
        api.getSubscriptionMembers(id),
        api.getSubscriptionPayments(id),
        api.getCards(),
      ])
      setSub(s)
      setMembers(mem)
      setPayments(pay)
      setCards(cs)
      setPaymentForm((f) => ({ ...f, amount: String(s.price), payment_card_id: s.payment_card_id ?? "" }))
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  if (loading || !sub) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const days = daysUntil(sub.next_renewal_date)
  const inTrial = !!sub.trial_end_date && new Date(sub.trial_end_date) >= new Date()

  const handleMarkRenewed = async () => {
    try {
      await api.markRenewed(sub.id)
      toast(t("subscriptions.markedRenewed"), "success")
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDeleteSub = async () => {
    try {
      await api.deleteSubscription(sub.id)
      toast(t("subscriptions.deleted"), "success")
      navigate("/subscriptions")
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const submitMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!memberForm.name.trim()) return
    const share_amount = memberForm.share_amount ? parseFloat(memberForm.share_amount) : null
    const share_percent = memberForm.share_percent ? parseFloat(memberForm.share_percent) : null
    try {
      await api.addSubscriptionMember({
        subscription_id: sub.id,
        name: memberForm.name.trim(),
        share_amount,
        share_percent,
        notes: memberForm.notes.trim() || null,
      })
      setMemberForm({ name: "", share_amount: "", share_percent: "", notes: "" })
      setShowMemberForm(false)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDeleteMember = async () => {
    if (!deleteMemberTarget) return
    try {
      await api.deleteSubscriptionMember(deleteMemberTarget)
      setDeleteMemberTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(paymentForm.amount)
    if (isNaN(amount) || amount < 0) {
      toast("Montant invalide", "error")
      return
    }
    try {
      await api.logSubscriptionPayment({
        subscription_id: sub.id,
        paid_on: paymentForm.paid_on,
        amount,
        currency: sub.currency,
        payment_card_id: paymentForm.payment_card_id || null,
        notes: paymentForm.notes.trim() || null,
      })
      setPaymentForm({ paid_on: today(), amount: String(sub.price), payment_card_id: sub.payment_card_id ?? "", notes: "" })
      setShowPaymentForm(false)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDeletePayment = async () => {
    if (!deletePaymentTarget) return
    try {
      await api.deleteSubscriptionPayment(deletePaymentTarget)
      setDeletePaymentTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const statusBadge = sub.status === "active"
    ? <Badge variant="success">{t("subscriptions.statusActive")}</Badge>
    : sub.status === "paused"
    ? <Badge variant="warning">{t("subscriptions.statusPaused")}</Badge>
    : <Badge variant="secondary">{t("subscriptions.statusCancelled")}</Badge>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/subscriptions")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-3xl font-bold tracking-tight truncate">{sub.name}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {sub.category && <Badge variant="outline">{sub.category}</Badge>}
            {statusBadge}
            {inTrial && <Badge variant="warning">{t("subscriptions.inTrial")}</Badge>}
          </div>
        </div>
        <Button variant="outline" onClick={handleMarkRenewed}>
          <RefreshCw className="h-4 w-4" />{t("subscriptions.markRenewed")}
        </Button>
        <Button variant="outline" onClick={() => setDeleteSubOpen(true)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {/* Summary */}
      <Card>
        <CardContent className="p-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">{t("subscriptions.price")}</p>
            <p className="text-2xl font-bold">{formatPrice(sub.price, sub.currency)}</p>
            <p className="text-xs text-muted-foreground">{sub.billing_cycle}{sub.cycle_interval > 1 && ` ×${sub.cycle_interval}`}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("subscriptions.nextRenewal")}</p>
            <p className="text-lg font-semibold">{formatDate(sub.next_renewal_date)}</p>
            <p className={`text-xs ${days <= 7 ? "text-destructive" : days <= 30 ? "text-amber-600" : "text-muted-foreground"}`}>
              {days === 0 ? "Aujourd'hui" : `Dans ${days}j`}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("subscriptions.merchant")}</p>
            <p className="text-base font-medium">{sub.merchant_name ?? "—"}</p>
            {sub.card_name && <p className="text-xs text-muted-foreground">{sub.card_name}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("subscriptions.autoRenewal")}</p>
            <p className="text-base font-medium">{sub.auto_renewal ? "Oui" : "Non"}</p>
            {sub.cancellation_url && (
              <a
                href={sub.cancellation_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
              >
                <ExternalLink className="h-3 w-3" />Gérer
              </a>
            )}
          </div>
          {sub.notes && (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs text-muted-foreground">{t("subscriptions.notes")}</p>
              <p className="text-sm">{sub.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-4 w-4" />{t("subscriptions.members")} <Badge variant="secondary">{members.length}</Badge>
            </CardTitle>
            <Button size="sm" onClick={() => setShowMemberForm((v) => !v)}>
              <Plus className="h-4 w-4" />{t("subscriptions.addMember")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showMemberForm && (
            <form onSubmit={submitMember} className="grid gap-3 sm:grid-cols-4 p-3 rounded-md border bg-muted/30">
              <Input placeholder={t("subscriptions.memberName")} value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} required autoFocus />
              <Input type="number" step="0.01" placeholder={t("subscriptions.memberShareAmount")} value={memberForm.share_amount} onChange={(e) => setMemberForm({ ...memberForm, share_amount: e.target.value, share_percent: "" })} />
              <Input type="number" step="0.01" placeholder={t("subscriptions.memberSharePercent")} value={memberForm.share_percent} onChange={(e) => setMemberForm({ ...memberForm, share_percent: e.target.value, share_amount: "" })} />
              <div className="flex gap-2">
                <Button type="submit" size="sm">{t("common.add")}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowMemberForm(false)}>{t("common.cancel")}</Button>
              </div>
            </form>
          )}
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-md border p-2">
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.share_amount != null && `${formatPrice(m.share_amount, sub.currency)}`}
                      {m.share_percent != null && `${m.share_percent}%`}
                      {m.notes && ` · ${m.notes}`}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteMemberTarget(m.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Receipt className="h-4 w-4" />{t("subscriptions.payments")} <Badge variant="secondary">{payments.length}</Badge>
            </CardTitle>
            <Button size="sm" onClick={() => setShowPaymentForm((v) => !v)}>
              <Plus className="h-4 w-4" />{t("subscriptions.logPayment")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {showPaymentForm && (
            <form onSubmit={submitPayment} className="grid gap-3 sm:grid-cols-4 p-3 rounded-md border bg-muted/30">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("subscriptions.paidOn")}</label>
                <Input type="date" value={paymentForm.paid_on} onChange={(e) => setPaymentForm({ ...paymentForm, paid_on: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("subscriptions.amount")}</label>
                <Input type="number" step="0.01" min="0" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("subscriptions.card")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={paymentForm.payment_card_id}
                  onChange={(e) => setPaymentForm({ ...paymentForm, payment_card_id: e.target.value })}
                >
                  <option value="">—</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 items-end">
                <Button type="submit" size="sm">{t("common.add")}</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowPaymentForm(false)}>{t("common.cancel")}</Button>
              </div>
              <div className="sm:col-span-4 space-y-1">
                <label className="text-xs text-muted-foreground">{t("subscriptions.notes")}</label>
                <Input value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} />
              </div>
            </form>
          )}
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-md border p-2">
                  <div>
                    <p className="text-sm font-medium">{formatDate(p.paid_on)}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.card_name ?? "—"}{p.notes && ` · ${p.notes}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{formatPrice(p.amount, p.currency)}</span>
                    <Button variant="ghost" size="icon" onClick={() => setDeletePaymentTarget(p.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attachments */}
      <AttachmentsPanel
        subscriptionId={sub.id}
        itemDescription={sub.name}
        templateContext={{
          merchant: sub.merchant_name ?? undefined,
          date: sub.start_date,
          currency: sub.currency,
        }}
      />

      <ConfirmDialog
        open={deleteSubOpen}
        title={t("common.delete")}
        message={t("subscriptions.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDeleteSub}
        onCancel={() => setDeleteSubOpen(false)}
      />
      <ConfirmDialog
        open={deletePaymentTarget !== null}
        title={t("common.delete")}
        message="Ce paiement sera supprimé de l'historique."
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDeletePayment}
        onCancel={() => setDeletePaymentTarget(null)}
      />
      <ConfirmDialog
        open={deleteMemberTarget !== null}
        title={t("common.delete")}
        message="Ce membre sera supprimé."
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDeleteMember}
        onCancel={() => setDeleteMemberTarget(null)}
      />
    </div>
  )
}

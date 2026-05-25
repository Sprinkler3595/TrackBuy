import { useContext, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Plus, Trash2, ListChecks, History, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { formatDate, daysUntil, cn } from "@/lib/utils"
import { monthlyEquivalent } from "@/lib/finance"
import { MaskedAmount, VisibilityToggle, useAmountsVisible } from "@/components/features/amount-masked"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import * as api from "@/lib/tauri"

const today = () => new Date().toISOString().slice(0, 10)

type Tab = "overview" | "receipts" | "attachments"

export function IncomeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useContext(I18nContext)
  const { toast } = useToast()

  const [income, setIncome] = useState<api.Income | null>(null)
  const [receipts, setReceipts] = useState<api.IncomeReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>("overview")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteReceiptTarget, setDeleteReceiptTarget] = useState<string | null>(null)
  const [amountsVisible, setAmountsVisible] = useAmountsVisible()
  const [showPayslipDetail, setShowPayslipDetail] = useState(false)

  // Receipt form (basic + optional payslip detail).
  const [form, setForm] = useState({
    received_on: today(),
    amount: "",
    period_label: "",
    gross_amount: "",
    social_charges_amount: "",
    pension_amount: "",
    tax_at_source_amount: "",
    other_deductions_amount: "",
    bonus_amount: "",
    notes: "",
  })
  const [showForm, setShowForm] = useState(false)

  const load = async () => {
    if (!id) return
    try {
      const [inc, recs] = await Promise.all([
        api.getIncome(id),
        api.getIncomeReceipts(id),
      ])
      setIncome(inc)
      setReceipts(recs)
      setForm((f) => ({ ...f, amount: inc.current_amount?.toString() || "" }))
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [id])

  if (loading || !income) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  const i = income
  const typeKey = `incomes.type.${i.income_type}` as keyof TranslationKeys
  const cycleKey = (
    i.billing_cycle === "monthly"   ? "engagements.cycleMonthly" :
    i.billing_cycle === "quarterly" ? "engagements.cycleQuarterly" :
    i.billing_cycle === "yearly"    ? "engagements.cycleYearly" :
    i.billing_cycle === "one_shot"  ? "engagements.cycleOneShot" :
                                       "engagements.cycleCustom"
  ) as keyof TranslationKeys

  const monthly = i.current_amount != null && i.billing_cycle !== "one_shot"
    ? monthlyEquivalent(i.current_amount, i.billing_cycle, i.cycle_interval)
    : 0
  const yearly = monthly * 12

  const days = i.next_expected_date ? daysUntil(i.next_expected_date) : null
  const dueColor =
    days == null ? "" :
    days < 0 ? "text-destructive" :
    days <= 7 ? "text-amber-600 dark:text-amber-500" :
    "text-muted-foreground"

  const totalYTD = receipts
    .filter((r) => r.received_on.slice(0, 4) === today().slice(0, 4))
    .reduce((acc, r) => acc + r.amount, 0)

  const handleDelete = async () => {
    try {
      await api.deleteIncome(i.id)
      toast(t("incomes.deleted"), "success")
      navigate("/incomes")
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const submitReceipt = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const amount = parseFloat(form.amount)
    if (!form.received_on || Number.isNaN(amount)) {
      toast("Date et montant requis", "error")
      return
    }
    const parseOpt = (v: string): number | null => {
      if (!v.trim()) return null
      const n = parseFloat(v)
      return Number.isNaN(n) ? null : n
    }
    try {
      await api.logIncomeReceipt({
        income_id: i.id,
        received_on: form.received_on,
        amount,
        currency: i.currency,
        period_label: form.period_label || null,
        gross_amount: parseOpt(form.gross_amount),
        social_charges_amount: parseOpt(form.social_charges_amount),
        pension_amount: parseOpt(form.pension_amount),
        tax_at_source_amount: parseOpt(form.tax_at_source_amount),
        other_deductions_amount: parseOpt(form.other_deductions_amount),
        bonus_amount: parseOpt(form.bonus_amount),
        notes: form.notes || null,
      })
      toast("Versement enregistré", "success")
      setShowForm(false)
      setShowPayslipDetail(false)
      setForm({
        received_on: today(),
        amount: i.current_amount?.toString() || "",
        period_label: "",
        gross_amount: "",
        social_charges_amount: "",
        pension_amount: "",
        tax_at_source_amount: "",
        other_deductions_amount: "",
        bonus_amount: "",
        notes: "",
      })
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleDeleteReceipt = async () => {
    if (!deleteReceiptTarget) return
    try {
      await api.deleteIncomeReceipt(deleteReceiptTarget)
      toast("Versement supprimé", "success")
      setDeleteReceiptTarget(null)
      await load()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  // Sum of all known deductions on a receipt; used in the payslip
  // sanity-check chip on each row.
  const totalDeductions = (r: api.IncomeReceipt): number => {
    return (r.social_charges_amount ?? 0)
         + (r.pension_amount ?? 0)
         + (r.tax_at_source_amount ?? 0)
         + (r.other_deductions_amount ?? 0)
  }
  const expectedNet = (r: api.IncomeReceipt): number | null => {
    if (r.gross_amount == null) return null
    return r.gross_amount + (r.bonus_amount ?? 0) - totalDeductions(r)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/incomes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-bold truncate">{i.name}</h2>
              <Badge variant={i.status === "active" ? "success" : "secondary"}>
                {i.status === "active" ? t("incomes.statusActive") : t("incomes.statusEnded")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t(typeKey)}{i.source_name ? ` · ${i.source_name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VisibilityToggle
            visible={amountsVisible}
            onChange={setAmountsVisible}
            labelShow={t("incomes.showAmounts")}
            labelHide={t("incomes.hideAmounts")}
          />
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" />{t("common.delete")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {([
          ["overview", ListChecks, t("engagements.tabOverview")],
          ["receipts", History, `${t("incomes.receipts")} (${receipts.length})`],
          ["attachments", Paperclip, t("incomes.attachments")],
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
            <CardHeader><CardTitle className="text-lg">{t("incomes.currentAmount")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {i.current_amount != null && (
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.currentAmount")}</p>
                    <p className="text-2xl font-semibold">
                      <MaskedAmount amount={i.current_amount} currency={i.currency} visible={amountsVisible} />
                    </p>
                    <p className="text-xs text-muted-foreground">{t(cycleKey)}{i.cycle_interval > 1 ? ` ×${i.cycle_interval}` : ""}</p>
                  </div>
                  {i.billing_cycle !== "one_shot" && (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">Équivalent mensuel</p>
                        <p className="text-2xl font-semibold">
                          <MaskedAmount amount={monthly} currency={i.currency} visible={amountsVisible} />
                        </p>
                        <p className="text-xs text-muted-foreground">/ mois</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Équivalent annuel</p>
                        <p className="text-2xl font-semibold">
                          <MaskedAmount amount={yearly} currency={i.currency} visible={amountsVisible} />
                        </p>
                        <p className="text-xs text-muted-foreground">/ an</p>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3 text-sm pt-2">
                {i.next_expected_date && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.nextExpected")}</p>
                    <p className={cn("font-medium", dueColor)}>
                      {formatDate(i.next_expected_date)} {days != null && (days < 0 ? `(retard ${-days}j)` : `(dans ${days}j)`)}
                    </p>
                  </div>
                )}
                {i.card_name && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.card")}</p>
                    <p className="font-medium">{i.card_name}</p>
                  </div>
                )}
                {i.started_on && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.startedOn")}</p>
                    <p className="font-medium">{formatDate(i.started_on)}</p>
                  </div>
                )}
                {i.ended_on && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t("incomes.endedOn")}</p>
                    <p className="font-medium">{formatDate(i.ended_on)}</p>
                  </div>
                )}
              </div>
              {i.notes && (
                <div className="pt-2 border-t text-sm">
                  <p className="text-xs text-muted-foreground">{t("incomes.notes")}</p>
                  <p className="whitespace-pre-wrap">{i.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-lg">{t("incomes.totalYTD")} {today().slice(0, 4)}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-3xl font-bold">
                <MaskedAmount amount={totalYTD} currency={i.currency} visible={amountsVisible} />
              </p>
              <p className="text-xs text-muted-foreground pt-2">{receipts.length} versement{receipts.length > 1 ? "s" : ""} enregistré{receipts.length > 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "receipts" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus className="h-4 w-4" />{t("incomes.logReceipt")}
            </Button>
          </div>
          {showForm && (
            <Card>
              <CardContent className="pt-4">
                <form onSubmit={submitReceipt} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("incomes.receivedOn")} *</label>
                    <Input type="date" value={form.received_on} onChange={(ev) => setForm({ ...form, received_on: ev.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t("incomes.amount")} *</label>
                    <Input type="number" step="0.01" value={form.amount} onChange={(ev) => setForm({ ...form, amount: ev.target.value })} required />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <label className="text-sm font-medium">{t("incomes.periodLabel")}</label>
                    <Input value={form.period_label} onChange={(ev) => setForm({ ...form, period_label: ev.target.value })} placeholder="ex: Mars 2026" />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-4">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPayslipDetail((v) => !v)}
                    >
                      {showPayslipDetail ? "−" : "+"} {t("incomes.payslipDetail")}
                    </Button>
                  </div>

                  {showPayslipDetail && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("incomes.grossAmount")}</label>
                        <Input type="number" step="0.01" value={form.gross_amount} onChange={(ev) => setForm({ ...form, gross_amount: ev.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("incomes.socialCharges")}</label>
                        <Input type="number" step="0.01" value={form.social_charges_amount} onChange={(ev) => setForm({ ...form, social_charges_amount: ev.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("incomes.pension")}</label>
                        <Input type="number" step="0.01" value={form.pension_amount} onChange={(ev) => setForm({ ...form, pension_amount: ev.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("incomes.taxAtSource")}</label>
                        <Input type="number" step="0.01" value={form.tax_at_source_amount} onChange={(ev) => setForm({ ...form, tax_at_source_amount: ev.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("incomes.otherDeductions")}</label>
                        <Input type="number" step="0.01" value={form.other_deductions_amount} onChange={(ev) => setForm({ ...form, other_deductions_amount: ev.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">{t("incomes.bonus")}</label>
                        <Input type="number" step="0.01" value={form.bonus_amount} onChange={(ev) => setForm({ ...form, bonus_amount: ev.target.value })} />
                      </div>
                    </>
                  )}

                  <div className="space-y-2 sm:col-span-2 lg:col-span-4">
                    <label className="text-sm font-medium">{t("incomes.notes")}</label>
                    <Input value={form.notes} onChange={(ev) => setForm({ ...form, notes: ev.target.value })} />
                  </div>
                  <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                    <Button type="submit" size="sm">{t("common.add")}</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
          {receipts.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">{t("incomes.noReceipts")}</CardContent></Card>
          ) : receipts.map((r) => {
            const deductions = totalDeductions(r)
            const expected = expectedNet(r)
            const matchesGross = expected != null && Math.abs(expected - r.amount) < 1
            return (
              <Card key={r.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{formatDate(r.received_on)}</p>
                        {r.period_label && <Badge variant="secondary">{r.period_label}</Badge>}
                      </div>
                      {r.gross_amount != null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Brut <MaskedAmount amount={r.gross_amount} currency={r.currency} visible={amountsVisible} />
                          {deductions > 0 && <> · Retenues <MaskedAmount amount={deductions} currency={r.currency} visible={amountsVisible} /></>}
                          {expected != null && (
                            <span className={cn("ml-2", matchesGross ? "text-green-600" : "text-amber-600")}>
                              {matchesGross ? "✓" : `≈ ${expected.toFixed(2)}`}
                            </span>
                          )}
                        </p>
                      )}
                      {r.notes && <p className="text-xs text-muted-foreground mt-1">{r.notes}</p>}
                    </div>
                    <p className="font-semibold shrink-0">
                      <MaskedAmount amount={r.amount} currency={r.currency} visible={amountsVisible} />
                    </p>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteReceiptTarget(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {tab === "attachments" && (
        <AttachmentsPanel
          incomeId={i.id}
          itemDescription={i.name}
          templateContext={{
            merchant: i.source_name ?? undefined,
            description: i.name,
            date: today(),
          }}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={t("incomes.deleted")}
        message={t("incomes.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
      <ConfirmDialog
        open={deleteReceiptTarget !== null}
        title="Supprimer le versement"
        message="Ce versement et ses pièces jointes seront supprimés définitivement."
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDeleteReceipt}
        onCancel={() => setDeleteReceiptTarget(null)}
      />
    </div>
  )
}

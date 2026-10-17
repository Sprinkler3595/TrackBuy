import { useEffect, useMemo, useState, useContext } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, Trash2, Edit, TrendingUp, Search, Download, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { formatDate, daysUntil } from "@/lib/utils"
import { SUPPORTED_CURRENCIES } from "@/lib/currencies"
import { monthlyEquivalent } from "@/lib/finance"
import { downloadExport } from "@/lib/export"
import { MaskedAmount, VisibilityToggle, useAmountsVisible } from "@/components/features/amount-masked"
import { IncomeWizard } from "@/components/features/income-wizard"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import * as api from "@/lib/tauri"

const ALL_TYPES: api.IncomeType[] = [
  "salary", "bonus", "thirteenth", "pension",
  "unemployment", "family_allowance", "dividend",
  "rental", "gift", "reimbursement", "other",
]

const CYCLES: api.IncomeBillingCycle[] = [
  "monthly", "quarterly", "yearly", "one_shot", "custom",
]

const today = () => new Date().toISOString().slice(0, 10)

type FormState = {
  name: string
  income_type: api.IncomeType
  source_name: string
  payment_card_id: string
  billing_cycle: api.IncomeBillingCycle
  cycle_interval: string
  next_expected_date: string
  current_amount: string
  currency: string
  status: api.IncomeStatus
  started_on: string
  ended_on: string
  notes: string
}

const emptyForm = (): FormState => ({
  name: "",
  income_type: "salary",
  source_name: "",
  payment_card_id: "",
  billing_cycle: "monthly",
  cycle_interval: "1",
  next_expected_date: today(),
  current_amount: "",
  currency: "CHF",
  status: "active",
  started_on: "",
  ended_on: "",
  notes: "",
})

export function IncomesPage() {
  const { t } = useContext(I18nContext)
  const navigate = useNavigate()
  const [incomes, setIncomes] = useState<api.Income[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.Income | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [statusFilter, setStatusFilter] = useState<"all" | api.IncomeStatus>("active")
  const [typeFilter, setTypeFilter] = useState<"all" | api.IncomeType>("all")
  // Creation goes through the guided assistant; the form below only edits.
  const [showWizard, setShowWizard] = useState(false)
  const [search, setSearch] = useState("")
  const [amountsVisible, setAmountsVisible] = useAmountsVisible()
  const { toast } = useToast()

  const load = async () => {
    try {
      const [incData, cardData] = await Promise.all([
        api.getIncomes(),
        api.getCards(),
      ])
      setIncomes(incData)
      setCards(cardData)
    } catch (e) {
      console.error(e)
      toast(`Erreur: ${e}`, "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => { setForm(emptyForm()); setEditing(null); setShowForm(false) }

  const handleEdit = (i: api.Income) => {
    setForm({
      name: i.name,
      income_type: i.income_type,
      source_name: i.source_name || "",
      payment_card_id: i.payment_card_id || "",
      billing_cycle: i.billing_cycle,
      cycle_interval: i.cycle_interval.toString(),
      next_expected_date: i.next_expected_date || today(),
      current_amount: i.current_amount?.toString() || "",
      currency: i.currency,
      status: i.status,
      started_on: i.started_on || "",
      ended_on: i.ended_on || "",
      notes: i.notes || "",
    })
    setEditing(i)
    setShowForm(true)
  }

  // Edit-only: new incomes come from the guided assistant.
  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!editing || !form.name.trim()) return
    const amount = form.current_amount ? parseFloat(form.current_amount) : null
    if (form.current_amount && (Number.isNaN(amount as number) || (amount as number) < 0)) {
      toast("Montant invalide", "error")
      return
    }
    const interval = Math.max(1, parseInt(form.cycle_interval) || 1)
    try {
      await api.updateIncome({
        ...editing,
        name: form.name.trim(),
        income_type: form.income_type,
        source_name: form.source_name || null,
        payment_card_id: form.payment_card_id || null,
        billing_cycle: form.billing_cycle,
        cycle_interval: interval,
        next_expected_date: form.next_expected_date || null,
        current_amount: amount,
        currency: form.currency,
        status: form.status,
        started_on: form.started_on || null,
        // Un revenu actif n'a pas de date de fin, et un revenu terminé sans
        // date de fin est un trou dans l'historique : les deux champs se
        // tiennent, on ne les laisse pas diverger.
        ended_on: form.status === "ended" ? form.ended_on || null : null,
        notes: form.notes || null,
      })
      toast(t("incomes.updated"), "success")
      resetForm()
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteIncome(deleteTarget)
      toast(t("incomes.deleted"), "success")
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const typeKey = (typ: api.IncomeType): keyof TranslationKeys =>
    `incomes.type.${typ}` as keyof TranslationKeys

  const cycleLabel = (i: api.Income): string => {
    const base =
      i.billing_cycle === "monthly"   ? t("engagements.cycleMonthly") :
      i.billing_cycle === "quarterly" ? t("engagements.cycleQuarterly") :
      i.billing_cycle === "yearly"    ? t("engagements.cycleYearly") :
      i.billing_cycle === "one_shot"  ? t("engagements.cycleOneShot") :
                                         t("engagements.cycleCustom")
    return i.cycle_interval > 1 ? `${base} ×${i.cycle_interval}` : base
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return incomes.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false
      if (typeFilter !== "all" && i.income_type !== typeFilter) return false
      if (!q) return true
      return (
        i.name.toLowerCase().includes(q) ||
        (i.source_name ?? "").toLowerCase().includes(q)
      )
    })
  }, [incomes, statusFilter, typeFilter, search])

  const monthlyTotal = useMemo(() => {
    return incomes
      .filter((i) => i.status === "active" && i.current_amount != null && i.billing_cycle !== "one_shot")
      .reduce((acc, i) => acc + monthlyEquivalent(i.current_amount as number, i.billing_cycle, i.cycle_interval), 0)
  }, [incomes])

  const statusBadge = (s: api.IncomeStatus) => {
    if (s === "active") return <Badge variant="success">{t("incomes.statusActive")}</Badge>
    return <Badge variant="secondary">{t("incomes.statusEnded")}</Badge>
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("incomes.title")}</h2>
          <p className="text-muted-foreground">
            {incomes.length} · {t("incomes.monthlyTotal")} :{" "}
            <span className="font-medium">
              <MaskedAmount amount={monthlyTotal} currency="CHF" visible={amountsVisible} />
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VisibilityToggle
            visible={amountsVisible}
            onChange={setAmountsVisible}
            labelShow={t("incomes.showAmounts")}
            labelHide={t("incomes.hideAmounts")}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/incomes/carriere")}
            title="Cotisations année par année, employeurs quittés compris"
          >
            <History className="h-4 w-4" />
            Carrière
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const stamp = today().slice(0, 7)
                const [hdr, recpts, certs] = await Promise.all([
                  api.exportIncomesCsv(),
                  api.exportIncomeReceiptsCsv(),
                  api.exportSalaryCertificatesCsv(),
                ])
                await downloadExport(hdr, `revenus-${stamp}.csv`)
                await downloadExport(recpts, `revenus-bulletins-${stamp}.csv`)
                await downloadExport(certs, `certificats-salaire-${stamp}.csv`)
              } catch (e) {
                toast(`${t("incomes.exportError")}: ${e}`, "error")
              }
            }}
            title={t("incomes.exportCsvTitle")}
          >
            <Download className="h-4 w-4" />
            {t("incomes.exportCsv")}
          </Button>
          <Button onClick={() => setShowWizard(true)}>
            <Plus className="h-4 w-4" />{t("incomes.new")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "active", "ended"] as const).map((k) => (
          <Button
            key={k}
            variant={statusFilter === k ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(k)}
          >
            {k === "all" ? t("common.all") :
             k === "active" ? t("incomes.statusActive") :
             t("incomes.statusEnded")}
          </Button>
        ))}
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | api.IncomeType)}
          aria-label={t("incomes.filterType")}
        >
          <option value="all">{t("incomes.filterType")} — {t("common.all")}</option>
          {ALL_TYPES.map((typ) => (
            <option key={typ} value={typ}>{t(typeKey(typ))}</option>
          ))}
        </select>
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
            <CardTitle className="text-lg">{t("incomes.edit")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("incomes.name")} *</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("incomes.type")} *</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.income_type}
                  onChange={(e) => setForm({ ...form, income_type: e.target.value as api.IncomeType })}
                >
                  {ALL_TYPES.map((typ) => (
                    <option key={typ} value={typ}>{t(typeKey(typ))}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("incomes.source")}</label>
                <Input
                  value={form.source_name}
                  onChange={(e) => setForm({ ...form, source_name: e.target.value })}
                  placeholder="ex: ACME SA, AVS, Locataire X"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("incomes.card")}</label>
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
                <label className="text-sm font-medium">{t("incomes.startedOn")}</label>
                <Input type="date" value={form.started_on} onChange={(e) => setForm({ ...form, started_on: e.target.value })} />
              </div>
              {form.status === "ended" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("incomes.endedOn")}</label>
                  <Input type="date" value={form.ended_on} onChange={(e) => setForm({ ...form, ended_on: e.target.value })} />
                  <p className="text-xs text-muted-foreground">{t("incomes.endedOnHint")}</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("incomes.cycle")} *</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.billing_cycle}
                  onChange={(e) => setForm({ ...form, billing_cycle: e.target.value as api.IncomeBillingCycle })}
                >
                  {CYCLES.map((c) => <option key={c} value={c}>
                    {c === "monthly"   ? t("engagements.cycleMonthly") :
                     c === "quarterly" ? t("engagements.cycleQuarterly") :
                     c === "yearly"    ? t("engagements.cycleYearly") :
                     c === "one_shot"  ? t("engagements.cycleOneShot") :
                                         t("engagements.cycleCustom")}
                  </option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("incomes.cycleInterval")}</label>
                <Input type="number" min="1" value={form.cycle_interval} onChange={(e) => setForm({ ...form, cycle_interval: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("incomes.nextExpected")}</label>
                <Input type="date" value={form.next_expected_date} onChange={(e) => setForm({ ...form, next_expected_date: e.target.value })} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("incomes.currentAmount")}</label>
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
                <label className="text-sm font-medium">{t("incomes.status")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) => {
                    const status = e.target.value as api.IncomeStatus
                    setForm((f) => ({
                      ...f,
                      status,
                      // Clore sans date laisserait l'emploi hors de la
                      // chronologie : on propose aujourd'hui, modifiable.
                      ended_on: status === "ended" ? f.ended_on || today() : "",
                    }))
                  }}
                >
                  <option value="active">{t("incomes.statusActive")}</option>
                  <option value="ended">{t("incomes.statusEnded")}</option>
                </select>
              </div>

              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">{t("incomes.notes")}</label>
                <textarea
                  className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
              <TrendingUp className="h-12 w-12 mb-4 opacity-20" />
              <p>{t("incomes.noIncomes")}</p>
            </CardContent>
          </Card>
        ) : filtered.map((i) => {
          const monthly = i.current_amount != null && i.billing_cycle !== "one_shot"
            ? monthlyEquivalent(i.current_amount, i.billing_cycle, i.cycle_interval)
            : 0
          const days = i.next_expected_date ? daysUntil(i.next_expected_date) : null
          return (
            <Card key={i.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <Link to={`/incomes/${i.id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{i.name}</p>
                      {statusBadge(i.status)}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>{t(typeKey(i.income_type))}</span>
                      {i.source_name && <span>· {i.source_name}</span>}
                      {i.next_expected_date && days != null && (
                        <span>
                          · {t("incomes.nextExpected")} {formatDate(i.next_expected_date)}{" "}
                          ({days >= 0
                            ? `${t("incomes.inDays")} ${days}j`
                            : `${t("incomes.lateBy")} ${-days}j`})
                        </span>
                      )}
                    </div>
                  </Link>
                  <div className="text-right shrink-0">
                    <p className="font-semibold">
                      <MaskedAmount amount={i.current_amount} currency={i.currency} visible={amountsVisible} />
                    </p>
                    <p className="text-xs text-muted-foreground">{cycleLabel(i)}</p>
                    {monthly > 0 && monthly !== i.current_amount && (
                      <p className="text-xs text-muted-foreground">
                        ≈ <MaskedAmount amount={monthly} currency={i.currency} visible={amountsVisible} />{t("incomes.perMonth")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(i)}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(i.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("incomes.deleteTitle")}
        message={t("incomes.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {showWizard && (
        <IncomeWizard
          incomes={incomes}
          cards={cards}
          onClose={() => { setShowWizard(false); load() }}
        />
      )}
    </div>
  )
}

import { useContext, useEffect, useState } from "react"
import {
  Plus, Trash2, Edit, Paperclip, X, Zap, Fuel, Disc3, Wrench, Hammer, Droplets,
  Package, ClipboardCheck, Sticker, SquareParking, AlertTriangle, Milestone, Landmark,
  HelpCircle, Gauge, MapPin, CalendarClock,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { I18nContext } from "@/lib/i18n"
import { formatPrice, formatDate } from "@/lib/utils"
import { VEHICLE_EXPENSE_CATEGORIES, expenseCategoryLabel, categoryUnit } from "@/lib/vehicle"
import * as api from "@/lib/tauri"

const CATEGORY_ICON: Record<api.VehicleExpenseCategory, typeof Zap> = {
  charging: Zap, fuel: Fuel, tires: Disc3, maintenance: Wrench, repair: Hammer,
  cleaning: Droplets, accessories: Package, inspection: ClipboardCheck, vignette: Sticker,
  parking: SquareParking, fine: AlertTriangle, toll: Milestone, tax: Landmark, other: HelpCircle,
}

const today = () => new Date().toISOString().slice(0, 10)
const numOrNull = (s: string): number | null => (s.trim() ? parseFloat(s) : null)
const intOrNull = (s: string): number | null => (s.trim() ? parseInt(s, 10) : null)

type FormState = {
  expense_date: string
  category: api.VehicleExpenseCategory
  amount: string
  quantity: string
  unit_price: string
  odometer_km: string
  location: string
  merchant: string
  payment_card_id: string
  description: string
  next_due_km: string
  next_due_date: string
  notes: string
}

const emptyForm = (defaultCategory: api.VehicleExpenseCategory): FormState => ({
  expense_date: today(), category: defaultCategory, amount: "", quantity: "", unit_price: "",
  odometer_km: "", location: "", merchant: "", payment_card_id: "", description: "",
  next_due_km: "", next_due_date: "", notes: "",
})

interface VehicleExpensesProps {
  vehicleId: string
  /// Used to default the expense category (charging for EV, fuel otherwise).
  defaultCategory: api.VehicleExpenseCategory
  /// Called after a create / update / delete so the vehicle overview can
  /// recompute the month's figures without a page reload.
  onChanged?: () => void
}

export function VehicleExpenses({ vehicleId, defaultCategory, onChanged }: VehicleExpensesProps) {
  const { locale } = useContext(I18nContext)
  const fr = locale === "fr"
  const { toast } = useToast()

  const [expenses, setExpenses] = useState<api.VehicleExpense[]>([])
  const [summary, setSummary] = useState<api.VehicleExpenseSummary | null>(null)
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.VehicleExpense | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm(defaultCategory))
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [attachmentsExpense, setAttachmentsExpense] = useState<api.VehicleExpense | null>(null)

  const load = async () => {
    try {
      const [exp, sum, cds] = await Promise.all([
        api.getVehicleExpenses(vehicleId),
        api.getVehicleExpenseSummary(vehicleId),
        api.getCards(),
      ])
      setExpenses(exp)
      setSummary(sum)
      setCards(cds)
      try {
        const entries = await Promise.all(
          exp.map(async (e) => [e.id, (await api.getVehicleExpenseAttachments(e.id)).length] as const),
        )
        setCounts(Object.fromEntries(entries))
      } catch {
        setCounts({})
      }
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [vehicleId])

  const resetForm = () => { setForm(emptyForm(defaultCategory)); setEditing(null); setShowForm(false) }

  const openCreate = () => { setForm(emptyForm(defaultCategory)); setEditing(null); setShowForm(true) }
  const openEdit = (e: api.VehicleExpense) => {
    setForm({
      expense_date: e.expense_date, category: e.category, amount: e.amount.toString(),
      quantity: e.quantity?.toString() ?? "", unit_price: e.unit_price?.toString() ?? "",
      odometer_km: e.odometer_km?.toString() ?? "", location: e.location ?? "",
      merchant: e.merchant ?? "", payment_card_id: e.payment_card_id ?? "",
      description: e.description ?? "", next_due_km: e.next_due_km?.toString() ?? "",
      next_due_date: e.next_due_date ?? "", notes: e.notes ?? "",
    })
    setEditing(e)
    setShowForm(true)
  }

  const unit = categoryUnit(form.category)

  // For quantity-based categories (charging/fuel), keep amount = qty × unit price.
  const setQty = (quantity: string) => {
    setForm((f) => {
      const next = { ...f, quantity }
      const q = parseFloat(quantity), p = parseFloat(f.unit_price)
      if (categoryUnit(f.category) && !Number.isNaN(q) && !Number.isNaN(p)) next.amount = (q * p).toFixed(2)
      return next
    })
  }
  const setUnitPrice = (unit_price: string) => {
    setForm((f) => {
      const next = { ...f, unit_price }
      const q = parseFloat(f.quantity), p = parseFloat(unit_price)
      if (categoryUnit(f.category) && !Number.isNaN(q) && !Number.isNaN(p)) next.amount = (q * p).toFixed(2)
      return next
    })
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const amount = parseFloat(form.amount)
    if (!form.expense_date || Number.isNaN(amount) || amount < 0) {
      toast(fr ? "Date et montant valides requis" : "Valid date and amount required", "error")
      return
    }
    const payload = {
      expense_date: form.expense_date,
      category: form.category,
      amount,
      description: form.description.trim() || null,
      odometer_km: intOrNull(form.odometer_km),
      quantity: unit ? numOrNull(form.quantity) : null,
      unit: unit ?? null,
      unit_price: unit ? numOrNull(form.unit_price) : null,
      location: form.location.trim() || null,
      merchant: form.merchant.trim() || null,
      payment_card_id: form.payment_card_id || null,
      next_due_km: intOrNull(form.next_due_km),
      next_due_date: form.next_due_date || null,
      notes: form.notes.trim() || null,
    }
    try {
      if (editing) {
        await api.updateVehicleExpense({ ...editing, ...payload, currency: editing.currency })
        toast(fr ? "Dépense mise à jour" : "Expense updated", "success")
      } else {
        await api.createVehicleExpense({ vehicle_id: vehicleId, ...payload })
        toast(fr ? "Dépense ajoutée" : "Expense added", "success")
      }
      resetForm()
      await load()
      onChanged?.()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteVehicleExpense(deleteTarget)
      toast(fr ? "Dépense supprimée" : "Expense deleted", "success")
      setDeleteTarget(null)
      await load()
      onChanged?.()
    } catch (e) {
      toast(`${fr ? "Erreur" : "Error"}: ${e}`, "error")
    }
  }

  const fieldCls = "w-full h-10 rounded-md border border-input bg-background px-3 text-sm"

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      {summary && summary.count > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{fr ? "Total" : "Total"}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{formatPrice(summary.total)}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{fr ? "Cette année" : "This year"}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{formatPrice(summary.total_year)}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{fr ? "Dépenses" : "Entries"}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{summary.count}</div>
          </CardContent></Card>
        </div>
      )}
      {summary && summary.by_category.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.by_category.map((c) => {
            const Icon = CATEGORY_ICON[c.category]
            return (
              <Badge key={c.category} variant="outline" className="gap-1 py-1">
                <Icon className="h-3 w-3" />
                {expenseCategoryLabel(c.category, fr)} · <span className="font-semibold">{formatPrice(c.total)}</span>
              </Badge>
            )
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => (showForm ? resetForm() : openCreate())}>
          <Plus className="h-4 w-4" />{fr ? "Ajouter une dépense" : "Add expense"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{editing ? (fr ? "Modifier la dépense" : "Edit expense") : (fr ? "Nouvelle dépense" : "New expense")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Date" : "Date"} *</label>
                <Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Catégorie" : "Category"} *</label>
                <select className={fieldCls} value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as api.VehicleExpenseCategory })}>
                  {VEHICLE_EXPENSE_CATEGORIES.map((c) => <option key={c.slug} value={c.slug}>{fr ? c.fr : c.en}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Montant (CHF)" : "Amount (CHF)"} *</label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
              </div>

              {unit && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Quantité" : "Quantity"} ({unit})</label>
                    <Input type="number" step="0.001" min="0" value={form.quantity} onChange={(e) => setQty(e.target.value)}
                      placeholder={unit === "kWh" ? "42.5" : "45"} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{fr ? "Prix" : "Price"} (CHF/{unit})</label>
                    <Input type="number" step="0.001" min="0" value={form.unit_price} onChange={(e) => setUnitPrice(e.target.value)}
                      placeholder={unit === "kWh" ? "0.45" : "1.85"} />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Km au compteur" : "Odometer (km)"}</label>
                <Input type="number" min="0" value={form.odometer_km} onChange={(e) => setForm({ ...form, odometer_km: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{unit === "kWh" ? (fr ? "Borne / lieu" : "Charge point / place") : (fr ? "Lieu / station" : "Place / station")}</label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Compte / carte" : "Account / card"}</label>
                <select className={fieldCls} value={form.payment_card_id} onChange={(e) => setForm({ ...form, payment_card_id: e.target.value })}>
                  <option value="">—</option>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                <label className="text-sm font-medium">{fr ? "Description" : "Description"}</label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={fr ? "Ex : pneus hiver, vidange…" : "e.g. winter tires, oil change…"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prochaine échéance (km)" : "Next due (km)"}</label>
                <Input type="number" min="0" value={form.next_due_km} onChange={(e) => setForm({ ...form, next_due_km: e.target.value })}
                  placeholder={fr ? "Ex : prochain service" : "e.g. next service"} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{fr ? "Prochaine échéance (date)" : "Next due (date)"}</label>
                <Input type="date" value={form.next_due_date} onChange={(e) => setForm({ ...form, next_due_date: e.target.value })} />
              </div>
              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">{fr ? "Notes" : "Notes"}</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" size="sm">{editing ? (fr ? "Enregistrer" : "Save") : (fr ? "Ajouter" : "Add")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={resetForm}>{fr ? "Annuler" : "Cancel"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {expenses.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <Fuel className="h-10 w-10 opacity-20" />
          <p>{fr ? "Aucune dépense. Ajoutez recharge, carburant, pneus, entretien…" : "No expense yet. Add charging, fuel, tires, maintenance…"}</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => {
            const Icon = CATEGORY_ICON[e.category]
            const n = counts[e.id] ?? 0
            return (
              <Card key={e.id}>
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon className="h-5 w-5 text-muted-foreground" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{expenseCategoryLabel(e.category, fr)}</span>
                      {e.description && <span className="text-sm text-muted-foreground truncate">· {e.description}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground flex-wrap">
                      <span>{formatDate(e.expense_date)}</span>
                      {e.quantity != null && e.unit && <span>· {e.quantity} {e.unit}{e.unit_price != null ? ` @ ${e.unit_price}` : ""}</span>}
                      {e.odometer_km != null && <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" />{e.odometer_km.toLocaleString("fr-CH")} km</span>}
                      {e.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{e.location}</span>}
                      {e.card_name && <span>· {e.card_name}</span>}
                      {(e.next_due_km != null || e.next_due_date) && (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                          <CalendarClock className="h-3 w-3" />
                          {fr ? "prochaine" : "next"}: {e.next_due_km != null ? `${e.next_due_km.toLocaleString("fr-CH")} km` : ""}
                          {e.next_due_km != null && e.next_due_date ? " / " : ""}
                          {e.next_due_date ? formatDate(e.next_due_date) : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold tabular-nums">{formatPrice(e.amount, e.currency)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="relative" onClick={() => setAttachmentsExpense(e)} title={fr ? "Justificatif" : "Receipt"}>
                      <Paperclip className="h-4 w-4" />
                      {n > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-semibold text-white">{n}</span>}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(e)}><Edit className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(e.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={fr ? "Supprimer la dépense" : "Delete expense"}
        message={fr ? "La dépense et ses justificatifs seront supprimés." : "The expense and its receipts will be deleted."}
        confirmLabel={fr ? "Supprimer" : "Delete"}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {attachmentsExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
            <div className="flex items-center justify-between gap-4 border-b p-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{fr ? "Justificatifs" : "Receipts"}</h2>
                <p className="text-xs text-muted-foreground truncate">
                  {expenseCategoryLabel(attachmentsExpense.category, fr)} · {formatDate(attachmentsExpense.expense_date)} · {formatPrice(attachmentsExpense.amount, attachmentsExpense.currency)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setAttachmentsExpense(null); void load() }} aria-label={fr ? "Fermer" : "Close"}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <AttachmentsPanel
                vehicleExpenseId={attachmentsExpense.id}
                itemDescription={expenseCategoryLabel(attachmentsExpense.category, fr)}
                templateContext={{
                  description: attachmentsExpense.description ?? expenseCategoryLabel(attachmentsExpense.category, fr),
                  date: attachmentsExpense.expense_date,
                  merchant: attachmentsExpense.merchant ?? attachmentsExpense.location ?? undefined,
                  currency: attachmentsExpense.currency,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

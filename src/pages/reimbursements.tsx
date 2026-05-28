import { useEffect, useMemo, useState, useContext } from "react"
import { Plus, Trash2, Edit, HandCoins, Send, CheckCircle2, Search, Paperclip, X, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { formatPrice, formatDate, daysUntil, cn } from "@/lib/utils"
import { SUPPORTED_CURRENCIES } from "@/lib/currencies"
import { downloadExport } from "@/lib/export"
import { I18nContext, type TranslationKeys } from "@/lib/i18n"
import * as api from "@/lib/tauri"

const ALL_TYPES: api.ReimbursementType[] = [
  "expense_report", "insurance_claim", "warranty_return",
  "product_return", "deposit", "tax_refund", "other",
]

const today = () => new Date().toISOString().slice(0, 10)

type TabKey = "pending" | "claimed" | "settled" | "closed"

/// Each tab maps to one or more concrete statuses. 'claimed' tab covers
/// both fully claimed (waiting) and 'partial' (partly received but expecting
/// more). 'closed' covers rejected + cancelled so the active workflow stays
/// uncluttered.
const TAB_STATUSES: Record<TabKey, api.ReimbursementStatus[]> = {
  pending:  ["pending"],
  claimed:  ["claimed", "partial"],
  settled:  ["settled"],
  closed:   ["rejected", "cancelled"],
}

type FormState = {
  label: string
  reimbursement_type: api.ReimbursementType
  expected_amount: string
  currency: string
  debtor_name: string
  debtor_creditor_id: string
  item_id: string
  source_description: string
  requested_on: string
  expected_by: string
  notes: string
}

const emptyForm = (): FormState => ({
  label: "",
  reimbursement_type: "expense_report",
  expected_amount: "",
  currency: "CHF",
  debtor_name: "",
  debtor_creditor_id: "",
  item_id: "",
  source_description: "",
  requested_on: "",
  expected_by: "",
  notes: "",
})

export function ReimbursementsPage() {
  const { t } = useContext(I18nContext)
  const [reimbursements, setReimbursements] = useState<api.PendingReimbursement[]>([])
  const [creditors, setCreditors] = useState<api.Creditor[]>([])
  const [items, setItems] = useState<api.Item[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.PendingReimbursement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [tab, setTab] = useState<TabKey>("pending")
  const [search, setSearch] = useState("")
  const [settleTarget, setSettleTarget] = useState<api.PendingReimbursement | null>(null)
  const [settleForm, setSettleForm] = useState({ received_on: today(), received_amount: "" })
  const [attachmentsFor, setAttachmentsFor] = useState<api.PendingReimbursement | null>(null)
  const { toast } = useToast()

  const load = async () => {
    try {
      const [reimbsData, credData, itemsData] = await Promise.all([
        api.listPendingReimbursements(),
        api.getCreditors(),
        api.getItems(),
      ])
      setReimbursements(reimbsData)
      setCreditors(credData)
      setItems(itemsData)
    } catch (e) {
      console.error(e)
      toast(`Erreur: ${e}`, "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => { setForm(emptyForm()); setEditing(null); setShowForm(false) }

  const handleEdit = (r: api.PendingReimbursement) => {
    setForm({
      label: r.label,
      reimbursement_type: r.reimbursement_type,
      expected_amount: r.expected_amount?.toString() || "",
      currency: r.currency,
      debtor_name: r.debtor_name || "",
      debtor_creditor_id: r.debtor_creditor_id || "",
      item_id: r.item_id || "",
      source_description: r.source_description || "",
      requested_on: r.requested_on || "",
      expected_by: r.expected_by || "",
      notes: r.notes || "",
    })
    setEditing(r)
    setShowForm(true)
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form.label.trim()) return
    const expected = form.expected_amount ? parseFloat(form.expected_amount) : null
    if (form.expected_amount && (Number.isNaN(expected as number) || (expected as number) < 0)) {
      toast("Montant invalide", "error")
      return
    }
    try {
      if (editing) {
        await api.updatePendingReimbursement({
          ...editing,
          label: form.label.trim(),
          reimbursement_type: form.reimbursement_type,
          expected_amount: expected,
          currency: form.currency,
          debtor_name: form.debtor_name || null,
          debtor_creditor_id: form.debtor_creditor_id || null,
          item_id: form.item_id || null,
          source_description: form.source_description || null,
          requested_on: form.requested_on || null,
          expected_by: form.expected_by || null,
          notes: form.notes || null,
        })
        toast(t("reimbursements.updated"), "success")
      } else {
        await api.createPendingReimbursement({
          label: form.label.trim(),
          reimbursement_type: form.reimbursement_type,
          expected_amount: expected,
          currency: form.currency,
          debtor_name: form.debtor_name || null,
          debtor_creditor_id: form.debtor_creditor_id || null,
          item_id: form.item_id || null,
          source_description: form.source_description || null,
          requested_on: form.requested_on || null,
          expected_by: form.expected_by || null,
          notes: form.notes || null,
        })
        toast(t("reimbursements.created"), "success")
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
      await api.deletePendingReimbursement(deleteTarget)
      toast(t("reimbursements.deleted"), "success")
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleClaim = async (r: api.PendingReimbursement) => {
    try {
      await api.markReimbursementClaimed(r.id)
      toast(t("reimbursements.statusClaimed"), "success")
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleStartSettle = (r: api.PendingReimbursement) => {
    setSettleTarget(r)
    setSettleForm({ received_on: today(), received_amount: r.expected_amount?.toString() || "" })
  }

  const handleConfirmSettle = async () => {
    if (!settleTarget) return
    const amount = parseFloat(settleForm.received_amount)
    if (Number.isNaN(amount) || amount < 0) {
      toast("Montant invalide", "error")
      return
    }
    try {
      await api.markReimbursementSettled(settleTarget.id, settleForm.received_on, amount)
      toast(t("reimbursements.statusSettled"), "success")
      setSettleTarget(null)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleReject = async (r: api.PendingReimbursement) => {
    try {
      await api.updatePendingReimbursement({ ...r, status: "rejected" })
      toast(t("reimbursements.statusRejected"), "success")
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const filtered = useMemo(() => {
    const allowed = new Set<api.ReimbursementStatus>(TAB_STATUSES[tab])
    const q = search.trim().toLowerCase()
    return reimbursements.filter((r) => {
      if (!allowed.has(r.status)) return false
      if (!q) return true
      return (
        r.label.toLowerCase().includes(q) ||
        (r.debtor_name ?? "").toLowerCase().includes(q) ||
        (r.debtor_creditor_name ?? "").toLowerCase().includes(q) ||
        (r.item_description ?? "").toLowerCase().includes(q)
      )
    })
  }, [reimbursements, tab, search])

  // Total still expected (sum of expected_amount for pending + claimed +
  // partial). Partial deducts what's already been received.
  const totalPending = useMemo(() => {
    return reimbursements
      .filter((r) => r.status === "pending" || r.status === "claimed" || r.status === "partial")
      .reduce((acc, r) => {
        if (r.expected_amount == null) return acc
        const remaining = r.status === "partial" && r.received_amount != null
          ? Math.max(0, r.expected_amount - r.received_amount)
          : r.expected_amount
        return acc + remaining
      }, 0)
  }, [reimbursements])

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { pending: 0, claimed: 0, settled: 0, closed: 0 }
    for (const r of reimbursements) {
      for (const [k, statuses] of Object.entries(TAB_STATUSES) as Array<[TabKey, api.ReimbursementStatus[]]>) {
        if (statuses.includes(r.status)) c[k]++
      }
    }
    return c
  }, [reimbursements])

  const typeKey = (typ: api.ReimbursementType): keyof TranslationKeys =>
    `reimbursements.type.${typ}` as keyof TranslationKeys

  const statusBadge = (s: api.ReimbursementStatus) => {
    if (s === "pending")   return <Badge variant="secondary">{t("reimbursements.statusPending")}</Badge>
    if (s === "claimed")   return <Badge variant="warning">{t("reimbursements.statusClaimed")}</Badge>
    if (s === "partial")   return <Badge variant="warning">{t("reimbursements.statusPartial")}</Badge>
    if (s === "settled")   return <Badge variant="success">{t("reimbursements.statusSettled")}</Badge>
    if (s === "rejected")  return <Badge variant="destructive">{t("reimbursements.statusRejected")}</Badge>
    return <Badge variant="secondary">{t("reimbursements.statusCancelled")}</Badge>
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
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{t("reimbursements.title")}</h2>
          <p className="text-muted-foreground">
            {t("reimbursements.subtitle")} · {t("reimbursements.totalPending")} :{" "}
            <span className="font-semibold text-foreground">{formatPrice(totalPending)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const csv = await api.exportReimbursementsCsv()
                await downloadExport(csv, `remboursements-${today().slice(0, 7)}.csv`)
              } catch (e) {
                toast(`Erreur export: ${e}`, "error")
              }
            }}
            title="Exporter en CSV"
          >
            <Download className="h-4 w-4" />
            Exporter CSV
          </Button>
          <Button onClick={() => { resetForm(); setShowForm(true) }}>
            <Plus className="h-4 w-4" />{t("reimbursements.new")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {(["pending", "claimed", "settled", "closed"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {k === "pending" ? t("reimbursements.tabPending") :
             k === "claimed" ? t("reimbursements.tabClaimed") :
             k === "settled" ? t("reimbursements.tabSettled") :
             t("reimbursements.tabClosed")}
            <span className="text-xs text-muted-foreground">({counts[k]})</span>
          </button>
        ))}
        <div className="ml-auto relative pt-1">
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
            <CardTitle className="text-lg">{editing ? t("reimbursements.edit") : t("reimbursements.new")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("reimbursements.label")} *</label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="ex: Frais déplacement client Mars 2026"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("reimbursements.type")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.reimbursement_type}
                  onChange={(e) => setForm({ ...form, reimbursement_type: e.target.value as api.ReimbursementType })}
                >
                  {ALL_TYPES.map((typ) => (
                    <option key={typ} value={typ}>{t(typeKey(typ))}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("reimbursements.expectedAmount")}</label>
                <div className="flex gap-2">
                  <Input
                    type="number" step="0.01" min="0"
                    value={form.expected_amount}
                    onChange={(e) => setForm({ ...form, expected_amount: e.target.value })}
                    className="flex-1"
                  />
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
                <label className="text-sm font-medium">{t("reimbursements.debtor")}</label>
                <Input
                  value={form.debtor_name}
                  onChange={(e) => setForm({ ...form, debtor_name: e.target.value })}
                  placeholder="ex: ACME SA"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("reimbursements.debtorCreditor")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.debtor_creditor_id}
                  onChange={(e) => setForm({ ...form, debtor_creditor_id: e.target.value })}
                >
                  <option value="">—</option>
                  {creditors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">{t("reimbursements.linkedItem")}</label>
                <select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.item_id}
                  onChange={(e) => setForm({ ...form, item_id: e.target.value })}
                >
                  <option value="">— Saisie libre ci-dessous —</option>
                  {items.slice(0, 100).map((i) => (
                    <option key={i.id} value={i.id}>{i.description} ({formatDate(i.purchase_date)})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("reimbursements.sourceDescription")}</label>
                <Input
                  value={form.source_description}
                  onChange={(e) => setForm({ ...form, source_description: e.target.value })}
                  placeholder="ex: Restaurant client 12 mars"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t("reimbursements.requestedOn")}</label>
                <Input type="date" value={form.requested_on} onChange={(e) => setForm({ ...form, requested_on: e.target.value })} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("reimbursements.expectedBy")}</label>
                <Input type="date" value={form.expected_by} onChange={(e) => setForm({ ...form, expected_by: e.target.value })} />
              </div>

              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <label className="text-sm font-medium">{t("reimbursements.notes")}</label>
                <textarea
                  className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
              <HandCoins className="h-12 w-12 mb-4 opacity-20" />
              <p>{t("reimbursements.noReimbursements")}</p>
            </CardContent>
          </Card>
        ) : filtered.map((r) => {
          const debtor = r.debtor_creditor_name || r.debtor_name
          const expectedDays = r.expected_by ? daysUntil(r.expected_by) : null
          const isOverdue = expectedDays != null && expectedDays < 0 && (r.status === "claimed" || r.status === "pending")
          return (
            <Card key={r.id} className={cn("hover:shadow-md transition-shadow", isOverdue && "border-destructive/40")}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{r.label}</p>
                      {statusBadge(r.status)}
                      {isOverdue && <Badge variant="destructive">Échéance dépassée ({-expectedDays!}j)</Badge>}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>{t(typeKey(r.reimbursement_type))}</span>
                      {debtor && <span>· {debtor}</span>}
                      {r.item_description && <span>· {r.item_description}</span>}
                      {r.source_description && !r.item_description && <span>· {r.source_description}</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {r.requested_on && <span>Demandé le {formatDate(r.requested_on)}</span>}
                      {r.expected_by && <span>· Attendu pour {formatDate(r.expected_by)}</span>}
                      {r.received_on && <span>· Reçu le {formatDate(r.received_on)}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {r.expected_amount != null && (
                      <p className="font-semibold">{formatPrice(r.expected_amount, r.currency)}</p>
                    )}
                    {r.received_amount != null && r.received_amount !== r.expected_amount && (
                      <p className="text-xs text-muted-foreground">
                        Reçu : {formatPrice(r.received_amount, r.currency)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {r.status === "pending" && (
                      <Button variant="ghost" size="icon" onClick={() => handleClaim(r)} title={t("reimbursements.markClaimed")}>
                        <Send className="h-4 w-4 text-amber-600" />
                      </Button>
                    )}
                    {(r.status === "claimed" || r.status === "partial" || r.status === "pending") && (
                      <Button variant="ghost" size="icon" onClick={() => handleStartSettle(r)} title={t("reimbursements.markSettled")}>
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      </Button>
                    )}
                    {(r.status === "claimed" || r.status === "pending") && (
                      <Button variant="ghost" size="icon" onClick={() => handleReject(r)} title={t("reimbursements.statusRejected")}>
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setAttachmentsFor(r)} title="Pièces jointes">
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                {attachmentsFor?.id === r.id && (
                  <div className="mt-4 pt-4 border-t">
                    <AttachmentsPanel
                      reimbursementId={r.id}
                      itemDescription={r.label}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {settleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSettleTarget(null)}>
          <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">{t("reimbursements.markSettled")}</h3>
            <p className="text-sm text-muted-foreground mt-1">{settleTarget.label}</p>
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("reimbursements.receivedOn")}</label>
                <Input type="date" value={settleForm.received_on} onChange={(e) => setSettleForm({ ...settleForm, received_on: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("reimbursements.receivedAmount")}</label>
                <Input
                  type="number" step="0.01" min="0"
                  value={settleForm.received_amount}
                  onChange={(e) => setSettleForm({ ...settleForm, received_amount: e.target.value })}
                />
                {settleTarget.expected_amount != null && (
                  <p className="text-xs text-muted-foreground">
                    Attendu : {formatPrice(settleTarget.expected_amount, settleTarget.currency)}.
                    Un montant inférieur passera le remboursement en « Partiel ».
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setSettleTarget(null)}>{t("common.cancel")}</Button>
                <Button size="sm" onClick={handleConfirmSettle}>{t("reimbursements.markSettled")}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("reimbursements.deleteTitle")}
        message={t("reimbursements.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

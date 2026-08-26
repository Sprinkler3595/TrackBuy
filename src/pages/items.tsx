import { useEffect, useState, useCallback } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Plus, Search, Trash2, Edit, Filter, Download, ChevronDown, ShoppingBag, ChevronRight, Layers, ClipboardList, Landmark } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ItemThumbnail } from "@/components/features/item-thumbnail"
import { QuickCreateDialog, type QuickCreateEntity } from "@/components/features/quick-create-dialog"
import { PurchaseScanDialog } from "@/components/features/purchase-scan-dialog"
import { InsuranceInventoryModal } from "@/components/features/insurance-inventory"
import { formatPrice, formatDate } from "@/lib/utils"
import { itemsToCsv, itemsToJson, downloadExport } from "@/lib/export"
import { useI18n } from "@/lib/i18n"
import * as api from "@/lib/tauri"

export function ItemsPage() {
  const [items, setItems] = useState<api.Item[]>([])
  const [merchants, setMerchants] = useState<api.Merchant[]>([])
  const [locations, setLocations] = useState<api.Location[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showInventory, setShowInventory] = useState(false)
  const [editingItem, setEditingItem] = useState<api.Item | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [quickCreate, setQuickCreate] = useState<QuickCreateEntity | null>(null)
  // A purchase can only be created from a document — this dialog is the entry
  // point, the form below only ever edits an existing one.
  const [showScanDialog, setShowScanDialog] = useState(false)
  const { toast } = useToast()
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()

  // Form state
  const [form, setForm] = useState({
    description: "",
    purchase_date: new Date().toISOString().split("T")[0],
    purchase_price: "",
    currency: "CHF",
    merchant_id: "",
    location_id: "",
    payment_card_id: "",
    notes: "",
    status: "active",
    invoice_number: "",
    product_reference: "",
    quantity: "1",
    price_excl_tax: "",
    tax_rate: "",
  })

  const loadItems = useCallback(async () => {
    try {
      const data = await api.getItems({
        search: search || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        // Hide digital items (tickets/vouchers/licenses) — they live on /tickets.
        kind: "physical",
      })
      setItems(data)
    } catch (err) {
      console.error("Failed to load items:", err)
    }
  }, [search, statusFilter])

  useEffect(() => {
    async function init() {
      try {
        const [m, l, c] = await Promise.all([
          api.getMerchants(),
          api.getLocations(),
          api.getCards(),
        ])
        setMerchants(m)
        setLocations(l)
        setCards(c)
        await loadItems()
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [loadItems])

  useEffect(() => {
    if (!loading) loadItems()
  }, [search, statusFilter, loadItems, loading])

  const handleEdit = (item: api.Item) => {
    setForm({
      description: item.description,
      purchase_date: item.purchase_date,
      purchase_price: String(item.purchase_price),
      currency: item.currency || "CAD",
      merchant_id: item.merchant_id,
      location_id: item.location_id,
      payment_card_id: item.payment_card_id || "",
      notes: item.notes || "",
      status: item.status,
      invoice_number: item.invoice_number || "",
      product_reference: item.product_reference || "",
      quantity: String(item.quantity ?? 1),
      price_excl_tax: item.price_excl_tax != null ? String(item.price_excl_tax) : "",
      tax_rate: item.tax_rate != null ? String(item.tax_rate) : "",
    })
    setEditingItem(item)
    setShowForm(true)
    if (item.invoice_number || item.product_reference || item.price_excl_tax != null || item.tax_rate != null) {
      setShowDetails(true)
    }
  }

  // Open the edit form when navigating with ?edit=<id> (from the detail page)
  useEffect(() => {
    if (loading) return
    const editId = searchParams.get("edit")
    if (!editId) return
    const target = items.find((it) => it.id === editId)
    if (target) {
      handleEdit(target)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, items, searchParams])

  const handleQuickCreated = async (entity: QuickCreateEntity, newId: string) => {
    try {
      if (entity === "merchant") {
        const updated = await api.getMerchants()
        setMerchants(updated)
        setForm((f) => ({ ...f, merchant_id: newId }))
      } else if (entity === "location") {
        const updated = await api.getLocations()
        setLocations(updated)
        setForm((f) => ({ ...f, location_id: newId }))
      } else {
        const updated = await api.getCards()
        setCards(updated)
        setForm((f) => ({ ...f, payment_card_id: newId }))
      }
    } catch (err) {
      console.error("Failed to refresh after quick create", err)
    }
  }

  const resetForm = () => {
    setForm({
      description: "",
      purchase_date: new Date().toISOString().split("T")[0],
      purchase_price: "",
      currency: "CHF",
      merchant_id: "",
      location_id: "",
      payment_card_id: "",
      notes: "",
      status: "active",
      invoice_number: "",
      product_reference: "",
      quantity: "1",
      price_excl_tax: "",
      tax_rate: "",
    })
    setEditingItem(null)
    setShowForm(false)
    setShowDetails(false)
  }

  // Edit-only: a purchase is created by the guided assistant, from a document.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingItem) return
    try {
      const merchantId = form.merchant_id
      if (!merchantId) {
        toast("Marchand requis", "error")
        return
      }
      if (!form.location_id) {
        toast("Lieu requis", "error")
        return
      }
      await api.updateItem({
        ...editingItem,
        description: form.description,
        purchase_date: form.purchase_date,
        purchase_price: parseFloat(form.purchase_price),
        currency: form.currency,
        merchant_id: merchantId,
        location_id: form.location_id,
        payment_card_id: form.payment_card_id || null,
        notes: form.notes || null,
        status: form.status,
        invoice_number: form.invoice_number || null,
        product_reference: form.product_reference || null,
        quantity: form.quantity ? parseInt(form.quantity) : null,
        price_excl_tax: form.price_excl_tax ? parseFloat(form.price_excl_tax) : null,
        tax_rate: form.tax_rate ? parseFloat(form.tax_rate) : null,
      })
      toast("Article modifié", "success")
      resetForm()
      await loadItems()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteItem(deleteTarget)
      toast("Article supprimé", "success")
      setDeleteTarget(null)
      await loadItems()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const handleGroupSelected = async () => {
    if (selectedIds.size < 2) {
      toast("Sélectionne au moins 2 articles", "error")
      return
    }
    try {
      await api.linkItemsToOrder(Array.from(selectedIds))
      toast(`${selectedIds.size} articles regroupés`, "success")
      exitSelectionMode()
      await loadItems()
    } catch (err) {
      toast(`Erreur: ${err}`, "error")
    }
  }

  const handleExport = async (format: "csv" | "json") => {
    setShowExportMenu(false)
    const content = format === "csv" ? itemsToCsv(items) : itemsToJson(items)
    const filename = `trackbuy-achats-${new Date().toISOString().split("T")[0]}.${format}`
    const success = await downloadExport(content, filename)
    if (success) toast(`Exporté en ${format.toUpperCase()}`, "success")
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
          <h2 className="text-3xl font-bold tracking-tight">Achats</h2>
          <p className="text-muted-foreground">{items.length} article(s)</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Button variant="outline" onClick={() => setShowExportMenu(!showExportMenu)} disabled={items.length === 0}>
              <Download className="h-4 w-4" />
              Exporter
              <ChevronDown className="h-3 w-3" />
            </Button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 z-10 w-36 rounded-md border bg-card shadow-lg">
                <button onClick={() => handleExport("csv")} className="w-full px-3 py-2 text-sm text-left hover:bg-muted rounded-t-md">CSV</button>
                <button onClick={() => handleExport("json")} className="w-full px-3 py-2 text-sm text-left hover:bg-muted rounded-b-md">JSON</button>
              </div>
            )}
          </div>
          <Button variant="outline" onClick={() => setShowInventory(true)}>
            <ClipboardList className="h-4 w-4" />
            Inventaire assurance
          </Button>
          {!selectionMode && items.length > 1 && (
            <Button variant="outline" onClick={() => setSelectionMode(true)}>
              <Layers className="h-4 w-4" />
              Regrouper
            </Button>
          )}
          <Button onClick={() => setShowScanDialog(true)}>
            <Plus className="h-4 w-4" />
            Nouvel achat
          </Button>
        </div>
      </div>

      {selectionMode && (
        <div className="flex items-center justify-between rounded-lg border bg-primary/5 px-4 py-3">
          <p className="text-sm">
            <span className="font-semibold">{selectedIds.size}</span> article(s) sélectionné(s) — coche les articles d'un même achat
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleGroupSelected} disabled={selectedIds.size < 2}>
              <Layers className="h-4 w-4" />
              Regrouper
            </Button>
            <Button size="sm" variant="outline" onClick={exitSelectionMode}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-1">
          <Filter className="h-4 w-4 ml-2 text-muted-foreground" />
          {["all", "active", "archived"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "all" ? "Tous" : s === "active" ? "Actifs" : "Archivés"}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Modifier l'achat</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Description *</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Date d'achat *</label>
                <Input
                  type="date"
                  value={form.purchase_date}
                  onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("items.price")} *</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.purchase_price}
                    onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                    required
                    className="flex-1"
                  />
                  <select
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="w-20 rounded-md border border-input bg-background px-2 py-2 text-sm"
                  >
                    <option value="CHF">CHF</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="CAD">CAD</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Marchand *</label>
                <div className="flex gap-2">
                  <select
                    value={form.merchant_id}
                    onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Sélectionner...</option>
                    {merchants.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Créer un marchand"
                    onClick={() => setQuickCreate("merchant")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Lieu *</label>
                <div className="flex gap-2">
                  <select
                    value={form.location_id}
                    onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Sélectionner...</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Créer un lieu"
                    onClick={() => setQuickCreate("location")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Carte de paiement</label>
                <div className="flex gap-2">
                  <select
                    value={form.payment_card_id}
                    onChange={(e) => setForm({ ...form, payment_card_id: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Aucune</option>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Créer une carte"
                    onClick={() => setQuickCreate("card")}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Statut</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="active">Actif</option>
                  <option value="archived">Archivé</option>
                </select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="text-sm font-medium">Notes</label>
                <Input
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              {/* Collapsible details section */}
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className={`h-4 w-4 transition-transform ${showDetails ? "rotate-90" : ""}`} />
                  {t("items.detailedInfo")}
                </button>
                {showDetails && (
                  <div className="grid gap-4 sm:grid-cols-2 mt-3 pt-3 border-t">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.invoiceNumber")}</label>
                      <Input
                        value={form.invoice_number}
                        onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                        placeholder="183081662"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.productReference")}</label>
                      <Input
                        value={form.product_reference}
                        onChange={(e) => setForm({ ...form, product_reference: e.target.value })}
                        placeholder="59345975"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.quantity")}</label>
                      <Input
                        type="number"
                        min="1"
                        value={form.quantity}
                        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.priceExclTax")}</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.price_excl_tax}
                        onChange={(e) => setForm({ ...form, price_excl_tax: e.target.value })}
                        placeholder="765.96"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.taxRate")}</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={form.tax_rate}
                        onChange={(e) => {
                          const newRate = e.target.value
                          const updates: Record<string, string> = { tax_rate: newRate }
                          // Auto-compute price_excl_tax from tax_rate
                          if (newRate && form.purchase_price) {
                            const rate = parseFloat(newRate)
                            const ttc = parseFloat(form.purchase_price)
                            if (rate > 0 && ttc > 0) {
                              updates.price_excl_tax = (ttc / (1 + rate / 100)).toFixed(2)
                            }
                          }
                          setForm({ ...form, ...updates })
                        }}
                        placeholder="8.10"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.taxAmount")}</label>
                      <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                        {form.purchase_price && form.price_excl_tax
                          ? (parseFloat(form.purchase_price) - parseFloat(form.price_excl_tax)).toFixed(2)
                          : "—"}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit">Enregistrer</Button>
                <Button type="button" variant="outline" onClick={resetForm}>Annuler</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Items list */}
      <div className="space-y-2">
        {items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground">
              <ShoppingBag className="h-12 w-12 opacity-20" />
              <p>
                Aucun achat trouvé. Un achat part toujours de son document :
                offre, bon de commande, facture ou ticket de caisse.
              </p>
              <Button onClick={() => setShowScanDialog(true)}>
                <Plus className="h-4 w-4" />
                Scanner un document
              </Button>
            </CardContent>
          </Card>
        ) : (
          items.map((item) => {
            const selected = selectedIds.has(item.id)
            const cardClass = `hover:shadow-md transition-shadow ${selected ? "ring-2 ring-primary" : ""}`
            const body = (
              <div className="flex flex-1 min-w-0 items-center gap-4">
                <ItemThumbnail itemId={item.id} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium truncate">{item.description}</p>
                    <Badge variant={item.status === "active" ? "success" : "secondary"} className="text-[10px] shrink-0">
                      {item.status === "active" ? "Actif" : "Archivé"}
                    </Badge>
                    {item.order_id && (
                      <Badge variant="outline" className="text-[10px] shrink-0 gap-1">
                        <Layers className="h-2.5 w-2.5" />
                        Achat groupé
                      </Badge>
                    )}
                    {item.bank_transaction_id && (
                      <Badge variant="outline" className="text-[10px] shrink-0 gap-1" title="Rapproché d'une transaction bancaire">
                        <Landmark className="h-2.5 w-2.5" />
                        Rapproché
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {item.merchant_name} &middot; {item.location_name} &middot; {formatDate(item.purchase_date)}
                  </p>
                </div>
              </div>
            )
            return (
              <Card key={item.id} className={cardClass}>
                <CardContent className="flex items-center gap-4 p-4">
                  {selectionMode && (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(item.id)}
                      className="h-4 w-4 rounded border-input shrink-0"
                      aria-label="Sélectionner"
                    />
                  )}
                  {selectionMode ? (
                    <button
                      type="button"
                      onClick={() => toggleSelected(item.id)}
                      className="flex flex-1 min-w-0 items-center gap-4 text-left"
                    >
                      {body}
                    </button>
                  ) : (
                    <Link
                      to={`/items/${item.id}`}
                      className="flex flex-1 min-w-0 items-center gap-4 hover:opacity-90"
                      title="Voir la fiche produit"
                    >
                      {body}
                    </Link>
                  )}
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-semibold whitespace-nowrap">
                      {formatPrice(item.purchase_price, item.currency)}
                    </span>
                    {!selectionMode && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} title="Modifier">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(item.id)} title="Supprimer">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer l'article"
        message="Cet article et toutes ses pièces jointes seront supprimés définitivement."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <QuickCreateDialog
        entity={quickCreate}
        onClose={() => setQuickCreate(null)}
        onCreated={handleQuickCreated}
      />

      {showInventory && <InsuranceInventoryModal onClose={() => setShowInventory(false)} />}

      {showScanDialog && <PurchaseScanDialog onClose={() => setShowScanDialog(false)} />}
    </div>
  )
}

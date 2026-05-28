import { useEffect, useState, useCallback } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Plus, Search, Trash2, Edit, Filter, Download, Upload, ChevronDown, ShoppingBag, ChevronRight, Layers, X, FileText, Camera, ClipboardList, Paperclip, Landmark } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CsvImport } from "@/components/features/csv-import"
import { ItemThumbnail, invalidateThumbnail } from "@/components/features/item-thumbnail"
import { QuickCreateDialog, type QuickCreateEntity } from "@/components/features/quick-create-dialog"
import { DocSlot } from "@/components/features/doc-slot"
import { formatPrice, formatDate } from "@/lib/utils"
import { findMerchantByName } from "@/lib/fuzzy-match"
import { itemsToCsv, itemsToJson, downloadExport } from "@/lib/export"
import { useI18n } from "@/lib/i18n"
import {
  harmonizedName,
  shortIdHint,
  type AttachmentTypeKey,
  type TemplateContext,
} from "@/lib/filename-template"
import * as api from "@/lib/tauri"

/**
 * Reject path strings that could escape the chosen file: must be absolute
 * (Unix `/...` or Windows `X:\...`) and must not contain `..` segments.
 * Backend re-validates, but failing early avoids misleading UI.
 */
function isSafeLocalPath(p: string): boolean {
  if (!p) return false
  if (p.includes("..")) return false
  const isUnixAbs = p.startsWith("/")
  const isWinAbs = /^[A-Za-z]:[\\/]/.test(p)
  return isUnixAbs || isWinAbs
}

export function ItemsPage() {
  const [items, setItems] = useState<api.Item[]>([])
  const [merchants, setMerchants] = useState<api.Merchant[]>([])
  const [locations, setLocations] = useState<api.Location[]>([])
  const [cards, setCards] = useState<api.PaymentCard[]>([])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<api.Item | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [isGroup, setIsGroup] = useState(false)
  type PickedFile = { path: string; name: string } | null
  type GroupLine = {
    description: string
    price: string
    warranty_months: string
    photo: PickedFile
    // Catégorie détectée par le scanner OCR (achat/licence/bon/service/...).
    // Purement informatif côté formulaire — la DB n'a pas de colonne dédiée,
    // donc on injecte un préfixe dans les notes au moment de la création
    // pour les catégories non-achat (cf. createItem ci-dessous).
    category?: api.LineCategory
  }
  const [lines, setLines] = useState<GroupLine[]>(
    [{ description: "", price: "", warranty_months: "", photo: null }],
  )
  // Order-level shared documents in grouped mode.
  const [sharedDocs, setSharedDocs] = useState<{ invoice: PickedFile; purchase_order: PickedFile }>({
    invoice: null,
    purchase_order: null,
  })
  // Per-product files when creating a single item.
  const [singleFiles, setSingleFiles] = useState<{ photo: PickedFile; invoice: PickedFile; purchase_order: PickedFile }>({
    photo: null,
    invoice: null,
    purchase_order: null,
  })
  const [warrantyHint, setWarrantyHint] = useState<number | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [pendingAttachment, setPendingAttachment] = useState<{ path: string; name: string } | null>(null)
  const [pendingWarranty, setPendingWarranty] = useState<{ months: number } | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [quickCreate, setQuickCreate] = useState<QuickCreateEntity | null>(null)
  const [merchantHint, setMerchantHint] = useState<string>("")
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

  // Pre-fill form from scanner URL params
  useEffect(() => {
    if (loading) return
    const description = searchParams.get("description")
    const date = searchParams.get("date")
    const price = searchParams.get("price")
    const merchantName = searchParams.get("merchant")
    const attachFile = searchParams.get("attachFile")
    const attachName = searchParams.get("attachName")
    const currency = searchParams.get("currency")
    const invoiceNumber = searchParams.get("invoiceNumber")
    const productRef = searchParams.get("productRef")
    const quantity = searchParams.get("quantity")
    const taxRate = searchParams.get("taxRate")
    const priceExclTax = searchParams.get("priceExclTax")
    const warrantyMonths = searchParams.get("warrantyMonths")
    const notes = searchParams.get("notes")
    const multi = searchParams.get("multi") === "1"
    if (description || date || price || merchantName || invoiceNumber || multi) {
      const matchedMerchant = merchantName
        ? findMerchantByName(merchantName, merchants) ?? undefined
        : undefined
      if (merchantName && !matchedMerchant) {
        setMerchantHint(merchantName)
      }
      setForm((prev) => ({
        ...prev,
        description: description || prev.description,
        purchase_date: date || prev.purchase_date,
        purchase_price: price || prev.purchase_price,
        currency: currency || prev.currency,
        merchant_id: matchedMerchant?.id || prev.merchant_id,
        invoice_number: invoiceNumber || prev.invoice_number,
        product_reference: productRef || prev.product_reference,
        quantity: quantity || prev.quantity,
        tax_rate: taxRate || prev.tax_rate,
        price_excl_tax: priceExclTax || prev.price_excl_tax,
        notes: notes || prev.notes,
      }))

      if (multi) {
        // Multi-article flow from scanner: pre-fill the grouped form lines
        // and route the scanned file to the shared invoice slot.
        try {
          const raw = sessionStorage.getItem("trackbuy.pendingOrderLines")
          if (raw) {
            const parsed = JSON.parse(raw) as Array<{
              description: string
              price: number
              warranty_months: number | null
              category?: api.LineCategory
            }>
            setLines(
              parsed.map((l) => ({
                description: l.description,
                price: String(l.price),
                warranty_months: l.warranty_months != null ? String(l.warranty_months) : "",
                photo: null,
                category: l.category,
              })),
            )
            setIsGroup(true)
            sessionStorage.removeItem("trackbuy.pendingOrderLines")
          }
        } catch (err) {
          console.error("Failed to read pendingOrderLines:", err)
        }
        if (attachFile && attachName && isSafeLocalPath(attachFile)) {
          setSharedDocs((prev) => ({ ...prev, invoice: { path: attachFile, name: attachName } }))
        }
        // A warranty detected on a multi-item invoice is just a suggestion —
        // the user decides which lines it applies to (often only some).
        if (warrantyMonths) {
          setWarrantyHint(parseInt(warrantyMonths))
        }
      } else {
        if (attachFile && attachName && isSafeLocalPath(attachFile)) {
          setPendingAttachment({ path: attachFile, name: attachName })
        }
        if (warrantyMonths) {
          setPendingWarranty({ months: parseInt(warrantyMonths) })
        }
        // Show details section if any extended field is filled
        if (invoiceNumber || productRef || taxRate || priceExclTax) {
          setShowDetails(true)
        }
      }
      setShowForm(true)
      setSearchParams({}, { replace: true })
      toast(multi ? "Articles détectés — achat groupé pré-rempli" : "Données du reçu pré-remplies", "success")
    }
  }, [loading, searchParams, merchants, setSearchParams, toast])

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
        setMerchantHint("")
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
    setPendingWarranty(null)
    setPendingAttachment(null)
    setMerchantHint("")
    setIsGroup(false)
    setLines([{ description: "", price: "", warranty_months: "", photo: null }])
    setSingleFiles({ photo: null, invoice: null, purchase_order: null })
    setSharedDocs({ invoice: null, purchase_order: null })
    setWarrantyHint(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      let merchantId = form.merchant_id
      if (!editingItem && !merchantId && merchantHint) {
        const newMerchant = await api.createMerchant({ name: merchantHint })
        merchantId = newMerchant.id
        setMerchants((prev) => [...prev, newMerchant])
        setMerchantHint("")
        setForm((prev) => ({ ...prev, merchant_id: newMerchant.id }))
      }
      if (!merchantId) {
        toast("Marchand requis", "error")
        return
      }
      if (!form.location_id) {
        toast("Lieu requis", "error")
        return
      }
      // Shared helper: builds a template context from the current form state
      // and runs the harmonization. Falls back to the original name on error.
      const merchantName = merchants.find((m) => m.id === merchantId)?.name ?? merchantHint
      const harmonize = async (
        type: AttachmentTypeKey,
        originalName: string,
        extra?: Partial<TemplateContext>,
      ): Promise<string> => {
        try {
          const ctx: TemplateContext = {
            merchant: merchantName,
            date: form.purchase_date,
            invoice_number: form.invoice_number || undefined,
            product_reference: form.product_reference || undefined,
            description: form.description || undefined,
            currency: form.currency || undefined,
            ...extra,
          }
          return await harmonizedName(type, ctx, originalName, shortIdHint())
        } catch {
          return originalName
        }
      }

      if (!editingItem && isGroup) {
        const validLines = lines.filter((l) => l.description.trim() && l.price.trim())
        if (validLines.length === 0) {
          toast("Au moins une ligne avec description et prix", "error")
          return
        }
        // Harmonize the invoice display name passed to the order command.
        const invoiceDisplayName = sharedDocs.invoice
          ? await harmonize("invoice", sharedDocs.invoice.name)
          : undefined

        const result = await api.createOrderWithItems({
          purchase_date: form.purchase_date,
          currency: form.currency || undefined,
          status: form.status,
          merchant_id: merchantId,
          location_id: form.location_id,
          payment_card_id: form.payment_card_id || undefined,
          invoice_number: form.invoice_number || undefined,
          notes: form.notes || undefined,
          lines: validLines.map((l) => {
            // Conserve la catégorie OCR sous forme de tag dans les notes de la
            // ligne pour les non-achats. L'achat physique (`purchase`) ne reçoit
            // pas de tag — c'est le cas par défaut, inutile de polluer.
            const tag =
              l.category === "license"  ? "[Licence] " :
              l.category === "service"  ? "[Service] " :
              l.category === "shipping" ? "[Livraison] " :
              l.category === "voucher"  ? "[Bon/Remise] " :
              l.category === "other"    ? "[Autre] " :
                                          ""
            return {
              description: l.description.trim(),
              purchase_price: parseFloat(l.price),
              warranty_months: l.warranty_months ? parseInt(l.warranty_months) : undefined,
              notes: tag ? tag.trim() : undefined,
            }
          }),
          invoice_source_path: sharedDocs.invoice?.path,
          invoice_display_name: invoiceDisplayName,
        })

        // Attach extras (purchase order shared with the order, per-line photos)
        // after the order is created. Failures here don't roll back the order
        // since the user can re-add them manually from the detail page.
        if (sharedDocs.purchase_order && result.items.length > 0) {
          try {
            const poName = await harmonize("purchase_order", sharedDocs.purchase_order.name)
            await api.addAttachment(
              result.items[0].id,
              sharedDocs.purchase_order.path,
              poName,
              "purchase_order",
              true,
            )
          } catch (err) {
            toast(`Bon de commande : ${err}`, "error")
          }
        }
        for (let i = 0; i < validLines.length && i < result.items.length; i++) {
          const photo = validLines[i].photo
          if (photo) {
            try {
              const photoName = await harmonize("photo", photo.name, {
                description: validLines[i].description || undefined,
              })
              await api.addAttachment(result.items[i].id, photo.path, photoName, "photo")
              invalidateThumbnail(result.items[i].id)
            } catch (err) {
              toast(`Photo de "${validLines[i].description}" : ${err}`, "error")
            }
          }
        }
        toast(`Achat groupé créé (${validLines.length} articles)`, "success")
        resetForm()
        await loadItems()
        return
      }
      if (editingItem) {
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
      } else {
        const newItem = await api.createItem({
          description: form.description,
          purchase_date: form.purchase_date,
          purchase_price: parseFloat(form.purchase_price),
          currency: form.currency || undefined,
          merchant_id: merchantId,
          location_id: form.location_id,
          payment_card_id: form.payment_card_id || undefined,
          notes: form.notes || undefined,
          status: form.status,
          invoice_number: form.invoice_number || undefined,
          product_reference: form.product_reference || undefined,
          quantity: form.quantity ? parseInt(form.quantity) : undefined,
          price_excl_tax: form.price_excl_tax ? parseFloat(form.price_excl_tax) : undefined,
          tax_rate: form.tax_rate ? parseFloat(form.tax_rate) : undefined,
        })
        // Auto-attach scanned file if pending
        if (pendingAttachment && newItem) {
          try {
            const attachType: AttachmentTypeKey = pendingAttachment.name.toLowerCase().endsWith(".pdf")
              ? "invoice"
              : "photo"
            const harmonized = await harmonize(attachType, pendingAttachment.name)
            await api.addAttachment(newItem.id, pendingAttachment.path, harmonized, attachType)
            toast(`"${harmonized}" ajouté en pièce jointe`, "success")
          } catch (attachErr) {
            toast(`Pièce jointe: ${attachErr}`, "error")
          }
          setPendingAttachment(null)
        }
        // Attach user-picked files (photo / invoice / purchase order)
        if (newItem) {
          const extras: Array<{ key: keyof typeof singleFiles; type: AttachmentTypeKey; label: string }> = [
            { key: "photo", type: "photo", label: "Photo" },
            { key: "invoice", type: "invoice", label: "Facture" },
            { key: "purchase_order", type: "purchase_order", label: "Bon de commande" },
          ]
          for (const { key, type, label } of extras) {
            const f = singleFiles[key]
            if (!f) continue
            try {
              const harmonized = await harmonize(type, f.name)
              await api.addAttachment(newItem.id, f.path, harmonized, type)
              if (type === "photo") invalidateThumbnail(newItem.id)
            } catch (attachErr) {
              toast(`${label} : ${attachErr}`, "error")
            }
          }
        }
        // Auto-create warranty if pending from scanner
        if (pendingWarranty && newItem) {
          try {
            await api.createWarranty({
              item_id: newItem.id,
              start_date: newItem.purchase_date,
              duration_months: pendingWarranty.months,
              notes: "Garantie fabricant (scanner)",
            })
            toast(t("items.warrantyAutoCreated"), "success")
          } catch (warrantyErr) {
            toast(`Garantie: ${warrantyErr}`, "error")
          }
          setPendingWarranty(null)
        }
      }
      toast(editingItem ? "Article modifié" : "Article ajouté", "success")
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
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="h-4 w-4" />
            Importer
          </Button>
          {!selectionMode && items.length > 1 && (
            <Button variant="outline" onClick={() => setSelectionMode(true)}>
              <Layers className="h-4 w-4" />
              Regrouper
            </Button>
          )}
          <Button onClick={() => { resetForm(); setShowForm(true) }}>
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

      {/* CSV Import */}
      {showImport && (
        <CsvImport
          onComplete={() => { setShowImport(false); loadItems() }}
          onCancel={() => setShowImport(false)}
        />
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
            <CardTitle className="text-lg">
              {editingItem ? "Modifier l'achat" : "Nouvel achat"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              {!editingItem && (
                <div className="sm:col-span-2 flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
                  <input
                    id="grouped-toggle"
                    type="checkbox"
                    checked={isGroup}
                    onChange={(e) => setIsGroup(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <label htmlFor="grouped-toggle" className="flex-1 text-sm font-medium cursor-pointer flex items-center gap-2">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    Achat avec plusieurs articles (une facture commune)
                  </label>
                </div>
              )}

              {!isGroup && (
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">Description *</label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    required
                    autoFocus
                  />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Date d'achat *</label>
                <Input
                  type="date"
                  value={form.purchase_date}
                  onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                  required
                />
              </div>
              {!isGroup ? (
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
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Devise</label>
                  <select
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="CHF">CHF</option>
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="CAD">CAD</option>
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <label className="text-sm font-medium">Marchand *</label>
                <div className="flex gap-2">
                  <select
                    value={form.merchant_id}
                    onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">
                      {merchantHint ? `${merchantHint} (à créer)` : "Sélectionner..."}
                    </option>
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
                {merchantHint && !form.merchant_id && (
                  <p className="text-xs text-muted-foreground">
                    Suggestion du scanner : « {merchantHint} ». Cliquez « Créer marchand & enregistrer » en bas pour le créer en un clic.
                  </p>
                )}
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

              {/* Single mode: per-product attachments at creation */}
              {!isGroup && !editingItem && (
                <div className="sm:col-span-2 space-y-2 rounded-lg border bg-muted/20 p-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    Pièces jointes (optionnelles)
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <DocSlot
                      label="Photo du produit"
                      icon={<Camera className="h-3.5 w-3.5" />}
                      value={singleFiles.photo}
                      onChange={(v) => setSingleFiles((prev) => ({ ...prev, photo: v }))}
                      dialogTitle="Choisir la photo du produit"
                      imageOnly
                    />
                    <DocSlot
                      label="Facture"
                      icon={<FileText className="h-3.5 w-3.5" />}
                      value={singleFiles.invoice}
                      onChange={(v) => setSingleFiles((prev) => ({ ...prev, invoice: v }))}
                      dialogTitle="Choisir la facture"
                    />
                    <DocSlot
                      label="Bon de commande"
                      icon={<ClipboardList className="h-3.5 w-3.5" />}
                      value={singleFiles.purchase_order}
                      onChange={(v) => setSingleFiles((prev) => ({ ...prev, purchase_order: v }))}
                      dialogTitle="Choisir le bon de commande"
                    />
                  </div>
                </div>
              )}

              {/* Grouped purchase: lines + shared invoice */}
              {isGroup && (
                <div className="sm:col-span-2 space-y-3 rounded-lg border bg-muted/20 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      Articles de cet achat
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLines((prev) => [...prev, { description: "", price: "", warranty_months: "", photo: null }])}
                    >
                      <Plus className="h-3 w-3" />
                      Ajouter une ligne
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    La garantie peut être différente pour chaque article. Laisse vide si l'article n'a pas de garantie.
                  </p>
                  {warrantyHint !== null && warrantyHint > 0 && (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-2">
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        Garantie détectée : <span className="font-semibold">{warrantyHint} mois</span>. Appliquer à quels articles ?
                      </p>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setLines((prev) =>
                              prev.map((l) => (l.warranty_months ? l : { ...l, warranty_months: String(warrantyHint) })),
                            )
                          }
                        >
                          Lignes vides
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setLines((prev) => prev.map((l) => ({ ...l, warranty_months: String(warrantyHint) })))}
                        >
                          Tout
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setWarrantyHint(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="space-y-3">
                    {lines.map((line, idx) => (
                      <div key={idx} className="rounded-md border bg-card p-2 space-y-2">
                        <div className="grid gap-2 sm:grid-cols-12 items-end">
                          <div className="sm:col-span-6 space-y-1">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                              <span>Description *</span>
                              {line.category && line.category !== "purchase" && (
                                <span
                                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                                    line.category === "license"  ? "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30" :
                                    line.category === "service"  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" :
                                    line.category === "shipping" ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30" :
                                    line.category === "voucher"  ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" :
                                                                   "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30"
                                  }`}
                                  title="Catégorie détectée par le scanner — sera ajoutée en préfixe des notes"
                                >
                                  {line.category === "license"  ? "Licence" :
                                   line.category === "service"  ? "Service" :
                                   line.category === "shipping" ? "Livraison" :
                                   line.category === "voucher"  ? "Bon/Remise" :
                                                                  "Autre"}
                                </span>
                              )}
                            </label>
                            <Input
                              value={line.description}
                              onChange={(e) =>
                                setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, description: e.target.value } : l)))
                              }
                              placeholder="Article"
                            />
                          </div>
                          <div className="sm:col-span-3 space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Prix *</label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.price}
                              onChange={(e) =>
                                setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, price: e.target.value } : l)))
                              }
                            />
                          </div>
                          <div className="sm:col-span-2 space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Garantie (mois)</label>
                            <Input
                              type="number"
                              min="0"
                              value={line.warranty_months}
                              onChange={(e) =>
                                setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, warranty_months: e.target.value } : l)))
                              }
                              placeholder="aucune"
                              title="Laisse vide ou 0 pour aucune garantie"
                            />
                          </div>
                          <div className="sm:col-span-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={lines.length === 1}
                              onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                              title="Retirer cette ligne"
                            >
                              <X className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                        </div>
                        <DocSlot
                          label="Photo du produit"
                          icon={<Camera className="h-3.5 w-3.5" />}
                          value={line.photo}
                          onChange={(v) =>
                            setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, photo: v } : l)))
                          }
                          dialogTitle="Choisir la photo du produit"
                          imageOnly
                        />
                      </div>
                    ))}
                  </div>
                  <div className="pt-3 border-t space-y-2">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      Documents partagés (optionnels)
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <DocSlot
                        label="Facture"
                        icon={<FileText className="h-3.5 w-3.5" />}
                        value={sharedDocs.invoice}
                        onChange={(v) => setSharedDocs((prev) => ({ ...prev, invoice: v }))}
                        dialogTitle="Choisir la facture"
                      />
                      <DocSlot
                        label="Bon de commande"
                        icon={<ClipboardList className="h-3.5 w-3.5" />}
                        value={sharedDocs.purchase_order}
                        onChange={(v) => setSharedDocs((prev) => ({ ...prev, purchase_order: v }))}
                        dialogTitle="Choisir le bon de commande"
                      />
                    </div>
                  </div>
                </div>
              )}

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
                    {!isGroup && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.productReference")}</label>
                      <Input
                        value={form.product_reference}
                        onChange={(e) => setForm({ ...form, product_reference: e.target.value })}
                        placeholder="59345975"
                      />
                    </div>
                    )}
                    {!isGroup && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.quantity")}</label>
                      <Input
                        type="number"
                        min="1"
                        value={form.quantity}
                        onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                      />
                    </div>
                    )}
                    {!isGroup && (
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
                    )}
                    {!isGroup && (
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
                    )}
                    {!isGroup && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t("items.taxAmount")}</label>
                      <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                        {form.purchase_price && form.price_excl_tax
                          ? (parseFloat(form.purchase_price) - parseFloat(form.price_excl_tax)).toFixed(2)
                          : "—"}
                      </div>
                    </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit">
                  {editingItem
                    ? "Modifier"
                    : isGroup
                    ? `Créer ${lines.filter((l) => l.description.trim() && l.price.trim()).length || ""} article${lines.filter((l) => l.description.trim() && l.price.trim()).length > 1 ? "s" : ""}`.trim()
                    : merchantHint && !form.merchant_id
                    ? "Créer marchand & enregistrer"
                    : "Ajouter"}
                </Button>
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
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ShoppingBag className="h-12 w-12 mb-4 opacity-20" />
              <p>Aucun achat trouvé</p>
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
        initialName={quickCreate === "merchant" ? merchantHint : ""}
        onClose={() => setQuickCreate(null)}
        onCreated={handleQuickCreated}
      />
    </div>
  )
}

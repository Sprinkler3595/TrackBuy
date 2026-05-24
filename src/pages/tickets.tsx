import { useEffect, useState, useCallback, useMemo } from "react"
import {
  Plus,
  Search,
  Trash2,
  Ticket,
  Tag,
  KeyRound,
  Calendar,
  MapPin,
  Link as LinkIcon,
  Eye,
  EyeOff,
  Copy,
  Check,
  CheckCircle2,
  Upload,
  X,
  ExternalLink,
  Paperclip,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { QuickCreateDialog, type QuickCreateEntity } from "@/components/features/quick-create-dialog"
import { formatPrice, formatDate } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import * as api from "@/lib/tauri"

/**
 * Same defense-in-depth path check used by the items page — backend
 * re-validates, but failing fast in the UI saves a round trip.
 */
function isSafeLocalPath(p: string): boolean {
  if (!p) return false
  if (p.includes("..")) return false
  const isUnixAbs = p.startsWith("/")
  const isWinAbs = /^[A-Za-z]:[\\/]/.test(p)
  return isUnixAbs || isWinAbs
}

type DigitalKind = Exclude<api.ItemKind, "physical">

const KIND_ICON: Record<DigitalKind, typeof Ticket> = {
  ticket: Ticket,
  voucher: Tag,
  license: KeyRound,
}

const KIND_CODE_TYPE: Record<DigitalKind, string> = {
  ticket: "ticket_code",
  voucher: "voucher_code",
  license: "license_key",
}

interface PickedFile {
  path: string
  name: string
}

export function TicketsPage() {
  const { t, locale } = useI18n()
  const { toast } = useToast()

  const [items, setItems] = useState<api.Item[]>([])
  const [merchants, setMerchants] = useState<api.Merchant[]>([])
  const [locations, setLocations] = useState<api.Location[]>([])
  const [search, setSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<DigitalKind | "all">("all")
  const [showUsed, setShowUsed] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<api.Item | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<api.Item | null>(null)
  const [quickCreate, setQuickCreate] = useState<QuickCreateEntity | null>(null)

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const [form, setForm] = useState({
    kind: "ticket" as DigitalKind,
    description: "",
    purchase_date: today,
    purchase_price: "",
    currency: "CHF",
    merchant_id: "",
    location_id: "",
    notes: "",
    event_datetime: "",
    event_location: "",
    expiration_date: "",
    redemption_url: "",
    code: "",
    file: null as PickedFile | null,
  })



  // ----------------------- Data loading ---------------------------------

  const loadItems = useCallback(async () => {
    try {
      const data = await api.getItems({
        search: search || undefined,
        // Backend filter: "digital" returns ticket+voucher+license; specific
        // kind narrows further.
        kind: kindFilter === "all" ? "digital" : kindFilter,
      })
      setItems(data)
    } catch (err) {
      console.error("Failed to load tickets:", err)
    }
  }, [search, kindFilter])

  useEffect(() => {
    loadItems()
  }, [loadItems])

  useEffect(() => {
    api.getMerchants().then(setMerchants).catch(console.error)
    api.getLocations().then(setLocations).catch(console.error)
  }, [])

  // Visible list = items filter + redeemed visibility toggle.
  const visibleItems = useMemo(() => {
    return items.filter((it) => showUsed || !it.redeemed_at)
  }, [items, showUsed])

  // ----------------------- Form helpers ---------------------------------

  const resetForm = () => {
    setForm({
      kind: "ticket",
      description: "",
      purchase_date: today,
      purchase_price: "",
      currency: "CHF",
      merchant_id: "",
      location_id: "",
      notes: "",
      event_datetime: "",
      event_location: "",
      expiration_date: "",
      redemption_url: "",
      code: "",
      file: null,
    })
    setEditing(null)
    setShowForm(false)
  }

  const openEdit = (item: api.Item) => {
    setEditing(item)
    setForm({
      kind: (item.item_kind === "physical" ? "ticket" : item.item_kind) as DigitalKind,
      description: item.description,
      purchase_date: item.purchase_date,
      purchase_price: String(item.purchase_price),
      currency: item.currency,
      merchant_id: item.merchant_id,
      location_id: item.location_id,
      notes: item.notes ?? "",
      event_datetime: item.event_datetime ?? "",
      event_location: item.event_location ?? "",
      expiration_date: item.expiration_date ?? "",
      redemption_url: item.redemption_url ?? "",
      code: "",
      file: null,
    })
    setShowForm(true)
  }

  const pickFile = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({
        multiple: false,
        title: t("tickets.attachFile"),
        filters: [
          { name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "webp"] },
        ],
      })
      if (typeof selected === "string" && isSafeLocalPath(selected)) {
        const name = selected.split("/").pop() || selected.split("\\").pop() || "fichier"
        setForm((f) => ({ ...f, file: { path: selected, name } }))
      }
    } catch (err) {
      console.error(err)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.description || !form.merchant_id || !form.location_id) {
      toast(locale === "fr" ? "Champs requis manquants" : "Missing required fields", "error")
      return
    }

    try {
      if (editing) {
        await api.updateItem({
          ...editing,
          description: form.description,
          purchase_date: form.purchase_date,
          purchase_price: parseFloat(form.purchase_price || "0"),
          currency: form.currency,
          merchant_id: form.merchant_id,
          location_id: form.location_id,
          notes: form.notes || null,
          item_kind: form.kind,
          event_datetime: form.kind === "ticket" ? form.event_datetime || null : null,
          event_location: form.kind === "ticket" ? form.event_location || null : null,
          expiration_date: form.expiration_date || null,
          redemption_url: form.kind !== "ticket" ? form.redemption_url || null : null,
        })
        toast(locale === "fr" ? "Mis à jour" : "Updated", "success")
      } else {
        const created = await api.createItem({
          description: form.description,
          purchase_date: form.purchase_date,
          purchase_price: parseFloat(form.purchase_price || "0"),
          currency: form.currency,
          merchant_id: form.merchant_id,
          location_id: form.location_id,
          notes: form.notes || undefined,
          item_kind: form.kind,
          event_datetime: form.kind === "ticket" ? form.event_datetime || undefined : undefined,
          event_location: form.kind === "ticket" ? form.event_location || undefined : undefined,
          expiration_date: form.expiration_date || undefined,
          redemption_url: form.kind !== "ticket" ? form.redemption_url || undefined : undefined,
        })

        // Code: stored as a text attachment encrypted on disk. Empty input is
        // valid — not every ticket has a textual code (a PDF/QR may suffice).
        if (form.code.trim()) {
          try {
            await api.addTextAttachment(
              created.id,
              form.code.trim(),
              undefined,
              KIND_CODE_TYPE[form.kind],
            )
          } catch (err) {
            toast(`${t("tickets.code")}: ${err}`, "error")
          }
        }

        // File: PDF du billet, QR code, scan du voucher, etc.
        if (form.file) {
          try {
            await api.addAttachment(
              created.id,
              form.file.path,
              form.file.name,
              form.kind === "ticket" ? "ticket_file" : `${form.kind}_file`,
            )
          } catch (err) {
            toast(`${t("tickets.attachFile")}: ${err}`, "error")
          }
        }

        toast(locale === "fr" ? "Créé" : "Created", "success")
      }
      resetForm()
      await loadItems()
    } catch (err) {
      toast(String(err), "error")
    }
  }

  // ----------------------- Item actions ---------------------------------

  const toggleUsed = async (item: api.Item) => {
    try {
      await api.updateItem({
        ...item,
        redeemed_at: item.redeemed_at ? null : new Date().toISOString().slice(0, 10),
      })
      await loadItems()
    } catch (err) {
      toast(String(err), "error")
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.deleteItem(deleteTarget.id)
      toast(locale === "fr" ? "Supprimé" : "Deleted", "success")
      setDeleteTarget(null)
      if (expandedId === deleteTarget.id) setExpandedId(null)
      await loadItems()
    } catch (err) {
      toast(String(err), "error")
    }
  }

  // ----------------------- Render ---------------------------------------

  const kindOptions: Array<{ value: DigitalKind | "all"; label: string }> = [
    { value: "all", label: t("common.all") },
    { value: "ticket", label: t("tickets.kindTicket") },
    { value: "voucher", label: t("tickets.kindVoucher") },
    { value: "license", label: t("tickets.kindLicense") },
  ]

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("tickets.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("tickets.subtitle")}</p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("tickets.new")}
        </Button>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("common.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {kindOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setKindFilter(opt.value)}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                kindFilter === opt.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showUsed}
            onChange={(e) => setShowUsed(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          {locale === "fr" ? "Afficher utilisés" : "Show used"}
        </label>
      </div>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 flex-wrap">
              {editing
                ? locale === "fr" ? "Modifier" : "Edit"
                : t("tickets.new")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {/* Kind selector */}
              <div className="grid grid-cols-3 gap-2">
                {(["ticket", "voucher", "license"] as DigitalKind[]).map((k) => {
                  const Icon = KIND_ICON[k]
                  const label =
                    k === "ticket" ? t("tickets.kindTicket")
                    : k === "voucher" ? t("tickets.kindVoucher")
                    : t("tickets.kindLicense")
                  const active = form.kind === k
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setForm({ ...form, kind: k })}
                      className={`flex flex-col items-center gap-1 rounded-md border p-3 text-sm transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input bg-background hover:bg-accent"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {label}
                    </button>
                  )
                })}
              </div>

              {/* Common fields */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-sm font-medium">{t("items.description")} *</label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder={
                      form.kind === "ticket"
                        ? locale === "fr" ? "Ex: Concert Coldplay" : "e.g. Coldplay concert"
                        : form.kind === "voucher"
                        ? locale === "fr" ? "Ex: Bon Qoqa 50 CHF" : "e.g. Qoqa voucher 50 CHF"
                        : locale === "fr" ? "Ex: Licence Steam — Cyberpunk" : "e.g. Steam license — Cyberpunk"
                    }
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("items.purchaseDate")} *</label>
                  <Input
                    type="date"
                    value={form.purchase_date}
                    onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("items.price")}</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.purchase_price}
                    onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("items.merchant")} *</label>
                  <div className="flex gap-2">
                    <select
                      value={form.merchant_id}
                      onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">{t("items.select")}</option>
                      {merchants.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setQuickCreate("merchant")}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("items.location")} *</label>
                  <div className="flex gap-2">
                    <select
                      value={form.location_id}
                      onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      required
                    >
                      <option value="">{t("items.select")}</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => setQuickCreate("location")}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Kind-specific fields */}
              {form.kind === "ticket" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t pt-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">{t("tickets.eventDate")}</label>
                    <Input
                      type="datetime-local"
                      value={form.event_datetime}
                      onChange={(e) => setForm({ ...form, event_datetime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">{t("tickets.eventLocation")}</label>
                    <Input
                      value={form.event_location}
                      onChange={(e) => setForm({ ...form, event_location: e.target.value })}
                      placeholder={locale === "fr" ? "Ex: Stade de Suisse, Berne" : "e.g. Stade de Suisse, Bern"}
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-sm font-medium">{t("tickets.expirationDate")}</label>
                    <Input
                      type="date"
                      value={form.expiration_date}
                      onChange={(e) => setForm({ ...form, expiration_date: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {form.kind !== "ticket" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t pt-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">{t("tickets.expirationDate")}</label>
                    <Input
                      type="date"
                      value={form.expiration_date}
                      onChange={(e) => setForm({ ...form, expiration_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">{t("tickets.redemptionUrl")}</label>
                    <Input
                      type="url"
                      value={form.redemption_url}
                      onChange={(e) => setForm({ ...form, redemption_url: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                </div>
              )}

              {/* Code (only on create — edit doesn't touch attachments here;
                  user manages them from the item detail). */}
              {!editing && (
                <div className="border-t pt-4 space-y-1">
                  <label className="text-sm font-medium">{t("tickets.code")}</label>
                  <textarea
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder={t("tickets.codePlaceholder")}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    {locale === "fr"
                      ? "Le code est chiffré sur disque (ChaCha20-Poly1305)."
                      : "The code is encrypted on disk (ChaCha20-Poly1305)."}
                  </p>
                </div>
              )}

              {/* File attachment (only on create) */}
              {!editing && (
                <div className="border-t pt-4 space-y-1">
                  <label className="text-sm font-medium">{t("tickets.attachFile")}</label>
                  {form.file ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border bg-card p-2 text-sm">
                      <span className="truncate">{form.file.name}</span>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, file: null })}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={pickFile}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {t("tickets.attachFileHint")}
                    </button>
                  )}
                </div>
              )}

              <div className="border-t pt-4 space-y-1">
                <label className="text-sm font-medium">{t("items.notes")}</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onClick={resetForm}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit">{t("common.save")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {visibleItems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("tickets.noItems")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {visibleItems.map((item) => (
            <TicketCard
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggleExpand={() =>
                setExpandedId((prev) => (prev === item.id ? null : item.id))
              }
              onEdit={() => openEdit(item)}
              onDelete={() => setDeleteTarget(item)}
              onToggleUsed={() => toggleUsed(item)}
            />
          ))}
        </div>
      )}

      <QuickCreateDialog
        entity={quickCreate}
        onClose={() => setQuickCreate(null)}
        onCreated={(entity, id) => {
          setQuickCreate(null)
          if (entity === "merchant") {
            api.getMerchants().then(setMerchants)
            setForm((f) => ({ ...f, merchant_id: id }))
          } else if (entity === "location") {
            api.getLocations().then(setLocations)
            setForm((f) => ({ ...f, location_id: id }))
          }
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={t("common.delete")}
        message={`${deleteTarget?.description ?? ""} — ${
          locale === "fr"
            ? "Cette action est irréversible."
            : "This action is irreversible."
        }`}
        confirmLabel={t("common.delete")}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        variant="destructive"
      />
    </div>
  )
}

// =====================================================================
// Item card
// =====================================================================

interface TicketCardProps {
  item: api.Item
  expanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleUsed: () => void
}

function TicketCard({ item, expanded, onToggleExpand, onEdit, onDelete, onToggleUsed }: TicketCardProps) {
  const { t, locale } = useI18n()
  const Icon = KIND_ICON[item.item_kind as DigitalKind] ?? Ticket
  const kindLabel =
    item.item_kind === "ticket" ? t("tickets.kindTicket")
    : item.item_kind === "voucher" ? t("tickets.kindVoucher")
    : t("tickets.kindLicense")

  return (
    <Card>
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-start justify-between gap-4 p-4 text-left"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-md bg-muted p-2">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium truncate">{item.description}</span>
              <Badge variant="secondary" className="text-xs">{kindLabel}</Badge>
              <StatusBadge item={item} />
            </div>
            <p className="text-xs text-muted-foreground">
              {item.merchant_name} · {formatDate(item.purchase_date)}
              {item.purchase_price > 0 && (
                <> · {formatPrice(item.purchase_price, item.currency)}</>
              )}
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <CardContent className="border-t pt-4 space-y-4">
          <DigitalDetails item={item} />
          <SecretSection item={item} />
          <FileSection item={item} />

          <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleUsed}
              className="gap-1.5"
            >
              {item.redeemed_at ? (
                <>
                  <X className="h-3.5 w-3.5" />
                  {t("tickets.markNotUsed")}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("tickets.markUsed")}
                </>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit}>
              {t("common.edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:text-destructive gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common.delete")}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// ---------------------- Status badge ---------------------------------

function StatusBadge({ item }: { item: api.Item }) {
  const { t } = useI18n()

  if (item.redeemed_at) {
    return <Badge variant="secondary" className="text-xs">{t("tickets.used")}</Badge>
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Tickets: surface the upcoming event date (more meaningful than expiration).
  if (item.item_kind === "ticket" && item.event_datetime) {
    const ev = new Date(item.event_datetime)
    const diffMs = ev.getTime() - today.getTime()
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (days < 0) return <Badge variant="outline" className="text-xs">{t("tickets.eventPast")}</Badge>
    const label = t("tickets.eventIn").replace("{n}", String(days))
    const variant = days <= 7 ? "destructive" : days <= 30 ? "warning" : "success"
    return <Badge variant={variant} className="text-xs">{label}</Badge>
  }

  // Vouchers, licenses (or tickets without a specific event date): surface
  // expiration if set.
  if (item.expiration_date) {
    const exp = new Date(item.expiration_date)
    const diffMs = exp.getTime() - today.getTime()
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (days < 0) return <Badge variant="destructive" className="text-xs">{t("tickets.expired")}</Badge>
    const label = t("tickets.expiresIn").replace("{n}", String(days))
    const variant = days <= 7 ? "destructive" : days <= 30 ? "warning" : "success"
    return <Badge variant={variant} className="text-xs">{label}</Badge>
  }

  return <Badge variant="outline" className="text-xs">{t("tickets.notUsed")}</Badge>
}

// ---------------------- Detail rows ---------------------------------

function DigitalDetails({ item }: { item: api.Item }) {
  const { t, locale } = useI18n()
  return (
    <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
      {item.event_datetime && (
        <Row icon={<Calendar className="h-4 w-4" />} label={t("tickets.eventDate")}>
          {new Date(item.event_datetime).toLocaleString(locale === "fr" ? "fr-CH" : "en-US")}
        </Row>
      )}
      {item.event_location && (
        <Row icon={<MapPin className="h-4 w-4" />} label={t("tickets.eventLocation")}>
          {item.event_location}
        </Row>
      )}
      {item.expiration_date && (
        <Row icon={<Calendar className="h-4 w-4" />} label={t("tickets.expirationDate")}>
          {formatDate(item.expiration_date)}
        </Row>
      )}
      {item.redemption_url && (
        <Row icon={<LinkIcon className="h-4 w-4" />} label={t("tickets.redemptionUrl")}>
          <a
            href={item.redemption_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline inline-flex items-center gap-1"
          >
            <span className="truncate">{item.redemption_url}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </Row>
      )}
      {item.notes && (
        <Row icon={<></>} label={t("items.notes")}>
          {item.notes}
        </Row>
      )}
    </dl>
  )
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}

// ---------------------- Secret (code) section -----------------------
// Shows a "Reveal" button. Decryption happens server-side via the existing
// get_attachment_data command. The plaintext never enters localStorage and
// only sits in memory while revealed.

function SecretSection({ item }: { item: api.Item }) {
  const { t, locale } = useI18n()
  const { toast } = useToast()
  const [attachments, setAttachments] = useState<api.Attachment[]>([])
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    api.getAttachments(item.id).then(setAttachments).catch(console.error)
  }, [item.id])

  const codeAttachments = attachments.filter((a) =>
    ["ticket_code", "voucher_code", "license_key", "secret"].includes(a.attachment_type)
  )

  if (codeAttachments.length === 0) return null

  const decodeDataUrl = (dataUrl: string): string => {
    // The backend returns "data:text/plain;base64,XXXX". We only support
    // text codes here (anything else means a stale type label and we just
    // fall back to a friendly message).
    const i = dataUrl.indexOf(",")
    if (i < 0) return ""
    try {
      return atob(dataUrl.slice(i + 1))
    } catch {
      return ""
    }
  }

  const reveal = async (attId: string) => {
    if (revealed[attId]) {
      setRevealed((r) => {
        const next = { ...r }
        delete next[attId]
        return next
      })
      return
    }
    try {
      const dataUrl = await api.getAttachmentData(attId)
      const text = decodeDataUrl(dataUrl)
      setRevealed((r) => ({ ...r, [attId]: text }))
    } catch (err) {
      toast(String(err), "error")
    }
  }

  const copy = async (attId: string) => {
    try {
      let text = revealed[attId]
      if (!text) {
        const dataUrl = await api.getAttachmentData(attId)
        text = decodeDataUrl(dataUrl)
      }
      await navigator.clipboard.writeText(text)
      setCopiedId(attId)
      toast(t("tickets.codeCopied"), "success")
      setTimeout(() => setCopiedId((id) => (id === attId ? null : id)), 1500)
    } catch (err) {
      toast(String(err), "error")
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("tickets.codeStored")}
      </p>
      {codeAttachments.map((att) => (
        <div key={att.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-background px-2 py-1.5 text-sm font-mono break-all">
              {revealed[att.id] ?? "••••••••••••••••"}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => reveal(att.id)}
              className="gap-1.5"
            >
              {revealed[att.id] ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" />
                  {t("tickets.hideCode")}
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  {t("tickets.revealCode")}
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(att.id)}
              className="gap-1.5"
            >
              {copiedId === att.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {t("tickets.copyCode")}
            </Button>
          </div>
          {att.display_name && att.display_name !== "Code" && (
            <p className="text-xs text-muted-foreground">{att.display_name}</p>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {locale === "fr"
          ? "Le contenu est déchiffré en mémoire à la demande."
          : "The content is decrypted in memory on demand."}
      </p>
    </div>
  )
}

// ---------------------- File attachments section ---------------------

function FileSection({ item }: { item: api.Item }) {
  const { t } = useI18n()
  const [attachments, setAttachments] = useState<api.Attachment[]>([])

  useEffect(() => {
    api.getAttachments(item.id).then(setAttachments).catch(console.error)
  }, [item.id])

  const fileAttachments = attachments.filter(
    (a) => !["ticket_code", "voucher_code", "license_key", "secret"].includes(a.attachment_type)
  )

  if (fileAttachments.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("attachments.title")}
      </p>
      <div className="space-y-1">
        {fileAttachments.map((att) => (
          <div
            key={att.id}
            className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm"
          >
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1 truncate">{att.display_name}</span>
            <span className="text-xs text-muted-foreground">
              {(att.size_bytes / 1024).toFixed(1)} KB
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

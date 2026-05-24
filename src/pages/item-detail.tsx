import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Edit, ShoppingBag, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { WarrantyPanel } from "@/components/features/warranty-panel"
import { AttachmentsPanel } from "@/components/features/attachments-panel"
import { AttachmentViewer } from "@/components/features/attachment-viewer"
import { ItemThumbnail } from "@/components/features/item-thumbnail"
import { formatDate, formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

interface InfoRowProps {
  label: string
  value: React.ReactNode
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</p>
    </div>
  )
}

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [item, setItem] = useState<api.Item | null>(null)
  const [siblings, setSiblings] = useState<api.Item[]>([])
  const [card, setCard] = useState<api.PaymentCard | null>(null)
  const [images, setImages] = useState<api.Attachment[]>([])
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null)
  const [activeImageAtt, setActiveImageAtt] = useState<api.Attachment | null>(null)
  const [viewerTarget, setViewerTarget] = useState<api.Attachment | null>(null)
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      // Locate the item. A failure here is the only thing that should mark
      // the article as "not found" — downstream errors (attachments, cards)
      // must not clobber a successful item lookup.
      let found: api.Item | null = null
      let all: api.Item[] = []
      try {
        all = await api.getItems()
        found = all.find((it) => it.id === id) ?? null
      } catch (err) {
        console.error("Failed to load items:", err)
        if (!cancelled) {
          setNotFound(true)
          setLoading(false)
        }
        return
      }
      if (cancelled) return
      if (!found) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setItem(found)
      setLoading(false)

      // Best-effort: enrich with siblings, card and images. Failures here are
      // logged but do not invalidate the page.
      if (found.order_id) {
        setSiblings(all.filter((it) => it.order_id === found!.order_id && it.id !== found!.id))
      } else {
        setSiblings([])
      }
      if (found.payment_card_id) {
        try {
          const cards = await api.getCards()
          if (!cancelled) {
            setCard(cards.find((c) => c.id === found!.payment_card_id) ?? null)
          }
        } catch (err) {
          console.warn("Failed to load card:", err)
        }
      }
      try {
        const atts = await api.getAttachments(found.id)
        if (cancelled) return
        const imgs = atts.filter((a) => a.mime_type.startsWith("image/"))
        setImages(imgs)
        if (imgs.length > 0) {
          try {
            const first = await api.getAttachmentData(imgs[0].id)
            if (cancelled) return
            setActiveImageUrl(first)
            setActiveImageAtt(imgs[0])
            setThumbUrls({ [imgs[0].id]: first })
          } catch (err) {
            console.warn("Failed to load first image:", err)
          }
        }
      } catch (err) {
        console.warn("Failed to load attachments:", err)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [id])

  const handlePickImage = async (att: api.Attachment) => {
    setActiveImageAtt(att)
    if (thumbUrls[att.id]) {
      setActiveImageUrl(thumbUrls[att.id])
      return
    }
    try {
      const url = await api.getAttachmentData(att.id)
      setThumbUrls((prev) => ({ ...prev, [att.id]: url }))
      setActiveImageUrl(url)
    } catch (err) {
      console.error(err)
    }
  }

  const handleExportFromViewer = async (att: api.Attachment) => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const destination = await save({ defaultPath: att.display_name, title: "Exporter" })
      if (destination) {
        await api.exportAttachment(att.id, destination)
      }
    } catch (err) {
      console.error(err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (notFound || !item) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/items")}>
          <ArrowLeft className="h-4 w-4" />
          Achats
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Article introuvable.
          </CardContent>
        </Card>
      </div>
    )
  }

  const taxAmount =
    item.purchase_price != null && item.price_excl_tax != null
      ? item.purchase_price - item.price_excl_tax
      : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => navigate("/items")} className="-ml-2 mb-2">
            <ArrowLeft className="h-4 w-4" />
            Achats
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold tracking-tight">{item.description}</h2>
            <Badge variant={item.status === "active" ? "success" : "secondary"}>
              {item.status === "active" ? "Actif" : "Archivé"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {item.merchant_name} &middot; {item.location_name} &middot; {formatDate(item.purchase_date)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-2xl font-semibold whitespace-nowrap">
            {formatPrice(item.purchase_price, item.currency)}
          </span>
          <Button variant="outline" size="sm" onClick={() => navigate(`/items?edit=${item.id}`)}>
            <Edit className="h-4 w-4" />
            Modifier
          </Button>
        </div>
      </div>

      {/* Image gallery */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {activeImageUrl ? (
            <button
              type="button"
              onClick={() => activeImageAtt && setViewerTarget(activeImageAtt)}
              className="flex w-full items-center justify-center rounded-lg bg-muted/30 overflow-hidden cursor-zoom-in"
              title="Cliquer pour agrandir"
            >
              <img
                src={activeImageUrl}
                alt={item.description}
                className="max-h-[400px] w-auto object-contain"
              />
            </button>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 py-16 text-muted-foreground">
              <ShoppingBag className="h-12 w-12 opacity-30 mb-2" />
              <p className="text-sm">Aucune photo du produit</p>
              <p className="text-xs">Ajoutez-en via les pièces jointes ci-dessous</p>
            </div>
          )}
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((img) => {
                const url = thumbUrls[img.id]
                const isActive = url && url === activeImageUrl
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => handlePickImage(img)}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                      isActive ? "border-primary" : "border-transparent hover:border-muted-foreground/30"
                    }`}
                  >
                    {url ? (
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-muted flex items-center justify-center">
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Informations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Informations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow label="Marchand" value={item.merchant_name} />
            <InfoRow label="Lieu" value={item.location_name} />
            <InfoRow label="Date d'achat" value={formatDate(item.purchase_date)} />
            <InfoRow
              label="Carte de paiement"
              value={
                card
                  ? `${card.name}${card.is_credit_card ? " (crédit)" : ""}`
                  : item.card_name || null
              }
            />
            <InfoRow label="Prix TTC" value={formatPrice(item.purchase_price, item.currency)} />
            <InfoRow
              label="Prix HT"
              value={item.price_excl_tax != null ? formatPrice(item.price_excl_tax, item.currency) : null}
            />
            <InfoRow label="Taux de TVA" value={item.tax_rate != null ? `${item.tax_rate} %` : null} />
            <InfoRow
              label="Montant TVA"
              value={taxAmount != null ? formatPrice(taxAmount, item.currency) : null}
            />
            <InfoRow label="N° facture" value={item.invoice_number} />
            <InfoRow label="Référence produit" value={item.product_reference} />
            <InfoRow label="Quantité" value={item.quantity} />
            <InfoRow label="Notes" value={item.notes} />
          </div>
        </CardContent>
      </Card>

      {/* Articles du même achat */}
      {item.order_id && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              Articles du même achat
              <Badge variant="secondary" className="ml-1">{siblings.length + 1}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {siblings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Cet article est seul dans son achat groupé.
              </p>
            ) : (
              <div className="space-y-2">
                {siblings.map((s) => (
                  <Link
                    key={s.id}
                    to={`/items/${s.id}`}
                    className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/40 transition-colors"
                  >
                    <ItemThumbnail itemId={s.id} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(s.purchase_date)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold whitespace-nowrap">
                      {formatPrice(s.purchase_price, s.currency)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Garanties */}
      <WarrantyPanel
        itemId={item.id}
        itemDescription={item.description}
        purchaseDate={item.purchase_date}
        cardWarrantyMonths={card?.extended_warranty_months}
      />

      {/* Pièces jointes */}
      <AttachmentsPanel
        itemId={item.id}
        itemDescription={item.description}
        orderId={item.order_id}
        templateContext={{
          merchant: item.merchant_name ?? undefined,
          date: item.purchase_date,
          invoice_number: item.invoice_number ?? undefined,
          product_reference: item.product_reference ?? undefined,
          item_kind: item.item_kind,
          event_datetime: item.event_datetime ?? undefined,
          event_location: item.event_location ?? undefined,
          currency: item.currency,
        }}
      />

      <AttachmentViewer
        attachment={viewerTarget}
        onClose={() => setViewerTarget(null)}
        onExport={handleExportFromViewer}
      />
    </div>
  )
}

import { useEffect, useState, useRef } from "react"
import { Paperclip, Trash2, Download, Upload, FileText, Image, File, Receipt, Shield, ClipboardList, ImageIcon, Layers, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { invalidateThumbnail } from "@/components/features/item-thumbnail"
import { AttachmentViewer } from "@/components/features/attachment-viewer"
import {
  harmonizedName,
  shortIdHint,
  type AttachmentTypeKey,
  type TemplateContext,
} from "@/lib/filename-template"
import * as api from "@/lib/tauri"

interface AttachmentsPanelProps {
  /// Target entity. Exactly one of itemId / subscriptionId must be set.
  itemId?: string
  subscriptionId?: string
  itemDescription: string
  orderId?: string | null
  /// Optional richer context (merchant, purchase_date, invoice_number…) used
  /// when harmonizing the display name of newly-attached files. Falls back to
  /// description + today's date if not provided.
  templateContext?: Partial<TemplateContext>
}

const ATTACHMENT_TYPES = [
  { slug: "invoice", label: "Ticket / Facture", Icon: Receipt },
  { slug: "warranty", label: "Garantie", Icon: Shield },
  { slug: "purchase_order", label: "Bon de commande", Icon: ClipboardList },
  { slug: "photo", label: "Image", Icon: ImageIcon },
  { slug: "other", label: "Autre", Icon: File },
] as const

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image
  if (mimeType === "application/pdf") return FileText
  return File
}

function getTypeLabel(slug: string): string {
  return ATTACHMENT_TYPES.find((t) => t.slug === slug)?.label ?? slug
}

interface PendingFiles {
  paths: string[]
}

interface TypePickerProps {
  count: number
  canShare: boolean
  onPick: (slug: string, shareWithOrder: boolean) => void
  onCancel: () => void
}

function TypePicker({ count, canShare, onPick, onCancel }: TypePickerProps) {
  const [share, setShare] = useState(false)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">Type de pièce jointe</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {count > 1
            ? `Choisir un type pour les ${count} fichiers sélectionnés.`
            : "Choisir un type pour le fichier sélectionné."}
        </p>
        {canShare && (
          <label className="flex items-center gap-2 mt-3 rounded-md border bg-muted/30 p-2 cursor-pointer">
            <input
              type="checkbox"
              checked={share}
              onChange={(e) => setShare(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <span className="text-sm">Partager avec tous les articles de l'achat</span>
          </label>
        )}
        <div className="grid grid-cols-2 gap-2 mt-4">
          {ATTACHMENT_TYPES.filter((t) => t.slug !== "other").map(({ slug, label, Icon }) => (
            <button
              key={slug}
              type="button"
              onClick={() => onPick(slug, share)}
              className="flex items-center gap-3 rounded-lg border p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <Icon className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mt-4 pt-3 border-t">
          <button
            type="button"
            onClick={() => onPick("other", share)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Autre / non spécifié
          </button>
          <Button variant="ghost" size="sm" onClick={onCancel}>Annuler</Button>
        </div>
      </div>
    </div>
  )
}

export function AttachmentsPanel({ itemId, subscriptionId, itemDescription, orderId, templateContext }: AttachmentsPanelProps) {
  const [attachments, setAttachments] = useState<api.Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingFiles | null>(null)
  const [viewTarget, setViewTarget] = useState<api.Attachment | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const load = async () => {
    try {
      if (subscriptionId) {
        setAttachments(await api.getSubscriptionAttachments(subscriptionId))
      } else if (itemId) {
        setAttachments(await api.getAttachments(itemId))
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [itemId, subscriptionId])

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const paths: string[] = []
    for (const file of Array.from(files)) {
      const path = (file as unknown as { path?: string }).path
      if (path) paths.push(path)
    }
    if (paths.length > 0) setPending({ paths })
  }

  const handlePickFile = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({
        multiple: true,
        title: "Ajouter une pièce jointe",
      })
      if (!selected) return
      const paths = (Array.isArray(selected) ? selected : [selected]).filter(Boolean) as string[]
      if (paths.length > 0) setPending({ paths })
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleConfirmType = async (typeSlug: string, shareWithOrder: boolean) => {
    if (!pending) return
    const paths = pending.paths
    setPending(null)
    let hasImage = false
    const baseCtx: TemplateContext = {
      description: itemDescription,
      date: new Date().toISOString().slice(0, 10),
      ...(templateContext ?? {}),
    }
    const harmonize = async (type: AttachmentTypeKey, originalName: string): Promise<string> => {
      try {
        return await harmonizedName(type, baseCtx, originalName, shortIdHint())
      } catch {
        return originalName
      }
    }
    for (const filePath of paths) {
      const name = filePath.split("/").pop() || filePath.split("\\").pop() || "fichier"
      try {
        const type = (typeSlug as AttachmentTypeKey)
        const harmonized = await harmonize(type, name)
        if (subscriptionId) {
          await api.addSubscriptionAttachment(subscriptionId, filePath, harmonized, typeSlug)
        } else if (itemId) {
          await api.addAttachment(itemId, filePath, harmonized, typeSlug, shareWithOrder)
        }
        toast(`"${harmonized}" ajouté`, "success")
        if (/\.(jpe?g|png|gif|webp|svg)$/i.test(name)) hasImage = true
      } catch (e) {
        toast(`Erreur: ${e}`, "error")
      }
    }
    if (hasImage && !shareWithOrder && itemId) invalidateThumbnail(itemId)
    await load()
  }

  const handleExport = async (att: api.Attachment) => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const destination = await save({
        defaultPath: att.display_name,
        title: "Exporter la pièce jointe",
      })
      if (destination) {
        await api.exportAttachment(att.id, destination)
        toast(`"${att.display_name}" exporté`, "success")
      }
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const removed = attachments.find((a) => a.id === deleteTarget)
    try {
      await api.deleteAttachment(deleteTarget)
      toast("Pièce jointe supprimée", "success")
      setDeleteTarget(null)
      if (removed?.mime_type.startsWith("image/") && itemId) invalidateThumbnail(itemId)
      await load()
    } catch (e) {
      toast(`Erreur: ${e}`, "error")
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = () => setDragging(false)

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    await handleFileSelect(e.dataTransfer.files)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Pièces jointes — {itemDescription}
          </CardTitle>
          <Badge variant="secondary">{attachments.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handlePickFile}
          className={`
            flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors
            ${dragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
            }
          `}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Glisser des fichiers ici ou <span className="text-primary font-medium">parcourir</span>
          </p>
          <p className="text-xs text-muted-foreground">Max 100 MB par fichier</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />

        {/* Attachment list */}
        {attachments.length > 0 && (
          <div className="space-y-2">
            {attachments.map((att) => {
              const Icon = getFileIcon(att.mime_type)
              return (
                <div
                  key={att.id}
                  className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setViewTarget(att)}
                    className="flex flex-1 items-center gap-3 min-w-0 text-left"
                    title="Aperçu"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate hover:text-primary transition-colors">{att.display_name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span>{formatFileSize(att.size_bytes)}</span>
                        <span>&middot;</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {getTypeLabel(att.attachment_type)}
                        </Badge>
                        {att.order_id && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
                            <Layers className="h-2.5 w-2.5" />
                            Partagée
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => setViewTarget(att)} title="Aperçu">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleExport(att)} title="Exporter">
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(att.id)} title="Supprimer">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <ConfirmDialog
          open={deleteTarget !== null}
          title="Supprimer la pièce jointe"
          message="Cette action est irréversible. Le fichier chiffré sera supprimé du disque."
          confirmLabel="Supprimer"
          variant="destructive"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />

        {pending && (
          <TypePicker
            count={pending.paths.length}
            canShare={!!orderId && !subscriptionId}
            onPick={handleConfirmType}
            onCancel={() => setPending(null)}
          />
        )}

        <AttachmentViewer
          attachment={viewTarget}
          onClose={() => setViewTarget(null)}
          onExport={handleExport}
        />
      </CardContent>
    </Card>
  )
}

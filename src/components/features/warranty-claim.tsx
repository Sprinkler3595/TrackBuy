import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Copy, Download, Eye, FileText, Paperclip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { AttachmentViewer } from "@/components/features/attachment-viewer"
import { formatDate, formatPrice } from "@/lib/utils"
import * as api from "@/lib/tauri"

/// The minimal warranty shape the claim modal needs (the warranties list
/// already enriches rows with a computed `end_date` and `days_left`).
export interface ClaimWarranty {
  item_id: string
  item_description?: string
  start_date: string
  duration_months: number
  end_date: string
  days_left: number
}

/// "Faire jouer la garantie" — the SAV kit.
///
/// When an appliance breaks, an ordinary user doesn't want to dig through the
/// item page: they want the proof of purchase and a ready-to-send claim in one
/// place. This modal gathers the purchase facts, lists the attached receipts/
/// invoices (viewable + exportable), and pre-fills a claim letter that cites
/// the two-year Swiss legal warranty (CO art. 210).
export function WarrantyClaimModal({
  warranty,
  onClose,
}: {
  warranty: ClaimWarranty
  onClose: () => void
}) {
  const { toast } = useToast()
  const [item, setItem] = useState<api.Item | null>(null)
  const [attachments, setAttachments] = useState<api.Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [viewer, setViewer] = useState<api.Attachment | null>(null)
  const [claimText, setClaimText] = useState("")

  const expired = warranty.days_left < 0

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const [items, atts] = await Promise.all([
          api.getItems(),
          api.getAttachments(warranty.item_id),
        ])
        if (!alive) return
        const it = items.find((i) => i.id === warranty.item_id) ?? null
        setItem(it)
        setAttachments(atts)
        setClaimText(buildClaim(warranty, it))
      } catch (e) {
        if (alive) toast(String(e), "error")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [warranty, toast])

  async function exportAttachment(att: api.Attachment) {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog")
      const destination = await save({ defaultPath: att.display_name, title: "Exporter" })
      if (destination) await api.exportAttachment(att.id, destination)
    } catch (e) {
      toast(String(e), "error")
    }
  }

  async function copyClaim() {
    try {
      await navigator.clipboard.writeText(claimText)
      toast("Message copié dans le presse-papiers.", "success")
    } catch {
      toast("Copie impossible — sélectionnez le texte manuellement.", "error")
    }
  }

  const description = item?.description ?? warranty.item_description ?? "Article"

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
          <div className="flex items-start justify-between gap-4 border-b p-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Faire jouer la garantie</h2>
              <p className="truncate text-sm text-muted-foreground">{description}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fermer">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* Status */}
            <div
              className={
                expired
                  ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
                  : "rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400"
              }
            >
              {expired
                ? `Garantie expirée le ${formatDate(warranty.end_date)}. Vous pouvez tout de même tenter un geste commercial.`
                : `Garantie active jusqu'au ${formatDate(warranty.end_date)} (encore ${warranty.days_left} j).`}
            </div>

            {/* Purchase facts */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Fact label="Acheté le" value={formatDate(warranty.start_date)} />
              <Fact label="Marchand" value={item?.merchant_name ?? "—"} />
              <Fact
                label="Prix payé"
                value={item ? formatPrice(item.purchase_price, item.currency) : "—"}
              />
              <Fact label="Durée garantie" value={`${warranty.duration_months} mois`} />
              {item?.invoice_number && <Fact label="N° facture / ticket" value={item.invoice_number} />}
              {item?.product_reference && <Fact label="Référence produit" value={item.product_reference} />}
            </div>

            {/* Proof documents */}
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Paperclip className="h-4 w-4" />
                Preuves d'achat
              </div>
              {loading ? (
                <p className="text-sm text-muted-foreground">Chargement…</p>
              ) : attachments.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Aucun justificatif joint à cet article. Ajoutez le ticket ou la
                  facture depuis{" "}
                  <Link to={`/items/${warranty.item_id}`} className="underline" onClick={onClose}>
                    la fiche de l'article
                  </Link>
                  .
                </p>
              ) : (
                <ul className="space-y-1">
                  {attachments.map((att) => (
                    <li
                      key={att.id}
                      className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{att.display_name}</span>
                      <Button size="sm" variant="ghost" onClick={() => setViewer(att)}>
                        <Eye className="mr-1 h-3.5 w-3.5" />
                        Voir
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => exportAttachment(att)}>
                        <Download className="mr-1 h-3.5 w-3.5" />
                        Exporter
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Claim message */}
            <div>
              <div className="mb-2 text-sm font-medium">Message de réclamation</div>
              <textarea
                className="h-56 w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed"
                value={claimText}
                onChange={(e) => setClaimText(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t p-4">
            <Link
              to={`/items/${warranty.item_id}`}
              className="text-sm text-muted-foreground underline-offset-2 hover:underline"
              onClick={onClose}
            >
              Ouvrir la fiche de l'article
            </Link>
            <Button onClick={copyClaim}>
              <Copy className="mr-2 h-4 w-4" />
              Copier le message
            </Button>
          </div>
        </div>
      </div>

      <AttachmentViewer
        attachment={viewer}
        onClose={() => setViewer(null)}
        onExport={exportAttachment}
      />
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  )
}

function buildClaim(w: ClaimWarranty, item: api.Item | null): string {
  const lines: string[] = []
  lines.push(`Objet : Demande de prise en charge sous garantie — ${item?.description ?? w.item_description ?? "article"}`)
  lines.push("")
  lines.push("Madame, Monsieur,")
  lines.push("")
  lines.push("J'ai acheté chez vous l'article ci-dessous et souhaite faire valoir la garantie :")
  lines.push("")
  lines.push(`• Article : ${item?.description ?? w.item_description ?? "—"}`)
  lines.push(`• Date d'achat : ${formatDate(w.start_date)}`)
  if (item?.invoice_number) lines.push(`• N° de facture / ticket : ${item.invoice_number}`)
  if (item?.product_reference) lines.push(`• Référence produit : ${item.product_reference}`)
  if (item) lines.push(`• Prix payé : ${formatPrice(item.purchase_price, item.currency)}`)
  lines.push("")
  lines.push("Cet article présente le défaut suivant : [décrivez le problème].")
  lines.push("")
  lines.push(
    "Conformément à la garantie applicable — et à la garantie légale des défauts de deux ans prévue par le Code des obligations (art. 210 CO) —, je vous demande de bien vouloir procéder à la réparation, au remplacement ou au remboursement de cet article.",
  )
  lines.push("")
  lines.push("Vous trouverez en annexe la preuve d'achat. Je reste à votre disposition pour tout complément d'information.")
  lines.push("")
  lines.push("Avec mes salutations distinguées,")
  lines.push("[Votre prénom et nom]")
  return lines.join("\n")
}

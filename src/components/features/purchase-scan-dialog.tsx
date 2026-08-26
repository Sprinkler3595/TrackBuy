import { useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileSignature, FileText, Loader2, Receipt, ShoppingCart, Sparkles, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { useModalKeyboard } from "@/hooks/use-modal-keyboard"
import { getAiSettings } from "@/lib/ai-settings"
import { documentToText } from "@/lib/document-scan"
import { receiptToPendingPurchase } from "@/lib/receipt-to-drafts"
import { PENDING_RECEIPT_KEY } from "@/components/features/scan-review/types"
import * as api from "@/lib/tauri"

/// Entry point for creating a purchase: a document comes first.
///
/// The user picks an offer, an order, an invoice or a till receipt; the text
/// is read (PDF text layer, OCR fallback) and handed to the AI, which fills
/// the assistant's fields and says what kind of document it is. Nothing is
/// written here — the assistant opens with everything pre-filled and editable.
///
/// Without AI (or when the model finds nothing usable) the assistant still
/// opens, with the document attached and an empty line to fill by hand: the
/// rule is "a purchase always comes from a document", not "a purchase always
/// comes from a successful extraction".

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const mimeForName = (name: string): string =>
  name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg"

type Phase = "idle" | "reading" | "analyzing"

interface PurchaseScanDialogProps {
  onClose: () => void
}

export function PurchaseScanDialog({ onClose }: PurchaseScanDialogProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [phase, setPhase] = useState<Phase>("idle")
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = phase !== "idle"

  // Escape closes, but not while a scan is running.
  useModalKeyboard(!busy, onClose)

  /// Read + extract, then hand off to the assistant. `path` is the absolute
  /// path of the picked file when we have one (Tauri): the attachment can only
  /// be saved from a real path, so in browser mode the document is analysed
  /// but not attached.
  async function process(bytes: Uint8Array, name: string, path: string | null) {
    setPhase("reading")
    try {
      const text = await documentToText(bytes, mimeForName(name), name)
      const attach = path ? { path, name } : null

      const ai = getAiSettings()
      if (!ai.enabled) {
        toast(
          "IA désactivée : le document est joint, complétez les lignes à la main (Réglages → IA pour le remplissage automatique).",
          "error",
        )
        return handOff(emptyPayload(attach))
      }
      if (!text.trim()) {
        toast(
          "Document illisible (aucun texte trouvé). Pour une photo, installez l'OCR (npm run fetch-tessdata).",
          "error",
        )
        return handOff(emptyPayload(attach))
      }

      setPhase("analyzing")
      const extracted = await api.aiExtractReceipt(text, ai)
      handOff(receiptToPendingPurchase(extracted, attach))
    } catch (e) {
      toast(`Échec de l'analyse : ${e}`, "error")
      setPhase("idle")
    }
  }

  function handOff(payload: ReturnType<typeof receiptToPendingPurchase>) {
    sessionStorage.setItem(PENDING_RECEIPT_KEY, JSON.stringify(payload))
    onClose()
    navigate("/items/nouveau")
  }

  /// Native dialog under Tauri (gives us a path we can attach), plain file
  /// input in the browser. Mirrors the inbox's picker.
  async function pickDocument() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({
        multiple: false,
        title: "Choisir une offre, un bon de commande, une facture ou un ticket",
        filters: [{ name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "webp", "bmp", "tiff"] }],
      })
      if (typeof selected !== "string") return
      const name = selected.split("/").pop() || selected.split("\\").pop() || "document"
      const b64 = await api.readBinaryFileBase64(selected)
      void process(base64ToBytes(b64), name, selected)
    } catch {
      // Not running under Tauri (or dialog unavailable) → file input.
      inputRef.current?.click()
    }
  }

  async function handleFile(file: File) {
    void process(new Uint8Array(await file.arrayBuffer()), file.name, null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Sparkles className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-semibold">Nouvel achat</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Un achat part toujours d'un document : l'IA le lit et remplit
                l'assistant pour vous.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <DocHint icon={FileSignature} label="Offre" />
            <DocHint icon={ShoppingCart} label="Bon de commande" />
            <DocHint icon={FileText} label="Facture" />
            <DocHint icon={Receipt} label="Ticket de caisse" />
          </div>

          <div
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files?.[0]
              if (file && !busy) void handleFile(file)
            }}
            onDragOver={(e) => e.preventDefault()}
            className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-6 text-center"
          >
            <Button onClick={pickDocument} className="w-full" disabled={busy}>
              {phase === "reading" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Lecture du document…</>
              ) : phase === "analyzing" ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyse par l'IA…</>
              ) : (
                <><Upload className="mr-2 h-4 w-4" />Choisir un document (PDF ou photo)</>
              )}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">ou glissez le fichier ici</p>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) void handleFile(f)
            }}
          />

          <p className="text-xs text-muted-foreground">
            Le document reste dans votre coffre : il est joint à l'achat créé, et
            classé automatiquement selon sa nature.
          </p>
        </div>
      </div>
    </div>
  )
}

/// Payload used when nothing could be extracted: the document is still
/// attached and the user fills one line by hand.
function emptyPayload(attach: { path: string; name: string } | null) {
  return receiptToPendingPurchase(
    {
      document_kind: null,
      description: null,
      purchase_date: null,
      due_date: null,
      purchase_price: null,
      currency: null,
      merchant: null,
      invoice_number: null,
      product_reference: null,
      quantity: null,
      price_excl_tax: null,
      tax_rate: null,
      warranty_months: null,
      warranty_start_date: null,
      notes: null,
      items: [],
    },
    attach,
  )
}

function DocHint({ icon: Icon, label }: { icon: typeof FileText; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-dashed p-2 text-center text-[11px] text-muted-foreground">
      <Icon className="h-4 w-4" />
      {label}
    </div>
  )
}

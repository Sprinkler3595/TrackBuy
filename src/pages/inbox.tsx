import { useRef, useState } from "react"
import { Loader2, QrCode, ScanLine } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import * as api from "@/lib/tauri"
import { scanQrFromBytes, extractTextFromBytes, ocrSourceToText, findDueDateInText, renderFirstPageJpeg } from "@/lib/qr-scan"
import { QrBillReview } from "@/components/features/qrbill-review"

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/// Inbox: the single place where an incoming Swiss QR-bill is turned into a
/// charge on an engagement. Nothing is stored by this view — the QR payload is
/// decoded, enriched with the due date read off the document, and handed to
/// <QrBillReview /> which does the actual write.
export function InboxPage() {
  const { toast } = useToast()
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrPayload, setQrPayload] = useState("")
  const [scanning, setScanning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // A scanner returns the "SPC…" payload (or null). Decode it and hand off to
  // the review modal exactly like the manual-paste path; on no-match, fall
  // back to that paste modal rather than leaving the user stuck.
  async function runScan(source: { bytes: Uint8Array; isPdf: boolean } | { file: File }) {
    setScanning(true)
    try {
      const bytes = "file" in source
        ? new Uint8Array(await source.file.arrayBuffer())
        : source.bytes
      const isPdf = "file" in source
        ? source.file.type === "application/pdf" || source.file.name.toLowerCase().endsWith(".pdf")
        : source.isPdf

      const payload = await scanQrFromBytes(bytes, isPdf)
      if (!payload) {
        toast(
          "Aucune QR-facture suisse détectée sur ce document. Vous pouvez coller le texte manuellement.",
          "error",
        )
        setQrModalOpen(true)
        return
      }
      const decoded = await api.decodeQrbill(payload)
      // Get the invoice text so the review modal can find the due date (the QR
      // payload carries none). Prefer the PDF text layer; fall back to OCR for
      // photos / image-only PDFs. A quick regex guess pre-fills the field; the
      // full text is kept so the AI can read tabular layouts. Best-effort.
      let text = ""
      try {
        text = await extractTextFromBytes(bytes, isPdf)
        if (!text.trim()) text = await ocrSourceToText(bytes, isPdf)
      } catch {
        // best effort
      }
      const dueHint = text ? findDueDateInText(text) : null
      // Also keep a compact page image so the modal can ask a vision model for
      // the due date when there's no usable text (photo / scanned PDF / table).
      let image: string | null = null
      try {
        image = await renderFirstPageJpeg(bytes, isPdf)
      } catch {
        // best effort
      }
      sessionStorage.setItem("qrbill-pending", JSON.stringify(decoded))
      if (text) sessionStorage.setItem("qrbill-text", text)
      else sessionStorage.removeItem("qrbill-text")
      if (image) sessionStorage.setItem("qrbill-image", image)
      else sessionStorage.removeItem("qrbill-image")
      if (dueHint) sessionStorage.setItem("qrbill-due-hint", dueHint)
      else sessionStorage.removeItem("qrbill-due-hint")
      window.dispatchEvent(new Event("qrbill-decoded"))
    } catch (e) {
      toast(String(e), "error")
    } finally {
      setScanning(false)
    }
  }

  // Primary entry point: native file dialog under Tauri, HTML <input> in the
  // browser. Mirrors scan.tsx so behaviour is consistent across the app.
  async function pickAndScan() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({
        multiple: false,
        title: "Choisir une photo ou un PDF de facture",
        filters: [
          { name: "Factures (image ou PDF)", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "pdf"] },
        ],
      })
      if (!selected) return
      const path = selected as string
      const b64 = await api.readBinaryFileBase64(path)
      void runScan({ bytes: base64ToBytes(b64), isPdf: path.toLowerCase().endsWith(".pdf") })
    } catch {
      // Not running under Tauri (or dialog unavailable) → use the file input.
      fileInputRef.current?.click()
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-picking the same file
    if (file) void runScan({ file })
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) void runScan({ file })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Déposez ici la facture que vous venez de recevoir : le QR-code suisse
          est lu automatiquement et rattaché au bon engagement.
        </p>
      </div>

      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-primary" />
            QR-facture suisse
          </CardTitle>
          <CardDescription>
            Prenez en photo ou déposez le PDF d'une facture reçue par la poste
            ou par e-mail — le QR-code est lu automatiquement.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            className="rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 text-center"
          >
            <Button onClick={pickAndScan} className="w-full" disabled={scanning}>
              {scanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Lecture du QR-code…
                </>
              ) : (
                <>
                  <ScanLine className="mr-2 h-4 w-4" />
                  Photo ou PDF d'une facture
                </>
              )}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              ou glissez le fichier ici
            </p>
          </div>
          <button
            type="button"
            onClick={() => setQrModalOpen(true)}
            className="mt-2 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Coller le texte du QR-code manuellement
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={onFileInputChange}
          />
        </CardContent>
      </Card>

      {qrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg border bg-card p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Décoder une QR-facture</h2>
              <Button variant="ghost" size="sm" onClick={() => setQrModalOpen(false)}>
                ✕
              </Button>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Collez ci-dessous le texte complet du QR-code (commence par{" "}
                <code className="rounded bg-muted px-1 font-mono">SPC</code>,
                ~30 lignes séparées par retour à la ligne).
              </p>
              <textarea
                className="h-48 w-full rounded-md border bg-background p-3 font-mono text-xs"
                placeholder={"SPC\n0200\n1\nCH..."}
                value={qrPayload}
                onChange={(e) => setQrPayload(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setQrModalOpen(false)}>
                  Annuler
                </Button>
                <Button
                  onClick={async () => {
                    try {
                      const decoded = await api.decodeQrbill(qrPayload)
                      setQrModalOpen(false)
                      setQrPayload("")
                      // Pass the decoded result to the review component via a
                      // session-storage hop — the review modal opens itself
                      // on the next render.
                      sessionStorage.setItem(
                        "qrbill-pending",
                        JSON.stringify(decoded),
                      )
                      window.dispatchEvent(new Event("qrbill-decoded"))
                    } catch (e) {
                      toast(String(e), "error")
                    }
                  }}
                  disabled={!qrPayload.trim()}
                >
                  Décoder
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <QrBillReview />
    </div>
  )
}

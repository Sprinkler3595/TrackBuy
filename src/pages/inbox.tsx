import { useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowRight,
  Banknote,
  FileSpreadsheet,
  FileText,
  Loader2,
  QrCode,
  ScanLine,
  Upload,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import * as api from "@/lib/tauri"
import { scanQrFromBytes, scanQrFromFile } from "@/lib/qr-scan"
import { QrBillReview } from "@/components/features/qrbill-review"
import { Camt053Import } from "@/components/features/camt053-import"

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/// Unified inbox: anywhere an "to-process" item arrives. Each source has its
/// own panel with a clear next action. Counts on the right come from the
/// existing Tauri endpoints — we don't store anything in this view, the
/// underlying pages (bank-statements, pending-invoices) remain the source
/// of truth for the data itself.
export function InboxPage() {
  const { toast } = useToast()
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrPayload, setQrPayload] = useState("")
  const [camtOpen, setCamtOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // A scanner returns the "SPC…" payload (or null). Decode it and hand off to
  // the review modal exactly like the manual-paste path; on no-match, fall
  // back to that paste modal rather than leaving the user stuck.
  async function runScan(scan: () => Promise<string | null>) {
    setScanning(true)
    try {
      const payload = await scan()
      if (!payload) {
        toast(
          "Aucune QR-facture suisse détectée sur ce document. Vous pouvez coller le texte manuellement.",
          "error",
        )
        setQrModalOpen(true)
        return
      }
      const decoded = await api.decodeQrbill(payload)
      sessionStorage.setItem("qrbill-pending", JSON.stringify(decoded))
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
      void runScan(() => scanQrFromBytes(base64ToBytes(b64), path.toLowerCase().endsWith(".pdf")))
    } catch {
      // Not running under Tauri (or dialog unavailable) → use the file input.
      fileInputRef.current?.click()
    }
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-picking the same file
    if (file) void runScan(() => scanQrFromFile(file))
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) void runScan(() => scanQrFromFile(file))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Toutes les factures et transactions à traiter arrivent ici. Choisissez
          la source qui correspond à ce que vous avez reçu.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* QR-bill — the primary Swiss workflow */}
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-primary" />
                QR-facture suisse
              </CardTitle>
              <Badge variant="default" className="text-[10px]">
                Recommandé
              </Badge>
            </div>
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

        {/* CamT.053 import — best path for monthly statements */}
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                Relevé e-banking (CamT.053)
              </CardTitle>
              <Badge variant="default" className="text-[10px]">
                Recommandé
              </Badge>
            </div>
            <CardDescription>
              Fichier XML ISO 20022 exporté depuis UBS, PostFinance, Raiffeisen,
              ZKB, BCV… Aucune IA, 100% fiable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setCamtOpen(true)} className="w-full">
              <Upload className="mr-2 h-4 w-4" />
              Importer un fichier .xml
            </Button>
          </CardContent>
        </Card>

        {/* Existing PDF bank statements (kept as fallback) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-muted-foreground" />
              Relevé PDF (extraction IA)
            </CardTitle>
            <CardDescription>
              Si votre banque ne propose pas le CamT.053 — fallback OCR + IA.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/bank-statements"
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              Ouvrir <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* Receipt scan (existing flow) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-muted-foreground" />
              Ticket de caisse
            </CardTitle>
            <CardDescription>
              Photo de reçu papier — OCR local Tesseract + extraction IA optionnelle.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/scan"
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              Scanner <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* Pending invoices in flight */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Factures en attente
            </CardTitle>
            <CardDescription>
              Lignes bancaires sans justificatif PDF rattaché — promesses à
              compléter quand le document arrivera.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              to="/bank-statements"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Voir les factures en attente <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

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
      {camtOpen && <Camt053Import onClose={() => setCamtOpen(false)} />}
    </div>
  )
}

import { useEffect, useState } from "react"
import { X, Download, FileWarning } from "lucide-react"
import * as pdfjsLib from "pdfjs-dist"
import { Button } from "@/components/ui/button"
import * as api from "@/lib/tauri"

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString()

interface AttachmentViewerProps {
  attachment: api.Attachment | null
  onClose: () => void
  onExport: (att: api.Attachment) => void
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? ""
  const bin = atob(base64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf
}

export function AttachmentViewer({ attachment, onClose, onExport }: AttachmentViewerProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [pdfPages, setPdfPages] = useState<string[]>([])
  const [textContent, setTextContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Reset and re-load when the target attachment changes.
  useEffect(() => {
    if (!attachment) return
    let cancelled = false
    setLoading(true)
    setDataUrl(null)
    setPdfPages([])
    setTextContent(null)
    setError(null)

    ;(async () => {
      try {
        const url = await api.getAttachmentData(attachment.id)
        if (cancelled) return
        setDataUrl(url)

        if (attachment.mime_type === "application/pdf") {
          const bytes = dataUrlToBytes(url)
          const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
          const pages: string[] = []
          const max = Math.min(pdf.numPages, 20)
          for (let i = 1; i <= max; i++) {
            const page = await pdf.getPage(i)
            const viewport = page.getViewport({ scale: 1.5 })
            const canvas = document.createElement("canvas")
            canvas.width = viewport.width
            canvas.height = viewport.height
            const ctx = canvas.getContext("2d")!
            await page.render({ canvasContext: ctx, canvas, viewport }).promise
            if (cancelled) return
            pages.push(canvas.toDataURL("image/png"))
          }
          if (!cancelled) setPdfPages(pages)
        } else if (attachment.mime_type.startsWith("text/")) {
          const bytes = dataUrlToBytes(url)
          if (!cancelled) setTextContent(new TextDecoder().decode(bytes))
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [attachment])

  // Close on Escape
  useEffect(() => {
    if (!attachment) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [attachment, onClose])

  if (!attachment) return null

  const isImage = attachment.mime_type.startsWith("image/")
  const isPdf = attachment.mime_type === "application/pdf"
  const isText = attachment.mime_type.startsWith("text/")

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 text-white">
        <p className="text-sm font-medium truncate">{attachment.display_name}</p>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="secondary" onClick={() => onExport(attachment)}>
            <Download className="h-4 w-4" />
            Exporter
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
            Fermer
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4" onClick={onClose}>
        <div className="mx-auto max-w-5xl" onClick={(e) => e.stopPropagation()}>
          {loading ? (
            <div className="flex items-center justify-center py-32 text-white/70">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-white/30 border-t-white" />
            </div>
          ) : error ? (
            <div className="rounded-lg bg-white/5 p-6 text-center text-white/80 space-y-2">
              <FileWarning className="h-8 w-8 mx-auto opacity-70" />
              <p>Impossible d'ouvrir : {error}</p>
            </div>
          ) : isImage && dataUrl ? (
            <img
              src={dataUrl}
              alt={attachment.display_name}
              className="mx-auto max-h-[85vh] w-auto rounded shadow-lg bg-white"
            />
          ) : isPdf && pdfPages.length > 0 ? (
            <div className="space-y-4">
              {pdfPages.map((page, i) => (
                <img
                  key={i}
                  src={page}
                  alt={`Page ${i + 1}`}
                  className="mx-auto w-full max-w-3xl rounded shadow-lg bg-white"
                />
              ))}
              {pdfPages.length === 20 && (
                <p className="text-center text-xs text-white/60">
                  Aperçu limité aux 20 premières pages. Exporte pour voir le reste.
                </p>
              )}
            </div>
          ) : isText && textContent !== null ? (
            <pre className="rounded-lg bg-white p-6 text-sm whitespace-pre-wrap font-mono max-h-[85vh] overflow-auto">
              {textContent}
            </pre>
          ) : (
            <div className="rounded-lg bg-white/5 p-6 text-center text-white/80 space-y-3">
              <FileWarning className="h-8 w-8 mx-auto opacity-70" />
              <p>Aperçu non disponible pour ce type de fichier ({attachment.mime_type}).</p>
              <Button onClick={() => onExport(attachment)}>
                <Download className="h-4 w-4" />
                Exporter
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

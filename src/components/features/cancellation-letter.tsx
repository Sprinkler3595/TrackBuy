import { useState } from "react"
import { Copy, Printer, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { buildCancellationLetter } from "@/lib/cancellation"
import type { Engagement, Creditor } from "@/lib/tauri"

/// Modal showing a pre-filled, editable cancellation letter for an engagement.
/// Grand-public actions only: copy to clipboard, or open the OS print dialog
/// (which on every platform offers "Save as PDF").
export function CancellationLetterModal({
  engagement,
  creditor,
  onClose,
}: {
  engagement: Engagement
  creditor: Creditor | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const [text, setText] = useState(() => buildCancellationLetter(engagement, creditor))

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast("Lettre copiée dans le presse-papiers.", "success")
    } catch {
      toast("Copie impossible — sélectionnez le texte manuellement.", "error")
    }
  }

  // Print the letter alone (not the whole app) by writing it into a hidden
  // iframe and printing that. Monospace + preserved whitespace keeps the
  // layout the user sees in the textarea.
  function print() {
    const frame = document.createElement("iframe")
    frame.style.position = "fixed"
    frame.style.right = "0"
    frame.style.bottom = "0"
    frame.style.width = "0"
    frame.style.height = "0"
    frame.style.border = "0"
    document.body.appendChild(frame)
    const doc = frame.contentWindow?.document
    if (!doc) {
      document.body.removeChild(frame)
      toast("Impression indisponible.", "error")
      return
    }
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
    doc.open()
    doc.write(
      `<html><head><meta charset="utf-8"><title>Résiliation</title>` +
        `<style>body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;` +
        `line-height:1.5;white-space:pre-wrap;margin:2.5cm;}</style></head>` +
        `<body>${escaped}</body></html>`,
    )
    doc.close()
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    // Give the print dialog time to grab the frame before we remove it.
    setTimeout(() => document.body.removeChild(frame), 1000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div>
            <h2 className="text-lg font-semibold">Lettre de résiliation</h2>
            <p className="text-sm text-muted-foreground">
              Complétez vos coordonnées entre crochets, puis copiez ou
              imprimez. Envoi recommandé conseillé.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <textarea
            className="h-[50vh] w-full rounded-md border bg-background p-3 font-mono text-xs leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={copy}>
            <Copy className="mr-2 h-4 w-4" />
            Copier
          </Button>
          <Button onClick={print}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimer / PDF
          </Button>
        </div>
      </div>
    </div>
  )
}

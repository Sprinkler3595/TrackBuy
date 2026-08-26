import { useRef, useState } from "react"
import { Sparkles, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { getAiSettings } from "@/lib/ai-settings"
import { documentToText } from "@/lib/document-scan"

interface AiScanPanelProps {
  fr: boolean
  title: string
  subtitle: string
  disabled?: boolean
  /// Called with the document's extracted text (PDF text layer or OCR). The
  /// parent runs the specific AI extraction + pre-fills its form, and returns a
  /// short summary of the filled fields ("" ⇒ nothing usable found).
  onExtract: (text: string) => Promise<string>
}

/// Reusable "scan a document + AI auto-fill" panel. Handles the AI-enabled
/// check, file picking (a plain <input type=file>, so it works both in the
/// Tauri webview and in browser/dev mode), text extraction and the busy/summary
/// UI. The parent only wires the extraction + pre-fill via `onExtract`.
export function AiScanPanel({ fr, title, subtitle, disabled, onExtract }: AiScanPanelProps) {
  const { toast } = useToast()
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    const ai = getAiSettings()
    if (!ai.enabled) {
      toast(fr
        ? "Activez l'IA dans Réglages → IA pour le remplissage automatique."
        : "Enable AI in Settings → AI to use auto-fill.", "error")
      return
    }
    setScanning(true)
    setScanned(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const text = await documentToText(bytes, file.type, file.name)
      if (!text.trim()) {
        toast(fr
          ? "Impossible de lire le document (texte introuvable). Pour une image, installez l'OCR (npm run fetch-tessdata)."
          : "Couldn't read the document (no text found). For an image, install OCR (npm run fetch-tessdata).", "error")
        return
      }
      const summary = await onExtract(text)
      if (summary) {
        setScanned(summary)
        toast(fr ? "Champs pré-remplis — vérifiez puis complétez." : "Fields pre-filled — review and complete.", "success")
      } else {
        toast(fr ? "Aucun champ exploitable trouvé." : "No usable field found.", "error")
      }
    } catch (e) {
      toast(`${fr ? "Échec du scan" : "Scan failed"}: ${e}`, "error")
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
          e.target.value = ""
        }}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0"><Sparkles className="h-5 w-5" /></div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={scanning || disabled} className="shrink-0">
          {scanning
            ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />{fr ? "Analyse…" : "Analyzing…"}</>
            : <><Sparkles className="mr-1 h-4 w-4" />{fr ? "Scanner" : "Scan"}</>}
        </Button>
      </div>
      {scanned && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
          <Check className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{fr ? "Pré-rempli : " : "Pre-filled: "}{scanned}</span>
        </div>
      )}
    </div>
  )
}

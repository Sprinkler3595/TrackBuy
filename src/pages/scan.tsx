import { useState, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import Tesseract from "tesseract.js"
import * as pdfjsLib from "pdfjs-dist"
import {
  ScanLine,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  ShoppingBag,
  X,
  Paperclip,
  FileText,
  Package,
  KeyRound,
  Wrench,
  Truck,
  TicketPercent,
  HelpCircle,
} from "lucide-react"
import type { LineCategory, ItemKind } from "@/lib/tauri"
import {
  PENDING_RECEIPT_KEY,
  type ItemDraft,
  type PendingReceipt,
} from "@/components/features/scan-review/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/toast"
import { useI18n } from "@/lib/i18n"
import { getAiSettings } from "@/lib/ai-settings"
import * as api from "@/lib/tauri"

// Configure PDF.js worker (local bundle, no CDN)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString()

// Tesseract.js: pin every artifact to local files served from /tessdata/.
// Run `npm run fetch-tessdata` once to populate `public/tessdata/` so the OCR
// pipeline never reaches the public CDN.
const TESSERACT_OPTIONS = {
  workerPath: "/tessdata/worker.min.js",
  corePath: "/tessdata/tesseract-core-simd.wasm.js",
  langPath: "/tessdata",
  gzip: false,
} as const

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Lightweight image preprocessing for OCR: convert to grayscale and stretch
 * contrast based on observed min/max luminance. Helps Tesseract distinguish
 * description columns from price columns on poorly-contrasted photos.
 */
async function preprocessImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0)
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const px = imgData.data
        let min = 255
        let max = 0
        for (let i = 0; i < px.length; i += 4) {
          const gray = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
          px[i] = px[i + 1] = px[i + 2] = gray
          if (gray < min) min = gray
          if (gray > max) max = gray
        }
        const range = Math.max(1, max - min)
        for (let i = 0; i < px.length; i += 4) {
          const v = ((px[i] - min) / range) * 255
          const stretched = v < 0 ? 0 : v > 255 ? 255 : v | 0
          px[i] = px[i + 1] = px[i + 2] = stretched
        }
        ctx.putImageData(imgData, 0, 0)
        resolve(canvas.toDataURL("image/png"))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error("Failed to load image for preprocessing"))
    img.src = dataUrl
  })
}

interface ParsedItem {
  description: string
  price: number
  category: LineCategory
}

interface ParsedReceipt {
  merchant: string
  date: string
  total: number | null
  items: ParsedItem[]
  rawText: string
  invoiceNumber: string | null
  productReference: string | null
  quantity: number | null
  priceExclTax: number | null
  taxRate: number | null
  currency: string | null
  warrantyMonths: number | null
  warrantyStartDate: string | null
  description: string | null
  notes: string | null
}

const CATEGORY_META: Record<LineCategory, { label: string; icon: typeof Package; badgeClass: string; order: number }> = {
  purchase: { label: "Achat",    icon: Package,        badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30",       order: 0 },
  license:  { label: "Licence",  icon: KeyRound,       badgeClass: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30", order: 1 },
  service:  { label: "Service",  icon: Wrench,         badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",     order: 2 },
  shipping: { label: "Livraison",icon: Truck,          badgeClass: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",         order: 3 },
  voucher:  { label: "Bon/Remise", icon: TicketPercent,badgeClass: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",         order: 4 },
  other:    { label: "Autre",    icon: HelpCircle,     badgeClass: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",     order: 5 },
}

/**
 * Heuristique de repli (parser regex sans IA) : essaie de deviner la catégorie
 * d'une ligne à partir de mots-clés courants. Reste prudent : par défaut on
 * classe en "purchase".
 */
function guessCategoryFromText(description: string, price: number): LineCategory {
  const d = description.toLowerCase()
  if (price < 0 || /\b(remise|rabais|discount|coupon|bon|avoir|escompte|gift card|carte cadeau)\b/.test(d)) return "voucher"
  if (/\b(licence|license|abonnement|subscription|cl[ée] d'activation|activation key|microsoft 365|office 365|adobe|saas|user\/mois|par mois|par an|annuel)\b/.test(d)) return "license"
  if (/\b(livraison|port|exp[ée]dition|shipping|transport|frais de port)\b/.test(d)) return "shipping"
  if (/\b(installation|configuration|main d['']?œuvre|intervention|support|extension de garantie|garantie\+|applecare)\b/.test(d)) return "service"
  return "purchase"
}

function aiToParsed(ai: api.ExtractedReceipt, rawText: string): ParsedReceipt {
  // Normalise les items reçus de l'IA : la catégorie peut être absente si le
  // modèle ne suit pas parfaitement le schéma → on retombe sur l'heuristique.
  const items: ParsedItem[] = (ai.items || []).map((it) => ({
    description: it.description,
    price: it.price,
    category: (it.category as LineCategory | undefined) ?? guessCategoryFromText(it.description, it.price),
  }))
  return {
    merchant: ai.merchant || "",
    date: ai.purchase_date || "",
    total: ai.purchase_price,
    items,
    rawText,
    invoiceNumber: ai.invoice_number,
    productReference: ai.product_reference,
    quantity: ai.quantity,
    priceExclTax: ai.price_excl_tax,
    taxRate: ai.tax_rate,
    currency: ai.currency,
    warrantyMonths: ai.warranty_months,
    warrantyStartDate: ai.warranty_start_date,
    description: ai.description,
    notes: ai.notes,
  }
}

function parseReceiptText(text: string): ParsedReceipt {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)

  // Try to extract merchant name (usually first non-empty line or first few lines)
  let merchant = ""
  for (const line of lines.slice(0, 3)) {
    const cleaned = line.replace(/[^a-zA-ZÀ-ÿ0-9\s&'.,-]/g, "").trim()
    if (cleaned.length > 2 && !/^\d+$/.test(cleaned)) {
      merchant = cleaned
      break
    }
  }

  // Try to extract date (various formats)
  let date = ""
  const datePatterns = [
    /(\d{4}[-/]\d{2}[-/]\d{2})/,
    /(\d{2}[-/]\d{2}[-/]\d{4})/,
    /(\d{2}[-/]\d{2}[-/]\d{2})\b/,
    /(\d{1,2}\s+(?:jan|fév|feb|mar|avr|apr|mai|may|jun|jui|jul|aoû|aug|sep|oct|nov|déc|dec)\w*\s+\d{4})/i,
  ]
  for (const line of lines) {
    for (const pattern of datePatterns) {
      const match = line.match(pattern)
      if (match) {
        date = normalizeDate(match[1])
        break
      }
    }
    if (date) break
  }

  // Try to extract total (look for keywords like TOTAL, MONTANT, etc.)
  let total: number | null = null
  const totalPatterns = [
    /(?:total|montant|amount|net|solde|payer|due)\s*:?\s*\$?\s*([\d]+[.,]\d{2})/i,
    /\$\s*([\d]+[.,]\d{2})\s*$/,
  ]
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const pattern of totalPatterns) {
      const match = lines[i].match(pattern)
      if (match) {
        total = parseFloat(match[1].replace(",", "."))
        break
      }
    }
    if (total !== null) break
  }

  // Try to extract line items (lines with a price at the end)
  const items: ParsedItem[] = []
  const itemPattern = /^(.+?)\s+\$?\s*([\d]+[.,]\d{2})\s*[A-Z]?$/
  for (const line of lines) {
    const match = line.match(itemPattern)
    if (match) {
      const desc = match[1].replace(/[^a-zA-ZÀ-ÿ0-9\s&'.,-]/g, "").trim()
      const price = parseFloat(match[2].replace(",", "."))
      if (desc.length > 1 && price > 0 && price < 10000) {
        const lower = desc.toLowerCase()
        if (!/^(total|sous-total|subtotal|tax|tps|tvq|tvh|gst|hst|pst|qst)/.test(lower)) {
          items.push({ description: desc, price, category: guessCategoryFromText(desc, price) })
        }
      }
    }
  }

  // Extract invoice number
  let invoiceNumber: string | null = null
  const invoicePatterns = [
    /(?:facture|invoice|receipt|ticket|bon|beleg)\s*(?:n[°o.]?\s*)?:?\s*(\d{6,})/i,
    /(?:n[°o.]?\s*(?:de\s+)?(?:facture|commande|order))\s*:?\s*(\d{6,})/i,
  ]
  for (const line of lines) {
    for (const pattern of invoicePatterns) {
      const match = line.match(pattern)
      if (match) { invoiceNumber = match[1]; break }
    }
    if (invoiceNumber) break
  }

  // Extract product reference / SKU
  let productReference: string | null = null
  const skuPatterns = [
    /(?:n[°o.]?\s*(?:d['']?)?article|article\s*n|sku|réf|ref|référence|produkt)\s*[:#]?\s*(\d{5,})/i,
  ]
  for (const line of lines) {
    for (const pattern of skuPatterns) {
      const match = line.match(pattern)
      if (match) { productReference = match[1]; break }
    }
    if (productReference) break
  }

  // Extract currency
  let currency: string | null = null
  const currencyPatterns = [
    /(?:monnaie|devise|currency|währung)\s*[:#]?\s*(CHF|EUR|USD|CAD|GBP)/i,
    /\b(CHF|EUR|USD|CAD|GBP)\b/,
  ]
  for (const line of lines) {
    for (const pattern of currencyPatterns) {
      const match = line.match(pattern)
      if (match) { currency = match[1].toUpperCase(); break }
    }
    if (currency) break
  }

  // Extract tax rate (TVA / MwSt / VAT)
  let taxRate: number | null = null
  const taxRatePatterns = [
    /(?:TVA|tva|MwSt|MWST|VAT|taxe)\s*[:#]?\s*([\d]+[.,]\d+)\s*%/i,
    /([\d]+[.,]\d+)\s*%\s*(?:TVA|tva|MwSt|MWST|VAT)/i,
  ]
  for (const line of lines) {
    for (const pattern of taxRatePatterns) {
      const match = line.match(pattern)
      if (match) {
        taxRate = parseFloat(match[1].replace(",", "."))
        break
      }
    }
    if (taxRate !== null) break
  }

  // Extract price excluding tax
  let priceExclTax: number | null = null
  const priceExclPatterns = [
    /(?:prix\s*excl|excl|ht|hors\s*taxe|netto)\s*[.:]?\s*(?:CHF|EUR|USD|\$)?\s*([\d]+[.,]\d{2})/i,
  ]
  for (const line of lines) {
    for (const pattern of priceExclPatterns) {
      const match = line.match(pattern)
      if (match) {
        priceExclTax = parseFloat(match[1].replace(",", "."))
        break
      }
    }
    if (priceExclTax !== null) break
  }
  // Fallback: look for "Montant total" line with two amounts (HT is first)
  if (priceExclTax === null && total !== null) {
    for (const line of lines) {
      const mtMatch = line.match(/montant\s*total\s*([\d]+[.,]\d{2})\s+([\d]+[.,]\d{2})/i)
      if (mtMatch) {
        const first = parseFloat(mtMatch[1].replace(",", "."))
        const second = parseFloat(mtMatch[2].replace(",", "."))
        if (first < second) { priceExclTax = first; break }
      }
    }
  }

  // Extract quantity
  let quantity: number | null = null
  const qtyPatterns = [
    /(?:quantit[ée]|qty|qte|menge|anzahl)\s*[:#]?\s*(\d+)/i,
  ]
  for (const line of lines) {
    for (const pattern of qtyPatterns) {
      const match = line.match(pattern)
      if (match) { quantity = parseInt(match[1]); break }
    }
    if (quantity !== null) break
  }

  // Extract warranty
  let warrantyMonths: number | null = null
  let warrantyStartDate: string | null = null
  const warrantyPatterns = [
    /(\d+)\s*(?:mois|months?|Monate)\s*(?:de\s+)?(?:garantie|warranty|Garantie)/i,
    /(?:garantie|warranty|Garantie)\s*[:#(]?\s*(\d+)\s*(?:mois|months?|Monate)/i,
  ]
  for (const line of lines) {
    for (const pattern of warrantyPatterns) {
      const match = line.match(pattern)
      if (match) {
        warrantyMonths = parseInt(match[1])
        // Try to extract warranty start date from the same line
        const dateInLine = line.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)
        if (dateInLine) warrantyStartDate = normalizeDate(dateInLine[1])
        break
      }
    }
    if (warrantyMonths !== null) break
  }

  return {
    merchant, date, total, items, rawText: text,
    invoiceNumber, productReference, quantity,
    priceExclTax, taxRate, currency,
    warrantyMonths, warrantyStartDate,
    description: null, notes: null,
  }
}

function normalizeDate(raw: string): string {
  const cleaned = raw.replace(/\//g, "-")
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned

  const dmy = cleaned.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`

  const dmy2 = cleaned.match(/^(\d{2})-(\d{2})-(\d{2})$/)
  if (dmy2) {
    const year = parseInt(dmy2[3]) > 50 ? `19${dmy2[3]}` : `20${dmy2[3]}`
    return `${year}-${dmy2[2]}-${dmy2[1]}`
  }

  const months: Record<string, string> = {
    jan: "01", fév: "02", feb: "02", mar: "03", avr: "04", apr: "04",
    mai: "05", may: "05", jun: "06", jui: "07", jul: "07", aoû: "08",
    aug: "08", sep: "09", oct: "10", nov: "11", déc: "12", dec: "12",
  }
  const monthMatch = raw.match(/(\d{1,2})\s+(\w{3})\w*\s+(\d{4})/i)
  if (monthMatch) {
    const m = months[monthMatch[2].toLowerCase().substring(0, 3)]
    if (m) return `${monthMatch[3]}-${m}-${monthMatch[1].padStart(2, "0")}`
  }

  return new Date().toISOString().split("T")[0]
}

/** Render a PDF page to a canvas data URL for OCR */
async function pdfToImages(source: ArrayBuffer | string): Promise<string[]> {
  const loadingTask = pdfjsLib.getDocument(
    typeof source === "string" ? source : { data: source },
  )
  const pdf = await loadingTask.promise
  const images: string[] = []

  const maxPages = Math.min(pdf.numPages, 5) // limit to 5 pages
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i)
    const scale = 2 // higher resolution for better OCR
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement("canvas")
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext("2d")!
    await page.render({ canvasContext: ctx, viewport }).promise
    images.push(canvas.toDataURL("image/png"))
  }

  return images
}

type ScanStatus = "idle" | "scanning" | "done" | "error"

export function ScanPage() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(false)
  const [pdfPageImages, setPdfPageImages] = useState<string[]>([])
  const [fileName, setFileName] = useState("")
  const [filePath, setFilePath] = useState<string | null>(null) // Tauri native path for attachment
  const [status, setStatus] = useState<ScanStatus>("idle")
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ParsedReceipt | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set())
  const [showRawText, setShowRawText] = useState(false)
  const [attachToItem, setAttachToItem] = useState(true)
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const { t } = useI18n()
  const navigate = useNavigate()

  const resetFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    pdfPageImages.forEach((u) => { if (u.startsWith("blob:")) URL.revokeObjectURL(u) })
    setPreviewUrl(null)
    setIsPdf(false)
    setPdfPageImages([])
    setFileName("")
    setFilePath(null)
    setResult(null)
    setSelectedItems(new Set())
    setStatus("idle")
    setProgress(0)
    setError("")
  }

  const loadFile = useCallback(async (file: File) => {
    const isFilePdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    const isImage = file.type.startsWith("image/")
    if (!isImage && !isFilePdf) {
      toast(t("scan.unsupportedFormat"), "error")
      return
    }

    const url = URL.createObjectURL(file)
    setFileName(file.name)
    setFilePath(null) // no native path in browser mode
    setResult(null)
    setStatus("idle")
    setError("")

    if (isFilePdf) {
      setIsPdf(true)
      setPreviewUrl(null)
      try {
        const buffer = await file.arrayBuffer()
        const images = await pdfToImages(buffer)
        setPdfPageImages(images)
        // Use first page as preview
        setPreviewUrl(images[0] || null)
      } catch (err) {
        setError(String(err))
        toast(t("scan.pdfError"), "error")
      }
      URL.revokeObjectURL(url)
    } else {
      setIsPdf(false)
      setPdfPageImages([])
      setPreviewUrl(url)
    }
  }, [toast, t])

  const handlePickFile = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog")
      const selected = await open({
        multiple: false,
        title: t("scan.selectImage"),
        filters: [
          { name: t("scan.filterImagesAndPdf"), extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tiff", "pdf"] },
        ],
      })
      if (!selected) return

      const { readBinaryFileBase64 } = await import("@/lib/tauri")
      const b64 = await readBinaryFileBase64(selected)
      const data = base64ToBytes(b64)
      const name = selected.split("/").pop() || selected.split("\\").pop() || "receipt"
      const isFilePdf = name.toLowerCase().endsWith(".pdf")

      setFileName(name)
      setFilePath(selected) // store native path for attachment
      setResult(null)
      setStatus("idle")
      setError("")

      if (isFilePdf) {
        setIsPdf(true)
        setPreviewUrl(null)
        try {
          const images = await pdfToImages(data.buffer)
          setPdfPageImages(images)
          setPreviewUrl(images[0] || null)
        } catch (err) {
          setError(String(err))
          toast(t("scan.pdfError"), "error")
        }
      } else {
        setIsPdf(false)
        setPdfPageImages([])
        const blob = new Blob([data])
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
      }
    } catch {
      // Fallback to HTML file input (browser mode)
      fileInputRef.current?.click()
    }
  }

  const runOcr = async () => {
    if (!previewUrl && pdfPageImages.length === 0) return
    setStatus("scanning")
    setProgress(0)
    setError("")

    const pages = isPdf && pdfPageImages.length > 0 ? pdfPageImages : (previewUrl ? [previewUrl] : [])
    if (pages.length === 0) return

    let worker: Tesseract.Worker | null = null
    let currentPage = 0
    try {
      worker = await Tesseract.createWorker(["fra", "eng"], Tesseract.OEM.LSTM_ONLY, {
        workerPath: TESSERACT_OPTIONS.workerPath,
        corePath: TESSERACT_OPTIONS.corePath,
        langPath: TESSERACT_OPTIONS.langPath,
        gzip: false,
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            const overall = (currentPage + m.progress) / pages.length
            setProgress(Math.round(overall * 100))
          }
        },
      })
      // PSM 6 = single uniform block of text (better than auto-3 for receipts where
      // columns are tight). preserve_interword_spaces keeps the gap between the
      // description column and the price column intact for the LLM to disambiguate.
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
      })

      let fullText = ""
      for (let i = 0; i < pages.length; i++) {
        currentPage = i
        const preprocessed = await preprocessImage(pages[i]).catch(() => pages[i])
        const { data } = await worker.recognize(preprocessed)
        fullText += data.text + "\n"
      }
      setProgress(100)

      const aiSettings = getAiSettings()
      let parsed: ParsedReceipt = parseReceiptText(fullText)
      if (aiSettings.enabled) {
        try {
          const extracted = await api.aiExtractReceipt(fullText, aiSettings)
          parsed = aiToParsed(extracted, fullText)
        } catch (aiErr) {
          console.warn("AI extraction failed, falling back to regex parser", aiErr)
          toast(`IA indisponible: ${aiErr}`, "error")
        }
      }
      setResult(parsed)
      setSelectedItems(new Set(parsed.items.map((_, i) => i)))
      setStatus("done")
      toast(t("scan.scanComplete"), "success")
    } catch (err) {
      setError(String(err))
      setStatus("error")
      toast(t("scan.scanError"), "error")
    } finally {
      if (worker) {
        try { await worker.terminate() } catch { /* ignore */ }
      }
    }
  }

  // Push the parsed receipt into sessionStorage and hand off to the
  // /scan-review wizard, which walks the user through each line, lets them
  // tweak the kind / attach files / etc., then creates everything in one
  // batch. Anything previously sent through URL params or routed to /items
  // vs /tickets directly is now unified there.
  const createPurchase = () => {
    if (!result) return

    // Only items the user kept checked make it into the wizard.
    const chosenItems = result.items.filter((_, i) => selectedItems.has(i))

    // Voucher lines with a negative price = commercial discount applied on
    // the invoice (not a real item). Surface them in the header step as
    // read-only context.
    const discounts = chosenItems
      .filter((it) => it.category === "voucher" && it.price < 0)
      .map((it) => ({ description: it.description, price: it.price }))

    // Everything else becomes a draft item. Voucher with positive price = a
    // gift card / store credit actually purchased → real item, kind=voucher.
    const items = chosenItems.filter((it) => !(it.category === "voucher" && it.price < 0))

    const drafts: ItemDraft[] = items.map((it) => ({
      item_kind: categoryToKind(it.category),
      description: it.description,
      price: String(Math.abs(it.price)),
      // Apply top-level fields only to the first item if it's a single-item
      // receipt. With multiple items, per-line product_reference / quantity
      // would be wrong, so we leave them blank for the user to fill.
      warranty_months: items.length === 1 && result.warrantyMonths !== null
        ? String(result.warrantyMonths) : "",
      product_reference: items.length === 1 && result.productReference
        ? result.productReference : "",
      quantity: items.length === 1 && result.quantity !== null && result.quantity > 1
        ? String(result.quantity) : "",
      price_excl_tax: items.length === 1 && result.priceExclTax !== null
        ? String(result.priceExclTax) : "",
      tax_rate: items.length === 1 && result.taxRate !== null
        ? String(result.taxRate) : "",
      photo: null,
      code: "",
      expiration_date: "",
      redemption_url: "",
      event_datetime: "",
      event_location: "",
      notes: "",
    }))

    // If the regex fallback produced no items, give the user at least one
    // pre-filled draft from the top-level totals so they aren't stuck on an
    // empty wizard.
    if (drafts.length === 0 && (result.total !== null || result.description)) {
      drafts.push({
        item_kind: "physical",
        description: result.description || "",
        price: result.total !== null ? String(result.total) : "",
        warranty_months: result.warrantyMonths !== null ? String(result.warrantyMonths) : "",
        product_reference: result.productReference || "",
        quantity: result.quantity !== null && result.quantity > 1 ? String(result.quantity) : "",
        price_excl_tax: result.priceExclTax !== null ? String(result.priceExclTax) : "",
        tax_rate: result.taxRate !== null ? String(result.taxRate) : "",
        photo: null,
        code: "",
        expiration_date: "",
        redemption_url: "",
        event_datetime: "",
        event_location: "",
        notes: "",
      })
    }

    const payload: PendingReceipt = {
      shared: {
        purchase_date: result.date || "",
        currency: result.currency || "CHF",
        invoice_number: result.invoiceNumber || "",
        notes: result.notes || "",
        merchantHint: result.merchant || "",
        discounts,
      },
      drafts,
      attachFile: attachToItem && filePath ? filePath : "",
      attachName: attachToItem && filePath ? fileName : "",
    }

    sessionStorage.setItem(PENDING_RECEIPT_KEY, JSON.stringify(payload))
    // Clear any obsolete queues left over from earlier code paths.
    sessionStorage.removeItem("trackbuy.pendingOrderLines")
    sessionStorage.removeItem("trackbuy.pendingDigitalItems")
    navigate("/scan-review")
  }

  /** Translate the OCR-detected category to a DB `item_kind`. */
  function categoryToKind(c: LineCategory): ItemKind {
    if (c === "license") return "license"
    if (c === "voucher") return "voucher"
    // purchase / service / shipping / other → physical (services and shipping
    // are tracked as regular items with a note; ticket isn't OCR-detected).
    return "physical"
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">{t("scan.title")}</h2>
        <p className="text-muted-foreground">{t("scan.subtitle")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: File upload & preview */}
        <div className="space-y-4">
          {!previewUrl && pdfPageImages.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={handlePickFile}
                  className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-muted-foreground/25 p-16 cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/50"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <Upload className="h-8 w-8 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">{t("scan.dropOrBrowse")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("scan.supportedFormats")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg truncate flex items-center gap-2">
                    {isPdf && <FileText className="h-4 w-4 shrink-0 text-red-500" />}
                    {fileName}
                    {isPdf && (
                      <Badge variant="secondary" className="text-[10px]">PDF</Badge>
                    )}
                  </CardTitle>
                  <Button variant="ghost" size="icon" onClick={resetFile}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Preview */}
                <div className="relative overflow-hidden rounded-lg border bg-muted/30">
                  {isPdf && pdfPageImages.length > 0 ? (
                    <div className="space-y-2 p-2">
                      {pdfPageImages.map((img, i) => (
                        <img
                          key={i}
                          src={img}
                          alt={`Page ${i + 1}`}
                          className="w-full max-h-[400px] object-contain rounded border"
                        />
                      ))}
                      <p className="text-xs text-center text-muted-foreground">
                        {pdfPageImages.length} page(s)
                      </p>
                    </div>
                  ) : previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Receipt"
                      className="w-full max-h-[500px] object-contain"
                    />
                  ) : null}
                </div>

                {/* Scan button */}
                <div className="flex gap-2">
                  <Button
                    onClick={runOcr}
                    disabled={status === "scanning"}
                    className="flex-1"
                  >
                    {status === "scanning" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("scan.scanning")} {progress}%
                      </>
                    ) : (
                      <>
                        <ScanLine className="h-4 w-4" />
                        {t("scan.startScan")}
                      </>
                    )}
                  </Button>
                  {status === "done" && (
                    <Button variant="outline" onClick={runOcr}>
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* Progress bar */}
                {status === "scanning" && (
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadFile(file)
              e.target.value = ""
            }}
          />
        </div>

        {/* Right: Results */}
        <div className="space-y-4">
          {status === "error" && (
            <Card className="border-destructive">
              <CardContent className="flex items-center gap-3 p-4">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                <div>
                  <p className="font-medium text-destructive">{t("scan.scanError")}</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {status === "done" && result && (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      {t("scan.extractedData")}
                    </CardTitle>
                    <Button variant="outline" size="sm" onClick={() => setShowRawText(!showRawText)}>
                      {showRawText ? t("scan.hideRaw") : t("scan.showRaw")}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Extracted fields */}
                  <div className="grid gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("scan.merchant")}
                      </label>
                      <p className="font-medium">{result.merchant || <span className="text-muted-foreground italic">{t("scan.notDetected")}</span>}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {t("scan.date")}
                        </label>
                        <p className="font-medium">{result.date || <span className="text-muted-foreground italic">{t("scan.notDetected")}</span>}</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {t("scan.total")} {result.currency && <span className="normal-case">({result.currency})</span>}
                        </label>
                        <p className="font-medium text-lg">
                          {result.total !== null
                            ? `${result.total.toFixed(2)} ${result.currency || ""}`
                            : <span className="text-muted-foreground italic text-base">{t("scan.notDetected")}</span>}
                        </p>
                      </div>
                    </div>
                    {/* Invoice & product reference */}
                    {(result.invoiceNumber || result.productReference) && (
                      <div className="grid grid-cols-2 gap-3">
                        {result.invoiceNumber && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {t("scan.invoiceNumber")}
                            </label>
                            <p className="font-medium font-mono text-sm">{result.invoiceNumber}</p>
                          </div>
                        )}
                        {result.productReference && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {t("scan.productReference")}
                            </label>
                            <p className="font-medium font-mono text-sm">{result.productReference}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Tax info */}
                    {(result.priceExclTax !== null || result.taxRate !== null) && (
                      <div className="grid grid-cols-3 gap-3">
                        {result.priceExclTax !== null && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {t("scan.priceExclTax")}
                            </label>
                            <p className="font-medium">{result.priceExclTax.toFixed(2)}</p>
                          </div>
                        )}
                        {result.taxRate !== null && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {t("scan.taxInfo")}
                            </label>
                            <p className="font-medium">{result.taxRate}%</p>
                          </div>
                        )}
                        {result.priceExclTax !== null && result.total !== null && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              TVA
                            </label>
                            <p className="font-medium">{(result.total - result.priceExclTax).toFixed(2)}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Warranty */}
                    {result.warrantyMonths !== null && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          {t("scan.warranty")}
                        </label>
                        <div className="flex items-center gap-2">
                          <Badge variant="success">{result.warrantyMonths} mois</Badge>
                          {result.warrantyStartDate && <span className="text-sm text-muted-foreground">{t("scan.warrantyDetected")}</span>}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Detected items — grouped by category so a mixed invoice
                      (achats + licences + bons) is immediately readable. */}
                  {result.items.length > 0 && (() => {
                    const groups = new Map<LineCategory, number[]>()
                    result.items.forEach((it, idx) => {
                      const cat = it.category
                      if (!groups.has(cat)) groups.set(cat, [])
                      groups.get(cat)!.push(idx)
                    })
                    const sortedCats = Array.from(groups.keys()).sort(
                      (a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order,
                    )
                    const isMixed = sortedCats.length > 1
                    const currency = result.currency || ""
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            {t("scan.detectedItems")} ({selectedItems.size}/{result.items.length})
                          </label>
                          {result.items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (selectedItems.size === result.items.length) {
                                  setSelectedItems(new Set())
                                } else {
                                  setSelectedItems(new Set(result.items.map((_, i) => i)))
                                }
                              }}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              {selectedItems.size === result.items.length ? "Tout désélectionner" : "Tout sélectionner"}
                            </button>
                          )}
                        </div>

                        {isMixed && (
                          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>
                              Facture mixte détectée : {sortedCats.map((c) => CATEGORY_META[c].label).join(" + ")}. Décoche ce que tu ne veux pas créer comme article.
                            </span>
                          </div>
                        )}

                        {sortedCats.map((cat) => {
                          const meta = CATEGORY_META[cat]
                          const Icon = meta.icon
                          const indices = groups.get(cat)!
                          const subtotal = indices.reduce((sum, i) => sum + result.items[i].price, 0)
                          return (
                            <div key={cat} className="space-y-1">
                              <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-2">
                                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className={`text-[11px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${meta.badgeClass}`}>
                                    {meta.label}
                                  </span>
                                  <span className="text-xs text-muted-foreground">({indices.length})</span>
                                </div>
                                <span className="text-xs font-medium text-muted-foreground">
                                  {subtotal >= 0 ? "" : "−"}{Math.abs(subtotal).toFixed(2)} {currency}
                                </span>
                              </div>
                              <div className="space-y-1">
                                {indices.map((i) => {
                                  const item = result.items[i]
                                  const checked = selectedItems.has(i)
                                  const isNegative = item.price < 0 || cat === "voucher"
                                  return (
                                    <label
                                      key={i}
                                      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                                        checked ? "bg-primary/5 border-primary/40" : "hover:bg-muted/40"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          setSelectedItems((prev) => {
                                            const next = new Set(prev)
                                            if (e.target.checked) next.add(i)
                                            else next.delete(i)
                                            return next
                                          })
                                        }}
                                        className="h-4 w-4 rounded border-input accent-primary shrink-0"
                                      />
                                      <span className={`flex-1 truncate ${checked ? "" : "text-muted-foreground line-through"}`}>
                                        {item.description}
                                      </span>
                                      <Badge variant={checked ? "secondary" : "outline"} className={isNegative ? "text-rose-600 dark:text-rose-300" : ""}>
                                        {isNegative ? "−" : ""}{Math.abs(item.price).toFixed(2)} {currency}
                                      </Badge>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}

                  {/* Raw text toggle */}
                  {showRawText && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {t("scan.rawText")}
                      </label>
                      <pre className="rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                        {result.rawText}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Attach option */}
              {filePath && (
                <Card>
                  <CardContent className="p-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={attachToItem}
                        onChange={(e) => setAttachToItem(e.target.checked)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{t("scan.attachOriginal")}</p>
                        <p className="text-xs text-muted-foreground">{fileName}</p>
                      </div>
                    </label>
                  </CardContent>
                </Card>
              )}

              {/* Action button — sends the parsed receipt to the unified
                  /scan-review wizard so the user can walk through each item
                  one at a time, ajust the kind, attach files, etc. */}
              {(() => {
                const chosen = result.items.filter((_, i) => selectedItems.has(i))
                // Exclude vouchers with negative price from the count — they
                // appear as info on the wizard header, not as items.
                const actualItems = chosen.filter((it) => !(it.category === "voucher" && it.price < 0))
                const label =
                  chosen.length === 0
                    ? result.items.length === 0
                      ? t("scan.createPurchase")
                      : "Sélectionne au moins un article"
                    : actualItems.length === 0
                      ? "Continuer (aucun article — que des remises)"
                      : actualItems.length === 1
                        ? "Vérifier l'article"
                        : `Vérifier les ${actualItems.length} articles`
                return (
                  <Button
                    onClick={createPurchase}
                    className="w-full"
                    size="lg"
                    disabled={result.items.length > 0 && chosen.length === 0}
                  >
                    <ShoppingBag className="h-4 w-4" />
                    {label}
                  </Button>
                )
              })()}
            </>
          )}

          {status === "idle" && !previewUrl && pdfPageImages.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ScanLine className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-sm">{t("scan.instructions")}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

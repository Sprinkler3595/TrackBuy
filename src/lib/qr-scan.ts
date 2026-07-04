import jsQR from "jsqr"
import * as pdfjsLib from "pdfjs-dist"

/// QR-bill scanning from images and PDFs.
///
/// Why this exists: the inbox used to require the user to *paste* the raw
/// ~30-line "SPC…" payload of a Swiss QR-bill — a power-user gesture. An
/// ordinary household receives a paper bill (photo) or a PDF by e-mail. This
/// module turns either of those into the same payload string the backend
/// `decode_qrbill` command already understands, so the rest of the flow
/// (review modal, link-to-engagement) is unchanged.

// Reuse the locally-bundled PDF.js worker (no CDN), same as scan.tsx.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString()

/// A decoded Swiss QR-bill payload always starts with the "SPC" header
/// (Swiss Payments Code). We use this to reject unrelated QR codes (e.g. a
/// random URL QR) before bothering the backend parser.
function isSwissQrPayload(text: string): boolean {
  return text.trimStart().startsWith("SPC")
}

/// Run jsQR over one frame. jsQR's default `attemptBoth` also handles the
/// inverted (dark-background) case, which matters for some scanned slips.
function decodeFrame(imageData: ImageData): string | null {
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  })
  return code?.data ?? null
}

/// Load an image (object URL or data URL) and return its pixels as ImageData.
async function imageSrcToImageData(src: string): Promise<ImageData> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("Impossible de charger l'image"))
    img.src = src
  })
  const canvas = document.createElement("canvas")
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("Canvas indisponible")
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/// Render each PDF page (capped) to ImageData. The Swiss QR is usually on the
/// payment part at the bottom of an A4 invoice, so we render at a comfortable
/// resolution and let jsQR find it anywhere on the page.
async function pdfDataToImageDatas(
  data: ArrayBuffer,
  maxPages = 3,
): Promise<ImageData[]> {
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const out: ImageData[] = []
  const pages = Math.min(pdf.numPages, maxPages)
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.5 })
    const canvas = document.createElement("canvas")
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) continue
    await page.render({ canvasContext: ctx, canvas, viewport }).promise
    out.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
  }
  return out
}

/// Decode a Swiss QR-bill from raw file bytes. Returns the "SPC…" payload
/// string, or null if no Swiss QR-bill code was found. Non-Swiss QR codes are
/// ignored on purpose (they can't be parsed as bills).
export async function scanQrFromBytes(
  bytes: Uint8Array,
  isPdf: boolean,
): Promise<string | null> {
  if (isPdf) {
    // Copy into a standalone ArrayBuffer — pdf.js transfers/neuters the buffer
    // it's given, which would corrupt a shared view.
    const buf = bytes.slice().buffer
    const frames = await pdfDataToImageDatas(buf)
    for (const frame of frames) {
      const text = decodeFrame(frame)
      if (text && isSwissQrPayload(text)) return text
    }
    return null
  }

  const blob = new Blob([bytes as BlobPart])
  const url = URL.createObjectURL(blob)
  try {
    const frame = await imageSrcToImageData(url)
    const text = decodeFrame(frame)
    return text && isSwissQrPayload(text) ? text : null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/// Browser-mode convenience wrapper around a File picked via <input>.
export async function scanQrFromFile(file: File): Promise<string | null> {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  const bytes = new Uint8Array(await file.arrayBuffer())
  return scanQrFromBytes(bytes, isPdf)
}

// ---------------------------------------------------------------------------
// Due-date extraction
//
// The Swiss QR-bill payload carries no due date. For digital PDF invoices
// (the common case — a bill received by e-mail) the date is in the document's
// text layer next to a "payable until / échéance / zahlbar bis" label. We read
// that text with pdf.js (no OCR needed) and pull the date out. Photos / scanned
// image-only PDFs have no text layer, so this returns null and the user sets
// the date manually.
// ---------------------------------------------------------------------------

// Labels that introduce a payment due date, across the four Swiss languages
// (+ English). Kept permissive; the date search is anchored right after a hit.
const DUE_LABELS =
  /(payable\s+jusqu[’'`]?\s*au|[ée]ch[ée]ance|[àa]\s+payer\s+(?:avant|jusqu[’'`]?\s*au)|payable\s+avant(?:\s+le)?|zahlbar\s+bis(?:\s+am)?|f[äa]llig(?:keitsdatum|keit|\s+am)?|scadenza|pagabile\s+(?:entro|fino\s+al)|payable\s+until|due\s+date|pay(?:able)?\s+by)/i

/// Turn the first date found in `s` into an ISO `YYYY-MM-DD`, or null.
/// Accepts DD.MM.YYYY / DD.MM.YY / DD/MM/YYYY / DD-MM-YYYY and ISO.
function firstDateToIso(s: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const m = /(\d{1,2})[.\s/-](\d{1,2})[.\s/-](\d{2,4})/.exec(s)
  if (m) {
    const day = m[1].padStart(2, "0")
    const month = m[2].padStart(2, "0")
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    if (+month >= 1 && +month <= 12 && +day >= 1 && +day <= 31) {
      return `${year}-${month}-${day}`
    }
  }
  return null
}

/// Find a payment due date in free text: locate a due-date label, then read the
/// first date within the following ~40 characters.
export function findDueDateInText(text: string): string | null {
  const flat = text.replace(/\s+/g, " ")
  const label = DUE_LABELS.exec(flat)
  if (!label) return null
  const start = label.index + label[0].length
  return firstDateToIso(flat.slice(start, start + 40))
}

/// Read a digital PDF's text layer (best-effort). Returns "" for image-only
/// PDFs (no text layer) or on failure. The text feeds both the quick regex
/// due-date guess and the optional AI extraction.
async function pdfText(buf: ArrayBuffer, maxPages = 3): Promise<string> {
  try {
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise
    const pages = Math.min(pdf.numPages, maxPages)
    let text = ""
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      text += " " + content.items.map((it) => ("str" in it ? it.str : "")).join(" ")
    }
    return text
  } catch {
    return ""
  }
}

/// Extract the invoice text from the same source used for QR scanning. Only
/// digital PDFs are supported; images return "".
export async function extractTextFromBytes(bytes: Uint8Array, isPdf: boolean): Promise<string> {
  if (!isPdf) return ""
  return pdfText(bytes.slice().buffer)
}

export async function extractTextFromFile(file: File): Promise<string> {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  if (!isPdf) return ""
  return pdfText(await file.arrayBuffer())
}

/// OCR fallback: for a photo or an image-only PDF (no text layer), render the
/// source to images and run Tesseract over them. Returns "" if OCR isn't
/// available. Heavier than the text layer, so callers use it only when the
/// text layer came back empty.
export async function ocrSourceToText(bytes: Uint8Array, isPdf: boolean): Promise<string> {
  const { ocrImagesToText } = await import("@/lib/ocr")
  if (isPdf) {
    const images = await pdfDataToImageDatas(bytes.slice().buffer, 2)
    return ocrImagesToText(images)
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
  try {
    const image = await imageSrcToImageData(url)
    return ocrImagesToText([image])
  } finally {
    URL.revokeObjectURL(url)
  }
}

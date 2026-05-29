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

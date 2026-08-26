import * as pdfjsLib from "pdfjs-dist"
import { ocrImagesToText } from "@/lib/ocr"

// Same local pdfjs worker config as scan.tsx / bank-statement-review.tsx — the
// URL is rewritten by Vite at build time so nothing is fetched from a CDN.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString()

/// Extract the embedded text layer of a PDF, preserving line breaks. Digital
/// contracts (insurance policies, offers…) almost always ship a text layer, so
/// this is both faster and far more accurate than OCR.
///
/// Uses streamTextContent() + reader.read() rather than getTextContent(),
/// because pdfjs-dist v5's getTextContent() relies on
/// `ReadableStream[Symbol.asyncIterator]`, missing in the WebKit webview
/// shipped with Tauri (macOS WebKit / Linux webkit2gtk). Mirrors the approach
/// used by bank-statement-review.tsx.
async function pdfTextLayer(data: ArrayBuffer, maxPages = 8): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data }).promise
  const pages: string[] = []

  type Item = { x: number; y: number; h: number; str: string }
  const pageCount = Math.min(doc.numPages, maxPages)
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const stream = page.streamTextContent({}) as ReadableStream<{
      items: Array<{ str?: string; transform?: number[]; height?: number }>
    }>
    const reader = stream.getReader()
    const items: Item[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || !Array.isArray(value.items)) continue
      for (const it of value.items) {
        if (!it || typeof it.str !== "string") continue
        if (!it.str.trim() && it.str !== " ") continue
        const x = it.transform?.[4] ?? 0
        const y = it.transform?.[5] ?? 0
        const h = it.height ?? 10
        items.push({ x, y, h, str: it.str })
      }
    }

    // Group items into lines by their Y coordinate (top-to-bottom).
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: { y: number; items: Item[] }[] = []
    for (const it of items) {
      const tol = Math.max(it.h / 2, 3)
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.y - it.y) <= tol) last.items.push(it)
      else lines.push({ y: it.y, items: [it] })
    }
    const pageLines = lines.map((line) => {
      line.items.sort((a, b) => a.x - b.x)
      return line.items.map((it) => it.str).join(" ")
    })
    pages.push(pageLines.join("\n"))
  }
  return pages.join("\n")
}

/// Render up to `maxPages` PDF pages to PNG data URLs (for the OCR fallback
/// when a PDF has no usable text layer — scanned contracts).
async function pdfToImages(data: ArrayBuffer, maxPages = 5): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const images: string[] = []
  const pageCount = Math.min(pdf.numPages, maxPages)
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement("canvas")
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext("2d")
    if (!ctx) continue
    await page.render({ canvasContext: ctx, canvas, viewport }).promise
    images.push(canvas.toDataURL("image/png"))
  }
  return images
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/// Turn a picked document (image or PDF) into plain text for AI extraction.
///
/// - PDF: read the embedded text layer first (accurate, no OCR); if it's empty
///   (scanned/photo PDF), render the pages and OCR them.
/// - Image: OCR directly.
///
/// Returns "" when nothing could be read (e.g. an image with no local tessdata
/// installed) so callers can show an actionable message.
export async function documentToText(
  bytes: Uint8Array,
  mime: string,
  name: string,
): Promise<string> {
  const isPdf = mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")
  // A fresh ArrayBuffer slice (never a SharedArrayBuffer) is the only thing
  // pdfjs / Blob accept.
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  if (isPdf) {
    const textLayer = await pdfTextLayer(buf).catch(() => "")
    // A real contract page carries plenty of text; a near-empty result means
    // the PDF is scanned images → fall back to OCR.
    if (textLayer.trim().length > 60) return textLayer
    const images = await pdfToImages(buf).catch(() => [] as string[])
    return images.length > 0 ? ocrImagesToText(images) : textLayer
  }

  const dataUrl = await blobToDataUrl(new Blob([buf], { type: mime }))
  return ocrImagesToText([dataUrl])
}

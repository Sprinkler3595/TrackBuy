import Tesseract from "tesseract.js"

/// Local-only Tesseract artifacts, served from /tessdata/ (populated by
/// `npm run fetch-tessdata`). Mirrors the config used by the scan page.
const TESSERACT_OPTIONS = {
  workerPath: "/tessdata/worker.min.js",
  corePath: "/tessdata/tesseract-core-simd.wasm.js",
  langPath: "/tessdata",
  gzip: false,
} as const

/// True when the French traineddata is present locally. OCR silently no-ops
/// when it isn't (the app still works, just without image OCR).
export async function tessdataAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${TESSERACT_OPTIONS.langPath}/fra.traineddata`, { method: "HEAD" })
    return r.ok
  } catch {
    return false
  }
}

/// OCR one or more images (data URLs or ImageData) to plain text (fra + eng).
/// Best-effort: returns "" if the local tessdata is missing or OCR fails, so
/// callers can treat it as an optional enrichment.
export async function ocrImagesToText(images: (string | ImageData)[]): Promise<string> {
  if (images.length === 0) return ""
  if (!(await tessdataAvailable())) return ""

  let worker: Tesseract.Worker | null = null
  try {
    worker = await Tesseract.createWorker(["fra", "eng"], Tesseract.OEM.LSTM_ONLY, {
      workerPath: TESSERACT_OPTIONS.workerPath,
      corePath: TESSERACT_OPTIONS.corePath,
      langPath: TESSERACT_OPTIONS.langPath,
      gzip: false,
    })
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
    })
    let text = ""
    for (const img of images) {
      const { data } = await worker.recognize(img)
      text += data.text + "\n"
    }
    return text
  } catch {
    return ""
  } finally {
    if (worker) {
      try {
        await worker.terminate()
      } catch {
        /* ignore */
      }
    }
  }
}

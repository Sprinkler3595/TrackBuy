#!/usr/bin/env node
/**
 * Fetch Tesseract.js runtime + language data into public/tessdata/ so the OCR
 * pipeline runs fully offline (no CDN hit at runtime).
 *
 * Usage: `npm run fetch-tessdata`
 *
 * Validates downloaded files against pinned SHA-256 hashes to mitigate supply-
 * chain tampering. Update hashes when bumping versions.
 */

import { createHash } from "node:crypto"
import { mkdir, writeFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const TESSDATA_DIR = join(__dirname, "..", "public", "tessdata")

// Pinned versions — bump together with the npm package.
const TESSERACT_JS_VERSION = "6.0.1" // worker.min.js
const TESSERACT_CORE_VERSION = "6.0.0" // tesseract-core-simd.wasm.js
const TRAINEDDATA_REPO_TAG = "4.1.0" // tesseract-ocr/tessdata_fast

const FILES = [
  {
    name: "worker.min.js",
    url: `https://unpkg.com/tesseract.js@${TESSERACT_JS_VERSION}/dist/worker.min.js`,
    // Set null on first run, then paste the printed hash here to pin it.
    sha256: null,
  },
  {
    name: "tesseract-core-simd.wasm.js",
    url: `https://unpkg.com/tesseract.js-core@${TESSERACT_CORE_VERSION}/tesseract-core-simd.wasm.js`,
    sha256: null,
  },
  {
    name: "tesseract-core-simd.wasm",
    url: `https://unpkg.com/tesseract.js-core@${TESSERACT_CORE_VERSION}/tesseract-core-simd.wasm`,
    sha256: null,
  },
  {
    name: "eng.traineddata",
    url: `https://github.com/tesseract-ocr/tessdata_fast/raw/${TRAINEDDATA_REPO_TAG}/eng.traineddata`,
    sha256: null,
  },
  {
    name: "fra.traineddata",
    url: `https://github.com/tesseract-ocr/tessdata_fast/raw/${TRAINEDDATA_REPO_TAG}/fra.traineddata`,
    sha256: null,
  },
]

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function fetchAndHash(url) {
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const hash = createHash("sha256").update(buf).digest("hex")
  return { buf, hash }
}

await mkdir(TESSDATA_DIR, { recursive: true })

let failed = 0
for (const file of FILES) {
  const dest = join(TESSDATA_DIR, file.name)
  if (await exists(dest)) {
    console.log(`  ✓ ${file.name} already present`)
    continue
  }
  process.stdout.write(`  ↓ ${file.name} ... `)
  try {
    const { buf, hash } = await fetchAndHash(file.url)
    if (file.sha256 && file.sha256 !== hash) {
      console.error(`FAIL — sha256 mismatch\n    expected ${file.sha256}\n    got      ${hash}`)
      failed++
      continue
    }
    await writeFile(dest, buf)
    console.log(`OK  (${buf.length} bytes, sha256=${hash})`)
  } catch (e) {
    console.error(`FAIL — ${e.message}`)
    failed++
  }
}

if (failed > 0) {
  console.error(`\n${failed} file(s) failed.`)
  process.exit(1)
}
console.log(`\nDone. ${FILES.length} file(s) in ${TESSDATA_DIR}`)

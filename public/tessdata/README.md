# tessdata/

Files required by Tesseract.js (loaded at runtime by `src/pages/scan.tsx`).

Run once after `npm install`:

```bash
npm run fetch-tessdata
```

That downloads:
- `worker.min.js`
- `tesseract-core-simd.wasm.js`
- `tesseract-core-simd.wasm`
- `eng.traineddata`
- `fra.traineddata`

into this directory. The script verifies pinned SHA-256 hashes (see
`scripts/fetch-tessdata.mjs`).

The binaries are gitignored so they are not committed.

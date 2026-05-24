import * as api from "@/lib/tauri"

/**
 * Filename templating engine. Resolves patterns like:
 *
 *   {date|YYYY-MM-DD}_{merchant|slug}_facture_{invoice_number|or:'sans-num'}.{ext}
 *
 * into a deterministic, filesystem-safe display name from the data scanned
 * via OCR/AI. The engine is purely client-side; user overrides are persisted
 * in the SQLite `filename_templates` table (one row per attachment_type),
 * with defaults shipped in `DEFAULT_TEMPLATES` below.
 */

/** Logical attachment categories the templating system knows about. Mirrors
 *  the `attachment_type` strings used by the backend. */
export type AttachmentTypeKey =
  | "invoice"
  | "purchase_order"
  | "photo"
  | "ticket_code"
  | "voucher_code"
  | "license_key"
  | "warranty"
  | "other"

export const ATTACHMENT_TYPE_KEYS: AttachmentTypeKey[] = [
  "invoice",
  "purchase_order",
  "photo",
  "ticket_code",
  "voucher_code",
  "license_key",
  "warranty",
  "other",
]

export const ATTACHMENT_TYPE_LABELS: Record<AttachmentTypeKey, string> = {
  invoice:        "Facture",
  purchase_order: "Bon de commande",
  photo:          "Photo",
  ticket_code:    "Code billet",
  voucher_code:   "Code voucher",
  license_key:    "Clé licence",
  warranty:       "Garantie",
  other:          "Autre",
}

/** Defaults bundled with the app — used whenever the SQLite override row is
 *  missing for that type. Tweak here to evolve defaults across releases. */
export const DEFAULT_TEMPLATES: Record<AttachmentTypeKey, string> = {
  invoice:        "{date|YYYY-MM-DD}_{merchant|slug}_facture_{invoice_number|or:'sans-num'}.{ext}",
  purchase_order: "{date|YYYY-MM-DD}_{merchant|slug}_bon-commande.{ext}",
  photo:          "{date|YYYY-MM-DD}_{description|slug|truncate:40}_photo.{ext}",
  ticket_code:    "{event_datetime|YYYY-MM-DD}_{event_location|slug|or:'evenement'}_billet.{ext}",
  voucher_code:   "{date|YYYY-MM-DD}_{merchant|slug}_voucher.{ext}",
  license_key:    "{date|YYYY-MM-DD}_{description|slug|truncate:30}_licence.{ext}",
  warranty:       "{date|YYYY-MM-DD}_{description|slug|truncate:40}_garantie.{ext}",
  other:          "{date|YYYY-MM-DD}_{description|slug|truncate:40}.{ext}",
}

export interface TemplateContext {
  merchant?: string
  date?: string
  invoice_number?: string
  product_reference?: string
  quantity?: number
  description?: string
  item_kind?: string
  event_datetime?: string
  event_location?: string
  currency?: string
  /** Override the extension. If omitted, falls back to the one parsed from
   *  the original filename. */
  ext?: string
}

const FILENAME_INVALID_RE = /[/\\:*?"<>|]/g
const COLLAPSE_SEP_RE = /[_\-]{2,}/g
const TRIM_SEP_RE = /^[_\-.]+|[_\-.]+$/g

// ---------------------------------------------------------------------------
// Filter implementations
// ---------------------------------------------------------------------------

function applySlug(input: string): string {
  // Decompose accents, strip combining marks, lowercase, swap whitespace and
  // unsafe chars for dashes, collapse repeats.
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function applyClean(input: string): string {
  // Keep diacritics, replace only OS-forbidden characters and whitespace runs.
  return input
    .replace(FILENAME_INVALID_RE, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function applyDateFormat(input: string, format: string): string {
  // Accept ISO (YYYY-MM-DD), slashed, dotted, or anything Date can parse.
  // Returns "" if the input doesn't look like a date so the segment vanishes.
  if (!input) return ""
  const isoMatch = input.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})/)
  let y: string, m: string, d: string
  if (isoMatch) {
    [, y, m, d] = isoMatch
  } else {
    const parsed = new Date(input)
    if (isNaN(parsed.getTime())) return ""
    y = String(parsed.getFullYear())
    m = String(parsed.getMonth() + 1).padStart(2, "0")
    d = String(parsed.getDate()).padStart(2, "0")
  }
  switch (format) {
    case "YYYYMMDD":   return `${y}${m}${d}`
    case "YYYY-MM-DD": return `${y}-${m}-${d}`
    case "YYYY-MM":    return `${y}-${m}`
    case "YYYY":       return y
    default:           return `${y}-${m}-${d}`
  }
}

function applyTruncate(input: string, n: number): string {
  if (input.length <= n) return input
  // Try to break on a word boundary near the limit, else hard-cut.
  const sub = input.slice(0, n)
  const lastBreak = sub.lastIndexOf("-")
  if (lastBreak > n * 0.6) return sub.slice(0, lastBreak)
  return sub
}

function applyPad(input: string, n: number): string {
  // Only zero-pad if input looks like an integer.
  if (!/^-?\d+$/.test(input)) return input
  const neg = input.startsWith("-")
  const digits = neg ? input.slice(1) : input
  const padded = digits.padStart(n, "0")
  return neg ? "-" + padded : padded
}

// ---------------------------------------------------------------------------
// Pipe parser
// ---------------------------------------------------------------------------

interface ParsedFilter {
  name: string
  arg: string | null
}

function parseFilters(spec: string): ParsedFilter[] {
  // spec is the part after the first `|`, e.g. "slug|truncate:40|or:'fallback'"
  const out: ParsedFilter[] = []
  let i = 0
  while (i < spec.length) {
    let j = i
    let inQuote = false
    while (j < spec.length) {
      const ch = spec[j]
      if (ch === "'") inQuote = !inQuote
      else if (ch === "|" && !inQuote) break
      j++
    }
    const token = spec.slice(i, j).trim()
    if (token) {
      const colonIdx = token.indexOf(":")
      if (colonIdx === -1) {
        out.push({ name: token, arg: null })
      } else {
        let arg = token.slice(colonIdx + 1).trim()
        if ((arg.startsWith("'") && arg.endsWith("'"))
          || (arg.startsWith('"') && arg.endsWith('"'))) {
          arg = arg.slice(1, -1)
        }
        out.push({ name: token.slice(0, colonIdx).trim(), arg })
      }
    }
    i = j + 1
  }
  return out
}

function applyFilters(value: string, filters: ParsedFilter[]): string {
  let current = value
  for (const f of filters) {
    if (current === "" && f.name !== "or") continue // empty short-circuits except for fallback
    switch (f.name) {
      case "slug":       current = applySlug(current); break
      case "clean":      current = applyClean(current); break
      case "upper":      current = current.toUpperCase(); break
      case "lower":      current = current.toLowerCase(); break
      case "truncate":   current = applyTruncate(current, parseInt(f.arg ?? "40", 10)); break
      case "pad":        current = applyPad(current, parseInt(f.arg ?? "0", 10)); break
      case "or":         if (current === "") current = f.arg ?? ""; break
      case "YYYYMMDD":
      case "YYYY-MM-DD":
      case "YYYY-MM":
      case "YYYY":       current = applyDateFormat(current, f.name); break
      default:           // unknown filter → no-op (fail open)
        break
    }
  }
  return current
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

function ctxGet(ctx: TemplateContext, key: string): string {
  const v = (ctx as Record<string, unknown>)[key]
  if (v === undefined || v === null) return ""
  return String(v)
}

/**
 * Resolve a single template into a filename. Empty placeholders make their
 * adjacent separator disappear so we don't end up with `__` or `_-`.
 */
export function resolveTemplate(template: string, ctx: TemplateContext): string {
  // Match {var} or {var|filter|filter:arg} — argument captured greedily.
  const placeholderRe = /\{([a-zA-Z_][a-zA-Z0-9_-]*)((?:\|[^{}]*)?)\}/g

  // Two-pass: first substitute placeholders, marking empty ones with a
  // sentinel so the second pass can strip adjacent separators.
  const EMPTY = " "
  const replaced = template.replace(placeholderRe, (_, name: string, filterPart: string) => {
    const filters = filterPart.startsWith("|")
      ? parseFilters(filterPart.slice(1))
      : []
    const raw = ctxGet(ctx, name)
    const out = applyFilters(raw, filters)
    return out === "" ? EMPTY : out
  })

  // Strip the sentinel and any separator(s) immediately adjacent to it.
  // e.g. "a_ _b" → "a_b", "_ .ext" → ".ext"
  let stripped = replaced
  // Collapse "{sep?}EMPTY{sep?}" → keep one separator if both sides have text.
  stripped = stripped.replace(
    new RegExp(`([_\\-]?)${EMPTY}([_\\-]?)`, "g"),
    (_full, before: string, after: string) => {
      if (before && after) return before
      return ""
    },
  )

  // Collapse adjacent separators and trim them off the edges.
  stripped = stripped
    .replace(COLLAPSE_SEP_RE, (m) => m[0])
    .replace(/\.+/g, ".")

  // Guard against forbidden chars sneaking in via raw user-provided values
  // that weren't piped through slug/clean.
  stripped = stripped.replace(FILENAME_INVALID_RE, "_")

  return stripped
}

/**
 * Wrap `resolveTemplate` with the suffix + sanitization + safety net needed
 * to use the result as a real display_name on the attachment row.
 */
export function buildDisplayName(
  type: AttachmentTypeKey,
  template: string,
  ctx: TemplateContext,
  originalName: string,
  idSuffix: string | null,
): string {
  const ext = (ctx.ext || extractExtension(originalName) || "").toLowerCase()
  const ctxWithExt: TemplateContext = { ...ctx, ext }

  let name = ""
  try {
    name = resolveTemplate(template, ctxWithExt)
  } catch {
    name = ""
  }

  // Strip extension off the body so we can splice the suffix before it.
  let body = name
  let finalExt = ext
  const lastDot = body.lastIndexOf(".")
  if (lastDot > 0 && lastDot >= body.length - 5) {
    finalExt = body.slice(lastDot + 1) || ext
    body = body.slice(0, lastDot)
  }
  body = body.replace(TRIM_SEP_RE, "")

  // If resolution produced nothing usable, fall back to the original name —
  // better than an empty/uuid-only filename when the OCR didn't yield much.
  if (!body) {
    void type
    return sanitizeBasename(originalName)
  }

  const suffix = idSuffix ? `-${idSuffix}` : ""
  const safeBody = body.replace(FILENAME_INVALID_RE, "_")
  const dotExt = finalExt ? `.${finalExt.replace(FILENAME_INVALID_RE, "")}` : ""
  return `${safeBody}${suffix}${dotExt}`
}

function extractExtension(name: string): string {
  const idx = name.lastIndexOf(".")
  if (idx <= 0 || idx === name.length - 1) return ""
  return name.slice(idx + 1)
}

function sanitizeBasename(name: string): string {
  return name.replace(FILENAME_INVALID_RE, "_")
}

// ---------------------------------------------------------------------------
// Cached lookup of effective templates (default ⊕ user overrides)
// ---------------------------------------------------------------------------

let cache: Map<AttachmentTypeKey, string> | null = null
let inflight: Promise<Map<AttachmentTypeKey, string>> | null = null

async function loadCache(): Promise<Map<AttachmentTypeKey, string>> {
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    const map = new Map<AttachmentTypeKey, string>(
      ATTACHMENT_TYPE_KEYS.map((k) => [k, DEFAULT_TEMPLATES[k]] as const),
    )
    try {
      const overrides = await api.listFilenameTemplates()
      for (const row of overrides) {
        if (isKnownType(row.attachment_type)) {
          map.set(row.attachment_type, row.template)
        }
      }
    } catch {
      // Browser mode / not unlocked yet → keep defaults.
    }
    cache = map
    inflight = null
    return map
  })()
  return inflight
}

function isKnownType(t: string): t is AttachmentTypeKey {
  return (ATTACHMENT_TYPE_KEYS as string[]).includes(t)
}

/** Drop the in-memory cache so the next harmonization rereads the DB. */
export function invalidateTemplateCache(): void {
  cache = null
  inflight = null
}

/**
 * Resolve the effective template for `type` and build a display name from the
 * provided context. Returns `originalName` (sanitized) if anything goes wrong.
 *
 * `idHint` should be the short prefix of the attachment id (or any unique
 * tag); 6 hex chars is plenty for visual uniqueness inside a folder.
 */
export async function harmonizedName(
  type: AttachmentTypeKey,
  ctx: TemplateContext,
  originalName: string,
  idHint?: string | null,
): Promise<string> {
  try {
    const map = await loadCache()
    const template = map.get(type) ?? DEFAULT_TEMPLATES[type]
    return buildDisplayName(type, template, ctx, originalName, idHint ?? null)
  } catch {
    return sanitizeBasename(originalName)
  }
}

/** Synchronous variant used by the settings preview where defaults + the
 *  currently-edited template are passed in explicitly. */
export function previewName(
  type: AttachmentTypeKey,
  template: string,
  ctx: TemplateContext,
  originalName: string,
  idHint?: string | null,
): string {
  return buildDisplayName(type, template, ctx, originalName, idHint ?? null)
}

/**
 * Best-effort short hint to make the harmonized name visually unique inside a
 * folder. We use the leading bytes of crypto.randomUUID() when available;
 * callers should pass the attachment id later (post-insert) if they want true
 * stability, but for display_name set at insert time, a fresh hint works too.
 */
export function shortIdHint(): string {
  try {
    return (globalThis.crypto?.randomUUID?.() ?? "").replace(/-/g, "").slice(0, 6) || randHex(6)
  } catch {
    return randHex(6)
  }
}

function randHex(n: number): string {
  const chars = "0123456789abcdef"
  let out = ""
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * 16)]
  return out
}

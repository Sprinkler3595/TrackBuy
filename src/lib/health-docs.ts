import type { HealthDocKind } from "@/lib/tauri"

/// Health-insurance document kinds, in the order a year produces them.
export const HEALTH_DOC_KINDS: { kind: HealthDocKind; fr: string; en: string; attachmentType: string }[] = [
  { kind: "policy", fr: "Police d'assurance", en: "Insurance policy", attachmentType: "contract" },
  { kind: "premium_notice", fr: "Avis de prime", en: "Premium notice", attachmentType: "contract" },
  { kind: "premium_invoice", fr: "Facture de primes", en: "Premium invoice", attachmentType: "invoice" },
  { kind: "benefit_statement", fr: "Décompte de prestations", en: "Benefit statement", attachmentType: "claim" },
  { kind: "subsidy_decision", fr: "Décision de subside", en: "Subsidy decision", attachmentType: "other" },
  { kind: "affiliation", fr: "Confirmation d'affiliation", en: "Affiliation confirmation", attachmentType: "contract" },
  { kind: "cancellation", fr: "Résiliation", en: "Cancellation", attachmentType: "other" },
  { kind: "tax_certificate", fr: "Attestation fiscale", en: "Tax certificate", attachmentType: "other" },
  { kind: "other", fr: "Autre", en: "Other", attachmentType: "other" },
]

export const docKindLabel = (k: HealthDocKind, fr: boolean): string => {
  const d = HEALTH_DOC_KINDS.find((x) => x.kind === k)
  return d ? (fr ? d.fr : d.en) : k
}

export const docAttachmentType = (k: HealthDocKind): string =>
  HEALTH_DOC_KINDS.find((x) => x.kind === k)?.attachmentType ?? "other"

/// "2027 — Avis de prime — Sophie, Léa — CSS.pdf": the year first, so a
/// folder export sorts itself.
export function healthDocName(opts: { year: number | null; kind: HealthDocKind; people: string[]; insurer?: string | null; original: string; fr: boolean }): string {
  const ext = opts.original.includes(".") ? opts.original.slice(opts.original.lastIndexOf(".")) : ""
  const firstNames = opts.people.map((p) => p.split(/\s+/)[0]).join(", ")
  const parts = [opts.year ? String(opts.year) : null, docKindLabel(opts.kind, opts.fr), firstNames || null, opts.insurer || null]
  return parts.filter(Boolean).join(" — ") + ext
}

export const mimeOf = (name: string): string => {
  const n = name.toLowerCase()
  if (n.endsWith(".pdf")) return "application/pdf"
  if (n.endsWith(".png")) return "image/png"
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg"
  if (n.endsWith(".heic")) return "image/heic"
  return "application/octet-stream"
}

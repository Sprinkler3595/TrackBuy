import type { HealthAgeClass, HealthDecision, HealthModel } from "@/lib/tauri"

/// Labels for the Swiss health-insurance screens. Amounts and legal values
/// never live here: they come from `get_health_params(year)`.

export const HEALTH_MODELS: HealthModel[] = ["standard", "family_doctor", "hmo", "telmed", "other"]

export const healthModelLabel = (m: HealthModel | null | undefined, fr: boolean): string =>
  m === "standard"      ? (fr ? "Standard (libre choix)" : "Standard (free choice)") :
  m === "family_doctor" ? (fr ? "Médecin de famille" : "Family doctor") :
  m === "hmo"           ? "HMO" :
  m === "telmed"        ? (fr ? "Telmed (télémédecine)" : "Telmed (telemedicine)") :
  m === "other"         ? (fr ? "Autre modèle alternatif" : "Other managed-care model") :
                          "—"

export const ageClassLabel = (c: HealthAgeClass | null | undefined, fr: boolean): string =>
  c === "child"       ? (fr ? "Enfant (0-18 ans)" : "Child (0-18)") :
  c === "young_adult" ? (fr ? "Jeune adulte (19-25 ans)" : "Young adult (19-25)") :
  c === "adult"       ? (fr ? "Adulte (26 ans et plus)" : "Adult (26+)") :
                        "—"

export const decisionLabel = (d: HealthDecision, fr: boolean): string =>
  d === "keep"             ? (fr ? "Je reste tel quel" : "Keep as is") :
  d === "change_franchise" ? (fr ? "Je change de franchise" : "Change deductible") :
  d === "change_model"     ? (fr ? "Je change de modèle" : "Change model") :
  d === "switch_insurer"   ? (fr ? "Je change de caisse" : "Switch insurer") :
                             (fr ? "À décider" : "To decide")

/// Supplementary (LCA) covers. Mirror of HEALTH_SUPPLEMENTARY_SLUGS in ai.rs.
export const HEALTH_SUPPLEMENTARY_OPTIONS = [
  { slug: "hospital_general", fr: "Hospitalisation division commune (toute la Suisse)", en: "Hospital, general ward (all Switzerland)" },
  { slug: "hospital_semi_private", fr: "Hospitalisation demi-privée", en: "Hospital, semi-private" },
  { slug: "hospital_private", fr: "Hospitalisation privée", en: "Hospital, private" },
  { slug: "outpatient", fr: "Complémentaire ambulatoire", en: "Outpatient supplement" },
  { slug: "alternative_medicine", fr: "Médecines complémentaires", en: "Alternative medicine" },
  { slug: "dental", fr: "Soins dentaires", en: "Dental care" },
  { slug: "glasses", fr: "Lunettes et lentilles", en: "Glasses & lenses" },
  { slug: "travel", fr: "Étranger / assistance voyage", en: "Abroad / travel assistance" },
  { slug: "prevention", fr: "Prévention, fitness", en: "Prevention, fitness" },
  { slug: "daily_allowance", fr: "Indemnité journalière", en: "Daily allowance" },
  { slug: "capital", fr: "Capital décès / invalidité", en: "Death / disability capital" },
] as const

export const supplementaryLabel = (slug: string, fr: boolean): string => {
  const o = HEALTH_SUPPLEMENTARY_OPTIONS.find((x) => x.slug === slug)
  return o ? (fr ? o.fr : o.en) : slug
}

export const parseOptions = (json: string | null | undefined): string[] => {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

/// Age class from a birth year, same rule as the backend (`age_class`): the
/// class changes on the 1st of January after turning 18, then 25.
export function ageClassFor(birthYear: number | null, year: number): HealthAgeClass | null {
  if (birthYear == null) return null
  const age = year - birthYear
  if (age <= 18) return "child"
  if (age <= 25) return "young_adult"
  return "adult"
}

export const yearOf = (iso: string | null | undefined): number | null => {
  const y = iso ? parseInt(iso.slice(0, 4), 10) : NaN
  return Number.isNaN(y) ? null : y
}

/// One supplementary (LCA) product, named as on the policy. Mirror of
/// `health::supplementary::SupplementaryLine`.
export interface SupplementaryLine {
  name: string
  monthly_premium: number
  /// "pct" = percent of the premium, "chf" = francs per month.
  discount_kind: "pct" | "chf"
  discount_value: number
}

export const round2 = (v: number) => Math.round(v * 100) / 100

export const lineDiscount = (l: SupplementaryLine): number => {
  const d = l.discount_kind === "pct" ? l.monthly_premium * l.discount_value / 100 : l.discount_value
  return round2(Math.min(Math.max(d, 0), Math.max(l.monthly_premium, 0)))
}

export const lineNet = (l: SupplementaryLine): number => round2(l.monthly_premium - lineDiscount(l))

export const linesTotal = (lines: SupplementaryLine[]): number => round2(lines.reduce((s, l) => s + lineNet(l), 0))

export const parseLines = (json: string | null | undefined): SupplementaryLine[] => {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

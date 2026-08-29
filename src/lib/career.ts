import type { ContributionYear, ContributionsHistory } from "@/lib/tauri"

/// Helpers purs de l'écran carrière — même découpage que `vehicle-costs.ts` :
/// tout le calcul vit ici, le composant ne fait que mapper. C'est ce qui rend
/// les agrégats relisibles sans ouvrir du JSX.

/// Palette du graphique, dans un ORDRE FIXE : une couleur appartient à un
/// poste, jamais à un rang. Filtrer une année ne doit pas repeindre les séries.
///
/// Ces cinq teintes ont été validées ensemble — bande de clarté, chroma,
/// séparation en vision daltonienne et contraste — sur fond clair comme sur
/// fond sombre. Ce sont les mêmes familles que les graphiques véhicules, d'un
/// cran plus soutenues pour tenir le contraste.
export const CONTRIBUTION_SERIES = [
  { key: "net", label: "Net versé", color: "#4f46e5" },
  { key: "social", label: "Cotisations sociales", color: "#0d9488" },
  { key: "lpp", label: "2ᵉ pilier (LPP)", color: "#d97706" },
  { key: "tax", label: "Impôt à la source", color: "#db2777" },
  { key: "other", label: "Autres retenues", color: "#65a30d" },
] as const

export type SeriesKey = (typeof CONTRIBUTION_SERIES)[number]["key"]

export type YearRow = {
  year: number
  gross: number
  employers: number
  /// Vrai dès qu'une des lignes de l'année ne connaît pas le détail des
  /// cotisations : le graphique reste juste, mais la ventilation fine du
  /// tableau ne l'est pas.
  partial: boolean
} & Record<SeriesKey, number>

/// Empile les postes d'une année, tous employeurs confondus.
///
/// La ventilation retenue est la GROSSIÈRE — net, cotisations sociales, LPP,
/// impôt, autres — parce qu'elle est la seule connue des deux sources : douze
/// bulletins donnent le détail par cotisation, un certificat de salaire ne
/// publie qu'un total (rubrique 9). Mélanger les deux finesses dans un même
/// graphique rendrait deux années incomparables. Le détail vit dans le tableau,
/// où l'absence peut s'afficher comme telle.
///
/// La somme des cinq postes vaut le brut, dans les deux cas.
export function toYearRows(history: ContributionsHistory): YearRow[] {
  const byYear = new Map<number, YearRow>()

  for (const r of history.rows) {
    const row = byYear.get(r.year) ?? {
      year: r.year,
      gross: 0,
      employers: 0,
      partial: false,
      net: 0,
      social: 0,
      lpp: 0,
      tax: 0,
      other: 0,
    }
    row.gross += r.gross_total
    row.net += r.net
    row.social += r.social_total
    row.lpp += r.lpp
    row.tax += r.tax_at_source
    row.other += (r.ijm ?? 0) + (r.other_deductions ?? 0)
    row.employers += 1
    if (r.avs_ai_apg == null) row.partial = true
    byYear.set(r.year, row)
  }

  // Croissant : un graphique de carrière se lit de gauche à droite, du premier
  // employeur à aujourd'hui. Le tableau, lui, part du plus récent.
  return [...byYear.values()].sort((a, b) => a.year - b.year)
}

/// Regroupe les lignes par année, pour le tableau dépliable.
export function groupByYear(history: ContributionsHistory): Array<{
  year: number
  rows: ContributionYear[]
}> {
  const byYear = new Map<number, ContributionYear[]>()
  for (const r of history.rows) {
    const list = byYear.get(r.year) ?? []
    list.push(r)
    byYear.set(r.year, list)
  }
  return [...byYear.entries()]
    .map(([year, rows]) => ({ year, rows }))
    .sort((a, b) => b.year - a.year)
}

const CSV_HEADER = [
  "Année",
  "Employeur",
  "Source",
  "Brut",
  "Cotisations sociales",
  "AVS/AI/APG",
  "AC",
  "Solidarité AC",
  "LAA AANP",
  "2e pilier",
  "IJM",
  "Autres retenues",
  "Impôt à la source",
  "Net",
  "Bulletins",
  "Écart certificat",
]

/// Un champ inconnu sort vide, jamais à zéro : dans un tableur, `0` se somme
/// et ment. Le vide se voit.
const cell = (v: number | string | null | undefined): string => {
  if (v == null) return ""
  const s = String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const money = (v: number | null): string => (v == null ? "" : v.toFixed(2))

export function historyToCsv(history: ContributionsHistory): string {
  const lines = [CSV_HEADER.join(",")]
  for (const r of history.rows) {
    lines.push(
      [
        r.year,
        cell(r.employer_name ?? r.income_name),
        r.source === "certificate" ? "certificat" : "bulletins",
        money(r.gross_total),
        money(r.social_total),
        money(r.avs_ai_apg),
        money(r.ac),
        money(r.ac_solidarity),
        money(r.laa_nonoccupational),
        money(r.lpp),
        money(r.ijm),
        money(r.other_deductions),
        money(r.tax_at_source),
        money(r.net),
        r.receipt_count,
        money(r.certificate_gap),
      ].join(","),
    )
  }
  return lines.join("\n")
}

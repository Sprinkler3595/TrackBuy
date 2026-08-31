import type * as api from "@/lib/tauri"

/// Ce qui a changé d'une version de contrat à la suivante.
///
/// La liste des versions disait « Avenant 2026 · 58 000 par an » — elle
/// nommait la version, pas le CHANGEMENT. Or c'est le changement qu'on vient
/// vérifier : « qu'est-ce qui a bougé au 1ᵉʳ juillet, au juste ? ». Un
/// journal champ par champ répond, et sert de preuve quand une fiche de
/// salaire est contestée.

export interface FieldChange {
  label: string
  before: string
  after: string
}

const money = (v: number | null): string =>
  v == null ? "—" : `${new Intl.NumberFormat("fr-CH").format(Math.round(v * 100) / 100)}`

const pct = (v: number | null): string => (v == null ? "—" : `${v} %`)

const text = (v: string | null): string => (v?.trim() ? v : "—")

const flag = (v: boolean): string => (v ? "oui" : "non")

const scope = (v: string): string =>
  v === "base" ? "salaire de base seul" : "tout le brut"

const taxSource = (v: string): string =>
  v === "work" ? "canton du siège" : "canton de domicile"

/// Les champs suivis, dans l'ordre où on les lit sur un contrat. Chacun porte
/// son libellé d'écran et sa mise en forme : comparer des nombres bruts
/// afficherait « 50000 → 58000 » là où on veut « 50 000 → 58 000 ».
const TRACKED: Array<{
  label: string
  of: (c: api.EmploymentContract) => string
}> = [
  { label: "Nom de l'entreprise", of: (c) => text(c.employer_name) },
  { label: "Numéro IDE", of: (c) => text(c.employer_uid) },
  { label: "Salaire annuel brut", of: (c) => money(c.annual_gross_agreed) },
  { label: "Nombre de paies", of: (c) => (c.salary_periods_per_year ?? 12).toString() },
  { label: "13ᵉ salaire", of: (c) => flag(c.thirteenth_salary) },
  { label: "Taux d'activité", of: (c) => pct(c.activity_rate_pct) },
  { label: "Heures par semaine", of: (c) => (c.weekly_hours == null ? "—" : String(c.weekly_hours)) },
  { label: "Payé à l'heure", of: (c) => flag(c.hourly_paid) },
  { label: "Canton de travail", of: (c) => text(c.work_canton) },
  { label: "Canton de domicile", of: (c) => text(c.residence_canton) },
  { label: "Barème d'impôt selon", of: (c) => taxSource(c.tax_at_source_canton_source) },
  { label: "Caisse de pension", of: (c) => text(c.lpp_fund_name) },
  { label: "Taux LPP de repli", of: (c) => pct(c.lpp_employee_share_pct) },
  { label: "Salaire assuré au 2ᵉ pilier", of: (c) => scope(c.lpp_insured_scope) },
  {
    label: "Déduction de coordination réduite",
    of: (c) => flag(c.lpp_coordination_part_time),
  },
  { label: "Assureur LAA", of: (c) => text(c.laa_insurer) },
  { label: "Prime AANP", of: (c) => pct(c.laa_nonoccupational_pct) },
  { label: "Prime IJM", of: (c) => pct(c.ijm_employee_pct) },
  { label: "Imposé à la source", of: (c) => flag(c.tax_at_source) },
  { label: "Barème d'impôt", of: (c) => text(c.tax_at_source_scale) },
  { label: "Taux d'impôt effectif", of: (c) => pct(c.tax_at_source_rate_pct) },
]

/// Les différences entre deux versions. Vide quand rien de suivi n'a bougé —
/// ce qui arrive et mérite d'être dit plutôt que masqué : une version qui ne
/// change rien est probablement une erreur de saisie.
export function diffVersions(
  before: api.EmploymentContract,
  after: api.EmploymentContract,
): FieldChange[] {
  return TRACKED.map(({ label, of }) => ({ label, before: of(before), after: of(after) })).filter(
    (c) => c.before !== c.after,
  )
}

/// Le journal complet, de la version la plus récente à la plus ancienne :
/// chaque entrée dit ce que SON arrivée a changé par rapport à celle qu'elle
/// remplace. La toute première version n'a rien à comparer.
export function changeLog(
  versions: api.EmploymentContract[],
): Array<{ version: api.EmploymentContract; changes: FieldChange[] }> {
  const byStart = [...versions].sort((a, b) =>
    (a.started_on ?? "").localeCompare(b.started_on ?? ""),
  )
  return byStart
    .map((v, i) => ({
      version: v,
      changes: i === 0 ? [] : diffVersions(byStart[i - 1], v),
    }))
    .reverse()
}

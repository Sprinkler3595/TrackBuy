import type * as api from "@/lib/tauri"

/// L'âge au sens LPP : `année civile − année de naissance` (art. 13 LPP).
///
/// Ce n'est pas l'âge courant. Quelqu'un né en décembre 1986 a 40 ans « LPP »
/// dès le 1ᵉʳ janvier 2026, plusieurs mois avant son anniversaire — et c'est
/// bien ce jour-là que sa cotisation change. Confondre les deux ferait annoncer
/// le changement de palier avec jusqu'à onze mois de retard.
export function lppAge(birthDate: string | null | undefined, year: number): number | null {
  if (!birthDate) return null
  const birthYear = parseInt(birthDate.slice(0, 4), 10)
  return Number.isNaN(birthYear) ? null : year - birthYear
}

/// La tranche qui couvre un âge. Mêmes règles qu'en Rust — bornes incluses, et
/// en cas de recouvrement c'est la tranche qui commence le plus tard qui gagne,
/// parce que « de 18 à 25 » puis « de 25 à 40 » est la façon dont les plans
/// sont écrits.
export function bracketForAge(
  plan: api.LppPlanBracket[],
  age: number | null,
): api.LppPlanBracket | null {
  if (age == null) return null
  const covering = plan.filter((b) => age >= b.age_from && age <= b.age_to)
  if (covering.length === 0) return null
  return covering.reduce((best, b) => (b.age_from > best.age_from ? b : best))
}

/// L'année où le palier suivant prend effet, et la tranche qui s'appliquera.
///
/// C'est la réponse à « et après ? ». La chercher au-delà de la tranche
/// courante plutôt qu'à `age + 1` couvre le cas d'un plan à trous : sans quoi
/// on annoncerait un changement qui n'arrive pas.
export function nextBracket(
  plan: api.LppPlanBracket[],
  age: number | null,
  year: number,
): { year: number; bracket: api.LppPlanBracket } | null {
  if (age == null) return null
  const current = bracketForAge(plan, age)
  // Sans tranche courante, le prochain palier est la première tranche à venir.
  const from = current ? current.age_to + 1 : age + 1
  const upcoming = plan
    .filter((b) => b.age_from >= from || (b.age_from <= from && b.age_to >= from))
    .sort((a, b) => a.age_from - b.age_from)
  for (let a = from; a <= from + 50; a++) {
    const b = bracketForAge(upcoming, a)
    if (b && (!current || b.id !== current.id)) {
      return { year: year + (a - age), bracket: b }
    }
  }
  return null
}

/// La part patronale, déduite. Jamais stockée : deux champs indépendants
/// finiraient par se contredire.
export const employerPct = (b: api.LppPlanBracket): number =>
  Math.round((b.total_pct - b.employee_pct) * 1000) / 1000

/// Le plan minimum légal (art. 16 LPP), réparti par moitié. Ce n'est PAS le
/// plan de votre entreprise — beaucoup cotisent davantage — mais c'est un point
/// de départ correct, qu'on corrige ensuite avec son règlement de caisse sous
/// les yeux.
export const LEGAL_MINIMUM_PLAN: Array<Omit<api.LppPlanBracket, "id" | "contract_id">> = [
  { age_from: 25, age_to: 34, total_pct: 7, employee_pct: 3.5 },
  { age_from: 35, age_to: 44, total_pct: 10, employee_pct: 5 },
  { age_from: 45, age_to: 54, total_pct: 15, employee_pct: 7.5 },
  { age_from: 55, age_to: 65, total_pct: 18, employee_pct: 9 },
]

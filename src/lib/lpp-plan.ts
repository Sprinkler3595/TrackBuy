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

/// Sur quel salaire un taux porte. Les caisses nomment ces assiettes
/// différemment — AXA dit « salaire assuré 1, 2, 3 » — mais la mécanique est
/// la même partout.
export const LPP_BASES = [
  {
    value: "coordinated",
    label: "Salaire coordonné",
    hint: "Salaire annuel moins la déduction de coordination. L'assiette du régime obligatoire, et de loin la plus courante. AXA l'appelle « salaire assuré 1 ».",
  },
  {
    value: "excess",
    label: "Part au-delà de la limite LPP",
    hint: "Ce qui dépasse 300 % de la rente AVS maximale (90 720 CHF en 2026). Nul en dessous. AXA l'appelle « salaire assuré 2 ».",
  },
  {
    value: "full",
    label: "Salaire annuel entier",
    hint: "Le salaire annuel, plafonné à la limite LPP, sans déduction de coordination. AXA l'appelle « salaire assuré 3 ».",
  },
] as const

export const basisLabel = (v: string): string =>
  LPP_BASES.find((b) => b.value === v)?.label ?? v

type Bracket = Omit<api.LppPlanBracket, "id" | "contract_id">

/// Le plan minimum légal (art. 16 LPP), réparti par moitié. Ce n'est PAS le
/// plan de votre entreprise — beaucoup cotisent davantage — mais c'est un point
/// de départ correct, qu'on corrige ensuite avec son règlement de caisse sous
/// les yeux.
export const LEGAL_MINIMUM_PLAN: Bracket[] = [
  { age_from: 25, age_to: 34, total_pct: 7, employee_pct: 3.5, basis: "coordinated" },
  { age_from: 35, age_to: 44, total_pct: 10, employee_pct: 5, basis: "coordinated" },
  { age_from: 45, age_to: 54, total_pct: 15, employee_pct: 7.5, basis: "coordinated" },
  { age_from: 55, age_to: 65, total_pct: 18, employee_pct: 9, basis: "coordinated" },
]

/// Le plan AXA / Columna Fondation collective Group Invest, variante
/// « Standard ». Recopié d'un document de plan réel : l'épargne monte par
/// paliers sur le salaire coordonné, ET 4 % s'ajoutent sur la part au-delà de
/// la limite LPP, à tout âge.
///
/// La part salarié y vaut exactement 40 % du total à chaque palier (3.2/8,
/// 4.4/11, 6.4/16, 7.6/19), ce qui est aussi la répartition que le plan annonce
/// pour les cotisations de risque et de frais.
///
/// Le total de la seconde assiette n'est PAS imprimé sur le document : seuls
/// les 4 % à charge du salarié le sont. Les 10 % indiqués ici en sont déduits
/// par ce même rapport de 40 %. Cela ne change aucune retenue — `total_pct` ne
/// sert qu'au plafond de l'art. 66 al. 1 LPP — mais il faut savoir que ce
/// chiffre-là est inféré, pas lu.
///
/// ⚠️ Ces chiffres sont ceux d'UN contrat. AXA propose plusieurs variantes
/// (« plan à choix », changeable une fois par année civile), et chaque
/// entreprise négocie les siennes : à vérifier sur votre propre document.
///
/// ⚠️ Le plan facture EN PLUS des cotisations de risque et de frais, dont il
/// donne la clé de répartition (40 % salarié) mais pas le taux — celui-ci vit
/// sur la facture annuelle de la caisse. Votre retenue LPP réelle sera donc un
/// peu supérieure à la seule épargne calculée ici.
export const AXA_COLUMNA_STANDARD: Bracket[] = [
  { age_from: 20, age_to: 34, total_pct: 8, employee_pct: 3.2, basis: "coordinated" },
  { age_from: 35, age_to: 44, total_pct: 11, employee_pct: 4.4, basis: "coordinated" },
  { age_from: 45, age_to: 54, total_pct: 16, employee_pct: 6.4, basis: "coordinated" },
  { age_from: 55, age_to: 65, total_pct: 19, employee_pct: 7.6, basis: "coordinated" },
  { age_from: 20, age_to: 65, total_pct: 10, employee_pct: 4, basis: "excess" },
]

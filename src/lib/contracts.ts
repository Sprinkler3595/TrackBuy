import type * as api from "@/lib/tauri"

/// Quelle version du contrat était en vigueur à une date donnée.
///
/// C'est le pendant côté écran de `load_contract_at` en Rust : un bulletin de
/// juin 2019 doit être lu avec le contrat de 2019, pas avec l'avenant signé
/// depuis. Sans cela, saisir une astreinte de 2019 la facturerait au tarif
/// d'aujourd'hui — l'erreur est silencieuse et fausse tout l'historique.
///
/// Si aucune version ne couvre la date, on retient la **plus ancienne** : une
/// fiche antérieure à toutes les versions saisies vaut mieux rattachée au
/// premier contrat connu qu'orpheline. La borne haute, elle, reste stricte —
/// jamais un tarif futur sur un bulletin passé.
export function contractInForce(
  versions: api.EmploymentContract[],
  onDate: string | null | undefined,
): api.EmploymentContract | null {
  if (versions.length === 0) return null
  const byStart = [...versions].sort((a, b) =>
    (a.started_on ?? "").localeCompare(b.started_on ?? ""),
  )
  if (!onDate) return byStart[byStart.length - 1] ?? null

  const covering = byStart.filter(
    (c) =>
      (c.started_on ?? "") <= onDate && (c.ended_on == null || c.ended_on >= onDate),
  )
  return covering[covering.length - 1] ?? byStart[0] ?? null
}

/// Unités d'un supplément de salaire.
///
/// Séparées du composant pour que le récapitulatif du mois type puisse les
/// libeller sans importer tout l'éditeur de barème.
export const SUPPLEMENT_UNITS = [
  { value: "week", label: "par semaine" },
  { value: "day", label: "par jour" },
  { value: "hour", label: "par heure" },
  { value: "flat", label: "forfait" },
] as const

export const unitLabel = (unit: string): string =>
  SUPPLEMENT_UNITS.find((u) => u.value === unit)?.label ?? unit

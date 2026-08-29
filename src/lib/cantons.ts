/// Les 26 cantons, code officiel à deux lettres.
///
/// Cette liste vivait en trois exemplaires, avec deux commentaires qui se
/// contredisaient sur ce que le canton détermine. Elle est ici, une fois, avec
/// la règle exacte — parce que la question « quel canton ? » n'a pas une seule
/// réponse et que s'en remettre à un unique champ donne forcément un calcul
/// faux à quelqu'un.
export const CANTONS = [
  "AG", "AI", "AR", "BE", "BL", "BS", "FR", "GE", "GL", "GR", "JU", "LU",
  "NE", "NW", "OW", "SG", "SH", "SO", "SZ", "TG", "TI", "UR", "VD", "VS",
  "ZG", "ZH",
] as const

export type Canton = (typeof CANTONS)[number]

export const isCanton = (v: string): v is Canton =>
  (CANTONS as readonly string[]).includes(v.trim().toUpperCase())

/// Deux cantons pilotent deux choses différentes, et ils ne coïncident pas
/// toujours — habiter Vaud et travailler pour une société genevoise est banal.
///
///   - **canton de travail** = siège de l'employeur. Il commande les retenues
///     sociales cantonales (cotisation salariée aux allocations familiales en
///     VD et VS, assurance maternité à GE) et la caisse d'allocations
///     familiales, parce que l'employeur s'affilie là où il siège.
///   - **canton de domicile** = le vôtre. Il commande le barème d'impôt à la
///     source : pour un résident suisse, le canton compétent est celui du
///     domicile (art. 38 al. 4 let. a LHID).
///
/// Certains employeurs retiennent malgré tout selon le canton de leur siège
/// puis reversent au canton de domicile. Les deux pratiques existent ; seule
/// la fiche de salaire tranche, d'où le réglage explicite.
export const WORK_CANTON_HINT =
  "Le canton où votre employeur a son siège. Il détermine les retenues sociales cantonales et la caisse d'allocations familiales."

export const RESIDENCE_CANTON_HINT =
  "Le canton où vous habitez. Il détermine le barème d'impôt à la source, qui suit le domicile et non le lieu de travail."

/// Les trois taux que seule votre entreprise connaît, et le piège qu'ils
/// tendent tous les trois.
///
/// Une caisse de pension annonce volontiers « répartition 50/50 », un assureur
/// « prime partagée par moitié ». Ces phrases décrivent le PARTAGE entre
/// l'employeur et vous, pas le taux de la retenue. Saisir 50 donne alors une
/// retenue vingt fois trop grosse, et rien dans un champ nommé « LPP % » ne
/// prévient de la confusion.
///
/// D'où deux garde-fous : dire de quoi le pourcentage est un pourcentage, et
/// signaler une valeur qui sort de l'ordinaire. Signaler, pas interdire — un
/// règlement inhabituel reste possible, et c'est le salarié qui a sa fiche
/// sous les yeux, pas nous.

export interface RateGuide {
  label: string
  /// De quoi ce pourcentage est un pourcentage. C'est l'information qui
  /// manquait le plus.
  unit: string
  hint: string
  placeholder: string
  /// Au-delà, on ne refuse pas — on demande confirmation.
  usualMax: number
  /// Ce qu'on dit quand la valeur sort de l'ordinaire. Nomme la confusion
  /// probable plutôt que de se contenter d'un « valeur suspecte ».
  overWarning: string
}

export const RATE_GUIDES = {
  lpp: {
    label: "Part employé au 2ᵉ pilier",
    unit: "% du salaire coordonné",
    hint: "Votre part de la cotisation LPP. L'employeur doit financer au moins autant que vous (art. 66 al. 1 LPP).",
    placeholder: "3.50",
    usualMax: 15,
    overWarning:
      "C'est sans doute la répartition employeur/employé annoncée par votre caisse, et non le taux. Votre part se lit sur votre fiche de salaire : elle vaut d'ordinaire entre 3 et 9 % du salaire coordonné.",
  },
  laa: {
    label: "Prime AANP",
    unit: "% du salaire assuré",
    hint: "Accidents non professionnels, à votre charge (art. 91 al. 2 LAA). Les accidents professionnels sont payés par l'employeur.",
    placeholder: "1.00",
    usualMax: 5,
    overWarning:
      "À votre charge, la prime AANP dépasse rarement 3 % du salaire assuré. Un « 50 % » désigne en général le partage de la prime, pas son taux.",
  },
  ijm: {
    label: "Prime IJM",
    unit: "% du salaire assuré",
    hint: "Indemnités journalières en cas de maladie. Assurance facultative, dont la prime est souvent partagée par moitié — ce partage n'est pas le taux.",
    placeholder: "0.50",
    usualMax: 5,
    overWarning:
      "La part employé dépasse rarement 2 % du salaire assuré. « Partagée par moitié » désigne le partage de la prime, pas son taux.",
  },
} as const satisfies Record<string, RateGuide>

export type RateKind = keyof typeof RATE_GUIDES

/// L'avertissement à afficher sous un champ, ou `null` s'il n'y a rien à dire.
/// Une saisie vide ou illisible ne dit rien : un champ qu'on est en train de
/// remplir n'est pas une erreur.
export function rateWarning(kind: RateKind, raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  const n = parseFloat(t)
  if (Number.isNaN(n)) return null
  return n > RATE_GUIDES[kind].usualMax ? RATE_GUIDES[kind].overWarning : null
}

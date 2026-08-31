import { ExternalLink } from "lucide-react"

/// Où trouver l'IDE et l'adresse du siège d'une entreprise.
///
/// Deux champs reviennent à la saisie d'un employeur — l'IDE et l'adresse —
/// et personne ne les connaît par cœur. Ils figurent en tête d'une fiche de
/// salaire, mais pas toujours ; le registre du commerce, lui, les publie
/// toujours et gratuitement.
///
/// Une phrase et un lien, donc, plutôt qu'une recherche intégrée : ces deux
/// champs ne servent à aucun calcul, et les remplir est l'affaire d'une
/// minute, une fois pour toutes.
export function ZefixHint({ fr = true }: { fr?: boolean }) {
  return (
    <>
      {fr
        ? "le registre officiel du commerce les publie gratuitement : "
        : "the official commercial register publishes them free of charge: "}
      <a
        href="https://www.zefix.admin.ch"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline inline-flex items-center gap-1"
      >
        zefix.admin.ch
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
      {fr
        ? " — cherchez le nom de l'entreprise."
        : " — search for the company name."}
    </>
  )
}
